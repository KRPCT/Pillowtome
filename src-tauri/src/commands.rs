//! IPC command surface.
//!
//! Only small structured data (metadata, locators, settings, and the DRM-gate
//! verdict below) is allowed to cross Tauri IPC here. **Book bytes never cross
//! IPC (D-06)** — they stream to the WebView exclusively via the `pillow://`
//! custom protocol (see [`crate::protocol`]).
//!
//! [`check_protection`] is the pre-render safety gate (D-10): before the reader
//! fetches a book over `pillow://`, it asks the core to classify the file. The
//! bytes are read here on the Rust side and only the *verdict* (a tiny struct)
//! is returned — the book itself is never serialized across the bridge.

use serde::Serialize;
use tauri::{AppHandle, State};

use pillowtome_core::error::CoreError;
use pillowtome_core::protection::{detect_protection, Protection};
use pillowtome_core::publication::{EpubPublication, Publication};
use pillowtome_core::source::BookSource;

use crate::storage::{resolve_bytes, SourceRegistry};

/// Result of the pre-render DRM/corruption gate, shaped for the WebView.
///
/// `can_render` is the only branch the reader needs: when `false`, `message`
/// carries end-user 简体中文 copy for the error card. Only this small struct
/// crosses IPC — never book bytes (D-06).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectionDecision {
    pub can_render: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl ProtectionDecision {
    fn render() -> Self {
        Self { can_render: true, message: None }
    }

    fn refuse(message: &str) -> Self {
        Self { can_render: false, message: Some(message.to_string()) }
    }
}

/// Map a protection-detection result to a render/refuse decision (pure, so it is
/// unit-testable off-device). Font-obfuscation-only books render normally per
/// D-10; content DRM / unknown encryption / corruption refuse with clean copy.
pub fn decide(detected: Result<Protection, CoreError>) -> ProtectionDecision {
    match detected {
        // Clean, or only fonts obfuscated (not content DRM, Pitfall 4) — render.
        Ok(Protection::None) | Ok(Protection::FontObfuscationOnly) => ProtectionDecision::render(),
        // Retailer content DRM / unknown encryption — refuse, never decrypt (D-10).
        Ok(Protection::ContentDrm(_)) | Ok(Protection::Unknown) => {
            ProtectionDecision::refuse("无法打开：不支持的加密书籍。")
        }
        // Damaged / truncated / not a valid EPUB — soft-fail, no crash (Pitfall 5).
        Err(CoreError::Corrupt) => ProtectionDecision::refuse("文件已损坏，无法打开。"),
        Err(CoreError::Drm(_)) => ProtectionDecision::refuse("无法打开：不支持的加密书籍。"),
        Err(CoreError::Unsupported) => ProtectionDecision::refuse("无法打开：不支持的书籍格式。"),
        Err(CoreError::Io(_)) => ProtectionDecision::refuse("无法读取书籍文件。"),
    }
}

/// Pre-render DRM/corruption gate for the book registered under `id`.
///
/// Reads the backing file (resolved only through the registry — never a
/// caller-supplied path, threat T-01-01), classifies it in the portable core,
/// and returns the render/refuse verdict. The book bytes are NOT returned; the
/// WebView fetches them separately over `pillow://` only when `can_render`.
#[tauri::command]
pub fn check_protection(
    id: String,
    app: AppHandle,
    registry: State<'_, SourceRegistry>,
) -> ProtectionDecision {
    let Some(source) = registry.resolve(&id) else {
        return ProtectionDecision::refuse("找不到该书籍。");
    };
    // Bytes are read in Rust (from disk, or a SAF content:// URI on Android);
    // only the verdict crosses IPC (D-06).
    match resolve_bytes(&source, &app) {
        Ok(bytes) => decide(detect_protection(&bytes)),
        Err(_) => ProtectionDecision::refuse("无法读取书籍文件。"),
    }
}

/// Result of [`ensure_work`]: stable `work_id` + blake3 `content_hash` for the
/// frontend to `INSERT OR IGNORE` into `work` via plugin-sql.
///
/// **Never** carries book bytes (D-06 / T-02-ipc). Rust hashes in-process;
/// only these two strings cross IPC.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureWorkResult {
    pub work_id: String,
    pub content_hash: String,
}

