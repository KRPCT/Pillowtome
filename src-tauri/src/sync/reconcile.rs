//! State-plane reconcile engine (SYNC-02/SYNC-03/SYNC-05, 07-RESEARCH Pattern 1).
//!
//! Push: rebuild this device's self-describing `state/<device_id>.json` from
//! SQLite (register-shaped, never a raw change_log replay), PUT it to a
//! `tmp-<uuid>` name and publish by atomic MOVE with the If-None-Match/If-Match
//! optimistic-concurrency backstop (412 → re-pull-merge-retry ONCE).
//!
//! Pull: PROPFIND the state dir for a device_id → ETag map, GET only
//! ETag-changed peer files (peer cache rows `sync_state.id='peer:<device_id>'`),
//! V5-validate, then merge into SQLite via 07-00's pure map drivers — set
//! union, tombstone remove-wins, `冲突副本` conflict copies under fresh ids.
//!
//! Ledger hygiene (locked anti-pattern ban): records merged in from peers are
//! NEVER written to the local `change_log` — the ledger records local ops
//! only, so remote merges cause no clock inflation and no re-push loops. The
//! only sync-plane ledger write anywhere is the LOCAL D-92 revert row in
//! commands.rs.
//!
//! This module never touches credentials: clients arrive fully built from
//! commands.rs (07-01's transport gates apply there, never re-widened here).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use pillowtome_core::sync::merge::{merge_annotation_map, merge_library_map, merge_progress_map};
use pillowtome_core::sync::model::{
    AnnotationRec, DeviceRecord, DeviceStateFile, FileSyncRec, LibraryRec, ProgressRec,
    REMOTE_FORMAT,
};
use pillowtome_core::sync::remote::{
    device_file_path, join_remote, sanitize_segment, state_file_path, state_tmp_file_path,
};
use reqwest_dav::types::list_cmd::ListEntity;
use sqlx::SqlitePool;

use super::now_ms;
use super::transport::{authed, classify, classify_http_status, join_url, with_rate_limit_retry};
use super::SyncError;

/// Body cap for a pulled peer state file (T-07-02-02): anything larger is
/// skipped with a warning, never parsed.
const MAX_STATE_BODY_BYTES: u64 = 16 * 1024 * 1024;

/// Truncation defense watermark (Pitfall 3): servers may cap PROPFIND depth-1
/// listings; at this count we warn-and-continue rather than silently drop
/// devices. Per-device single files keep real counts far below this.
const PROPFIND_TRUNCATION_WATERMARK: usize = 750;

/// The `sync_config` row as the reconcile engine needs it. Credential-free by
/// construction — the secret never leaves the OS keychain (commands.rs builds
/// the client; this module only sees the finished `reqwest_dav::Client`).
#[derive(Debug, Clone)]
pub struct SyncConfigRow {
    pub server_url: String,
    pub username: String,
    pub remote_path: String,
    pub allow_http: bool,
    pub trust_self_signed: bool,
    pub device_name: Option<String>,
}

/// The D-92 undo payload: the exact local locator row a peer merge displaced,
/// stashed BEFORE any overwrite (Pitfall 7). Session-scoped via the managed
/// `SyncUndoMap`; consumed only by `sync_revert_jump` (and dropped at 合书).
#[derive(Debug, Clone, PartialEq)]
pub struct JumpStash {
    pub work_id: String,
    /// The displaced pre-jump local locator row (composite D-08 position).
    pub from_row: ProgressRec,
    /// The merged winner's fraction (where the jump landed).
    pub to_fraction: Option<f64>,
    /// The peer device's display name (for the 「{设备名称}」上读到了 {n}% dialog).
    pub from_device_name: String,
    pub stashed_at: i64,
}

/// Session undo map: work_id → the pre-jump local row. `Arc<Mutex<…>>` so the
/// managed Tauri state shares one instance with every reconcile run.
pub type UndoMap = Arc<tokio::sync::Mutex<HashMap<String, JumpStash>>>;

/// Fresh empty undo map (managed-state default + tests).
pub fn new_undo_map() -> UndoMap {
    Arc::new(tokio::sync::Mutex::new(HashMap::new()))
}

/// What one pull did. `jumps` carries the stashes this pull committed
/// (filtered to `scope_work` when given); `warnings` are soft, Chinese,
/// per-device skips (never abort the pull); `own_etag` is this device's own
/// state-file ETag seen in the PROPFIND listing — the 412-recovery path
/// retries its MOVE against it.
#[derive(Debug, Default)]
pub struct PullReport {
    pub pulled_devices: usize,
    pub merged_progress: usize,
    pub merged_annotations: usize,
    pub merged_library: usize,
    pub jumps: Vec<JumpStash>,
    pub warnings: Vec<String>,
    pub own_etag: Option<String>,
}

/// Read the single `sync_config` row, if any.
pub async fn load_sync_config(pool: &SqlitePool) -> Result<Option<SyncConfigRow>, SyncError> {
    let row: Option<(String, String, String, bool, bool, Option<String>)> = sqlx::query_as(
        "SELECT server_url, username, remote_path, allow_http, trust_self_signed, device_name \
         FROM sync_config WHERE id = 'config'",
    )
    .fetch_optional(pool)
    .await
    .map_err(|_| SyncError::Internal)?;
    Ok(row.map(
        |(server_url, username, remote_path, allow_http, trust_self_signed, device_name)| {
            SyncConfigRow {
                server_url,
                username,
                remote_path,
                allow_http,
                trust_self_signed,
                device_name,
            }
        },
    ))
}

