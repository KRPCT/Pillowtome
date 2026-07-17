//! Publication model (seam).
//!
//! Plan 01-03 (D-07): `Publication` trait + `Format` enum. EPUB is the only
//! implementor in v1; TXT/MOBI/PDF stay additive later.
//!
//! Phase 4: real EPUB metadata/cover extraction via [`epub_meta`].

mod epub_meta;

pub use epub_meta::{extract_epub_cover, extract_epub_meta, CoverImage, EpubMeta};

use serde::{Deserialize, Serialize};

/// True when the bytes are an EPUB (OCF zip carrying `META-INF/container.xml`).
///
/// Other formats (MOBI/AZW3/PDF/TXT/FB2/CBZ) are rendered by foliate-js in the
/// WebView; callers use this only to route EPUBs through the OCF DRM gate + OPF
/// metadata/cover path and everything else through the generic import path.
pub fn is_epub(bytes: &[u8]) -> bool {
    match zip::ZipArchive::new(std::io::Cursor::new(bytes)) {
        Ok(mut zip) => zip.by_name("META-INF/container.xml").is_ok(),
        Err(_) => false,
    }
}

/// Book container format.
///
/// EPUB is the only v1 implementor (D-07). `Txt`/`Mobi`/`Pdf` are reserved for
/// later phases so new formats stay additive against this seam.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    /// EPUB (OCF/zip) — the only format rendered in v1.
    Epub,
    // Txt, Mobi, Pdf — reserved for Phase 6; not implemented yet (D-07).
}

/// A format-agnostic publication.
///
/// Core seam: [`Format`] + content hash (D-09). Phase 4 adds convenience
/// extractors on [`EpubPublication`] without forcing every future format to
/// implement cover/TOC on the trait yet.
pub trait Publication {
    /// The container format of this publication.
    fn format(&self) -> Format;

    /// Stable content hash (blake3 hex) of the raw book bytes, used for
    /// deduplication and later KOReader-style document identity (D-09).
    fn content_hash(&self) -> String;
}

/// EPUB implementor — hashes content and can extract OPF metadata/cover (P4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EpubPublication {
    content_hash: String,
}

impl EpubPublication {
    /// Wrap a precomputed blake3 hex content hash.
    pub fn new(content_hash: String) -> Self {
        Self { content_hash }
    }

    /// Build from raw EPUB bytes, computing the blake3 content hash (D-09).
    pub fn from_bytes(bytes: &[u8]) -> Self {
        Self {
            content_hash: blake3::hash(bytes).to_hex().to_string(),
        }
    }

    /// Title / author / language from OPF (soft-fail title `未知书名`).
    pub fn metadata_from_bytes(bytes: &[u8]) -> EpubMeta {
        extract_epub_meta(bytes)
    }

    /// Cover image bytes when present in the package.
    pub fn cover_from_bytes(bytes: &[u8]) -> Option<CoverImage> {
        extract_epub_cover(bytes)
    }
}

impl Publication for EpubPublication {
    fn format(&self) -> Format {
        Format::Epub
    }

    fn content_hash(&self) -> String {
        self.content_hash.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_round_trips() {
        let json = serde_json::to_string(&Format::Epub).unwrap();
        assert_eq!(json, "\"epub\"");
        assert_eq!(serde_json::from_str::<Format>(&json).unwrap(), Format::Epub);
    }

    #[test]
    fn epub_marker_reports_format_and_hash() {
        let pubn = EpubPublication::from_bytes(b"PK\x03\x04 tiny epub bytes");
        assert_eq!(pubn.format(), Format::Epub);
        // blake3 hex is 64 lowercase hex chars, and is stable for the same bytes.
        let hash = pubn.content_hash();
        assert_eq!(hash.len(), 64);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(
            hash,
            EpubPublication::from_bytes(b"PK\x03\x04 tiny epub bytes").content_hash()
        );
    }

    #[test]
    fn clean_fixture_metadata_title() {
        let bytes = include_bytes!("../../tests/fixtures/clean.epub");
        let meta = EpubPublication::metadata_from_bytes(bytes);
        assert_eq!(meta.title, "Pillowtome Fixture");
    }
}
