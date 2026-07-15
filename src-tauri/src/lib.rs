//! 枕籍 (Pillowtome) Tauri glue crate.
//!
//! Owns the app runtime: registers the Range-aware `pillow://` byte-streaming
//! protocol (D-06), the SQLite migration set, and pre-registers the bundled
//! sample EPUB in the [`SourceRegistry`] at setup so `pillow://.../sample`
//! resolves the moment Plan 04 drops the file.

pub mod commands;
pub mod fonts;
pub mod migrations;
pub mod protocol;
pub mod storage;

use tauri::http::header;
use tauri::Manager;

use storage::SourceRegistry;

/// The bundled sample EPUB, embedded in the binary.
///
/// It is **not** read through `BaseDirectory::Resource`. On Android, resources
/// declared in `bundle.resources` are packaged *inside the APK* as Android
/// assets (`assets/assets/sample/sample.epub`); they have no filesystem path,
/// so `std::fs::read` fails and the reader shows "无法读取书籍文件。". Desktop
/// happens to work only because resources are copied next to the binary.
///
/// Embedding the 3.5 KB fixture and materializing it into `app_data_dir()` on
/// first launch gives one code path on both platforms, no JNI/AssetManager, and
/// keeps the sample what it actually is: a build-time fixture, not user content.
/// Real books arrive as a `BookSource` (file picker / Android SAF) in Plan 01-05.
const SAMPLE_EPUB: &[u8] = include_bytes!("../assets/sample/sample.epub");

/// Sample id registered in the [`SourceRegistry`]; the reader fetches
/// `pillow://.../sample`.
const SAMPLE_ID: &str = "sample";

/// Write the embedded sample into `app_data_dir()` (idempotent) and return its
/// path. Rewrites when the on-disk copy differs so a changed fixture is picked
/// up instead of a stale one lingering from an earlier install.
fn materialize_sample(app: &tauri::AppHandle) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("sample.epub");
    let stale = match std::fs::read(&path) {
        Ok(existing) => existing != SAMPLE_EPUB,
        Err(_) => true,
    };
    if stale {
        std::fs::write(&path, SAMPLE_EPUB)?;
    }
    Ok(path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // SQLite (SQLx-backed) migrations, one schema on desktop + Android.
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:pillow.db", migrations::migrations())
                .build(),
        )
        // Desktop file picker for import (returns a filesystem path). On Android
        // import uses the SAF picker instead (persistable grants), so this is a
        // desktop convenience; the frontend gates on `is_android`.
        .plugin(tauri_plugin_dialog::init());

    // Android SAF: picker + persistable URI grants (FND-03). Behind the plugin's
    // Rust API only — the capability surface is scoped in `capabilities/` and no
    // write/remove/MediaStore command is granted (DEC-004). Desktop never links
    // this crate (target-gated dependency).
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_android_fs::init());

    builder
        // The registry is the sole authority on which bytes an id may read.
        .manage(SourceRegistry::new())
        // pillow:// — book bytes stream here, never over IPC (D-06). Range-aware
        // 200/206/416; ids scope-guarded (T-01-01). A registered `content://`
        // handle is read via the SAF plugin (in Rust) and served from memory.
        .register_asynchronous_uri_scheme_protocol("pillow", |ctx, request, responder| {
            let app = ctx.app_handle();
            let registry = app.state::<SourceRegistry>();
            let path = request.uri().path().to_string();
            let range = request
                .headers()
                .get(header::RANGE)
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned);

            // Custom fonts: `pillow://…/fonts/{id}` confined under app_data/fonts
            // (D-30 / T-02-path). Not SourceRegistry — separate allowlist.
            if let Some(font_id) = protocol::parse_font_path(&path) {
                let fonts_dir = fonts::fonts_dir(app).ok();
                let response =
                    protocol::serve_font(fonts_dir.as_deref(), &font_id, range.as_deref());
                responder.respond(response);
                return;
            }

            #[cfg(target_os = "android")]
            {
                use pillowtome_core::source::BookSource;
                if let Some(BookSource::ContentUri(uri)) =
                    storage::sanitize_id(&path).and_then(|id| registry.resolve(&id))
                {
                    let response = protocol::serve_content_uri(app, &uri, range.as_deref());
                    responder.respond(response);
                    return;
                }
            }

            let response = protocol::serve(&registry, &path, range.as_deref());
            responder.respond(response);
        })
        // Small structured IPC only (D-06): DRM verdict, import id/name, font
        // metadata, the imported-books list, and the platform flag. Never book
        // or font file bytes (T-02-ipc).
        .invoke_handler(tauri::generate_handler![
            commands::check_protection,
            commands::ensure_work,
            commands::import,
            commands::imported_books,
            commands::is_android,
            fonts::import_font,
            fonts::remove_font,
        ])
        .setup(|app| {
            // Materialize the embedded sample to a real filesystem path and
            // register it, so `pillow://.../sample` resolves before the frontend
            // ever fetches it. Uses `app_data_dir()` rather than
            // `BaseDirectory::Resource` because Android resources live inside the
            // APK and are not readable via `std::fs` — see [`SAMPLE_EPUB`].
            let sample_path = materialize_sample(app.handle())?;
            app.state::<SourceRegistry>()
                .register(SAMPLE_ID, sample_path);

            // Re-hydrate persisted SAF grants so a previously imported book
            // reopens after a restart without re-granting (FND-03).
            #[cfg(target_os = "android")]
            rehydrate_imports(app.handle());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Re-register books the app still holds a persisted SAF grant for, so they
/// survive a force-stop + relaunch (FND-03). Each is keyed by the same stable
/// id a fresh import would produce, so ids stay consistent across restarts.
#[cfg(target_os = "android")]
fn rehydrate_imports(app: &tauri::AppHandle) {
    use pillowtome_core::source::BookSource;
    use tauri_plugin_android_fs::AndroidFsExt;

    let picker = app.android_fs().file_picker();
    let Ok(grants) = picker.get_all_persisted_uri_permissions() else {
        return;
    };
    let registry = app.state::<SourceRegistry>();
    for grant in grants {
        if grant.is_file() && grant.can_read() {
            let source = BookSource::ContentUri(grant.uri().uri.clone());
            registry.register(commands::book_id(&source), source);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::SAMPLE_EPUB;
    use pillowtome_core::protection::{detect_protection, Protection};

    /// The shipped fixture must be a readable, DRM-free EPUB. Without this the
    /// only signal that the sample rotted is an error card on a device.
    #[test]
    fn sample_is_clean_epub() {
        assert!(!SAMPLE_EPUB.is_empty());
        assert_eq!(&SAMPLE_EPUB[..2], b"PK", "sample is not a zip archive");
        assert_eq!(detect_protection(SAMPLE_EPUB).unwrap(), Protection::None);
    }
}
