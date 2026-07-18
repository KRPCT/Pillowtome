//! Dual-device end-to-end reconcile tests (07-02 Task 5): two in-memory
//! SQLite devices (`sqlite::memory:` pools A and B) sync through one stateful
//! wiremock WebDAV fake — union/no-loss (SYNC-02/03/05), tombstone
//! anti-resurrection, clock-skew determinism, catalog union with
//! download-discovery rows, and the D-92 jump → stash → revert round trip.
//! All off-device, all in-memory.

mod common;

use common::*;
use pillowtome_core::sync::model::DeviceStateFile;
use pillowtome_lib::sync::commands::revert_jump_with_pool;
use pillowtome_lib::sync::reconcile::{
    new_undo_map, pull_state_files, reconcile_push, UndoMap,
};
use sqlx::SqlitePool;

/// One simulated device: its own database, its own undo map, one shared server.
struct Device {
    pool: SqlitePool,
    undo: UndoMap,
    device_id: String,
}

impl Device {
    async fn new(device_id: &str) -> Self {
        let pool = fresh_pool().await;
        seed_device(&pool, device_id).await;
        Self {
            pool,
            undo: new_undo_map(),
            device_id: device_id.to_string(),
        }
    }

    async fn push(&self, server: &wiremock::MockServer) {
        let cfg = config_row(server, &self.device_id);
        let client = dav_client(server);
        reconcile_push(&self.pool, &client, &cfg, &self.undo)
            .await
            .expect("push succeeds");
    }

    async fn pull(
        &self,
        server: &wiremock::MockServer,
        scope_work: Option<&str>,
    ) -> pillowtome_lib::sync::reconcile::PullReport {
        let cfg = config_row(server, &self.device_id);
        let client = dav_client(server);
        pull_state_files(&self.pool, &client, &cfg, &self.undo, scope_work)
            .await
            .expect("pull succeeds")
    }
}

fn own_state(fake: &FakeDav, device_id: &str) -> DeviceStateFile {
    let body = fake
        .body(&format!("/pillowtome/state/{device_id}.json"))
        .expect("own state file published");
    serde_json::from_slice(&body).expect("valid state JSON")
}

async fn locator_fraction(pool: &SqlitePool, work_id: &str) -> Option<f64> {
    sqlx::query_scalar("SELECT progress_fraction FROM locator WHERE work_id = $1")
        .bind(work_id)
        .fetch_optional(pool)
        .await
        .expect("locator query")
        .flatten()
}

/// Scenario 1 — union, nothing lost (SYNC-02/03/05).
#[tokio::test]
async fn sync_e2e_union_nothing_lost() {
    let (server, _fake) = start_dav().await;
    let a = Device::new("device-a").await;
    let b = Device::new("device-b").await;

    // A: 2 annotations + locator 0.42 + 2 library books.
    seed_library_book(&a.pool, "w1", "书名一", 0, 0, 1111).await;
    seed_library_book(&a.pool, "w2", "书名二", 0, 0, 2222).await;
    seed_annotation(&a.pool, "a1", "w1", "句子一", 1, 0, 1000).await;
    seed_annotation(&a.pool, "a2", "w1", "句子二", 1, 0, 1000).await;
    seed_locator(&a.pool, "w1", "epubcfi(/6/4[a])", 0.42, 1000).await;
    // B: a pre-existing annotation on its own work (union must keep it).
    seed_library_book(&b.pool, "w3", "乙的书", 0, 0, 3333).await;
    seed_annotation(&b.pool, "b1", "w3", "乙的句子", 1, 0, 1000).await;
    let b_ledger_before = change_log_count(&b.pool).await;

    a.push(&server).await;
    let report = b.pull(&server, None).await;
    assert!(report.pulled_devices >= 1);

    // Both annotations verbatim, the locator, both books as placeholders.
    let texts: Vec<String> = sqlx::query_scalar(
        "SELECT text_exact FROM annotation WHERE annotation_id IN ('a1', 'a2') ORDER BY annotation_id",
    )
    .fetch_all(&b.pool)
    .await
    .unwrap();
    assert_eq!(texts, vec!["句子一".to_string(), "句子二".to_string()]);
    assert_eq!(locator_fraction(&b.pool, "w1").await, Some(0.42));
    for work in ["w1", "w2"] {
        let source_id: String =
            sqlx::query_scalar("SELECT source_id FROM library_item WHERE work_id = $1")
                .bind(work)
                .fetch_one(&b.pool)
                .await
                .unwrap();
        assert_eq!(source_id, "sync-remote");
    }
    // Union: B's own annotation and book are still there.
    assert!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM annotation WHERE annotation_id = 'b1'")
            .fetch_one(&b.pool)
            .await
            .unwrap()
            == 1
    );
    assert!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM library_item WHERE work_id = 'w3'")
            .fetch_one(&b.pool)
            .await
            .unwrap()
            == 1
    );
    // The pull wrote ZERO change_log rows on B.
    assert_eq!(change_log_count(&b.pool).await, b_ledger_before);
}