/// This device's stable id: the `sync_meta` row, created on first use with a
/// fresh uuid (mirrors the frontend `ensureDevice()` — INSERT OR IGNORE keeps
/// the original id afterwards). The id names this device's exclusive remote
/// files, so it must be stable and must exist before any push/pull.
pub async fn own_device_id(pool: &SqlitePool) -> Result<String, SyncError> {
    let fresh = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT OR IGNORE INTO sync_meta (id, device_id, logical_clock) VALUES ('device', $1, 0)")
        .bind(&fresh)
        .execute(pool)
        .await
        .map_err(|_| SyncError::Internal)?;
    sqlx::query_scalar("SELECT device_id FROM sync_meta WHERE id = 'device'")
        .fetch_one(pool)
        .await
        .map_err(|_| SyncError::Internal)
}

/// Ensure the single `sync_state` row exists so plain UPDATEs always land.
async fn ensure_state_row(pool: &SqlitePool) -> Result<(), SyncError> {
    sqlx::query("INSERT OR IGNORE INTO sync_state (id, syncing) VALUES ('state', 0)")
        .execute(pool)
        .await
        .map_err(|_| SyncError::Internal)?;
    Ok(())
}

/// Rebuild this device's `DeviceStateFile` from local tables (RESEARCH Pattern
/// 1: register, not log — the push payload is never a raw change_log replay).
///
/// - progress: one latest `ProgressRec` per work (locator UNIQUE index).
/// - annotations: the FULL set including tombstones (never filtered to live
///   rows only — deletes must ride the state file so they never resurrect),
///   each tagged `hash_algo: "sha256"` per-record (annotation hashes are
///   WebCrypto SHA-256; work hashes are blake3 — never cross-compare,
///   Pitfall 6).
/// - library: the FULL catalog including tombstoned rows; `file_sync_enabled`
///   rows carry upload metadata from `sync_file_state` (`direction='upload'`)
///   when a completed upload row exists, `{enabled: true}` alone while 07-03's
///   upload is still pending; disabled rows emit `{enabled: false}`.
pub async fn build_device_state(
    pool: &SqlitePool,
    cfg: &SyncConfigRow,
    now_ms: i64,
) -> Result<DeviceStateFile, SyncError> {
    let device_id = own_device_id(pool).await?;
    let clock: i64 = sqlx::query_scalar("SELECT logical_clock FROM sync_meta WHERE id = 'device'")
        .fetch_one(pool)
        .await
        .map_err(|_| SyncError::Internal)?;

    let progress_rows: Vec<(
        String,
        Option<String>,
        Option<f64>,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
    )> = sqlx::query_as(
        "SELECT work_id, cfi, progress_fraction, text_pre, text_exact, text_post, updated_at \
         FROM locator",
    )
    .fetch_all(pool)
    .await
    .map_err(|_| SyncError::Internal)?;
    let progress: BTreeMap<String, ProgressRec> = progress_rows
        .into_iter()
        .map(|(work_id, cfi, fraction, pre, exact, post, ts)| {
            (
                work_id,
                ProgressRec {
                    cfi,
                    progress_fraction: fraction,
                    text_pre: pre,
                    text_exact: exact,
                    text_post: post,
                    updated_at: ts,
                },
            )
        })
        .collect();

    let annotation_rows: Vec<(
        String,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<f64>,
        Option<String>,
        i64,
        i64,
        i64,
        Option<String>,
        i64,
    )> = sqlx::query_as(
        "SELECT annotation_id, work_id, type, cfi, color, text_pre, text_exact, text_post, \
         progress_fraction, note, created_at, updated_at, revision, content_hash, deleted \
         FROM annotation",
    )
    .fetch_all(pool)
    .await
    .map_err(|_| SyncError::Internal)?;
    let annotations: BTreeMap<String, AnnotationRec> = annotation_rows
        .into_iter()
        .map(
            |(
                annotation_id,
                work_id,
                annotation_type,
                cfi,
                color,
                text_pre,
                text_exact,
                text_post,
                progress_fraction,
                note,
                created_at,
                updated_at,
                revision,
                content_hash,
                deleted,
            )| {
                (
                    annotation_id,
                    AnnotationRec {
                        work_id,
                        annotation_type,
                        cfi,
                        color,
                        text_pre,
                        text_exact,
                        text_post,
                        progress_fraction,
                        note,
                        created_at,
                        updated_at,
                        revision,
                        content_hash,
                        hash_algo: Some("sha256".to_string()),
                        deleted,
                    },
                )
            },
        )
        .collect();

    let library = load_local_library(pool).await?;

    Ok(DeviceStateFile {
        format: REMOTE_FORMAT,
        device_id,
        device_name: cfg
            .device_name
            .clone()
            .unwrap_or_else(|| "未命名设备".to_string()),
        clock,
        updated_at: now_ms,
        progress,
        annotations,
        library,
    })
}

/// The `devices/<device_id>.json` registry entry: `first_seen` survives from an
/// existing record; `last_seen` always advances.
pub fn build_device_record(
    existing: Option<DeviceRecord>,
    device_id: &str,
    device_name: &str,
    now_ms: i64,
) -> DeviceRecord {
    DeviceRecord {
        device_id: device_id.to_string(),
        device_name: device_name.to_string(),
        first_seen: existing.map(|r| r.first_seen).unwrap_or(now_ms),
        last_seen: now_ms,
    }
}

