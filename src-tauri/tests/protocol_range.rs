//! Integration test for the `pillow://` range/registry path.
//!
//! Two layers, both without a running WebView:
//!  1. `parse_range` range math -> 200 / 206 / 416.
//!  2. A TEMP fixture registered in a `SourceRegistry` is served end to end
//!     (200 full + 206 range), proving the registry -> protocol plumbing.
//!
//! The fixture is independent of the bundled `sample.epub` (which arrives in
//! Plan 04), so this test does not depend on that file existing.

use std::io::Write;

use pillowtome_lib::protocol::{parse_range, serve, RangeResolution};
use pillowtome_lib::storage::SourceRegistry;

#[test]
fn parse_range_no_header_serves_full() {
    assert_eq!(parse_range(None, 1000), RangeResolution::Full { len: 1000 });
}

#[test]
fn parse_range_bytes_0_99_is_partial() {
    assert_eq!(
        parse_range(Some("bytes=0-99"), 1000),
        RangeResolution::Partial {
            start: 0,
            end: 99,
            total: 1000
        }
    );
}

#[test]
fn parse_range_out_of_range_is_unsatisfiable() {
    assert_eq!(
        parse_range(Some("bytes=2000-3000"), 1000),
        RangeResolution::Unsatisfiable { total: 1000 }
    );
}

#[test]
fn registry_serves_full_and_range() {
    // TEMP fixture — 1000 deterministic bytes.
    let dir = std::env::temp_dir().join(format!("pillow_it_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("fixture.bin");
    let data: Vec<u8> = (0..1000u32).map(|i| (i % 256) as u8).collect();
    std::fs::File::create(&file)
        .unwrap()
        .write_all(&data)
        .unwrap();

    let registry = SourceRegistry::new();
    registry.register("fixture", file.clone());

    // Full request -> 200 with the entire body.
    let full = serve(&registry, "/fixture", None);
    assert_eq!(full.status().as_u16(), 200);
    assert_eq!(full.body().len(), 1000);

    // Range request -> 206 with the requested slice + Content-Range.
    let partial = serve(&registry, "/fixture", Some("bytes=0-99"));
    assert_eq!(partial.status().as_u16(), 206);
    assert_eq!(partial.body().len(), 100);
    assert_eq!(
        partial
            .headers()
            .get("content-range")
            .and_then(|v| v.to_str().ok()),
        Some("bytes 0-99/1000")
    );

    // Unsatisfiable range -> 416.
    let unsat = serve(&registry, "/fixture", Some("bytes=5000-6000"));
    assert_eq!(unsat.status().as_u16(), 416);

    // Unknown id -> 404 (scope guard: only registry ids resolve).
    assert_eq!(serve(&registry, "/nope", None).status().as_u16(), 404);

    // Traversal attempt -> 404 (threat T-01-01: never an arbitrary path).
    assert_eq!(serve(&registry, "/../secret", None).status().as_u16(), 404);

    let _ = std::fs::remove_dir_all(&dir);
}

/// The WebView never shares an origin with `pillow://` — dev serves the page
/// from `http://localhost:1420`, release from `tauri.localhost`. Without CORS
/// the browser blocks `fetch` before the status is observable and the reader
/// shows an opaque "corrupt file" error. Regression guard: every response,
/// including the error statuses, must carry the headers.
#[test]
fn every_response_carries_cors() {
    let dir = std::env::temp_dir().join(format!("pillow_cors_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("fixture.bin");
    std::fs::File::create(&file).unwrap().write_all(&[0u8; 64]).unwrap();

    let registry = SourceRegistry::new();
    registry.register("fixture", file);

    let responses = [
        serve(&registry, "/fixture", None),                    // 200
        serve(&registry, "/fixture", Some("bytes=0-9")),       // 206
        serve(&registry, "/fixture", Some("bytes=500-600")),   // 416
        serve(&registry, "/nope", None),                       // 404
        serve(&registry, "/../secret", None),                  // 404
    ];

    for res in responses {
        let headers = res.headers();
        assert_eq!(
            headers
                .get("access-control-allow-origin")
                .and_then(|v| v.to_str().ok()),
            Some("*"),
            "missing Access-Control-Allow-Origin on {}",
            res.status()
        );
        let exposed = headers
            .get("access-control-expose-headers")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();
        for h in ["Accept-Ranges", "Content-Range", "Content-Length"] {
            assert!(exposed.contains(h), "{h} not exposed on {}", res.status());
        }
    }

    let _ = std::fs::remove_dir_all(&dir);
}
