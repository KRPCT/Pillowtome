---
phase: 7
slug: webdav-self-hosted-sync
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-18
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `07-RESEARCH.md` § Validation Architecture; per-task rows are filled when PLAN.md files exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.4 (frontend pure logic) + cargo test (core pure fns + src-tauri, wiremock 0.6.5 for transport) |
| **Config file** | `vitest.config.ts` (existing); cargo — no extra config |
| **Quick run command** | `pnpm test src/library/` / `cargo test -p pillowtome-core sync` |
| **Full suite command** | `pnpm test && tsc && pnpm build` + `cargo test --workspace` |
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
| TBD by PLAN | — | — | SYNC-01..05 | See RESEARCH § Security Domain | — | — | — | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Requirement-level coverage (to be mapped to task IDs by the planner):*

| Requirement | Behavior | Test Type | Automated Command | File Exists |
|-------------|----------|-----------|-------------------|-------------|
| SYNC-01 | keyring store/read/delete (desktop) + config error classification (unreachable/auth/TLS/permission) | unit + integration (wiremock 401/TLS/timeout matrix) | `cargo test -p pillowtome sync::credentials sync::transport` | ❌ Wave 0 |
| SYNC-01 | Android keyring read/write smoke (after ndk-context init) | manual (AVD production APK, CLAUDE.md gate) | `pnpm tauri android build --debug --target x86_64 --apk` + manual | ❌ Wave 0 spike |
| SYNC-02 | progress merge: two-device interleavings, total-order determinism (incl. undo byproducts) | unit (exhaustive fixture) | `cargo test -p pillowtome-core sync::merge` | ❌ Wave 0 |
| SYNC-02 | open-book pulls further progress → silent jump + trace + undo | integration + manual | vitest (merge-undo UI logic) + AVD manual | ❌ Wave 0 |
| SYNC-03 | annotation merge: union / tombstone anti-resurrection / same-id conflict / dual hash_algo | unit (exhaustive fixture) | `cargo test -p pillowtome-core sync::merge` | ❌ Wave 0 |
| SYNC-03 | E2E: device A annotates → push → device B pulls → replay renders, none lost | integration (dual instance + wiremock/dufs) | `cargo test -p pillowtome sync::e2e` (dual in-memory SqlitePool) | ❌ Wave 1 |
| SYNC-04 | chunk planner (threshold/naming/resume state), streaming no-full-read, download blake3 verify | unit | `cargo test -p pillowtome-core sync::fileplane` | ❌ Wave 1 |
| SYNC-04 | Nextcloud chunk v2 full flow (MKCOL→chunks→MOVE, 423/504 retry) | integration (wiremock state machine) | `cargo test -p pillowtome sync::chunked_upload` | ❌ Wave 1 |
| SYNC-05 | remote write concurrency: If-None-Match/If-Match/412 retry paths | integration (wiremock header assertions) | `cargo test -p pillowtome sync::conditional_put` | ❌ Wave 1 |
| SYNC-05 | "no data loss" property test: arbitrary dual-side op sequences merge to set union | property-style exhaustive (fixed-seed matrix) | `cargo test -p pillowtome-core sync::merge::prop` | ❌ Wave 1 |

---

## Wave 0 Requirements

- [ ] Dependencies pinned: `reqwest_dav =0.3.3`, `keyring =4.1.5` (+android feature), `wiremock =0.6.5` (dev) → commit Cargo.lock (D-13)
- [ ] **Android keyring spike** (highest risk): MainActivity.kt ndk-context init + AVD production-APK read/write smoke
- [ ] `core/src/sync/{model,merge,remote}.rs` skeleton + merge exhaustive fixtures (progress/annotation/library)
- [ ] `src-tauri/tests/sync_transport.rs` wiremock skeleton (401/423/504/412/ETag matrix)
- [ ] SCHEMA_V8 (append-only): `library_item.deleted` (if Q2 adopted), `library_item.file_sync_enabled`, `sync_file_state` (chunk resume state), `sync_state` (remote ETag/last-sync/failure reason)
- [ ] locator write path appends change_log entries (entity='locator' — existing gap; today only annotation-store writes change_log)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Android keyring read/write on production APK | SYNC-01 | OS keystore only real on device/AVD | Build `pnpm tauri android build --debug --target x86_64 --apk`, `adb install -r`, force-stop cold start, save + reload config |
| Server matrix acceptance (proxied Nextcloud / 坚果云 / generic dufs) | SYNC-01..05 | Real proxy/ETag/quota behavior not reproducible in wiremock | Per 07-04 acceptance checklist (D-94 validation matrix), each server at least one full round |
| Merge-undo dialog on Android | SYNC-02 | Touch/scroll gate + UI acceptance | AVD production APK: trigger further-progress pull, confirm silent jump + trace + undo dialog |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
