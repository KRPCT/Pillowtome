//! Source registry: maps an opaque book id to the file that backs it.
//!
//! Held in Tauri managed state and read by the `pillow://` protocol handler.
//! The registry is the **only** authority on which bytes a given id may read —
//! the protocol never reads a caller-supplied path (threat T-01-01).
//!
//! P1 stores a [`PathBuf`]; Plan 05 migrates the value type to
//! `pillowtome_core::source::BookSource`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

/// Registry of `id -> backing file path`, guarded for interior mutability so it
/// can live in Tauri managed state behind a shared reference.
#[derive(Default)]
pub struct SourceRegistry {
    inner: Mutex<HashMap<String, PathBuf>>,
}

impl SourceRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register (or replace) the path backing `id`.
    pub fn register(&self, id: impl Into<String>, path: impl Into<PathBuf>) {
        self.inner.lock().unwrap().insert(id.into(), path.into());
    }

    /// Resolve `id` to its registered path, if any.
    pub fn resolve(&self, id: &str) -> Option<PathBuf> {
        self.inner.lock().unwrap().get(id).cloned()
    }
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

    #[test]
    fn sanitize_rejects_traversal_and_nesting() {
        assert_eq!(sanitize_id("/sample"), Some("sample".to_string()));
        assert_eq!(sanitize_id("/../etc/passwd"), None);
        assert_eq!(sanitize_id("/a/b"), None);
        assert_eq!(sanitize_id("/a\\b"), None);
        assert_eq!(sanitize_id("/"), None);
    }

    #[test]
    fn register_then_resolve() {
        let reg = SourceRegistry::new();
        reg.register("x", PathBuf::from("/tmp/x.epub"));
        assert_eq!(reg.resolve("x"), Some(PathBuf::from("/tmp/x.epub")));
        assert_eq!(reg.resolve("missing"), None);
    }
}
