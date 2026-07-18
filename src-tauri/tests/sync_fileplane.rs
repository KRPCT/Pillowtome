//! File-plane wiremock integration (SYNC-04, plan 07-03 Task 4): the Nextcloud
//! chunk v2 state machine (Destination on EVERY request, 423 retry,
//! missing-only resume, 24h restart), the conditional single PUT, ranged
//! download resume with the blake3 == work_id hard gate, and the structural
//! streaming grep-guard. All off-device: the shared stateful DAV fake
//! (`tests/common/mod.rs`), in-memory SQLite SCHEMA_V1..V8, temp-dir fixtures.
//! Assertions live on request HEADERS / COUNTS / paths, never on reqwest_dav
//! internals.

mod common;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use pillowtome_core::sync::fileplane as planner;
use pillowtome_lib::storage::SourceRegistry;
use pillowtome_lib::sync::fileplane::{
    download_book, upload_book, FileError, FilePlaneCtx, FileProgress,
};
use sqlx::SqlitePool;
use wiremock::matchers::any;
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// A `FilePlaneCtx` pointed at the wiremock server (Basic auth user/pass from
/// the shared harness client), remote root `pillowtome/`.
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
    let dir = std::env::temp_dir().join(format!("pillowtome-fp-{tag}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

/// Deterministic payload of `size` bytes written into `dir`; returns path + bytes.
fn write_fixture(dir: &Path, name: &str, size: usize) -> (PathBuf, Vec<u8>) {
    let bytes: Vec<u8> = (0..size).map(|i| (i % 251) as u8).collect();
    let path = dir.join(name);
    std::fs::write(&path, &bytes).expect("write fixture");
    (path, bytes)
}

/// Vec-backed progress sink recorder (the engine-side contract: tests assert
/// on sink calls, fileplane never emits events itself).
#[derive(Clone, Default)]
struct Recorder {
    calls: Arc<Mutex<Vec<FileProgress>>>,
}

impl Recorder {
    fn sink(&self) -> impl Fn(FileProgress) + Send + Sync {
        let calls = self.calls.clone();
        move |p| calls.lock().unwrap().push(p)
    }

    fn calls(&self) -> Vec<FileProgress> {
        self.calls.lock().unwrap().clone()
    }
}

/// (direction, transfer_uuid, chunks_done, size, hash, remote_path) for a work.
type RowTuple = (
    String,
    Option<String>,
    String,
    Option<i64>,
    Option<String>,
    Option<String>,
);

async fn file_row(pool: &SqlitePool, work_id: &str) -> Option<RowTuple> {
    sqlx::query_as(
        "SELECT direction, transfer_uuid, chunks_done, size, hash, remote_path \
         FROM sync_file_state WHERE work_id = $1",
    )
    .bind(work_id)
    .fetch_optional(pool)
    .await
    .expect("read sync_file_state row")
}

async fn seed_upload_row(
    pool: &SqlitePool,
    work_id: &str,
    transfer_uuid: &str,
    chunks_done: &str,
    size: u64,
    remote_path: &str,
    started_at: i64,
) {
    sqlx::query(
        "INSERT INTO sync_file_state (work_id, direction, transfer_uuid, chunks_done, \
         size, hash, remote_path, started_at, updated_at) \
         VALUES ($1, 'upload', $2, $3, $4, $5, $6, $7, $7)",
    )
    .bind(work_id)
    .bind(transfer_uuid)
    .bind(chunks_done)
    .bind(size as i64)
    .bind(work_id)
    .bind(remote_path)
    .bind(started_at)
    .execute(pool)
    .await
    .expect("seed upload row");
}

async fn seed_download_row(
    pool: &SqlitePool,
    work_id: &str,
    etag_token: Option<&str>,
    size: u64,
    remote_path: &str,
) {
    let now = now_ms();
    sqlx::query(
        "INSERT INTO sync_file_state (work_id, direction, transfer_uuid, chunks_done, \
         size, hash, remote_path, started_at, updated_at) \
         VALUES ($1, 'download', $2, '[]', $3, $4, $5, $6, $6)",
    )
    .bind(work_id)
    .bind(etag_token)
    .bind(size as i64)
    .bind(work_id)
    .bind(remote_path)
    .bind(now)
    .execute(pool)
    .await
    .expect("seed download row");
}

fn journal_of(fake: &common::FakeDav) -> Vec<common::JournalEntry> {
    fake.state.lock().unwrap().journal.clone()
}

// ---------------------------------------------------------------------------
// 1) Chunked happy path: MKCOL → PUT 00001..N → MOVE .file — Destination
//    everywhere, OC-Total-Length on every chunk PUT, assembled bytes correct,
//    completed metadata row left for the 07-02 state builder.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn sync_fileplane_chunked_upload_full_flow() {
    let (server, fake) = common::start_dav().await;
    let ctx = ctx_for(&server);
    let pool = common::fresh_pool().await;
    let dir = temp_dir("full");
    let size = planner::CHUNK_THRESHOLD + 3; // two chunks: 10MB + 3 bytes
    let (fixture, bytes) = write_fixture(&dir, "book.epub", size as usize);
    // The uploads/ tree exists (a stale dir from another transfer) → the
    // capability probe sees Nextcloud.
    fake.seed_file("/uploads/user/pillowtome-stale/00001", b"stale".to_vec());
    let remote_path = "pillowtome/books/author%20-%20title.epub";
    let recorder = Recorder::default();

    upload_book(&ctx, &pool, &recorder.sink(), "work-full", &fixture, remote_path)
        .await
        .expect("chunked upload succeeds");

    let dest_url = format!("{}/{}", server.uri(), remote_path);
    // The wire log (wiremock request recording) proves Destination reached the
    // wire on EVERY non-PROPFIND request under uploads/.
    let received = server
        .received_requests()
        .await
        .expect("request recording enabled");
    let uploads_requests: Vec<_> = received
        .iter()
        .filter(|r| r.url.path().starts_with("/uploads/") && r.method.as_str() != "PROPFIND")
        .collect();
    assert_eq!(uploads_requests.len(), 4, "MKCOL + 2 chunk PUTs + MOVE");
    for request in &uploads_requests {
        let destination = request
            .headers
            .get("destination")
            .and_then(|v| v.to_str().ok());
        assert_eq!(
            destination,
            Some(dest_url.as_str()),
            "{} {} missed the Destination header",
            request.method,
            request.url.path()
        );
    }

    let journal = journal_of(&fake);
    let mkcol: Vec<_> = journal.iter().filter(|e| e.method == "MKCOL").collect();
    assert_eq!(mkcol.len(), 1, "exactly one MKCOL");
    let puts: Vec<_> = journal
        .iter()
        .filter(|e| e.method == "PUT" && e.path.starts_with("/uploads/"))
        .collect();
    assert_eq!(puts.len(), 2);
    assert!(puts[0].path.ends_with("/00001"), "first chunk: {}", puts[0].path);
    assert!(puts[1].path.ends_with("/00002"), "second chunk: {}", puts[1].path);
    for put in &puts {
        assert_eq!(
            put.oc_total_length.as_deref(),
            Some(size.to_string().as_str()),
            "every chunk PUT carries OC-Total-Length = full size"
        );
    }
    let moves: Vec<_> = journal.iter().filter(|e| e.method == "MOVE").collect();
    assert_eq!(moves.len(), 1, "exactly one MOVE of .file");
    assert!(moves[0].path.ends_with("/.file"));
    assert_eq!(moves[0].destination.as_deref(), Some(dest_url.as_str()));
    assert_eq!(
        moves[0].oc_total_length.as_deref(),
        Some(size.to_string().as_str())
    );

    // The fake assembled the chunks — the destination holds the exact book bytes.
    assert_eq!(
        fake.body(&format!("/{remote_path}")).as_deref(),
        Some(bytes.as_slice())
    );

    // Completed uploads leave the metadata row the 07-02 state builder reads
    // (direction='upload' + remote_path IS NOT NULL, no transfer scratch).
    let row = file_row(&pool, "work-full").await.expect("completed row");
    assert_eq!(row.0, "upload");
    assert_eq!(row.1, None, "transfer_uuid cleared");
    assert_eq!(row.2, "[]", "chunks_done cleared");
    assert_eq!(row.3, Some(size as i64));
    assert_eq!(row.4.as_deref(), Some("work-full"));
    assert_eq!(row.5.as_deref(), Some(remote_path));

    // Progress sink saw a terminal done == total report.
    let calls = recorder.calls();
    let last = calls.last().expect("progress reported");
    assert_eq!(last.done, size);
    assert_eq!(last.total, size);
    assert!(last.message.is_none());

    std::fs::remove_dir_all(&dir).ok();
}

// ---------------------------------------------------------------------------
// 2) MOVE answers 423 once then 201 — 423 Locked is retried, never terminal.
// ---------------------------------------------------------------------------
#[derive(Clone)]
struct Move423Once {
    inner: common::FakeDav,
    moves: Arc<AtomicUsize>,
}

impl Respond for Move423Once {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        if request.method.as_str() == "MOVE" && self.moves.fetch_add(1, Ordering::SeqCst) == 0 {
            // Journal the failed attempt too (the fake journals inside respond).
            self.inner
                .state
                .lock()
                .unwrap()
                .journal
                .push(common::journal(request, &request.url.path().to_string()));
            return ResponseTemplate::new(423);
        }
        self.inner.respond(request)
    }
}

