//! Opaque storage-handle `BookSource` (seam stub).
//!
//! Filled by plan 01-03 (D-05): an opaque `BookSource` enum
//! (`Path(PathBuf)` on desktop, `ContentUri(String)` for Android SAF) so book
//! access is never a raw path. Android scoped storage makes paths meaningless,
//! so all access flows through this handle.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// The opaque book-access handle (D-05).
///
/// This is the **only** type through which `core` and the DB refer to a book's
/// bytes — a raw filesystem path must never appear in core/DB APIs. On desktop a
/// book is a filesystem [`Path`](Self::Path); on Android it is a SAF
/// [`ContentUri`](Self::ContentUri) (`content://…`) backed by a persisted URI
/// permission grant, because Android scoped storage makes bare paths
/// meaningless. Plan 01-05 wires the SAF grant persistence behind this handle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum BookSource {
    /// A desktop filesystem path.
    Path(PathBuf),

    /// An Android SAF `content://` URI (with a persisted permission grant).
    ContentUri(String),
}

impl From<PathBuf> for BookSource {
    /// A bare filesystem path is the desktop book handle. This conversion lets
    /// call sites register a `PathBuf` while the registry keeps only opaque
    /// `BookSource` values (D-05) — a raw path never leaks past this boundary.
    fn from(path: PathBuf) -> Self {
        BookSource::Path(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_buf_converts_to_path_handle() {
        let src: BookSource = PathBuf::from("/books/凉州词.epub").into();
        assert_eq!(src, BookSource::Path(PathBuf::from("/books/凉州词.epub")));
    }

    #[test]
    fn book_source_round_trips() {
        let path = BookSource::Path("/books/凉州词.epub".into());
        let uri = BookSource::ContentUri("content://com.android.providers/tree/42".into());
        for src in [path, uri] {
            let json = serde_json::to_string(&src).unwrap();
            let back: BookSource = serde_json::from_str(&json).unwrap();
            assert_eq!(back, src);
        }
    }

    #[test]
    fn content_uri_carries_no_filesystem_path() {
        // On Android the handle is a SAF URI — a serialized ContentUri must never
        // expose a filesystem path (D-05); it is the only book-access type in core.
        let uri = BookSource::ContentUri("content://com.android.providers/tree/42".into());
        let json = serde_json::to_string(&uri).unwrap();
        assert!(json.contains("content://"));
        assert!(!json.contains("Path"));
    }
}
