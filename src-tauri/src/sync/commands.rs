//! Sync IPC commands (SYNC-01..05) — part 1: config read / test-and-save /
//! disconnect; part 2: reading-lifecycle sync (开书拉 / 合书推 / 手动按钮,
//! D-90/D-91), the D-92 undo revert, and the unified sync-status event.
//!
//! Security invariants (D-97 / T-07-01-01):
//!
//! - The password rides IN on [`SyncConfigInput`] (deserialize-only, redacted
//!   `Debug`) and never rides back OUT: the only output shapes are
//!   [`PublicSyncConfig`] and the part-2 payloads, all password-free by
//!   construction. All keychain reads happen here — reconcile.rs never sees
//!   the secret.
//! - A config is persisted only after a live `test_and_bootstrap` passes —
//!   a failed test saves nothing: no `sync_config` row, no keychain entry
//!   (不允许错误配置静默保存).
//! - The keychain write happens BEFORE the config row, so a row without a
//!   secret can never exist.
//! - All SQL goes through the plugin's shared pool with `$n` binds only.
//! - The ONLY `change_log` write in the sync plane is the LOCAL D-92 revert
//!   row (a real user op) — remote merges never touch the ledger.
//! - Nothing in this module prints or logs; the password never reaches any
//!   output channel.

use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use super::credentials::{self, PublicSyncConfig};
use super::fileplane;
use super::reconcile::{self, UndoMap};
use super::transport::{self, TransportConfig};
use super::{
    normalize_server_url, now_ms, sqlite_pool, SyncEngineState, SyncError, SyncProgressMaps,
    SyncUndoMap,
};

/// The exact pool key the SQL plugin registers — matches `lib.rs`
/// `.add_migrations("sqlite:pillow.db", …)` and the frontend `DB_PATH`.
const DB_URL: &str = "sqlite:pillow.db";

/// Reuse `tauri_plugin_sql::DbInstances` — the plugin's shared pool map and
/// the app's single SQLite binding (Pitfall 6; RESEARCH Assumption A4).
/// Returns `None` when the plugin has no pool for [`DB_URL`] yet (the frontend
/// opens the DB on startup; a sync command racing ahead of it treats the
/// config as absent instead of opening a second binding — the documented A4
/// fallback would route these writes through the frontend plugin-sql path if
/// pool access ever proves impossible).
async fn db_pool(app: &AppHandle) -> Option<sqlx::SqlitePool> {
    let instances = app.state::<tauri_plugin_sql::DbInstances>();
    let lock = instances.0.read().await;
    match lock.get(DB_URL) {
        Some(tauri_plugin_sql::DbPool::Sqlite(pool)) => Some(pool.clone()),
        _ => None,
    }
}

/// IPC input for [`sync_test_and_save`]. The password deserializes IN and is
/// never serialized back OUT (T-07-01-01); `Debug` is manual so it can never
/// print the secret either.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfigInput {
    pub server_url: String,
    pub username: String,
    pub password: String,
    pub remote_path: Option<String>,
    pub allow_http: Option<bool>,
    pub trust_self_signed: Option<bool>,
    pub device_name: Option<String>,
}

impl std::fmt::Debug for SyncConfigInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SyncConfigInput")
            .field("server_url", &self.server_url)
            .field("username", &self.username)
            .field("password", &"***")
            .field("remote_path", &self.remote_path)
            .field("allow_http", &self.allow_http)
            .field("trust_self_signed", &self.trust_self_signed)
            .field("device_name", &self.device_name)
            .finish()
    }
}

/// Read the current sync configuration for the settings UI.
///
/// Wire shape (camelCase, phase-wide contract): `{configured, serverUrl,
/// username, remotePath, allowHttp, trustSelfSigned, deviceName,
/// keyringAvailable}` — never any secret. A config row whose keychain entry
/// is unreadable reports `configured: false` so the UI re-asks for the
/// password instead of pretending; both paths carry the `keyring_available`
/// probe so the UI can disable 测试并保存 up front with the
/// 系统密钥环不可用 caption instead of failing at save time.
#[tauri::command]
pub async fn sync_get_config(app: AppHandle) -> Result<PublicSyncConfig, String> {
    let keyring_available = credentials::keyring_available();
    let Some(pool) = db_pool(&app).await else {
        return Ok(PublicSyncConfig::unconfigured(keyring_available));
    };
    let row: Option<(String, String, String, bool, bool, Option<String>)> = sqlx::query_as(
        "SELECT server_url, username, remote_path, allow_http, trust_self_signed, device_name \
         FROM sync_config WHERE id = 'config'",
    )
    .fetch_optional(&pool)
    .await
    .map_err(|_| SyncError::Internal.user_message().to_string())?;
    let Some((server_url, username, remote_path, allow_http, trust_self_signed, device_name)) =
        row
    else {
        return Ok(PublicSyncConfig::unconfigured(keyring_available));
    };
    Ok(PublicSyncConfig {
        configured: credentials::is_configured(&server_url, &username),
        server_url: Some(server_url),
        username: Some(username),
        remote_path,
        allow_http,
        trust_self_signed,
        device_name,
        keyring_available,
    })
}

