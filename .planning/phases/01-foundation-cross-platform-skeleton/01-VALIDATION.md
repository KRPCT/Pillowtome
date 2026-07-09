---
phase: 1
slug: foundation-cross-platform-skeleton
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-09
updated: 2026-07-09
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `01-RESEARCH.md` §Validation Architecture. Refreshed after planning to reference the final plan/task IDs (5 plans: 01-01..01-05).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust `cargo test` (portable `core` crate + `src-tauri` integration tests) + Vitest (frontend, only if logic warrants) — Wave 0 test files are created by the first task of each consuming plan |
| **Config file** | none — greenfield (`cargo test` built-in; optional `vitest.config.ts` if 01-04 frontend logic needs it) |
| **Quick run command** | `cargo test -p pillowtome-core` |
| **Full suite command** | `cargo test --workspace && pnpm build` (+ manual desktop/emulator smoke) |
| **Estimated runtime** | ~30 s (core unit); desktop/emulator smoke manual |

---

## Sampling Rate

- **After every task commit:** `cargo test -p pillowtome-core` + `cargo build --workspace`
- **After every plan wave:** `cargo test --workspace` + `cargo tauri build` (desktop) green
- **Before `/gsd-verify-work`:** desktop E2E (FND-01) + emulator E2E (FND-02/03, manual per D-13) + FND-04 unit suite green
- **Max feedback latency:** ~60 s (off-device core loop); device/emulator checks are manual gates

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-T1 | 01 | 1 | FND-01/02 (foundation) | T-01-SC | Exact-pinned deps + committed lockfiles + vendored pinned foliate-js | build | `pnpm install --frozen-lockfile && cargo build --workspace` | ❌ W0 (task creates) | ⬜ pending |
| 01-01-T2 | 01 | 1 | FND-01/02 (foundation) | T-01-02 | Core seam stubs compile; Chinese shell builds; baseline CSP | unit + build | `cargo test -p pillowtome-core && pnpm build` | ❌ W0 | ⬜ pending |
| 01-01-T3 | 01 | 1 | FND-01/02 | T-01-01, T-01-03 | pillow:// Range 200/206/416, scope-guarded, sample id registered, no bytes over IPC | integration | `cargo test -p pillowtome --test protocol_range` | ❌ W0 (task creates `src-tauri/tests/protocol_range.rs`) | ⬜ pending |
| 01-02-T1 | 02 | 2 | FND-04 | T-01-DRM, T-01-04 | Fixtures + typed CoreError; failing tests (RED) | unit (RED) | `cargo test -p pillowtome-core --test protection` (expects fail) | ❌ W0 (task creates fixtures + `core/tests/protection.rs`) | ⬜ pending |
| 01-02-T2 | 02 | 2 | FND-04 | T-01-DRM, T-01-05 | DRM/obfuscation detected; content DRM refused, font-obfuscation allowed; corrupt soft-fails; zip-slip guard | unit (GREEN) | `cargo test -p pillowtome-core protection::` | ❌ W0 | ⬜ pending |
| 01-03-T1 | 03 | 2 | FND-01/03 (seams) | T-01-08 | Publication/Locator/BookSource stubs compile + serde round-trip | unit | `cargo test -p pillowtome-core locator:: source:: publication::` | ❌ W0 | ⬜ pending |
| 01-03-T2 | 03 | 2 | seams (D-09) | T-01-06, T-01-07 | DB migrates to schema v1 (work/locator/change_log); single SQLite binding | migration | `cargo test -p pillowtome --test migration` | ❌ W0 (task creates `src-tauri/tests/migration.rs`) | ⬜ pending |
| 01-04-T1 | 04 | 3 | FND-01/02 | T-01-10, T-01-03 | Reading slice builds; DRM-gated; bundled sample present; bytes via pillow:// | build | `pnpm build && cargo build --workspace` | ❌ W0 (task creates `assets/sample/sample.epub`) | ⬜ pending |
| 01-04-T2 | 04 | 3 | FND-01 | — | Desktop launch + open bundled EPUB renders a page + page-turn | smoke (manual) | manual — `cargo tauri dev` → open sample | ❌ W0 · `checkpoint` | ⬜ pending |
| 01-04-T3 | 04 | 3 | FND-02 | — | Android emulator launch + open bundled EPUB renders | smoke (manual, emulator) | manual — `cargo tauri android dev` on AVD | ❌ W0 · `checkpoint` · `autonomous:false` | ⬜ pending |
| 01-05-T1 | 05 | 4 | FND-03 | T-01-SAF | Import via BookSource storage-handle (not raw path); migrated sample resolves | unit + build | `cargo test -p pillowtome storage:: && cargo build --workspace && pnpm build` | ❌ W0 | ⬜ pending |
| 01-05-T2 | 05 | 4 | FND-03 | T-01-SC | SAF-mechanism decision + supply-chain audit of [SUS] crate | decision gate | manual — blocking-human decision | — · `checkpoint` | ⬜ pending |
| 01-05-T3 | 05 | 4 | FND-03 | T-01-SAF | Import via storage-handle; SAF grant persists across restart | integration (manual restart) | manual — import → force-stop → relaunch → reopen | ❌ W0 · `checkpoint` · `autonomous:false` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 test infrastructure is not created as a separate pre-wave; each artifact is owned by the FIRST task of its consuming plan (RED-first for DRM). This keeps fixtures adjacent to the code they gate.

