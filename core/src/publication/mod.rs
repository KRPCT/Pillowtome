//! Publication model (seam stub).
//!
//! Filled by plan 01-03 (D-07): a `Publication` trait (per-format
//! metadata/cover/TOC/spine/content-hash) plus a `Format` enum. EPUB is the
//! only implementor in P1; the seam keeps TXT/MOBI/PDF purely additive.

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
