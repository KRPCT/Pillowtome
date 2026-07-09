//! Opaque storage-handle `BookSource` (seam stub).
//!
//! Filled by plan 01-03 (D-05): an opaque `BookSource` enum
//! (`Path(PathBuf)` on desktop, `ContentUri(String)` for Android SAF) so book
//! access is never a raw path. Android scoped storage makes paths meaningless,
//! so all access flows through this handle.
