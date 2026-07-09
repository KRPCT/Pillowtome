---
phase: 01-foundation-cross-platform-skeleton
plan: 03
subsystem: core-seams-schema
tags: [publication, locator, book-source, sqlite, tauri-plugin-sql, schema-v1, change-log, serde, tdd, decision-records]

# Dependency graph
requires:
  - phase: 01-01
    provides: declared core seam stubs (publication/locator/source) + wired empty sql migration set + pinned uuid/blake3/serde
  - phase: 01-02
    provides: core::error::CoreError (reused, not redefined) + protection detector
provides:
  - "core::publication::{Publication trait (format/content_hash), Format enum (Epub), EpubPublication marker impl (blake3)}"
  - "core::locator::{Locator (work_id/cfi/progress_fraction/text_context), TextContext (pre/exact/post)} — composite self-healing, never a bare percentage (D-08)"
  - "core::source::BookSource { Path(PathBuf), ContentUri(String) } — opaque storage-handle, no raw path in core APIs (D-05)"
  - "pillowtome::migrations::{SCHEMA_V1, migrations()} — schema v1 seed_stub_schema: work/locator/change_log (D-09)"
  - "src-tauri/tests/migration.rs — off-device schema-v1 smoke test (single SQLite binding)"
  - "docs/decisions/DEC-001 (license clean-room), DEC-002 (WebView engine), DEC-003 (DRM policy)"
affects: [01-04 (reading slice binds Locator + serves via schema), 01-05 (BookSource SAF wiring), 05 (annotations use Locator + change_log), 07 (sync reconciles change_log)]

# Tech tracking
tech-stack:
  added: []
  patterns: [format-agnostic Publication seam (EPUB-only impl), composite self-healing Locator (never bare %), opaque storage-handle, versioned-forward schema (v1 present-but-unsynced), single SQLite binding via tauri-plugin-sql]

key-files:
  created: [src-tauri/tests/migration.rs, docs/decisions/DEC-001-license-cleanroom.md, docs/decisions/DEC-002-webview-engine.md, docs/decisions/DEC-003-drm-policy.md]
  modified: [core/src/publication/mod.rs, core/src/locator.rs, core/src/source.rs, core/Cargo.toml, src-tauri/src/migrations.rs, src-tauri/Cargo.toml, Cargo.lock]

key-decisions:
  - "EpubPublication is a minimal marker carrying a precomputed blake3 hash; no EPUB metadata/cover/TOC parsing (deferred to Phase 4) — keeps the seam minimal, the anti-refactor game"
  - "Format serializes as lowercase (serde rename_all) so the DB/IPC discriminant is 'epub', matching the schema's format TEXT column"
  - "Migration smoke test uses the SAME sqlx (=0.8.6) tauri-plugin-sql resolves, added as a dev-dependency only — single libsqlite3-sys 0.30.1, zero rusqlite (Pitfall 6)"
  - "SCHEMA_V1 is a const and is the migration's sql verbatim — one source of truth, asserted by the test (m.sql == SCHEMA_V1)"

requirements-completed: []  # FND-03's storage-handle MODEL (BookSource) lands here, but the requirement (device import + Android SAF persisted grant) completes in Plan 01-05 — left Pending intentionally. FND-01 needs the Plan 04 reading slice.

# Metrics
duration: 7min
completed: 2026-07-09
---

# Phase 1 Plan 03: Day-1 Seams + Identity/Change-Log Schema v1 + Decision Records Summary

**The three day-1 architectural seams (format-agnostic `Publication` trait with an EPUB-only impl, composite self-healing `Locator`, opaque `BookSource` storage-handle) landed as serde-serializable stubs, plus a versioned schema-v1 SQLite migration (identity `work` + composite `locator` + per-device append-only `change_log` with a logical clock) verified off-device, and the three key decision records — so annotations (P5) and WebDAV sync (P7) are additive, not a late refactor.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-07-09T22:46Z (first commit)
- **Completed:** 2026-07-09T22:53Z
- **Tasks:** 3 (Tasks 1 & 2 TDD RED→GREEN; Task 3 docs)
- **Files:** 4 created, 7 modified

