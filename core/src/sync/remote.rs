//! Remote path hygiene — the **single point** every WebDAV path is born from
//! (T-07-00-01, ASVS V4/V5, 07-RESEARCH Pitfall 8). Any path derived from user
//! or server data (configured root, book titles/authors, device ids) is jailed
//! under the normalized root: `..`, absolute paths, drive letters, separators
//! inside segments, `/\:*?"<>|` and control chars are rejected here and only
//! here. Every built path is per-segment percent-encoded and never carries a
//! trailing slash.

use thiserror::Error;

pub use super::model::REMOTE_FORMAT;

/// Default remote root (D-104). The DB stores the human-readable `pillowtome/`
/// form; the wire form never has a trailing slash.
pub const DEFAULT_ROOT: &str = "pillowtome";

/// Characters forbidden inside any remote path segment (Windows + WebDAV
/// hostile set): `/ \ : * ? " < > |` plus all control chars.
const FORBIDDEN_SEGMENT_CHARS: &str = "/\\:*?\"<>|";

#[derive(Debug, Error, PartialEq)]
pub enum RemoteError {
    #[error("invalid remote root: {0:?}")]
    InvalidRoot(String),
    #[error("invalid remote path segment: {0:?}")]
    InvalidSegment(String),
}

/// Normalize the configured root to its wire form: trim, empty →
/// [`DEFAULT_ROOT`], strip trailing `/`, then jail it — reject leading `/`,
/// backslashes, drive-letter `:`, control chars, and any segment failing
/// [`sanitize_segment`] (which covers `..`, `.`, and nested empties).
pub fn normalize_root(root: &str) -> Result<String, RemoteError> {
    let trimmed = root.trim();
    if trimmed.is_empty() {
        return Ok(DEFAULT_ROOT.to_string());
    }
    let stripped = trimmed.trim_end_matches('/');
    if stripped.is_empty()
        || stripped.starts_with('/')
        || stripped.contains('\\')
        || stripped.contains(':')
        || stripped.chars().any(char::is_control)
    {
        return Err(RemoteError::InvalidRoot(root.to_string()));
    }
    for segment in stripped.split('/') {
        sanitize_segment(segment).map_err(|_| RemoteError::InvalidRoot(root.to_string()))?;
    }
    Ok(stripped.to_string())
}

/// Validate a single remote path segment. Rejects empty, `.`, `..`, any of
/// `/\:*?"<>|`, and control chars. Returns the segment unchanged on success.
pub fn sanitize_segment(seg: &str) -> Result<&str, RemoteError> {
    if seg.is_empty()
        || seg == "."
        || seg == ".."
        || seg
            .chars()
            .any(|c| c.is_control() || FORBIDDEN_SEGMENT_CHARS.contains(c))
    {
        return Err(RemoteError::InvalidSegment(seg.to_string()));
    }
    Ok(seg)
}

/// Hand-rolled RFC 3986 percent encoder (no new dependency): keeps the
/// unreserved set `A-Z a-z 0-9 -._~`, encodes every other UTF-8 byte as `%XX`
/// uppercase — covers CJK, space, `#`, `%`, `&`, `+`.
fn percent_encode_segment(seg: &str) -> String {
    let mut out = String::with_capacity(seg.len());
    for &b in seg.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char)
            }
            _ => {
                const HEX: &[u8; 16] = b"0123456789ABCDEF";
                out.push('%');
                out.push(HEX[(b >> 4) as usize] as char);
                out.push(HEX[(b & 0x0F) as usize] as char);
            }
        }
    }
    out
}

/// Join a root and segments into one remote path: normalize the root, sanitize
/// and percent-encode each segment, join with `/`. Never a trailing slash.
pub fn join_remote(root: &str, segments: &[&str]) -> Result<String, RemoteError> {
    let mut out = normalize_root(root)?;
    for seg in segments {
        let clean = sanitize_segment(seg)?;
        out.push('/');
        out.push_str(&percent_encode_segment(clean));
    }
    Ok(out)
}