/// Load the local progress register into the merge record shape.
async fn load_local_progress(
    pool: &SqlitePool,
) -> Result<BTreeMap<String, ProgressRec>, SyncError> {
    let rows: Vec<(
        String,
        Option<String>,
        Option<f64>,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
    )> = sqlx::query_as(
        "SELECT work_id, cfi, progress_fraction, text_pre, text_exact, text_post, updated_at \
         FROM locator",
    )
    .fetch_all(pool)
    .await
    .map_err(|_| SyncError::Internal)?;
    Ok(rows
        .into_iter()
        .map(|(work_id, cfi, fraction, pre, exact, post, ts)| {
            (
                work_id,
                ProgressRec {
                    cfi,
                    progress_fraction: fraction,
                    text_pre: pre,
                    text_exact: exact,
                    text_post: post,
                    updated_at: ts,
                },
            )
        })
        .collect())
}

/// Load ALL local annotations (tombstones included) into the merge record
/// shape. The table has no `hash_algo` column — every row is WebCrypto
/// SHA-256 by construction (annotation-store invariant), so the tag is
/// attached here per-record.
async fn load_local_annotations(
    pool: &SqlitePool,
) -> Result<BTreeMap<String, AnnotationRec>, SyncError> {
    let rows: Vec<(
        String,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<f64>,
        Option<String>,
        i64,
        i64,
        i64,
        Option<String>,
        i64,
    )> = sqlx::query_as(
        "SELECT annotation_id, work_id, type, cfi, color, text_pre, text_exact, text_post, \
         progress_fraction, note, created_at, updated_at, revision, content_hash, deleted \
         FROM annotation",
    )
    .fetch_all(pool)
    .await
    .map_err(|_| SyncError::Internal)?;
    Ok(rows
        .into_iter()
        .map(
            |(
                annotation_id,
                work_id,
                annotation_type,
                cfi,
                color,
                text_pre,
                text_exact,
                text_post,
                progress_fraction,
                note,
                created_at,
                updated_at,
                revision,
                content_hash,
                deleted,
            )| {
                (
                    annotation_id,
                    AnnotationRec {
                        work_id,
                        annotation_type,
                        cfi,
                        color,
                        text_pre,
                        text_exact,
                        text_post,
                        progress_fraction,
                        note,
                        created_at,
                        updated_at,
                        revision,
                        content_hash,
                        hash_algo: Some("sha256".to_string()),
                        deleted,
                    },
                )
            },
        )
        .collect())
}

/// Load the FULL local catalog (tombstones included) joined with `work`, with
/// per-row upload metadata from `sync_file_state` (`direction='upload'` — the
/// 07-00 DDL vocabulary, never `'up'`).
async fn load_local_library(pool: &SqlitePool) -> Result<BTreeMap<String, LibraryRec>, SyncError> {
    let rows: Vec<(
        String,
        String,
        Option<String>,
        i64,
        i64,
        i64,
        String,
        String,
    )> = sqlx::query_as(
        "SELECT li.work_id, li.title, li.author, li.imported_at, li.deleted, \
         li.file_sync_enabled, w.content_hash, w.format \
         FROM library_item li JOIN work w ON w.work_id = li.work_id",
    )
    .fetch_all(pool)
    .await
    .map_err(|_| SyncError::Internal)?;
    let mut map = BTreeMap::new();
    for (work_id, title, author, imported_at, deleted, file_sync_enabled, content_hash, format) in
        rows
    {
        let file_sync = if file_sync_enabled != 0 {
            let meta: Option<(Option<String>, Option<i64>, Option<String>)> = sqlx::query_as(
                "SELECT remote_path, size, hash FROM sync_file_state \
                 WHERE work_id = $1 AND direction = 'upload' AND remote_path IS NOT NULL",
            )
            .bind(&work_id)
            .fetch_optional(pool)
            .await
            .map_err(|_| SyncError::Internal)?;
            match meta {
                Some((remote_path, size, hash)) => Some(FileSyncRec {
                    enabled: true,
                    remote_path,
                    size,
                    hash,
                }),
                // Upload pending — 07-03's file plane fills the metadata in.
                None => Some(FileSyncRec {
                    enabled: true,
                    remote_path: None,
                    size: None,
                    hash: None,
                }),
            }
        } else {
            Some(FileSyncRec {
                enabled: false,
                remote_path: None,
                size: None,
                hash: None,
            })
        };
        map.insert(
            work_id,
            LibraryRec {
                title,
                author,
                format,
                content_hash,
                imported_at,
                deleted,
                file_sync,
            },
        );
    }
    Ok(map)
}

