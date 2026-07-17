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

use pillowtome_core::source::BookSource;
use tauri::http::{header, HeaderValue, Response, StatusCode};

use crate::fonts::{font_content_type, resolve_font_path};
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

/// Parse a fonts path: `/fonts/{id}` or `fonts/{id}` → font id (D-30 / T-02-path).
///
/// Rejects nested paths, empty ids, and anything that is not exactly one segment
/// under `fonts/`. Does **not** resolve the file — only extracts the id token.
pub fn parse_font_path(raw_path: &str) -> Option<String> {
    // convertFileSrc percent-encodes the `/` in `fonts/{id}` as `%2F`; normalize
    // it back so the bundled/custom face actually resolves (was masked by system
    // CJK fallback when it 404'd).
    let decoded = raw_path.replace("%2F", "/").replace("%2f", "/");
    let path = decoded.trim_start_matches('/');
    let rest = path.strip_prefix("fonts/")?;
    // Exactly one segment; reject `fonts/`, `fonts/a/b`, separators, `..`.
    if rest.is_empty() || rest.contains('/') || rest.contains('\\') || rest.contains("..") {
        return None;
    }
    // Strip accidental extension in the URL (`fonts/{id}.ttf`) — id is stem only.
    let id = rest.split('.').next().unwrap_or(rest);
    if id.is_empty() || id.contains("..") {
        return None;
    }
    Some(id.to_string())
}

/// Parse a cover path: `/covers/{name}` or `covers/{name}` → the file name.
///
/// One segment only (`{work_id}.{ext}`); rejects nested paths, separators, and
/// `..`. Does not touch the filesystem — only extracts the confined name token.
pub fn parse_cover_path(raw_path: &str) -> Option<String> {
    // convertFileSrc percent-encodes the `/` in `covers/{name}` as `%2F`, and the
    // WebView request path is not auto-decoded — normalize it back to `/`.
    let decoded = raw_path.replace("%2F", "/").replace("%2f", "/");
    let path = decoded.trim_start_matches('/');
    let rest = path.strip_prefix("covers/")?;
    if rest.is_empty()
        || rest.contains('/')
        || rest.contains('\\')
        || rest.contains("..")
        || rest.contains('%')
    {
        return None;
    }
    Some(rest.to_string())
}

/// Serve a library cover from `app_data_dir/covers` only (LIB-cover, T-02-path).
///
/// Small image files (covers dir is written by the Rust ingest). Path-confined to
/// a single safe segment; CORS + image Content-Type so `<img>` can render it.
pub fn serve_cover(
    covers_dir: Option<&std::path::Path>,
    name: &str,
    range_header: Option<&str>,
) -> Response<Vec<u8>> {
    let Some(dir) = covers_dir else {
        return status_only(StatusCode::NOT_FOUND);
    };
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return status_only(StatusCode::NOT_FOUND);
    }
    let path = dir.join(name);
    let Ok(mut file) = File::open(&path) else {
        return status_only(StatusCode::NOT_FOUND);
    };
    let total_len = match file.metadata() {
        Ok(m) => m.len(),
        Err(_) => return status_only(StatusCode::INTERNAL_SERVER_ERROR),
    };
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let ctype = cover_content_type(ext);

    cors(match parse_range(range_header, total_len) {
        RangeResolution::Full { len } => {
            let mut buf = Vec::with_capacity(len as usize);
            if file.read_to_end(&mut buf).is_err() {
                return status_only(StatusCode::INTERNAL_SERVER_ERROR);
            }
            full_response_typed(buf, ctype)
        }
        RangeResolution::Partial { start, end, total } => {
            let count = end - start + 1;
            let mut buf = vec![0u8; count as usize];
            if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut buf).is_err() {
                return status_only(StatusCode::INTERNAL_SERVER_ERROR);
            }
            partial_response_typed(buf, start, end, total, ctype)
        }
        RangeResolution::Unsatisfiable { total } => unsatisfiable_response(total),
    })
}