/// The D-97 forced gate: live-test the server, then persist. On `Ok` the
/// frontend shows 连接成功，已保存 (UI-SPEC); this command returns only
/// success or one of the classified [`SyncError::user_message`] strings.
#[tauri::command]
pub async fn sync_test_and_save(app: AppHandle, input: SyncConfigInput) -> Result<(), String> {
    // 1) In-memory transport config, D-95 defaults applied, URL normalized.
    let server_url = normalize_server_url(&input.server_url);
    let mut cfg = TransportConfig::new(
        server_url.clone(),
        input.username.clone(),
        input.password.clone(),
    );
    cfg.remote_path = input
        .remote_path
        .clone()
        .unwrap_or_else(|| "pillowtome/".to_string());
    cfg.allow_http = input.allow_http.unwrap_or(false);
    cfg.trust_self_signed = input.trust_self_signed.unwrap_or(false);

    // 2) Forced live test with rate-limit backoff. Any failure persists
    //    NOTHING — no sync_config row, no keychain entry.
    let client = transport::build_client(&cfg).map_err(|e| e.user_message().to_string())?;
    let root = cfg.remote_path.clone();
    transport::with_rate_limit_retry(Duration::from_millis(500), || {
        transport::test_and_bootstrap(&client, &root)
    })
    .await
    .map_err(|e| e.user_message().to_string())?;

    // 3) Keychain BEFORE the config row — KeyringUnavailable aborts here so a
    //    row without a secret can never exist (no half-configured state).
    credentials::save_password(&server_url, &input.username, &input.password)
        .map_err(|e| e.user_message().to_string())?;

    // 4) Upsert the single config row. If this fails after the keychain
    //    write, the orphaned keychain entry is harmless: the next save
    //    overwrites it and sync_disconnect cleans it.
    let pool = db_pool(&app)
        .await
        .ok_or_else(|| SyncError::Internal.user_message().to_string())?;
    sqlx::query(
        "INSERT INTO sync_config (id, server_url, username, remote_path, allow_http, \
         trust_self_signed, device_name, updated_at) \
         VALUES ('config', $1, $2, $3, $4, $5, $6, $7) \
         ON CONFLICT(id) DO UPDATE SET server_url = excluded.server_url, \
         username = excluded.username, remote_path = excluded.remote_path, \
         allow_http = excluded.allow_http, trust_self_signed = excluded.trust_self_signed, \
         device_name = excluded.device_name, updated_at = excluded.updated_at",
    )
    .bind(&server_url)
    .bind(&input.username)
    .bind(&cfg.remote_path)
    .bind(i64::from(cfg.allow_http))
    .bind(i64::from(cfg.trust_self_signed))
    .bind(&input.device_name)
    .bind(now_ms())
    .execute(&pool)
    .await
    .map_err(|_| SyncError::Internal.user_message().to_string())?;
    Ok(())
}

/// Disconnect: remove the local config row and the OS-keychain credential.
/// Remote data is retained — only the local machine's configuration is removed
/// (UI-SPEC: 仅移除本机的服务器配置与凭据。服务器上的数据保留). Idempotent:
/// no row means there is nothing to do.
#[tauri::command]
pub async fn sync_disconnect(app: AppHandle) -> Result<(), String> {
    let Some(pool) = db_pool(&app).await else {
        return Ok(());
    };
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT server_url, username FROM sync_config WHERE id = 'config'")
            .fetch_optional(&pool)
            .await
            .map_err(|_| SyncError::Internal.user_message().to_string())?;
    let Some((server_url, username)) = row else {
        return Ok(());
    };
    sqlx::query("DELETE FROM sync_config WHERE id = 'config'")
        .execute(&pool)
        .await
        .map_err(|_| SyncError::Internal.user_message().to_string())?;
    credentials::delete_password(&server_url, &username)
        .map_err(|e| e.user_message().to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Part 2 (07-02): reading-lifecycle sync, D-92 undo, unified status event.
// ---------------------------------------------------------------------------

/// Build a WebDAV client from the stored config row: the secret comes out of
/// the OS keychain HERE (the only module allowed to see it) and the D-95
/// gates ride the stored switches. reconcile.rs always receives this finished
/// client — it can never widen the TLS policy (T-07-02-10).
fn dav_client_from_row(cfg: &reconcile::SyncConfigRow) -> Result<reqwest_dav::Client, SyncError> {
    let password = credentials::get_password(&cfg.server_url, &cfg.username)?;
    let mut tc = TransportConfig::new(cfg.server_url.clone(), cfg.username.clone(), password);
    tc.remote_path = cfg.remote_path.clone();
    tc.allow_http = cfg.allow_http;
    tc.trust_self_signed = cfg.trust_self_signed;
    transport::build_client(&tc)
}

/// A local position displaced by a peer merge (D-92 undo payload), or the
/// restored position after a revert. `cfi` falls back to "" and the fraction
/// to 0.0 (D-08: a fraction is effectively always present).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacedLocal {
    pub cfi: String,
    pub progress_fraction: f64,
}

/// `sync_book_opened` result — feeds the UI-SPEC §5 trace pill (已从其他设备同步)
/// and dialog (「{设备名称}」上读到了 {n}%，已自动跳到最远位置。). All fields are
/// `None`/`false` when no jump happened (or sync is not configured).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookOpenedSyncResult {
    pub jumped: bool,
    pub device_name: Option<String>,
    pub progress_fraction: Option<f64>,
    pub replaced_local: Option<ReplacedLocal>,
}

