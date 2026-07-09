//! Typed core error surface (filled by plan 01-02, D-10).
//!
//! [`CoreError`] lets DRM and malformed-EPUB paths soft-fail with a friendly,
//! user-facing message instead of panicking. The render layer surfaces these as
//! an "unsupported / damaged" card. Messages are end-user copy, not developer text.

use thiserror::Error;

/// Errors returned by the portable core.
///
/// The DRM/corruption detector never decrypts anything (D-10); it only refuses
/// cleanly. `Corrupt` is the soft-fail path for malformed/truncated archives so a
/// hostile or damaged book can never crash the app.
#[derive(Debug, Error)]
pub enum CoreError {
    /// The file is a book format we do not support (e.g. a Kindle container).
    #[error("This book format is not supported.")]
    Unsupported,

    /// The book is protected by DRM and cannot be opened. Carries the scheme name
    /// (e.g. `"Adobe ADEPT"`, `"Kindle"`) for the message shown to the reader.
    #[error("This book is protected by DRM ({0}) and cannot be opened.")]
    Drm(String),

    /// The file is damaged, truncated, or not a valid EPUB archive.
    #[error("This book file is damaged or could not be read.")]
    Corrupt,

    /// An underlying I/O failure while reading the book.
    #[error("Could not read the book file: {0}")]
    Io(#[from] std::io::Error),
}
