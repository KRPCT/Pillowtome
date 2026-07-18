---
phase: 7
slug: webdav-self-hosted-sync
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-18
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `07-RESEARCH.md` § Validation Architecture; per-task rows baselined against the five approved plans (07-00..07-04) on 2026-07-18.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.4 (frontend pure logic, node env, `src/**/*.test.ts`) + cargo test (core pure fns + src-tauri, wiremock 0.6.5 for transport) |
| **Config file** | `vitest.config.ts` (existing); cargo — no extra config |
| **Quick run command** | `pnpm test src/sync/` / `cargo test -p pillowtome-core sync` |
| **Full suite command** | `pnpm test && tsc && pnpm build` + `cargo test --workspace` (MSVC toolchain — GNU gcc exits 1 silently) |
| **Estimated runtime** | ~60 seconds (quick) |

---

## Sampling Rate

- **After every task commit:** `cargo test -p pillowtome-core sync` + `pnpm test <touched>` + `tsc`
- **After every plan wave:** `cargo test --workspace` + `pnpm test && pnpm build`
- **Before `/gsd-verify-work`:** Full suite green + AVD production-APK device acceptance (keychain read/write, open-book pull / close-book push, placeholder-card download, undo dialog) + real-server matrix (proxied Nextcloud / 坚果云 / generic dufs) at least one pass each
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-00-T1 | 07-00 | 0 | D-13 supply-chain | T-07-00-07 | exact pins, single reqwest 0.13.x in lock | build + grep | `cargo check --workspace` + lock greps | ✅ | ⬜ pending |
| 07-00-T2 | 07-00 | 0 | SYNC-05 (schema) | — | V8 append-only, V1..V7 byte-identical | unit | `cargo test --test migration` | ✅ | ⬜ pending |
| 07-00-T3 | 07-00 | 0 | SYNC-02 | T-05-02 pattern | locator upsert appends monotonic change_log | unit | `pnpm test src/reader/locator-store.test.ts` | ✅ | ⬜ pending |
| 07-00-T4 | 07-00 | 0 | SYNC-02/03/05 | — | merge never drops single-side records; tombstone wins ties; no cross-algo hash compare | unit (exhaustive + fixed-seed prop matrix) | `cargo test -p pillowtome-core sync` | ✅ | ⬜ pending |
| 07-01-T1 | 07-01 | 1 | SYNC-01 | T-07-01-07 | password never in serde/log; keyring_available probe | unit (pure fns only) | `cargo test -p pillowtome credentials` | ✅ | ⬜ pending |
| 07-01-T2 | 07-01 | 1 | SYNC-01 | T-07-01 TLS | http refused by default; self-signed only via switch | unit | `cargo test -p pillowtome transport` | ✅ | ⬜ pending |
| 07-01-T3 | 07-01 | 1 | SYNC-01 | Pitfall 2 | If-None-Match header reaches wire; 401/403/timeout/503 classified | integration (wiremock) | `cargo test -p pillowtome --test sync_transport` | ✅ | ⬜ pending |
| 07-01-T4 | 07-01 | 1 | SYNC-01 | D-97 | save gated on passing bootstrap; keychain before config row | unit + integration | `cargo test -p pillowtome sync` | ✅ | ⬜ pending |
| 07-01-T5 | 07-01 | 1 | SYNC-01 | Pitfall 1 | Android keyring read/write on production APK | manual (AVD checkpoint) | `pnpm tauri android build --debug --target x86_64 --apk` + manual | ✅ | ⬜ pending |
| 07-02-T1 | 07-02 | 2 | SYNC-02/03 | — | state file rebuild: register latest-per-work, full annotations incl tombstones, `direction='upload'` metadata join | unit (in-memory pool) | `cargo test -p pillowtome --test sync_reconcile` | ✅ | ⬜ pending |
| 07-02-T2 | 07-02 | 2 | SYNC-05 | Pitfall 5 | tmp+MOVE atomic; If-None-Match/If-Match/412 retry reaches wire | integration (wiremock) | `cargo test -p pillowtome --test sync_reconcile` | ✅ | ⬜ pending |
| 07-02-T3 | 07-02 | 2 | SYNC-02/03/04 | — | merged-remote rows never enter change_log; discovery rows (direction='download') upserted | unit + integration | `cargo test -p pillowtome --test sync_reconcile` | ✅ | ⬜ pending |
| 07-02-T4 | 07-02 | 2 | SYNC-02 (D-92) | T-07-02-09 | undo stash read-not-consumed; revert returns restored locator; syncing-flag reset | unit | `cargo test -p pillowtome sync` | ✅ | ⬜ pending |
| 07-02-T5 | 07-02 | 2 | SYNC-02/03/05 | PITFALLS #7 | dual-instance union/no-loss/anti-resurrection/skew determinism | integration (dual pool + wiremock) | `cargo test -p pillowtome --test sync_e2e` | ✅ | ⬜ pending |
| 07-03-T1 | 07-03 | 2 | SYNC-04 | Pitfall 4 | 10MB threshold planner; streaming never whole-reads | unit | `cargo test -p pillowtome-core sync::fileplane` | ✅ | ⬜ pending |
| 07-03-T2 | 07-03 | 2 | SYNC-04 | PITFALLS #8 | chunk v2 resume sends only missing chunks; 423/504 backoff; 24h expiry | integration (wiremock) | `cargo test -p pillowtome --test sync_fileplane` | ✅ | ⬜ pending |
| 07-03-T3 | 07-03 | 2 | SYNC-04 | T-07-03 V12 | Range resume + blake3==work_id hard gate; commands created + registered | integration | `cargo test -p pillowtome --test sync_fileplane` | ✅ | ⬜ pending |
| 07-03-T4 | 07-03 | 2 | SYNC-04/05 | Pitfall 2 | Destination header on every chunk request; conditional-PUT proof | integration (wiremock) | `cargo test -p pillowtome --test sync_fileplane` | ✅ | ⬜ pending |
| 07-04-T1 | 07-04 | 3 | SYNC-02 (D-90/91) | — | close-gate at-most-one push; zero timers | unit (vitest) | `pnpm test src/sync/` | ✅ | ⬜ pending |
| 07-04-T2 | 07-04 | 3 | SYNC-01 (D-93) | — | status dot/aria/toast mapping; store init from sync_status | unit (vitest) | `pnpm test src/sync/sync-status` | ✅ | ⬜ pending |
| 07-04-T3 | 07-04 | 3 | SYNC-01 | D-97 | client-side validation copy; backend Err string rendered verbatim | unit (vitest) | `pnpm test src/sync/sync-form` | ✅ | ⬜ pending |
| 07-04-T4 | 07-04 | 3 | SYNC-02/04/05 | T-07-04-05 | card-state matrix; trace/undo wiring; adoptSyncedFile placeholder adoption | unit (vitest) | `pnpm test src/library/ src/reader/sync-jump` | ✅ | ⬜ pending |
| 07-04-T5 | 07-04 | 3 | SYNC-01..05 | D-94 | AVD acceptance + real-server matrix (坚果云 / proxied Nextcloud / dufs) | manual checkpoint | checklists in 07-04-PLAN.md Task 5 | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Requirement-level coverage (automated commands re-baselined to real test targets):*