/// `sync_now` / `sync_status` result — 07-04's store initializes from it with
/// EMPTY transfer arrays until the first sync-status event arrives.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatusPayload {
    pub configured: bool,
    pub server_url: Option<String>,
    pub username: Option<String>,
    pub syncing: bool,
    pub last_sync_at: Option<i64>,
    pub last_error: Option<String>,
}

/// One in-flight transfer for the unified event (work_id → percent).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub work_id: String,
    pub percent: f64,
}

/// Which map a transfer-progress report lands in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferKind {
    Download,
    Upload,
}

/// The unified `"sync-status"` event payload (D-93). Emitted by
/// [`emit_sync_status`] — the SOLE emitter — on every status transition and
/// every transfer progress tick; 07-03's file plane never emits its own shape.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatusEvent {
    pub configured: bool,
    pub syncing: bool,
    pub last_error: Option<String>,
    pub downloads: Vec<TransferProgress>,
    pub uploads: Vec<TransferProgress>,
}

/// Read the status payload from sync_config + sync_state + the in-memory flag
/// (shared by `sync_status` and `sync_now`'s return). `configured` mirrors the
/// event payload: a stored config row (the keychain probe lives on
/// `sync_get_config`, and per-tick event emission must stay cheap).
async fn status_payload(app: &AppHandle) -> Result<SyncStatusPayload, String> {
    let syncing = app.state::<SyncEngineState>().syncing.load(Ordering::SeqCst);
    let Ok(pool) = sqlite_pool(app).await else {
        return Ok(SyncStatusPayload {
            configured: false,
            server_url: None,
            username: None,
            syncing,
            last_sync_at: None,
            last_error: None,
        });
    };
    let cfg = reconcile::load_sync_config(&pool)
        .await
        .map_err(|e| e.user_message().to_string())?;
    let state: Option<(Option<i64>, Option<String>)> =
        sqlx::query_as("SELECT last_sync_at, last_error FROM sync_state WHERE id = 'state'")
            .fetch_optional(&pool)
            .await
            .map_err(|_| SyncError::Internal.user_message().to_string())?;
    let (last_sync_at, last_error) = state.unwrap_or((None, None));
    Ok(SyncStatusPayload {
        configured: cfg.is_some(),
        server_url: cfg.as_ref().map(|c| c.server_url.clone()),
        username: cfg.as_ref().map(|c| c.username.clone()),
        syncing,
        last_sync_at,
        last_error,
    })
}

/// The SOLE emitter of the unified `"sync-status"` event (D-93): status dot
/// transitions (idle/syncing/error) and transfer progress ticks all flow
/// through here. `downloads`/`uploads` are snapshotted from the engine-owned
/// `SyncProgressMaps` (07-03 reports into them, it never emits itself).
pub(crate) async fn emit_sync_status(app: &AppHandle) {
    let syncing = app.state::<SyncEngineState>().syncing.load(Ordering::SeqCst);
    let (configured, last_error) = match sqlite_pool(app).await {
        Ok(pool) => {
            let configured = reconcile::load_sync_config(&pool)
                .await
                .ok()
                .flatten()
                .is_some();
            let row: Option<(Option<String>,)> =
                sqlx::query_as("SELECT last_error FROM sync_state WHERE id = 'state'")
                    .fetch_optional(&pool)
                    .await
                    .ok()
                    .flatten();
            (configured, row.and_then(|r| r.0))
        }
        Err(_) => (false, None),
    };
    let (downloads, uploads) = {
        let progress = app.state::<SyncProgressMaps>();
        let maps = progress.0.lock().await;
        let mut downloads: Vec<TransferProgress> = maps
            .downloads
            .iter()
            .map(|(work_id, percent)| TransferProgress {
                work_id: work_id.clone(),
                percent: *percent,
            })
            .collect();
        let mut uploads: Vec<TransferProgress> = maps
            .uploads
            .iter()
            .map(|(work_id, percent)| TransferProgress {
                work_id: work_id.clone(),
                percent: *percent,
            })
            .collect();
        downloads.sort_by(|a, b| a.work_id.cmp(&b.work_id));
        uploads.sort_by(|a, b| a.work_id.cmp(&b.work_id));
        (downloads, uploads)
    };
    let payload = SyncStatusEvent {
        configured,
        syncing,
        last_error,
        downloads,
        uploads,
    };
    let _ = app.emit("sync-status", payload);
}

