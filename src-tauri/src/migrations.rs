//! SQLite schema migrations (stub baseline).
//!
//! The migration set is wired onto the `tauri-plugin-sql` builder now (in
//! `lib.rs`), so plan 01-03 only edits this file to fill the real v1 schema
//! (`work` / `locator` / `change_log`, D-09) without touching the crate root.

use tauri_plugin_sql::Migration;

/// Schema v1 DDL — filled by plan 01-03. Kept as an empty string so the stub
/// migration set below is a clean no-op until then.
pub const SCHEMA_V1: &str = "";

/// The migration set applied to `sqlite:pillow.db` at startup.
///
/// Empty in P1 Wave 1; plan 01-03 pushes the v1 `Migration` built from
/// [`SCHEMA_V1`].
pub fn migrations() -> Vec<Migration> {
    Vec::new()
}
