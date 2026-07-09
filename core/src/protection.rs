//! DRM / corruption detect-and-refuse (seam stub).
//!
//! Filled by plan 01-02 (FND-04): a pure, off-device-testable
//! `detect_protection(epub_bytes) -> Result<Protection, CoreError>` that reads
//! `META-INF/encryption.xml` + `rights.xml` and zip validity **without ever
//! decrypting anything** (D-10). Content DRM / Kindle → refuse; corrupt zip →
//! soft-fail.