/// 07-03's ONLY progress channel into the engine: update the in-memory
/// downloads/uploads percent map (percent ≥ 100 completes the transfer and
/// removes the entry), then re-emit the unified event. Never call
/// `app.emit("sync-status", …)` from anywhere else.
pub(crate) async fn report_transfer_progress(
    app: &AppHandle,
    kind: TransferKind,
    work_id: &str,
    percent: f64,
) {
    {
        let progress = app.state::<SyncProgressMaps>();
        let mut maps = progress.0.lock().await;
        let map = match kind {
            TransferKind::Download => &mut maps.downloads,
            TransferKind::Upload => &mut maps.uploads,
        };
        if percent >= 100.0 {
            map.remove(work_id);
        } else {
            map.insert(work_id.to_string(), percent);
        }
    }
    emit_sync_status(app).await;
}

/// Persist a successful sync activity (pull or manual run).
async fn record_sync_success(pool: &sqlx::SqlitePool) -> Result<(), SyncError> {
    sqlx::query("INSERT OR IGNORE INTO sync_state (id, syncing) VALUES ('state', 0)")
        .execute(pool)
        .await
        .map_err(|_| SyncError::Internal)?;
    sqlx::query("UPDATE sync_state SET last_sync_at = $1, last_error = NULL WHERE id = 'state'")
        .bind(now_ms())
        .execute(pool)
        .await
        .map_err(|_| SyncError::Internal)?;
    Ok(())
}

/// Persist a failed sync activity: the locked classified Chinese copy only.
async fn record_sync_failure(pool: &sqlx::SqlitePool, err: &SyncError) -> Result<(), SyncError> {
    sqlx::query("INSERT OR IGNORE INTO sync_state (id, syncing) VALUES ('state', 0)")
        .execute(pool)
        .await
        .map_err(|_| SyncError::Internal)?;
    sqlx::query("UPDATE sync_state SET last_error = $1 WHERE id = 'state'")
        .bind(err.user_message())
        .execute(pool)
        .await
        .map_err(|_| SyncError::Internal)?;
    Ok(())
}

/// 开书拉 (D-90): pull peer state on book open, merge, and report whether the
/// furthest-position rule jumped this work — the trace-pill payload. The undo
/// stash is READ, never consumed (the user may revert later this session).
/// Unconfigured / not-ready / transport failure all resolve quietly to
/// `jumped: false` (failures persist `last_error` + emit, never block reading).
#[tauri::command]
pub async fn sync_book_opened(
    app: AppHandle,
    work_id: String,
) -> Result<BookOpenedSyncResult, String> {
    let quiet = BookOpenedSyncResult {
        jumped: false,
        device_name: None,
        progress_fraction: None,
        replaced_local: None,
    };
    let Ok(pool) = sqlite_pool(&app).await else {
        return Ok(quiet);
    };
    let Ok(Some(cfg)) = reconcile::load_sync_config(&pool).await else {
        return Ok(quiet);
    };
    let Ok(client) = dav_client_from_row(&cfg) else {
        return Ok(quiet);
    };
    let undo = app.state::<SyncUndoMap>().0.clone();
    let pulled = transport::with_rate_limit_retry(Duration::from_millis(500), || {
        reconcile::pull_state_files(&pool, &client, &cfg, &undo, Some(&work_id))
    })
    .await;
    match pulled {
        Ok(_) => {
            record_sync_success(&pool)
                .await
                .map_err(|e| e.user_message().to_string())?;
            emit_sync_status(&app).await;
        }
        Err(e) => {
            record_sync_failure(&pool, &e)
                .await
                .map_err(|e2| e2.user_message().to_string())?;
            emit_sync_status(&app).await;
            return Ok(quiet);
        }
    }
    let stash = undo.lock().await.get(&work_id).cloned();
    Ok(match stash {
        Some(stash) => BookOpenedSyncResult {
            jumped: true,
            device_name: Some(stash.from_device_name),
            progress_fraction: stash.to_fraction,
            replaced_local: Some(ReplacedLocal {
                cfi: stash.from_row.cfi.clone().unwrap_or_default(),
                progress_fraction: stash.from_row.progress_fraction.unwrap_or(0.0),
            }),
        },
        None => quiet,
    })
}

/// 合书推 (D-90): push this device's state on book close. The pill lifetime
/// ends at close (UI-SPEC §5), so the work's undo stash is dropped. Failures
/// persist to sync_state + event and never error the UI (fire-and-forget).
#[tauri::command]
pub async fn sync_book_closed(app: AppHandle, work_id: String) -> Result<(), String> {
    app.state::<SyncUndoMap>().0.lock().await.remove(&work_id);
    let Ok(pool) = sqlite_pool(&app).await else {
        return Ok(());
    };
    let Ok(Some(cfg)) = reconcile::load_sync_config(&pool).await else {
        return Ok(());
    };
    let Ok(client) = dav_client_from_row(&cfg) else {
        return Ok(());
    };
    let undo = app.state::<SyncUndoMap>().0.clone();
    let _ = reconcile::reconcile_push(&pool, &client, &cfg, &undo).await;
    emit_sync_status(&app).await;
    Ok(())
}

