//! Off-device migration smoke test for schema v1 (D-09).
//!
//! Proves "the DB migrates to schema v1" without booting the app or a device:
//! open an in-memory SQLite, apply [`SCHEMA_V1`], and assert the identity /
//! composite-locator / change-log tables and their key D-09 columns exist. Uses
//! the SAME sqlx binding tauri-plugin-sql resolves (single SQLite binding,
//! Pitfall 6), so this also guards against a second `libsqlite3-sys` sneaking in.

use pillowtome_lib::migrations::{migrations, SCHEMA_V1};
use sqlx::{Connection, Row, SqliteConnection};

async fn fresh_db() -> SqliteConnection {
    let mut conn = SqliteConnection::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    sqlx::raw_sql(SCHEMA_V1)
        .execute(&mut conn)
        .await
        .expect("apply SCHEMA_V1");
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

#[tokio::test]
async fn schema_v1_creates_identity_locator_and_change_log_tables() {
    let mut conn = fresh_db().await;
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
    let mut conn = fresh_db().await;
    // Stable identity: work_id (UUID) + content_hash (blake3).
    assert!(has_column(&mut conn, "work", "content_hash").await);
    // Composite self-healing locator: progress_fraction always present (D-08).
    assert!(has_column(&mut conn, "locator", "progress_fraction").await);
    // Per-device append-only change-log with a monotonic logical clock (D-09).
    assert!(has_column(&mut conn, "change_log", "logical_clock").await);
    assert!(has_column(&mut conn, "change_log", "device_id").await);
}

#[test]
fn migration_set_is_a_single_v1_up() {
    let set = migrations();
    assert_eq!(set.len(), 1, "exactly one migration in P1");
    let m = &set[0];
    assert_eq!(m.version, 1);
    assert_eq!(m.description, "seed_stub_schema");
    // Schema is defined once, in the migration — the change_log is its heart.
    assert!(m.sql.contains("change_log"));
    assert_eq!(m.sql, SCHEMA_V1, "the migration's SQL is SCHEMA_V1 (one source of truth)");
}
