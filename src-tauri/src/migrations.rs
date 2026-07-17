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

/// Schema v2 DDL — reading prefs, custom fonts metadata, locator uniqueness.
///
/// Append-only: never rewrite [`SCHEMA_V1`]. Global prefs are a single-row table
/// (`id = 'global'`, D-20/D-21). `custom_font` is metadata-only for 02-04 import.
/// `idx_locator_work_id` enables one progress row per work for P2 upsert (D-23).
pub const SCHEMA_V2: &str = r#"
CREATE TABLE reading_prefs (
    id              TEXT    PRIMARY KEY,   -- 'global' (D-20/D-21)
    mode            TEXT    NOT NULL,      -- paginate | scroll
    theme           TEXT    NOT NULL,      -- day | night | sepia
    font_family_key TEXT    NOT NULL,      -- system | custom id
    font_size_px    REAL    NOT NULL,
    line_height     REAL    NOT NULL,
    margin_px       REAL    NOT NULL,
    active_font_id  TEXT,                  -- nullable → custom_font.id
    updated_at      INTEGER NOT NULL
);

CREATE TABLE custom_font (
    id          TEXT    PRIMARY KEY,
    family_name TEXT    NOT NULL,
    file_name   TEXT    NOT NULL,          -- relative under app_data/fonts/
    byte_size   INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
);

-- One progress locator per work for P2 upsert (annotations use separate tables in P5).
CREATE UNIQUE INDEX IF NOT EXISTS idx_locator_work_id ON locator(work_id);

-- Seed global defaults: paginate / day / system / 18px / 1.75 / 24px (D-22 / UI-SPEC).
INSERT INTO reading_prefs (
    id, mode, theme, font_family_key, font_size_px, line_height, margin_px, active_font_id, updated_at
) VALUES (
    'global', 'paginate', 'day', 'system', 18, 1.75, 24, NULL, 0
);
"#;

/// Schema v3 DDL — global CJK typography toggles on reading_prefs (D-34).
///
/// Append-only: never rewrite [`SCHEMA_V1`] / [`SCHEMA_V2`]. Existing `global`
/// seed row gets DEFAULT 1 for each column (标点挤压 / 盘古之白 / 禁则 ON).
pub const SCHEMA_V3: &str = r#"
ALTER TABLE reading_prefs ADD COLUMN cjk_punct_trim INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reading_prefs ADD COLUMN cjk_autospace INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reading_prefs ADD COLUMN cjk_kinsoku INTEGER NOT NULL DEFAULT 1;
"#;

/// Schema v4 DDL — local library catalog (LIB-01..04, D-51/D-54/D-65).
///
/// Append-only: never rewrite prior schemas. One shelf row per `work_id`
/// (content identity); `source_id` is the SourceRegistry / import handle id.
pub const SCHEMA_V4: &str = r#"
CREATE TABLE library_item (
    item_id        TEXT    PRIMARY KEY,
    work_id        TEXT    NOT NULL UNIQUE REFERENCES work(work_id),
    source_id      TEXT    NOT NULL,
    title          TEXT    NOT NULL,
    author         TEXT,
    cover_file     TEXT,
    imported_at    INTEGER NOT NULL,
    last_opened_at INTEGER,
    last_read_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_library_last_read ON library_item(last_read_at DESC);
CREATE INDEX IF NOT EXISTS idx_library_title ON library_item(title);
"#;

/// Schema v5 DDL — library title cleaning toggle on reading_prefs.
///
/// Append-only: never rewrite prior schemas. Existing `global` seed row gets
/// DEFAULT 1 (strip source-site tail from shelf titles ON). Display-only pref;
/// stored raw titles are never mutated.
pub const SCHEMA_V5: &str = r#"
ALTER TABLE reading_prefs ADD COLUMN clean_titles INTEGER NOT NULL DEFAULT 1;
"#;

/// Schema v6 DDL — reader CJK processing toggles on reading_prefs.
///
/// Append-only. `word_keep` = keep CJK words unbroken across line/page (0/1,
/// default off); `cn_convert` = display Simplified↔Traditional ('off'|'s2t'|'t2s',
/// default off). Both display-only; stored book text is never mutated.
pub const SCHEMA_V6: &str = r#"
ALTER TABLE reading_prefs ADD COLUMN word_keep INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reading_prefs ADD COLUMN cn_convert TEXT NOT NULL DEFAULT 'off';
"#;

/// The migration set applied to `sqlite:pillow.db` at startup.
///
/// Schema v1 seeds identity tables; schema v2 appends prefs/fonts + locator unique
/// index; schema v3 appends CJK toggle columns; schema v4 adds library catalog;
/// schema v5 adds the title-cleaning toggle; schema v6 adds the CJK word-keep +
/// simp/trad conversion toggles. Later phases append higher versions; they never
/// rewrite prior schemas.
pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "seed_stub_schema",
            sql: SCHEMA_V1,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "reading_prefs_and_custom_fonts",
            sql: SCHEMA_V2,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "cjk_typography_prefs",
            sql: SCHEMA_V3,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "local_library_catalog",
            sql: SCHEMA_V4,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "library_title_cleaning_pref",
            sql: SCHEMA_V5,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "cjk_wordkeep_and_convert_prefs",
            sql: SCHEMA_V6,
            kind: MigrationKind::Up,
        },
    ]
}