/// The D-92 revert core, pool-addressable so it is testable off-device:
/// consume the stash (a second tap returns `None`), write the exact pre-jump
/// locator row back with a fresh `updated_at`, and append exactly one LOCAL
/// `change_log` row (entity='locator', op='upsert', monotonic clock inside the
/// single INSERT — this revert IS a local user op, so the remote-merge ledger
/// ban does not apply). Returns the RESTORED position so the UI jumps straight
/// from the response.
pub async fn revert_jump_with_pool(
    pool: &sqlx::SqlitePool,
    undo: &UndoMap,
    work_id: &str,
) -> Result<Option<ReplacedLocal>, SyncError> {
    let Some(stash) = undo.lock().await.remove(work_id) else {
        return Ok(None);
    };
    let row = &stash.from_row;
    let now = now_ms();
    sqlx::query(
        "INSERT INTO locator (work_id, cfi, progress_fraction, text_pre, text_exact, \
         text_post, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7) \
         ON CONFLICT(work_id) DO UPDATE SET cfi = excluded.cfi, \
         progress_fraction = excluded.progress_fraction, text_pre = excluded.text_pre, \
         text_exact = excluded.text_exact, text_post = excluded.text_post, \
         updated_at = excluded.updated_at",
    )
    .bind(work_id)
    .bind(&row.cfi)
    .bind(row.progress_fraction)
    .bind(&row.text_pre)
    .bind(&row.text_exact)
    .bind(&row.text_post)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|_| SyncError::Internal)?;

    let device_id = reconcile::own_device_id(pool).await?;
    let payload = serde_json::json!({
        "work_id": work_id,
        "cfi": row.cfi,
        "progress_fraction": row.progress_fraction,
        "text_pre": row.text_pre,
        "text_exact": row.text_exact,
        "text_post": row.text_post,
        "updated_at": now,
    });
    sqlx::query(
        "INSERT INTO change_log (id, device_id, logical_clock, entity, op, payload, created_at) \
         VALUES ($1, $2, \
         COALESCE((SELECT MAX(logical_clock) FROM change_log WHERE device_id = $2), 0) + 1, \
         'locator', 'upsert', $3, $4)",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(&device_id)
    .bind(payload.to_string())
    .bind(now)
    .execute(pool)
    .await
    .map_err(|_| SyncError::Internal)?;

    Ok(Some(ReplacedLocal {
        cfi: row.cfi.clone().unwrap_or_default(),
        progress_fraction: row.progress_fraction.unwrap_or(0.0),
    }))
}

/// 撤回原位 (D-92): restore the exact pre-jump local position. No stash →
/// `null` (soft-fail; a second tap is a no-op).
#[tauri::command]
pub async fn sync_revert_jump(
    app: AppHandle,
    work_id: String,
) -> Result<Option<ReplacedLocal>, String> {
    let pool = sqlite_pool(&app)
        .await
        .map_err(|e| e.user_message().to_string())?;
    let undo = app.state::<SyncUndoMap>().0.clone();
    revert_jump_with_pool(&pool, &undo, &work_id)
        .await
        .map_err(|e| e.user_message().to_string())
}

/// 立即同步 (D-90 兜底): pull first (so the push carries the merged state),
/// then push. The re-entry guard is the in-memory AtomicBool (authoritative;
/// the persisted `syncing` column — reset at engine init — is
/// cross-visibility only). Status transitions emit before and after.
#[tauri::command]
pub async fn sync_now(app: AppHandle) -> Result<SyncStatusPayload, String> {
    if app.state::<SyncEngineState>().syncing.swap(true, Ordering::SeqCst) {
        // A run is already in flight — report current state, never error.
        return status_payload(&app).await;
    }
    let result = sync_now_inner(&app).await;
    app.state::<SyncEngineState>()
        .syncing
        .store(false, Ordering::SeqCst);
    let Ok(pool) = sqlite_pool(&app).await else {
        emit_sync_status(&app).await;
        return status_payload(&app).await;
    };
    if let Err(err) = &result {
        record_sync_failure(&pool, err).await.ok();
    }
    sqlx::query("UPDATE sync_state SET syncing = 0 WHERE id = 'state'")
        .execute(&pool)
        .await
        .ok();
    emit_sync_status(&app).await;
    status_payload(&app).await
}

