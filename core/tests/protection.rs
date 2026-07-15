//! Off-device unit tests for the DRM/corruption detector (FND-04, D-10).
//!
//! One test per behavior row in plan 01-02. The detector reads the EPUB zip
//! read-only and NEVER decrypts anything; these fixtures carry only structural
//! markers, no keys or ciphertext. See `fixtures/README.md`.

use pillowtome_core::error::CoreError;
use pillowtome_core::protection::{detect_protection, Protection};

const CLEAN: &[u8] = include_bytes!("fixtures/clean.epub");
const ADEPT: &[u8] = include_bytes!("fixtures/adept.epub");
const FONT_OBFUSCATED: &[u8] = include_bytes!("fixtures/font-obfuscated.epub");
const CORRUPT: &[u8] = include_bytes!("fixtures/corrupt.epub");

#[test]
fn clean_epub_is_unprotected() {
    assert!(matches!(detect_protection(CLEAN), Ok(Protection::None)));
}

#[test]
fn detects_adept() {
    match detect_protection(ADEPT) {
        Ok(Protection::ContentDrm(scheme)) => assert_eq!(scheme, "Adobe ADEPT"),
        other => panic!("expected Adobe ADEPT content DRM, got {other:?}"),
    }
}

#[test]
fn font_obfuscation_is_not_drm() {
    // Pitfall 4: encryption.xml is present but only obfuscates a font — readable.
    assert!(matches!(
        detect_protection(FONT_OBFUSCATED),
        Ok(Protection::FontObfuscationOnly)
    ));
}

#[test]
fn corrupt_zip_soft_fails() {
    // Pitfall 5: a truncated/garbage archive returns a typed error, never a panic.
    assert!(matches!(detect_protection(CORRUPT), Err(CoreError::Corrupt)));
}

#[test]
fn kindle_blob_is_refused() {
    // A PalmDB/MOBI container carries "BOOKMOBI" at offset 60 and is not an EPUB zip.
    let mut blob = vec![0u8; 68];
    blob[60..68].copy_from_slice(b"BOOKMOBI");
    match detect_protection(&blob) {
        Ok(Protection::ContentDrm("Kindle")) | Err(CoreError::Unsupported) => {}
        other => panic!("expected Kindle refusal, got {other:?}"),
    }
}

#[test]
fn zip_slip_entry_is_rejected() {
    // A hostile archive whose entry escapes the root must be rejected even on the
    // read-only detect path (threat T-01-04), not silently classified.
    let bytes = zip_with_entry("../evil", b"pwned");
    assert!(matches!(detect_protection(&bytes), Err(CoreError::Corrupt)));
}

#[test]
fn oversized_encryption_xml_soft_fails() {
    // A decompression bomb: the entry is a few KB on disk but inflates far past the
    // control-file cap. `zip` bounds only the compressed input, so an unbounded read
    // would allocate the whole decompressed size — an OOM abort that no `Result` can
    // catch. Must soft-fail like any other malformed archive (Pitfall 5).
    let bomb = vec![b'A'; 4 * 1024 * 1024];
    let bytes = deflated_zip(&[("META-INF/container.xml", b"<container/>"), ("META-INF/encryption.xml", &bomb)]);
    assert!(bytes.len() < 64 * 1024, "fixture should stay small on disk");
    assert!(matches!(detect_protection(&bytes), Err(CoreError::Corrupt)));
}

/// Build a minimal in-memory zip containing a single entry with the given name.
fn zip_with_entry(name: &str, data: &[u8]) -> Vec<u8> {
    use std::io::Write;
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut zw = zip::ZipWriter::new(&mut buf);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zw.start_file(name, opts).expect("start entry");
        zw.write_all(data).expect("write entry");
        zw.finish().expect("finish zip");
    }
    buf.into_inner()
}

/// Build an in-memory DEFLATE zip, so highly compressible entries stay tiny on disk.
fn deflated_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    use std::io::Write;
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut zw = zip::ZipWriter::new(&mut buf);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in entries {
            zw.start_file(*name, opts).expect("start entry");
            zw.write_all(data).expect("write entry");
        }
        zw.finish().expect("finish zip");
    }
    buf.into_inner()
}
