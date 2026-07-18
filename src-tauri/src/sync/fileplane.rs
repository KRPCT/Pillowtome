//! File plane (SYNC-04, plan 07-03) — per-book opt-in upload of book bytes to
//! the user's self-hosted WebDAV root, and on-demand ranged download on the
//! peer device (D-98 / D-99).
//!
//! Upload is a threshold state machine ([`planner::needs_chunking`]):
//!
//! - below 10MB: a single streaming conditional PUT — the request body IS the
//!   open `tokio::fs::File` via `Body::from`, plus `If-None-Match: *` — so the
//!   book never enters memory (Pitfall 4; the high-level dav `put` that takes
//!   a byte vector is never used here);
//! - at/above 10MB: a server-capability branch. Nextcloud speaks its private
//!   chunked-upload v2 protocol (MKCOL upload dir, zero-padded integer chunk
//!   names, `Destination` on EVERY request, `OC-Total-Length` quota precheck,
//!   MOVE `.file` assembly, 423/504 retry, 24h expiry). Generic RFC-4918
//!   servers have no server-side assembly, so they get an honest streaming
//!   whole-file PUT with bounded restart-from-zero retry — the adopted
//!   research-Q1 correction to D-101 (no invented "chunk PUT sequence").
//!
//! Download probes range support with a `Range: bytes=0-0` GET, streams 10MB
//! slices into `<file>.part` with resume (the cursor is the `.part` length on
//! disk — self-healing), then enforces blake3 == work_id (the D-100 single
//! source of truth) before renaming into the app-owned books dir and
//! registering the source. A mismatching payload is deleted — it never gets
//! renamed, registered, or written anywhere the library can see.
//!
//! Memory discipline (T-07-03-04): upload bodies stream from disk or use one
//! bounded ≤10MB chunk buffer; download appends streamed response chunks and
//! hashes with a 64KB buffer. No path in this module holds a whole book in
//! memory (the one documented exception is Android SAF staging in the caller —
//! a pre-existing platform constraint, identical to every book open today).
//!
//! Progress NEVER becomes an event here: the only output is the in-process
//! [`FileProgress`] sink report (`{ work_id, direction, done, total, message
//! }`, no bytes — D-06); the 07-02 engine folds it into the unified
//! `sync-status` event and is its sole emitter. Nothing in this module logs
//! URLs (which can carry credentials), headers, or error internals (V7).

use std::collections::BTreeSet;
use std::path::Path;
use std::time::{Duration, Instant};

use pillowtome_core::source::BookSource;
use pillowtome_core::sync::fileplane as planner;
use pillowtome_core::sync::remote;
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use super::now_ms;
use super::transport;
use crate::storage::SourceRegistry;

/// Generous per-request bound for transfer bodies (2h) — a 300MB book over a
/// slow uplink must not hit the 60s control timeout; PROPFIND/MKCOL control
/// calls keep the transport's 60s default (plan Task 1 step 6).
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(2 * 3600);

/// Bounded retry for transfer requests (429/503 throttling, 423 Locked during
/// assembly, 504 slow storage, transient connect errors): base 1s, doubling,
/// capped at 30s, at most this many attempts (T-07-03-05).
const MAX_TRANSFER_ATTEMPTS: u32 = 5;

/// Progress reports throttle to one per this window per transfer; completion
/// and failure always report immediately.
const PROGRESS_THROTTLE: Duration = Duration::from_millis(500);

/// Download integrity-verification buffer (64KB) — streamed, bounded.
const HASH_BUF: usize = 64 * 1024;

/// Everything an upload/download needs, built by the caller (commands layer
/// for IPC, tests by hand) from 07-01's transport pieces. `dav` is the
/// configured `reqwest_dav` client (high-level PROPFIND); `agent` is the SAME
/// injected reqwest agent it carries (D-95 TLS/http switches single-sourced —
/// this module never builds its own reqwest client). `server_dav_root` is the
/// DAV endpoint root (`dav.host`); `remote_root` is the configured
/// `pillowtome/`-style root the book paths are jailed under.
pub struct FilePlaneCtx {
    pub dav: reqwest_dav::Client,
    pub agent: reqwest::Client,
    pub server_dav_root: String,
    pub username: String,
    pub remote_root: String,
}

/// Transfer direction for a progress report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileDirection {
    Download,
    Upload,
}

/// In-process progress report into the 07-02 engine's sink. No IPC, no bytes
/// (D-06). `message` carries the classified Chinese failure copy on terminal
/// failure reports; success completion is `done == total` with `None`.
#[derive(Debug, Clone, PartialEq)]
pub struct FileProgress {
    pub work_id: String,
    pub direction: FileDirection,
    pub done: u64,
    pub total: u64,
    pub message: Option<String>,
}

/// Classified file-plane errors. Users only ever see [`FileError::user_message`]
/// (D-30 简体中文); raw OS/server text never crosses out of this module (V7).
/// Tests assert on variants, never on strings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileError {
    /// Local disk read/write failure (missing book file, unwritable dir).
    Io,
    /// Connect/timeout/DNS failure.
    Unreachable,
    /// TLS certificate validation failed.
    Certificate,
    /// 401 — bad username or app password.
    Auth,
    /// 403 — no write permission on the remote directory.
    Permission,
    /// 429/503 after bounded backoff — 坚果云-class throttling.
    RateLimited,
    /// Payload exceeds a server limit. Carries its own classified copy:
    /// Nutstore >500MB pre-flight and HTTP 413 use the 单文件大小限制 message;
    /// 507 quota uses 服务器存储空间不足.
    TooLarge(&'static str),
    /// `If-None-Match: *` answered 412 and the re-PROPFIND shows a DIFFERENT
    /// size — a same-name different-bytes file already exists remotely.
    RemoteConflict,
    /// Downloaded bytes failed the blake3 == work_id gate (D-100).
    IntegrityMismatch,
    /// Download transport failure / remote file gone (UI-SPEC download copy).
    DownloadFailed,
    /// Anything else. Never leaks internals.
    Internal,
}

impl FileError {
    /// The exact classified copy for each class — rendered verbatim by the
    /// 同步失败：{原因} toast path (D-93) and the download card states.
    pub fn user_message(&self) -> &'static str {
        match self {
            FileError::Io => "无法读取或写入本地文件",
            FileError::Unreachable => "无法连接到服务器，请检查地址",
            FileError::Certificate => "证书校验失败，可开启「信任自签名证书」",
            FileError::Auth => "认证失败，请检查用户名和应用密码",
            FileError::Permission => "没有目录写入权限，请检查路径",
            FileError::RateLimited => "服务器限流，请稍后重试",
            FileError::TooLarge(msg) => msg,
            FileError::RemoteConflict => "远端已存在同名文件，已取消本次上传",
            FileError::IntegrityMismatch => "下载校验失败，文件可能已损坏，请重试",
            FileError::DownloadFailed => "下载失败，请检查网络后重试",
            FileError::Internal => "同步失败，请稍后重试",
        }
    }
}

