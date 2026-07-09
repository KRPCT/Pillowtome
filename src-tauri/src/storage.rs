//! Source registry: maps an opaque book id to the [`BookSource`] that backs it.
//!
//! Held in Tauri managed state and read by the `pillow://` protocol handler.
//! The registry is the **only** authority on which bytes a given id may read —
//! the protocol never reads a caller-supplied path (threat T-01-01).
//!
//! Values are opaque `BookSource` handles (D-05): a desktop filesystem
//! `Path`, or an Android SAF `content://` `ContentUri` backed by a persisted
//! URI permission grant. A raw path never crosses this boundary.

use std::collections::HashMap;
use std::sync::Mutex;

use pillowtome_core::source::BookSource;

/// Registry of `id -> BookSource`, guarded for interior mutability so it can
/// live in Tauri managed state behind a shared reference.
#[derive(Default)]
pub struct SourceRegistry {
    inner: Mutex<HashMap<String, BookSource>>,
}

impl SourceRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register (or replace) the [`BookSource`] backing `id`.
    ///
    /// Accepts anything convertible into a `BookSource` (a bare `PathBuf`
    /// becomes `BookSource::Path`), so the registry never stores a raw path.
    pub fn register(&self, id: impl Into<String>, source: impl Into<BookSource>) {
        self.inner.lock().unwrap().insert(id.into(), source.into());
    }

    /// Resolve `id` to its registered [`BookSource`], if any.
    pub fn resolve(&self, id: &str) -> Option<BookSource> {
        self.inner.lock().unwrap().get(id).cloned()
    }

    /// All registered ids (order unspecified) — used to list importable books.
    pub fn ids(&self) -> Vec<String> {
        self.inner.lock().unwrap().keys().cloned().collect()
    }
}

/// Read the full bytes behind a [`BookSource`].
///
/// `Path` reads from disk on every platform; `ContentUri` reads via the Android
/// SAF plugin **in-session** (Android only), which needs the app handle to reach
/// the plugin state. Book bytes are read here in Rust — they never cross Tauri
/// IPC (D-06); the caller streams them out over `pillow://`.
pub fn resolve_bytes<R: tauri::Runtime>(
    source: &BookSource,
    app: &tauri::AppHandle<R>,
) -> std::io::Result<Vec<u8>> {
    match source {
        BookSource::Path(path) => std::fs::read(path),
        BookSource::ContentUri(uri) => read_content_uri(uri, app),
    }
}

/// Read a SAF `content://` URI via the Android FS plugin (Android only).
#[cfg(target_os = "android")]
fn read_content_uri<R: tauri::Runtime>(
    uri: &str,
    app: &tauri::AppHandle<R>,
) -> std::io::Result<Vec<u8>> {
    use tauri_plugin_android_fs::{AndroidFsExt, FileUri};

    app.android_fs()
        .read(&FileUri::from_uri(uri))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
}

/// On desktop a `content://` handle is unreachable — resolution is a no-op error.
#[cfg(not(target_os = "android"))]
fn read_content_uri<R: tauri::Runtime>(
    _uri: &str,
    _app: &tauri::AppHandle<R>,
) -> std::io::Result<Vec<u8>> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "content:// sources require Android",
    ))
}

/// Extract the book id from a request path (e.g. `/sample` -> `sample`),
/// rejecting anything that could escape the flat registry namespace.
///
/// Registry ids are flat tokens, so any path separator or `..` traversal is
/// rejected outright before a lookup ever happens (threat T-01-01). This keeps
/// the protocol from being coerced into reading an arbitrary filesystem path.
pub fn sanitize_id(raw_path: &str) -> Option<String> {
    let id = raw_path.trim_start_matches('/');
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return None;
    }
    Some(id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use pillowtome_core::source::BookSource;
    use std::path::PathBuf;

    #[test]
    fn sanitize_rejects_traversal_and_nesting() {
        assert_eq!(sanitize_id("/sample"), Some("sample".to_string()));
        assert_eq!(sanitize_id("/../etc/passwd"), None);
        assert_eq!(sanitize_id("/a/b"), None);
        assert_eq!(sanitize_id("/a\\b"), None);
        assert_eq!(sanitize_id("/"), None);
    }

    #[test]
    fn registry_stores_book_source_not_raw_path() {
        // D-05: what backs an id is an opaque BookSource, never a bare path.
        // A bare PathBuf is accepted for ergonomics but stored as BookSource::Path.
        let reg = SourceRegistry::new();
        reg.register("x", PathBuf::from("/tmp/x.epub"));
        assert!(matches!(reg.resolve("x"), Some(BookSource::Path(_))));
        assert_eq!(reg.resolve("missing"), None);
    }

    #[test]
    fn migrated_sample_still_resolves() {
        // The bundled sample migrates from a bare PathBuf (Plan 01) to a
        // BookSource::Path; it must keep resolving after the type change so the
        // FND-01/FND-02 reading slice does not regress.
        let reg = SourceRegistry::new();
        let sample = BookSource::Path(PathBuf::from("/data/sample.epub"));
        reg.register("sample", sample.clone());
        assert_eq!(reg.resolve("sample"), Some(sample));
    }

    #[test]
    fn ids_lists_registered_handles() {
        let reg = SourceRegistry::new();
        reg.register("sample", PathBuf::from("/data/sample.epub"));
        reg.register("import-1", BookSource::ContentUri("content://x/1".into()));
        let mut ids = reg.ids();
        ids.sort();
        assert_eq!(ids, vec!["import-1".to_string(), "sample".to_string()]);
    }
}
