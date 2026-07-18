//! Off-device state-plane reconcile tests (07-02): push-side state builder,
//! conditional tmp+MOVE push with 412 recovery, pull merge into SQLite
//! (incl. undo stash + discovery rows), and the D-92 revert — all against
//! in-memory SQLite + a stateful wiremock DAV fake (see `tests/common/`).

mod common;

use std::collections::BTreeMap;

use common::*;
use pillowtome_core::sync::model::{
    AnnotationRec, DeviceRecord, DeviceStateFile, FileSyncRec, LibraryRec, ProgressRec,
};
use pillowtome_lib::sync::commands::revert_jump_with_pool;
use pillowtome_lib::sync::reconcile::{
    build_device_record, build_device_state, new_undo_map, pull_state_files, reconcile_push,
    JumpStash,
};
use sqlx::SqlitePool;

fn annotation_rec(
    work_id: &str,
    text: &str,
    revision: i64,
    deleted: i64,
    updated_at: i64,
) -> AnnotationRec {
    AnnotationRec {
        work_id: work_id.to_string(),
        annotation_type: "highlight".to_string(),
        cfi: "epubcfi(/6/4)".to_string(),
        color: Some("cinnabar".to_string()),
        text_pre: Some("pre".to_string()),
        text_exact: Some(text.to_string()),
        text_post: Some("post".to_string()),
        progress_fraction: Some(0.4),
        note: None,
        created_at: 1000,
        updated_at,
        revision,
        content_hash: Some(format!("hash-{text}-r{revision}-d{deleted}")),
        hash_algo: Some("sha256".to_string()),
        deleted,
    }
}

fn progress_rec(cfi: &str, fraction: f64, updated_at: i64) -> ProgressRec {
    ProgressRec {
        cfi: Some(cfi.to_string()),
        progress_fraction: Some(fraction),
        text_pre: Some("rpre".to_string()),
        text_exact: Some("rexact".to_string()),
        text_post: Some("rpost".to_string()),
        updated_at,
    }
}

fn library_rec(title: &str, imported_at: i64, deleted: i64, file_sync: Option<FileSyncRec>) -> LibraryRec {
    LibraryRec {
        title: title.to_string(),
        author: Some("作者".to_string()),
        format: "epub".to_string(),
        content_hash: "blake3-x".to_string(),
        imported_at,
        deleted,
        file_sync,
    }
}

fn peer_state(device_id: &str, device_name: &str) -> DeviceStateFile {
    DeviceStateFile {
        format: 1,
        device_id: device_id.to_string(),
        device_name: device_name.to_string(),
        clock: 7,
        updated_at: 2000,
        progress: BTreeMap::new(),
        annotations: BTreeMap::new(),
        library: BTreeMap::new(),
    }
}

fn state_path(device_id: &str) -> String {
    format!("/pillowtome/state/{device_id}.json")
}

// ---------------------------------------------------------------------------
// Task 1 — push-side builder
// ---------------------------------------------------------------------------

