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
use pillowtome_core::publication::{is_epub, EpubPublication, Publication};
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
        // The OCF DRM gate only applies to EPUB. MOBI/AZW3/PDF/TXT/FB2/CBZ are
        // rendered by foliate-js — let them through (a DRM-locked Kindle book
        // will fail to render there with its own clear message).
        Ok(bytes) if !is_epub(&bytes) => ProtectionDecision::render(),
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

/// Outcome of catalog ingest for one EPUB (LIB-01, D-51).
///
/// Small struct only — never book/cover bytes (D-06). Frontend writes
/// `library_item` via plugin-sql using these fields.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestResult {
    pub status: String, // imported | skipped_duplicate | refused
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl IngestResult {
    fn imported(
        source_id: String,
        work_id: String,
        content_hash: String,
        title: String,
        author: Option<String>,
        cover_file: Option<String>,
    ) -> Self {
        Self {
            status: "imported".into(),
            source_id: Some(source_id),
            work_id: Some(work_id),
            content_hash: Some(content_hash),
            title: Some(title),
            author,
            cover_file,
            message: None,
        }
    }

    fn skipped_duplicate(work_id: String, title_hint: &str) -> Self {
        Self {
            status: "skipped_duplicate".into(),
            source_id: None,
            work_id: Some(work_id),
            content_hash: None,
            title: Some(title_hint.to_string()),
            author: None,
            cover_file: None,
            message: Some("书库中已有".into()),
        }
    }

    fn refused(message: &str) -> Self {
        Self {
            status: "refused".into(),
            source_id: None,
            work_id: None,
            content_hash: None,
            title: None,
            author: None,
            cover_file: None,
            message: Some(message.to_string()),
        }
    }
}

/// Aggregate folder-scan summary (D-53).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub imported: u32,
    pub skipped_duplicate: u32,
    pub failed: u32,
    pub messages: Vec<String>,
    /// Successfully ingested entries (for frontend SQL insert).
    pub items: Vec<IngestResult>,
}

/// Catalog-aware import of one EPUB (register handle + extract meta/cover).
///
/// Does **not** write SQLite — frontend inserts `library_item` with bound params.
/// Duplicate detection is by content_hash / work_id (D-51): when `known_hashes`
/// contains the hash, returns `skipped_duplicate` without registering a second shelf intent.
#[tauri::command]
pub async fn library_ingest(
    app: AppHandle,
    registry: State<'_, SourceRegistry>,
    path: Option<String>,
    known_hashes: Option<Vec<String>>,
) -> Result<IngestResult, String> {
    let source = pick_source(&app, path).await?;
    Ok(ingest_source(&app, &registry, source, known_hashes.as_deref()))
}

/// Persist a cover image extracted client-side (Phase B): MOBI/AZW3/PDF covers
/// come from foliate-js (`book.getCover()`) at open time, since the Rust core
/// has no parser for those formats. Path-confined to `covers/{work_id}.{ext}`.
#[tauri::command]
pub fn save_cover(
    app: AppHandle,
    work_id: String,
    bytes: Vec<u8>,
    ext: String,
) -> Result<String, String> {
    let dir = crate::covers::covers_dir(&app)?;
    crate::covers::write_cover_file(&dir, &work_id, &bytes, &ext)
}