async fn sync_now_inner(app: &AppHandle) -> Result<(), SyncError> {
    let pool = sqlite_pool(app).await?;
    let Some(cfg) = reconcile::load_sync_config(&pool).await? else {
        return Ok(()); // unconfigured — nothing to do
    };
    sqlx::query("INSERT OR IGNORE INTO sync_state (id, syncing) VALUES ('state', 0)")
        .execute(&pool)
        .await
        .map_err(|_| SyncError::Internal)?;
    sqlx::query("UPDATE sync_state SET syncing = 1 WHERE id = 'state'")
        .execute(&pool)
        .await
        .map_err(|_| SyncError::Internal)?;
    emit_sync_status(app).await;

    let client = dav_client_from_row(&cfg)?;
    let undo = app.state::<SyncUndoMap>().0.clone();
    transport::with_rate_limit_retry(Duration::from_millis(500), || {
        reconcile::pull_state_files(&pool, &client, &cfg, &undo, None)
    })
    .await?;
    reconcile::reconcile_push(&pool, &client, &cfg, &undo).await?;

    // Pending file uploads (07-04 orchestrator-directed wiring): after the
    // state round succeeds, push every 同步此书 book that has no completed
    // upload row. Sequential; a per-book failure is recorded in last_error and
    // NEVER fails the whole sync_now. Runs only here — configured + authed is
    // already proven above (the client build reads the keychain).
    let ctx = fileplane::FilePlaneCtx {
        agent: client.agent.clone(),
        server_dav_root: client.host.clone(),
        username: cfg.username.clone(),
        remote_root: cfg.remote_path.clone(),
        dav: client,
    };
    let report = progress_bridge(app);
    let registry = app.state::<crate::storage::SourceRegistry>();
    let staged = std::sync::Mutex::new(Vec::new());
    let resolve_local = |book: &PendingUpload| {
        local_path_for_upload(app, &registry, &staged, book)
    };
    let pump = pump_pending_uploads(&ctx, &pool, &report, &cfg.remote_path, &resolve_local).await;
    // Staged SAF copies are single-run — always reaped, even on pump error.
    for path in staged.lock().unwrap().drain(..) {
        let _ = std::fs::remove_file(path);
    }
    let (uploaded, upload_error) = pump?;
    if uploaded > 0 {
        // The completed upload rows feed the state builder — push again so
        // peers see file_sync.remote_path/size/hash in THIS sync run.
        reconcile::reconcile_push(&pool, &ctx.dav, &cfg, &undo).await?;
    }
    if let Some(msg) = upload_error {
        record_sync_failure(&pool, &SyncError::Soft(msg)).await?;
    }
    Ok(())
}

/// Current sync status for 07-04's store init (empty transfer arrays until the
/// first event arrives). Password NEVER leaves the keychain — this struct has
/// no field that could carry it (RESEARCH Pattern 4).
#[tauri::command]
pub async fn sync_status(app: AppHandle) -> Result<SyncStatusPayload, String> {
    status_payload(&app).await
}

// ---------------------------------------------------------------------------
// Part 3 (07-03): file plane — 同步此书 opt-in flag + on-demand book download.
// ---------------------------------------------------------------------------

/// Bridge a file-plane progress report into the engine's transfer maps — the
/// SOLE sync-status emitter is `emit_sync_status`; this is the file plane's
/// only channel into it. Reports flow through an unbounded channel drained by
/// one task so ordering is preserved, while the sink itself stays a plain
/// sync closure (fileplane remains Tauri-free and wiremock-testable). Terminal
/// reports (success: `done >= total`; failure: a message is attached) map to
/// percent 100, which REMOVES the entry — the placeholder card leaves its
/// 下载中 {n}% state (research Q3) and either opens or returns to 可下载.
fn progress_bridge(app: &AppHandle) -> impl Fn(fileplane::FileProgress) + Send + Sync {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<fileplane::FileProgress>();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(p) = rx.recv().await {
            let kind = match p.direction {
                fileplane::FileDirection::Download => TransferKind::Download,
                fileplane::FileDirection::Upload => TransferKind::Upload,
            };
            let percent = if p.message.is_some() || (p.total > 0 && p.done >= p.total) {
                100.0 // terminal — removes the transfer entry
            } else if p.total > 0 {
                (p.done as f64 / p.total as f64) * 100.0
            } else {
                0.0
            };
            report_transfer_progress(&app, kind, &p.work_id, percent).await;
        }
    });
    move |p| {
        let _ = tx.send(p);
    }
}

/// The app-owned `books/` subdirectory under `app_data_dir()`, created if
/// missing — mirrors `covers::covers_dir` exactly. Downloaded books land here
/// as `{work_id}.{ext}` (V5: local names derive from work_id, never remote
/// strings).
fn books_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| SyncError::Internal.user_message().to_string())?
        .join("books");
    std::fs::create_dir_all(&dir).map_err(|_| SyncError::Internal.user_message().to_string())?;
    Ok(dir)
}