/// Derive a stable `work_id` from a blake3 content hash.
///
/// Choice (D-26): use the 64-char blake3 hex as `work_id` directly rather than
/// UUID v5 (crate only enables `v4`). Same content → same id across devices;
/// content-addressed identity matches schema v1 `content_hash` semantics.
/// Fallback when hashing is impossible: `work-{registry_id}` (must not block open).
pub fn work_id_from_hash(content_hash: &str) -> String {
    content_hash.to_string()
}

/// Fallback work id when bytes cannot be hashed — still deterministic per registry id.
pub fn work_id_fallback(registry_id: &str) -> String {
    format!("work-{registry_id}")
}

/// Map a registered book id → stable `work_id` for locator rows (D-26).
///
/// Resolves only via [`SourceRegistry`] + [`resolve_bytes`] (T-02-path). Reads
/// bytes in Rust, hashes with [`EpubPublication::from_bytes`], returns only
/// `{ workId, contentHash }` — never book bytes (D-06). Soft-fails to a
/// deterministic `work-{id}` fallback so open is never blocked.
#[tauri::command]
pub fn ensure_work(
    id: String,
    app: AppHandle,
    registry: State<'_, SourceRegistry>,
) -> Result<EnsureWorkResult, String> {
    let Some(source) = registry.resolve(&id) else {
        // Soft fallback — must not block open (D-26).
        let work_id = work_id_fallback(&id);
        return Ok(EnsureWorkResult {
            content_hash: work_id.clone(),
            work_id,
        });
    };

    match resolve_bytes(&source, &app) {
        Ok(bytes) => {
            let pubn = EpubPublication::from_bytes(&bytes);
            let content_hash = pubn.content_hash();
            let work_id = work_id_from_hash(&content_hash);
            Ok(EnsureWorkResult {
                work_id,
                content_hash,
            })
        }
        Err(_) => {
            let work_id = work_id_fallback(&id);
            Ok(EnsureWorkResult {
                content_hash: work_id.clone(),
                work_id,
            })
        }
    }
}

/// A book that has been registered in the [`SourceRegistry`], shaped for the UI.
///
/// Only the opaque `id` and a display `name` cross IPC — never the book bytes or
/// a raw path (D-05/D-06). The frontend builds the `pillow://` URL from `id`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedBook {
    pub id: String,
    pub name: String,
}

/// Whether this build targets Android — lets the frontend pick the import path
/// (desktop `dialog.open` vs the Android SAF picker driven in Rust).
#[tauri::command]
pub fn is_android() -> bool {
    cfg!(target_os = "android")
}

/// Import a book from device storage through the opaque [`BookSource`] handle
/// (FND-03), register it, and return its id + display name.
///
/// Desktop: the frontend picks a path via `dialog.open` and passes it here; it
/// becomes `BookSource::Path`. Android: `path` is ignored and the SAF picker is
/// shown in Rust, the returned `content://` URI's permission is **persisted**
/// (`takePersistableUriPermission`) so it survives a restart, and it becomes
/// `BookSource::ContentUri`. Book bytes never cross IPC (D-06) — only id/name.
#[tauri::command]
pub async fn import(
    app: AppHandle,
    registry: State<'_, SourceRegistry>,
    path: Option<String>,
) -> Result<ImportedBook, String> {
    let source = pick_source(&app, path).await?;
    let id = book_id(&source);
    let name = source_name(&app, &source);
    registry.register(id.clone(), source);
    Ok(ImportedBook { id, name })
}

/// List currently-registered imported books (excluding the bundled `sample`).
///
/// On Android this includes handles re-hydrated from persisted SAF grants at
/// launch, so a previously imported book reappears after a restart (FND-03).
#[tauri::command]
pub fn imported_books(app: AppHandle, registry: State<'_, SourceRegistry>) -> Vec<ImportedBook> {
    let mut books: Vec<ImportedBook> = registry
        .ids()
        .into_iter()
        .filter(|id| id != crate::SAMPLE_ID)
        .filter_map(|id| {
            let source = registry.resolve(&id)?;
            let name = source_name(&app, &source);
            Some(ImportedBook { id, name })
        })
        .collect();
    books.sort_by(|a, b| a.name.cmp(&b.name));
    books
}

/// A stable id derived from the handle, so a freshly imported book and the same
/// book re-hydrated after a restart share one id. Only `[0-9a-f-]` — passes
/// `sanitize_id` (no `/`, `\`, or `..`).
pub(crate) fn book_id(source: &BookSource) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    match source {
        BookSource::Path(p) => p.hash(&mut hasher),
        BookSource::ContentUri(u) => u.hash(&mut hasher),
    }
    format!("import-{:016x}", hasher.finish())
}