/// Desktop: recursive scan of a folder for `.epub` (D-50, D-53).
///
/// Android SAF tree walk is not fully wired here — returns a clear message so
/// the UI can fall back / show 简体中文 guidance. Desktop walks recursively.
#[tauri::command]
pub async fn library_scan_folder(
    app: AppHandle,
    registry: State<'_, SourceRegistry>,
    dir: Option<String>,
    known_hashes: Option<Vec<String>>,
) -> Result<ScanSummary, String> {
    #[cfg(target_os = "android")]
    {
        let _ = (app, registry, dir, known_hashes);
        return Err("Android 文件夹扫描将使用系统目录授权；当前请使用「导入书籍」。".into());
    }
    #[cfg(not(target_os = "android"))]
    {
        let dir = dir.ok_or_else(|| "未选择文件夹".to_string())?;
        let root = std::path::PathBuf::from(&dir);
        if !root.is_dir() {
            return Err("无效的文件夹。".into());
        }
        let mut known: std::collections::HashSet<String> =
            known_hashes.unwrap_or_default().into_iter().collect();
        let mut summary = ScanSummary {
            imported: 0,
            skipped_duplicate: 0,
            failed: 0,
            messages: Vec::new(),
            items: Vec::new(),
        };
        let mut paths: Vec<std::path::PathBuf> = Vec::new();
        collect_epubs(&root, &mut paths);
        for p in paths {
            let source = BookSource::Path(p.clone());
            let known_vec: Vec<String> = known.iter().cloned().collect();
            let result = ingest_source(&app, &registry, source, Some(&known_vec));
            match result.status.as_str() {
                "imported" => {
                    summary.imported += 1;
                    if let Some(h) = result.content_hash.clone() {
                        known.insert(h);
                    }
                    if let Some(w) = result.work_id.clone() {
                        known.insert(w);
                    }
                    summary.items.push(result);
                }
                "skipped_duplicate" => summary.skipped_duplicate += 1,
                _ => {
                    summary.failed += 1;
                    if let Some(m) = result.message {
                        let name = p
                            .file_name()
                            .map(|n| n.to_string_lossy().into_owned())
                            .unwrap_or_else(|| p.display().to_string());
                        summary.messages.push(format!("{name}：{m}"));
                    }
                }
            }
        }
        Ok(summary)
    }
}

fn collect_epubs(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_epubs(&path, out);
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("epub"))
            .unwrap_or(false)
        {
            out.push(path);
        }
    }
}

/// Display title for a non-EPUB import: the file name without its extension.
/// (Per-format metadata — MOBI header, PDF info dict — is a later phase.)
fn filename_title(app: &AppHandle, source: &BookSource) -> String {
    let name = source_name(app, source);
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && ext.len() <= 5 => stem.to_string(),
        _ => name,
    }
}

