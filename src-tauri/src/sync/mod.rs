//! WebDAV sync (SYNC-01..05) — Tauri-side IO spine.
//!
//! The pure sync core (remote serde model, path jail, merge engine) lives in
//! `pillowtome_core::sync` (07-00). This module owns everything that touches
//! the outside world: the OS keychain credential store ([`credentials`]), the
//! `reqwest_dav` transport with the D-95 TLS/http gates ([`transport`]), and
//! the IPC command surface ([`commands`]).
//!
//! Invariants that span every submodule:
//!
//! - The WebDAV password lives only in the OS keychain. It never crosses IPC
//!   back to the WebView, never lands in SQLite, and never appears in a serde
//!   output struct, a `Debug` string, or a log line.
//! - Errors shown to the user are only the classified 简体中文 strings of
//!   [`SyncError::user_message`] (D-97) — raw OS/server error text is a leak
//!   channel and is never surfaced.

pub mod commands;
pub mod credentials;
pub mod fileplane;
pub mod reconcile;
pub mod transport;

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::Manager;

/// The classified sync error taxonomy (D-97 + rate-limit + keyring classes).
///
/// Wiremock integration tests assert on these variants directly, so the enum
/// derives `PartialEq`/`Eq`. Users only ever see [`SyncError::user_message`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncError {
    /// Server unreachable (connect/timeout/DNS/unparseable URL).
    Unreachable,
    /// 401 — bad username or app password.
    Auth,
    /// TLS certificate validation failed.
    Certificate,
    /// 403 — no write permission on the remote directory.
    Permission,
    /// 429/503 — server rate limit (坚果云 免费档 throttling); retry with
    /// exponential backoff, then surface the class.
    RateLimited,
    /// No usable OS keychain backend (e.g. Linux without Secret Service).
    KeyringUnavailable,
    /// `http://` was refused because the 允许 HTTP switch is off (D-95).
    HttpNotAllowed,
    /// 412 on a conditional write — remote state changed under us; the 07-02
    /// state plane consumes this as its re-pull-merge-retry seam.
    RemoteChanged,
    /// Soft failure carrying its own already-localized user copy (e.g. the
    /// shared pool is not up yet — 数据库尚未就绪). Never carries internals.
    Soft(&'static str),
    /// Anything else. Never leaks raw internals to the user.
    Internal,
}

impl SyncError {
    /// The exact UI-SPEC copy for each class — do not paraphrase; the settings
    /// UI and toasts render these strings verbatim.
    pub fn user_message(&self) -> &'static str {
        match self {
            SyncError::Unreachable => "无法连接到服务器，请检查地址",
            SyncError::Auth => "认证失败，请检查用户名和应用密码",
            SyncError::Certificate => "证书校验失败，可开启「信任自签名证书」",
            SyncError::Permission => "没有目录写入权限，请检查路径",
            SyncError::RateLimited => "服务器限流，请稍后重试",
            SyncError::KeyringUnavailable => "系统密钥环不可用，无法保存凭据",
            // Plan-owned copy: UI-SPEC defines the switch warning, not the
            // refusal; uses UI-SPEC vocabulary 明文 HTTP / 允许 HTTP / 仅局域网.
            SyncError::HttpNotAllowed => "明文 HTTP 连接已拒绝，请仅在可信局域网内开启「允许 HTTP」",
            SyncError::Soft(msg) => msg,
            SyncError::RemoteChanged | SyncError::Internal => "同步失败，请稍后重试",
        }
    }
}

/// Normalize a user-entered server URL: trim whitespace, strip ALL trailing
/// slashes. Single normalization point so the keychain account key and the
/// transport host always agree (Pitfall 8 defensive normalization starts here).
pub fn normalize_server_url(input: &str) -> String {
    input.trim().trim_end_matches('/').to_string()
}

/// Unix epoch milliseconds for `sync_config.updated_at`.
pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The exact pool key the SQL plugin registers — matches `lib.rs`
/// `.add_migrations("sqlite:pillow.db", …)` and the frontend `DB_PATH`.
pub(crate) const DB_URL: &str = "sqlite:pillow.db";

