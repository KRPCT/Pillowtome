---
phase: 05-annotations-composite-locator
plan: 01
subsystem: database
tags: [sqlite, migrations, annotations, change-log, sync, webcrypto, sha256, tauri-plugin-sql]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: SCHEMA_V1 change_log ledger (UUID + per-device monotonic logical clock, D-09) + work identity
  - phase: 02
    provides: locator-store.ts soft-fail + parameterized-bind pattern reused wholesale
provides:
  - SCHEMA_V7 migration — annotation + sync_meta tables (append-only, version 7)
  - annotation-store.ts — CRUD + tombstone + change_log ledger append + content_hash
  - change_log payload contract for P7 sync (hash_algo-tagged per record)
affects: [05-02-anchor-resolver, 07-sync, annotations-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "change_log first TS writer: monotonic per-device clock computed inside a single atomic INSERT (no cross-statement txn)"
    - "Soft-delete tombstone (deleted=1) — never physical DELETE (D-80)"
    - "WebCrypto SHA-256 content_hash, hash_algo tagged per change_log row (two-algorithm split vs work.content_hash blake3)"

key-files:
  created:
    - src/reader/annotation-store.ts
    - src/reader/annotation-store.test.ts
  modified:
    - src-tauri/src/migrations.rs
    - src-tauri/tests/migration.rs

key-decisions:
  - "content_hash uses WebCrypto SHA-256 (frontend, no IPC, no new dep) — resolves RESEARCH open-question 2; NOT blake3 like work.content_hash"
  - "logical_clock = COALESCE(MAX(logical_clock) for device)+1 computed inside the change_log INSERT; sync_meta holds device_id only, not the live clock"
  - "annotation write commits before the ledger append (user sees highlight even in a crash window)"

patterns-established:
  - "Append-only migration: SCHEMA_V7 const + version-7 registration; change_log (V1) reused unchanged"
  - "Every annotation mutation appends exactly one change_log row (op=upsert|delete)"

requirements-completed: [ANNO-01, ANNO-02, ANNO-03]

# Metrics
duration: 12min
completed: 2026-07-17
---

# Phase 5 Plan 01: Annotation Persistence + Sync-Ready Ledger Summary

**SCHEMA_V7 (annotation + sync_meta tables) plus annotation-store.ts doing CRUD, tombstone soft-delete, monotonic-clock change_log append, and a stable WebCrypto SHA-256 content_hash — the durable foundation that makes Phase 7 sync a reconcile, not a rewrite.**

## Performance

- **Duration:** ~12 min
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- SCHEMA_V7 appends `annotation` (composite self-healing columns mirroring `locator`) + `sync_meta`, registered at version 7; V1 `change_log` reused unchanged as the sync ledger.
- `annotation-store.ts`: `upsertAnnotation` / `deleteAnnotation` / `listAnnotations` / `annotationContentHash` / `ensureDevice`, all soft-fail and `$n`-parameterized only.
- Delete is a tombstone (`deleted=1`) — never a physical DELETE (D-80); every mutation appends one `change_log` row with a strictly monotonic per-device clock (D-81).
- content_hash is deterministic and content-sensitive; `hash_algo:"sha256"` stamped into every payload for P7.

## Task Commits

1. **Task 1: SCHEMA_V7 migration — annotation + sync_meta** - `5a6371b` (feat)
2. **Task 2 (TDD RED): failing annotation-store tests** - `20ea8ae` (test)
3. **Task 2 (TDD GREEN): annotation-store implementation** - `05a370b` (feat)

## Files Created/Modified
- `src-tauri/src/migrations.rs` - Added SCHEMA_V7 const + version-7 registration; doc note updated. V1..V6 untouched.
- `src-tauri/tests/migration.rs` - `fresh_db_v7` fixture, V7 table/column/index assertions, V6-survival check, count test now v1..v7.
- `src/reader/annotation-store.ts` - CRUD + tombstone + change_log ledger + content_hash + device bootstrap.
- `src/reader/annotation-store.test.ts` - plugin-sql mock; upsert/delete/list/hash + soft-fail coverage.

## Decisions Made
- **SHA-256 over blake3 for annotation content_hash** — pure-frontend WebCrypto, no IPC, no new dependency; deliberately a two-algorithm split from `work.content_hash` (blake3), tagged `hash_algo` per record. **P7 sync MUST read hash_algo per record — do not assume one algorithm across tables.**
- **Clock lives in the change_log MAX subquery, not sync_meta.logical_clock** — the plan specifies the atomic COALESCE(MAX(...))+1 form; `sync_meta` supplies only `device_id`. `sync_meta.logical_clock` remains at its DEFAULT 0 this phase (reserved).

## Deviations from Plan

None functionally — both tasks executed as written. Two trivial formatting adjustments made during GREEN to satisfy the RED test spec (test is the contract): the delete `UPDATE annotation SET ...` was placed on one line, and the test-mock spies were given explicit `(sql, params)` signatures so `tsc --noEmit` stays clean. No scope change.

## Issues Encountered
- Initial GREEN run: one delete-path assertion failed because the SQL split `annotation`/`SET` across a newline while the test regex expected them adjacent. Reformatted the statement to one line — matches the intended shape; test green.
- `tsc` flagged the hoisted vi.fn spies as zero-arg tuples. Added explicit parameter signatures. Clean.

## Known Stubs
None — both exports are fully wired against the real schema. (UI wiring of these stores is a later 05 plan, as planned.)

## Next Phase Readiness
- 05-02 anchor-resolver can read the annotation composite columns (`text_pre/exact/post` + `progress_fraction`) — same shape as `locator` (D-77).
- P7 sync has a per-record change_log ledger with monotonic clocks and hash_algo tags ready to merge by UUID.

## Self-Check: PASSED

---
*Phase: 05-annotations-composite-locator*
*Completed: 2026-07-17*
