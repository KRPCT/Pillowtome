//! DRM / corruption detect-and-refuse (plan 01-02, FND-04, D-10).
//!
//! [`detect_protection`] reads an EPUB (OCF zip) **read-only and never decrypts
//! anything**, classifying protection three ways so the app can refuse cleanly:
//!
//! - clean, DRM-free book                    -> [`Protection::None`]
//! - only fonts obfuscated (IDPF/Adobe algo) -> [`Protection::FontObfuscationOnly`]
//! - Adobe ADEPT / Kindle / unknown crypto   -> [`Protection::ContentDrm`]
//! - `encryption.xml` we can't reason about  -> [`Protection::Unknown`] (refuse)
//!
//! Malformed / truncated / hostile archives soft-fail with a typed
//! [`CoreError`] (never a panic, Pitfall 5). The `encryption.xml` present for
//! legitimate font obfuscation is deliberately distinguished from real content
//! DRM (Pitfall 4): misclassifying obfuscated-font books as DRM is a failure.

use std::io::{Cursor, Read};

use crate::error::CoreError;

/// Protection classification for an EPUB. This function only *classifies*; the
/// render layer decides UX (refuse-with-message or render) — both satisfy D-10.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Protection {
    /// No `encryption.xml` and no `rights.xml`: a plain, readable EPUB.
    None,
    /// `encryption.xml` obfuscates only font resources with a known IDPF/Adobe
    /// algorithm. Reversible, keyed off the EPUB's own uid — not content DRM.
    FontObfuscationOnly,
    /// Retailer content DRM (Adobe ADEPT, Kindle, or unknown content encryption).
    /// Carries the scheme name for the "unsupported" message. Refuse.
    ContentDrm(&'static str),
    /// An `encryption.xml` we cannot confidently reason about (missing method or
    /// a font-obfuscation algorithm applied to non-font resources). Refuse.
    Unknown,
}

/// IDPF and Adobe font-obfuscation algorithm identifiers. Presence of *only*
/// these, applied to font resources, is obfuscation — not DRM (Pitfall 4).
const FONT_OBFUSCATION_ALGOS: &[&str] = &[
    "http://www.idpf.org/2008/embedding", // IDPF font obfuscation
    "http://ns.adobe.com/pdf/enc#RC",     // Adobe font mangling
];

/// Detect DRM/corruption in EPUB bytes without ever decrypting (D-10).
///
/// Reads the archive read-only. A bad/truncated zip or an EPUB missing
/// `META-INF/container.xml` soft-fails as [`CoreError::Corrupt`]. A Kindle
/// (PalmDB/MOBI) container is refused. Archives containing zip-slip entries
/// (`..`/absolute paths) are rejected even on this read-only path (T-01-04).
pub fn detect_protection(epub_bytes: &[u8]) -> Result<Protection, CoreError> {
    // A Kindle container is not a zip; catch it by magic before the zip parse so
    // it is refused rather than reported as generic corruption.
    if is_kindle(epub_bytes) {
        return Ok(Protection::ContentDrm("Kindle"));
    }

    let mut zip = zip::ZipArchive::new(Cursor::new(epub_bytes))
        // Bad / truncated zip -> soft-fail (Pitfall 5). Never panic.
        .map_err(|_| CoreError::Corrupt)?;

    // Zip-slip guard (T-01-04): reject any entry whose normalized path escapes the
    // archive root or is absolute, even though we only read here — a hostile name
    // must never survive to a later extraction path.
    for i in 0..zip.len() {
        let entry = zip.by_index(i).map_err(|_| CoreError::Corrupt)?;
        if entry.enclosed_name().is_none() {
            return Err(CoreError::Corrupt);
        }
    }

    // A valid OCF must carry its container manifest; missing it means the file is
    // not a usable EPUB -> soft-fail rather than silently classifying it clean.
    if zip.by_name("META-INF/container.xml").is_err() {
        return Err(CoreError::Corrupt);
    }

    // Adobe ADEPT marker takes precedence over any encryption.xml.
    if zip.by_name("META-INF/rights.xml").is_ok() {
        return Ok(Protection::ContentDrm("Adobe ADEPT"));
    }

    // No rights.xml: the three-case encryption.xml decision (Pitfall 4).
    match read_entry(&mut zip, "META-INF/encryption.xml")? {
        None => Ok(Protection::None), // no encryption.xml -> plaintext
        Some(xml) => Ok(classify_encryption(&xml)),
    }
}

