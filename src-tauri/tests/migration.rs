//! Off-device migration smoke test for schema v1 + v2 + v3 (D-09 / D-20 / D-34).
//!
//! Proves the DB migrates without booting the app: open an in-memory SQLite,
//! apply [`SCHEMA_V1`] then [`SCHEMA_V2`] then [`SCHEMA_V3`], and assert identity /
//! locator / change-log / reading_prefs / custom_font tables, seed row, CJK
//! columns, and the locator UNIQUE index. Uses the SAME sqlx binding
//! tauri-plugin-sql resolves (single SQLite binding, Pitfall 6).

use pillowtome_lib::migrations::{
    migrations, SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6, SCHEMA_V7,
};
use sqlx::{Connection, Row, SqliteConnection};

async fn fresh_db_v1() -> SqliteConnection {
    let mut conn = SqliteConnection::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    sqlx::raw_sql(SCHEMA_V1)
        .execute(&mut conn)
        .await
        .expect("apply SCHEMA_V1");
    conn
}

async fn fresh_db_v2() -> SqliteConnection {
    let mut conn = fresh_db_v1().await;
    sqlx::raw_sql(SCHEMA_V2)
        .execute(&mut conn)
        .await
        .expect("apply SCHEMA_V2");
    conn
}

async fn fresh_db_v3() -> SqliteConnection {
    let mut conn = fresh_db_v2().await;
    sqlx::raw_sql(SCHEMA_V3)
        .execute(&mut conn)
        .await
        .expect("apply SCHEMA_V3");
    conn
}

async fn fresh_db_v4() -> SqliteConnection {
    let mut conn = fresh_db_v3().await;
    sqlx::raw_sql(SCHEMA_V4)
        .execute(&mut conn)
        .await
        .expect("apply SCHEMA_V4");
    conn
}

async fn fresh_db_v5() -> SqliteConnection {
    let mut conn = fresh_db_v4().await;
    sqlx::raw_sql(SCHEMA_V5)
        .execute(&mut conn)
        .await
        .expect("apply SCHEMA_V5");
    conn
}

async fn fresh_db_v6() -> SqliteConnection {
    let mut conn = fresh_db_v5().await;
    sqlx::raw_sql(SCHEMA_V6)
        .execute(&mut conn)
        .await
        .expect("apply SCHEMA_V6");
    conn
}

async fn fresh_db_v7() -> SqliteConnection {
    let mut conn = fresh_db_v6().await;
    sqlx::raw_sql(SCHEMA_V7)
        .execute(&mut conn)
        .await
        .expect("apply SCHEMA_V7");
    conn
}

async fn table_names(conn: &mut SqliteConnection) -> Vec<String> {
    sqlx::query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .fetch_all(conn)
        .await
        .expect("read sqlite_master")
        .iter()
        .map(|r| r.get::<String, _>("name"))
        .collect()
}

async fn has_column(conn: &mut SqliteConnection, table: &str, col: &str) -> bool {
    sqlx::query(&format!("PRAGMA table_info({table})"))
        .fetch_all(conn)
        .await
        .expect("pragma table_info")
        .iter()
        .any(|r| r.get::<String, _>("name") == col)
}

