//! EPUB OPF metadata + cover extraction (Phase 4 / LIB-03, rewritten LIB-metadata).
//!
//! Uses `quick-xml` (namespace-aware) so real-world OPFs parse regardless of the
//! Dublin Core prefix (`dc:`, `dcterms:`, a custom prefix, or a default xmlns),
//! and EPUB3 `refines` are honoured to pick the *main* title and the *author*
//! (`role=aut`). No Tauri / filesystem — operates on raw EPUB (OCF zip) bytes so
//! unit tests run off-device. Soft-fails missing fields rather than panicking.

use std::collections::HashMap;
use std::io::{Cursor, Read};

use quick_xml::events::{BytesStart, Event};
use quick_xml::name::ResolveResult;
use quick_xml::NsReader;
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
const DC_NS: &[u8] = b"http://purl.org/dc/elements/1.1/";

/// Parse title / author / language from an EPUB package. Soft-fail → fallback title.
pub fn extract_epub_meta(epub_bytes: &[u8]) -> EpubMeta {
    match read_opf_xml(epub_bytes) {
        Ok(opf) => meta_from_opf(&parse_opf(&opf)),
        Err(_) => EpubMeta {
            title: FALLBACK_TITLE.to_string(),
            author: None,
            language: None,
        },
    }
}

/// Best-effort cover image from OPF manifest (cover-image property / meta / guide / heuristic).
pub fn extract_epub_cover(epub_bytes: &[u8]) -> Option<CoverImage> {
    let opf_path = package_opf_path(epub_bytes).ok()?;
    let opf = read_entry_string(epub_bytes, &opf_path).ok()?;
    let href = cover_href_from_opf(&parse_opf(&opf))?;
    let cover_path = resolve_opf_href(&opf_path, &href);
    let bytes = read_entry_bytes(epub_bytes, &cover_path).ok()?;
    if bytes.is_empty() {
        return None;
    }
    Some(CoverImage {
        bytes,
        ext: ext_from_href(&href),
    })
}

// --- OPF model -------------------------------------------------------------

#[derive(Debug, Default)]
struct ManifestItem {
    id: String,
    href: String,
    properties: String,
    media_type: String,
}

#[derive(Debug, Default)]
struct ParsedOpf {
    /// (id, text) in document order.
    titles: Vec<(Option<String>, String)>,
    creators: Vec<(Option<String>, String)>,
    language: Option<String>,
    /// idref → property → value (EPUB3 `<meta refines="#id" property="...">value</meta>`).
    refines: HashMap<String, HashMap<String, String>>,
    items: Vec<ManifestItem>,
    /// EPUB2 `<meta name="cover" content="itemid"/>`.
    meta_cover_id: Option<String>,
    /// EPUB2 `<guide><reference type="cover" href="..."/></guide>`.
    guide_cover_href: Option<String>,
}

fn meta_from_opf(p: &ParsedOpf) -> EpubMeta {
    let title = pick_title(p).unwrap_or_else(|| FALLBACK_TITLE.to_string());
    let author = pick_author(p);
    EpubMeta {
        title,
        author,
        language: p.language.clone(),
    }
}

/// Prefer the title refined as `title-type=main`; else the first non-empty title.
fn pick_title(p: &ParsedOpf) -> Option<String> {
    for (id, text) in &p.titles {
        if let Some(id) = id {
            if p.refines
                .get(id)
                .and_then(|m| m.get("title-type"))
                .map(|v| v.eq_ignore_ascii_case("main"))
                .unwrap_or(false)
            {
                return Some(text.clone());
            }
        }
    }
    p.titles.first().map(|(_, t)| t.clone())
}

/// Prefer a creator refined as `role=aut`; else the first non-empty creator.
fn pick_author(p: &ParsedOpf) -> Option<String> {
    for (id, text) in &p.creators {
        if let Some(id) = id {
            if p.refines
                .get(id)
                .and_then(|m| m.get("role"))
                .map(|v| v.eq_ignore_ascii_case("aut"))
                .unwrap_or(false)
            {
                return Some(text.clone());
            }
        }
    }
    p.creators.first().map(|(_, t)| t.clone())
}