/// Set once the engine initialized against the live pool (process lifetime).
static POOL_INIT_DONE: AtomicBool = AtomicBool::new(false);

/// Resolve the plugin's shared SQLite pool — the app's single SQLite binding
/// (Pitfall 6; RESEARCH Assumption A4, verified against vendored
/// tauri-plugin-sql 2.4.0: `app.manage(DbInstances)` in setup(),
/// `pub struct DbInstances(pub RwLock<HashMap<String, DbPool>>)`,
/// `pub enum DbPool { Sqlite(Pool<Sqlite>), .. }`). The pool appears only after
/// the frontend `Database.load("sqlite:pillow.db")`, so absence is a soft
/// "not ready" — never a reason to open a second binding.
///
/// The FIRST successful resolution per process doubles as engine init: a
/// `syncing=1` row found at startup is definitionally crash-orphaned
/// (single-process engine), so it is reset here and manual sync can never be
/// permanently refused (the live re-entry guard is the in-memory
/// [`SyncEngineState`] flag, not this column).
pub(crate) async fn sqlite_pool(app: &tauri::AppHandle) -> Result<sqlx::SqlitePool, SyncError> {
    let pool = {
        // `try_state`: DbInstances itself is managed from the plugin's async
        // setup, so `state()` can still panic early in boot — a missing state
        // or a missing pool key is the same soft "not ready".
        let Some(instances) = app.try_state::<tauri_plugin_sql::DbInstances>() else {
            return Err(SyncError::Soft("数据库尚未就绪"));
        };
        let lock = instances.0.read().await;
        match lock.get(DB_URL) {
            Some(tauri_plugin_sql::DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err(SyncError::Soft("数据库尚未就绪")),
        }
    };
    if !POOL_INIT_DONE.swap(true, Ordering::SeqCst) {
        let _ = sqlx::query("UPDATE sync_state SET syncing=0 WHERE id='state'")
            .execute(&pool)
            .await;
    }
    Ok(pool)
}

/// A4 runtime probe: retry [`sqlite_pool`] for a bounded window (~2 min — the
/// pool appears only once the frontend WebView has booted and called
/// `Database.load`, which can take tens of seconds on a cold dev build) so the
/// caller (lib.rs setup) can log whether the shared pool is reachable from
/// Rust. Returns true on first success.
pub async fn probe_shared_pool(app: &tauri::AppHandle) -> bool {
    for _ in 0..240 {
        if sqlite_pool(app).await.is_ok() {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    false
}

/// Managed session state: the D-92 undo store (pre-jump locator rows displaced
/// by peer merges). Session-scoped, in-memory only — never persisted, never
/// accepted from IPC (T-07-02-09); the pill lifetime is the session
/// (UI-SPEC §5).
pub struct SyncUndoMap(pub reconcile::UndoMap);

impl Default for SyncUndoMap {
    fn default() -> Self {
        Self(reconcile::new_undo_map())
    }
}

/// Managed session state: in-memory work_id → percent maps for the file
/// plane's transfers. 07-03 reports into these via
/// `commands::report_transfer_progress`; the unified sync-status event
/// snapshots them (this plan owns the ONLY emitter).
#[derive(Default)]
pub struct TransferMaps {
    pub downloads: std::collections::HashMap<String, f64>,
    pub uploads: std::collections::HashMap<String, f64>,
}

/// Managed session state wrapper around [`TransferMaps`].
pub struct SyncProgressMaps(pub tokio::sync::Mutex<TransferMaps>);

impl Default for SyncProgressMaps {
    fn default() -> Self {
        Self(tokio::sync::Mutex::new(TransferMaps::default()))
    }
}

/// Managed engine state: the in-memory re-entry guard for manual sync
/// (authoritative in-process; the persisted `sync_state.syncing` column is
/// cross-visibility only and is reset at engine init above).
pub struct SyncEngineState {
    pub syncing: AtomicBool,
}

impl Default for SyncEngineState {
    fn default() -> Self {
        Self {
            syncing: AtomicBool::new(false),
        }
    }
}
