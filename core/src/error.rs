//! Typed core error surface (seam stub).
//!
//! Filled by plan 01-02: a `thiserror`-derived `CoreError` enum
//! (`Unsupported` / `Drm` / `Corrupt` / …) so DRM and malformed-EPUB paths
//! soft-fail with a friendly error instead of panicking (D-10).