/// Read a named archive entry into an owned `String`, or `None` if it is absent.
/// Returning an owned value releases the archive borrow at the call site.
fn read_entry<R: Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
) -> Result<Option<String>, CoreError> {
    match zip.by_name(name) {
        Err(_) => Ok(None),
        Ok(mut f) => {
            let mut s = String::new();
            f.read_to_string(&mut s).map_err(|_| CoreError::Corrupt)?;
            Ok(Some(s))
        }
    }
}

/// Classify a `META-INF/encryption.xml` body by algorithm and target resources.
///
/// Every `EncryptionMethod/@Algorithm` must be a known font-obfuscation algorithm
/// AND every `CipherReference/@URI` must point at a font for the book to count as
/// [`Protection::FontObfuscationOnly`]. Any unknown/retailer algorithm is content
/// DRM; anything else (no method, or obfuscation applied to non-font resources)
/// is [`Protection::Unknown`] and refused.
fn classify_encryption(xml: &str) -> Protection {
    let algorithms = attr_values(xml, "Algorithm");
    if algorithms.is_empty() {
        return Protection::Unknown; // encryption.xml with no method -> ambiguous
    }

    let all_font_algo = algorithms
        .iter()
        .all(|a| FONT_OBFUSCATION_ALGOS.contains(&a.as_str()));
    if !all_font_algo {
        // An unknown / retailer algorithm encrypts a resource -> content DRM.
        return Protection::ContentDrm("Encrypted content");
    }

    let refs = attr_values(xml, "URI");
    if !refs.is_empty() && refs.iter().all(|u| is_font_path(u)) {
        Protection::FontObfuscationOnly
    } else {
        // Font-obfuscation algorithm pointed at non-font (or unspecified)
        // resources is suspicious -> refuse rather than assume readable.
        Protection::Unknown
    }
}

/// Collect every `key="value"` attribute value for `key` via a small, dependency-
/// free scan (we deliberately add no XML parser to keep the crate lean and the
/// supply-chain surface minimal — the markers we read are simple attributes).
fn attr_values(xml: &str, key: &str) -> Vec<String> {
    let needle = format!("{key}=\"");
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find(&needle) {
        let after = &rest[start + needle.len()..];
        if let Some(end) = after.find('"') {
            out.push(after[..end].to_string());
            rest = &after[end + 1..];
        } else {
            break;
        }
    }
    out
}

/// Whether a cipher-reference path targets an embedded font resource.
fn is_font_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".ttf")
        || lower.ends_with(".otf")
        || lower.ends_with(".ttc")
        || lower.ends_with(".woff")
        || lower.ends_with(".woff2")
        || lower.ends_with(".dfont")
}

/// Detect a Kindle (PalmDB/MOBI/Topaz) container by magic bytes. These are not
/// EPUB zips; the PalmDB header stores the type/creator at offset 60.
fn is_kindle(bytes: &[u8]) -> bool {
    if bytes.len() >= 68 && &bytes[60..68] == b"BOOKMOBI" {
        return true; // MOBI / AZW / KF8
    }
    if bytes.len() >= 63 && &bytes[60..63] == b"TPZ" {
        return true; // Topaz (.azw1)
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_idpf_font_obfuscation() {
        let xml = r#"<encryption><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
            <CipherReference URI="OEBPS/fonts/x.ttf"/></encryption>"#;
        assert_eq!(classify_encryption(xml), Protection::FontObfuscationOnly);
    }

    #[test]
    fn unknown_algorithm_is_content_drm() {
        let xml = r#"<EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"/>
            <CipherReference URI="OEBPS/section1.xhtml"/>"#;
        assert!(matches!(
            classify_encryption(xml),
            Protection::ContentDrm(_)
        ));
    }

    #[test]
    fn font_algo_on_content_is_unknown() {
        // Font-obfuscation algorithm applied to a content document, not a font.
        let xml = r#"<EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
            <CipherReference URI="OEBPS/section1.xhtml"/>"#;
        assert_eq!(classify_encryption(xml), Protection::Unknown);
    }

    #[test]
    fn empty_encryption_is_unknown() {
        assert_eq!(classify_encryption("<encryption/>"), Protection::Unknown);
    }
}