| Requirement | Behavior | Test Type | Automated Command | File Exists |
|-------------|----------|-----------|-------------------|-------------|
| SYNC-01 | keyring store/read/delete (desktop) + config error classification | unit + integration (wiremock 401/403/timeout/503 matrix) | `cargo test -p pillowtome credentials transport --test sync_transport` | ✅ 07-01 |
| SYNC-01 | Android keyring read/write smoke (after ndk-context init) | manual (AVD production APK, CLAUDE.md gate) | `pnpm tauri android build --debug --target x86_64 --apk` + manual | ✅ 07-01-T5 |
| SYNC-02 | progress merge: two-device interleavings, total-order determinism (incl. undo byproducts) | unit (exhaustive fixture) | `cargo test -p pillowtome-core sync::merge` | ✅ 07-00 |
| SYNC-02 | open-book pulls further progress → silent jump + trace + undo | integration + manual | `cargo test -p pillowtome --test sync_reconcile` + vitest `src/reader/sync-jump` + AVD manual | ✅ 07-02/07-04 |
| SYNC-03 | annotation merge: union / tombstone anti-resurrection / same-id conflict / dual hash_algo | unit (exhaustive fixture) | `cargo test -p pillowtome-core sync::merge` | ✅ 07-00 |
| SYNC-03 | E2E: device A annotates → push → device B pulls → replay renders, none lost | integration (dual in-memory pool + wiremock) | `cargo test -p pillowtome --test sync_e2e` | ✅ 07-02 |
| SYNC-04 | chunk planner (threshold/naming/resume state), streaming no-full-read, download blake3 verify | unit | `cargo test -p pillowtome-core sync::fileplane` | ✅ 07-03 |
| SYNC-04 | Nextcloud chunk v2 full flow (MKCOL→chunks→MOVE, 423/504 retry) | integration (wiremock state machine) | `cargo test -p pillowtome --test sync_fileplane` | ✅ 07-03 |
| SYNC-05 | remote write concurrency: If-None-Match/If-Match/412 retry paths | integration (wiremock header assertions) | `cargo test -p pillowtome --test sync_reconcile` | ✅ 07-02 |
| SYNC-05 | "no data loss" property test: arbitrary dual-side op sequences merge to set union | property-style exhaustive (fixed-seed matrix) | `cargo test -p pillowtome-core sync::merge` | ✅ 07-00 |
| SYNC-01..05 | server matrix (proxied Nextcloud / 坚果云 / dufs) manual acceptance | manual checkpoint | 07-04-PLAN.md Task 5 checklist (D-94) | manual gate |