#[tokio::test]
async fn sync_build_device_state_matches_seeded_tables() {
    let pool = fresh_pool().await;
    seed_device(&pool, "device-a").await;

    // w1: locator + live annotation + file-sync-enabled book with a completed
    // upload row (KNOWN remote_path/size/hash triple — value-level asserts).
    seed_library_book(&pool, "w1", "书名一", 0, 1, 1111).await;
    seed_locator(&pool, "w1", "epubcfi(/6/4)", 0.42, 1000).await;
    seed_annotation(&pool, "a1", "w1", "句子一", 1, 0, 1000).await;
    sqlx::query(
        "INSERT INTO sync_file_state (work_id, direction, transfer_uuid, chunks_done, size, hash, \
         remote_path, started_at, updated_at) \
         VALUES ('w1', 'upload', 'tu-1', '[1]', 12345678, 'blake3-w1', \
         'pillowtome/books/作者 - 书名一.epub', 500, 600)",
    )
    .execute(&pool)
    .await
    .expect("seed upload row");
    // w2: file-sync disabled; a2: tombstoned annotation (must still ride the file).
    seed_library_book(&pool, "w2", "书名二", 0, 0, 2222).await;
    seed_annotation(&pool, "a2", "w2", "句子二", 2, 1, 1000).await;
    // w3: catalog tombstone; w4: file-sync enabled, upload PENDING (no row).
    seed_library_book(&pool, "w3", "书名三", 1, 0, 3333).await;
    seed_library_book(&pool, "w4", "书名四", 0, 1, 4444).await;

    let cfg = config_row_named("本机");
    let state = build_device_state(&pool, &cfg, 9999)
        .await
        .expect("build_device_state");

    assert_eq!(state.format, 1);
    assert_eq!(state.device_id, "device-a");
    assert_eq!(state.device_name, "本机");
    assert_eq!(state.clock, 0);
    assert_eq!(state.updated_at, 9999);

    // Progress register: exactly the one latest locator row.
    assert_eq!(state.progress.len(), 1);
    assert_eq!(state.progress["w1"].progress_fraction, Some(0.42));
    assert_eq!(state.progress["w1"].cfi.as_deref(), Some("epubcfi(/6/4)"));

    // Annotations: the tombstone rides along, hash_algo tagged per record.
    assert_eq!(state.annotations.len(), 2);
    assert_eq!(state.annotations["a2"].deleted, 1);
    assert_eq!(state.annotations["a2"].revision, 2);
    assert_eq!(
        state.annotations["a2"].hash_algo.as_deref(),
        Some("sha256")
    );

    // Library: full catalog incl. tombstone; file_sync metadata value-exact.
    assert_eq!(state.library.len(), 4);
    let w1_sync = state.library["w1"].file_sync.as_ref().expect("file_sync block");
    assert!(w1_sync.enabled);
    assert_eq!(
        w1_sync.remote_path.as_deref(),
        Some("pillowtome/books/作者 - 书名一.epub")
    );
    assert_eq!(w1_sync.size, Some(12345678));
    assert_eq!(w1_sync.hash.as_deref(), Some("blake3-w1"));
    let w2_sync = state.library["w2"].file_sync.as_ref().expect("file_sync block");
    assert!(!w2_sync.enabled);
    assert!(w2_sync.remote_path.is_none());
    assert_eq!(state.library["w3"].deleted, 1);
    let w4_sync = state.library["w4"].file_sync.as_ref().expect("file_sync block");
    assert!(w4_sync.enabled);
    assert!(w4_sync.remote_path.is_none(), "upload pending — no metadata yet");

    // The serialized payload carries no credential-shaped fields anywhere.
    let json = serde_json::to_string(&state).expect("serialize");
    assert!(json.contains(r#""format":1"#));
    assert!(json.contains(r#""hash_algo":"sha256""#));
    assert!(!json.contains("password"), "state file must not name passwords");
    assert!(!json.contains("secret"), "state file must not name secrets");
}

#[tokio::test]
async fn sync_build_device_record_preserves_first_seen() {
    let existing = DeviceRecord {
        device_id: "device-a".to_string(),
        device_name: "旧名字".to_string(),
        first_seen: 111,
        last_seen: 222,
    };
    let record = build_device_record(Some(existing), "device-a", "新名字", 999);
    assert_eq!(record.first_seen, 111, "first_seen survives");
    assert_eq!(record.last_seen, 999, "last_seen advances");
    assert_eq!(record.device_name, "新名字");

    let fresh = build_device_record(None, "device-a", "n", 999);
    assert_eq!(fresh.first_seen, 999);
    assert_eq!(fresh.last_seen, 999);
}

// ---------------------------------------------------------------------------
// Task 2 — conditional atomic push
// ---------------------------------------------------------------------------

#[tokio::test]
async fn sync_push_first_write_puts_tmp_then_moves_with_if_none_match() {
    let pool = fresh_pool().await;
    seed_device(&pool, "device-a").await;
    seed_library_book(&pool, "w1", "书名一", 0, 0, 1111).await;
    let (server, fake) = start_dav().await;
    let cfg = config_row(&server, "本机");
    let client = dav_client(&server);
    let undo = new_undo_map();

    reconcile_push(&pool, &client, &cfg, &undo)
        .await
        .expect("first push succeeds");

    let final_path = state_path("device-a");
    let st = fake.state.lock().unwrap();
    let puts = st.journal_entries("PUT");
    // The state file was written to a tmp-<uuid> name, never the final name.
    let state_puts: Vec<_> = puts
        .iter()
        .filter(|e| e.path.starts_with("/pillowtome/state/"))
        .collect();
    assert_eq!(state_puts.len(), 1);
    assert!(
        state_puts[0].path.starts_with("/pillowtome/state/device-a.json.tmp-"),
        "tmp publish name, got {}",
        state_puts[0].path
    );
    // The MOVE carries the full conditional contract.
    let moves = st.journal_entries("MOVE");
    let state_moves: Vec<_> = moves
        .iter()
        .filter(|e| {
            e.destination
                .as_deref()
                .is_some_and(|d| d.ends_with("/pillowtome/state/device-a.json"))
        })
        .collect();
    assert_eq!(state_moves.len(), 1);
    assert_eq!(state_moves[0].if_none_match.as_deref(), Some("*"));
    assert!(state_moves[0].if_match.is_none());
    assert_eq!(state_moves[0].overwrite.as_deref(), Some("T"));
    drop(st);

    // The published body is the rebuilt state file; sync_state persisted the ETag.
    let body = fake.body(&final_path).expect("final state file exists");
    let file: DeviceStateFile = serde_json::from_slice(&body).expect("valid state JSON");
    assert_eq!(file.device_id, "device-a");
    assert_eq!(file.format, 1);
    assert_eq!(file.library.len(), 1);

    let stored_etag: Option<String> =
        sqlx::query_scalar("SELECT remote_etag FROM sync_state WHERE id = 'state'")
            .fetch_one(&pool)
            .await
            .expect("sync_state row");
    assert_eq!(stored_etag, fake.etag(&final_path));
    let (last_sync_at, last_error, syncing): (Option<i64>, Option<String>, i64) = sqlx::query_as(
        "SELECT last_sync_at, last_error, syncing FROM sync_state WHERE id = 'state'",
    )
    .fetch_one(&pool)
    .await
    .expect("sync_state row");
    assert!(last_sync_at.is_some());
    assert!(last_error.is_none());
    assert_eq!(syncing, 0);

    // Devices registry entry published too.
    assert!(fake.body("/pillowtome/devices/device-a.json").is_some());
}

#[tokio::test]
async fn sync_push_second_write_moves_with_if_match_stored_etag() {
    let pool = fresh_pool().await;
    seed_device(&pool, "device-a").await;
    let (server, fake) = start_dav().await;
    let cfg = config_row(&server, "本机");
    let client = dav_client(&server);
    let undo = new_undo_map();

    reconcile_push(&pool, &client, &cfg, &undo).await.expect("push 1");
    let stored: String = sqlx::query_scalar("SELECT remote_etag FROM sync_state WHERE id = 'state'")
        .fetch_one(&pool)
        .await
        .expect("stored etag");
    reconcile_push(&pool, &client, &cfg, &undo).await.expect("push 2");

    let st = fake.state.lock().unwrap();
    let state_moves: Vec<_> = st
        .journal_entries("MOVE")
        .into_iter()
        .filter(|e| e.destination.as_deref().is_some_and(|d| d.contains("/state/")))
        .collect();
    assert_eq!(state_moves.len(), 2);
    assert_eq!(state_moves[0].if_none_match.as_deref(), Some("*"));
    assert_eq!(
        state_moves[1].if_match.as_deref(),
        Some(stored.as_str()),
        "second MOVE carries the stored ETag verbatim (quotes included)"
    );
}

#[tokio::test]
async fn sync_push_412_triggers_single_repull_merge_retry_with_fresh_etag() {
    let pool = fresh_pool().await;
    seed_device(&pool, "device-a").await;
    seed_work(&pool, "w1", "h1", "epub").await;
    seed_locator(&pool, "w1", "epubcfi(/6/4)", 0.42, 1000).await;
    let (server, fake) = start_dav().await;
    let cfg = config_row(&server, "本机");
    let client = dav_client(&server);
    let undo = new_undo_map();

    reconcile_push(&pool, &client, &cfg, &undo).await.expect("push 1");
    let final_path = state_path("device-a");
    let stale_etag = fake.etag(&final_path).expect("etag after push 1");

    // Same-device dual-open: another instance rewrote our own state file.
    let other = peer_state("device-a", "本机（另一实例）");
    let fresh_etag = fake.seed_file(&final_path, serde_json::to_vec(&other).unwrap());
    assert_ne!(stale_etag, fresh_etag);

    reconcile_push(&pool, &client, &cfg, &undo)
        .await
        .expect("412 recovers via re-pull + retry");

    let st = fake.state.lock().unwrap();
    let state_moves: Vec<_> = st
        .journal_entries("MOVE")
        .into_iter()
        .filter(|e| e.destination.as_deref().is_some_and(|d| d.contains("/state/")))
        .collect();
    // push-1 MOVE + the 412'd MOVE + the retried MOVE = 3 state MOVEs total;
    // the last two belong to this push: stale If-Match first, fresh If-Match after.
    let last_two = &state_moves[state_moves.len() - 2..];
    assert_eq!(last_two[0].if_match.as_deref(), Some(stale_etag.as_str()));
    assert_eq!(
        last_two[1].if_match.as_deref(),
        Some(fresh_etag.as_str()),
        "the retried MOVE carries the fresh ETag from the recovery pull"
    );
    // The recovery pull ran between the two MOVEs (depth-1 PROPFIND of state/).
    let find_prop = |after: usize| {
        st.journal
            .iter()
            .enumerate()
            .skip(after)
            .find(|(_, e)| e.method == "PROPFIND" && e.path == "/pillowtome/state/")
            .map(|(i, _)| i)
    };
    let mv1_idx = st
        .journal
        .iter()
        .position(|e| e.method == "MOVE" && e.if_match.as_deref() == Some(stale_etag.as_str()))
        .expect("stale MOVE journaled");
    let pull_idx = find_prop(mv1_idx).expect("recovery pull PROPFIND happened");
    let mv2_idx = st
        .journal
        .iter()
        .position(|e| e.method == "MOVE" && e.if_match.as_deref() == Some(fresh_etag.as_str()))
        .expect("retried MOVE journaled");
    assert!(mv1_idx < pull_idx && pull_idx < mv2_idx, "pull between the MOVEs");
    drop(st);

    // The retried publish landed our rebuilt state.
    let body = fake.body(&final_path).expect("final state file");
    let file: DeviceStateFile = serde_json::from_slice(&body).expect("valid state JSON");
    assert_eq!(file.device_id, "device-a");
    assert_eq!(file.progress["w1"].progress_fraction, Some(0.42));
}

#[tokio::test]
async fn sync_push_never_serves_partial_body_at_the_final_name() {
    let pool = fresh_pool().await;
    seed_device(&pool, "device-a").await;
    let (server, fake) = start_dav().await;
    let cfg = config_row(&server, "本机");
    let client = dav_client(&server);
    let undo = new_undo_map();

    reconcile_push(&pool, &client, &cfg, &undo).await.expect("push");

    let st = fake.state.lock().unwrap();
    // At every tmp PUT the final name 404'd (a reader before the MOVE sees
    // nothing, never a partial body).
    assert!(!st.final_absent_at_tmp_put.is_empty());
    assert!(
        st.final_absent_at_tmp_put.iter().all(|absent| *absent),
        "final name must 404 until the MOVE lands"
    );
    // And no PUT ever targeted a final name directly.
    assert!(
        st.journal_entries("PUT")
            .iter()
            .all(|e| e.path.contains(".tmp-")),
        "every PUT goes to a tmp-<uuid> name"
    );
}

// ---------------------------------------------------------------------------
// Task 3 — pull path
// ---------------------------------------------------------------------------

#[tokio::test]
async fn sync_pull_further_progress_replaces_locator_and_stashes_exact_old_row() {
    let pool = fresh_pool().await;
    seed_device(&pool, "device-a").await;
    seed_work(&pool, "w1", "h1", "epub").await;
    seed_locator(&pool, "w1", "epubcfi(/6/4[c01])", 0.40, 1000).await;
    let (server, fake) = start_dav().await;
    let cfg = config_row(&server, "本机");
    let client = dav_client(&server);

    let mut peer = peer_state("device-b", "小明的 Pixel 8");
    peer.progress.insert(
        "w1".to_string(),
        progress_rec("epubcfi(/6/4[c99])", 0.90, 2000),
    );
    let peer_etag = fake.seed_file(&state_path("device-b"), serde_json::to_vec(&peer).unwrap());

    let undo = new_undo_map();
    let report = pull_state_files(&pool, &client, &cfg, &undo, None)
        .await
        .expect("pull succeeds");

    assert_eq!(report.pulled_devices, 1);
    assert_eq!(report.merged_progress, 1);
    assert_eq!(report.jumps.len(), 1);
    assert!(report.warnings.is_empty());

    // Locator replaced by the further remote row.
    let (cfi, fraction, updated_at): (Option<String>, Option<f64>, i64) =
        sqlx::query_as("SELECT cfi, progress_fraction, updated_at FROM locator WHERE work_id = 'w1'")
            .fetch_one(&pool)
            .await
            .expect("locator row");
    assert_eq!(cfi.as_deref(), Some("epubcfi(/6/4[c99])"));
    assert_eq!(fraction, Some(0.90));
    assert_eq!(updated_at, 2000);

    // The stash holds the EXACT displaced local row (composite D-08).
    let guard = undo.lock().await;
    let stash = guard.get("w1").expect("undo stash");
    assert_eq!(stash.from_row.cfi.as_deref(), Some("epubcfi(/6/4[c01])"));
    assert_eq!(stash.from_row.progress_fraction, Some(0.40));
    assert_eq!(stash.from_row.text_pre.as_deref(), Some("pre"));
    assert_eq!(stash.from_row.text_exact.as_deref(), Some("exact"));
    assert_eq!(stash.from_row.text_post.as_deref(), Some("post"));
    assert_eq!(stash.from_row.updated_at, 1000);
    assert_eq!(stash.to_fraction, Some(0.90));
    assert_eq!(stash.from_device_name, "小明的 Pixel 8");
    drop(guard);

    // The peer ETag cache row landed (next pull skips this peer).
    let cached: Option<String> =
        sqlx::query_scalar("SELECT remote_etag FROM sync_state WHERE id = 'peer:device-b'")
            .fetch_one(&pool)
            .await
            .expect("peer cache row");
    assert_eq!(cached, Some(peer_etag));
}

#[tokio::test]
async fn sync_pull_remote_tombstone_deletes_and_stale_live_copy_never_resurrects() {
    let pool = fresh_pool().await;
    seed_device(&pool, "device-a").await;
    seed_work(&pool, "w1", "h1", "epub").await;
    seed_annotation(&pool, "a1", "w1", "句子", 2, 0, 1000).await;
    let (server, fake) = start_dav().await;
    let cfg = config_row(&server, "本机");
    let client = dav_client(&server);
    let undo = new_undo_map();

    // Peer tombstones a1 at a HIGHER revision — remove-wins.
    let mut peer = peer_state("device-b", "小明的 Pixel 8");
    peer.annotations.insert(
        "a1".to_string(),
        annotation_rec("w1", "句子", 3, 1, 2000),
    );
    fake.seed_file(&state_path("device-b"), serde_json::to_vec(&peer).unwrap());
    pull_state_files(&pool, &client, &cfg, &undo, None)
        .await
        .expect("pull 1");
    let (deleted, revision): (i64, i64) =
        sqlx::query_as("SELECT deleted, revision FROM annotation WHERE annotation_id = 'a1'")
            .fetch_one(&pool)
            .await
            .expect("annotation row");
    assert_eq!((deleted, revision), (1, 3), "remote tombstone applied");

    // A stale peer state where a1 was still live (older revision) must NOT
    // resurrect it.
    let mut stale = peer_state("device-b", "小明的 Pixel 8");
    stale.annotations.insert(
        "a1".to_string(),
        annotation_rec("w1", "句子", 2, 0, 1500),
    );
    fake.seed_file(&state_path("device-b"), serde_json::to_vec(&stale).unwrap());
    pull_state_files(&pool, &client, &cfg, &undo, None)
        .await
        .expect("pull 2");
    let (deleted, revision): (i64, i64) =
        sqlx::query_as("SELECT deleted, revision FROM annotation WHERE annotation_id = 'a1'")
            .fetch_one(&pool)
            .await
            .expect("annotation row");
    assert_eq!((deleted, revision), (1, 3), "tombstone survives a stale live copy");
}

#[tokio::test]
async fn sync_pull_union_keeps_one_side_only_records_both_directions() {
    let pool = fresh_pool().await;
    seed_device(&pool, "device-a").await;
    seed_library_book(&pool, "w-local", "本地书", 0, 0, 1111).await;
    seed_annotation(&pool, "a-local", "w-local", "本地句子", 1, 0, 1000).await;
    seed_locator(&pool, "w-local", "epubcfi(/6/4[l])", 0.50, 1000).await;
    let (server, fake) = start_dav().await;
    let cfg = config_row(&server, "本机");
    let client = dav_client(&server);
    let undo = new_undo_map();

    let mut peer = peer_state("device-b", "小明的 Pixel 8");
    peer.annotations.insert(
        "a-remote".to_string(),
        annotation_rec("w-remote", "远端句子", 1, 0, 2000),
    );
    peer.progress.insert(
        "w-remote".to_string(),
        progress_rec("epubcfi(/6/4[r])", 0.70, 2000),
    );
    peer.library.insert(
        "w-remote".to_string(),
        library_rec("远端书", 2222, 0, None),
    );
    fake.seed_file(&state_path("device-b"), serde_json::to_vec(&peer).unwrap());

    pull_state_files(&pool, &client, &cfg, &undo, None)
        .await
        .expect("pull");

    // Remote-only records merged in; local-only records untouched.
    assert!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM annotation WHERE annotation_id = 'a-remote'"
        )
        .fetch_one(&pool)
        .await
        .unwrap()
            == 1
    );
    assert!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM annotation WHERE annotation_id = 'a-local'"
        )
        .fetch_one(&pool)
        .await
        .unwrap()
            == 1,
        "local-only annotation survives (union)"
    );
    let remote_fraction: Option<f64> =
        sqlx::query_scalar("SELECT progress_fraction FROM locator WHERE work_id = 'w-remote'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(remote_fraction, Some(0.70));
    let local_fraction: Option<f64> =
        sqlx::query_scalar("SELECT progress_fraction FROM locator WHERE work_id = 'w-local'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(local_fraction, Some(0.50));
    let source_id: String =
        sqlx::query_scalar("SELECT source_id FROM library_item WHERE work_id = 'w-remote'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(source_id, "sync-remote", "placeholder card sentinel (D-99)");

    // Other direction: our push now carries the union — both devices converge.
    reconcile_push(&pool, &client, &cfg, &undo).await.expect("push");
    let body = fake.body(&state_path("device-a")).expect("own state file");
    let file: DeviceStateFile = serde_json::from_slice(&body).unwrap();
    assert!(file.annotations.contains_key("a-remote"));
    assert!(file.annotations.contains_key("a-local"));
    assert!(file.progress.contains_key("w-remote"));
    assert!(file.progress.contains_key("w-local"));
    assert!(file.library.contains_key("w-remote"));
    assert!(file.library.contains_key("w-local"));
}

#[tokio::test]
async fn sync_pull_skips_malformed_devices_without_aborting_the_pull() {
    let pool = fresh_pool().await;
    seed_device(&pool, "device-a").await;
    seed_work(&pool, "w1", "h1", "epub").await;
    seed_locator(&pool, "w1", "epubcfi(/6/4)", 0.10, 1000).await;
    let (server, fake) = start_dav().await;
    let cfg = config_row(&server, "本机");
    let client = dav_client(&server);
    let undo = new_undo_map();

    // Invalid JSON.
    fake.seed_file(&state_path("device-b"), b"{not json".to_vec());
    // Unsupported format.
    let mut bad_format = peer_state("device-c", "旧设备");
    bad_format.format = 2;
    fake.seed_file(&state_path("device-c"), serde_json::to_vec(&bad_format).unwrap());
    // Filename/payload device_id mismatch.
    let mut mismatched = peer_state("device-zzz", "伪装设备");
    mismatched
        .progress
        .insert("w1".to_string(), progress_rec("epubcfi(/6/9)", 0.99, 3000));
    fake.seed_file(&state_path("device-d"), serde_json::to_vec(&mismatched).unwrap());
    // One good peer.
    let mut good = peer_state("device-e", "好设备");
    good.progress
        .insert("w1".to_string(), progress_rec("epubcfi(/6/8)", 0.90, 2000));
    fake.seed_file(&state_path("device-e"), serde_json::to_vec(&good).unwrap());

    let report = pull_state_files(&pool, &client, &cfg, &undo, None)
        .await
        .expect("pull never aborts");

    assert_eq!(report.pulled_devices, 1, "only the good device merged");
    assert_eq!(report.warnings.len(), 3, "three skipped devices, three warnings");
    let fraction: Option<f64> =
        sqlx::query_scalar("SELECT progress_fraction FROM locator WHERE work_id = 'w1'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(fraction, Some(0.90), "good peer merged despite the bad ones");
}

#[tokio::test]
async fn sync_pull_never_touches_change_log() {
    let pool = fresh_pool().await;
    seed_device(&pool, "device-a").await;
    seed_work(&pool, "w1", "h1", "epub").await;
    seed_locator(&pool, "w1", "epubcfi(/6/4)", 0.40, 1000).await;
    sqlx::query(
        "INSERT INTO change_log (id, device_id, logical_clock, entity, op, payload, created_at) \
         VALUES ('seed-row', 'device-a', 7, 'locator', 'upsert', '{}', 1000)",
    )
    .execute(&pool)
    .await
    .unwrap();
    let before = change_log_count(&pool).await;
    assert_eq!(before, 1);

    let (server, fake) = start_dav().await;
    let cfg = config_row(&server, "本机");
    let client = dav_client(&server);
    let undo = new_undo_map();
    let mut peer = peer_state("device-b", "小明的 Pixel 8");
    peer.progress
        .insert("w1".to_string(), progress_rec("epubcfi(/6/8)", 0.90, 2000));
    peer.annotations.insert(
        "a1".to_string(),
        annotation_rec("w1", "远端句子", 1, 0, 2000),
    );
    peer.library.insert(
        "w-remote".to_string(),
        library_rec("远端书", 2222, 0, None),
    );
    fake.seed_file(&state_path("device-b"), serde_json::to_vec(&peer).unwrap());

    let report = pull_state_files(&pool, &client, &cfg, &undo, None)
        .await
        .expect("pull");
    assert!(report.merged_progress > 0 || report.merged_annotations > 0);
    assert_eq!(
        change_log_count(&pool).await,
        before,
        "remote merges NEVER write the local change_log (ledger hygiene)"
    );
}

#[tokio::test]
async fn sync_pull_unchanged_peer_etag_issues_zero_get() {
    let pool = fresh_pool().await;
    seed_device(&pool, "device-a").await;
    let (server, fake) = start_dav().await;
    let cfg = config_row(&server, "本机");
    let client = dav_client(&server);
    let undo = new_undo_map();
    let peer = peer_state("device-b", "小明的 Pixel 8");
    fake.seed_file(&state_path("device-b"), serde_json::to_vec(&peer).unwrap());

    pull_state_files(&pool, &client, &cfg, &undo, None)
        .await
        .expect("pull 1");
    let first_gets = fake.state.lock().unwrap().get_count(&state_path("device-b"));
    assert_eq!(first_gets, 1, "changed peer is fetched once");

    let report = pull_state_files(&pool, &client, &cfg, &undo, None)
        .await
        .expect("pull 2");
    assert_eq!(report.pulled_devices, 0, "unchanged ETag skips the peer");
    let second_gets = fake.state.lock().unwrap().get_count(&state_path("device-b"));
    assert_eq!(second_gets, 1, "ETag-unchanged peer costs zero GETs");
}

#[tokio::test]
async fn sync_pull_discovery_row_lands_and_repull_never_clobbers_transfer_state() {
    let pool = fresh_pool().await;
    seed_device(&pool, "device-a").await;
    let (server, fake) = start_dav().await;
    let cfg = config_row(&server, "本机");
    let client = dav_client(&server);
    let undo = new_undo_map();

    let mut peer = peer_state("device-b", "小明的 Pixel 8");
    peer.library.insert(
        "w-remote".to_string(),
        library_rec(
            "远端书",
            2222,
            0,
            Some(FileSyncRec {
                enabled: true,
                remote_path: Some("pillowtome/books/作者 - 远端书.epub".to_string()),
                size: Some(12345),
                hash: Some("blake3-wremote".to_string()),
            }),
        ),
    );
    fake.seed_file(&state_path("device-b"), serde_json::to_vec(&peer).unwrap());
    pull_state_files(&pool, &client, &cfg, &undo, None)
        .await
        .expect("pull 1");

    let row: (String, Option<String>, String, Option<i64>, Option<String>, Option<String>) =
        sqlx::query_as(
            "SELECT direction, transfer_uuid, chunks_done, size, hash, remote_path \
             FROM sync_file_state WHERE work_id = 'w-remote'",
        )
        .fetch_one(&pool)
        .await
        .expect("discovery row");
    assert_eq!(row.0, "download", "discovery rows are direction='download'");
    assert_eq!(row.1, None, "NULL transfer_uuid — nothing in flight");
    assert_eq!(row.2, "[]");
    assert_eq!(row.3, Some(12345));
    assert_eq!(row.4.as_deref(), Some("blake3-wremote"));
    assert_eq!(
        row.5.as_deref(),
        Some("pillowtome/books/作者 - 远端书.epub")
    );

    // An in-flight download now owns transfer state on that row.
    sqlx::query(
        "UPDATE sync_file_state SET transfer_uuid = 't-1', chunks_done = '[1,2]' \
         WHERE work_id = 'w-remote'",
    )
    .execute(&pool)
    .await
    .unwrap();

    // The peer's metadata changes (new etag) → the discovery UPSERT re-runs…
    let mut peer2 = peer_state("device-b", "小明的 Pixel 8");
    peer2.library.insert(
        "w-remote".to_string(),
        library_rec(
            "远端书",
            2222,
            0,
            Some(FileSyncRec {
                enabled: true,
                remote_path: Some("pillowtome/books/作者 - 远端书.epub".to_string()),
                size: Some(23456),
                hash: Some("blake3-wremote-v2".to_string()),
            }),
        ),
    );
    fake.seed_file(&state_path("device-b"), serde_json::to_vec(&peer2).unwrap());
    pull_state_files(&pool, &client, &cfg, &undo, None)
        .await
        .expect("pull 2");

    let row: (Option<String>, String, Option<i64>, Option<String>) = sqlx::query_as(
        "SELECT transfer_uuid, chunks_done, size, hash FROM sync_file_state \
         WHERE work_id = 'w-remote'",
    )
    .fetch_one(&pool)
    .await
    .expect("discovery row");
    // …updating ONLY size/hash/remote_path — the in-flight state survives.
    assert_eq!(row.0.as_deref(), Some("t-1"), "transfer_uuid never clobbered");
    assert_eq!(row.1, "[1,2]", "chunks_done never clobbered");
    assert_eq!(row.2, Some(23456), "metadata advances");
    assert_eq!(row.3.as_deref(), Some("blake3-wremote-v2"));
}

// ---------------------------------------------------------------------------
// Task 4 — D-92 revert
// ---------------------------------------------------------------------------

#[tokio::test]
async fn sync_undo_revert_restores_stashed_row_appends_local_ledger_then_none() {
    let pool = fresh_pool().await;
    seed_device(&pool, "device-a").await;
    seed_work(&pool, "w1", "h1", "epub").await;
    // Post-jump locator state (the remote 0.90 already landed).
    seed_locator(&pool, "w1", "epubcfi(/6/4[c09])", 0.90, 9000).await;
    sqlx::query(
        "INSERT INTO change_log (id, device_id, logical_clock, entity, op, payload, created_at) \
         VALUES ('seed-row', 'device-a', 7, 'locator', 'upsert', '{}', 1000)",
    )
    .execute(&pool)
    .await
    .unwrap();
    let undo = new_undo_map();
    undo.lock().await.insert(
        "w1".to_string(),
        JumpStash {
            work_id: "w1".to_string(),
            from_row: ProgressRec {
                cfi: Some("epubcfi(/6/4[c04])".to_string()),
                progress_fraction: Some(0.40),
                text_pre: Some("pre4".to_string()),
                text_exact: Some("exact4".to_string()),
                text_post: Some("post4".to_string()),
                updated_at: 4000,
            },
            to_fraction: Some(0.90),
            from_device_name: "小明的 Pixel 8".to_string(),
            stashed_at: 8000,
        },
    );

    let restored = revert_jump_with_pool(&pool, &undo, "w1")
        .await
        .expect("revert")
        .expect("stash present → Some");
    assert_eq!(restored.cfi, "epubcfi(/6/4[c04])");
    assert_eq!(restored.progress_fraction, 0.40);

    // The exact pre-jump composite is restored, with a FRESH updated_at.
    let row: (Option<String>, Option<f64>, Option<String>, Option<String>, Option<String>, i64) =
        sqlx::query_as(
            "SELECT cfi, progress_fraction, text_pre, text_exact, text_post, updated_at \
             FROM locator WHERE work_id = 'w1'",
        )
        .fetch_one(&pool)
        .await
        .expect("locator row");
    assert_eq!(row.0.as_deref(), Some("epubcfi(/6/4[c04])"));
    assert_eq!(row.1, Some(0.40));
    assert_eq!(row.2.as_deref(), Some("pre4"));
    assert_eq!(row.3.as_deref(), Some("exact4"));
    assert_eq!(row.4.as_deref(), Some("post4"));
    assert!(row.5 > 8000, "updated_at refreshed, got {}", row.5);

    // Exactly one LOCAL change_log row, monotonic clock = prior max + 1.
    assert_eq!(change_log_count(&pool).await, 2);
    let (entity, op, device_id, clock, payload): (String, String, String, i64, String) =
        sqlx::query_as(
            "SELECT entity, op, device_id, logical_clock, payload FROM change_log \
             WHERE id != 'seed-row'",
        )
        .fetch_one(&pool)
        .await
        .expect("revert ledger row");
    assert_eq!(entity, "locator");
    assert_eq!(op, "upsert");
    assert_eq!(device_id, "device-a");
    assert_eq!(clock, 8, "prior max 7 + 1");
    assert!(payload.contains("w1"));
    assert!(payload.contains("0.4"), "payload carries the restored row");

    // Second tap is a soft no-op.
    let second = revert_jump_with_pool(&pool, &undo, "w1").await.expect("revert");
    assert!(second.is_none());
}

/// `config_row` needs a server; the builder tests do no network — this is a
/// detached-row variant of the same shape.
fn config_row_named(device_name: &str) -> pillowtome_lib::sync::reconcile::SyncConfigRow {
    pillowtome_lib::sync::reconcile::SyncConfigRow {
        server_url: "http://127.0.0.1:1".to_string(),
        username: "user".to_string(),
        remote_path: "pillowtome/".to_string(),
        allow_http: true,
        trust_self_signed: false,
        device_name: Some(device_name.to_string()),
    }
}

/// Keep the pool type import used (doc linkage for the harness).
#[allow(dead_code)]
fn _pool_type_witness(_: &SqlitePool) {}

// ---------------------------------------------------------------------------
// Post-07-03 auth fix — the fake now 401s any request without the configured
// Basic credentials (every test in this file runs against that gate), and this
// test asserts on the wire that the previously-bare raw-agent sites (state
// tmp PUT, state MOVE, device-record tmp PUT, device-record MOVE) carry it.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn sync_push_raw_agent_requests_carry_basic_auth() {
    let pool = fresh_pool().await;
    seed_device(&pool, "device-a").await;
    seed_library_book(&pool, "w1", "书名一", 0, 0, 1111).await;
    let (server, fake) = start_dav().await;
    let cfg = config_row(&server, "本机");
    let client = dav_client(&server);
    let undo = new_undo_map();

    reconcile_push(&pool, &client, &cfg, &undo)
        .await
        .expect("push succeeds against the auth-enforcing fake");

    let st = fake.state.lock().unwrap();
    let puts = st.journal_entries("PUT");
    let state_put = puts
        .iter()
        .find(|e| e.path.starts_with("/pillowtome/state/device-a.json.tmp-"))
        .expect("state tmp PUT journaled");
    assert_eq!(
        state_put.authorization.as_deref(),
        Some(EXPECTED_BASIC_AUTH),
        "state tmp PUT must carry Basic auth"
    );
    let device_put = puts
        .iter()
        .find(|e| e.path.starts_with("/pillowtome/devices/device-a.json.tmp-"))
        .expect("device-record tmp PUT journaled");
    assert_eq!(
        device_put.authorization.as_deref(),
        Some(EXPECTED_BASIC_AUTH),
        "device-record tmp PUT must carry Basic auth"
    );
    let moves = st.journal_entries("MOVE");
    assert!(moves.len() >= 2, "state MOVE + device-record MOVE");
    for mv in &moves {
        assert_eq!(
            mv.authorization.as_deref(),
            Some(EXPECTED_BASIC_AUTH),
            "MOVE {} must carry Basic auth",
            mv.path
        );
    }
    // Blanket check: EVERY request the push made — high-level (authed
    // internally by reqwest_dav) or raw-agent (authed via transport::authed) —
    // carried the configured credentials.
    assert!(
        st.journal
            .iter()
            .all(|e| e.authorization.as_deref() == Some(EXPECTED_BASIC_AUTH)),
        "no request may go out unauthenticated"
    );
}