#[tokio::test]
async fn sync_fileplane_chunked_upload_423_then_success() {
    let server = MockServer::start().await;
    let fake = common::FakeDav::default();
    let moves = Arc::new(AtomicUsize::new(0));
    Mock::given(any())
        .respond_with(Move423Once {
            inner: fake.clone(),
            moves: moves.clone(),
        })
        .mount(&server)
        .await;
    let ctx = ctx_for(&server);
    let pool = common::fresh_pool().await;
    let dir = temp_dir("locked");
    let size = planner::CHUNK_THRESHOLD + 3;
    let (fixture, _bytes) = write_fixture(&dir, "book.epub", size as usize);
    fake.seed_file("/uploads/user/pillowtome-stale/00001", b"stale".to_vec());
    let remote_path = "pillowtome/books/locked.epub";
    let recorder = Recorder::default();

    upload_book(&ctx, &pool, &recorder.sink(), "work-423", &fixture, remote_path)
        .await
        .expect("423 is retried, not terminal");

    assert_eq!(moves.load(Ordering::SeqCst), 2, "exactly two MOVE attempts");
    assert!(
        fake.body(&format!("/{remote_path}")).is_some(),
        "assembly landed after the retry"
    );
    std::fs::remove_dir_all(&dir).ok();
}

// ---------------------------------------------------------------------------
// 3) Resume: a sync_file_state row + a server PROPFIND listing 00001+00002 ⇒
//    only chunk 00003 is PUT; nothing is re-sent; the row completes.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn sync_fileplane_chunked_upload_resume_missing_only() {
    let (server, fake) = common::start_dav().await;
    let ctx = ctx_for(&server);
    let pool = common::fresh_pool().await;
    let dir = temp_dir("resume");
    let size = 2 * planner::CHUNK_SIZE + 3; // three chunks
    let (fixture, bytes) = write_fixture(&dir, "book.epub", size as usize);
    let uuid = "pillowtome-fixed-uuid";
    let chunk = planner::CHUNK_SIZE as usize;
    // Server truth: chunks 1+2 confirmed (fixture's real leading bytes so the
    // assembly reconstructs the book exactly).
    fake.seed_file(
        &format!("/uploads/user/{uuid}/00001"),
        bytes[..chunk].to_vec(),
    );
    fake.seed_file(
        &format!("/uploads/user/{uuid}/00002"),
        bytes[chunk..2 * chunk].to_vec(),
    );
    let remote_path = "pillowtome/books/resumed.epub";
    // The row's chunks_done hint is STALE ([1] only) — the server set wins.
    seed_upload_row(
        &pool,
        "work-resume",
        uuid,
        "[1]",
        size,
        remote_path,
        now_ms(),
    )
    .await;
    let recorder = Recorder::default();

    upload_book(&ctx, &pool, &recorder.sink(), "work-resume", &fixture, remote_path)
        .await
        .expect("resume upload succeeds");

    let journal = journal_of(&fake);
    let puts: Vec<_> = journal
        .iter()
        .filter(|e| e.method == "PUT" && e.path.starts_with("/uploads/"))
        .collect();
    assert_eq!(puts.len(), 1, "only the missing chunk is sent");
    assert!(
        puts[0].path.ends_with("/00003"),
        "the missing chunk: {}",
        puts[0].path
    );
    assert!(
        !puts.iter().any(|e| e.path.ends_with("/00001") || e.path.ends_with("/00002")),
        "confirmed chunks are never re-sent"
    );
    assert_eq!(
        journal.iter().filter(|e| e.method == "MKCOL").count(),
        0,
        "an existing upload dir is not re-created"
    );
    assert_eq!(
        fake.body(&format!("/{remote_path}")).as_deref(),
        Some(bytes.as_slice()),
        "assembled bytes == fixture"
    );

    let row = file_row(&pool, "work-resume").await.expect("completed row");
    assert_eq!(row.0, "upload");
    assert_eq!(row.1, None, "scratch deleted on success");
    assert_eq!(row.5.as_deref(), Some(remote_path));
    std::fs::remove_dir_all(&dir).ok();
}

