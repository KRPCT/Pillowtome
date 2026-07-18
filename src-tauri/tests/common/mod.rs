//! Shared off-device harness for the sync state-plane tests (07-02):
//! an in-memory SQLite pool migrated SCHEMA_V1..V8 (same binding family as
//! the plugin — single binding, Pitfall 6) and a STATEFUL wiremock WebDAV
//! fake implementing the verbs the reconcile engine uses: PROPFIND
//! (multistatus with per-href `<D:getetag>`), GET, PUT (stores body, bumps
//! ETag), and MOVE (atomic rename honoring If-None-Match/If-Match → 412).
//! Everything stays in-memory: no real network, no keychain, no clock sleeps.

#![allow(dead_code)] // Helpers are shared by two test binaries; each uses a subset.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use pillowtome_lib::migrations::migrations;
use pillowtome_lib::sync::reconcile::SyncConfigRow;
use pillowtome_lib::sync::transport::{build_client, TransportConfig};
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use wiremock::matchers::any;
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

/// In-memory pool with SCHEMA_V1..V8 applied. `max_connections(1)` — SQLite
/// in-memory databases are per-connection, so a single connection keeps one
/// coherent database (and mirrors the plugin's single-writer reality).
pub async fn fresh_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    for migration in migrations() {
        sqlx::raw_sql(migration.sql)
            .execute(&pool)
            .await
            .expect("apply migration");
    }
    pool
}

/// A WebDAV client pointed at the wiremock server (plain http ⇒ `allow_http`
/// set — positively exercises the D-95 gate).
pub fn dav_client(server: &MockServer) -> reqwest_dav::Client {
    let mut cfg = TransportConfig::new(server.uri(), "user".to_string(), "pass".to_string());
    cfg.allow_http = true;
    build_client(&cfg).expect("build client against wiremock server")
}

/// A `SyncConfigRow` pointing at the wiremock server, remote root `pillowtome/`.
pub fn config_row(server: &MockServer, device_name: &str) -> SyncConfigRow {
    SyncConfigRow {
        server_url: server.uri(),
        username: "user".to_string(),
        remote_path: "pillowtome/".to_string(),
        allow_http: true,
        trust_self_signed: false,
        device_name: Some(device_name.to_string()),
    }
}

/// Seed the `sync_meta` device row with a deterministic device_id.
pub async fn seed_device(pool: &SqlitePool, device_id: &str) {
    sqlx::query(
        "INSERT INTO sync_meta (id, device_id, logical_clock) VALUES ('device', $1, 0) \
         ON CONFLICT(id) DO UPDATE SET device_id = excluded.device_id",
    )
    .bind(device_id)
    .execute(pool)
    .await
    .expect("seed sync_meta device row");
}

/// Seed a `work` row (created_at fixed for determinism).
pub async fn seed_work(pool: &SqlitePool, work_id: &str, content_hash: &str, format: &str) {
    sqlx::query("INSERT INTO work (work_id, content_hash, format, created_at) VALUES ($1, $2, $3, 1000)")
        .bind(work_id)
        .bind(content_hash)
        .bind(format)
        .execute(pool)
        .await
        .expect("seed work");
}

/// Seed (or upsert) a locator row.
pub async fn seed_locator(
    pool: &SqlitePool,
    work_id: &str,
    cfi: &str,
    fraction: f64,
    updated_at: i64,
) {
    sqlx::query(
        "INSERT INTO locator (work_id, cfi, progress_fraction, text_pre, text_exact, text_post, updated_at) \
         VALUES ($1, $2, $3, 'pre', 'exact', 'post', $4)",
    )
    .bind(work_id)
    .bind(cfi)
    .bind(fraction)
    .bind(updated_at)
    .execute(pool)
    .await
    .expect("seed locator");
}

/// Seed an annotation row (live or tombstone).
#[allow(clippy::too_many_arguments)]
pub async fn seed_annotation(
    pool: &SqlitePool,
    annotation_id: &str,
    work_id: &str,
    text_exact: &str,
    revision: i64,
    deleted: i64,
    updated_at: i64,
) {
    sqlx::query(
        "INSERT INTO annotation (annotation_id, work_id, type, cfi, color, text_pre, text_exact, \
         text_post, progress_fraction, note, created_at, updated_at, revision, content_hash, deleted) \
         VALUES ($1, $2, 'highlight', 'epubcfi(/6/4)', 'cinnabar', 'pre', $3, 'post', 0.4, NULL, \
         1000, $4, $5, $6, $7)",
    )
    .bind(annotation_id)
    .bind(work_id)
    .bind(text_exact)
    .bind(updated_at)
    .bind(revision)
    .bind(format!("hash-{text_exact}-r{revision}-d{deleted}"))
    .bind(deleted)
    .execute(pool)
    .await
    .expect("seed annotation");
}