/// What a finished download hands back (D-100 hand-off). serde camelCase on
/// the wire: `{ workId, sourceId, localPath }` — small struct only (D-06).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedBook {
    pub work_id: String,
    pub source_id: String,
    pub local_path: String,
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/// Apply the client's configured auth to a raw-agent request. reqwest_dav only
/// authenticates its own high-level methods (`start_request`); the raw agent
/// sends nothing unless we add it — every file-plane request goes through this.
fn authed(ctx: &FilePlaneCtx, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    match &ctx.dav.auth {
        reqwest_dav::Auth::Basic(username, password) => {
            builder.basic_auth(username.clone(), Some(password.clone()))
        }
        // Digest is negotiated by reqwest_dav's high-level methods only; the
        // configured mode is always Basic (D-96). Anonymous sends nothing.
        _ => builder,
    }
}

/// Map a reqwest send-stage failure through 07-01's single classifier, then
/// into the file-plane taxonomy.
fn classify_send(err: reqwest::Error) -> FileError {
    match transport::classify(&reqwest_dav::Error::from(err)) {
        super::SyncError::Unreachable => FileError::Unreachable,
        super::SyncError::Certificate => FileError::Certificate,
        super::SyncError::Auth => FileError::Auth,
        super::SyncError::Permission => FileError::Permission,
        super::SyncError::RateLimited => FileError::RateLimited,
        _ => FileError::Internal,
    }
}

/// Map a high-level reqwest_dav failure (PROPFIND etc.) into the taxonomy.
fn classify_dav(err: &reqwest_dav::Error) -> FileError {
    match transport::classify(err) {
        super::SyncError::Unreachable => FileError::Unreachable,
        super::SyncError::Certificate => FileError::Certificate,
        super::SyncError::Auth => FileError::Auth,
        super::SyncError::Permission => FileError::Permission,
        super::SyncError::RateLimited => FileError::RateLimited,
        _ => FileError::Internal,
    }
}

/// Classify a terminal (post-retry) HTTP status on a transfer request.
fn status_error(status: u16) -> FileError {
    match status {
        401 => FileError::Auth,
        403 => FileError::Permission,
        413 => FileError::TooLarge("书籍文件超过服务器单文件大小限制，已跳过文件同步（进度与批注仍会同步）"),
        429 | 503 => FileError::RateLimited,
        507 => FileError::TooLarge("服务器存储空间不足"),
        _ => FileError::Internal,
    }
}

/// Statuses worth a bounded backoff-and-retry on transfer requests: 423 Locked
/// (Nextcloud still finalizing), 429/503 (throttling), 504 (slow storage).
fn retryable_status(status: u16) -> bool {
    matches!(status, 423 | 429 | 503 | 504)
}

/// Send a transfer request with bounded exponential backoff (base 1s, ×2, cap
/// 30s, ≤ [`MAX_TRANSFER_ATTEMPTS`] attempts). The factory rebuilds the
/// RequestBuilder per attempt — restart-from-zero semantics: a retry sends the
/// whole body again, never a partial continuation (research Q1 honesty). Both
/// retryable statuses and transient connect/timeout errors retry; everything
/// else classifies terminally.
async fn send_with_retry<F, Fut>(mut make: F) -> Result<reqwest::Response, FileError>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<reqwest::RequestBuilder, FileError>>,
{
    let mut attempt: u32 = 0;
    loop {
        match make().await {
            Ok(builder) => match builder.send().await {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    if retryable_status(status) && attempt + 1 < MAX_TRANSFER_ATTEMPTS {
                        let backoff = Duration::from_millis(1000 * 2u64.pow(attempt))
                            .min(Duration::from_secs(30));
                        tokio::time::sleep(backoff).await;
                        attempt += 1;
                        continue;
                    }
                    return Ok(resp);
                }
                Err(err) => {
                    let classified = classify_send(err);
                    if classified == FileError::Unreachable && attempt + 1 < MAX_TRANSFER_ATTEMPTS {
                        let backoff = Duration::from_millis(1000 * 2u64.pow(attempt))
                            .min(Duration::from_secs(30));
                        tokio::time::sleep(backoff).await;
                        attempt += 1;
                        continue;
                    }
                    return Err(classified);
                }
            },
            Err(err) => return Err(err),
        }
    }
}

/// Throttled progress reporter bound to one transfer. First tick always emits
/// (the UI leaves idle immediately); later ticks emit at most once per
/// [`PROGRESS_THROTTLE`]; `finish`/`fail` always emit.
struct Reporter<'a> {
    report: &'a (dyn Fn(FileProgress) + Send + Sync),
    work_id: &'a str,
    direction: FileDirection,
    total: u64,
    done: u64,
    last: Instant,
}

impl<'a> Reporter<'a> {
    fn new(
        report: &'a (dyn Fn(FileProgress) + Send + Sync),
        work_id: &'a str,
        direction: FileDirection,
        total: u64,
    ) -> Self {
        Self {
            report,
            work_id,
            direction,
            total,
            done: 0,
            // Back-date so the first tick emits immediately.
            last: Instant::now() - PROGRESS_THROTTLE,
        }
    }

    fn emit(&self, message: Option<String>) {
        (self.report)(FileProgress {
            work_id: self.work_id.to_string(),
            direction: self.direction,
            done: self.done,
            total: self.total,
            message,
        });
    }

    fn tick(&mut self, done: u64) {
        self.done = done;
        if self.last.elapsed() >= PROGRESS_THROTTLE {
            self.last = Instant::now();
            self.emit(None);
        }
    }

    /// Terminal success: done == total, no message — the engine's bridge maps
    /// this to percent 100, which removes the transfer entry.
    fn finish(&mut self) {
        self.done = self.total;
        self.emit(None);
    }

    /// Terminal failure with the classified Chinese copy (also clears the
    /// engine's transfer entry via the terminal mapping).
    fn fail(&mut self, message: &'static str) {
        self.emit(Some(message.to_string()));
    }
}