/// Scenario 2 — tombstone anti-resurrection, exercised in BOTH merge orders.
#[tokio::test]
async fn sync_e2e_tombstone_anti_resurrection_both_orders() {
    let (server, fake) = start_dav().await;
    let a = Device::new("device-a").await;
    let b = Device::new("device-b").await;
    for dev in [&a, &b] {
        seed_library_book(&dev.pool, "w1", "同一本书", 0, 0, 1111).await;
        seed_annotation(&dev.pool, "a1", "w1", "句子", 2, 0, 1000).await;
    }

    // Order 1: B tombstones (revision bump), pushes; A pulls → tombstone lands.
    sqlx::query("UPDATE annotation SET deleted = 1, revision = 3, content_hash = 'hash-del-r3' \
                 WHERE annotation_id = 'a1'")
        .execute(&b.pool)
        .await
        .unwrap();
    b.push(&server).await;
    a.pull(&server, None).await;
    let (deleted, revision): (i64, i64) =
        sqlx::query_as("SELECT deleted, revision FROM annotation WHERE annotation_id = 'a1'")
            .fetch_one(&a.pool)
            .await
            .unwrap();
    assert_eq!((deleted, revision), (1, 3), "remote tombstone wins (order 1)");

    // A stale version of B's state (a1 still live, older revision) must NOT
    // resurrect the row on A.
    let mut stale = own_state(&fake, "device-b");
    let live = stale.annotations.get_mut("a1").expect("a1 in state file");
    live.deleted = 0;
    live.revision = 2;
    live.content_hash = Some("hash-live-r2".to_string());
    fake.seed_file(
        "/pillowtome/state/device-b.json",
        serde_json::to_vec(&stale).unwrap(),
    );
    a.pull(&server, None).await;
    let (deleted, revision): (i64, i64) =
        sqlx::query_as("SELECT deleted, revision FROM annotation WHERE annotation_id = 'a1'")
            .fetch_one(&a.pool)
            .await
            .unwrap();
    assert_eq!((deleted, revision), (1, 3), "stale live copy never resurrects");

    // Order 2 (reverse direction): A's tombstone now flows to a B whose local
    // row was rolled back to a stale live copy.
    sqlx::query("UPDATE annotation SET deleted = 0, revision = 2, content_hash = 'hash-live-r2' \
                 WHERE annotation_id = 'a1'")
        .execute(&b.pool)
        .await
        .unwrap();
    a.push(&server).await;
    b.pull(&server, None).await;
    let (deleted, revision): (i64, i64) =
        sqlx::query_as("SELECT deleted, revision FROM annotation WHERE annotation_id = 'a1'")
            .fetch_one(&b.pool)
            .await
            .unwrap();
    assert_eq!((deleted, revision), (1, 3), "tombstone also wins in reverse (order 2)");
}

