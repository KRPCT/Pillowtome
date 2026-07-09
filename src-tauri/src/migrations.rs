//! SQLite schema migrations — identity + change-log, schema v1 (D-09).
//!
//! One migration set drives both desktop and Android through `tauri-plugin-sql`
//! (wired in `lib.rs`); there is no second SQLite binding (Pitfall 6). Schema v1
//! ships the durable contract that later phases migrate *forward* from, never
//! rewrite:
//!
//! - `work` — stable identity: `work_id` (UUID) + `content_hash` (blake3) for
//!   dedup / KOReader-style document identity later (D-09).
//! - `locator` — the composite self-healing position (D-08): a CFI anchor, an
//!   always-present `progress_fraction`, and pre/exact/post text context.
//! - `change_log` — a per-device, append-only log with a monotonic
//!   `logical_clock`, so P7 sync merges (OR-Set / furthest-progress) instead of
//!   last-write-wins. Present-but-unsynced in P1 (D-09).

use tauri_plugin_sql::{Migration, MigrationKind};

/// Schema v1 DDL — the single source of truth for the initial schema.
///
/// Applied verbatim by [`migrations`] and asserted off-device by
/// `tests/migration.rs`. Kept as a `const` so the smoke test can execute it
/// against `sqlite::memory:` without booting the app.
pub const SCHEMA_V1: &str = r#"
CREATE TABLE work (
    work_id      TEXT    PRIMARY KEY,   -- UUID: stable library identity (D-09)
    content_hash TEXT    NOT NULL,      -- blake3 hex: dedup / doc identity
    format       TEXT    NOT NULL,      -- Format discriminant (e.g. 'epub')
    created_at   INTEGER NOT NULL       -- unix epoch (ms)
);

CREATE TABLE locator (
    work_id           TEXT    NOT NULL REFERENCES work(work_id),
    cfi               TEXT,             -- primary anchor: EPUB CFI or part+offset
    progress_fraction REAL,             -- 0..1, always meaningful (never bare %, D-08)
    text_pre          TEXT,             -- self-healing context: text before
    text_exact        TEXT,             --                       text at position
    text_post         TEXT,             --                       text after
    updated_at        INTEGER NOT NULL
);

CREATE TABLE change_log (
    id            TEXT    PRIMARY KEY,  -- UUID of this log entry
    device_id     TEXT    NOT NULL,     -- origin device (merge provenance)
    logical_clock INTEGER NOT NULL,     -- monotonic per device (merge ordering)
    entity        TEXT    NOT NULL,     -- affected entity (e.g. 'locator')
    op            TEXT    NOT NULL,      -- operation (e.g. 'upsert')
    payload       TEXT,                 -- JSON change payload
    created_at    INTEGER NOT NULL
);
"#;

/// The migration set applied to `sqlite:pillow.db` at startup.
///
/// Exactly one migration in P1: schema v1 `seed_stub_schema` (Up). Later phases
/// append higher-versioned migrations; they never rewrite v1.
pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "seed_stub_schema",
        sql: SCHEMA_V1,
        kind: MigrationKind::Up,
    }]
}
