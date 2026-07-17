//! Cover image materialize under `app_data_dir/covers` (LIB-02/03, D-52).
//!
//! Small image files only — never book EPUB bytes. Path-confined like fonts
//! (T-04-path). No cover bytes returned over IPC from list APIs.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// Max cover file size accepted for cache (5 MiB).
pub const MAX_COVER_BYTES: u64 = 5 * 1024 * 1024;

/// `app_data_dir()/covers`, created if missing.
pub fn covers_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录：{e}"))?
        .join("covers");
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建封面目录：{e}"))?;
    Ok(dir)
}

/// Flat safe work_id for cover filenames (hex / alnum / hyphen only).
pub fn is_safe_cover_id(id: &str) -> bool {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") || id.contains('.')
    {
        return false;
    }
    id.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Write cover bytes to `covers/{work_id}.{ext}`; returns relative file name.
pub fn write_cover_file(
    covers_dir: &Path,
    work_id: &str,
    bytes: &[u8],
    ext: &str,
) -> Result<String, String> {
    if !is_safe_cover_id(work_id) {
        return Err("无效的封面 id。".to_string());
    }
    if bytes.is_empty() {
        return Err("封面为空。".to_string());
    }
    if bytes.len() as u64 > MAX_COVER_BYTES {
        return Err("封面文件过大。".to_string());
    }
    let ext = sanitize_ext(ext);
    let file_name = format!("{work_id}.{ext}");
    let dest = covers_dir.join(&file_name);
    if !dest.starts_with(covers_dir) {
        return Err("封面路径无效。".to_string());
    }
    fs::write(&dest, bytes).map_err(|e| format!("写入封面失败：{e}"))?;
    Ok(file_name)
}

fn sanitize_ext(ext: &str) -> &str {
    match ext.to_ascii_lowercase().as_str() {
        "png" => "png",
        "jpg" | "jpeg" => "jpg",
        "gif" => "gif",
        "webp" => "webp",
        "svg" => "svg",
        _ => "bin",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_ids() {
        assert!(!is_safe_cover_id("../x"));
        assert!(!is_safe_cover_id("a.b"));
        assert!(is_safe_cover_id("abc123"));
    }

    #[test]
    fn write_cover_round_trip() {
        let dir = std::env::temp_dir().join(format!(
            "pillow-covers-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let name = write_cover_file(&dir, "deadbeef", b"fakepng", "png").unwrap();
        assert_eq!(name, "deadbeef.png");
        assert_eq!(fs::read(dir.join(&name)).unwrap(), b"fakepng");
        let _ = fs::remove_dir_all(&dir);
    }
}