// ---------------------------------------------------------------------------
// 4a) Single-PUT path (< threshold) sends `If-None-Match: *` — asserted ON
//     THE WIRE via the fake's request journal (a header that never arrived
//     would read None here — the Pitfall 2 regression can not hide).
// ---------------------------------------------------------------------------
#[tokio::test]
async fn sync_fileplane_conditional_put_headers() {
    let (server, fake) = common::start_dav().await;
    let ctx = ctx_for(&server);
    let pool = common::fresh_pool().await;
    let dir = temp_dir("cond");
    let (fixture, bytes) = write_fixture(&dir, "small.epub", 1024);
    let remote_path = "pillowtome/books/small.epub";
    let recorder = Recorder::default();

    upload_book(&ctx, &pool, &recorder.sink(), "work-small", &fixture, remote_path)
        .await
        .expect("single streaming PUT succeeds");

    let journal = journal_of(&fake);
    let puts: Vec<_> = journal.iter().filter(|e| e.method == "PUT").collect();
    assert_eq!(puts.len(), 1, "one streaming PUT, no chunking");
    assert_eq!(
        puts[0].if_none_match.as_deref(),
        Some("*"),
        "If-None-Match: * must reach the wire"
    );
    assert_eq!(
        journal.iter().filter(|e| e.method == "MKCOL").count(),
        0,
        "no Nextcloud dance below the threshold"
    );
    assert_eq!(
        fake.body(&format!("/{remote_path}")).as_deref(),
        Some(bytes.as_slice())
    );
    let row = file_row(&pool, "work-small").await.expect("completed row");
    assert_eq!((row.0.as_str(), row.1.as_deref()), ("upload", None));
    std::fs::remove_dir_all(&dir).ok();
}

