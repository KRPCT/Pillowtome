//! Pure EPUB OPF metadata + cover extraction (Phase 4 / LIB-03).
//!
//! No Tauri / filesystem — operates on raw EPUB (OCF zip) bytes so unit tests
//! run off-device. Soft-fails missing fields rather than panicking.

use std::io::{Cursor, Read};

use zip::ZipArchive;

/// Extracted bibliographic fields for the library shelf.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EpubMeta {
    pub title: String,
    pub author: Option<String>,
    pub language: Option<String>,
}

/// Cover image bytes + a suggested file extension (`jpg` / `png` / `gif` / `webp` / `bin`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoverImage {
    pub bytes: Vec<u8>,
    pub ext: &'static str,
}

const FALLBACK_TITLE: &str = "未知书名";

/// Parse title / author / language from an EPUB package. Soft-fail → fallback title.
pub fn extract_epub_meta(epub_bytes: &[u8]) -> EpubMeta {
    match extract_epub_meta_inner(epub_bytes) {
        Ok(m) => m,
        Err(_) => EpubMeta {
            title: FALLBACK_TITLE.to_string(),
            author: None,
            language: None,
        },
    }
}

/// Best-effort cover image from OPF manifest (`properties="cover-image"` or id/meta cover).
pub fn extract_epub_cover(epub_bytes: &[u8]) -> Option<CoverImage> {
    extract_epub_cover_inner(epub_bytes).ok().flatten()
}

fn extract_epub_meta_inner(epub_bytes: &[u8]) -> Result<EpubMeta, ()> {
    let opf = read_opf_xml(epub_bytes)?;
    let title = first_dc_text(&opf, "title")
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| FALLBACK_TITLE.to_string());
    let author = first_dc_text(&opf, "creator").filter(|s| !s.is_empty());
    let language = first_dc_text(&opf, "language").filter(|s| !s.is_empty());
    Ok(EpubMeta {
        title,
        author,
        language,
    })
}

fn extract_epub_cover_inner(epub_bytes: &[u8]) -> Result<Option<CoverImage>, ()> {
    let opf_path = package_opf_path(epub_bytes)?;
    let opf = read_entry_string(epub_bytes, &opf_path)?;
    let href = cover_href_from_opf(&opf).ok_or(())?;
    let cover_path = resolve_opf_href(&opf_path, &href);
    let bytes = read_entry_bytes(epub_bytes, &cover_path)?;
    if bytes.is_empty() {
        return Ok(None);
    }
    let ext = ext_from_href(&href);
    Ok(Some(CoverImage { bytes, ext }))
}

fn read_opf_xml(epub_bytes: &[u8]) -> Result<String, ()> {
    let path = package_opf_path(epub_bytes)?;
    read_entry_string(epub_bytes, &path)
}

fn package_opf_path(epub_bytes: &[u8]) -> Result<String, ()> {
    let container = read_entry_string(epub_bytes, "META-INF/container.xml")?;
    // full-path="..."
    let key = "full-path=\"";
    let start = container.find(key).ok_or(())? + key.len();
    let end = container[start..].find('"').ok_or(())? + start;
    let path = container[start..end].trim();
    if path.is_empty() || path.contains("..") {
        return Err(());
    }
    Ok(path.to_string())
}

fn read_entry_string(epub_bytes: &[u8], name: &str) -> Result<String, ()> {
    let bytes = read_entry_bytes(epub_bytes, name)?;
    String::from_utf8(bytes).map_err(|_| ())
}

fn read_entry_bytes(epub_bytes: &[u8], name: &str) -> Result<Vec<u8>, ()> {
    // Normalize zip paths to forward slashes.
    let want = name.replace('\\', "/");
    let cursor = Cursor::new(epub_bytes);
    let mut archive = ZipArchive::new(cursor).map_err(|_| ())?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|_| ())?;
        let name_norm = file.name().replace('\\', "/");
        if name_norm == want {
            // Zip-slip: reject absolute / parent segments (same spirit as protection).
            if name_norm.starts_with('/') || name_norm.contains("..") {
                return Err(());
            }
            let mut buf = Vec::new();
            file.read_to_end(&mut buf).map_err(|_| ())?;
            return Ok(buf);
        }
    }
    Err(())
}