---

## Wave 0 Requirements (baselined to 07-00-PLAN.md)

- [ ] Dependencies pinned: `reqwest_dav =0.3.3`, `keyring =4.1.5` (+android feature), `wiremock =0.6.5` (dev) → commit Cargo.lock; single reqwest 0.13.x in lock (D-13)
- [ ] `core/src/sync/{model,merge,remote}.rs` + merge exhaustive fixtures (progress/annotation/library) + fixed-seed no-data-loss property matrix
- [ ] SCHEMA_V8 (append-only): `library_item.deleted` (research Q2 adopted), `library_item.file_sync_enabled`, `sync_config`, `sync_state`, `sync_file_state`
- [ ] locator write path appends change_log entries (entity='locator' — closes the pre-existing gap)

*Re-baselined 2026-07-18: the Android keyring spike and the wiremock transport matrix land in **Wave 1** (07-01-T5, 07-01-T3), not Wave 0 — the spike needs 07-01's credentials/transport code to exist first.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Android keyring read/write on production APK | SYNC-01 | OS keystore only real on device/AVD | 07-01-PLAN.md Task 5 checklist (build, `adb install -r`, force-stop cold start, save + reload config) |
| Server matrix acceptance (proxied Nextcloud / 坚果云 / generic dufs) | SYNC-01..05 | Real proxy/ETag/quota behavior not reproducible in wiremock | 07-04-PLAN.md Task 5 matrix (D-94), each server at least one full round |
| Merge-undo dialog on Android | SYNC-02 | Touch/scroll gate + UI acceptance | AVD production APK: trigger further-progress pull, confirm silent jump + trace + undo dialog |
| Sync settings sheet finger scroll | SYNC-01 | CLAUDE.md touch gate #4 | AVD: sheet body scrolls to 测试并保存 with touch, not mouse wheel |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are explicit human checkpoints (07-01-T5, 07-04-T5)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (07-04-T1..T4 each carry vitest-covered pure logic)
- [x] Wave 0 covers all MISSING references (deps, schema, merge engine, locator ledger)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-18 (plan-check loop: 2 explore checkers, 12 cross-plan contract fixes applied and re-verified)