// ---------------------------------------------------------------------------
// 4b) PUT → 412 (the destination materialized after the preflight), the
//     re-PROPFIND shows a DIFFERENT size ⇒ classified RemoteConflict, never a
//     silent overwrite.
// ---------------------------------------------------------------------------
#[derive(Clone)]
struct Put412Race {
    inner: common::FakeDav,
    raced: Arc<AtomicUsize>,
}

impl Respond for Put412Race {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        let path = request.url.path().to_string();
        if request.method.as_str() == "PUT"
            && path == "/pillowtome/books/raced.epub"
            && self.raced.fetch_add(1, Ordering::SeqCst) == 0
        {
            // A same-name different-bytes file appeared between the preflight
            // PROPFIND and the PUT.
            self.inner
                .state
                .lock()
                .unwrap()
                .journal
                .push(common::journal(request, &path));
            self.inner.seed_file(&path, vec![0u8; 7]);
            return ResponseTemplate::new(412);
        }
        self.inner.respond(request)
    }
}

#[tokio::test]
async fn sync_fileplane_conditional_put_412_conflict() {
    let server = MockServer::start().await;
    let fake = common::FakeDav::default();
    Mock::given(any())
        .respond_with(Put412Race {
            inner: fake.clone(),
            raced: Arc::new(AtomicUsize::new(0)),
        })
        .mount(&server)
        .await;
    let ctx = ctx_for(&server);
    let pool = common::fresh_pool().await;
    let dir = temp_dir("race");
    let (fixture, _bytes) = write_fixture(&dir, "raced.epub", 1024);
    let remote_path = "pillowtome/books/raced.epub";
    let recorder = Recorder::default();

    let err = upload_book(&ctx, &pool, &recorder.sink(), "work-race", &fixture, remote_path)
        .await
        .expect_err("412 + different size is a classified conflict");
    assert_eq!(err, FileError::RemoteConflict);
    assert_eq!(err.user_message(), "远端已存在同名文件，已取消本次上传");
    // The foreign file was never overwritten.
    assert_eq!(
        fake.body(&format!("/{remote_path}")).as_deref(),
        Some([0u8; 7].as_slice())
    );
    std::fs::remove_dir_all(&dir).ok();
}