## Accomplishments

- **The three day-1 seams (D-05/07/08):** `Publication` trait exposes exactly the two methods every format must answer — `format() -> Format` and `content_hash() -> String` (blake3 hex) — with a minimal `EpubPublication` marker as the only P1 implementor. `Locator` is composite and self-healing — `{ work_id: Uuid, cfi: Option<String>, progress_fraction: f64, text_context: TextContext{pre,exact,post} }` — with `progress_fraction` **always present** so a position survives re-pagination and travels across devices (never a bare percentage). `BookSource { Path(PathBuf), ContentUri(String) }` is the only book-access handle; a doc comment locks in that raw paths must never appear in core/DB APIs.
- **serde round-trip proven:** every seam type derives `Serialize`/`Deserialize`; unit tests assert a `Locator` round-trips (and `cfi` is optional while `progress_fraction` is not) and that a `BookSource::ContentUri` serializes as a `content://` URI **without exposing a filesystem path** (D-05).
- **Identity + change-log schema v1 (D-09):** `SCHEMA_V1` creates `work` (UUID `work_id` + blake3 `content_hash` + `format` + `created_at`), `locator` (composite self-healing columns per D-08), and `change_log` (per-device append-only with a monotonic `logical_clock`, so P7 merges instead of last-write-wins). `migrations()` returns a single `version: 1` `seed_stub_schema` `Up` migration wired onto the existing `tauri-plugin-sql` builder.
- **Off-device migration smoke test:** `src-tauri/tests/migration.rs` opens `sqlite::memory:`, applies `SCHEMA_V1`, and asserts the three tables and their key D-09 columns exist, plus that the migration set is a single v1 whose SQL *is* `SCHEMA_V1` — verifying "DB migrates to schema v1" without booting the app or a device.
- **Single SQLite binding preserved (Pitfall 6):** the test's `sqlx` dev-dependency is pinned to the exact `=0.8.6` the plugin resolves; `cargo tree -p pillowtome` shows one `libsqlite3-sys v0.30.1` and **zero** `rusqlite`.
- **Three decision records (Success Criterion 5):** DEC-001 (license clean-room), DEC-002 (WebView-engine strategy), DEC-003 (DRM policy) written as durable ADR-style records.
- **CoreError reused, not redefined:** the plan honored the 01-02 boundary — `core/src/error.rs` was not touched.

## Task Commits

Each task committed atomically (SSH-signed, all `G`/Verified as SakuraRed):

1. **Task 1 (RED): failing serde round-trip tests for the seams** — `4be7f74` (test)
2. **Task 1 (GREEN): Publication/Locator/BookSource seam types** — `95e12f6` (feat)
3. **Task 2 (RED): failing schema-v1 migration smoke test** — `2d32c3f` (test)
4. **Task 2 (GREEN): identity + change-log schema v1** — `6fa7193` (feat)
5. **Task 3: DEC-001/002/003 decision records** — `8e43027` (docs)

## Files Created/Modified

- `core/src/publication/mod.rs` — `Format { Epub }` (serde lowercase), `Publication` trait (`format`/`content_hash`), `EpubPublication` blake3 marker + 2 unit tests.
- `core/src/locator.rs` — `Locator` + `TextContext` composite types (D-08) + 2 round-trip unit tests.
- `core/src/source.rs` — `BookSource { Path, ContentUri }` opaque handle (D-05) + 2 unit tests.
- `core/Cargo.toml` — enabled `uuid`'s `serde` feature; added `serde_json` dev-dep (test-only).
- `src-tauri/src/migrations.rs` — real `SCHEMA_V1` DDL + `migrations()` (single v1 `seed_stub_schema`).
- `src-tauri/tests/migration.rs` — 3 off-device smoke tests (tables, D-09 columns, migration-set shape).
- `src-tauri/Cargo.toml` — `sqlx =0.8.6` + `tokio =1.52.3` dev-deps (test-only, single binding).
- `Cargo.lock` — wired serde_json into core (no new packages resolved).
- `docs/decisions/DEC-001-license-cleanroom.md`, `DEC-002-webview-engine.md`, `DEC-003-drm-policy.md`.