/// 下载此书 (D-99): fetch a peer-synced book file on demand. Reads the
/// `sync_file_state` DISCOVERY row written by 07-02's pull-merge
/// (`direction='download'`, remote_path/size populated); a missing row means
/// the peer never enabled file sync for this book. The row is consumed —
/// overwritten with live transfer state as the download proceeds, cleared on
/// success. Returns `{ workId, sourceId, localPath }`; 07-04's onDownload
/// then hands `localPath` to `ingestPathToLibrary` (D-100).
#[tauri::command]
pub async fn sync_download_book(
    app: AppHandle,
    work_id: String,
) -> Result<fileplane::DownloadedBook, String> {
    let pool = sqlite_pool(&app)
        .await
        .map_err(|e| e.user_message().to_string())?;
    let row: Option<(Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT size, remote_path FROM sync_file_state \
         WHERE work_id = $1 AND direction = 'download'",
    )
    .bind(&work_id)
    .fetch_optional(&pool)
    .await
    .map_err(|_| SyncError::Internal.user_message().to_string())?;
    let remote_path = row
        .and_then(|(size, remote_path)| remote_path.map(|path| (size, path)))
        .and_then(|(size, path)| {
            if path.is_empty() {
                None
            } else {
                Some((size, path))
            }
        })
        .ok_or("该书没有可下载的远端文件（对端未开启文件同步）")?;
    let (size, remote_path) = remote_path;
    let expected_size = size.unwrap_or(0).max(0) as u64;

    let Some(cfg) = reconcile::load_sync_config(&pool)
        .await
        .map_err(|e| e.user_message().to_string())?
    else {
        return Err(SyncError::Internal.user_message().to_string());
    };
    let client = dav_client_from_row(&cfg).map_err(|e| e.user_message().to_string())?;
    let ctx = fileplane::FilePlaneCtx {
        agent: client.agent.clone(),
        server_dav_root: client.host.clone(),
        username: cfg.username.clone(),
        remote_root: cfg.remote_path.clone(),
        dav: client,
    };
    let books_dir = books_dir(&app)?;
    let registry = app.state::<crate::storage::SourceRegistry>();
    let report = progress_bridge(&app);
    fileplane::download_book(
        &ctx,
        &pool,
        &report,
        &registry,
        &books_dir,
        &work_id,
        &remote_path,
        expected_size,
    )
    .await
    .map_err(|e| e.user_message().to_string())
}