/// First `dc:{local}` or namespaced `...:local` text content (naive XML scan).
fn first_dc_text(opf: &str, local: &str) -> Option<String> {
    // Prefer <dc:title>, also accept <title xmlns=...> rare cases.
    let patterns = [
        format!("<dc:{local}"),
        format!("<{local}"),
    ];
    for pat in patterns {
        if let Some(v) = first_element_text(opf, &pat) {
            let t = v.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    None
}

fn first_element_text(xml: &str, open_prefix: &str) -> Option<String> {
    let mut search = xml;
    while let Some(idx) = search.find(open_prefix) {
        let after = &search[idx + open_prefix.len()..];
        // Ensure tag name boundary: next char is space, /, or >
        let boundary = after.chars().next()?;
        if boundary != '>' && boundary != ' ' && boundary != '/' && boundary != '\n' && boundary != '\r' && boundary != '\t' {
            search = &after[1..];
            continue;
        }
        if after.starts_with("/>") {
            return None;
        }
        let gt = after.find('>')?;
        let rest = &after[gt + 1..];
        // closing tag
        let close_idx = rest.find('<')?;
        let text = &rest[..close_idx];
        return Some(decode_xml_text(text));
    }
    None
}

fn decode_xml_text(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn cover_href_from_opf(opf: &str) -> Option<String> {
    // 1) item with properties containing cover-image
    if let Some(href) = item_href_with_attr_contains(opf, "properties", "cover-image") {
        return Some(href);
    }
    // 2) meta name="cover" content="id"
    if let Some(id) = meta_cover_id(opf) {
        if let Some(href) = item_href_with_attr_eq(opf, "id", &id) {
            return Some(href);
        }
    }
    // 3) id contains "cover" and media-type image/*
    item_href_cover_heuristic(opf)
}

fn meta_cover_id(opf: &str) -> Option<String> {
    // <meta name="cover" content="cover-id"/>
    let mut search = opf;
    while let Some(idx) = search.find("<meta") {
        let slice = &search[idx..];
        let end = slice.find('>').unwrap_or(slice.len());
        let tag = &slice[..end];
        if tag.contains("name=\"cover\"") || tag.contains("name='cover'") {
            if let Some(c) = attr_value(tag, "content") {
                return Some(c);
            }
        }
        search = &slice[5..];
    }
    None
}

fn item_href_with_attr_contains(opf: &str, attr: &str, needle: &str) -> Option<String> {
    let mut search = opf;
    while let Some(idx) = search.find("<item") {
        let slice = &search[idx..];
        let end = slice.find('>').unwrap_or(slice.len());
        let tag = &slice[..end];
        if let Some(v) = attr_value(tag, attr) {
            if v.split_whitespace().any(|p| p == needle) {
                return attr_value(tag, "href");
            }
        }
        search = &slice[5..];
    }
    None
}

fn item_href_with_attr_eq(opf: &str, attr: &str, expect: &str) -> Option<String> {
    let mut search = opf;
    while let Some(idx) = search.find("<item") {
        let slice = &search[idx..];
        let end = slice.find('>').unwrap_or(slice.len());
        let tag = &slice[..end];
        if attr_value(tag, attr).as_deref() == Some(expect) {
            return attr_value(tag, "href");
        }
        search = &slice[5..];
    }
    None
}

fn item_href_cover_heuristic(opf: &str) -> Option<String> {
    let mut search = opf;
    while let Some(idx) = search.find("<item") {
        let slice = &search[idx..];
        let end = slice.find('>').unwrap_or(slice.len());
        let tag = &slice[..end];
        let id = attr_value(tag, "id").unwrap_or_default().to_ascii_lowercase();
        let mt = attr_value(tag, "media-type").unwrap_or_default();
        if id.contains("cover") && mt.starts_with("image/") {
            return attr_value(tag, "href");
        }
        search = &slice[5..];
    }
    None
}

fn attr_value(tag: &str, name: &str) -> Option<String> {
    let patterns = [format!("{name}=\""), format!("{name}='")];
    for pat in patterns {
        if let Some(start_rel) = tag.find(&pat) {
            let start = start_rel + pat.len();
            let quote = pat.chars().last()?;
            let end_rel = tag[start..].find(quote)?;
            return Some(tag[start..start + end_rel].to_string());
        }
    }
    None
}

fn resolve_opf_href(opf_path: &str, href: &str) -> String {
    let href = href.split('#').next().unwrap_or(href);
    if href.starts_with('/') {
        return href.trim_start_matches('/').to_string();
    }
    let base = opf_path.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    if base.is_empty() {
        href.to_string()
    } else {
        format!("{base}/{href}")
    }
}

fn ext_from_href(href: &str) -> &'static str {
    let lower = href.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "jpg"
    } else if lower.ends_with(".gif") {
        "gif"
    } else if lower.ends_with(".webp") {
        "webp"
    } else if lower.ends_with(".svg") {
        "svg"
    } else {
        "bin"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_fixture_title() {
        let bytes = include_bytes!("../../tests/fixtures/clean.epub");
        let meta = extract_epub_meta(bytes);
        assert_eq!(meta.title, "Pillowtome Fixture");
        assert!(meta.author.is_none());
        assert_eq!(meta.language.as_deref(), Some("zh-CN"));
    }

    #[test]
    fn empty_bytes_soft_fail_title() {
        let meta = extract_epub_meta(b"not a zip");
        assert_eq!(meta.title, "未知书名");
    }
}