/// Resolve the cover image href from the manifest (4 strategies, most specific first).
fn cover_href_from_opf(p: &ParsedOpf) -> Option<String> {
    // 1) EPUB3: manifest item with properties containing `cover-image`.
    if let Some(it) = p
        .items
        .iter()
        .find(|it| it.properties.split_whitespace().any(|w| w == "cover-image"))
    {
        if !it.href.is_empty() {
            return Some(it.href.clone());
        }
    }
    // 2) EPUB2: <meta name="cover" content="id"> → item with that id.
    if let Some(id) = &p.meta_cover_id {
        if let Some(it) = p.items.iter().find(|it| &it.id == id) {
            if !it.href.is_empty() {
                return Some(it.href.clone());
            }
        }
    }
    // 3) EPUB2 guide reference type="cover".
    if let Some(h) = &p.guide_cover_href {
        return Some(h.clone());
    }
    // 4) Heuristic: an image item whose id mentions "cover".
    p.items
        .iter()
        .find(|it| {
            it.media_type.starts_with("image/") && it.id.to_ascii_lowercase().contains("cover")
        })
        .map(|it| it.href.clone())
        .filter(|h| !h.is_empty())
}

// --- OPF parsing (quick-xml) ------------------------------------------------

enum Cap {
    Title(Option<String>),
    Creator(Option<String>),
    Language,
    Refine(String, String),
}

fn parse_opf(opf: &str) -> ParsedOpf {
    let mut p = ParsedOpf::default();
    let mut reader = NsReader::from_str(opf);
    reader.config_mut().trim_text(true);
    let mut cap: Option<Cap> = None;
    let mut buf = String::new();

    loop {
        match reader.read_resolved_event() {
            Ok((rr, Event::Start(e))) => {
                begin_element(&rr, &e, &mut p, &mut cap, &mut buf);
            }
            Ok((_, Event::Empty(e))) => {
                // Self-closing manifest items, guide references, EPUB2 cover meta.
                empty_element(&e, &mut p);
            }
            Ok((_, Event::Text(e))) => {
                if cap.is_some() {
                    if let Ok(s) = e.decode() {
                        buf.push_str(&unescape_entities(&s));
                    }
                }
            }
            Ok((_, Event::CData(e))) => {
                // CDATA is literal text (no entity decoding) — real-world OPFs from
                // some generators wrap `<dc:title>` in `<![CDATA[…]]>`; quick-xml
                // delivers it as CData, not Text, so it must be captured too.
                if cap.is_some() {
                    buf.push_str(&String::from_utf8_lossy(&e));
                }
            }
            Ok((_, Event::End(_))) => {
                finish_capture(cap.take(), &buf, &mut p);
                buf.clear();
            }
            Ok((_, Event::Eof)) => break,
            Err(_) => break,
            _ => {}
        }
    }
    p
}

fn begin_element(
    rr: &ResolveResult,
    e: &BytesStart,
    p: &mut ParsedOpf,
    cap: &mut Option<Cap>,
    buf: &mut String,
) {
    let is_dc = matches!(rr, ResolveResult::Bound(ns) if ns.as_ref() == DC_NS);
    let local = e.local_name();
    let local = local.as_ref();
    if is_dc && local == b"title" {
        *cap = Some(Cap::Title(attr_local(e, b"id")));
        buf.clear();
    } else if is_dc && local == b"creator" {
        *cap = Some(Cap::Creator(attr_local(e, b"id")));
        buf.clear();
    } else if is_dc && local == b"language" {
        *cap = Some(Cap::Language);
        buf.clear();
    } else if local == b"meta" {
        // EPUB3 refines carry a text value → capture until </meta>.
        if let (Some(refines), Some(property)) =
            (attr_local(e, b"refines"), attr_local(e, b"property"))
        {
            *cap = Some(Cap::Refine(strip_hash(&refines), property));
            buf.clear();
        }
        meta_cover(e, p);
    } else if local == b"item" {
        push_item(e, p);
    } else if local == b"reference" {
        guide_reference(e, p);
    }
}

fn empty_element(e: &BytesStart, p: &mut ParsedOpf) {
    let local = e.local_name();
    match local.as_ref() {
        b"meta" => meta_cover(e, p),
        b"item" => push_item(e, p),
        b"reference" => guide_reference(e, p),
        _ => {}
    }
}

fn finish_capture(cap: Option<Cap>, buf: &str, p: &mut ParsedOpf) {
    match cap {
        Some(Cap::Title(id)) => {
            let t = buf.trim();
            if !t.is_empty() {
                p.titles.push((id, t.to_string()));
            }
        }
        Some(Cap::Creator(id)) => {
            let t = buf.trim();
            if !t.is_empty() {
                p.creators.push((id, t.to_string()));
            }
        }
        Some(Cap::Language) => {
            let t = buf.trim();
            if !t.is_empty() && p.language.is_none() {
                p.language = Some(t.to_string());
            }
        }
        Some(Cap::Refine(idref, prop)) => {
            let v = buf.trim().to_string();
            p.refines.entry(idref).or_default().insert(prop, v);
        }
        None => {}
    }
}

