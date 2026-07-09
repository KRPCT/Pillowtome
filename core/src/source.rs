//! Opaque storage-handle `BookSource` (seam stub).
//!
//! Filled by plan 01-03 (D-05): an opaque `BookSource` enum
//! (`Path(PathBuf)` on desktop, `ContentUri(String)` for Android SAF) so book
//! access is never a raw path. Android scoped storage makes paths meaningless,
//! so all access flows through this handle.

#[cfg(test)]
mod tests {
    use super::*;

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