/// Scenario 3 — skewed clocks, deterministic winner in BOTH merge orders.
#[tokio::test]
async fn sync_e2e_clock_skew_determinism() {
    let (server, _fake) = start_dav().await;
    let a = Device::new("device-a").await;
    let b = Device::new("device-b").await;
    for dev in [&a, &b] {
        seed_library_book(&dev.pool, "w1", "同一本书", 0, 0, 1111).await;
        seed_library_book(&dev.pool, "w2", "另一本书", 0, 0, 1111).await;
    }
    const HOUR: i64 = 3_600_000;
    let t0: i64 = 1_760_000_000_000;

    // Case 1: equal fraction, skewed updated_at (A +3h, B -3h) → A's row wins
    // on BOTH devices regardless of who pulls whom.
    seed_locator(&a.pool, "w1", "epubcfi(/6/4[a])", 0.50, t0 + 3 * HOUR).await;
    seed_locator(&b.pool, "w1", "epubcfi(/6/4[b])", 0.50, t0 - 3 * HOUR).await;
    a.push(&server).await;
    b.push(&server).await;
    a.pull(&server, None).await;
    b.pull(&server, None).await;
    for (dev, name) in [(&a, "A"), (&b, "B")] {
        let cfi: Option<String> =
            sqlx::query_scalar("SELECT cfi FROM locator WHERE work_id = 'w1'")
                .fetch_one(&dev.pool)
                .await
                .unwrap();
        assert_eq!(
            cfi.as_deref(),
            Some("epubcfi(/6/4[a])"),
            "device {name} converged to A's later-updated row"
        );
    }

    // Case 2: full tie on fraction AND updated_at → the documented total order
    // falls to device_id lexicographic (device-b > device-a) — SAME winner on
    // both devices, both pull orders.
    seed_locator(&a.pool, "w2", "epubcfi(/6/4[a2])", 0.50, t0).await;
    seed_locator(&b.pool, "w2", "epubcfi(/6/4[b2])", 0.50, t0).await;
    a.push(&server).await;
    b.push(&server).await;
    a.pull(&server, None).await;
    b.pull(&server, None).await;
    for (dev, name) in [(&a, "A"), (&b, "B")] {
        let cfi: Option<String> =
            sqlx::query_scalar("SELECT cfi FROM locator WHERE work_id = 'w2'")
                .fetch_one(&dev.pool)
                .await
                .unwrap();
        assert_eq!(
            cfi.as_deref(),
            Some("epubcfi(/6/4[b2])"),
            "device {name}: device_id lexicographic tie-break is deterministic"
        );
    }
}

/// Scenario 4 — jump + undo + revert (D-92).
#[tokio::test]
async fn sync_e2e_jump_undo_revert() {
    let (server, _fake) = start_dav().await;
    let a = Device::new("device-a").await;
    let b = Device::new("device-b").await;
    for dev in [&a, &b] {
        seed_library_book(&dev.pool, "w1", "同一本书", 0, 0, 1111).await;
    }
    seed_locator(&a.pool, "w1", "epubcfi(/6/4[a04])", 0.40, 1000).await;
    seed_locator(&b.pool, "w1", "epubcfi(/6/4[b09])", 0.90, 2000).await;
    let a_ledger_before = change_log_count(&a.pool).await;

    b.push(&server).await;
    // A opens the book → scoped pull → jump to the furthest position.
    let report = a.pull(&server, Some("w1")).await;
    assert_eq!(locator_fraction(&a.pool, "w1").await, Some(0.90));
    assert_eq!(report.jumps.len(), 1);
    assert_eq!(report.jumps[0].from_device_name, "device-b");
    assert_eq!(report.jumps[0].to_fraction, Some(0.90));

    // The stash holds the EXACT pre-jump 0.40 composite.
    {
        let guard = a.undo.lock().await;
        let stash = guard.get("w1").expect("undo stash");
        assert_eq!(stash.from_row.cfi.as_deref(), Some("epubcfi(/6/4[a04])"));
        assert_eq!(stash.from_row.progress_fraction, Some(0.40));
    }

    // Revert → exact position restored, ONE local ledger row, stash consumed.
    let restored = revert_jump_with_pool(&a.pool, &a.undo, "w1")
        .await
        .expect("revert")
        .expect("stash present");
    assert_eq!(restored.cfi, "epubcfi(/6/4[a04])");
    assert_eq!(restored.progress_fraction, 0.40);
    assert_eq!(locator_fraction(&a.pool, "w1").await, Some(0.40));
    assert_eq!(
        change_log_count(&a.pool).await,
        a_ledger_before + 1,
        "exactly one LOCAL change_log row for the revert"
    );
    let entity: String = sqlx::query_scalar(
        "SELECT entity FROM change_log ORDER BY logical_clock DESC LIMIT 1",
    )
    .fetch_one(&a.pool)
    .await
    .unwrap();
    assert_eq!(entity, "locator");
    assert!(a.undo.lock().await.get("w1").is_none(), "stash consumed");
    assert!(
        revert_jump_with_pool(&a.pool, &a.undo, "w1")
            .await
            .unwrap()
            .is_none(),
        "second revert is a soft no-op"
    );
}