fn meta_cover(e: &BytesStart, p: &mut ParsedOpf) {
    if attr_local(e, b"name").as_deref() == Some("cover") {
        if let Some(content) = attr_local(e, b"content") {
            if p.meta_cover_id.is_none() && !content.is_empty() {
                p.meta_cover_id = Some(content);
            }
        }
    }
}

fn push_item(e: &BytesStart, p: &mut ParsedOpf) {
    p.items.push(ManifestItem {
        id: attr_local(e, b"id").unwrap_or_default(),
        href: attr_local(e, b"href").unwrap_or_default(),
        properties: attr_local(e, b"properties").unwrap_or_default(),
        media_type: attr_local(e, b"media-type").unwrap_or_default(),
    });
}

fn guide_reference(e: &BytesStart, p: &mut ParsedOpf) {
    if attr_local(e, b"type").as_deref() == Some("cover") {
        if let Some(h) = attr_local(e, b"href") {
            if p.guide_cover_href.is_none() && !h.is_empty() {
                p.guide_cover_href = Some(h);
            }
        }
    }
}

/// Attribute value by LOCAL name (prefix-agnostic: matches `id`, `opf:role`, …).
fn attr_local(e: &BytesStart, want: &[u8]) -> Option<String> {
    for a in e.attributes().flatten() {
        if a.key.local_name().as_ref() == want {
            return Some(unescape_entities(&String::from_utf8_lossy(&a.value)));
        }
    }
    None
}

fn strip_hash(s: &str) -> String {
    s.trim_start_matches('#').to_string()
}

/// Decode the predefined XML entities + numeric char refs (`&amp; &#x4e2d;` …).
/// Cheap and dependency-free; the common case (no `&`) returns the input as-is.
fn unescape_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let tail = &rest[amp..];
        if let Some(semi) = tail.find(';') {
            let ent = &tail[1..semi];
            let decoded = match ent {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                _ if ent.starts_with("#x") || ent.starts_with("#X") => {
                    u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32)
                }
                _ if ent.starts_with('#') => ent[1..].parse::<u32>().ok().and_then(char::from_u32),
                _ => None,
            };
            if let Some(c) = decoded {
                out.push(c);
                rest = &tail[semi + 1..];
                continue;
            }
        }
        out.push('&');
        rest = &tail[1..];
    }
    out.push_str(rest);
    out
}

// --- OCF zip + href helpers -------------------------------------------------

fn read_opf_xml(epub_bytes: &[u8]) -> Result<String, ()> {
    let path = package_opf_path(epub_bytes)?;
    read_entry_string(epub_bytes, &path)
}

/// Root OPF path from `META-INF/container.xml` (`<rootfile full-path="...">`).
fn package_opf_path(epub_bytes: &[u8]) -> Result<String, ()> {
    let container = read_entry_string(epub_bytes, "META-INF/container.xml")?;
    let mut reader = NsReader::from_str(&container);
    reader.config_mut().trim_text(true);
    loop {
        match reader.read_resolved_event() {
            Ok((_, Event::Start(e))) | Ok((_, Event::Empty(e)))
                if e.local_name().as_ref() == b"rootfile" =>
            {
                if let Some(path) = attr_local(&e, b"full-path") {
                    let path = path.trim();
                    if path.is_empty() || path.contains("..") {
                        return Err(());
                    }
                    return Ok(path.to_string());
                }
            }
            Ok((_, Event::Eof)) => break,
            Err(_) => break,
            _ => {}
        }
    }
    Err(())
}

fn read_entry_string(epub_bytes: &[u8], name: &str) -> Result<String, ()> {
    let bytes = read_entry_bytes(epub_bytes, name)?;
    // Strip a UTF-8 BOM if present so downstream string scans line up.
    let s = String::from_utf8(bytes).map_err(|_| ())?;
    Ok(s.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(s))
}

fn read_entry_bytes(epub_bytes: &[u8], name: &str) -> Result<Vec<u8>, ()> {
    let want = name.replace('\\', "/");
    let cursor = Cursor::new(epub_bytes);
    let mut archive = ZipArchive::new(cursor).map_err(|_| ())?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|_| ())?;
        let name_norm = file.name().replace('\\', "/");
        if name_norm == want {
            if name_norm.starts_with('/') || name_norm.contains("..") {
                return Err(());
            }
            let mut b = Vec::new();
            file.read_to_end(&mut b).map_err(|_| ())?;
            return Ok(b);
        }
    }
    Err(())
}