/// Book-title component cleaning (D-105): **replace** forbidden/control chars
/// with `_` (never reject — titles may legally contain `:` etc. and rejection
/// would lose books), trim trailing dots/spaces (Windows-hostile endings),
/// fall back to `"untitled"` when nothing usable remains.
pub fn sanitize_book_component(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_control() || FORBIDDEN_SEGMENT_CHARS.contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim_end_matches(['.', ' ']);
    if trimmed.is_empty() {
        "untitled".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Human-readable book file name (D-105): `作者 - 书名.epub`, or
/// `作者 - 书名 [hash8].epub` on collision — `hash8` is the first 8 chars of
/// the blake3 work hash (work_id IS the blake3 content hash).
pub fn book_file_name(
    author: &str,
    title: &str,
    ext: &str,
    work_hash: &str,
    collision: bool,
) -> String {
    let author = sanitize_book_component(author);
    let title = sanitize_book_component(title);
    let ext = sanitize_book_component(ext);
    if collision {
        let hash8: String = work_hash.chars().take(8).collect();
        format!("{author} - {title} [{hash8}].{ext}")
    } else {
        format!("{author} - {title}.{ext}")
    }
}

/// `<root>/books/<作者 - 书名[.hash8].ext>` — percent-encoded on the wire.
pub fn book_remote_path(
    root: &str,
    author: &str,
    title: &str,
    ext: &str,
    work_hash: &str,
    collision: bool,
) -> Result<String, RemoteError> {
    let name = book_file_name(author, title, ext, work_hash, collision);
    join_remote(root, &["books", &name])
}

/// `<root>/state/<device_id>.json` — one device owns exactly one state file.
pub fn state_file_path(root: &str, device_id: &str) -> Result<String, RemoteError> {
    join_remote(root, &["state", &format!("{device_id}.json")])
}

/// `<root>/state/<device_id>.json.tmp-<nonce>` — temp-then-MOVE (Pitfall 5):
/// pushes write the temp name first, then MOVE onto the formal name; peers
/// only ever read the formal name. The nonce is supplied by the caller so this
/// function stays pure.
pub fn state_tmp_file_path(
    root: &str,
    device_id: &str,
    nonce: &str,
) -> Result<String, RemoteError> {
    join_remote(root, &["state", &format!("{device_id}.json.tmp-{nonce}")])
}

/// `<root>/devices/<device_id>.json` — device registry entry.
pub fn device_file_path(root: &str, device_id: &str) -> Result<String, RemoteError> {
    join_remote(root, &["devices", &format!("{device_id}.json")])
}

/// `<root>/manifest.json` — remote structure version marker.
pub fn manifest_path(root: &str) -> Result<String, RemoteError> {
    join_remote(root, &["manifest.json"])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every successfully built path is jailed: starts with the normalized
    /// root, contains no `..`, and has no trailing slash.
    fn assert_jailed(path: &str, root: &str) {
        let norm = normalize_root(root).unwrap();
        assert!(path.starts_with(&norm), "{path} not under {norm}");
        assert!(!path.contains(".."), "{path} contains ..");
        assert!(!path.ends_with('/'), "{path} has trailing slash");
    }

    #[test]
    fn root_normalization_defaults_and_strips_trailing_slash() {
        assert_eq!(normalize_root("").unwrap(), "pillowtome");
        assert_eq!(normalize_root("   ").unwrap(), "pillowtome");
        assert_eq!(normalize_root("pillowtome/").unwrap(), "pillowtome");
        assert_eq!(normalize_root("pillowtome///").unwrap(), "pillowtome");
        assert_eq!(normalize_root("dav/books").unwrap(), "dav/books");
        // The DB default literal normalizes to the wire form.
        assert_eq!(manifest_path("pillowtome/").unwrap(), "pillowtome/manifest.json");
    }

    #[test]
    fn root_injection_battery_is_rejected() {
        for bad in [
            "..",
            "../etc",
            "a/../b",
            "/etc",
            "/",
            "C:\\x",
            "a\\b",
            "con?trol",
            "a\u{0007}b",
            "a//b",
            "pillowtome/..",
        ] {
            assert!(
                matches!(normalize_root(bad), Err(RemoteError::InvalidRoot(_))),
                "root {bad:?} must be rejected"
            );
        }
    }

    #[test]
    fn segment_injection_battery_is_rejected() {
        for bad in [
            "", ".", "..", "a/b", "a\\b", "a:b", "a*b", "a?b", "a\"b", "a<b", "a>b",
            "a|b", "\u{0007}", "line\nbreak",
        ] {
            assert!(
                matches!(sanitize_segment(bad), Err(RemoteError::InvalidSegment(_))),
                "segment {bad:?} must be rejected"
            );
        }
        assert_eq!(sanitize_segment("manifest.json").unwrap(), "manifest.json");
        assert_eq!(sanitize_segment("作者 - 书名.epub").unwrap(), "作者 - 书名.epub");
    }

    #[test]
    fn join_remote_jails_and_encodes_per_segment() {
        let path = join_remote("pillowtome/", &["state", "dev-a.json"]).unwrap();
        assert_eq!(path, "pillowtome/state/dev-a.json");
        assert_jailed(&path, "pillowtome/");

        // Injection via a segment (not the root) is rejected at the same point.
        assert!(join_remote("pillowtome", &[".."]).is_err());
        assert!(join_remote("pillowtome", &["a/b"]).is_err());
        assert!(join_remote("pillowtome", &["a\\b"]).is_err());
        assert!(join_remote("pillowtome", &["/etc"]).is_err());

        // CJK, space, and the reserved punctuation set encode per segment.
        let encoded = join_remote("r", &["作者 - 书名.epub"]).unwrap();
        assert_eq!(
            encoded,
            "r/%E4%BD%9C%E8%80%85%20-%20%E4%B9%A6%E5%90%8D.epub"
        );
        let punct = join_remote("r", &["a#b%c&d+e f"]).unwrap();
        assert_eq!(punct, "r/a%23b%25c%26d%2Be%20f");
        // Unreserved set passes through untouched.
        let plain = join_remote("r", &["Az09-._~"]).unwrap();
        assert_eq!(plain, "r/Az09-._~");
    }

    #[test]
    fn book_names_are_human_readable_with_collision_suffix() {
        let hash = "abcdef0123456789ff00";
        assert_eq!(
            book_file_name("作者", "书名", "epub", hash, false),
            "作者 - 书名.epub"
        );
        assert_eq!(
            book_file_name("作者", "书名", "epub", hash, true),
            "作者 - 书名 [abcdef01].epub"
        );
        // Forbidden chars are replaced, never rejected (no book is lost).
        assert_eq!(
            book_file_name("A:B", "t/u*l", "pdf", hash, false),
            "A_B - t_u_l.pdf"
        );
        // Trailing dots/spaces trimmed; empty falls back to "untitled".
        assert_eq!(sanitize_book_component("name. "), "name");
        assert_eq!(sanitize_book_component(""), "untitled");
        assert_eq!(sanitize_book_component("..."), "untitled");

        let path = book_remote_path("pillowtome/", "作者", "书名", "epub", hash, false).unwrap();
        assert_eq!(
            path,
            "pillowtome/books/%E4%BD%9C%E8%80%85%20-%20%E4%B9%A6%E5%90%8D.epub"
        );
        assert_jailed(&path, "pillowtome/");
    }

    #[test]
    fn state_device_and_tmp_paths_follow_the_layout() {
        let state = state_file_path("pillowtome", "dev-a").unwrap();
        assert_eq!(state, "pillowtome/state/dev-a.json");
        let tmp = state_tmp_file_path("pillowtome", "dev-a", "nonce-1").unwrap();
        assert_eq!(tmp, "pillowtome/state/dev-a.json.tmp-nonce-1");
        let device = device_file_path("pillowtome", "dev-a").unwrap();
        assert_eq!(device, "pillowtome/devices/dev-a.json");
        for path in [state, tmp, device] {
            assert_jailed(&path, "pillowtome");
        }
    }

    #[test]
    fn remote_format_is_reexported_for_path_builders() {
        assert_eq!(REMOTE_FORMAT, 1);
    }
}