fn cover_content_type(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

/// Serve a custom font from `app_data_dir/fonts` only (D-30, T-02-path).
///
/// Does **not** use [`SourceRegistry`]. Path is confined via
/// [`resolve_font_path`] (canonicalize under fonts_dir). CORS + font Content-Type.
pub fn serve_font(
    fonts_dir: Option<&std::path::Path>,
    font_id: &str,
    range_header: Option<&str>,
) -> Response<Vec<u8>> {
    let Some(dir) = fonts_dir else {
        return status_only(StatusCode::NOT_FOUND);
    };
    let Some(path) = resolve_font_path(dir, font_id) else {
        return status_only(StatusCode::NOT_FOUND);
    };
    let Ok(mut file) = File::open(&path) else {
        return status_only(StatusCode::NOT_FOUND);
    };
    let total_len = match file.metadata() {
        Ok(m) => m.len(),
        Err(_) => return status_only(StatusCode::INTERNAL_SERVER_ERROR),
    };
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    let ctype = font_content_type(ext);

    cors(match parse_range(range_header, total_len) {
        RangeResolution::Full { len } => {
            let mut buf = Vec::with_capacity(len as usize);
            if file.read_to_end(&mut buf).is_err() {
                return status_only(StatusCode::INTERNAL_SERVER_ERROR);
            }
            full_response_typed(buf, ctype)
        }
        RangeResolution::Partial { start, end, total } => {
            let count = end - start + 1;
            let mut buf = vec![0u8; count as usize];
            if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut buf).is_err() {
                return status_only(StatusCode::INTERNAL_SERVER_ERROR);
            }
            partial_response_typed(buf, start, end, total, ctype)
        }
        RangeResolution::Unsatisfiable { total } => unsatisfiable_response(total),
    })
}

/// Build the HTTP response for `raw_path` given an optional `Range` header,
/// reading only the requested slice from disk.
///
/// Resolves ids **only** through `registry` (never a caller-supplied path) — the
/// scope guard for threat T-01-01. Unknown ids and rejected paths return `404`.
///
/// Font requests (`/fonts/{id}`) are handled separately by [`serve_font`].
pub fn serve(
    registry: &SourceRegistry,
    raw_path: &str,
    range_header: Option<&str>,
) -> Response<Vec<u8>> {
    let Some(id) = sanitize_id(raw_path) else {
        return status_only(StatusCode::NOT_FOUND);
    };
    // `content://` handles are read in the protocol closure (they need the app
    // handle to reach the SAF plugin); only `Path` streams from disk here.
    let Some(BookSource::Path(path)) = registry.resolve(&id) else {
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
            full_response(buf)
        }
        RangeResolution::Partial { start, end, total } => {
            let count = end - start + 1;
            let mut buf = vec![0u8; count as usize];
            if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut buf).is_err() {
                return status_only(StatusCode::INTERNAL_SERVER_ERROR);
            }
            partial_response(buf, start, end, total)
        }
        RangeResolution::Unsatisfiable { total } => unsatisfiable_response(total),
    })
}

/// Serve already-read bytes with the same Range/CORS semantics as [`serve`].
///
/// This backs the Android `content://` path: the SAF plugin reads the file into
/// memory **in Rust** (D-06) and the bytes are then sliced here per the request's
/// Range header. Pure and unit-testable without a WebView or a device.
pub fn serve_bytes(bytes: Vec<u8>, range_header: Option<&str>) -> Response<Vec<u8>> {
    let total_len = bytes.len() as u64;
    cors(match parse_range(range_header, total_len) {
        RangeResolution::Full { .. } => full_response(bytes),
        RangeResolution::Partial { start, end, total } => {
            let slice = bytes[start as usize..=end as usize].to_vec();
            partial_response(slice, start, end, total)
        }
        RangeResolution::Unsatisfiable { total } => unsatisfiable_response(total),
    })
}

/// Read a SAF `content://` book via the Android FS plugin and serve it (Android).
///
/// Bytes are read in Rust and streamed over `pillow://` — they never cross IPC
/// (D-06). Reads the whole file (P1 books are small); Range is applied in memory.
#[cfg(target_os = "android")]
pub fn serve_content_uri<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    uri: &str,
    range_header: Option<&str>,
) -> Response<Vec<u8>> {
    use tauri_plugin_android_fs::{AndroidFsExt, FileUri};

    match app.android_fs().read(&FileUri::from_uri(uri)) {
        Ok(bytes) => serve_bytes(bytes, range_header),
        Err(_) => status_only(StatusCode::NOT_FOUND),
    }
}

fn full_response(body: Vec<u8>) -> Response<Vec<u8>> {
    full_response_typed(body, "application/octet-stream")
}

fn full_response_typed(body: Vec<u8>, content_type: &str) -> Response<Vec<u8>> {
    let len = body.len() as u64;
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, len)
        .body(body)
        .unwrap()
}

