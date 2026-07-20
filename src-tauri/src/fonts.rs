//! Custom font import into `app_data_dir/fonts` (READ-06, D-27..D-29).
//!
//! Font files are **copied** into app data (never depend on the original path or a
//! SAF grant). Limits are enforced server-side (T-02-font): max 20 fonts, ≤20MB
//! each. Only the metadata struct crosses IPC — never font bytes (T-02-ipc).
//!
//! Path confinement (T-02-path): ids are sanitize-safe flat tokens; resolve only
//! under the fonts directory after canonicalize.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Max number of custom fonts stored under app data (D-28).
pub const MAX_CUSTOM_FONTS: usize = 20;

/// Max size of a single custom font file in bytes (D-28) — 20 MiB.
pub const MAX_FONT_BYTES: u64 = 20 * 1024 * 1024;

/// Allowed font extensions (UI-SPEC: TTF / OTF / WOFF / WOFF2). Case-insensitive.
const ALLOWED_EXTS: &[&str] = &["ttf", "otf", "woff", "woff2"];

/// Metadata returned by [`import_font`] — small struct only, never bytes (T-02-ipc).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontMeta {
    pub id: String,
    pub family_name: String,
    pub file_name: String,
    pub byte_size: u64,
}

/// `app_data_dir()/fonts`, created if missing.
pub fn fonts_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录：{e}"))?
        .join("fonts");
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建字体目录：{e}"))?;
    Ok(dir)
}

/// Import a font file from `source_path` into app data (D-27).
///
/// Validates extension + size + count server-side (D-28 / T-02-font), copies to
/// `fonts/{id}.{ext}`, returns metadata. Does **not** write SQLite — frontend
/// owns `custom_font` rows with bound params (T-02-sql).
#[tauri::command]
pub fn import_font(app: AppHandle, path: String) -> Result<FontMeta, String> {
    let dir = fonts_dir(&app)?;
    let existing = count_font_files(&dir)?;
    import_font_into(&dir, Path::new(&path), existing)
}

/// Delete the app-data copy of font `id` only (D-29). Never touches the original.
///
/// Frontend still deletes the `custom_font` SQL row. Id is sanitized against
/// traversal (T-02-path).
#[tauri::command]
pub fn remove_font(app: AppHandle, id: String) -> Result<(), String> {
    let dir = fonts_dir(&app)?;
    remove_font_file(&dir, &id)
}

/// Pure import into a fonts directory — unit-testable with tempdirs.
pub fn import_font_into(
    fonts_dir: &Path,
    source_path: &Path,
    existing_count: usize,
) -> Result<FontMeta, String> {
    if existing_count >= MAX_CUSTOM_FONTS {
        return Err(format!(
            "已达自定义字体上限（{MAX_CUSTOM_FONTS} 个），请先移除后再导入。"
        ));
    }

    let ext = source_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .ok_or_else(|| "仅支持 TTF、OTF、WOFF / WOFF2 字体文件。".to_string())?;

    if !ALLOWED_EXTS.contains(&ext.as_str()) {
        return Err("仅支持 TTF、OTF、WOFF / WOFF2 字体文件。".to_string());
    }

    let meta = fs::metadata(source_path).map_err(|_| "无法读取字体文件。".to_string())?;
    if !meta.is_file() {
        return Err("无法读取字体文件。".to_string());
    }
    if meta.len() > MAX_FONT_BYTES {
        return Err(format!(
            "字体文件过大（上限 {}MB）。",
            MAX_FONT_BYTES / (1024 * 1024)
        ));
    }
    if meta.len() == 0 {
        return Err("字体文件无效。".to_string());
    }

    let id = new_font_id();
    // Id must pass sanitize rules used by the protocol path (flat token).
    if !is_safe_font_id(&id) {
        return Err("内部字体 id 无效。".to_string());
    }

    let file_name = format!("{id}.{ext}");
    let dest = fonts_dir.join(&file_name);

    // Extra confinement: dest must stay under fonts_dir.
    if !dest.starts_with(fonts_dir) {
        return Err("字体路径无效。".to_string());
    }

    fs::copy(source_path, &dest).map_err(|e| format!("复制字体失败：{e}"))?;

    // Re-check size after copy (do not trust pre-copy alone).
    let copied = fs::metadata(&dest).map_err(|_| "无法校验已复制的字体。".to_string())?;
    if copied.len() > MAX_FONT_BYTES {
        let _ = fs::remove_file(&dest);
        return Err(format!(
            "字体文件过大（上限 {}MB）。",
            MAX_FONT_BYTES / (1024 * 1024)
        ));
    }

    let family_name = family_name_from_path(source_path);

    Ok(FontMeta {
        id,
        family_name,
        file_name,
        byte_size: copied.len(),
    })
}