// ---------------------------------------------------------------------------
// 5) Download resume: a pre-seeded .part + a 206-capable server ⇒ the resume
//    GET asks for exactly the missing tail, the blake3 gate passes, the final
//    file is byte-identical, the source is registered.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn sync_fileplane_download_resume_and_verify() {
    let (server, fake) = common::start_dav().await;
    let ctx = ctx_for(&server);
    let pool = common::fresh_pool().await;
    let dir = temp_dir("dl");
    let payload: Vec<u8> = (0..(2 * 1024 * 1024 + 123)).map(|i| (i % 251) as u8).collect();
    let work_id = blake3::hash(&payload).to_hex().to_string();
    let remote_path = "pillowtome/books/peer%20-%20book.epub";
    let etag = fake.seed_file(&format!("/{remote_path}"), payload.clone());
    // Discovery row (07-02's pull-merge shape; the probe ETag is the resume
    // token in transfer_uuid) + a .part holding the first 1MB.
    seed_download_row(
        &pool,
        &work_id,
        Some(&etag),
        payload.len() as u64,
        remote_path,
    )
    .await;
    let k = 1024 * 1024usize;
    let part_path = dir.join(format!("{work_id}.epub.part"));
    std::fs::write(&part_path, &payload[..k]).expect("seed .part");
    let registry = SourceRegistry::new();
    let recorder = Recorder::default();

    let book = download_book(
        &ctx,
        &pool,
        &recorder.sink(),
        &registry,
        &dir,
        &work_id,
        remote_path,
        payload.len() as u64,
    )
    .await
    .expect("download resumes and verifies");

    assert_eq!(book.work_id, work_id);
    let final_path = dir.join(format!("{work_id}.epub"));
    assert_eq!(
        std::fs::read(&final_path).expect("final file readable"),
        payload,
        "final file is byte-identical"
    );
    assert!(!part_path.exists(), ".part is renamed away");
    assert!(
        registry.resolve(&book.source_id).is_some(),
        "the returned source_id resolves in the registry"
    );
    assert_eq!(
        book.local_path,
        final_path.to_string_lossy().into_owned()
    );

    let journal = journal_of(&fake);
    let ranged: Vec<_> = journal
        .iter()
        .filter(|e| e.method == "GET" && e.range.is_some())
        .collect();
    assert!(
        ranged.iter().any(|e| e.range.as_deref() == Some("bytes=0-0")),
        "the probe asks for bytes=0-0"
    );
    let expected_tail = format!("bytes={k}-{}", payload.len() - 1);
    assert!(
        ranged.iter().any(|e| e.range.as_deref() == Some(expected_tail.as_str())),
        "the resume GET asks for exactly the missing tail"
    );
    // Transfer row cleared on success.
    assert!(file_row(&pool, &work_id).await.is_none());
    std::fs::remove_dir_all(&dir).ok();
}

// ---------------------------------------------------------------------------
// 6) Tampered download: bytes whose blake3 ≠ work_id fail the gate — .part
//    deleted, final path absent, nothing registered, classified sink message.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn sync_fileplane_download_blake3_mismatch_refused() {
    let (server, fake) = common::start_dav().await;
    let ctx = ctx_for(&server);
    let pool = common::fresh_pool().await;
    let dir = temp_dir("tamper");
    let payload: Vec<u8> = (0..700_000).map(|i| (i % 251) as u8).collect();
    let work_id = blake3::hash(b"different bytes entirely").to_hex().to_string();
    let remote_path = "pillowtome/books/tampered.epub";
    fake.seed_file(&format!("/{remote_path}"), payload);
    let registry = SourceRegistry::new();
    let recorder = Recorder::default();

    let err = download_book(
        &ctx,
        &pool,
        &recorder.sink(),
        &registry,
        &dir,
        &work_id,
        remote_path,
        700_000,
    )
    .await
    .expect_err("tampered bytes are refused");

    assert_eq!(err, FileError::IntegrityMismatch);
    assert_eq!(err.user_message(), "下载校验失败，文件可能已损坏，请重试");
    assert!(
        !dir.join(format!("{work_id}.epub.part")).exists(),
        ".part is deleted"
    );
    assert!(
        !dir.join(format!("{work_id}.epub")).exists(),
        "the final path never appears"
    );
    assert!(registry.ids().is_empty(), "nothing is registered");
    let calls = recorder.calls();
    let terminal = calls
        .iter()
        .rev()
        .find(|p| p.work_id == work_id)
        .expect("a terminal report exists");
    assert_eq!(
        terminal.message.as_deref(),
        Some("下载校验失败，文件可能已损坏，请重试"),
        "the terminal sink report carries the classified message"
    );
    std::fs::remove_dir_all(&dir).ok();
}