/// Publish a state file atomically (Pitfall 5): PUT the body to
/// `state/<device_id>.json.tmp-<uuid>`, then MOVE it onto the final name with
/// `Overwrite: T` (Pitfall 8) and the optimistic-concurrency backstop —
/// `If-None-Match: *` on the first-ever write, `If-Match: <last_etag>` after
/// (the stored ETag passes through VERBATIM, quotes included — opaque equality
/// token, never parsed). A 412 answers as [`SyncError::RemoteChanged`] (the
/// guarded case is same-device dual-open only; cross-device write conflicts
/// are impossible by construction, Pattern 1).
///
/// `state_path`/`tmp_path` are remote paths relative to the server host; the
/// full URLs for the agent requests are joined here. Returns the post-MOVE
/// ETag from a depth-0 PROPFIND, or an empty string when the server sends none
/// (A1 degrade: store empty and proceed).
pub async fn push_state_file(
    client: &reqwest_dav::Client,
    state_path: &str,
    tmp_path: &str,
    body: &[u8],
    last_etag: Option<&str>,
) -> Result<String, SyncError> {
    let state_url = join_url(&client.host, state_path);
    let tmp_url = join_url(&client.host, tmp_path);

    // 1) tmp PUT — a crashed push orphans only a tmp file; readers never match
    //    tmp names (Pitfall 5). reqwest_dav's high-level put() cannot carry
    //    headers, so this goes through the public agent (Pattern 3) — with
    //    auth attached explicitly: the raw agent sends no Authorization by
    //    itself (see transport::authed).
    let resp = authed(client, client.agent.put(&tmp_url))
        .header("Content-Type", "application/json")
        .body(body.to_vec())
        .send()
        .await
        .map_err(|e| classify(&reqwest_dav::Error::from(e)))?;
    let code = resp.status().as_u16();
    if !(200..300).contains(&code) {
        return Err(classify_http_status(code).unwrap_or(SyncError::Internal));
    }

    // 2) Conditional MOVE publish.
    let method =
        reqwest::Method::from_bytes(b"MOVE").map_err(|_| SyncError::Internal)?;
    let mut mv = authed(client, client.agent.request(method, &tmp_url))
        .header("Destination", &state_url)
        .header("Overwrite", "T");
    mv = match last_etag {
        Some(etag) => mv.header("If-Match", etag),
        None => mv.header("If-None-Match", "*"),
    };
    let resp = mv
        .send()
        .await
        .map_err(|e| classify(&reqwest_dav::Error::from(e)))?;
    let code = resp.status().as_u16();
    if !(200..300).contains(&code) {
        return Err(classify_http_status(code).unwrap_or(SyncError::Internal));
    }

    // 3) New ETag via depth-0 PROPFIND (plan text says `Depth::Zero`;
    //    reqwest_dav 0.3.3 has no such variant — `Depth::Number(0)` is the
    //    depth-0 spelling, same as 07-01's probe).
    let tag = match client
        .list(state_path, reqwest_dav::Depth::Number(0))
        .await
    {
        Ok(entities) => entities
            .into_iter()
            .find_map(|e| match e {
                ListEntity::File(f) if f.href.trim_end_matches('/').ends_with(state_path) => f.tag,
                _ => None,
            })
            .unwrap_or_default(),
        // A1 degrade: a server that cannot re-PROPFIND still got the file.
        Err(_) => String::new(),
    };
    Ok(tag)
}

/// One push attempt: rebuild the state file from SQLite, serialize, tmp PUT +
/// conditional MOVE under the rate-limit backoff (503/429 → exponential
/// backoff, then the 限流 class surfaces).
async fn push_once(
    pool: &SqlitePool,
    client: &reqwest_dav::Client,
    cfg: &SyncConfigRow,
    last_etag: Option<&str>,
) -> Result<String, SyncError> {
    let state = build_device_state(pool, cfg, now_ms()).await?;
    let body = serde_json::to_vec(&state).map_err(|_| SyncError::Internal)?;
    let state_rel =
        state_file_path(&cfg.remote_path, &state.device_id).map_err(|_| SyncError::Permission)?;
    let tmp_rel = state_tmp_file_path(&cfg.remote_path, &state.device_id, &uuid::Uuid::new_v4().to_string())
        .map_err(|_| SyncError::Permission)?;
    with_rate_limit_retry(Duration::from_millis(500), || {
        push_state_file(client, &state_rel, &tmp_rel, &body, last_etag)
    })
    .await
}

/// Persist a successful push: fresh ETag, last_sync_at, cleared error, and the
/// `syncing` column reset (the in-memory flag is the live guard).
async fn record_push_success(pool: &SqlitePool, etag: &str) -> Result<(), SyncError> {
    ensure_state_row(pool).await?;
    sqlx::query(
        "UPDATE sync_state SET remote_etag = $1, last_sync_at = $2, last_error = NULL, syncing = 0 \
         WHERE id = 'state'",
    )
    .bind(etag)
    .bind(now_ms())
    .execute(pool)
    .await
    .map_err(|_| SyncError::Internal)?;
    Ok(())
}

/// Persist a failed push: the locked classified Chinese copy, verbatim —
/// never raw OS/server text (D-97).
async fn record_push_failure(pool: &SqlitePool, err: &SyncError) -> Result<(), SyncError> {
    ensure_state_row(pool).await?;
    sqlx::query("UPDATE sync_state SET last_error = $1, syncing = 0 WHERE id = 'state'")
        .bind(err.user_message())
        .execute(pool)
        .await
        .map_err(|_| SyncError::Internal)?;
    Ok(())
}