/// Jail-check a root-relative remote book path (V5): it must come from
/// `core::sync::remote`'s single builder — `<root>/books/<name>`, percent-
/// encoded per segment, no backslashes, no `..` segments. Applied to upload
/// destinations AND to download `remote_path` values pulled from untrusted
/// peer state files (T-07-03-03).
fn validate_remote_book_path(ctx: &FilePlaneCtx, remote_path: &str) -> Result<(), FileError> {
    let root = remote::normalize_root(&ctx.remote_root).map_err(|_| FileError::Internal)?;
    let prefix = format!("{root}/books/");
    let jailed = remote_path.starts_with(&prefix)
        && !remote_path.contains('\\')
        && !remote_path.split('/').any(|seg| seg == "..");
    if jailed {
        Ok(())
    } else {
        Err(FileError::Internal)
    }
}

/// work_id names local files, so it must be filesystem-safe by construction
/// (blake3 hex; fallback ids may carry `-`/`_`). Reject anything else — the
/// value arrives over IPC and must never become a path-escape vector (V5).
fn is_safe_work_id(work_id: &str) -> bool {
    !work_id.is_empty()
        && work_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Whitelisted lowercase `[a-z0-9]` extension from the remote filename,
/// default `epub` (plan Task 3 — local names derive from work_id + this ext).
fn sanitize_ext(remote_path: &str) -> String {
    let ext = remote_path
        .rsplit('/')
        .next()
        .and_then(|name| name.rsplit_once('.'))
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default();
    if !ext.is_empty()
        && ext.len() <= 8
        && ext
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
    {
        ext
    } else {
        "epub".to_string()
    }
}

/// Depth-0 PROPFIND of a root-relative remote FILE path: `Ok(Some((size,
/// etag)))` when it exists, `Ok(None)` on 404, classified error otherwise.
async fn propfind_file(
    ctx: &FilePlaneCtx,
    remote_path: &str,
) -> Result<Option<(u64, Option<String>)>, FileError> {
    // Plan text says `Depth::Zero`; reqwest_dav 0.3.3 has no such variant —
    // `Depth::Number(0)` is the depth-0 spelling (07-01 recorded the mapping).
    match ctx.dav.list(remote_path, reqwest_dav::Depth::Number(0)).await {
        Ok(entities) => Ok(entities.into_iter().find_map(|entity| match entity {
            reqwest_dav::types::list_cmd::ListEntity::File(f) => {
                Some((f.content_length.max(0) as u64, f.tag))
            }
            reqwest_dav::types::list_cmd::ListEntity::Folder(_) => None,
        })),
        Err(e) if transport::http_status_of(&e) == Some(404) => Ok(None),
        Err(e) => Err(classify_dav(&e)),
    }
}

/// Streamed blake3 hex of a local file with a bounded 64KB buffer (the D-100
/// gate; a 300MB book hashes without entering memory).
async fn blake3_file_hex(path: &Path) -> Result<String, FileError> {
    let mut file = tokio::fs::File::open(path).await.map_err(|_| FileError::Io)?;
    let mut hasher = blake3::Hasher::new();
    let mut buf = vec![0u8; HASH_BUF];
    loop {
        let n = file.read(&mut buf).await.map_err(|_| FileError::Io)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

/// mtime (unix seconds) of a local file, best-effort (X-OC-Mtime).
async fn mtime_secs(path: &Path) -> Option<i64> {
    let meta = tokio::fs::metadata(path).await.ok()?;
    let modified = meta.modified().ok()?;
    modified
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs() as i64)
}

// ---------------------------------------------------------------------------
// sync_file_state transfer rows (SCHEMA_V8 — consumed, never altered)
// ---------------------------------------------------------------------------

/// The live upload-transfer row, if any: (transfer_uuid, chunks_done, size,
/// started_at).
async fn read_upload_row(
    pool: &sqlx::SqlitePool,
    work_id: &str,
) -> Result<Option<(Option<String>, String, Option<i64>, i64)>, FileError> {
    sqlx::query_as(
        "SELECT transfer_uuid, chunks_done, size, started_at FROM sync_file_state \
         WHERE work_id = $1 AND direction = 'upload'",
    )
    .bind(work_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| FileError::Internal)
}

/// Start (or restart) an upload transfer row: fresh uuid, server-confirmed
/// chunk set, full metadata overwrite, started_at = now.
async fn upsert_upload_row(
    pool: &sqlx::SqlitePool,
    work_id: &str,
    transfer_uuid: &str,
    confirmed: &BTreeSet<u32>,
    size: u64,
    remote_path: &str,
) -> Result<(), FileError> {
    let chunks_json = serde_json::to_string(&confirmed.iter().collect::<Vec<_>>())
        .map_err(|_| FileError::Internal)?;
    let now = now_ms();
    sqlx::query(
        "INSERT INTO sync_file_state (work_id, direction, transfer_uuid, chunks_done, \
         size, hash, remote_path, started_at, updated_at) \
         VALUES ($1, 'upload', $2, $3, $4, $5, $6, $7, $7) \
         ON CONFLICT(work_id) DO UPDATE SET direction = 'upload', \
         transfer_uuid = excluded.transfer_uuid, chunks_done = excluded.chunks_done, \
         size = excluded.size, hash = excluded.hash, remote_path = excluded.remote_path, \
         started_at = excluded.started_at, updated_at = excluded.updated_at",
    )
    .bind(work_id)
    .bind(transfer_uuid)
    .bind(&chunks_json)
    .bind(size as i64)
    .bind(work_id) // work_id IS the blake3 hex (D-100) — the row's hash column
    .bind(remote_path)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|_| FileError::Internal)?;
    Ok(())
}

/// Rewrite `chunks_done` after each server-confirmed chunk PUT (the row is a
/// hint; the server-side PROPFIND stays the resume truth, T-07-03-07).
async fn update_chunks_done(
    pool: &sqlx::SqlitePool,
    work_id: &str,
    confirmed: &BTreeSet<u32>,
) -> Result<(), FileError> {
    let chunks_json = serde_json::to_string(&confirmed.iter().collect::<Vec<_>>())
        .map_err(|_| FileError::Internal)?;
    sqlx::query("UPDATE sync_file_state SET chunks_done = $1, updated_at = $2 WHERE work_id = $3")
        .bind(&chunks_json)
        .bind(now_ms())
        .bind(work_id)
        .execute(pool)
        .await
        .map_err(|_| FileError::Internal)?;
    Ok(())
}

/// A finished upload leaves the COMPLETED-metadata row the 07-02 state builder
/// reads (`direction='upload'` + `remote_path IS NOT NULL` → the book's
/// `file_sync` block rides the next push, making it downloadable on peers):
/// the scratch transfer row is deleted, then the metadata row is inserted with
/// NULL transfer_uuid and empty chunks_done.
async fn record_upload_done(
    pool: &sqlx::SqlitePool,
    work_id: &str,
    size: u64,
    remote_path: &str,
) -> Result<(), FileError> {
    sqlx::query("DELETE FROM sync_file_state WHERE work_id = $1")
        .bind(work_id)
        .execute(pool)
        .await
        .map_err(|_| FileError::Internal)?;
    let now = now_ms();
    sqlx::query(
        "INSERT INTO sync_file_state (work_id, direction, transfer_uuid, chunks_done, \
         size, hash, remote_path, started_at, updated_at) \
         VALUES ($1, 'upload', NULL, '[]', $2, $3, $4, $5, $5)",
    )
    .bind(work_id)
    .bind(size as i64)
    .bind(work_id)
    .bind(remote_path)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|_| FileError::Internal)?;
    Ok(())
}

