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
#[allow(dead_code)] // Consumed by 07-03's file plane; engine-owned today.
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
    reconcile::reconcile_push(&pool, &client, &cfg, &undo).await
}

/// Current sync status for 07-04's store init (empty transfer arrays until the
/// first event arrives). Password NEVER leaves the keychain — this struct has
/// no field that could carry it (RESEARCH Pattern 4).
#[tauri::command]
pub async fn sync_status(app: AppHandle) -> Result<SyncStatusPayload, String> {
    status_payload(&app).await
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