## Decisions Made

- **Minimal EPUB marker, not a parser:** `EpubPublication` carries a precomputed blake3 hash and answers `format()`/`content_hash()` only. Real EPUB metadata/cover/TOC extraction is deferred to Phase 4 (D-07) — keeping the seam minimal is the whole anti-refactor point.
- **`Format` serializes lowercase:** `#[serde(rename_all = "lowercase")]` makes the IPC/DB discriminant `"epub"`, matching the schema's `format TEXT` column.
- **Test-only sqlx/tokio dev-deps, pinned to the plugin's binding:** the migration smoke test reuses the exact `sqlx =0.8.6` (and `tokio =1.52.3`, both already in the workspace lock) so no second SQLite binding is linked.
- **One source of truth for the schema:** `SCHEMA_V1` is a `const` executed verbatim by `migrations()`; the test asserts `m.sql == SCHEMA_V1` so schema can never drift out of the migration set.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `uuid` lacked the `serde` feature, blocking `Locator` derive**
- **Found during:** Task 1 (GREEN build)
- **Issue:** `Locator.work_id: uuid::Uuid` could not `#[derive(Serialize, Deserialize)]` — `Uuid` does not implement serde without its `serde` feature (E0277).
- **Fix:** enabled the feature on the existing pin: `uuid = { version = "=1.23.4", features = ["v4", "serde"] }` (a feature flag on an already-pinned crate — not a new package; no new `Cargo.lock` entries).
- **Files modified:** `core/Cargo.toml`
- **Verification:** `cargo test -p pillowtome-core` → 10/10 green.
- **Committed in:** `95e12f6`

**2. [Rule 3 - Blocking] test needed serde_json, absent from core deps**
- **Found during:** Task 1 (RED)
- **Issue:** the round-trip unit tests use `serde_json`, which core did not depend on.
- **Fix:** added `serde_json = "=1.0.150"` to `core`'s `[dev-dependencies]` (test-only; same version already resolved in the workspace lock).
- **Files modified:** `core/Cargo.toml`
- **Committed in:** `95e12f6`

### Structural note (not a plan deviation)

- **Crate lib name is `pillowtome_lib`, not `pillowtome`:** the plan's illustrative paths said `pillowtome::migrations::…`, but the `[lib] name = "pillowtome_lib"` (set in 01-01 for the Windows bin/lib name clash). The migration test therefore imports `pillowtome_lib::migrations::{migrations, SCHEMA_V1}`, matching the existing `protocol_range.rs` test. `cargo test -p pillowtome --test migration` is unchanged (package name is still `pillowtome`).

**Total deviations:** 2 blocking (both feature/dev-dep wiring for existing crates), plus the crate-name structural note. No scope creep — no parsing, no sync, no annotations, no extra formats were built; every seam is a stub + EPUB-only impl + schema v1 exactly as specified.

## Build/Environment Notes

- Built and tested through the **MSVC toolchain** per the Wave-1 env defect (host GNU `gcc.exe` silently fails): `vcvars64.bat` + `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc`. No `rust-toolchain.toml` committed (would break Linux/macOS contributors). `core` stays portable with zero platform deps; Android cross-compiles use NDK clang and are unaffected.

## Verification Evidence