fn ingest_source(
    app: &AppHandle,
    registry: &SourceRegistry,
    source: BookSource,
    known_hashes: Option<&[String]>,
) -> IngestResult {
    let bytes = match resolve_bytes(&source, app) {
        Ok(b) => b,
        Err(_) => return IngestResult::refused("无法读取书籍文件。"),
    };
    // Content hash is format-agnostic (blake3 of raw bytes) — dedup works for any
    // format. Only EPUB gets the OCF DRM gate + OPF metadata/cover extraction.
    let content_hash = EpubPublication::from_bytes(&bytes).content_hash();
    let work_id = work_id_from_hash(&content_hash);
    let epub = is_epub(&bytes);

    if let Some(known) = known_hashes {
        if known.iter().any(|h| h == &content_hash || h == &work_id) {
            let title = if epub {
                EpubPublication::metadata_from_bytes(&bytes).title
            } else {
                filename_title(app, &source)
            };
            return IngestResult::skipped_duplicate(work_id, &title);
        }
    }

    if epub {
        let decision = decide(detect_protection(&bytes));
        if !decision.can_render {
            return IngestResult::refused(
                decision
                    .message
                    .as_deref()
                    .unwrap_or("无法打开：不支持的书籍。"),
            );
        }
        let meta = EpubPublication::metadata_from_bytes(&bytes);
        let cover_file = EpubPublication::cover_from_bytes(&bytes).and_then(|cover| {
            let dir = crate::covers::covers_dir(app).ok()?;
            crate::covers::write_cover_file(&dir, &work_id, &cover.bytes, cover.ext).ok()
        });
        let id = book_id(&source);
        registry.register(id.clone(), source);
        IngestResult::imported(id, work_id, content_hash, meta.title, meta.author, cover_file)
    } else {
        // MOBI / AZW3 / PDF / TXT / FB2 / CBZ — foliate-js renders these by
        // content sniffing; use the filename as the title (no cover yet). A
        // DRM-locked Kindle book will simply fail to render with a clear message.
        let title = filename_title(app, &source);
        let id = book_id(&source);
        registry.register(id.clone(), source);
        IngestResult::imported(id, work_id, content_hash, title, None, None)
    }
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

/// Show the Android SAF picker, **copy the bytes into the app-private book
/// vault**, and wrap the local copy (FND-03, hardened for real devices).
///
/// Earlier builds registered the raw `content://` URI behind a persisted SAF
/// grant. On several real devices (OEM providers, release-signed APKs) reading
/// that URI later fails or yields garbage, surfacing as「文件已损坏」at import
/// or on reopen. Copying at pick time needs no manifest permission, no
/// persisted grant, and survives force-stop / reinstall-permitting upgrades —
/// the vault is plain private storage the OS can never revoke.
#[cfg(target_os = "android")]
async fn pick_source(app: &AppHandle, _path: Option<String>) -> Result<BookSource, String> {
    use tauri_plugin_android_fs::{AndroidFsExt, FileUri};

    // Accept all supported book formats. Many sideloaded ebooks report a generic
    // MIME (octet-stream), so include it too; the ingest classifies by content.
    let picker = app.android_fs_async().file_picker();
    let uri = picker
        .pick_file(
            None,
            &[
                "application/epub+zip",
                "application/x-mobipocket-ebook",
                "application/vnd.amazon.ebook",
                "application/pdf",
                "text/plain",
                "application/octet-stream",
            ],
            false,
        )
        .await
        .map_err(|e| format!("打开文件选择器失败：{e}"))?
        .ok_or_else(|| "已取消导入".to_string())?;

    copy_content_uri_to_vault(app, &uri.uri).await
}

/// `app_data_dir()/books` — the private book vault on Android (FND-03).
#[cfg(target_os = "android")]
fn books_vault_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录：{e}"))?
        .join("books");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建书籍目录：{e}"))?;
    Ok(dir)
}

/// Keep the display name (CJK included) but strip anything path-hostile.
#[cfg(target_os = "android")]
fn sanitize_file_name(name: &str) -> String {
    let name = name.trim();
    let cleaned: String = name
        .chars()
        .map(|c| {
            if "/\\:*?\"<>|".contains(c) || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim_matches('_').trim().to_string();
    if cleaned.is_empty() {
        "book.epub".to_string()
    } else {
        cleaned
    }
}

/// First free path for `name` inside `dir` (`name`, `stem-1.ext`, …).
#[cfg(target_os = "android")]
fn unique_book_path(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() && e.len() <= 5 => (s.to_string(), format!(".{e}")),
        _ => (name.to_string(), String::new()),
    };
    for i in 1..1000u32 {
        let p = dir.join(format!("{stem}-{i}{ext}"));
        if !p.exists() {
            return p;
        }
    }
    dir.join(format!("{stem}-{}{}", std::process::id(), ext))
}

/// Read a SAF `content://` URI fully and store it in the private vault;
/// returns the [`BookSource::Path`] of the copy.
#[cfg(target_os = "android")]
async fn copy_content_uri_to_vault(app: &AppHandle, uri: &str) -> Result<BookSource, String> {
    use tauri_plugin_android_fs::{AndroidFsExt, FileUri};

    let file_uri = FileUri::from_uri(uri);
    let name = sanitize_file_name(
        &app.android_fs()
            .get_name(&file_uri)
            .unwrap_or_else(|_| "book.epub".to_string()),
    );
    let app2 = app.clone();
    let uri_owned = uri.to_string();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        app2.android_fs().read(&FileUri::from_uri(&uri_owned))
    })
    .await
    .map_err(|e| format!("读取所选文件失败：{e}"))?
    .map_err(|e| format!("无法读取所选文件（可能已被移动或删除）：{e}"))?;
    if bytes.is_empty() {
        return Err("所选文件内容为空。".to_string());
    }
    let dir = books_vault_dir(app)?;
    let path = unique_book_path(&dir, &name);
    std::fs::write(&path, &bytes).map_err(|e| format!("保存书籍失败：{e}"))?;
    Ok(BookSource::Path(path))
}