/// The push spine: read the stored ETag, rebuild + publish. A 412
/// ([`SyncError::RemoteChanged`]) means our own file changed under us
/// (same-device dual-open, Pattern 1 backstop): run the pull path ONCE, merge,
/// then retry the push ONCE against the fresh own-file ETag seen in that
/// pull's PROPFIND — no loop. Success refreshes the devices-registry entry
/// (best-effort); failure persists the classified `last_error`.
pub async fn reconcile_push(
    pool: &SqlitePool,
    client: &reqwest_dav::Client,
    cfg: &SyncConfigRow,
    undo: &UndoMap,
) -> Result<(), SyncError> {
    ensure_state_row(pool).await?;
    let last_etag: Option<String> =
        sqlx::query_scalar("SELECT remote_etag FROM sync_state WHERE id = 'state'")
            .fetch_optional(pool)
            .await
            .map_err(|_| SyncError::Internal)?
            .flatten();

    match push_once(pool, client, cfg, last_etag.as_deref()).await {
        Ok(new_etag) => {
            record_push_success(pool, &new_etag).await?;
            let _ = upsert_device_record(client, cfg, pool).await;
            Ok(())
        }
        Err(SyncError::RemoteChanged) => {
            let report = pull_state_files(pool, client, cfg, undo, None).await?;
            let fresh_etag = report.own_etag.or(last_etag);
            match push_once(pool, client, cfg, fresh_etag.as_deref()).await {
                Ok(new_etag) => {
                    record_push_success(pool, &new_etag).await?;
                    let _ = upsert_device_record(client, cfg, pool).await;
                    Ok(())
                }
                Err(e) => {
                    record_push_failure(pool, &e).await?;
                    Err(e)
                }
            }
        }
        Err(e) => {
            record_push_failure(pool, &e).await?;
            Err(e)
        }
    }
}

/// Maintain this device's `devices/<device_id>.json` registry entry: preserve
/// `first_seen` from any existing record, advance `last_seen`, publish
/// tmp+MOVE unconditionally (own exclusive file, idempotent). Called at the
/// end of every successful push and pull; failures are best-effort (the state
/// file is the payload, the registry is bookkeeping).
pub async fn upsert_device_record(
    client: &reqwest_dav::Client,
    cfg: &SyncConfigRow,
    pool: &SqlitePool,
) -> Result<(), SyncError> {
    let device_id = own_device_id(pool).await?;
    let rel = device_file_path(&cfg.remote_path, &device_id).map_err(|_| SyncError::Permission)?;
    let existing: Option<DeviceRecord> = match client.get(&rel).await {
        Ok(resp) => resp
            .bytes()
            .await
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok()),
        Err(_) => None,
    };
    let device_name = cfg
        .device_name
        .clone()
        .unwrap_or_else(|| "未命名设备".to_string());
    let record = build_device_record(existing, &device_id, &device_name, now_ms());
    let body = serde_json::to_vec(&record).map_err(|_| SyncError::Internal)?;

    let tmp_rel = format!("{rel}.tmp-{}", uuid::Uuid::new_v4());
    let url = join_url(&client.host, &rel);
    let tmp_url = join_url(&client.host, &tmp_rel);
    let resp = authed(client, client.agent.put(&tmp_url))
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| classify(&reqwest_dav::Error::from(e)))?;
    let code = resp.status().as_u16();
    if !(200..300).contains(&code) {
        return Err(classify_http_status(code).unwrap_or(SyncError::Internal));
    }
    let method = reqwest::Method::from_bytes(b"MOVE").map_err(|_| SyncError::Internal)?;
    let resp = authed(client, client.agent.request(method, &tmp_url))
        .header("Destination", &url)
        .header("Overwrite", "T")
        .send()
        .await
        .map_err(|e| classify(&reqwest_dav::Error::from(e)))?;
    let code = resp.status().as_u16();
    if !(200..300).contains(&code) {
        return Err(classify_http_status(code).unwrap_or(SyncError::Internal));
    }
    Ok(())
}

/// True for a peer state file name: `<device_id>.json`, never a tmp publish
/// name (`*.json.tmp-<uuid>` or any `tmp-*` straggler).
fn is_state_file_name(name: &str) -> bool {
    name.ends_with(".json") && !name.contains(".tmp-") && !name.starts_with("tmp-")
}

/// GET a remote file with a hard body cap (T-07-02-02): the Content-Length
/// header is checked first, then the stream is bounded chunk-by-chunk so a
/// lying header cannot push the body past the cap either.
enum GetBodyError {
    /// Any transport failure — the pull downgrades it to a per-device warning
    /// (the initial state-dir PROPFIND is the classified hard-fail gate).
    Transport,
    TooLarge,
}