/// Seed a `work` + `library_item` pair.
pub async fn seed_library_book(
    pool: &SqlitePool,
    work_id: &str,
    title: &str,
    deleted: i64,
    file_sync_enabled: i64,
    imported_at: i64,
) {
    seed_work(pool, work_id, &format!("blake3-{work_id}"), "epub").await;
    sqlx::query(
        "INSERT INTO library_item (item_id, work_id, source_id, title, author, cover_file, \
         imported_at, last_opened_at, last_read_at, deleted, file_sync_enabled) \
         VALUES ($1, $2, 'local-import', $3, '作者', NULL, $4, NULL, NULL, $5, $6)",
    )
    .bind(format!("item-{work_id}"))
    .bind(work_id)
    .bind(title)
    .bind(imported_at)
    .bind(deleted)
    .bind(file_sync_enabled)
    .execute(pool)
    .await
    .expect("seed library_item");
}

/// Row count of the local `change_log` (pull must never change it).
pub async fn change_log_count(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM change_log")
        .fetch_one(pool)
        .await
        .expect("count change_log")
}

// ---------------------------------------------------------------------------
// Stateful WebDAV fake
// ---------------------------------------------------------------------------

pub struct FakeFile {
    pub body: Vec<u8>,
    pub etag: String,
}

/// The exact Authorization value the fake demands on EVERY request
/// (post-07-03 auth fix): Basic with base64 of `user:pass` — the credentials
/// [`dav_client`] configures. A request without it answers 401, exactly like
/// a real authenticated Nextcloud/坚果云 — this is what exposed the bare
/// raw-agent sites and now guards against their return.
pub const EXPECTED_BASIC_AUTH: &str = "Basic dXNlcjpwYXNz";

/// One journaled request (only the fields the reconcile engine drives).
#[derive(Debug, Clone)]
pub struct JournalEntry {
    pub method: String,
    pub path: String,
    pub destination: Option<String>,
    pub if_match: Option<String>,
    pub if_none_match: Option<String>,
    pub overwrite: Option<String>,
    /// 07-03 file-plane assertions: `Range` on download GETs, `OC-Total-Length`
    /// on Nextcloud chunk PUTs / the assembly MOVE.
    pub range: Option<String>,
    pub oc_total_length: Option<String>,
    /// Post-07-03: the Authorization header as received (must equal
    /// [`EXPECTED_BASIC_AUTH`] — the fake 401s otherwise).
    pub authorization: Option<String>,
}

#[derive(Default)]
pub struct FakeDavState {
    /// Absolute-path → stored file (`/pillowtome/state/dev-a.json`).
    pub files: BTreeMap<String, FakeFile>,
    etag_counter: u64,
    pub journal: Vec<JournalEntry>,
    /// At every tmp PUT: was the final name absent at that instant? (The
    /// atomic-publish proof — a GET on the final name before the MOVE 404s.)
    pub final_absent_at_tmp_put: Vec<bool>,
}

impl FakeDavState {
    fn next_etag(&mut self) -> String {
        self.etag_counter += 1;
        format!("\"etag-{}\"", self.etag_counter)
    }

    pub fn journal_entries(&self, method: &str) -> Vec<&JournalEntry> {
        self.journal.iter().filter(|e| e.method == method).collect()
    }

    pub fn get_count(&self, path: &str) -> usize {
        self.journal
            .iter()
            .filter(|e| e.method == "GET" && e.path == path)
            .count()
    }
}

/// The fake server state, clonable into the wiremock responder.
#[derive(Clone, Default)]
pub struct FakeDav {
    pub state: Arc<Mutex<FakeDavState>>,
}

impl FakeDav {
    /// Seed a remote file out-of-band (peer state files, stale versions).
    /// Returns the assigned ETag.
    pub fn seed_file(&self, path: &str, body: Vec<u8>) -> String {
        let mut st = self.state.lock().unwrap();
        let etag = st.next_etag();
        st.files.insert(path.to_string(), FakeFile { body, etag: etag.clone() });
        etag
    }

    pub fn body(&self, path: &str) -> Option<Vec<u8>> {
        self.state.lock().unwrap().files.get(path).map(|f| f.body.clone())
    }

    pub fn etag(&self, path: &str) -> Option<String> {
        self.state.lock().unwrap().files.get(path).map(|f| f.etag.clone())
    }
}

