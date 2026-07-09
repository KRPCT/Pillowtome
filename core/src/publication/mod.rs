//! Publication model (seam stub).
//!
//! Filled by plan 01-03 (D-07): a `Publication` trait (per-format
//! metadata/cover/TOC/spine/content-hash) plus a `Format` enum. EPUB is the
//! only implementor in P1; the seam keeps TXT/MOBI/PDF purely additive.

use serde::{Deserialize, Serialize};

/// Book container format.
///
/// EPUB is the only P1 implementor (D-07). `Txt`/`Mobi`/`Pdf` are deliberately
/// reserved — added by later phases (P6) so new formats are additive against
/// this seam rather than a late refactor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    /// EPUB (OCF/zip) — the only format rendered in P1.
    Epub,
    // Txt, Mobi, Pdf — reserved for Phase 6; not implemented in P1 (D-07).
}

/// A format-agnostic publication.
///
/// P1 exposes only the two seam methods every format must answer: its
/// [`Format`] and a stable content hash for dedup/identity (D-09). Heavier
/// metadata/cover/TOC/spine extraction lands in Phase 4 and is intentionally
/// **not** part of this trait yet — keeping the seam minimal is the whole
/// anti-refactor game.
pub trait Publication {
    /// The container format of this publication.
    fn format(&self) -> Format;

    /// Stable content hash (blake3 hex) of the raw book bytes, used for
    /// deduplication and later KOReader-style document identity (D-09).
    fn content_hash(&self) -> String;
}

/// Minimal EPUB implementor — the only [`Publication`] in P1 (D-07).
///
/// It is a marker carrying the precomputed content hash; real EPUB
/// metadata/cover/TOC extraction is deferred to Phase 4. No parsing happens
/// here beyond hashing the bytes.
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
        assert_eq!(hash, EpubPublication::from_bytes(b"PK\x03\x04 tiny epub bytes").content_hash());
    }
}
