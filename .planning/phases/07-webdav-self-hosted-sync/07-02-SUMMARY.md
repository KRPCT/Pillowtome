---
phase: 07-webdav-self-hosted-sync
plan: 02
subsystem: sync
tags: [webdav, sync, reconcile, state-plane, tmp-move, if-match, etag, merge, d-92, undo, ipc, sqlx, wiremock, serde-json, uuid, foreign-keys]

# Dependency graph
requires:
  - phase: 07-webdav-self-hosted-sync/07-00
    provides: core merge engine (`merge_{progress,annotation,library}_map`, `MergeOutcome.replaced_local`), remote serde model (`DeviceStateFile::validate()`), path jail (`state_file_path`/`state_tmp_file_path`/`device_file_path`), SCHEMA_V8 sync tables
  - phase: 07-webdav-self-hosted-sync/07-01
    provides: transport (`build_client`/`classify`/`with_rate_limit_retry`, D-95 gates), keychain (`credentials::get_password`), `SyncError` taxonomy incl. `RemoteChanged` (412 seam), `db_pool` plugin-pool pattern, part-1 IPC commands
provides:
  - src-tauri/src/sync/reconcile.rs — the whole state plane: `build_device_state` (SQLite → DeviceStateFile), conditional atomic push (`push_state_file` tmp PUT → If-None-Match/If-Match MOVE → post-MOVE ETag PROPFIND), `reconcile_push` (one-shot 412 re-pull-merge-retry, sync_state persistence), `pull_state_files` (PROPFIND ETag map → GET changed → V5 validate → merge via 07-00 map drivers → SQLite), `upsert_device_record`, peer-ETag cache (`sync_state.id='peer:<device_id>'`), `sync_file_state` download-DISCOVERY rows for 07-03
  - IPC part 2: `sync_book_opened` / `sync_book_closed` / `sync_revert_jump` / `sync_now` / `sync_status` + unified `"sync-status"` event (SOLE emitter `emit_sync_status`; 07-03's only progress channel `report_transfer_progress`)
  - Managed session state: `SyncUndoMap` (D-92), `SyncProgressMaps`/`TransferMaps` (engine-owned percent maps), `SyncEngineState` (in-memory re-entry guard); crash-orphan `syncing=0` reset at first pool resolution
  - tests: tests/sync_reconcile.rs (14) + tests/sync_e2e.rs (5) + shared harness tests/common/mod.rs (in-memory pool + stateful wiremock DAV fake)
affects: [07-03-file-plane, 07-04-conflict-scheduler-ui]

# Tech tracking
tech-stack:
  added:
    - "Dep EDGES only, zero new packages (D-13; Cargo.lock diff = 1 line): serde_json =1.0.150 promoted dev→runtime (DeviceStateFile (de)serialization lives in src-tauri — core keeps zero serde_json runtime dep), uuid =1.23.4 +v4 (tmp publish names, 冲突副本 copy ids, placeholder item_ids, change_log ids)"
  patterns:
    - "Pull merge application = per-device SQLite transaction; per-entry write failure (orphaned locator/annotation whose work never arrived) downgrades to a Chinese warning, never aborts the pull"
    - "Apply order inside the merge tx is LIBRARY → ANNOTATIONS → PROGRESS (FK discipline): locator/annotation carry REFERENCES work(work_id) and the plugin pool enforces foreign_keys=ON — remote-only works must exist as placeholders first"
    - "Undo stash commits only AFTER the merge tx lands, only for ORIGINAL local rows (initial DB snapshot), once per work — remote-origin rows displaced by a later peer fold are never undoable"
    - "Peer-ETag cache rows `sync_state.id='peer:<device_id>'` (id + remote_etag only); unchanged peers cost zero GETs (wiremock journal-proven)"
    - "All part-2 payloads camelCase serde, password-free by construction; ALL keychain reads stay in commands.rs — reconcile.rs is credential-free (grep-verified)"
    - "A4 runtime probe: lib.rs spawns `sync::probe_shared_pool` (~2min retry window) and logs `[sync] shared pool acquired` from lib.rs (keeps sync/ println-free)"

key-files:
  created:
    - src-tauri/src/sync/reconcile.rs
    - src-tauri/tests/sync_reconcile.rs
    - src-tauri/tests/sync_e2e.rs
    - src-tauri/tests/common/mod.rs
    - .planning/phases/07-webdav-self-hosted-sync/07-02-SUMMARY.md
  modified:
    - src-tauri/src/sync/mod.rs
    - src-tauri/src/sync/commands.rs
    - src-tauri/src/sync/transport.rs
    - src-tauri/src/lib.rs
    - src-tauri/Cargo.toml
    - Cargo.lock

key-decisions:
  - "FK-safe merge apply order (library first) — discovered by a failing test, not by reading: a remote-only work's locator FK-failed before its placeholder existed; plugin sets PRAGMA foreign_keys=ON (verified in vendored tauri-plugin-sql 2.4.0 wrapper.rs)"
  - "SyncError::Soft(&'static str) variant added for pre-localized soft failures (数据库尚未就绪 when the pool is not up yet) — additive; the locked 07-01 taxonomy untouched; part-2 commands map pool-absence to benign defaults (开书拉 quiet / status unconfigured)"
  - "reconcile_push takes the session UndoMap (plan sketched pool/client/cfg only) so the 412-recovery pull stashes jumps into the same session store"
  - "Part-2 'configured' = sync_config row presence (sync_get_config keeps 07-01's keychain-verified is_configured): the event fires on every transfer tick and must never hit the OS keychain per emission"
  - "Discovery rows are diff-scoped (only merged-in/changed library recs re-run the UPSERT) and ON CONFLICT advances ONLY size/hash/remote_path/updated_at — an in-flight download's transfer_uuid/chunks_done is never clobbered (test-proven)"

patterns-established:
  - "Conditional writes always via client.agent (Pitfall 2): tmp PUT → MOVE with Destination + Overwrite: T + If-None-Match: * (first) / If-Match: <verbatim stored etag> (after); 412 → SyncError::RemoteChanged → pull once → rebuild → retry ONCE against the own-file ETag seen in that pull's PROPFIND"
  - "V5 untrusted-input gauntlet on pull: 16 MiB streamed body cap (content-length pre-check + chunk-bounded read) → serde_json::from_slice → DeviceStateFile::validate() → filename↔payload device_id equality — any failure skips that device with a Chinese warning"
  - "Ledger hygiene by construction: ZERO `INSERT INTO change_log` in reconcile.rs (grep gate); the only sync-plane ledger write is the LOCAL D-92 revert row (COALESCE(MAX)+1 inside one INSERT, entity='locator')"
  - "Integration tests need pub, not pub(crate): the plan's 'pub(crate) + test-visible' sketch is impossible for tests/ targets — reconcile/command helpers consumed by tests are pub (same as 07-01's transport surface)"
  - "wiremock stateful fake via `impl Respond for FakeDav` + `Mock::given(any())` + own request journal — PROPFIND multistatus with per-href <D:getetag>, conditional MOVE semantics (If-None-Match/If-Match vs DESTINATION → 412), ETag counter bumped per write"

requirements-completed: [SYNC-02, SYNC-03, SYNC-05]

# Metrics
duration: ~110min
completed: 2026-07-18
---

# Phase 7 Plan 02: WebDAV State-Plane Reconcile Engine Summary

**The state plane is landed and wire-proven off-device: pushes rebuild the self-describing `state/<device_id>.json` from SQLite and publish it atomically (tmp-`<uuid>` PUT → conditional MOVE, one-shot 412 re-pull-merge-retry); pulls fetch only ETag-changed peer files, V5-validate them, and merge through 07-00's pure map drivers inside per-device transactions — set union, tombstone remove-wins, 冲突副本 copies, ZERO change_log pollution; the D-92 jump/undo/revert round trip works end to end; and the five part-2 IPC commands plus the unified sync-status event (SOLE emitter, engine-owned transfer maps for 07-03) are registered. The A4 shared-pool wiring is proven on a live desktop run (`[sync] shared pool acquired`).**

## Performance

- **Duration:** ~110 min
- **Tasks:** 5
- **Files modified:** 11 (5 created, 6 modified)

## Accomplishments
- `src-tauri/src/sync/reconcile.rs` (new, ~1200 lines): `SyncConfigRow`/`load_sync_config`, `own_device_id` (ensureDevice-mirroring), `build_device_state` (progress register + full annotations incl. tombstones tagged `hash_algo:"sha256"` per record + full catalog incl. tombstones with `file_sync` metadata from `direction='upload'` rows), `build_device_record`, `push_state_file` (tmp PUT → `If-None-Match: *`/`If-Match: <etag verbatim>` MOVE → depth-0 PROPFIND ETag, A1 degrade to empty), `reconcile_push` (412 → pull once → rebuild → retry once against the fresh own-file ETag; `remote_etag`/`last_sync_at`/`last_error`/`syncing` persisted), `pull_state_files` (depth-1 PROPFIND ETag map with href jail + tmp/non-`.json` skips + 750-truncation warning; peer-ETag cache; 16 MiB streamed cap; per-device merge tx; discovery rows; undo stash), `upsert_device_record` (first_seen preserved, unconditional tmp+MOVE), `UndoMap`/`JumpStash`/`PullReport`.
- `src-tauri/src/sync/commands.rs` (extended): payload types `ReplacedLocal`/`BookOpenedSyncResult`/`SyncStatusPayload`/`TransferProgress`/`TransferKind`/`SyncStatusEvent` (all camelCase, all password-free); `sync_book_opened` (开书拉: scoped pull, stash read-not-consumed → trace-pill payload), `sync_book_closed` (合书推 fire-and-forget + stash drop), `sync_revert_jump` (D-92: restore exact pre-jump row + ONE local locator ledger row, returns the restored position), `sync_now` (in-memory AtomicBool guard + persisted syncing column; pull-then-push), `sync_status`; `emit_sync_status` SOLE emitter of `"sync-status"`; `report_transfer_progress` (07-03's only progress channel, ≥100 removes); `dav_client_from_row` (the ONLY place the keychain is read for the state plane).
- `src-tauri/src/sync/mod.rs` (extended): `sqlite_pool` (plugin DbInstances, try_state-hardened, first-success engine init = crash-orphan `UPDATE sync_state SET syncing=0`), `probe_shared_pool` (A4), `SyncUndoMap`/`SyncProgressMaps`/`TransferMaps`/`SyncEngineState` managed states, `SyncError::Soft`, `DB_URL`.
- `src-tauri/src/lib.rs`: three states managed, five commands registered, A4 probe spawn (log lives here so sync/ stays println-free).
- Tests: 14 reconcile (builder shape incl. value-level file_sync asserts + no-credential JSON scan; conditional push wire-assertions incl. the 412 journal order; pull (a)-(g) incl. change_log invariance + zero-GET cache + discovery no-clobber; revert restore + monotonic clock) and 5 dual-device e2e scenarios (union/no-loss; anti-resurrection BOTH orders + stale-peer; clock-skew determinism BOTH orders incl. device_id tie-break; jump→stash→revert; catalog union + discovery + tombstone roundtrip) — all off-device on in-memory SQLite + a stateful wiremock DAV fake (shared `tests/common/mod.rs`).

## Task Commits

No commits by this executor — wave protocol leaves all git mutations to the orchestrator after wave verification. Working tree holds the full plan diff (`git status`: 6 modified + 5 created paths listed above; `tests/common/` is a new directory beyond the plan's files_modified list — see Deviations).

## Files Created/Modified
- `src-tauri/src/sync/reconcile.rs` — NEW: the state plane (above).
- `src-tauri/src/sync/commands.rs` — part-2 section appended (~470 lines); part-1 untouched.
- `src-tauri/src/sync/mod.rs` — pool helper/engine state/`SyncError::Soft` (+111 lines).
- `src-tauri/src/sync/transport.rs` — `join_url` `fn` → `pub(crate) fn` (one-word diff; the reconcile agent calls need the single join point).
- `src-tauri/src/lib.rs` — managed states + handler registration + A4 probe spawn (+24 lines).
- `src-tauri/Cargo.toml` — `serde_json = "=1.0.150"` moved dev→runtime (ONE manifest entry, as the plan demands); `uuid = { version = "=1.23.4", features = ["v4"] }` added.
- `Cargo.lock` — +1 line (`uuid` edge in the pillowtome package dep list; serde_json was already an edge from the dev entry). Zero new packages, zero version changes (D-13).
- `src-tauri/tests/sync_reconcile.rs` — NEW: 14 tests.
- `src-tauri/tests/sync_e2e.rs` — NEW: 5 scenarios.
- `src-tauri/tests/common/mod.rs` — NEW: shared harness (see Deviations).

## Decisions Made
- **FK-safe merge apply order (LIBRARY → ANNOTATIONS → PROGRESS).** First full test run failed `FOREIGN KEY constraint failed` — a remote-only work's locator landed before its placeholder. The plugin pool enforces `PRAGMA foreign_keys=ON` (verified in vendored tauri-plugin-sql 2.4.0 `wrapper.rs` line 185). The plan lists progress first; FK makes library-first mandatory. Per-entry write failures now also downgrade to a Chinese warning instead of aborting the device merge.
- **Peer-cache lookup key.** A test caught the cache map keyed by full row id (`peer:<device_id>`) but looked up by bare device_id — fixed; the zero-GET gate is journal-proven.
- **Probe window + try_state.** First desktop probe (10s) exhausted before the WebView called `Database.load`; window raised to ~2 min and `state()` → `try_state()` (the plugin manages DbInstances from async setup — early `state()` can panic). Second run: `[sync] shared pool acquired` — A4 holds, no fallback needed.
- **Test names carry `sync_` prefixes** so the plan's `cargo test -p pillowtome sync` verify actually covers reconcile+e2e (30 tests under the filter) instead of only the 11 lib unit tests it matched before (07-01's transport tests keep their own `--test sync_transport` gate; that file was not touched).
- **`SyncConfigRow` was defined in this plan** — the 07-02 plan text cited it as 07-01 output, but no such type existed (grep-verified); `dav_client_from_row` in commands.rs is the single construction point from stored row + keychain.

## Deviations from Plan
1. **`src-tauri/tests/common/mod.rs` added** (not in files_modified): the plan offered "factor shared fakes into this file's own module or duplicate minimal helpers" — the stateful DAV fake (~200 lines) is shared by both test binaries via the idiomatic `mod common;` pattern rather than duplicated; both test files stay self-contained at the scenario level.
2. **Merge apply order is library → annotations → progress** (plan lists progress → annotations → library) — FK enforcement, see Decisions.
3. **`reconcile_push` signature takes `undo: &UndoMap`** (plan sketched `pool, client, cfg`) so the 412-recovery pull stashes into the session map; tests pass a fresh map.
4. **`grep -ci "password" src-tauri/src/sync/commands.rs == 0` is UNACHIEVABLE BY CONSTRUCTION** (count: 17): 07-01's part-1 credential handling (`SyncConfigInput.password`, keychain calls) lives in the same file the plan requires part-2 to extend, and moving it would break 07-01's recorded acceptance greps. Intent fully satisfied instead: every part-2 payload struct (`BookOpenedSyncResult`/`ReplacedLocal`/`SyncStatusPayload`/`SyncStatusEvent`/`TransferProgress`) has NO credential field (types are in the diff for review), `reconcile.rs` IS password-free (grep == 0, gate passes), and the builder test asserts the serialized state JSON contains neither `password` nor `secret`.
5. **`Depth::Number(1)`/`Depth::Number(0)` for the plan's `Depth::One`/`Depth::Zero`** — reqwest_dav 0.3.3 has no such variants (07-01 already recorded the Zero case); the `Depth::One` acceptance string is satisfied via the code comment documenting this.
6. **Test fns prefixed `sync_`** (see Decisions) — the group verify filters (`build`/`push`/`pull`/`undo`) match as substrings and are all green.
7. **Test helpers are `pub` not `pub(crate)`** (plan's "pub(crate) + test-visible" is impossible for integration-test targets).
8. **Collection PROPFIND uses a trailing-slash request path** (`pillowtome/state/`) — slash-less collection PROPFIND draws sabre/Nextcloud 301s; href jailing still matches the core-built path tail exactly.

## Issues Encountered
- FK constraint failure in the first full test run → the apply-order fix (Decisions).
- Peer-cache key mismatch (`peer:<id>` vs bare id) → fixed, journal-proven gate.
- `impl Respond` borrow error (`st` mutable+immutable in one expression) → split binding.
- serde_json renders `0.4` not `0.40` — one test assertion loosened to the real wire form.
- First desktop probe window too short (see Decisions); no code defect — the frontend loads the DB within ~15s of a cold dev boot (pillow.db + WAL verified on disk).
- wiremock's `any()` + custom `Respond` works cleanly for PROPFIND/MOVE extension verbs; `received_requests` was unnecessary (own journal carries the headers).

## Known Stubs
None in the shipped paths. Deliberate seams for later plans: `report_transfer_progress` is `pub(crate)` with `#[allow(dead_code)]` (07-03 is its first caller); `SyncError::RemoteChanged` now has its consumer (the 412 retry); 07-01's Android AVD gate remains deferred (unrelated to this plan).

## Next Phase Readiness
- **07-03 (file plane):** report progress ONLY via `pub(crate) async fn report_transfer_progress(app: &AppHandle, kind: TransferKind, work_id: &str, percent: f64)` in `sync::commands` (`TransferKind::{Download, Upload}`; `percent >= 100` completes/removes the entry) — it updates the engine maps and re-emits the unified event; NEVER call `app.emit("sync-status", …)` from anywhere else. Download discovery rows are waiting in `sync_file_state`: `direction='download'`, `transfer_uuid=NULL`, `chunks_done='[]'`, `size`/`hash`/`remote_path` populated (PK `work_id`); updates MUST preserve in-flight `transfer_uuid`/`chunks_done`. Upload rows read by the state builder: `direction='upload'` + `remote_path IS NOT NULL` (metadata rides the next push automatically). Large bodies keep going through `client.agent` streaming (Pitfall 4).
- **07-04 (UI):** IPC contract (all camelCase) —
  - `sync_book_opened({workId})` → `{jumped: bool, deviceName: string|null, progressFraction: number|null, replacedLocal: {cfi: string, progressFraction: number}|null}` — feeds the §5 pill + dialog 「{设备名称}」上读到了 {n}%，已自动跳到最远位置。; quiet `{jumped:false}` when unconfigured/failed.
  - `sync_book_closed({workId})` → `()` (fire-and-forget).
  - `sync_revert_jump({workId})` → `{cfi, progressFraction}|null` — the RESTORED position; jump the reader straight from the response; `null` = no stash (second tap is a no-op).
  - `sync_now()` / `sync_status()` → `{configured, serverUrl, username, syncing, lastSyncAt, lastError}` — store init uses EMPTY transfer arrays until the first event.
  - Event `"sync-status"` → `{configured, syncing, lastError, downloads: [{workId, percent}], uploads: [{workId, percent}]}` — SOLE channel, emitted on every transition and tick; render `lastError` verbatim (同步失败：{原因} toast path).
  - Pill semantics: shown when `jumped`/stash exists; stash is READ on open, consumed ONLY by revert, dropped on close; session-scoped (never persisted).
- **Remote artifacts now live:** `state/<device_id>.json` (format:1), `devices/<device_id>.json`, peer cache rows `sync_state.id='peer:<device_id>'`, `sync_state.remote_etag` (verbatim opaque token).

## Self-Check: PASSED

- `cargo test -p pillowtome --test sync_reconcile build` — 2/2 green (Task 1 gate).
- `cargo test -p pillowtome --test sync_reconcile push` — 4/4 green (Task 2 gate; wire-asserted conditionals + 412 journal order).
- `cargo test -p pillowtome --test sync_reconcile pull` — 8/8 green (Task 3 gate; (a)-(g) incl. change_log invariance + zero-GET + no-clobber).
- `cargo test -p pillowtome --test sync_reconcile undo` + `cargo build -p pillowtome` — 1/1 green + build green (Task 4 gate).
- `cargo test -p pillowtome --test sync_e2e` — 5/5 green (Task 5 gate).
- `cargo test -p pillowtome sync` — 30/30 green (11 lib unit + 14 reconcile + 5 e2e); `cargo test -p pillowtome-core sync` — 33/33 green (07-00 regression).
- `cargo test --workspace` — exit 0, all 11 suites green, zero warnings (full log captured: 147 tests).
- `cargo check --workspace` — green. All cargo runs under `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc`.
- A4 runtime probe: `pnpm tauri dev` → `[sync] shared pool acquired` (second run; first window too short — fixed). No fallback needed.
- Acceptance greps: ALL pass except the structurally impossible `grep -ci password commands.rs == 0` (17 — part-1 containment in the same file; see Deviation 4 with the compensating evidence).
- `grep -rc "println!\|eprintln!" src-tauri/src/sync/` — totals 0 (07-01 invariant preserved; the A4 log lives in lib.rs).
- Capabilities: `default.json` + `android.json` byte-identical (md5-verified pre/post) — no new grant needed (`core:default` covers event listen/emit; app commands need no ACL entries).
- Cargo.lock diff: +1 line, dep edge only (D-13 holds).

---
*Phase: 07-webdav-self-hosted-sync*
*Completed: 2026-07-18*