struct FakeEntry {
    href: String,
    is_collection: bool,
    len: usize,
    etag: Option<String>,
}

fn multistatus(entries: &[FakeEntry]) -> String {
    let mut xml = String::from(r#"<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">"#);
    for entry in entries {
        xml.push_str("<d:response><d:href>");
        xml.push_str(&entry.href);
        xml.push_str("</d:href><d:propstat><d:prop><d:getlastmodified>Wed, 01 Jan 2025 00:00:00 GMT</d:getlastmodified>");
        if entry.is_collection {
            xml.push_str("<d:resourcetype><d:collection/></d:resourcetype>");
        } else {
            xml.push_str("<d:resourcetype></d:resourcetype>");
            xml.push_str(&format!(
                "<d:getcontentlength>{}</d:getcontentlength>",
                entry.len
            ));
            xml.push_str("<d:getcontenttype>application/json</d:getcontenttype>");
            if let Some(tag) = &entry.etag {
                xml.push_str(&format!("<d:getetag>{tag}</d:getetag>"));
            }
        }
        xml.push_str("</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>");
    }
    xml.push_str("</d:multistatus>");
    xml
}

fn header<'a>(request: &'a Request, name: &str) -> Option<&'a str> {
    request.headers.get(name).and_then(|v| v.to_str().ok())
}

/// Build one journal entry from a request (pub so file-plane tests can journal
/// short-circuited failed attempts in their own responders).
pub fn journal(request: &Request, path: &str) -> JournalEntry {
    JournalEntry {
        method: request.method.as_str().to_string(),
        path: path.to_string(),
        destination: header(request, "destination").map(str::to_owned),
        if_match: header(request, "if-match").map(str::to_owned),
        if_none_match: header(request, "if-none-match").map(str::to_owned),
        overwrite: header(request, "overwrite").map(str::to_owned),
        range: header(request, "range").map(str::to_owned),
        oc_total_length: header(request, "oc-total-length").map(str::to_owned),
        authorization: header(request, "authorization").map(str::to_owned),
    }
}

/// Parse a `bytes=A-B` / `bytes=A-` range against a body length → inclusive
/// `(start, end)`. `None` for unsatisfiable/malformed ranges.
fn parse_range(range: &str, len: usize) -> Option<(usize, usize)> {
    let spec = range.strip_prefix("bytes=")?;
    let (a, b) = spec.split_once('-')?;
    let start: usize = a.parse().ok()?;
    if start >= len {
        return None;
    }
    let end = if b.is_empty() {
        len - 1
    } else {
        b.parse::<usize>().ok()?.min(len - 1)
    };
    if end < start {
        return None;
    }
    Some((start, end))
}

/// Assemble a Nextcloud chunk v2 `.file` source: the upload dir's zero-padded
/// integer chunks concatenated in name order (what real Nextcloud does at MOVE
/// time). `None` when the dir holds no chunks.
fn assemble_chunks(files: &BTreeMap<String, FakeFile>, dot_file: &str) -> Option<Vec<u8>> {
    let dir = dot_file.strip_suffix("/.file")?;
    let prefix = format!("{dir}/");
    let mut chunks: Vec<&String> = files
        .keys()
        .filter(|p| {
            p.starts_with(&prefix)
                && p[prefix.len()..]
                    .bytes()
                    .all(|b| b.is_ascii_digit())
        })
        .collect();
    if chunks.is_empty() {
        return None;
    }
    chunks.sort();
    let mut body = Vec::new();
    for chunk in chunks {
        body.extend_from_slice(&files[chunk].body);
    }
    Some(body)
}

