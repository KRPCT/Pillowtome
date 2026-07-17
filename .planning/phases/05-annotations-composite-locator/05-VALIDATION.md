---
phase: 05
slug: annotations-composite-locator
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-17
---

# Phase 05 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.4 (TS unit) + `cargo test` (Rust migration) |
| **Config file** | `vitest.config.ts` (already wired); Rust `src-tauri/tests/migration.rs` |
| **Quick run command** | `pnpm test src/reader/<touched>.test.ts` |
| **Full suite command** | `pnpm test && pnpm exec tsc --noEmit && pnpm build` (+ `cd src-tauri && cargo test --test migration`) |
| **Estimated runtime** | ~3–8s per single unit file · ~60–120s full suite + tsc + build |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test src/reader/<touched>.test.ts` + `pnpm exec tsc --noEmit` (Rust tasks: `cargo test --test migration`).
- **After every plan wave:** Run the full suite `pnpm test` + `pnpm build`.
- **Before `/gsd-verify-work`:** Full suite green + `tsc`/`build` green + **Android AVD `Medium_Phone_API_36.1` human acceptance** (paginate & scroll, reopen & mode-switch, bubble/highlight/bookmark).
- **Max feedback latency:** < 10s (single-file unit run).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Test File | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-----------|--------|
| 05-01-01 | 01 | 1 | ANNO-01/02/03 | T-05-01 / T-05-02 | Append-only migration; `annotation`+`sync_meta` schema; monotonic-clock ledger shape | unit | `cd src-tauri && cargo test --test migration` | existing (extended) | ⬜ pending |
| 05-01-02 | 01 | 1 | ANNO-01/02 | T-05-01 / T-05-02 / T-05-04 | `$n` binds only (no interpolation); tombstone (no physical DELETE); clock `COALESCE(MAX)+1` inside one atomic INSERT | unit | `pnpm test src/reader/annotation-store.test.ts && pnpm exec tsc --noEmit` | in-task (TDD, RED-first) | ⬜ pending |
| 05-02-01 | 02 | 1 | ANNO-04 | T-05-05 | Pure in-memory string match + DOM Range; no SQL, no HTML sink, no eval | unit | `pnpm test src/reader/anchor-resolver.test.ts && pnpm exec tsc --noEmit` | in-task (TDD, RED-first) | ⬜ pending |
| 05-02-02 | 02 | 1 | ANNO-04 | — | N/A (reuses locator-store `$n` discipline) | unit | `pnpm test src/reader/locator-store.test.ts && pnpm exec tsc --noEmit` | existing (extended) | ⬜ pending |
| 05-02-03 | 02 | 1 | ANNO-01 / ANNO-04 | — | N/A (CFI encode/decode via vendored epubcfi) | unit | `pnpm test src/reader/scroll-cfi.test.ts && pnpm exec tsc --noEmit` | existing (extended) | ⬜ pending |
| 05-03-01 | 03 | 2 | ANNO-01 | T-05-07 | `::highlight()` registry names built only from cinnabar\|ochre\|green\|indigo allowlist | unit | `pnpm test src/reader/css-highlight.test.ts && pnpm exec tsc --noEmit` | in-task (TDD, RED-first) | ⬜ pending |
| 05-03-02 | 03 | 2 | ANNO-01 / ANNO-04 | T-05-08 / T-05-09 | No full-screen pointer-capture layer; lazy per-section draw (no bulk-on-open) | build | `pnpm exec tsc --noEmit && pnpm build` | component (build-gated; device 05-05) | ⬜ pending |
| 05-03-03 | 03 | 2 | ANNO-01 / ANNO-04 | T-05-08 | Closed-shadow draw only via foliate `draw-annotation`/`addAnnotation`; no `shadowRoot.querySelector` | build | `pnpm exec tsc --noEmit && pnpm build` | component (build-gated; device 05-05) | ⬜ pending |
| 05-04-01 | 04 | 3 | ANNO-01 | T-05-10 / T-05-12 | Bubble is the only `pointer-events:auto` element; zero `dangerouslySetInnerHTML` | build | `pnpm exec tsc --noEmit && pnpm build` | component (build-gated; device 05-05) | ⬜ pending |
| 05-04-02 | 04 | 3 | ANNO-02/03 | T-05-10 / T-05-12 | Note/excerpt as React text nodes (escaping); TocSheet touch-gate-safe sheet body | build | `pnpm exec tsc --noEmit && pnpm build` | component (build-gated; device 05-05) | ⬜ pending |
| 05-04-03 | 04 | 3 | ANNO-03 | — | Single position-bus SSOT (no second position source) | build | `pnpm exec tsc --noEmit && pnpm build` | component (build-gated; device 05-05) | ⬜ pending |
| 05-05-01 | 05 | 4 | ANNO-01..04 | — | Full-suite + migration pre-flight before burning an emulator cycle | suite | `pnpm test && pnpm exec tsc --noEmit && pnpm build` (+ `cargo test --test migration`) | full suite | ⬜ pending |
| 05-05-02 | 05 | 4 | ANNO-01..04 | T-05-13 / T-05-14 | WebView-version fallback (Overlayer < 105); closed-shadow bubble coord-mapping acceptance | manual (device) | `<human-check>` — AVD `Medium_Phone_API_36.1`, `pnpm tauri android dev` | device gate | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

**Existing infrastructure covers all phase requirements — no new validation infra needed.**

- vitest 3.2.4 is already wired (`vitest.config.ts`); Rust `cargo test --test migration` already exists.
- The new colocated test files (`annotation-store.test.ts`, `anchor-resolver.test.ts`, `css-highlight.test.ts`) are authored **RED-first inside their own TDD tasks** (05-01-02, 05-02-01, 05-03-01), not as separate scaffolding.
- Extended existing suites (`locator-store.test.ts`, `scroll-cfi.test.ts`, `tests/migration.rs`) add per-behavior cases in-task.
- No framework install, no shared conftest/fixtures, no watch-mode flags required.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Selection bubble sits over the selection in **paginate** (closed-shadow coord mapping) | ANNO-01 | Closed shadow root + host↔iframe DPI/split-column offset is not reproducible in jsdom | 05-05-02 step 1 — long-press → bubble above selection, arrow at anchor, flips below near top; both modes |
| Persist + redraw across reopen and paginate↔scroll switch on device | ANNO-01..04 | WebView-version variance + real iframe lifecycle (capWindow eviction) | 05-05-02 step 6 — close/reopen book; switch modes; annotations re-apply at right places |
| Self-heal after 简繁 / 词不拆行 toggle | ANNO-04 | Requires a real `reopenTick` full-reopen with live transform DOM | 05-05-02 step 7 — highlight created under one state stays anchored (not drifted/lost) after toggling |
| Finger-swipe scrolls reading view + note/annotations sheets (touch gate) | ANNO-01/02/03 | Touch pan behavior is not exercised by desktop wheel or jsdom | 05-05-02 steps 4–5 — finger-swipe (not wheel) scrolls sheets and reading view; no swallowed pan |
| 200+ annotation performance (lazy per-section draw) | Perf (memory `pillowtome-reader-perf-stress-test`) | Perf/jank is only measurable on device under real load | 05-05-02 step 8 — open + scroll a 200+ annotation book; no open-time stall, no scroll jank |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none — existing infra + in-task TDD test files)
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-17