/// A human-facing display name for a handle (best-effort; falls back to the id).
fn source_name<R: tauri::Runtime>(app: &AppHandle<R>, source: &BookSource) -> String {
    match source {
        BookSource::Path(p) => p
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| book_id(source)),
        BookSource::ContentUri(uri) => content_uri_name(app, uri).unwrap_or_else(|| book_id(source)),
    }
}

#[cfg(target_os = "android")]
fn content_uri_name<R: tauri::Runtime>(app: &AppHandle<R>, uri: &str) -> Option<String> {
    use tauri_plugin_android_fs::{AndroidFsExt, FileUri};
    app.android_fs().get_name(&FileUri::from_uri(uri)).ok()
}

#[cfg(not(target_os = "android"))]
fn content_uri_name<R: tauri::Runtime>(_app: &AppHandle<R>, _uri: &str) -> Option<String> {
    None
}

/// Resolve the user's pick into a [`BookSource`], per platform.
#[cfg(not(target_os = "android"))]
async fn pick_source(_app: &AppHandle, path: Option<String>) -> Result<BookSource, String> {
    let path = path.ok_or_else(|| "未选择文件".to_string())?;
    Ok(BookSource::Path(std::path::PathBuf::from(path)))
}

/// Show the Android SAF picker, persist the grant, and wrap the URI (FND-03).
#[cfg(target_os = "android")]
async fn pick_source(app: &AppHandle, _path: Option<String>) -> Result<BookSource, String> {
    use tauri_plugin_android_fs::AndroidFsExt;

    let picker = app.android_fs_async().file_picker();
    let uri = picker
        .pick_file(None, &["application/epub+zip"], false)
        .await
        .map_err(|e| format!("打开文件选择器失败：{e}"))?
        .ok_or_else(|| "已取消导入".to_string())?;

    // takePersistableUriPermission — the grant must survive a full app restart
    // so the book reopens without re-granting (FND-03, the hard part).
    picker
        .persist_uri_permission(&uri)
        .await
        .map_err(|e| format!("无法持久化访问授权：{e}"))?;

    Ok(BookSource::ContentUri(uri.uri))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_and_font_obfuscation_render() {
        assert!(decide(Ok(Protection::None)).can_render);
        assert!(decide(Ok(Protection::FontObfuscationOnly)).can_render);
    }

    #[test]
    fn content_drm_and_unknown_refuse_as_unsupported() {
        let drm = decide(Ok(Protection::ContentDrm("Adobe ADEPT")));
        assert!(!drm.can_render);
        assert_eq!(drm.message.as_deref(), Some("无法打开：不支持的加密书籍。"));
        assert!(!decide(Ok(Protection::Unknown)).can_render);
    }

    #[test]
    fn corrupt_soft_fails_with_damaged_copy() {
        let d = decide(Err(CoreError::Corrupt));
        assert!(!d.can_render);
        assert_eq!(d.message.as_deref(), Some("文件已损坏，无法打开。"));
    }

    #[test]
    fn refuse_always_carries_a_message() {
        for d in [
            decide(Ok(Protection::ContentDrm("Kindle"))),
            decide(Ok(Protection::Unknown)),
            decide(Err(CoreError::Corrupt)),
            decide(Err(CoreError::Unsupported)),
        ] {
            assert!(!d.can_render);
            assert!(d.message.is_some());
        }
    }

    #[test]
    fn work_id_is_content_hash_hex() {
        let pubn = EpubPublication::from_bytes(b"PK\x03\x04 ensure_work fixture");
        let hash = pubn.content_hash();
        assert_eq!(work_id_from_hash(&hash), hash);
        assert_eq!(hash.len(), 64);
    }

    #[test]
    fn work_id_fallback_is_deterministic() {
        assert_eq!(work_id_fallback("sample"), "work-sample");
        assert_eq!(work_id_fallback("import-abc"), "work-import-abc");
    }

    #[test]
    fn ensure_work_result_is_strings_only() {
        let result = EnsureWorkResult {
            work_id: "abc".into(),
            content_hash: "def".into(),
        };
        // EnsureWorkResult carries only work_id + content_hash strings — never bytes (D-06).
        assert_eq!(result.work_id, "abc");
        assert_eq!(result.content_hash, "def");
        assert_eq!(std::mem::size_of_val(&result.work_id), std::mem::size_of::<String>());
    }
}
