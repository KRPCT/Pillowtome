//! Pending-upload pump integration (07-04, orchestrator-directed wiring):
//! `sync_set_file_sync` flips only the flag — the pump in
//! `sync::commands::pump_pending_uploads` is what actually pushes the bytes.
//! Off-device: the shared stateful DAV fake (`tests/common/mod.rs`),
//! in-memory SQLite SCHEMA_V1..V8, temp-dir fixtures.
//!
//! Covered: the scan's filters (enabled + no completed upload row; the
//! `sync-remote` placeholder sentinel, tombstones, and completed rows
//! excluded; an interrupted scratch row INCLUDED for resume), a successful
//! pump (bytes land at the D-105 named path + completed metadata row), a
//! per-book failure that is recorded yet never aborts the pump, and the
//! `[hash8]` collision retry.

mod common;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use pillowtome_core::sync::remote::book_remote_path;
use pillowtome_lib::sync::commands::{
    pending_uploads, pump_pending_uploads, PendingUpload,
};
use pillowtome_lib::sync::fileplane::{FilePlaneCtx, FileProgress};
use sqlx::SqlitePool;
use wiremock::MockServer;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// A `FilePlaneCtx` pointed at the wiremock server, remote root `pillowtome/`.
fn ctx_for(server: &MockServer) -> FilePlaneCtx {
    let dav = common::dav_client(server);
    FilePlaneCtx {
        agent: dav.agent.clone(),
        server_dav_root: dav.host.clone(),
        username: "user".to_string(),
        remote_root: "pillowtome/".to_string(),
        dav,
    }
}

/// Unique temp dir per test.
fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("pillowtome-pu-{tag}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

/// Deterministic payload written into `dir`; returns its path.
fn write_fixture(dir: &Path, name: &str, size: usize) -> PathBuf {
    let bytes: Vec<u8> = (0..size).map(|i| (i % 251) as u8).collect();
    let path = dir.join(name);
    std::fs::write(&path, &bytes).expect("write fixture");
    path
}

/// Vec-backed progress sink recorder (fileplane's in-process contract).
#[derive(Clone, Default)]
struct Recorder {
    calls: Arc<Mutex<Vec<FileProgress>>>,
}

impl Recorder {
    fn sink(&self) -> impl Fn(FileProgress) + Send + Sync {
        let calls = self.calls.clone();
        move |p| calls.lock().unwrap().push(p)
    }
}

/// Seed a work + library_item with explicit source_id / flags.
async fn seed_book(
    pool: &SqlitePool,
    work_id: &str,
    title: &str,
    source_id: &str,
    deleted: i64,
    file_sync_enabled: i64,
) {
    common::seed_work(pool, work_id, &format!("blake3-{work_id}"), "epub").await;
    sqlx::query(
        "INSERT INTO library_item (item_id, work_id, source_id, title, author, cover_file, \
         imported_at, last_opened_at, last_read_at, deleted, file_sync_enabled) \
         VALUES ($1, $2, $3, $4, '作者', NULL, 1000, NULL, NULL, $5, $6)",
    )
    .bind(format!("item-{work_id}"))
    .bind(work_id)
    .bind(source_id)
    .bind(title)
    .bind(deleted)
    .bind(file_sync_enabled)
    .execute(pool)
    .await
    .expect("seed library_item");
}

/// Seed a completed upload metadata row (what `upload_book` leaves on success).
async fn seed_completed_upload_row(pool: &SqlitePool, work_id: &str, remote_path: &str) {
    sqlx::query(
        "INSERT INTO sync_file_state (work_id, direction, transfer_uuid, chunks_done, \
         size, hash, remote_path, started_at, updated_at) \
         VALUES ($1, 'upload', NULL, '[]', 123, $1, $2, 1000, 1000)",
    )
    .bind(work_id)
    .bind(remote_path)
    .execute(pool)
    .await
    .expect("seed completed upload row");
}

/// Seed an interrupted-upload scratch row (resume candidate).
async fn seed_scratch_upload_row(pool: &SqlitePool, work_id: &str) {
    sqlx::query(
        "INSERT INTO sync_file_state (work_id, direction, transfer_uuid, chunks_done, \
         size, hash, remote_path, started_at, updated_at) \
         VALUES ($1, 'upload', 'uuid-1', '[1]', 123, $1, NULL, 1000, 1000)",
    )
    .bind(work_id)
    .execute(pool)
    .await
    .expect("seed scratch upload row");
}

async fn completed_upload_remote_path(pool: &SqlitePool, work_id: &str) -> Option<String> {
    sqlx::query_scalar(
        "SELECT remote_path FROM sync_file_state \
         WHERE work_id = $1 AND direction = 'upload' AND remote_path IS NOT NULL",
    )
    .bind(work_id)
    .fetch_optional(pool)
    .await
    .expect("read upload row")
}

fn resolver(
    map: HashMap<String, PathBuf>,
) -> impl Fn(&PendingUpload) -> Option<PathBuf> + Send + Sync {
    move |book| map.get(&book.source_id).cloned()
}

// ---------------------------------------------------------------------------
// 1) Scan filters: exactly the enabled, local, not-yet-uploaded books.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn sync_pending_upload_scan_filters_candidates() {
    let pool = common::fresh_pool().await;
    // Pending: enabled, local, no upload row at all.
    seed_book(&pool, "work-pending", "待传书", "local-a", 0, 1).await;
    // Skipped: flag off.
    seed_book(&pool, "work-off", "未开书", "local-b", 0, 0).await;
    // Skipped: tombstoned even though enabled.
    seed_book(&pool, "work-deleted", "已删书", "local-c", 1, 1).await;
    // Skipped: placeholder card (file lives on a peer).
    seed_book(&pool, "work-remote", "云端书", "sync-remote", 0, 1).await;
    // Skipped: already has a completed upload row.
    seed_book(&pool, "work-done", "已传书", "local-d", 0, 1).await;
    seed_completed_upload_row(&pool, "work-done", "pillowtome/books/x.epub").await;
    // Included: an interrupted upload (scratch row, remote_path NULL) resumes.
    seed_book(&pool, "work-resume", "断点书", "local-e", 0, 1).await;
    seed_scratch_upload_row(&pool, "work-resume").await;

    let found = pending_uploads(&pool).await.expect("scan runs");
    let ids: Vec<&str> = found.iter().map(|b| b.work_id.as_str()).collect();
    assert_eq!(
        ids,
        vec!["work-pending", "work-resume"],
        "only enabled + local + not-yet-completed books (deterministic work_id order)"
    );
    let pending = &found[0];
    assert_eq!(pending.title, "待传书");
    assert_eq!(pending.author.as_deref(), Some("作者"));
    assert_eq!(pending.source_id, "local-a");
    assert_eq!(pending.format, "epub");
}