fn resolve_opf_href(opf_path: &str, href: &str) -> String {
    let href = href.split('#').next().unwrap_or(href);
    let href = percent_decode(href);
    if let Some(stripped) = href.strip_prefix('/') {
        return stripped.to_string();
    }
    let base = opf_path.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    if base.is_empty() {
        href
    } else {
        format!("{base}/{href}")
    }
}

/// Minimal percent-decoding for OPF hrefs (spaces / CJK in cover file names).
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
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
        assert_eq!(meta.language.as_deref(), Some("zh-CN"));
    }

    #[test]
    fn empty_bytes_soft_fail_title() {
        let meta = extract_epub_meta(b"not a zip");
        assert_eq!(meta.title, "未知书名");
    }

    #[test]
    fn parses_custom_dc_prefix_and_refines() {
        // Non-`dc:` prefix + EPUB3 refines choosing the MAIN title and the AUTHOR.
        let opf = r##"<?xml version="1.0"?>
        <package xmlns="http://www.idpf.org/2007/opf" xmlns:d="http://purl.org/dc/elements/1.1/">
          <metadata>
            <d:title id="t1">副标题：不要选我</d:title>
            <d:title id="t2">红楼梦</d:title>
            <meta refines="#t2" property="title-type">main</meta>
            <meta refines="#t1" property="title-type">subtitle</meta>
            <d:creator id="c1">高鹗</d:creator>
            <d:creator id="c2">曹雪芹</d:creator>
            <meta refines="#c2" property="role" scheme="marc:relators">aut</meta>
            <meta refines="#c1" property="role">edt</meta>
            <d:language>zh</d:language>
          </metadata>
        </package>"##;
        let p = parse_opf(opf);
        let meta = meta_from_opf(&p);
        assert_eq!(meta.title, "红楼梦");
        assert_eq!(meta.author.as_deref(), Some("曹雪芹"));
        assert_eq!(meta.language.as_deref(), Some("zh"));
    }

    #[test]
    fn parses_cdata_title_empty_creator() {
        // Real shape from yidm.com EPUBs: CDATA-wrapped title + empty creator.
        let opf = r##"<?xml version="1.0"?>
        <package xmlns="http://www.idpf.org/2007/opf"
                 xmlns:dc="http://purl.org/dc/elements/1.1/"
                 xmlns:opf="http://www.idpf.org/2007/opf">
          <metadata>
            <dc:title><![CDATA[败北女角太多了！-第一卷-迷糊轻小说]]></dc:title>
            <dc:creator opf:file-as="" opf:role="aut"></dc:creator>
            <dc:language>zh</dc:language>
          </metadata>
        </package>"##;
        let meta = meta_from_opf(&parse_opf(opf));
        assert_eq!(meta.title, "败北女角太多了！-第一卷-迷糊轻小说");
        assert_eq!(meta.author, None); // genuinely absent in the file
    }

    #[test]
    fn cover_via_properties_meta_and_guide() {
        // EPUB3 cover-image property wins.
        let opf3 = r#"<package xmlns="http://www.idpf.org/2007/opf">
          <manifest><item id="c" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/></manifest>
        </package>"#;
        assert_eq!(
            cover_href_from_opf(&parse_opf(opf3)).as_deref(),
            Some("images/cover.jpg")
        );
        // EPUB2 meta name=cover → item id.
        let opf2 = r#"<package xmlns="http://www.idpf.org/2007/opf">
          <metadata><meta name="cover" content="cov"/></metadata>
          <manifest><item id="cov" href="cover.png" media-type="image/png"/></manifest>
        </package>"#;
        assert_eq!(cover_href_from_opf(&parse_opf(opf2)).as_deref(), Some("cover.png"));
        // Guide reference fallback.
        let opfg = r#"<package xmlns="http://www.idpf.org/2007/opf">
          <manifest><item id="x" href="p.xhtml" media-type="application/xhtml+xml"/></manifest>
          <guide><reference type="cover" href="cover.xhtml"/></guide>
        </package>"#;
        assert_eq!(cover_href_from_opf(&parse_opf(opfg)).as_deref(), Some("cover.xhtml"));
    }

    #[test]
    fn resolve_href_percent_and_subdir() {
        assert_eq!(resolve_opf_href("OEBPS/content.opf", "images/c.jpg"), "OEBPS/images/c.jpg");
        assert_eq!(resolve_opf_href("content.opf", "/abs/c.jpg"), "abs/c.jpg");
        assert_eq!(resolve_opf_href("OEBPS/x.opf", "cover%20art.jpg"), "OEBPS/cover art.jpg");
    }
}