/// Scenario 5 — catalog union incl. tombstone flag + download-discovery row.
#[tokio::test]
async fn sync_e2e_catalog_union_with_discovery_row() {
    let (server, fake) = start_dav().await;
    let a = Device::new("device-a").await;
    let b = Device::new("device-b").await;

    // B-only book with file sync enabled and a COMPLETED upload row.
    seed_library_book(&b.pool, "wb", "乙的书", 0, 1, 2222).await;
    sqlx::query(
        "INSERT INTO sync_file_state (work_id, direction, transfer_uuid, chunks_done, size, hash, \
         remote_path, started_at, updated_at) \
         VALUES ('wb', 'upload', 'tu-b', '[1]', 87654321, 'blake3-wb', \
         'pillowtome/books/作者 - 乙的书.epub', 500, 600)",
    )
    .execute(&b.pool)
    .await
    .unwrap();
    // A-only book (must survive every roundtrip).
    seed_library_book(&a.pool, "wa", "甲的书", 0, 0, 1111).await;

    b.push(&server).await;
    a.pull(&server, None).await;

    // Placeholder card + discovery row, no extra network needed by 07-03.
    let (source_id, flag): (String, i64) = sqlx::query_as(
        "SELECT source_id, file_sync_enabled FROM library_item WHERE work_id = 'wb'",
    )
    .fetch_one(&a.pool)
    .await
    .unwrap();
    assert_eq!(source_id, "sync-remote");
    assert_eq!(flag, 1);
    let row: (String, Option<String>, Option<i64>, Option<String>, Option<String>) =
        sqlx::query_as(
            "SELECT direction, transfer_uuid, size, hash, remote_path FROM sync_file_state \
             WHERE work_id = 'wb'",
        )
        .fetch_one(&a.pool)
        .await
        .expect("discovery row");
    assert_eq!(row.0, "download");
    assert_eq!(row.1, None, "NULL transfer_uuid");
    assert_eq!(row.2, Some(87654321));
    assert_eq!(row.3.as_deref(), Some("blake3-wb"));
    assert_eq!(row.4.as_deref(), Some("pillowtome/books/作者 - 乙的书.epub"));

    // Full roundtrip: A pushes, B pulls — A-only book is never dropped.
    a.push(&server).await;
    b.pull(&server, None).await;
    assert!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM library_item WHERE work_id = 'wa'")
            .fetch_one(&a.pool)
            .await
            .unwrap()
            == 1
    );
    assert!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM library_item WHERE work_id = 'wa'")
            .fetch_one(&b.pool)
            .await
            .unwrap()
            == 1,
        "A-only book unions into B's catalog"
    );

    // B tombstones the book → A's copy tombstones too (row retained, Q2)…
    sqlx::query("UPDATE library_item SET deleted = 1 WHERE work_id = 'wb'")
        .execute(&b.pool)
        .await
        .unwrap();
    b.push(&server).await;
    a.pull(&server, None).await;
    let deleted: i64 = sqlx::query_scalar("SELECT deleted FROM library_item WHERE work_id = 'wb'")
        .fetch_one(&a.pool)
        .await
        .unwrap();
    assert_eq!(deleted, 1, "remote catalog tombstone lands, row retained");
    // …and A's next push CARRIES the tombstone.
    a.push(&server).await;
    let state = own_state(&fake, "device-a");
    assert_eq!(state.library["wb"].deleted, 1);
}