/// 同步此书 (D-98): the per-book opt-in flag — the single point that flips
/// `library_item.file_sync_enabled`. The flag rides the next state-plane push
/// (07-02's builder reads it); upload scheduling on enable is 07-04's
/// trigger, which consumes [`fileplane::upload_book`].
#[tauri::command]
pub async fn sync_set_file_sync(
    app: AppHandle,
    work_id: String,
    enabled: bool,
) -> Result<(), String> {
    let pool = sqlite_pool(&app)
        .await
        .map_err(|e| e.user_message().to_string())?;
    let result = sqlx::query("UPDATE library_item SET file_sync_enabled = $1 WHERE work_id = $2")
        .bind(i64::from(enabled))
        .bind(&work_id)
        .execute(&pool)
        .await
        .map_err(|_| SyncError::Internal.user_message().to_string())?;
    if result.rows_affected() == 0 {
        return Err("未找到该书籍".to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Part 4 (07-04, orchestrator-directed wiring): the pending-upload pump.
// `sync_set_file_sync` flips only the flag — nothing else in production called
// `fileplane::upload_book`, so 同步此书 would never reach the server. The pump
// runs at the tail of every successful `sync_now` (the manual button AND the
// post-enable frontend call share this path), pushing each flagged book that
// has no completed upload row yet, then re-pushing state so peers see the
// fresh `file_sync.remote_path/size/hash` metadata in the same run.
// ---------------------------------------------------------------------------

/// One catalog row waiting for its first (or resumed) upload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingUpload {
    pub work_id: String,
    pub title: String,
    pub author: Option<String>,
    pub source_id: String,
    pub format: String,
}

/// The pending-upload scan: 同步此书 ON, not tombstoned, holding a real local
/// source (never the `sync-remote` placeholder sentinel), and WITHOUT a
/// completed upload metadata row (`direction='upload'` with `remote_path` —
/// the exact row the 07-02 state builder reads). An interrupted upload
/// (scratch row with `remote_path NULL`) IS returned: `upload_book` resumes it
/// via its `transfer_uuid`/`chunks_done`.
pub async fn pending_uploads(pool: &sqlx::SqlitePool) -> Result<Vec<PendingUpload>, SyncError> {
    let rows: Vec<(String, String, Option<String>, String, String)> = sqlx::query_as(
        "SELECT li.work_id, li.title, li.author, li.source_id, w.format \
         FROM library_item li JOIN work w ON w.work_id = li.work_id \
         WHERE li.file_sync_enabled = 1 AND li.deleted = 0 \
           AND li.source_id != 'sync-remote' \
           AND NOT EXISTS ( \
             SELECT 1 FROM sync_file_state s \
             WHERE s.work_id = li.work_id AND s.direction = 'upload' \
               AND s.remote_path IS NOT NULL \
           ) \
         ORDER BY li.work_id",
    )
    .fetch_all(pool)
    .await
    .map_err(|_| SyncError::Internal)?;
    Ok(rows
        .into_iter()
        .map(|(work_id, title, author, source_id, format)| PendingUpload {
            work_id,
            title,
            author,
            source_id,
            format,
        })
        .collect())
}

/// Upload one pending book under core's single naming point (D-105): plain
/// `作者 - 书名.ext` first; a same-name different-bytes destination is a naming
/// collision (NEVER silently overwritten), so retry once with the `[hash8]`
/// suffix before giving up. The returned `&'static str` is the classified
/// [`fileplane::FileError::user_message`] copy — rendered verbatim downstream.
pub async fn upload_pending_book(
    ctx: &fileplane::FilePlaneCtx,
    pool: &sqlx::SqlitePool,
    report: &(dyn Fn(fileplane::FileProgress) + Send + Sync),
    remote_root: &str,
    book: &PendingUpload,
    local_path: &std::path::Path,
) -> Result<(), &'static str> {
    let author = book.author.clone().unwrap_or_default();
    let mut collision = false;
    loop {
        let remote_path = pillowtome_core::sync::remote::book_remote_path(
            remote_root,
            &author,
            &book.title,
            &book.format,
            &book.work_id,
            collision,
        )
        .map_err(|_| fileplane::FileError::Internal.user_message())?;
        match fileplane::upload_book(ctx, pool, report, &book.work_id, local_path, &remote_path)
            .await
        {
            Ok(()) => return Ok(()),
            Err(fileplane::FileError::RemoteConflict) if !collision => {
                collision = true;
            }
            Err(err) => return Err(err.user_message()),
        }
    }
}

/// Sequential pump over [`pending_uploads`] — pool/ctx/closure shaped so the
/// wiremock suites drive it without an `AppHandle`. `resolve_local` maps a
/// candidate to a readable local path (desktop `Path` sources in place; SAF
/// `content://` books pre-staged by the caller) and returns `None` when the
/// file is not held locally this session — that book is skipped, not failed.
/// A per-book failure NEVER aborts the pump: the first failure's classified
/// copy is returned for `last_error` and the remaining books still run.
/// Returns `(uploaded_count, first_failure_copy)`.
pub async fn pump_pending_uploads(
    ctx: &fileplane::FilePlaneCtx,
    pool: &sqlx::SqlitePool,
    report: &(dyn Fn(fileplane::FileProgress) + Send + Sync),
    remote_root: &str,
    resolve_local: &(dyn Fn(&PendingUpload) -> Option<std::path::PathBuf> + Send + Sync),
) -> Result<(usize, Option<&'static str>), SyncError> {
    let mut uploaded = 0usize;
    let mut first_error: Option<&'static str> = None;
    for book in pending_uploads(pool).await? {
        let Some(local_path) = resolve_local(&book) else {
            continue;
        };
        match upload_pending_book(ctx, pool, report, remote_root, &book, &local_path).await {
            Ok(()) => uploaded += 1,
            Err(msg) => {
                if first_error.is_none() {
                    first_error = Some(msg);
                }
            }
        }
    }
    Ok((uploaded, first_error))
}

/// The production resolver for [`pump_pending_uploads`]: desktop `Path`
/// sources upload in place; Android SAF `content://` books stage through the
/// cache dir (whole-bytes read — the pre-existing platform constraint every
/// book open already has, fileplane.rs module docs) and the staged copy is
/// pushed into `staged` so the caller reaps it after the run.
fn local_path_for_upload(
    app: &AppHandle,
    registry: &crate::storage::SourceRegistry,
    staged: &std::sync::Mutex<Vec<std::path::PathBuf>>,
    book: &PendingUpload,
) -> Option<std::path::PathBuf> {
    match registry.resolve(&book.source_id)? {
        pillowtome_core::source::BookSource::Path(path) => Some(path),
        pillowtome_core::source::BookSource::ContentUri(uri) => {
            let source = pillowtome_core::source::BookSource::ContentUri(uri);
            let bytes = crate::storage::resolve_bytes(&source, app).ok()?;
            let dir = app.path().app_cache_dir().ok()?.join("sync-upload");
            std::fs::create_dir_all(&dir).ok()?;
            let path = dir.join(format!("{}.{}", book.work_id, book.format));
            std::fs::write(&path, bytes).ok()?;
            staged.lock().unwrap().push(path.clone());
            Some(path)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_deserializes_camelcase_with_defaults_absent() {
        let input: SyncConfigInput = serde_json::from_str(
            r#"{"serverUrl":"https://dav.example.com","username":"u","password":"p"}"#,
        )
        .expect("camelCase input deserializes");
        assert_eq!(input.server_url, "https://dav.example.com");
        assert_eq!(input.username, "u");
        assert_eq!(input.password, "p");
        assert!(input.remote_path.is_none());
        assert!(input.allow_http.is_none());
        assert!(input.trust_self_signed.is_none());
        assert!(input.device_name.is_none());
    }

    #[test]
    fn input_debug_redacts_the_password() {
        use std::fmt::Write as _;
        let input: SyncConfigInput = serde_json::from_str(
            r#"{"serverUrl":"https://dav.example.com","username":"alice","password":"s3cret"}"#,
        )
        .expect("camelCase input deserializes");
        let mut dbg = String::new();
        write!(&mut dbg, "{input:?}").expect("write to string");
        assert!(dbg.contains("***"));
        assert!(!dbg.contains("s3cret"));
    }
}