async fn get_body_capped(
    client: &reqwest_dav::Client,
    rel_path: &str,
    cap: u64,
) -> Result<Vec<u8>, GetBodyError> {
    let mut resp = client
        .get(rel_path)
        .await
        .map_err(|_| GetBodyError::Transport)?;
    if resp.content_length().is_some_and(|len| len > cap) {
        return Err(GetBodyError::TooLarge);
    }
    let mut buf = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|_| GetBodyError::Transport)?
    {
        if (buf.len() + chunk.len()) as u64 > cap {
            return Err(GetBodyError::TooLarge);
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

/// The pull spine: PROPFIND the state dir (depth-1) for a device_id → ETag
/// map, GET only ETag-changed peer files, V5-validate, fold ONE device at a
/// time through 07-00's pure map drivers, and write the union into SQLite —
/// with ZERO `change_log` writes (the ledger records local ops only; a merge
/// that wrote remote rows into it would inflate the clock and re-push loops).
///
/// Every device merge is one SQLite transaction: a malformed/oversized/
/// foreign-format file is skipped with a Chinese warning before any write, and
/// per-entry write failures (e.g. an orphaned locator for a work the catalog
/// never carried) skip that entry with a warning instead of aborting the pull.
/// Progress overwrites stash the displaced local row in `undo` BEFORE the
/// write commits (D-92). Changed library recs carrying remote file metadata
/// land `sync_file_state` DISCOVERY rows (`direction='download'`, NULL
/// transfer_uuid) so 07-03's `sync_download_book` needs no extra network.
pub async fn pull_state_files(
    pool: &SqlitePool,
    client: &reqwest_dav::Client,
    cfg: &SyncConfigRow,
    undo: &UndoMap,
    scope_work: Option<&str>,
) -> Result<PullReport, SyncError> {
    let own_id = own_device_id(pool).await?;
    let root = cfg.remote_path.as_str();
    let state_dir = join_remote(root, &["state"]).map_err(|_| SyncError::Permission)?;
    let mut report = PullReport::default();

    // 1) Device → ETag map. Depth-1 collection listing (plan text: `Depth::One`
    //    — reqwest_dav 0.3.3 spells it `Depth::Number(1)`, see 07-01). The
    //    trailing slash addresses the collection (sabre/Nextcloud 301 a
    //    slash-less collection PROPFIND).
    let list_path = format!("{state_dir}/");
    let entities = client
        .list(&list_path, reqwest_dav::Depth::Number(1))
        .await
        .map_err(|e| classify(&e))?;

    let mut peers: BTreeMap<String, Option<String>> = BTreeMap::new();
    let mut listed_files = 0usize;
    for entity in &entities {
        let ListEntity::File(file) = entity else {
            continue;
        };
        listed_files += 1;
        let href = file.href.trim_end_matches('/');
        let Some(file_name) = href.rsplit('/').next() else {
            continue;
        };
        if !is_state_file_name(file_name) {
            continue;
        }
        let device_id = &file_name[..file_name.len() - ".json".len()];
        // Path jail (T-07-02-03): the id must be a single clean segment and the
        // href must end at OUR state path for it — anything else is ignored.
        if sanitize_segment(device_id).is_err() {
            continue;
        }
        let expected_tail =
            join_remote(root, &["state", file_name]).map_err(|_| SyncError::Permission)?;
        if !href.ends_with(&expected_tail) {
            continue;
        }
        if device_id == own_id {
            // Our own file's current ETag — the 412-recovery retry targets it.
            report.own_etag = file.tag.clone();
            continue;
        }
        peers.insert(device_id.to_string(), file.tag.clone());
    }
    if listed_files >= PROPFIND_TRUNCATION_WATERMARK {
        report
            .warnings
            .push("设备列表可能被服务器截断，部分设备本次未同步".to_string());
    }

    // 2) Peer-ETag cache (`sync_state.id='peer:<device_id>'` — id + remote_etag
    //    only). Unchanged peers cost zero GETs (Nutstore request frugality).
    let cache_rows: Vec<(String, Option<String>)> =
        sqlx::query_as("SELECT id, remote_etag FROM sync_state WHERE id LIKE 'peer:%'")
            .fetch_all(pool)
            .await
            .map_err(|_| SyncError::Internal)?;
    let cache: HashMap<String, Option<String>> = cache_rows.into_iter().collect();

    // 3) Local side, loaded once into the same Rec types the merge drivers take.
    let initial_progress = load_local_progress(pool).await?;
    let mut local_progress = initial_progress.clone();
    let mut local_annotations = load_local_annotations(pool).await?;
    let mut local_library = load_local_library(pool).await?;

    let mut stashed_works: HashSet<String> = HashSet::new();
    let mut pending_stashes: Vec<JumpStash> = Vec::new();

    for (peer_id, etag) in &peers {
        let peer_row_key = format!("peer:{peer_id}");
        let unchanged = match (cache.get(&peer_row_key), etag) {
            (Some(cached), Some(seen)) => cached.as_deref() == Some(seen.as_str()),
            _ => false,
        };
        if unchanged {
            continue;
        }

        // 4) GET the changed file, capped; then V5-validate before ANY merge
        //    read (T-07-02-02). Every failure mode skips THIS device with a
        //    warning and never aborts the pull.
        let rel = join_remote(root, &["state", &format!("{peer_id}.json")])
            .map_err(|_| SyncError::Permission)?;
        let body = match get_body_capped(client, &rel, MAX_STATE_BODY_BYTES).await {
            Ok(body) => body,
            Err(GetBodyError::TooLarge) => {
                report
                    .warnings
                    .push(format!("设备 {peer_id} 的状态文件过大，已跳过"));
                continue;
            }
            Err(GetBodyError::Transport) => {
                report
                    .warnings
                    .push(format!("设备 {peer_id} 的状态文件读取失败，已跳过"));
                continue;
            }
        };
        let file: DeviceStateFile = match serde_json::from_slice(&body) {
            Ok(file) => file,
            Err(_) => {
                report
                    .warnings
                    .push(format!("设备 {peer_id} 的状态文件格式无法解析，已跳过"));
                continue;
            }
        };
        if file.validate().is_err() {
            report
                .warnings
                .push(format!("设备 {} 的状态文件校验失败，已跳过", file.device_name));
            continue;
        }
        if file.device_id != *peer_id {
            report
                .warnings
                .push(format!("设备 {peer_id} 的状态文件与文件名不符，已跳过"));
            continue;
        }

        // 5) Fold ONE remote device at a time (single-entry remotes slices, so
        //    every displaced local row is attributable to exactly this device
        //    for the undo payload). hash_algo is read per-record inside the
        //    merge — annotation sha256 never compares against work blake3.
        let device_name = file.device_name.clone();
        let remotes_progress = [(peer_id.clone(), file.progress.clone())];
        let (merged_progress, displaced) =
            merge_progress_map(&local_progress, &remotes_progress, &own_id);
        let remotes_annotations = [(peer_id.clone(), file.annotations.clone())];
        let merged_annotations = merge_annotation_map(
            &local_annotations,
            &remotes_annotations,
            &own_id,
            &mut || uuid::Uuid::new_v4().to_string(),
        );
        let remotes_library = [(peer_id.clone(), file.library.clone())];
        let merged_library = merge_library_map(&local_library, &remotes_library, &own_id);

        // 6) Write the union back in ONE transaction. NOTHING below writes
        //    `change_log` — merged-in remote rows are not local ops (ledger
        //    hygiene, the anti-pattern ban at the top of this file). Order is
        //    LIBRARY → ANNOTATIONS → PROGRESS: locator/annotation rows carry
        //    REFERENCES work(work_id), and the plugin pool enforces foreign
        //    keys — remote-only works must exist (placeholders) before their
        //    progress/annotation rows land.
        let mut tx = pool.begin().await.map_err(|_| SyncError::Internal)?;

        for (work_id, rec) in &merged_library {
            let before = local_library.get(work_id);
            if before == Some(rec) {
                continue;
            }
            match before {
                // Remote-only work: derive the placeholder card (D-99). A
                // remote-only TOMBSTONE is a no-op — nothing local to tombstone.
                None => {
                    if rec.deleted == 0 {
                        let file_sync_enabled = rec
                            .file_sync
                            .as_ref()
                            .is_some_and(|fs| fs.enabled);
                        let written = sqlx::query(
                            "INSERT OR IGNORE INTO work (work_id, content_hash, format, created_at) \
                             VALUES ($1, $2, $3, $4)",
                        )
                        .bind(work_id)
                        .bind(&rec.content_hash)
                        .bind(&rec.format)
                        .bind(now_ms())
                        .execute(&mut *tx)
                        .await;
                        if written.is_err() {
                            report.warnings.push(format!(
                                "设备 {device_name} 的一条书目无法写入，已跳过"
                            ));
                            continue;
                        }
                        let item_id = uuid::Uuid::new_v4().to_string();
                        // The file is not local yet, and `source_id` is NOT NULL
                        // — the 'sync-remote' sentinel marks placeholder cards
                        // the import pipeline has not ingested (D-99).
                        let written = sqlx::query(
                            "INSERT OR IGNORE INTO library_item (item_id, work_id, source_id, \
                             title, author, cover_file, imported_at, last_opened_at, \
                             last_read_at, deleted, file_sync_enabled) \
                             VALUES ($1, $2, 'sync-remote', $3, $4, NULL, $5, NULL, NULL, 0, $6)",
                        )
                        .bind(&item_id)
                        .bind(work_id)
                        .bind(&rec.title)
                        .bind(&rec.author)
                        .bind(rec.imported_at)
                        .bind(i64::from(file_sync_enabled))
                        .execute(&mut *tx)
                        .await;
                        match written {
                            Ok(_) => report.merged_library += 1,
                            Err(_) => {
                                report.warnings.push(format!(
                                    "设备 {device_name} 的一条书目无法写入，已跳过"
                                ));
                                continue;
                            }
                        }
                    }
                }
                // Both-present: apply the merge winner for `deleted` and
                // `file_sync_enabled` ONLY — local title/author/cover and the
                // V4 columns the merge never sees are preserved untouched
                // (D-100 single truth). Remote book files are NEVER deleted.
                Some(_) => {
                    let written = sqlx::query(
                        "UPDATE library_item SET deleted = $1, file_sync_enabled = $2 \
                         WHERE work_id = $3",
                    )
                    .bind(rec.deleted)
                    .bind(
                        rec.file_sync
                            .as_ref()
                            .map(|fs| i64::from(fs.enabled))
                            .unwrap_or(0),
                    )
                    .bind(work_id)
                    .execute(&mut *tx)
                    .await;
                    match written {
                        Ok(_) => report.merged_library += 1,
                        Err(_) => {
                            report.warnings.push(format!(
                                "设备 {device_name} 的一条书目无法更新，已跳过"
                            ));
                            continue;
                        }
                    }
                }
            }
            // DISCOVERY row (contract with 07-03): a merged rec whose file_sync
            // is enabled AND carries remote metadata lands a download-discovery
            // row, so `sync_download_book` locates the remote file with no
            // extra network round-trip. On conflict only the file metadata
            // advances — NEVER transfer_uuid/chunks_done of an in-flight
            // download (file-plane bookkeeping, not a ledger op).
            if let Some(fs) = &rec.file_sync {
                if fs.enabled && fs.remote_path.is_some() {
                    let now = now_ms();
                    let written = sqlx::query(
                        "INSERT INTO sync_file_state (work_id, direction, transfer_uuid, \
                         chunks_done, size, hash, remote_path, started_at, updated_at) \
                         VALUES ($1, 'download', NULL, '[]', $2, $3, $4, $5, $5) \
                         ON CONFLICT(work_id) DO UPDATE SET size = excluded.size, \
                         hash = excluded.hash, remote_path = excluded.remote_path, \
                         updated_at = excluded.updated_at",
                    )
                    .bind(work_id)
                    .bind(fs.size)
                    .bind(&fs.hash)
                    .bind(&fs.remote_path)
                    .bind(now)
                    .execute(&mut *tx)
                    .await;
                    if written.is_err() {
                        report
                            .warnings
                            .push(format!("设备 {device_name} 的文件同步信息无法记录，已跳过"));
                    }
                }
            }
        }

        for (annotation_id, rec) in &merged_annotations {
            if local_annotations.get(annotation_id) == Some(rec) {
                continue;
            }
            // Union keep: live rows, tombstone remove-wins rows, and 冲突副本
            // conflict copies (fresh ids minted by the merge driver above) all
            // land through this one upsert.
            let written = sqlx::query(
                "INSERT INTO annotation (annotation_id, work_id, type, cfi, color, text_pre, \
                 text_exact, text_post, progress_fraction, note, created_at, updated_at, \
                 revision, content_hash, deleted) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) \
                 ON CONFLICT(annotation_id) DO UPDATE SET work_id = excluded.work_id, \
                 type = excluded.type, cfi = excluded.cfi, color = excluded.color, \
                 text_pre = excluded.text_pre, text_exact = excluded.text_exact, \
                 text_post = excluded.text_post, progress_fraction = excluded.progress_fraction, \
                 note = excluded.note, created_at = excluded.created_at, \
                 updated_at = excluded.updated_at, revision = excluded.revision, \
                 content_hash = excluded.content_hash, deleted = excluded.deleted",
            )
            .bind(annotation_id)
            .bind(&rec.work_id)
            .bind(&rec.annotation_type)
            .bind(&rec.cfi)
            .bind(&rec.color)
            .bind(&rec.text_pre)
            .bind(&rec.text_exact)
            .bind(&rec.text_post)
            .bind(rec.progress_fraction)
            .bind(&rec.note)
            .bind(rec.created_at)
            .bind(rec.updated_at)
            .bind(rec.revision)
            .bind(&rec.content_hash)
            .bind(rec.deleted)
            .execute(&mut *tx)
            .await;
            match written {
                Ok(_) => report.merged_annotations += 1,
                Err(_) => {
                    report
                        .warnings
                        .push(format!("设备 {device_name} 的一条批注无法写入（书目缺失），已跳过"));
                }
            }
        }

        for (work_id, rec) in &merged_progress {
            if local_progress.get(work_id) == Some(rec) {
                continue;
            }
            let written = sqlx::query(
                "INSERT INTO locator (work_id, cfi, progress_fraction, text_pre, text_exact, \
                 text_post, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7) \
                 ON CONFLICT(work_id) DO UPDATE SET cfi = excluded.cfi, \
                 progress_fraction = excluded.progress_fraction, text_pre = excluded.text_pre, \
                 text_exact = excluded.text_exact, text_post = excluded.text_post, \
                 updated_at = excluded.updated_at",
            )
            .bind(work_id)
            .bind(&rec.cfi)
            .bind(rec.progress_fraction)
            .bind(&rec.text_pre)
            .bind(&rec.text_exact)
            .bind(&rec.text_post)
            .bind(rec.updated_at)
            .execute(&mut *tx)
            .await;
            match written {
                Ok(_) => report.merged_progress += 1,
                Err(_) => {
                    report
                        .warnings
                        .push(format!("设备 {device_name} 的一条进度无法写入（书目缺失），已跳过"));
                }
            }
        }

        if let Err(_) = tx.commit().await {
            report
                .warnings
                .push(format!("设备 {device_name} 的合并写入失败，本次未应用"));
            continue;
        }

        // 7) The merge is durable — NOW stash displaced local rows (D-92),
        //    before anything else can overwrite them. Only ORIGINAL local rows
        //    are stashed, once per work: a row merged in from an earlier peer
        //    and displaced again is remote-origin, never undoable.
        for (work_id, old_row) in displaced {
            if !stashed_works.contains(&work_id)
                && initial_progress.get(&work_id) == Some(&old_row)
            {
                stashed_works.insert(work_id.clone());
                let winner_fraction = merged_progress
                    .get(&work_id)
                    .and_then(|rec| rec.progress_fraction);
                pending_stashes.push(JumpStash {
                    work_id: work_id.clone(),
                    from_row: old_row,
                    to_fraction: winner_fraction,
                    from_device_name: device_name.clone(),
                    stashed_at: now_ms(),
                });
            }
        }

        local_progress = merged_progress;
        local_annotations = merged_annotations;
        local_library = merged_library;

        // 8) Cache this peer's ETag ONLY after its merge succeeded.
        let peer_row_id = format!("peer:{peer_id}");
        sqlx::query(
            "INSERT INTO sync_state (id, remote_etag) VALUES ($1, $2) \
             ON CONFLICT(id) DO UPDATE SET remote_etag = excluded.remote_etag",
        )
        .bind(&peer_row_id)
        .bind(etag.as_deref())
        .execute(pool)
        .await
        .map_err(|_| SyncError::Internal)?;

        report.pulled_devices += 1;
    }

    // 9) Commit the session undo stashes (read-not-consumed by sync_book_opened;
    //    consumed only by sync_revert_jump or dropped at 合书).
    {
        let mut guard = undo.lock().await;
        for stash in pending_stashes {
            if scope_work.is_none_or(|w| w == stash.work_id) {
                report.jumps.push(stash.clone());
            }
            guard.insert(stash.work_id.clone(), stash);
        }
    }

    // 10) Devices-registry upkeep (best-effort).
    let _ = upsert_device_record(client, cfg, pool).await;

    Ok(report)
}