/// Clear any transfer row for a work (download completion, integrity failure,
/// abort). Scratch state only — never user data.
async fn clear_transfer_row(pool: &sqlx::SqlitePool, work_id: &str) -> Result<(), FileError> {
    sqlx::query("DELETE FROM sync_file_state WHERE work_id = $1")
        .bind(work_id)
        .execute(pool)
        .await
        .map_err(|_| FileError::Internal)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/// Server capability for the ≥10MB branch (cached by the caller per engine
/// session if it wishes; probing is one depth-0 PROPFIND).
enum Capability {
    Nextcloud,
    Generic,
}

/// Probe `{server_dav_root}/uploads/{username}/` (plan text: `Depth::Zero` —
/// spelled `Depth::Number(0)` in reqwest_dav 0.3.3): 2xx/207 ⇒ Nextcloud;
/// 404/405/any transport error ⇒ generic RFC-4918 server (research Q1).
async fn server_capability(ctx: &FilePlaneCtx) -> Capability {
    let rel = format!("uploads/{}/", ctx.username);
    match ctx.dav.list(&rel, reqwest_dav::Depth::Number(0)).await {
        Ok(_) => Capability::Nextcloud,
        Err(_) => Capability::Generic,
    }
}

/// Upload a book file to its remote destination (path from
/// `core::sync::remote`'s single naming point — 作者 - 书名.ext, `[hash8]`
/// collision suffix, per-segment percent-encoding, D-105). Threshold branch:
/// single streaming conditional PUT below 10MB; Nextcloud chunk v2 vs generic
/// streaming whole-PUT at/above. On success the completed-metadata row is left
/// for the 07-02 state builder. Progress reports 0 → total (single request)
/// or per-confirmed-chunk bytes.
pub async fn upload_book(
    ctx: &FilePlaneCtx,
    pool: &sqlx::SqlitePool,
    report: &(dyn Fn(FileProgress) + Send + Sync),
    work_id: &str,
    local_path: &Path,
    remote_path: &str,
) -> Result<(), FileError> {
    validate_remote_book_path(ctx, remote_path)?;
    let size = tokio::fs::metadata(local_path)
        .await
        .map_err(|_| FileError::Io)?
        .len();

    // Nutstore pre-flight (research A2, official 坚果云 500MB limit): refuse
    // before any request; the state plane is untouched.
    if ctx.server_dav_root.contains("jianguoyun.com") && size > planner::NUTSTORE_SINGLE_FILE_LIMIT
    {
        return Err(FileError::TooLarge(
            "书籍文件超过服务器单文件大小限制，已跳过文件同步（进度与批注仍会同步）",
        ));
    }

    let mut reporter = Reporter::new(report, work_id, FileDirection::Upload, size);
    reporter.tick(0);

    // Pre-flight dedup (content-addressed idempotent re-push): same name AND
    // same size at the destination ⇒ the bytes are already there. Same name
    // with a different size is a naming collision the caller must resolve
    // with the `[hash8]` suffix — never a silent overwrite.
    match propfind_file(ctx, remote_path).await? {
        Some((remote_size, _)) if remote_size == size => {
            record_upload_done(pool, work_id, size, remote_path).await?;
            reporter.finish();
            return Ok(());
        }
        Some(_) => {
            reporter.fail(FileError::RemoteConflict.user_message());
            return Err(FileError::RemoteConflict);
        }
        None => {}
    }

    let result = if !planner::needs_chunking(size) {
        upload_streaming_put(ctx, local_path, remote_path, size).await
    } else {
        match server_capability(ctx).await {
            Capability::Nextcloud => {
                upload_chunked(ctx, pool, report, work_id, local_path, remote_path, size).await
            }
            // Generic RFC-4918: no server-side assembly exists, so the honest
            // fallback is the same streaming whole-file PUT with bounded
            // restart-from-zero retry (research Q1 correction to D-101).
            Capability::Generic => upload_streaming_put(ctx, local_path, remote_path, size).await,
        }
    };

    match result {
        Ok(()) => {
            record_upload_done(pool, work_id, size, remote_path).await?;
            reporter.finish();
            Ok(())
        }
        Err(err) => {
            reporter.fail(err.user_message());
            Err(err)
        }
    }
}

/// Single streaming conditional PUT (<10MB path AND generic-server fallback):
/// the body is the open file itself via `Body::from` — never buffered — with
/// `If-None-Match: *` guarding first creation (Deviation Note in the threat
/// model: direct-to-final-name is bounded by this guard + the download side's
/// blake3 gate). 412 ⇒ re-PROPFIND: size match means a racing same-bytes
/// push won (success); anything else is [`FileError::RemoteConflict`].
async fn upload_streaming_put(
    ctx: &FilePlaneCtx,
    local_path: &Path,
    remote_path: &str,
    size: u64,
) -> Result<(), FileError> {
    let url = transport::join_url(&ctx.server_dav_root, remote_path);
    let resp = send_with_retry(|| {
        let url = url.clone();
        async move {
            let file = tokio::fs::File::open(local_path)
                .await
                .map_err(|_| FileError::Io)?;
            Ok(authed(ctx, ctx.agent.put(&url))
                .header("If-None-Match", "*")
                .header("Content-Type", "application/octet-stream")
                .timeout(TRANSFER_TIMEOUT)
                .body(reqwest::Body::from(file)))
        }
    })
    .await?;
    match resp.status().as_u16() {
        200 | 201 | 204 => Ok(()),
        412 => match propfind_file(ctx, remote_path).await? {
            Some((remote_size, _)) if remote_size == size => Ok(()),
            _ => Err(FileError::RemoteConflict),
        },
        status => Err(status_error(status)),
    }
}

// ---------------------------------------------------------------------------
// Nextcloud chunked upload v2 (RESEARCH Pattern 5, line-by-line)
// ---------------------------------------------------------------------------

/// Trailing segment of a PROPFIND child href → chunk index, only for the
/// zero-padded 5-width names `chunk_name` produces (`.file` and stray entries
/// are ignored).
fn chunk_index_from_name(name: &str) -> Option<u32> {
    if name.len() == 5 && name.bytes().all(|b| b.is_ascii_digit()) {
        name.parse().ok().filter(|i| *i >= 1)
    } else {
        None
    }
}

/// Extract a chunk index from a PROPFIND list entity, if it names a chunk.
fn chunk_index_of_entity(entity: &reqwest_dav::types::list_cmd::ListEntity) -> Option<u32> {
    let href = match entity {
        reqwest_dav::types::list_cmd::ListEntity::File(f) => &f.href,
        reqwest_dav::types::list_cmd::ListEntity::Folder(f) => &f.href,
    };
    chunk_index_from_name(href.trim_end_matches('/').rsplit('/').next()?)
}

/// Nextcloud chunk v2 with resume (Task 2). The server-side PROPFIND of the
/// upload dir is the resume truth; the `sync_file_state` row is a hint
/// (T-07-03-07). `Destination: <final file URL>` rides EVERY request — the
/// MKCOL, every chunk PUT, and the MOVE — per the Nextcloud doc semantics
/// quoted in RESEARCH ("每个请求都要带"). Assembly is MOVE `<dir>/.file`;
/// 423 Locked / 504 are retried with backoff, never terminal. Expired (>24h)
/// or server-reaped (404) transfers restart with a FRESH transfer_uuid.
async fn upload_chunked(
    ctx: &FilePlaneCtx,
    pool: &sqlx::SqlitePool,
    report: &(dyn Fn(FileProgress) + Send + Sync),
    work_id: &str,
    local_path: &Path,
    remote_path: &str,
    size: u64,
) -> Result<(), FileError> {
    let dest_url = transport::join_url(&ctx.server_dav_root, remote_path);
    let plan = planner::plan_chunks(size);
    let now = now_ms();

    // --- Resume decision ---
    let row = read_upload_row(pool, work_id).await?;
    let mut transfer_uuid: Option<String> = None;
    let mut present: BTreeSet<u32> = BTreeSet::new();
    if let Some((Some(uuid), _chunks_done, row_size, started_at)) = row {
        // A size change means the row describes a different transfer —
        // content-addressing makes this near-impossible; guard anyway.
        let stale = row_size.is_some_and(|s| s as u64 != size)
            || planner::is_upload_expired(started_at, now);
        if stale {
            // 24h expiry ⇒ the server already reaped the dir; DELETE is
            // best-effort, then fall through to a fresh transfer.
            let dir_url = transport::join_url(
                &ctx.server_dav_root,
                &format!("uploads/{}/{}/", ctx.username, uuid),
            );
            let _ = authed(ctx, ctx.agent.request(reqwest::Method::DELETE, &dir_url))
                .send()
                .await;
        } else {
            // PROPFIND the upload dir (plan text: `Depth::One` — spelled
            // `Depth::Number(1)` in reqwest_dav 0.3.3, see 07-01/07-02). The
            // server-confirmed chunk set is the resume truth.
            let dir_rel = format!("uploads/{}/{}/", ctx.username, uuid);
            match ctx.dav.list(&dir_rel, reqwest_dav::Depth::Number(1)).await {
                Ok(entities) => {
                    present = entities.iter().filter_map(chunk_index_of_entity).collect();
                    transfer_uuid = Some(uuid);
                }
                Err(e) if transport::http_status_of(&e) == Some(404) => {
                    // Server reaped it — fall through to a fresh transfer.
                }
                Err(e) => return Err(classify_dav(&e)),
            }
        }
    }

    let fresh = transfer_uuid.is_none();
    let transfer_uuid =
        transfer_uuid.unwrap_or_else(|| format!("pillowtome-{}", uuid::Uuid::new_v4()));
    let dir_url = transport::join_url(
        &ctx.server_dav_root,
        &format!("uploads/{}/{}", ctx.username, transfer_uuid),
    );

    if fresh {
        // MKCOL the upload dir, Destination on it too. Already-exists
        // (405/409) is fine.
        let resp = authed(
            ctx,
            ctx.agent.request(
                reqwest::Method::from_bytes(b"MKCOL").map_err(|_| FileError::Internal)?,
                &dir_url,
            ),
        )
        .header("Destination", &dest_url)
        .send()
        .await
        .map_err(classify_send)?;
        match resp.status().as_u16() {
            200..=299 | 405 | 409 => {}
            status => return Err(status_error(status)),
        }
        upsert_upload_row(pool, work_id, &transfer_uuid, &present, size, remote_path).await?;
    } else {
        // Refresh the hint row to the server-confirmed set (a crash between a
        // chunk PUT and the row update leaves the row stale).
        update_chunks_done(pool, work_id, &present).await?;
    }

    // --- Chunk PUTs, missing only ---
    let mut reporter = Reporter::new(report, work_id, FileDirection::Upload, size);
    let confirmed_bytes = |confirmed: &BTreeSet<u32>| -> u64 {
        plan.iter()
            .filter(|c| confirmed.contains(&c.index))
            .map(|c| c.len)
            .sum()
    };
    let mut confirmed = present;
    reporter.tick(confirmed_bytes(&confirmed));

    for chunk in planner::missing_chunks(&plan, &confirmed) {
        // Bounded ≤10MB buffer: seek + read_exact — peak extra memory is ONE
        // chunk, never the book (Pitfall 4; no new streaming dep needed).
        let mut file = tokio::fs::File::open(local_path)
            .await
            .map_err(|_| FileError::Io)?;
        file.seek(std::io::SeekFrom::Start(chunk.offset))
            .await
            .map_err(|_| FileError::Io)?;
        let mut buf = vec![0u8; chunk.len as usize];
        file.read_exact(&mut buf).await.map_err(|_| FileError::Io)?;
        let chunk_url = format!("{dir_url}/{}", planner::chunk_name(chunk.index));
        let resp = send_with_retry(|| {
            let chunk_url = chunk_url.clone();
            let dest_url = dest_url.clone();
            let buf = &buf;
            async move {
                Ok(authed(ctx, ctx.agent.put(&chunk_url))
                    .header("Destination", &dest_url)
                    .header("OC-Total-Length", size.to_string())
                    .header("Content-Type", "application/octet-stream")
                    .timeout(TRANSFER_TIMEOUT)
                    .body(buf.clone()))
            }
        })
        .await?;
        match resp.status().as_u16() {
            200 | 201 | 204 => {
                confirmed.insert(chunk.index);
                update_chunks_done(pool, work_id, &confirmed).await?;
                reporter.tick(confirmed_bytes(&confirmed));
            }
            status => return Err(status_error(status)),
        }
    }

    // --- Assembly: MOVE <dir>/.file → Destination. No `Overwrite: T` —
    // content-addressed naming makes a silent clobber unnecessary, and sync
    // never deletes remote book files (D-105 files are user-managed).
    let file_url = format!("{dir_url}/.file");
    let move_method = reqwest::Method::from_bytes(b"MOVE").map_err(|_| FileError::Internal)?;
    let mtime = mtime_secs(local_path).await.unwrap_or(0);
    let resp = send_with_retry(|| {
        let file_url = file_url.clone();
        let dest_url = dest_url.clone();
        let method = move_method.clone();
        async move {
            Ok(authed(ctx, ctx.agent.request(method, &file_url))
                .header("Destination", &dest_url)
                .header("OC-Total-Length", size.to_string())
                .header("X-OC-Mtime", mtime.to_string())
                .timeout(TRANSFER_TIMEOUT))
        }
    })
    .await?;
    match resp.status().as_u16() {
        200 | 201 | 204 => Ok(()),
        412 | 409 => match propfind_file(ctx, remote_path).await? {
            // A racing same-bytes push won — idempotent success.
            Some((remote_size, _)) if remote_size == size => Ok(()),
            _ => Err(FileError::RemoteConflict),
        },
        status => Err(status_error(status)),
    }
}

/// Abort an in-flight chunked upload (user-cancel / superseded): DELETE the
/// upload dir — Nextcloud's documented abort — and clear the transfer row.
/// Best-effort: a reaped/absent dir is fine. Completed uploads (NULL
/// transfer_uuid metadata rows) are left untouched.
pub async fn abort_upload(
    ctx: &FilePlaneCtx,
    pool: &sqlx::SqlitePool,
    work_id: &str,
) -> Result<(), FileError> {
    if let Some((Some(uuid), _, _, _)) = read_upload_row(pool, work_id).await? {
        let dir_url = transport::join_url(
            &ctx.server_dav_root,
            &format!("uploads/{}/{}/", ctx.username, uuid),
        );
        let _ = authed(ctx, ctx.agent.request(reqwest::Method::DELETE, &dir_url))
            .send()
            .await;
        clear_transfer_row(pool, work_id).await?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Download (Range probe → .part resume → blake3 == work_id gate → rename)
// ---------------------------------------------------------------------------

/// Total length from a 206 `Content-Range: bytes A-B/TOTAL` response header.
fn parse_content_range_total(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    let value = headers.get(reqwest::header::CONTENT_RANGE)?.to_str().ok()?;
    value.rsplit('/').next()?.parse().ok()
}

/// Response ETag captured VERBATIM (opaque equality token — never parsed).
fn etag_of(headers: &reqwest::header::HeaderMap) -> Option<String> {
    headers
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
}

/// Terminal-status classification for GETs (download flavor): 404/416/other
/// transport-ish failures use the UI-SPEC download copy.
fn download_status_error(status: u16) -> FileError {
    match status {
        401 => FileError::Auth,
        403 => FileError::Permission,
        429 | 503 => FileError::RateLimited,
        _ => FileError::DownloadFailed,
    }
}

/// The live download row (the 07-02 DISCOVERY row, possibly already consumed
/// by an earlier attempt): (etag resume token, size, remote_path).
async fn read_download_row(
    pool: &sqlx::SqlitePool,
    work_id: &str,
) -> Result<Option<(Option<String>, Option<i64>, Option<String>)>, FileError> {
    sqlx::query_as(
        "SELECT transfer_uuid, size, remote_path FROM sync_file_state \
         WHERE work_id = $1 AND direction = 'download'",
    )
    .bind(work_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| FileError::Internal)
}

/// Overwrite the discovery row with live transfer state: the probe ETag rides
/// `transfer_uuid` as the resume-validation token (download rows never need a
/// Nextcloud uuid); `chunks_done` stays '[]' — the `.part` length IS the
/// cursor. The 07-02 pull-merge's own upsert only advances size/hash/
/// remote_path/updated_at, so it never clobbers this in-flight state.
async fn touch_download_row(
    pool: &sqlx::SqlitePool,
    work_id: &str,
    etag: Option<&str>,
    total: u64,
) -> Result<(), FileError> {
    sqlx::query(
        "UPDATE sync_file_state SET transfer_uuid = $1, size = $2, updated_at = $3 \
         WHERE work_id = $4 AND direction = 'download'",
    )
    .bind(etag)
    .bind(total as i64)
    .bind(now_ms())
    .bind(work_id)
    .execute(pool)
    .await
    .map_err(|_| FileError::Internal)?;
    Ok(())
}

/// The D-100 hand-off payload. `source_id` derives from the final path via
/// `commands::book_id` — deterministic, so a later re-registration of the
/// same path reproduces the same id.
fn downloaded_book(work_id: &str, final_path: &Path) -> DownloadedBook {
    let source = BookSource::Path(final_path.to_path_buf());
    DownloadedBook {
        work_id: work_id.to_string(),
        source_id: crate::commands::book_id(&source),
        local_path: final_path.to_string_lossy().into_owned(),
    }
}

/// Download a peer-synced book (D-99): probe `Accept-Ranges` behavior with a
/// `Range: bytes=0-0` GET, stream 10MB slices into `<file>.part` resuming from
/// the on-disk length, hard-gate on blake3 == work_id, then rename into the
/// app-owned `books_dir` and register the source. A corrupted/tampered
/// payload is deleted and NEVER renamed, registered, or cataloged
/// (T-07-03-01). `expected_size` is the discovery row's size hint; the
/// server's probed total wins when available.
pub async fn download_book(
    ctx: &FilePlaneCtx,
    pool: &sqlx::SqlitePool,
    report: &(dyn Fn(FileProgress) + Send + Sync),
    registry: &SourceRegistry,
    books_dir: &Path,
    work_id: &str,
    remote_path: &str,
    expected_size: u64,
) -> Result<DownloadedBook, FileError> {
    if !is_safe_work_id(work_id) {
        return Err(FileError::Internal);
    }
    validate_remote_book_path(ctx, remote_path)?;
    let ext = sanitize_ext(remote_path);
    let final_path = books_dir.join(format!("{work_id}.{ext}"));
    let part_path = books_dir.join(format!("{work_id}.{ext}.part"));
    let mut reporter = Reporter::new(report, work_id, FileDirection::Download, expected_size);
    reporter.tick(0);

    let result = download_transfer(
        ctx,
        pool,
        &mut reporter,
        registry,
        &final_path,
        &part_path,
        work_id,
        remote_path,
        expected_size,
    )
    .await;
    match &result {
        Ok(_) => reporter.finish(),
        Err(err) => reporter.fail(err.user_message()),
    }
    result
}

#[allow(clippy::too_many_arguments)]
async fn download_transfer(
    ctx: &FilePlaneCtx,
    pool: &sqlx::SqlitePool,
    reporter: &mut Reporter<'_>,
    registry: &SourceRegistry,
    final_path: &Path,
    part_path: &Path,
    work_id: &str,
    remote_path: &str,
    expected_size: u64,
) -> Result<DownloadedBook, FileError> {
    let url = transport::join_url(&ctx.server_dav_root, remote_path);

    // Idempotent re-entry: a present final file already passed the hash gate
    // (rename happens only after verification) — register and return.
    if tokio::fs::metadata(final_path).await.is_ok() {
        let book = downloaded_book(work_id, final_path);
        registry.register(book.source_id.clone(), BookSource::Path(final_path.to_path_buf()));
        clear_transfer_row(pool, work_id).await?;
        return Ok(book);
    }

    // 1) Probe: GET `Range: bytes=0-0`. 206 ⇒ ranged mode (total from
    //    Content-Range, ETag captured verbatim); 200 ⇒ no ranges — a single
    //    streamed GET, restart-from-zero on failure (same honesty as the
    //    upload fallback).
    let probe = send_with_retry(|| {
        let url = url.clone();
        async move {
            Ok(authed(ctx, ctx.agent.get(&url))
                .header("Range", "bytes=0-0")
                .timeout(TRANSFER_TIMEOUT))
        }
    })
    .await
    .map_err(|_| FileError::DownloadFailed)?;
    let (ranged, total, etag) = match probe.status().as_u16() {
        206 => (
            true,
            parse_content_range_total(probe.headers()).unwrap_or(expected_size),
            etag_of(probe.headers()),
        ),
        200 => (
            false,
            probe
                .headers()
                .get(reqwest::header::CONTENT_LENGTH)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse().ok())
                .unwrap_or(expected_size),
            etag_of(probe.headers()),
        ),
        status => return Err(download_status_error(status)),
    };
    reporter.total = total;

    // 2) Resume cursor: the `.part` length on disk (self-healing), validated
    //    against the row's size/ETag — a mismatch truncates and restarts.
    let prior = read_download_row(pool, work_id).await?;
    let mut cursor = match tokio::fs::metadata(part_path).await {
        Ok(meta) => meta.len(),
        Err(_) => 0,
    };
    if cursor > 0 {
        let row_matches = match &prior {
            Some((_, Some(row_size), _)) if *row_size as u64 == total => match (&prior, &etag) {
                (Some((Some(row_etag), _, _)), Some(probe_etag)) => row_etag == probe_etag,
                _ => true,
            },
            _ => false,
        };
        if !row_matches || cursor > total {
            // Stale/foreign partial — truncate and restart (T-07-03-07).
            let _ = tokio::fs::remove_file(part_path).await;
            cursor = 0;
        }
    }
    touch_download_row(pool, work_id, etag.as_deref(), total).await?;

    // 3) Transfer.
    if cursor < total {
        if ranged && total > 0 {
            download_ranged(ctx, reporter, &url, part_path, cursor, total).await?;
        } else {
            download_whole(ctx, reporter, &url, part_path).await?;
        }
    }

    // 4) The hard gate (D-100 single source of truth): streamed blake3 of the
    //    received bytes MUST equal the work_id. Mismatch ⇒ delete the .part,
    //    clear the row, refuse — the file is never renamed, registered, or
    //    cataloged (a hostile/corrupt server cannot poison the library).
    let hex = blake3_file_hex(part_path).await?;
    if !planner::hash_matches_work_id(&hex, work_id) {
        let _ = tokio::fs::remove_file(part_path).await;
        clear_transfer_row(pool, work_id).await?;
        return Err(FileError::IntegrityMismatch);
    }

    // 5) Atomic same-dir rename into app-owned storage, register the source
    //    (openable this session), clear the transfer row, hand back the ids
    //    the existing ingest entry point consumes (D-100).
    tokio::fs::rename(part_path, final_path)
        .await
        .map_err(|_| FileError::Io)?;
    let book = downloaded_book(work_id, final_path);
    registry.register(book.source_id.clone(), BookSource::Path(final_path.to_path_buf()));
    clear_transfer_row(pool, work_id).await?;
    Ok(book)
}

/// Ranged transfer: 10MB slices appended to `.part`, resuming from `cursor`.
/// Each slice requires a 206 — a 200 means the server ignored Range
/// mid-transfer, so the partial is dropped and one honest whole-file GET
/// finishes the job (defensive, terminates).
async fn download_ranged(
    ctx: &FilePlaneCtx,
    reporter: &mut Reporter<'_>,
    url: &str,
    part_path: &Path,
    cursor: u64,
    total: u64,
) -> Result<(), FileError> {
    let mut cursor = cursor;
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(part_path)
        .await
        .map_err(|_| FileError::Io)?;
    while cursor < total {
        let end = (cursor + planner::CHUNK_SIZE - 1).min(total - 1);
        let range = format!("bytes={cursor}-{end}");
        let resp = send_with_retry(|| {
            let url = url.to_string();
            let range = range.clone();
            async move {
                Ok(authed(ctx, ctx.agent.get(&url))
                    .header("Range", range)
                    .timeout(TRANSFER_TIMEOUT))
            }
        })
        .await
        .map_err(|_| FileError::DownloadFailed)?;
        match resp.status().as_u16() {
            206 => {
                let slice_start = cursor;
                let mut resp = resp;
                loop {
                    match resp.chunk().await {
                        Ok(Some(bytes)) => {
                            file.write_all(&bytes).await.map_err(|_| FileError::Io)?;
                        }
                        Ok(None) => break,
                        Err(_) => {
                            // Partial slice appended — roll the .part back to
                            // the slice start so the next attempt re-fetches
                            // it cleanly.
                            let _ = file.set_len(slice_start).await;
                            return Err(FileError::DownloadFailed);
                        }
                    }
                }
                cursor = end + 1;
                reporter.tick(cursor);
            }
            200 => {
                drop(file);
                return download_whole(ctx, reporter, url, part_path).await;
            }
            416 => {
                // Cursor disagrees with the server — drop the partial and fail
                // soft; the next tap restarts cleanly.
                drop(file);
                let _ = tokio::fs::remove_file(part_path).await;
                return Err(FileError::DownloadFailed);
            }
            status => return Err(download_status_error(status)),
        }
    }
    Ok(())
}

/// No-ranges transfer: one GET streamed to `.part` (truncate first — resume
/// is unavailable, restart-from-zero on failure). Still never buffered.
async fn download_whole(
    ctx: &FilePlaneCtx,
    reporter: &mut Reporter<'_>,
    url: &str,
    part_path: &Path,
) -> Result<(), FileError> {
    let mut file = tokio::fs::File::create(part_path)
        .await
        .map_err(|_| FileError::Io)?;
    let mut resp = send_with_retry(|| {
        let url = url.to_string();
        async move { Ok(authed(ctx, ctx.agent.get(&url)).timeout(TRANSFER_TIMEOUT)) }
    })
    .await
    .map_err(|_| FileError::DownloadFailed)?;
    if resp.status().as_u16() != 200 {
        return Err(download_status_error(resp.status().as_u16()));
    }
    let mut done = reporter.done;
    while let Some(bytes) = resp
        .chunk()
        .await
        .map_err(|_| FileError::DownloadFailed)?
    {
        file.write_all(&bytes).await.map_err(|_| FileError::Io)?;
        done += bytes.len() as u64;
        reporter.tick(done);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(root: &str) -> FilePlaneCtx {
        let dav = reqwest_dav::ClientBuilder::new()
            .set_host("http://localhost".to_string())
            .build()
            .expect("dav client");
        FilePlaneCtx {
            agent: dav.agent.clone(),
            server_dav_root: dav.host.clone(),
            username: "user".to_string(),
            remote_root: root.to_string(),
            dav,
        }
    }

    #[test]
    fn ext_is_whitelisted_lowercase_with_epub_default() {
        assert_eq!(sanitize_ext("pillowtome/books/a - b.EPUB"), "epub");
        assert_eq!(sanitize_ext("pillowtome/books/a - b.pdf"), "pdf");
        assert_eq!(sanitize_ext("pillowtome/books/a - b.azw3"), "azw3");
        // Anything outside [a-z0-9] or overlong falls back to epub.
        assert_eq!(sanitize_ext("pillowtome/books/a - b.e*pub"), "epub");
        assert_eq!(sanitize_ext("pillowtome/books/noext"), "epub");
        assert_eq!(sanitize_ext("pillowtome/books/a.toolongext"), "epub");
    }

    #[test]
    fn work_id_safety_rejects_separators_and_dots() {
        assert!(is_safe_work_id(&"a".repeat(64)));
        assert!(is_safe_work_id("work-import-1234_ab"));
        assert!(!is_safe_work_id(""));
        assert!(!is_safe_work_id("../x"));
        assert!(!is_safe_work_id("a/b"));
        assert!(!is_safe_work_id("a\\b"));
        assert!(!is_safe_work_id("a.b"));
    }

    #[test]
    fn remote_book_path_is_jailed_under_root_books() {
        let c = ctx("pillowtome/");
        assert!(validate_remote_book_path(&c, "pillowtome/books/%E4%BD%9C%20-%20x.epub").is_ok());
        assert!(validate_remote_book_path(&c, "pillowtome/books/a - b [abcdef01].pdf").is_ok());
        // Wrong prefix, traversal, backslash — all rejected.
        assert!(validate_remote_book_path(&c, "pillowtome/state/x.json").is_err());
        assert!(validate_remote_book_path(&c, "other/books/x.epub").is_err());
        assert!(validate_remote_book_path(&c, "pillowtome/books/../x.epub").is_err());
        assert!(validate_remote_book_path(&c, "pillowtome\\books\\x.epub").is_err());
        // The configured root is honored (custom remote root).
        let c2 = ctx("dav/root");
        assert!(validate_remote_book_path(&c2, "dav/root/books/x.epub").is_ok());
        assert!(validate_remote_book_path(&c2, "pillowtome/books/x.epub").is_err());
    }

    #[test]
    fn content_range_total_parses_bytes_form() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::CONTENT_RANGE,
            reqwest::header::HeaderValue::from_static("bytes 0-0/12345678"),
        );
        assert_eq!(parse_content_range_total(&headers), Some(12345678));
        headers.insert(
            reqwest::header::CONTENT_RANGE,
            reqwest::header::HeaderValue::from_static("bytes 0-0/*"),
        );
        assert_eq!(parse_content_range_total(&headers), None);
        assert_eq!(parse_content_range_total(&reqwest::header::HeaderMap::new()), None);
    }

    #[test]
    fn chunk_index_names_only_zero_padded_five() {
        assert_eq!(chunk_index_from_name("00001"), Some(1));
        assert_eq!(chunk_index_from_name("00042"), Some(42));
        assert_eq!(chunk_index_from_name("09999"), Some(9999));
        assert_eq!(chunk_index_from_name(".file"), None);
        assert_eq!(chunk_index_from_name("1"), None);
        assert_eq!(chunk_index_from_name("00000"), None);
        assert_eq!(chunk_index_from_name("0000a"), None);
    }

    #[test]
    fn terminal_statuses_classify() {
        assert_eq!(status_error(401), FileError::Auth);
        assert_eq!(status_error(403), FileError::Permission);
        assert_eq!(
            status_error(413),
            FileError::TooLarge("书籍文件超过服务器单文件大小限制，已跳过文件同步（进度与批注仍会同步）")
        );
        assert_eq!(status_error(507), FileError::TooLarge("服务器存储空间不足"));
        assert_eq!(status_error(503), FileError::RateLimited);
        assert_eq!(status_error(500), FileError::Internal);
        assert_eq!(download_status_error(404), FileError::DownloadFailed);
        assert_eq!(download_status_error(429), FileError::RateLimited);
    }

    #[test]
    fn error_copy_is_chinese_and_stable() {
        assert_eq!(FileError::RemoteConflict.user_message(), "远端已存在同名文件，已取消本次上传");
        assert_eq!(FileError::IntegrityMismatch.user_message(), "下载校验失败，文件可能已损坏，请重试");
        assert_eq!(FileError::DownloadFailed.user_message(), "下载失败，请检查网络后重试");
        assert_eq!(FileError::RateLimited.user_message(), "服务器限流，请稍后重试");
    }
}