/// Remove app-data copy for `id` (all matching `{id}.*` under fonts_dir).
pub fn remove_font_file(fonts_dir: &Path, id: &str) -> Result<(), String> {
    if !is_safe_font_id(id) {
        return Err("无效的字体 id。".to_string());
    }

    let mut removed = false;
    let entries = fs::read_dir(fonts_dir).map_err(|e| format!("无法读取字体目录：{e}"))?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        // Match `{id}.ext` only — no prefix collisions with longer ids.
        if let Some((stem, _ext)) = name.rsplit_once('.') {
            if stem == id {
                let path = entry.path();
                // Confine: only delete under fonts_dir.
                if path.starts_with(fonts_dir) {
                    fs::remove_file(&path).map_err(|e| format!("删除字体失败：{e}"))?;
                    removed = true;
                }
            }
        }
    }

    if !removed {
        // Idempotent: missing file is OK (SQL row may still need cleanup).
        return Ok(());
    }
    Ok(())
}

/// Resolve on-disk path for a font id under `fonts_dir` (first `{id}.*` match).
///
/// Returns `None` for unsafe ids or missing files. After canonicalize, path must
/// still start with the canonical fonts_dir (T-02-path).
pub fn resolve_font_path(fonts_dir: &Path, id: &str) -> Option<PathBuf> {
    if !is_safe_font_id(id) {
        return None;
    }
    let Ok(entries) = fs::read_dir(fonts_dir) else {
        return None;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if let Some((stem, ext)) = name.rsplit_once('.') {
            if stem == id && ALLOWED_EXTS.contains(&ext.to_ascii_lowercase().as_str()) {
                let path = entry.path();
                if !path.starts_with(fonts_dir) {
                    return None;
                }
                // Canonicalize both sides when possible to defeat symlink escape.
                let Ok(canon_dir) = fs::canonicalize(fonts_dir) else {
                    return Some(path);
                };
                match fs::canonicalize(&path) {
                    Ok(canon_path) if canon_path.starts_with(&canon_dir) => {
                        return Some(canon_path);
                    }
                    Ok(_) => return None,
                    Err(_) => {
                        // File may be unreadable; still refuse non-prefix path.
                        if path.starts_with(fonts_dir) {
                            return Some(path);
                        }
                        return None;
                    }
                }
            }
        }
    }
    None
}

/// Reserved bundled face ids (CJK-05). Flat tokens that pass [`is_safe_font_id`].
pub const BUNDLED_NOTO_SC_ID: &str = "bundled-noto-sc";
pub const BUNDLED_NOTO_TC_ID: &str = "bundled-noto-tc";
pub const BUNDLED_NOTO_SERIF_SC_400_ID: &str = "bundled-noto-serif-sc-400";
pub const BUNDLED_NOTO_SERIF_SC_700_ID: &str = "bundled-noto-serif-sc-700";

/// Legacy single-face serif id from pre-split builds — its files are removed
/// at startup (OTS rejects the 53 MB OTF / 52.8 MiB-payload WOFF2 on Android).
pub const LEGACY_BUNDLED_SERIF_SC_ID: &str = "bundled-noto-serif-sc";

/// Remove stale bundled faces that current builds no longer serve (best-effort,
/// never blocks startup): the legacy single serif face in either extension.
pub fn remove_stale_bundled_fonts(fonts_dir: &Path) {
    for ext in ["otf", "woff2", "woff"] {
        let p = fonts_dir.join(format!("{LEGACY_BUNDLED_SERIF_SC_ID}.{ext}"));
        if p.starts_with(fonts_dir) && p.exists() {
            let _ = fs::remove_file(&p);
        }
    }
}

/// True when the file stem is a reserved bundled face (excluded from custom count).
pub fn is_bundled_font_id(id: &str) -> bool {
    id.starts_with("bundled-")
}

/// Count **custom** font files in the fonts directory (for limit enforcement).
///
/// Files whose stem starts with `bundled-` are product faces (CJK-05) and do
/// **not** consume the user's [`MAX_CUSTOM_FONTS`] slots.
pub fn count_font_files(fonts_dir: &Path) -> Result<usize, String> {
    if !fonts_dir.exists() {
        return Ok(0);
    }
    let entries = fs::read_dir(fonts_dir).map_err(|e| format!("无法读取字体目录：{e}"))?;
    let mut n = 0usize;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if let Some((stem, ext)) = name.rsplit_once('.') {
            if is_bundled_font_id(stem) {
                continue;
            }
            if ALLOWED_EXTS.contains(&ext.to_ascii_lowercase().as_str()) {
                n += 1;
            }
        }
    }
    Ok(n)
}

