//! Range-aware `pillow://` byte streamer.
//!
//! Book bytes reach the WebView only through this custom protocol, never over
//! Tauri IPC (D-06). The handler answers HTTP Range requests with `200`
//! (full body), `206 Partial Content`, or `416` (unsatisfiable), capping each
//! served slice at [`MAX_LEN`] to match the official streaming example.
//!
//! The range math lives in the pure [`parse_range`] helper so it is
//! unit-testable without a running WebView; [`serve`] wires it to the
//! [`SourceRegistry`] and the filesystem.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

use tauri::http::{header, HeaderValue, Response, StatusCode};

use crate::storage::{sanitize_id, SourceRegistry};

/// Cap each served range at 1 MiB, matching `examples/streaming` upstream.
pub const MAX_LEN: u64 = 1024 * 1024;

/// Headers the WebView must be allowed to read off a cross-origin response.
const EXPOSED_HEADERS: &str = "Accept-Ranges, Content-Range, Content-Length";

/// Attach CORS headers to every `pillow://` response.
///
/// The WebView never shares an origin with this protocol: in dev the page is
/// served by the Vite dev server (`http://localhost:1420`), and in a release
/// build it is `tauri.localhost` — while book bytes come from
/// `pillow.localhost` (Windows/Android) or `pillow://localhost`. Without
/// `Access-Control-Allow-Origin` the browser blocks `fetch` before our handler's
/// status is ever observable, so the reader sees an opaque failure. Tauri's own
/// `asset:` protocol does exactly this.
///
/// `*` is safe here because [`serve`] resolves ids **only** through the
/// `SourceRegistry` and rejects traversal (threat T-01-01) — there is no
/// attacker-reachable path surface to widen.
fn cors(mut response: Response<Vec<u8>>) -> Response<Vec<u8>> {
    let headers = response.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static(EXPOSED_HEADERS),
    );
    response
}

/// Pure result of resolving a `Range` header against a known content length.
#[derive(Debug, PartialEq, Eq)]
pub enum RangeResolution {
    /// No usable Range header -> serve the whole body (HTTP 200).
    Full { len: u64 },
    /// Satisfiable range -> HTTP 206, inclusive `start..=end`, capped to MAX_LEN.
    Partial { start: u64, end: u64, total: u64 },
    /// Unsatisfiable range -> HTTP 416.
    Unsatisfiable { total: u64 },
}

/// Parse an HTTP `Range` header value against `total_len`.
///
/// Pure and unit-testable without a WebView. Handles a single `bytes=start-end`,
/// open-ended `bytes=start-`, and suffix `bytes=-N` forms; for a comma list only
/// the first range is honored (P1 scope — foliate issues single ranges).
pub fn parse_range(header: Option<&str>, total_len: u64) -> RangeResolution {
    let Some(raw) = header else {
        return RangeResolution::Full { len: total_len };
    };
    let Some(spec) = raw.trim().strip_prefix("bytes=") else {
        return RangeResolution::Full { len: total_len };
    };
    let first = spec.split(',').next().unwrap_or("").trim();
    let Some((s, e)) = first.split_once('-') else {
        return RangeResolution::Full { len: total_len };
    };

    if total_len == 0 {
        return RangeResolution::Unsatisfiable { total: total_len };
    }

    let (start, end) = if s.is_empty() {
        // Suffix form: bytes=-N -> the last N bytes.
        let n: u64 = match e.parse() {
            Ok(n) if n > 0 => n,
            _ => return RangeResolution::Unsatisfiable { total: total_len },
        };
        let n = n.min(total_len);
        (total_len - n, total_len - 1)
    } else {
        let start: u64 = match s.parse() {
            Ok(v) => v,
            Err(_) => return RangeResolution::Full { len: total_len },
        };
        if start >= total_len {
            return RangeResolution::Unsatisfiable { total: total_len };
        }
        let end = if e.is_empty() {
            total_len - 1
        } else {
            match e.parse::<u64>() {
                Ok(v) => v.min(total_len - 1),
                Err(_) => total_len - 1,
            }
        };
        (start, end)
    };

    if end < start {
        return RangeResolution::Unsatisfiable { total: total_len };
    }
    let end = end.min(start + MAX_LEN - 1);
    RangeResolution::Partial { start, end, total: total_len }
}

/// Build the HTTP response for `raw_path` given an optional `Range` header,
/// reading only the requested slice from disk.
///
/// Resolves ids **only** through `registry` (never a caller-supplied path) — the
/// scope guard for threat T-01-01. Unknown ids and rejected paths return `404`.
pub fn serve(
    registry: &SourceRegistry,
    raw_path: &str,
    range_header: Option<&str>,
) -> Response<Vec<u8>> {
    let Some(id) = sanitize_id(raw_path) else {
        return status_only(StatusCode::NOT_FOUND);
    };
    let Some(path) = registry.resolve(&id) else {
        return status_only(StatusCode::NOT_FOUND);
    };
    let Ok(mut file) = File::open(&path) else {
        return status_only(StatusCode::NOT_FOUND);
    };
    let total_len = match file.metadata() {
        Ok(m) => m.len(),
        Err(_) => return status_only(StatusCode::INTERNAL_SERVER_ERROR),
    };

    cors(match parse_range(range_header, total_len) {
        RangeResolution::Full { len } => {
            let mut buf = Vec::with_capacity(len as usize);
            if file.read_to_end(&mut buf).is_err() {
                return status_only(StatusCode::INTERNAL_SERVER_ERROR);
            }
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/octet-stream")
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_LENGTH, len)
                .body(buf)
                .unwrap()
        }
        RangeResolution::Partial { start, end, total } => {
            let count = end - start + 1;
            let mut buf = vec![0u8; count as usize];
            if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut buf).is_err() {
                return status_only(StatusCode::INTERNAL_SERVER_ERROR);
            }
            Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, "application/octet-stream")
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
                .header(header::CONTENT_LENGTH, count)
                .body(buf)
                .unwrap()
        }
        RangeResolution::Unsatisfiable { total } => Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{total}"))
            .body(Vec::new())
            .unwrap(),
    })
}

fn status_only(status: StatusCode) -> Response<Vec<u8>> {
    cors(Response::builder().status(status).body(Vec::new()).unwrap())
}