fn partial_response(body: Vec<u8>, start: u64, end: u64, total: u64) -> Response<Vec<u8>> {
    partial_response_typed(body, start, end, total, "application/octet-stream")
}

fn partial_response_typed(
    body: Vec<u8>,
    start: u64,
    end: u64,
    total: u64,
    content_type: &str,
) -> Response<Vec<u8>> {
    let count = end - start + 1;
    Response::builder()
        .status(StatusCode::PARTIAL_CONTENT)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
        .header(header::CONTENT_LENGTH, count)
        .body(body)
        .unwrap()
}

fn unsatisfiable_response(total: u64) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::RANGE_NOT_SATISFIABLE)
        .header(header::CONTENT_RANGE, format!("bytes */{total}"))
        .body(Vec::new())
        .unwrap()
}

fn status_only(status: StatusCode) -> Response<Vec<u8>> {
    cors(Response::builder().status(status).body(Vec::new()).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The Android `content://` path reads bytes in Rust (D-06) and serves them
    /// from memory. `serve_bytes` must honour Range exactly like the file path,
    /// including CORS on every response.
    #[test]
    fn serve_bytes_honors_range_and_cors() {
        let data: Vec<u8> = (0..100u8).collect();

        let full = serve_bytes(data.clone(), None);
        assert_eq!(full.status().as_u16(), 200);
        assert_eq!(full.body().len(), 100);
        assert_eq!(
            full.headers()
                .get("access-control-allow-origin")
                .and_then(|v| v.to_str().ok()),
            Some("*")
        );

        let partial = serve_bytes(data.clone(), Some("bytes=0-9"));
        assert_eq!(partial.status().as_u16(), 206);
        assert_eq!(partial.body().len(), 10);
        assert_eq!(
            partial
                .headers()
                .get("content-range")
                .and_then(|v| v.to_str().ok()),
            Some("bytes 0-9/100")
        );

        let unsat = serve_bytes(data, Some("bytes=500-600"));
        assert_eq!(unsat.status().as_u16(), 416);
    }

    #[test]
    fn parse_font_path_accepts_flat_id() {
        assert_eq!(parse_font_path("/fonts/fabc"), Some("fabc".into()));
        assert_eq!(parse_font_path("fonts/fabc"), Some("fabc".into()));
        assert_eq!(parse_font_path("/fonts/fabc.ttf"), Some("fabc".into()));
        assert_eq!(parse_font_path("/fonts%2Ffabc"), Some("fabc".into()));
    }

    #[test]
    fn parse_font_path_rejects_traversal() {
        assert_eq!(parse_font_path("/fonts/../etc"), None);
        assert_eq!(parse_font_path("/fonts/a/b"), None);
        assert_eq!(parse_font_path("/fonts/"), None);
        assert_eq!(parse_font_path("/sample"), None);
        assert_eq!(parse_font_path("/fonts/a\\b"), None);
    }

    #[test]
    fn parse_cover_path_accepts_flat_name_rejects_traversal() {
        assert_eq!(parse_cover_path("/covers/abc123.jpg"), Some("abc123.jpg".into()));
        assert_eq!(parse_cover_path("covers/def.png"), Some("def.png".into()));
        // convertFileSrc encodes the slash as %2F — must normalize it back.
        assert_eq!(parse_cover_path("/covers%2Fabc123.png"), Some("abc123.png".into()));
        assert_eq!(parse_cover_path("/covers%2f..%2fetc"), None);
        assert_eq!(parse_cover_path("/covers/../etc"), None);
        assert_eq!(parse_cover_path("/covers/a/b.jpg"), None);
        assert_eq!(parse_cover_path("/covers/"), None);
        assert_eq!(parse_cover_path("/fonts/x"), None);
        assert_eq!(parse_cover_path("/sample"), None);
    }

    #[test]
    fn serve_cover_missing_is_404_with_cors() {
        let resp = serve_cover(None, "missing.jpg", None);
        assert_eq!(resp.status().as_u16(), 404);
        assert_eq!(
            resp.headers()
                .get("access-control-allow-origin")
                .and_then(|v| v.to_str().ok()),
            Some("*")
        );
    }

    #[test]
    fn serve_font_missing_is_404_with_cors() {
        let resp = serve_font(None, "missing", None);
        assert_eq!(resp.status().as_u16(), 404);
        assert_eq!(
            resp.headers()
                .get("access-control-allow-origin")
                .and_then(|v| v.to_str().ok()),
            Some("*")
        );
    }
}