impl Respond for FakeDav {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        let method = request.method.as_str();
        let path = request.url.path().to_string();
        let mut st = self.state.lock().unwrap();
        st.journal.push(journal(request, &path));
        // Auth gate (post-07-03 fix): behave like a real authenticated DAV
        // server — every request must carry the configured Basic credentials.
        // Any bare raw-agent request dies here with 401 instead of silently
        // succeeding, which is exactly the regression this guards.
        if header(request, "authorization") != Some(EXPECTED_BASIC_AUTH) {
            return ResponseTemplate::new(401);
        }
        match method {
            "PROPFIND" => {
                let norm = path.trim_end_matches('/').to_string();
                // Exact file → depth-0 single entry.
                if let Some(file) = st.files.get(&norm) {
                    let entries = vec![FakeEntry {
                        href: norm.clone(),
                        is_collection: false,
                        len: file.body.len(),
                        etag: Some(file.etag.clone()),
                    }];
                    return ResponseTemplate::new(207)
                        .insert_header("content-type", "application/xml")
                        .set_body_string(multistatus(&entries));
                }
                // Collection → itself + immediate children.
                let prefix = format!("{norm}/");
                let mut entries = vec![FakeEntry {
                    href: prefix.clone(),
                    is_collection: true,
                    len: 0,
                    etag: None,
                }];
                let mut found = false;
                for (file_path, file) in &st.files {
                    if let Some(rest) = file_path.strip_prefix(&prefix) {
                        if !rest.contains('/') {
                            found = true;
                            entries.push(FakeEntry {
                                href: file_path.clone(),
                                is_collection: false,
                                len: file.body.len(),
                                etag: Some(file.etag.clone()),
                            });
                        }
                    }
                }
                if !found && norm != "/" && !st.files.keys().any(|p| p.starts_with(&prefix)) {
                    return ResponseTemplate::new(404);
                }
                ResponseTemplate::new(207)
                    .insert_header("content-type", "application/xml")
                    .set_body_string(multistatus(&entries))
            }
            "GET" => match st.files.get(&path) {
                Some(file) => {
                    // 07-03: honor Range like a real DAV server (206 + Content-Range).
                    if let Some(range) = header(request, "range") {
                        return match parse_range(range, file.body.len()) {
                            Some((start, end)) => ResponseTemplate::new(206)
                                .insert_header("etag", file.etag.as_str())
                                .insert_header("accept-ranges", "bytes")
                                .insert_header(
                                    "content-range",
                                    format!("bytes {start}-{end}/{}", file.body.len()),
                                )
                                .set_body_bytes(file.body[start..=end].to_vec()),
                            None => ResponseTemplate::new(416),
                        };
                    }
                    ResponseTemplate::new(200)
                        .insert_header("etag", file.etag.as_str())
                        .set_body_bytes(file.body.clone())
                }
                None => ResponseTemplate::new(404),
            },
            "PUT" => {
                if header(request, "if-none-match") == Some("*") && st.files.contains_key(&path) {
                    return ResponseTemplate::new(412);
                }
                if path.contains(".tmp-") {
                    let final_name = path.split(".tmp-").next().unwrap_or(&path).to_string();
                    let absent = !st.files.contains_key(&final_name);
                    st.final_absent_at_tmp_put.push(absent);
                }
                let etag = st.next_etag();
                st.files.insert(
                    path.clone(),
                    FakeFile {
                        body: request.body.clone(),
                        etag: etag.clone(),
                    },
                );
                ResponseTemplate::new(201).insert_header("etag", etag)
            }
            "MOVE" => {
                let Some(destination) = header(request, "destination").map(str::to_owned) else {
                    return ResponseTemplate::new(400);
                };
                let dest_path = reqwest::Url::parse(&destination)
                    .map(|u| u.path().to_string())
                    .unwrap_or(destination);
                // 07-03: a Nextcloud chunk v2 assembly — MOVE of `<dir>/.file`
                // synthesizes the source from the dir's stored chunks (the
                // .file itself is virtual on Nextcloud, never a real object).
                let source_body = if let Some(file) = st.files.get(&path) {
                    file.body.clone()
                } else if path.ends_with("/.file") {
                    match assemble_chunks(&st.files, &path) {
                        Some(body) => body,
                        None => return ResponseTemplate::new(404),
                    }
                } else {
                    return ResponseTemplate::new(404);
                };
                // Conditional headers apply to the DESTINATION.
                if header(request, "if-none-match") == Some("*") && st.files.contains_key(&dest_path)
                {
                    return ResponseTemplate::new(412);
                }
                if let Some(expected) = header(request, "if-match") {
                    let matches = st
                        .files
                        .get(&dest_path)
                        .is_some_and(|f| f.etag == expected);
                    if !matches {
                        return ResponseTemplate::new(412);
                    }
                }
                st.files.remove(&path);
                let etag = st.next_etag();
                st.files.insert(
                    dest_path,
                    FakeFile {
                        body: source_body,
                        etag: etag.clone(),
                    },
                );
                ResponseTemplate::new(201).insert_header("etag", etag)
            }
            "MKCOL" => ResponseTemplate::new(201),
            _ => ResponseTemplate::new(405),
        }
    }
}

/// Start a wiremock server with the stateful fake mounted as a catch-all.
pub async fn start_dav() -> (MockServer, FakeDav) {
    let server = MockServer::start().await;
    let fake = FakeDav::default();
    Mock::given(any())
        .respond_with(fake.clone())
        .mount(&server)
        .await;
    (server, fake)
}
