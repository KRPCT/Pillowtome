//! 枕籍 (Pillowtome) Tauri glue crate.
//!
//! Owns the app runtime: registers the Range-aware `pillow://` byte-streaming
//! protocol (D-06), the SQLite migration set, and pre-registers the bundled
//! sample EPUB in the [`SourceRegistry`] at setup so `pillow://.../sample`
//! resolves the moment Plan 04 drops the file.

pub mod commands;
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
    tauri::Builder::default()
        // SQLite (SQLx-backed) migrations, one schema on desktop + Android.
        // The set is empty in Wave 1; plan 01-03 fills `migrations.rs`.
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:pillow.db", migrations::migrations())
                .build(),
        )
        // The registry is the sole authority on which bytes an id may read.
        .manage(SourceRegistry::new())
        // pillow:// — book bytes stream here, never over IPC (D-06). Range-aware
        // 200/206/416 handled by `protocol::serve`; ids scope-guarded (T-01-01).
        .register_asynchronous_uri_scheme_protocol("pillow", |ctx, request, responder| {
            let app = ctx.app_handle();
            let registry = app.state::<SourceRegistry>();
            let path = request.uri().path().to_string();
            let range = request
                .headers()
                .get(header::RANGE)
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned);
            let response = protocol::serve(&registry, &path, range.as_deref());
            responder.respond(response);
        })
        // Small structured IPC only. `check_protection` returns the pre-render
        // DRM/corruption verdict for a registered id; book bytes never cross
        // IPC (D-06) — they stream over pillow:// once the gate says render.
        .invoke_handler(tauri::generate_handler![commands::check_protection])
        .setup(|app| {
            // Materialize the embedded sample to a real filesystem path and
            // register it, so `pillow://.../sample` resolves before the frontend
            // ever fetches it (BLOCKER-1 fix). Uses `app_data_dir()` rather than
            // `BaseDirectory::Resource` because Android resources live inside the
            // APK and are not readable via `std::fs` — see [`SAMPLE_EPUB`].
            let sample_path = materialize_sample(app.handle())?;
            app.state::<SourceRegistry>()
                .register(SAMPLE_ID, sample_path);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