/// Write embedded bytes to `fonts_dir/{id}.woff2` when missing or size-mismatched.
///
/// Also removes the legacy `{id}.otf` from pre-WOFF2 installs — otherwise
/// [`resolve_font_path`] could keep serving the stale (larger, and for Serif
/// OTS-rejected) file. Soft-fail friendly: returns Ok(false) when skipped
/// (already present), Ok(true) when written. Callers log warn on Err without
/// blocking app start.
pub fn materialize_bundled_font(
    fonts_dir: &Path,
    id: &str,
    bytes: &[u8],
) -> Result<bool, String> {
    if !is_safe_font_id(id) {
        return Err(format!("bundled font id unsafe: {id}"));
    }
    if bytes.is_empty() {
        return Err(format!("bundled font empty: {id}"));
    }
    fs::create_dir_all(fonts_dir).map_err(|e| format!("无法创建字体目录：{e}"))?;
    // Drop the legacy OTF copy (pre-WOFF2 builds) regardless of write outcome.
    let legacy = fonts_dir.join(format!("{id}.otf"));
    if legacy.starts_with(fonts_dir) && legacy.exists() {
        let _ = fs::remove_file(&legacy);
    }
    let dest = fonts_dir.join(format!("{id}.woff2"));
    if !dest.starts_with(fonts_dir) {
        return Err("字体路径无效。".to_string());
    }
    let expected = bytes.len() as u64;
    let stale = match fs::metadata(&dest) {
        Ok(meta) if meta.is_file() && meta.len() == expected => false,
        _ => true,
    };
    if !stale {
        return Ok(false);
    }
    fs::write(&dest, bytes).map_err(|e| format!("写入内置字体失败（{id}）：{e}"))?;
    Ok(true)
}