- **Task 1 RED (`4be7f74`):** `cargo test -p pillowtome-core` → `error[E0425]/E0422/E0433` (types + serde_json unresolved) — genuine failing state against the stubs.
- **Task 1 GREEN (`95e12f6`):** `cargo test -p pillowtome-core` → 10/10 (4 protection + 2 locator + 2 source + 2 publication); `cargo build --workspace` exit 0.
- **Task 2 RED (`2d32c3f`):** `cargo test -p pillowtome --test migration` → 3 tests FAIL (0 tables, migration len 0 ≠ 1) — the test compiles (sqlx binding works) but fails against the empty schema.
- **Task 2 GREEN (`6fa7193`):** `cargo test -p pillowtome --test migration` → 3/3 pass; `cargo tree -p pillowtome` → single `libsqlite3-sys v0.30.1`, single `sqlx v0.8.6`, zero `rusqlite` (Pitfall 6).
- **Full suite:** `cargo test --workspace` → 25/25 green — pillowtome_lib 2, migration 3, protocol_range 4 (01-01 intact), pillowtome_core 10, protection 6 (01-02's 10 protection tests intact, no regression).
- **Task 3 (`8e43027`):** all three `DEC-*.md` exist; greps for `foliate-js` / `system webview` / `detect-and-refuse` pass.

## TDD Gate Compliance

- **Task 1** — RED gate `4be7f74` (`test(01-03): …`, unresolved types) → GREEN gate `95e12f6` (`feat(01-03): …`, all pass). No refactor needed.
- **Task 2** — RED gate `2d32c3f` (`test(01-03): …`, assertions fail on empty schema) → GREEN gate `6fa7193` (`feat(01-03): …`, all pass). No refactor needed.

## Threat Model Coverage

| Threat ID | Disposition | Mitigation delivered |
|-----------|-------------|----------------------|
| T-01-06 | mitigate | Schema v1 ships stable UUID `work_id` + `content_hash` + monotonic per-device `logical_clock` on an append-only `change_log`, so future sync reconciles (not rewrites) — verified by the migration smoke test. |
| T-01-07 | accept | Single SQLite binding via `tauri-plugin-sql` only; the test's sqlx dev-dep is pinned to the same `=0.8.6` (one `libsqlite3-sys 0.30.1`, no rusqlite / second sqlx). |
| T-01-08 | mitigate | `BookSource` is the only book-access type in core; a unit test asserts `ContentUri` serializes without a filesystem path, keeping Android scoped-storage semantics intact (D-05). |

## Known Stubs

Intentional, plan-scoped — these seams are deliberately minimal per D-07/08/09 so P5/P6/P7 are additive:

- `EpubPublication` carries a content hash only; **no** EPUB metadata/cover/TOC parsing (Phase 4). The `Publication` trait intentionally exposes just `format()`/`content_hash()`.
- `Format` has only the `Epub` variant; `Txt`/`Mobi`/`Pdf` are reserved for Phase 6.
- `change_log` and the composite `locator` columns are **present-but-unsynced** in P1; annotations populate them in Phase 5 and WebDAV sync reconciles the `change_log` in Phase 7.

None of these block this plan's goal (seams + schema v1 + decisions locked before any feature binds to them).

## Next Phase Readiness

- The three day-1 seams and schema v1 exist as a durable contract; Plans 01-04 (reading slice binds `Locator`, persists via schema) and 01-05 (`BookSource` SAF wiring) are unblocked.
- **FND-03** (import via storage-handle, not raw paths) is satisfied at the model layer — `BookSource` is the opaque handle; the SAF persisted-grant *wiring* is Plan 01-05's job.
- **Build note for verifier/future waves:** use the MSVC toolchain + vcvars for desktop builds (broken host GNU gcc); Android uses NDK clang.

## Self-Check: PASSED

All claimed files exist on disk; all five task commits (`4be7f74`, `95e12f6`, `2d32c3f`, `6fa7193`, `8e43027`) are present in git history and signature-valid (`G`).

---
*Phase: 01-foundation-cross-platform-skeleton*
*Completed: 2026-07-09*