- [ ] `core/tests/protection.rs` + `core/tests/fixtures/` (clean · ADEPT · font-obfuscated · truncated) — **owned by 01-02-T1 (RED)**
- [ ] `src-tauri/tests/protocol_range.rs` (range 200/206/416 + registry→protocol serve) — **owned by 01-01-T3**
- [ ] `src-tauri/tests/migration.rs` migration smoke (DB migrates to schema v1) — **owned by 01-03-T2**
- [ ] `assets/sample/sample.epub` — one small DRM-free bundled sample for FND-01/02 — **owned by 01-04-T1** (id pre-registered in the SourceRegistry by 01-01-T3)
- [ ] `cargo test` is built-in; add Vitest only if 01-04 frontend logic needs unit coverage

---

## Manual-Only Verifications

| Behavior | Task ID | Requirement | Why Manual | Test Instructions |
|----------|---------|-------------|------------|-------------------|
| Desktop launch + EPUB render + page-turn | 01-04-T2 | FND-01 | No headless desktop E2E for the WebView render | `cargo tauri dev`; click "打开示例书籍"; confirm a readable page renders + page-turn advances |
| Android emulator launch + EPUB render | 01-04-T3 | FND-02 | No headless Android E2E; needs a running AVD (D-13 emulator substitute) | Export `ANDROID_HOME`/`NDK_HOME`; `cargo tauri android init`; boot AVD `Medium_Phone_API_36.1`; `cargo tauri android dev`; open bundled sample; confirm a page renders |
| SAF grant persists across restart | 01-05-T3 | FND-03 | SAF persistence + real restart cycle not automatable in this env | Import a book via picker; force-stop app; relaunch; reopen the book without re-granting |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (the 3 device/decision tasks 01-04-T2, 01-04-T3, 01-05-T3 are exempted as Manual-Only per D-13; 01-05-T2 is a decision gate)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every auto/tdd task carries an `<automated>` command)
- [x] Wave 0 covers all MISSING references (each Wave 0 artifact assigned to a specific owning task above)
- [x] No watch-mode flags
- [x] Feedback latency < 60 s (off-device core loop)
- [x] `nyquist_compliant: true` set in frontmatter (per-task verifies attached across 01-01..01-05)

**wave_0_complete = false (rationale):** Wave 0 artifacts are planned and assigned to owning tasks but are created at *execution* time (fixtures/sample/smoke tests land in the first task of each consuming plan, RED-first for 01-02). This flag flips to `true` once those tasks (01-01-T3, 01-02-T1, 01-03-T2, 01-04-T1) have executed and their test files exist on disk.

**Approval:** approved (planner) — nyquist-compliant, task IDs reconciled with final 5-plan breakdown.