/// Content-Type for a font extension (lowercase, no dot).
pub fn font_content_type(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

/// Flat sanitize-safe font id: non-empty, no separators / `..` / dots.
pub fn is_safe_font_id(id: &str) -> bool {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") || id.contains('.')
    {
        return false;
    }
    // Only alphanumeric + hyphen — matches protocol path token expectations.
    id.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn new_font_id() -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    use std::time::{SystemTime, UNIX_EPOCH};

    let mut h = DefaultHasher::new();
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
        .hash(&mut h);
    std::thread::current().id().hash(&mut h);
    // Prefix keeps ids clearly font-scoped and non-numeric-leading edge cases.
    format!("f{:016x}", h.finish())
}

fn family_name_from_path(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "自定义字体".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_fonts_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pillow-fonts-{}-{}-{}",
            label,
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp fonts dir");
        dir
    }

    use std::time::{SystemTime, UNIX_EPOCH};

    fn write_dummy_font(path: &Path, size: usize) {
        let mut f = fs::File::create(path).expect("create");
        f.write_all(&vec![0u8; size]).expect("write");
    }

    #[test]
    fn rejects_oversized_font() {
        let dir = temp_fonts_dir("oversize");
        let src = dir.join("big.ttf");
        // Don't actually write 20MB+ in CI — test the size check via metadata mock
        // path: write a small file then call with a forced size path using a
        // sparse approach is hard on Windows; instead write just over limit only
        // if cheap — use a stub by testing the constant and a helper path.
        // Write MAX_FONT_BYTES + 1 would be slow; create empty then set length via
        // File::set_len when available.
        {
            let f = fs::File::create(&src).expect("create");
            f.set_len(MAX_FONT_BYTES + 1).expect("set_len");
        }
        let err = import_font_into(&dir, &src, 0).unwrap_err();
        assert!(err.contains("过大") || err.contains("20"), "err={err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_21st_font() {
        let dir = temp_fonts_dir("count");
        let src = dir.join("ok.ttf");
        write_dummy_font(&src, 64);
        let err = import_font_into(&dir, &src, MAX_CUSTOM_FONTS).unwrap_err();
        assert!(err.contains("上限") || err.contains("20"), "err={err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_bad_extension() {
        let dir = temp_fonts_dir("ext");
        let src = dir.join("face.eot");
        write_dummy_font(&src, 32);
        let err = import_font_into(&dir, &src, 0).unwrap_err();
        assert!(err.contains("TTF") || err.contains("仅支持"), "err={err}");
        let src2 = dir.join("face.exe");
        write_dummy_font(&src2, 32);
        assert!(import_font_into(&dir, &src2, 0).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_woff2_extension() {
        let dir = temp_fonts_dir("woff2");
        let src = std::env::temp_dir().join(format!(
            "pillow-src-font-{}.woff2",
            std::process::id()
        ));
        write_dummy_font(&src, 128);
        let meta = import_font_into(&dir, &src, 0).expect("woff2 import ok");
        assert!(meta.file_name.ends_with(".woff2"));
        let _ = fs::remove_file(&src);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_small_ttf() {
        let dir = temp_fonts_dir("ok");
        let src = std::env::temp_dir().join(format!(
            "pillow-src-font-{}.ttf",
            std::process::id()
        ));
        write_dummy_font(&src, 128);
        let meta = import_font_into(&dir, &src, 0).expect("import ok");
        assert!(is_safe_font_id(&meta.id));
        assert!(meta.file_name.ends_with(".ttf"));
        assert_eq!(meta.byte_size, 128);
        assert!(dir.join(&meta.file_name).is_file());
        assert_eq!(count_font_files(&dir).unwrap(), 1);
        // resolve
        let resolved = resolve_font_path(&dir, &meta.id).expect("resolve");
        assert!(resolved.exists());
        // remove
        remove_font_file(&dir, &meta.id).expect("remove");
        assert_eq!(count_font_files(&dir).unwrap(), 0);
        let _ = fs::remove_file(&src);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn path_traversal_id_rejected() {
        assert!(!is_safe_font_id("../etc"));
        assert!(!is_safe_font_id("a/b"));
        assert!(!is_safe_font_id("a\\b"));
        assert!(!is_safe_font_id(".."));
        assert!(!is_safe_font_id("x.y"));
        assert!(is_safe_font_id("f0123456789abcdef"));
        assert!(is_safe_font_id(BUNDLED_NOTO_SC_ID));
        assert!(is_safe_font_id(BUNDLED_NOTO_TC_ID));

        let dir = temp_fonts_dir("trav");
        assert!(remove_font_file(&dir, "../evil").is_err());
        assert!(resolve_font_path(&dir, "../evil").is_none());
        assert!(resolve_font_path(&dir, "a/b").is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn constants_match_d28() {
        assert_eq!(MAX_CUSTOM_FONTS, 20);
        assert_eq!(MAX_FONT_BYTES, 20 * 1024 * 1024);
    }

    #[test]
    fn font_content_types() {
        assert_eq!(font_content_type("ttf"), "font/ttf");
        assert_eq!(font_content_type("OTF"), "font/otf");
        assert_eq!(font_content_type("woff"), "font/woff");
        assert_eq!(font_content_type("woff2"), "font/woff2");
    }

    #[test]
    fn materialize_removes_legacy_otf() {
        // Pre-WOFF2 installs hold {id}.otf; after migration the OTF must be
        // gone (it would win resolve order by directory chance) and only the
        // fresh {id}.woff2 served.
        let dir = temp_fonts_dir("legacy");
        let legacy = dir.join(format!("{BUNDLED_NOTO_SC_ID}.otf"));
        write_dummy_font(&legacy, 64);
        assert!(materialize_bundled_font(&dir, BUNDLED_NOTO_SC_ID, b"woff2-bytes").unwrap());
        assert!(!legacy.exists(), "legacy otf removed");
        let resolved = resolve_font_path(&dir, BUNDLED_NOTO_SC_ID).expect("resolve");
        assert!(resolved.ends_with(format!("{BUNDLED_NOTO_SC_ID}.woff2")));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn bundled_ids_resolve_and_excluded_from_custom_count() {
        let dir = temp_fonts_dir("bundled");
        let bytes = b"OTTO-fake-font-bytes";
        assert!(materialize_bundled_font(&dir, BUNDLED_NOTO_SC_ID, bytes).unwrap());
        // Second call is a no-op when size matches.
        assert!(!materialize_bundled_font(&dir, BUNDLED_NOTO_SC_ID, bytes).unwrap());
        let path = resolve_font_path(&dir, BUNDLED_NOTO_SC_ID).expect("resolve sc");
        assert!(path.exists());
        // Bundled does not count toward custom limit.
        assert_eq!(count_font_files(&dir).unwrap(), 0);
        // Custom file still counts (source lives outside fonts dir).
        let src = std::env::temp_dir().join(format!(
            "pillow-bundled-src-{}.ttf",
            std::process::id()
        ));
        write_dummy_font(&src, 64);
        import_font_into(&dir, &src, 0).expect("import custom");
        assert_eq!(count_font_files(&dir).unwrap(), 1);
        let _ = fs::remove_file(&src);
        let _ = fs::remove_dir_all(&dir);
    }
}