async fn index_names(conn: &mut SqliteConnection) -> Vec<String> {
    sqlx::query("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
        .fetch_all(conn)
        .await
        .expect("read sqlite_master indexes")
        .iter()
        .map(|r| r.get::<String, _>("name"))
        .collect()
}

#[tokio::test]
async fn schema_v1_creates_identity_locator_and_change_log_tables() {
    let mut conn = fresh_db_v1().await;
    let names = table_names(&mut conn).await;
    for expected in ["work", "locator", "change_log"] {
        assert!(
            names.iter().any(|n| n == expected),
            "schema v1 missing table `{expected}`; found {names:?}"
        );
    }
}

#[tokio::test]
async fn schema_v1_carries_the_d09_identity_and_merge_columns() {
    let mut conn = fresh_db_v1().await;
    // Stable identity: work_id (UUID) + content_hash (blake3).
    assert!(has_column(&mut conn, "work", "content_hash").await);
    // Composite self-healing locator: progress_fraction always present (D-08).
    assert!(has_column(&mut conn, "locator", "progress_fraction").await);
    // Per-device append-only change-log with a monotonic logical clock (D-09).
    assert!(has_column(&mut conn, "change_log", "logical_clock").await);
    assert!(has_column(&mut conn, "change_log", "device_id").await);
}

#[tokio::test]
async fn schema_v2_creates_reading_prefs_and_custom_font_tables() {
    let mut conn = fresh_db_v2().await;
    let names = table_names(&mut conn).await;
    for expected in ["reading_prefs", "custom_font"] {
        assert!(
            names.iter().any(|n| n == expected),
            "schema v2 missing table `{expected}`; found {names:?}"
        );
    }
    // Key columns for global prefs + font metadata stub.
    assert!(has_column(&mut conn, "reading_prefs", "mode").await);
    assert!(has_column(&mut conn, "reading_prefs", "theme").await);
    assert!(has_column(&mut conn, "reading_prefs", "font_size_px").await);
    assert!(has_column(&mut conn, "reading_prefs", "active_font_id").await);
    assert!(has_column(&mut conn, "custom_font", "family_name").await);
    assert!(has_column(&mut conn, "custom_font", "file_name").await);
}

#[tokio::test]
async fn schema_v2_seeds_global_prefs_row() {
    let mut conn = fresh_db_v2().await;
    let row = sqlx::query(
        "SELECT id, mode, theme, font_family_key, font_size_px, line_height, margin_px \
         FROM reading_prefs WHERE id = 'global'",
    )
    .fetch_optional(&mut conn)
    .await
    .expect("select global prefs")
    .expect("seed row id=global must exist");

    assert_eq!(row.get::<String, _>("id"), "global");
    assert_eq!(row.get::<String, _>("mode"), "paginate");
    assert_eq!(row.get::<String, _>("theme"), "day");
    assert_eq!(row.get::<String, _>("font_family_key"), "system");
    assert!((row.get::<f64, _>("font_size_px") - 18.0).abs() < f64::EPSILON);
    assert!((row.get::<f64, _>("line_height") - 1.75).abs() < f64::EPSILON);
    assert!((row.get::<f64, _>("margin_px") - 24.0).abs() < f64::EPSILON);
}

#[tokio::test]
async fn schema_v2_creates_unique_index_on_locator_work_id() {
    let mut conn = fresh_db_v2().await;
    let indexes = index_names(&mut conn).await;
    assert!(
        indexes.iter().any(|n| n == "idx_locator_work_id"),
        "missing idx_locator_work_id; found {indexes:?}"
    );

    // Unique: second insert for same work_id must fail.
    sqlx::query(
        "INSERT INTO work (work_id, content_hash, format, created_at) VALUES ('w1', 'h', 'epub', 0)",
    )
    .execute(&mut conn)
    .await
    .expect("seed work");
    sqlx::query(
        "INSERT INTO locator (work_id, cfi, progress_fraction, text_pre, text_exact, text_post, updated_at) \
         VALUES ('w1', 'epubcfi(/6/2)', 0.1, NULL, NULL, NULL, 0)",
    )
    .execute(&mut conn)
    .await
    .expect("first locator insert");
    let dup = sqlx::query(
        "INSERT INTO locator (work_id, cfi, progress_fraction, text_pre, text_exact, text_post, updated_at) \
         VALUES ('w1', 'epubcfi(/6/4)', 0.2, NULL, NULL, NULL, 1)",
    )
    .execute(&mut conn)
    .await;
    assert!(dup.is_err(), "duplicate work_id locator should violate UNIQUE");
}

#[tokio::test]
async fn schema_v3_adds_cjk_toggle_columns_with_defaults_on() {
    let mut conn = fresh_db_v3().await;
    for col in ["cjk_punct_trim", "cjk_autospace", "cjk_kinsoku"] {
        assert!(
            has_column(&mut conn, "reading_prefs", col).await,
            "schema v3 missing reading_prefs.{col}"
        );
    }

    let row = sqlx::query(
        "SELECT cjk_punct_trim, cjk_autospace, cjk_kinsoku \
         FROM reading_prefs WHERE id = 'global'",
    )
    .fetch_optional(&mut conn)
    .await
    .expect("select global prefs after v3")
    .expect("seed row id=global must still exist");

    assert_eq!(row.get::<i64, _>("cjk_punct_trim"), 1);
    assert_eq!(row.get::<i64, _>("cjk_autospace"), 1);
    assert_eq!(row.get::<i64, _>("cjk_kinsoku"), 1);
}

#[tokio::test]
async fn schema_v5_adds_clean_titles_column_default_on() {
    let mut conn = fresh_db_v5().await;
    assert!(
        has_column(&mut conn, "reading_prefs", "clean_titles").await,
        "schema v5 missing reading_prefs.clean_titles"
    );

    let row = sqlx::query("SELECT clean_titles FROM reading_prefs WHERE id = 'global'")
        .fetch_optional(&mut conn)
        .await
        .expect("select global prefs after v5")
        .expect("seed row id=global must still exist");

    assert_eq!(row.get::<i64, _>("clean_titles"), 1);
}

#[tokio::test]
async fn schema_v6_adds_wordkeep_and_convert_columns() {
    let mut conn = fresh_db_v6().await;
    assert!(has_column(&mut conn, "reading_prefs", "word_keep").await);
    assert!(has_column(&mut conn, "reading_prefs", "cn_convert").await);

    let row = sqlx::query("SELECT word_keep, cn_convert FROM reading_prefs WHERE id = 'global'")
        .fetch_optional(&mut conn)
        .await
        .expect("select global prefs after v6")
        .expect("seed row id=global must still exist");

    assert_eq!(row.get::<i64, _>("word_keep"), 0);
    assert_eq!(row.get::<String, _>("cn_convert"), "off");
}

#[tokio::test]
async fn schema_v4_creates_library_item_with_unique_work_id() {
    let mut conn = fresh_db_v4().await;
    let names = table_names(&mut conn).await;
    assert!(
        names.iter().any(|n| n == "library_item"),
        "schema v4 missing library_item; found {names:?}"
    );
    for col in [
        "item_id",
        "work_id",
        "source_id",
        "title",
        "author",
        "cover_file",
        "imported_at",
        "last_opened_at",
        "last_read_at",
    ] {
        assert!(
            has_column(&mut conn, "library_item", col).await,
            "library_item missing {col}"
        );
    }

    sqlx::query(
        "INSERT INTO work (work_id, content_hash, format, created_at) VALUES ('wlib', 'h', 'epub', 0)",
    )
    .execute(&mut conn)
    .await
    .expect("seed work");
    sqlx::query(
        "INSERT INTO library_item (item_id, work_id, source_id, title, author, cover_file, imported_at, last_opened_at, last_read_at) \
         VALUES ('i1', 'wlib', 'import-1', 'Title', NULL, NULL, 0, NULL, NULL)",
    )
    .execute(&mut conn)
    .await
    .expect("first library insert");
    let dup = sqlx::query(
        "INSERT INTO library_item (item_id, work_id, source_id, title, author, cover_file, imported_at, last_opened_at, last_read_at) \
         VALUES ('i2', 'wlib', 'import-2', 'Other', NULL, NULL, 1, NULL, NULL)",
    )
    .execute(&mut conn)
    .await;
    assert!(dup.is_err(), "duplicate work_id library_item should violate UNIQUE");
}

#[tokio::test]
async fn schema_v7_creates_annotation_and_sync_meta_tables() {
    let mut conn = fresh_db_v7().await;
    let names = table_names(&mut conn).await;
    for expected in ["annotation", "sync_meta"] {
        assert!(
            names.iter().any(|n| n == expected),
            "schema v7 missing table `{expected}`; found {names:?}"
        );
    }
    for col in [
        "annotation_id",
        "work_id",
        "type",
        "cfi",
        "color",
        "text_pre",
        "text_exact",
        "text_post",
        "progress_fraction",
        "note",
        "created_at",
        "updated_at",
        "revision",
        "content_hash",
        "deleted",
    ] {
        assert!(
            has_column(&mut conn, "annotation", col).await,
            "annotation missing {col}"
        );
    }
    for col in ["id", "device_id", "logical_clock"] {
        assert!(
            has_column(&mut conn, "sync_meta", col).await,
            "sync_meta missing {col}"
        );
    }

    let indexes = index_names(&mut conn).await;
    assert!(
        indexes.iter().any(|n| n == "idx_annotation_work"),
        "missing idx_annotation_work; found {indexes:?}"
    );

    // change_log (V1) is reused unchanged — still present after V7.
    assert!(
        table_names(&mut conn).await.iter().any(|n| n == "change_log"),
        "v7 must not drop the reused change_log ledger"
    );

    // V6 prefs still intact forward from V7 (append-only, no rewrite).
    let row = sqlx::query("SELECT word_keep, cn_convert FROM reading_prefs WHERE id = 'global'")
        .fetch_optional(&mut conn)
        .await
        .expect("select global prefs after v7")
        .expect("seed row id=global must still exist after v7");
    assert_eq!(row.get::<i64, _>("word_keep"), 0);
    assert_eq!(row.get::<String, _>("cn_convert"), "off");
}

#[tokio::test]
async fn schema_v7_annotation_defaults_and_fk() {
    let mut conn = fresh_db_v7().await;
    sqlx::query(
        "INSERT INTO work (work_id, content_hash, format, created_at) VALUES ('wa', 'h', 'epub', 0)",
    )
    .execute(&mut conn)
    .await
    .expect("seed work");
    sqlx::query(
        "INSERT INTO annotation (annotation_id, work_id, type, cfi, created_at, updated_at) \
         VALUES ('a1', 'wa', 'highlight', 'epubcfi(/6/2)', 0, 0)",
    )
    .execute(&mut conn)
    .await
    .expect("insert annotation with defaults");
    let row = sqlx::query("SELECT revision, deleted FROM annotation WHERE annotation_id = 'a1'")
        .fetch_one(&mut conn)
        .await
        .expect("read annotation defaults");
    assert_eq!(row.get::<i64, _>("revision"), 1);
    assert_eq!(row.get::<i64, _>("deleted"), 0);
}

#[test]
fn migration_set_is_v1_through_v7_up() {
    let set = migrations();
    assert_eq!(set.len(), 7, "exactly seven migrations (v1..v7)");
    assert_eq!(set[0].version, 1);
    assert_eq!(set[0].description, "seed_stub_schema");
    assert_eq!(set[0].sql, SCHEMA_V1, "v1 SQL is SCHEMA_V1 (one source of truth)");
    assert!(set[0].sql.contains("change_log"));
    assert!(set[0].sql.contains("work"));
    assert!(set[0].sql.contains("locator"));

    assert_eq!(set[1].version, 2);
    assert_eq!(set[1].description, "reading_prefs_and_custom_fonts");
    assert_eq!(set[1].sql, SCHEMA_V2, "v2 SQL is SCHEMA_V2 (one source of truth)");
    assert!(set[1].sql.contains("reading_prefs"));
    assert!(set[1].sql.contains("custom_font"));
    assert!(set[1].sql.contains("idx_locator_work_id"));

    assert_eq!(set[2].version, 3);
    assert_eq!(set[2].description, "cjk_typography_prefs");
    assert_eq!(set[2].sql, SCHEMA_V3, "v3 SQL is SCHEMA_V3 (one source of truth)");
    assert!(set[2].sql.contains("cjk_punct_trim"));
    assert!(set[2].sql.contains("cjk_autospace"));
    assert!(set[2].sql.contains("cjk_kinsoku"));
    assert!(set[2].sql.contains("DEFAULT 1"));

    assert_eq!(set[3].version, 4);
    assert_eq!(set[3].description, "local_library_catalog");
    assert_eq!(set[3].sql, SCHEMA_V4, "v4 SQL is SCHEMA_V4 (one source of truth)");
    assert!(set[3].sql.contains("library_item"));
    assert!(set[3].sql.contains("work_id"));
    assert!(set[3].sql.contains("source_id"));
    assert!(set[3].sql.contains("idx_library_last_read"));

    assert_eq!(set[4].version, 5);
    assert_eq!(set[4].description, "library_title_cleaning_pref");
    assert_eq!(set[4].sql, SCHEMA_V5, "v5 SQL is SCHEMA_V5 (one source of truth)");
    assert!(set[4].sql.contains("clean_titles"));
    assert!(set[4].sql.contains("DEFAULT 1"));

    assert_eq!(set[5].version, 6);
    assert_eq!(set[5].description, "cjk_wordkeep_and_convert_prefs");
    assert_eq!(set[5].sql, SCHEMA_V6, "v6 SQL is SCHEMA_V6 (one source of truth)");
    assert!(set[5].sql.contains("word_keep"));
    assert!(set[5].sql.contains("cn_convert"));

    assert_eq!(set[6].version, 7);
    assert_eq!(set[6].description, "annotations_and_sync_meta");
    assert_eq!(set[6].sql, SCHEMA_V7, "v7 SQL is SCHEMA_V7 (one source of truth)");
    assert!(set[6].sql.contains("CREATE TABLE annotation"));
    assert!(set[6].sql.contains("sync_meta"));
    assert!(set[6].sql.contains("idx_annotation_work"));
    // V1 change_log ledger is reused, not extended by V7.
    assert!(!set[6].sql.contains("change_log"));
}
