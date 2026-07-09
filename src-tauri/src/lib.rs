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
use tauri::path::BaseDirectory;
use tauri::Manager;

use storage::SourceRegistry;

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
        .setup(|app| {
            // Pre-register the bundled sample unconditionally so the
            // registry -> protocol plumbing is live from Wave 1 and
            // pillow://.../sample resolves as soon as the file exists
            // (BLOCKER-1 fix). Plan 04 drops assets/sample/sample.epub.
            let sample_path = app
                .path()
                .resolve("assets/sample/sample.epub", BaseDirectory::Resource)?;
            app.state::<SourceRegistry>().register("sample", sample_path);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