// ---------------------------------------------------------------------------
// 2) Pump: the enabled book uploads (bytes + completed row); the
//    already-uploaded book is never touched.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn sync_pending_upload_pumps_and_skips_completed() {
    let (server, fake) = common::start_dav().await;
    let ctx = ctx_for(&server);
    let pool = common::fresh_pool().await;
    let dir = temp_dir("pump");

    seed_book(&pool, "work-up", "新书", "src-up", 0, 1).await;
    seed_book(&pool, "work-skip", "旧书", "src-skip", 0, 1).await;
    let skip_path = book_remote_path("pillowtome/", "作者", "旧书", "epub", "work-skip", false)
        .expect("remote path");
    seed_completed_upload_row(&pool, "work-skip", &skip_path).await;

    let fixture = write_fixture(&dir, "new.epub", 2048);
    let map = HashMap::from([
        ("src-up".to_string(), fixture.clone()),
        ("src-skip".to_string(), write_fixture(&dir, "old.epub", 2048)),
    ]);
    let recorder = Recorder::default();

    let (uploaded, first_error) =
        pump_pending_uploads(&ctx, &pool, &recorder.sink(), "pillowtome/", &resolver(map))
            .await
            .expect("pump runs");

    assert_eq!(uploaded, 1, "only the pending book uploads");
    assert_eq!(first_error, None);

    // Bytes landed at the D-105 named path, and the completed metadata row
    // the 07-02 state builder reads is present.
    let up_path = book_remote_path("pillowtome/", "作者", "新书", "epub", "work-up", false)
        .expect("remote path");
    assert_eq!(
        fake.body(&format!("/{up_path}")).map(|b| b.len()),
        Some(2048),
        "uploaded bytes at {up_path}"
    );
    assert_eq!(
        completed_upload_remote_path(&pool, "work-up").await.as_deref(),
        Some(up_path.as_str())
    );

    // The completed book never hit the wire as an upload PUT destination.
    let journal = fake.state.lock().unwrap().journal.clone();
    let puts: Vec<_> = journal.iter().filter(|e| e.method == "PUT").collect();
    assert_eq!(puts.len(), 1, "exactly one upload PUT");
    assert!(puts[0].path.ends_with(&up_path));
}

