---
phase: 1
slug: foundation-cross-platform-skeleton
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-09
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `01-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust `cargo test` (portable `core` crate) + Vitest (frontend, only if logic warrants) — **none configured yet (Wave 0 installs)** |
| **Config file** | none — greenfield (Wave 0 creates `core/tests/`, optional `vitest.config.ts`) |
| **Quick run command** | `cargo test -p pillowtome-core` |
| **Full suite command** | `cargo test --workspace && pnpm test` (+ manual desktop/emulator smoke) |
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
| 1-04-01 | 04 | — | FND-04 | T-1-DRM | DRM/obfuscation detected; content DRM refused, font-obfuscation allowed; corrupt soft-fails | unit | `cargo test -p pillowtome-core protection::` | ❌ W0 | ⬜ pending |
| seams | 02/03 | — | — | — | Publication/Locator/schema stubs compile; DB migrates to v1 | unit + migration | `cargo test --workspace` | ❌ W0 | ⬜ pending |
| 1-01-01 | 01 | — | FND-01 | — | Desktop launch + open bundled EPUB renders a page | smoke (manual) | `cargo tauri dev` → open sample | ❌ W0 | ⬜ pending |
| 1-0X (android) | — | — | FND-02 | — | Android emulator launch + open bundled EPUB renders | smoke (manual, emulator) | `cargo tauri android dev` on AVD | ❌ W0 · `autonomous:false` | ⬜ pending |
| 1-0X (saf) | — | — | FND-03 | T-1-SAF | Import via storage-handle; SAF grant persists across restart | integration (manual restart) | import → force-stop → relaunch → reopen | ❌ W0 · `autonomous:false` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `core/tests/protection.rs` — FND-04 (encryption.xml / rights.xml / font-obfuscation / corrupt-zip fixtures)
- [ ] `core/tests/fixtures/` — tiny EPUBs: clean · ADEPT-marked · font-obfuscated · truncated/corrupt
- [ ] `assets/sample/*.epub` — one small DRM-free sample bundled for FND-01/02
- [ ] `core/tests/` migration smoke — assert `pillow.db` migrates to schema v1 on first boot
- [ ] `cargo test` is built-in; add Vitest only if frontend logic needs unit coverage

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Android emulator launch + EPUB render | FND-02 | No headless Android E2E; needs a running AVD (D-13 emulator substitute) | Boot AVD `Medium_Phone_API_36.1`; `cargo tauri android dev`; open bundled sample; confirm a page renders |
| SAF grant persists across restart | FND-03 | SAF persistence + real restart cycle not automatable in this env | Import a book via folder/file picker; force-stop app; relaunch; reopen the book without re-granting |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (device tasks have manual gates)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60 s (off-device loop)
- [ ] `nyquist_compliant: true` set in frontmatter (after planner attaches per-task verifies)

**Approval:** pending