// ---------------------------------------------------------------------------
// 7) Structural streaming guard: the fileplane source streams upload bodies
//    (Body::from) and contains NONE of the whole-file read patterns — a
//    300MB book can never re-enter memory wholesale (Pitfall 4).
// ---------------------------------------------------------------------------
#[test]
fn sync_fileplane_streaming_guard_source_grep() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/src/sync/fileplane.rs");
    let src = std::fs::read_to_string(path).expect("read fileplane source");
    assert!(src.contains("Body::from"), "the streaming upload body must stay");
    for banned in ["read_to_end", "tokio::fs::read(", "std::fs::read("] {
        assert!(
            !src.contains(banned),
            "whole-file read pattern {banned:?} must never appear in fileplane.rs"
        );
    }
}

// ---------------------------------------------------------------------------
// 8) A transfer row older than 24h restarts FRESH: the stale dir is
//    best-effort DELETEd, a NEW transfer_uuid is minted, all chunks go out.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn sync_fileplane_expired_upload_restarts_fresh() {
    let (server, fake) = common::start_dav().await;
    let ctx = ctx_for(&server);
    let pool = common::fresh_pool().await;
    let dir = temp_dir("expired");
    let size = planner::CHUNK_THRESHOLD + 3; // two chunks
    let (fixture, _bytes) = write_fixture(&dir, "book.epub", size as usize);
    let old_uuid = "pillowtome-old";
    // The stale dir (also makes the capability probe see Nextcloud).
    fake.seed_file(&format!("/uploads/user/{old_uuid}/00001"), b"stale".to_vec());
    let remote_path = "pillowtome/books/expired.epub";
    let started_at = now_ms() - 25 * 3600 * 1000; // 25h ago — past the 24h expiry
    seed_upload_row(
        &pool,
        "work-expired",
        old_uuid,
        "[1]",
        size,
        remote_path,
        started_at,
    )
    .await;
    let recorder = Recorder::default();

    upload_book(&ctx, &pool, &recorder.sink(), "work-expired", &fixture, remote_path)
        .await
        .expect("expired transfer restarts fresh");

    let journal = journal_of(&fake);
    assert!(
        journal
            .iter()
            .any(|e| e.method == "DELETE" && e.path.starts_with(&format!("/uploads/user/{old_uuid}"))),
        "the stale upload dir is best-effort DELETEd"
    );
    let mkcol: Vec<_> = journal.iter().filter(|e| e.method == "MKCOL").collect();
    assert_eq!(mkcol.len(), 1, "a fresh upload dir is created");
    assert!(mkcol[0].path.starts_with("/uploads/user/pillowtome-"));
    assert!(
        !mkcol[0].path.contains(old_uuid),
        "a NEW transfer_uuid is minted (old dir never reused)"
    );
    let puts: Vec<_> = journal
        .iter()
        .filter(|e| e.method == "PUT" && e.path.starts_with("/uploads/"))
        .collect();
    assert_eq!(puts.len(), 2, "all chunks are sent on the fresh transfer");
    assert!(
        puts.iter().all(|e| !e.path.contains(old_uuid)),
        "chunks go to the new dir"
    );
    let row = file_row(&pool, "work-expired").await.expect("completed row");
    assert_eq!((row.0.as_str(), row.1.as_deref()), ("upload", None));
    std::fs::remove_dir_all(&dir).ok();
}