// ---------------------------------------------------------------------------
// 3) A per-book failure is recorded (classified copy) and the remaining
//    books still upload.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn sync_pending_upload_failure_recorded_and_others_continue() {
    let (server, fake) = common::start_dav().await;
    let ctx = ctx_for(&server);
    let pool = common::fresh_pool().await;
    let dir = temp_dir("fail");

    // work-aaa sorts first → its Io failure is the recorded first error.
    seed_book(&pool, "work-aaa", "坏书", "src-bad", 0, 1).await;
    seed_book(&pool, "work-bbb", "好书", "src-good", 0, 1).await;

    let good = write_fixture(&dir, "good.epub", 1024);
    let map = HashMap::from([
        ("src-bad".to_string(), dir.join("missing.epub")), // Io on metadata
        ("src-good".to_string(), good.clone()),
    ]);
    let recorder = Recorder::default();

    let (uploaded, first_error) =
        pump_pending_uploads(&ctx, &pool, &recorder.sink(), "pillowtome/", &resolver(map))
            .await
            .expect("pump runs");

    assert_eq!(uploaded, 1, "the healthy book still uploads");
    assert_eq!(
        first_error,
        Some("无法读取或写入本地文件"),
        "the first failure's classified copy is recorded for last_error"
    );
    let good_path = book_remote_path("pillowtome/", "作者", "好书", "epub", "work-bbb", false)
        .expect("remote path");
    assert!(fake.body(&format!("/{good_path}")).is_some());
    assert_eq!(
        completed_upload_remote_path(&pool, "work-bbb").await.as_deref(),
        Some(good_path.as_str())
    );
    assert_eq!(completed_upload_remote_path(&pool, "work-aaa").await, None);
}

// ---------------------------------------------------------------------------
// 4) Same-name different-bytes destination → RemoteConflict → retry once with
//    the `[hash8]` collision suffix (never a silent overwrite).
// ---------------------------------------------------------------------------
#[tokio::test]
async fn sync_pending_upload_collision_retries_with_hash8() {
    let (server, fake) = common::start_dav().await;
    let ctx = ctx_for(&server);
    let pool = common::fresh_pool().await;
    let dir = temp_dir("collision");

    seed_book(&pool, "work-coll", "同名书", "src-coll", 0, 1).await;
    let plain = book_remote_path("pillowtome/", "作者", "同名书", "epub", "work-coll", false)
        .expect("plain path");
    let hashed = book_remote_path("pillowtome/", "作者", "同名书", "epub", "work-coll", true)
        .expect("hash8 path");
    assert_ne!(plain, hashed);
    // A different book already occupies the plain name (different size ⇒ the
    // pre-flight PROPFIND dedup sees same name / different bytes).
    fake.seed_file(&format!("/{plain}"), vec![0u8; 9999]);

    let fixture = write_fixture(&dir, "coll.epub", 2048);
    let map = HashMap::from([("src-coll".to_string(), fixture)]);
    let recorder = Recorder::default();

    let (uploaded, first_error) =
        pump_pending_uploads(&ctx, &pool, &recorder.sink(), "pillowtome/", &resolver(map))
            .await
            .expect("pump runs");

    assert_eq!(uploaded, 1);
    assert_eq!(first_error, None);
    // The plain name kept its original bytes; the book landed under [hash8].
    assert_eq!(
        fake.body(&format!("/{plain}")).map(|b| b.len()),
        Some(9999),
        "the foreign file is never overwritten"
    );
    assert_eq!(
        fake.body(&format!("/{hashed}")).map(|b| b.len()),
        Some(2048)
    );
    assert_eq!(
        completed_upload_remote_path(&pool, "work-coll").await.as_deref(),
        Some(hashed.as_str())
    );
}