/// Pick up a book staged by `MainActivity.handleOpenIntent` (Android「打开方式」)
/// and ingest it into the catalog. Returns `None` when nothing is staged.
///
/// The staged copy is MOVED into the vault before ingest, so polling is
/// idempotent: the marker files are consumed exactly once.
#[tauri::command]
pub fn take_pending_open(
    app: AppHandle,
    registry: State<'_, SourceRegistry>,
    known_hashes: Option<Vec<String>>,
) -> Result<Option<IngestResult>, String> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, registry, known_hashes);
        return Ok(None);
    }
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let base = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("无法定位应用数据目录：{e}"))?;
        let payload = base.join("pending_open.epub");
        if !payload.exists() {
            return Ok(None);
        }
        let name = std::fs::read_to_string(base.join("pending_open.name"))
            .unwrap_or_else(|_| "book.epub".to_string());
        let dir = books_vault_dir(&app)?;
        let dest = unique_book_path(&dir, &sanitize_file_name(&name));
        if std::fs::rename(&payload, &dest).is_err() {
            std::fs::copy(&payload, &dest)
                .and_then(|_| std::fs::remove_file(&payload))
                .map_err(|e| format!("保存书籍失败：{e}"))?;
        }
        let _ = std::fs::remove_file(base.join("pending_open.name"));
        let result = ingest_source(
            &app,
            &registry,
            BookSource::Path(dest.clone()),
            known_hashes.as_deref(),
        );
        if result.status != "imported" {
            let _ = std::fs::remove_file(&dest);
        }
        Ok(Some(result))
    }
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
    fn is_epub_only_true_for_ocf_zip() {
        // PDF / MOBI(PalmDB) / plain text / random bytes are NOT epub → they take
        // the "render-anything" ingest path instead of the EPUB DRM/meta gate.
        assert!(!is_epub(b"%PDF-1.7\n..."));
        assert!(!is_epub(b"BOOKMOBI kindle-ish header"));
        assert!(!is_epub("第一章 纯文本小说\n正文……".as_bytes()));
        assert!(!is_epub(b"not a zip at all"));
        // A zip without META-INF/container.xml is not an epub either.
        assert!(!is_epub(b"PK\x03\x04 truncated zip"));
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

    /// Torture soft-fail matrix (02-04): corrupt / DRM / font-obfuscated / random
    /// bytes must never panic through [`decide`] + [`detect_protection`].
    /// FXL is a layout concern (UI disables reflow knobs); protection path still
    /// must soft-fail on unreadable bytes rather than abort the process.
    #[test]
    fn torture_soft_fail_decide_matrix() {
        // (1) corrupt → can_render false, soft 简体中文 message
        let corrupt = decide(Err(CoreError::Corrupt));
        assert!(!corrupt.can_render);
        assert_eq!(corrupt.message.as_deref(), Some("文件已损坏，无法打开。"));

        // (2) content DRM refuse
        let drm = decide(Ok(Protection::ContentDrm("Adobe ADEPT")));
        assert!(!drm.can_render);
        assert_eq!(drm.message.as_deref(), Some("无法打开：不支持的加密书籍。"));

        // (3) font-obfuscated still can_render true
        assert!(decide(Ok(Protection::FontObfuscationOnly)).can_render);

        // (4) random / garbage bytes: detect never panics; decide soft-fails
        let random = b"\x00\xff not-an-epub \x7f\x80 random-bytes-for-soft-fail";
        let detected = detect_protection(random);
        let decision = decide(detected);
        assert!(!decision.can_render);
        assert!(decision.message.is_some());

        // Truncated PK zip prefix also soft-fails without panic.
        let truncated = b"PK\x03\x04 truncated";
        let decision2 = decide(detect_protection(truncated));
        assert!(!decision2.can_render);
        assert!(decision2.message.is_some());
    }
}
