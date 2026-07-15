---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: completed
stopped_at: Phase 3 context gathered
last_updated: "2026-07-15T18:41:42.048Z"
last_activity: 2026-07-16 -- Deferred continuous-scroll position continuity (`READER-POS`) to Phase 4 library progress SSOT
progress:
  total_phases: 7
  completed_phases: 2
  total_plans: 10
  completed_plans: 10
  percent: 29
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-09)

**Core value:** 在任意一端打开书，都能以干净、舒适的中文排版稳定阅读，并与自托管（WebDAV）书库/进度状态可靠互通。
**Current focus:** Phase 3 — CJK Typography Differentiation (reader position continuity deferred — see MAJOR `READER-POS`)

## Current Position

Phase: 2 (EPUB Reading Core) — COMPLETE
Plan: 5 of 5
Status: Phase complete — ready for Phase 3; **MAJOR reader-position continuity deferred to Phase 4**
Last activity: 2026-07-16 -- Deferred continuous-scroll position continuity (`READER-POS`) to Phase 4 library progress SSOT

Progress: [███░░░░░░░] ~29% (Phases 1–2 complete)

## Performance Metrics

**Velocity:**

- Total plans completed: 10 (Phase 1: 5, Phase 2: 5)
- Average duration: — min
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 5/5 | — | — |
| 2 | 5/5 | — | — |

**Recent Trend:**

- Last 5 plans: 02-00..02-04
- Trend: —

*Updated after each plan completion*
| Phase 1 P01 | 27 | 3 tasks | 58 files |
| Phase 01 P02 | 8 | 2 tasks | 10 files |
| Phase 01 P03 | 7 | 3 tasks | 11 files |
| Phase 02 P00 | 2 min | 2 tasks | 14 files |
| Phase 02 P01 | 2 min | 2 tasks | 12 files |
| Phase 02 P02 | 3 min | 2 tasks | 6 files |
| Phase 02 P03 | 3 min | 2 tasks | 7 files |
| Phase 02 P04 | 6 min | 2 tasks | 13 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Dependency-spine structure — render engine → identity/locator/schema → sync/formats hang off stable abstractions (anti-Lithium-refactor).
- [Phase 1]: Lock 3 day-1 abstractions (format-agnostic Publication, composite locator, UUID+hash+change-log) + decisions (permissive license/foliate-js MIT clean-room, WebView-engine strategy, DRM detect-and-refuse) before any feature binds to them.
- [Phase 3]: CJK typography front-loaded as the differentiator; must be visibly better than Readest/Lithium on day 1.
- [Phase ?]: [01-01] Desktop builds use the MSVC Rust toolchain + vcvars (host GNU gcc is broken); Android uses NDK clang.
- [Phase ?]: [01-01] pillow:// custom protocol is the sole book-byte path (D-06); SourceRegistry scope-guards ids (T-01-01).
- [Phase ?]: [01-01] Supply-chain: exact pins + committed lockfiles; foliate-js vendored at pinned SHA 78914ae.
- [Phase ?]: [01-02] DRM detect-and-refuse (FND-04): pure-core detect_protection classifies clean/font-obfuscation/content-DRM three ways; never decrypts (D-10); corrupt zips soft-fail; zip-slip guarded on read path
- [Phase 01]: [01-03] Three day-1 seams landed as serde stubs: Publication trait (EPUB-only impl), composite self-healing Locator (never a bare percentage), opaque BookSource storage-handle (D-05/07/08)
- [Phase 01]: [01-03] Schema v1 (work/locator/change_log with UUID + blake3 content hash + per-device monotonic logical clock) migrates off-device via tauri-plugin-sql; single SQLite binding (Pitfall 6); present-but-unsynced so P5/P7 are additive (D-09)
- [Phase 02]: Frontend unit tests use exact-pinned vitest 3.2.4 for pure reading helpers — Wave 0 Nyquist sampling before chrome/prefs land; engine E2E remains manual
- [Phase 02]: SQL caps grant sql:default + sql:allow-execute only; Foliate types live in foliate-types.ts — Unblock prefs/locator SQL for 02-02 and prevent API inventing in later waves
- [Phase 02]: Settings bottom Sheet + ToggleGroup for live mode; goToTextStart after open; FXL locks mode toggle — 02-02 extends sheet sections; D-25 early; soft FXL product rule
- [Phase 02]: SCHEMA_V2 seeds global defaults; loadReadingPrefs fails soft to DEFAULT_PREFS — SQL unavailable outside Tauri; defaults match UI-SPEC
- [Phase 02]: PREFS_SAVE_DEBOUNCE_MS=400 with unmount flush — D-22 auto-save without spamming SQLite
- [Phase 02]: UNIQUE idx_locator_work_id for one progress row per work — Enables 02-03 upsert without rewriting v1 locator table
- [Phase 02]: work_id = blake3 content_hash hex; fallback work-{registry_id} — uuid crate only enables v4; content-addressed identity matches D-09
- [Phase 02]: ensure_work hashes in Rust; frontend INSERT OR IGNORE + locator upsert — Plan recommended path; keeps book bytes off IPC (D-06)
- [Phase 02]: Immersive default + 500ms locator debounce/flush; no 3s auto-hide — READ-04/D-24; optional auto-hide skipped per CONTEXT discretion
- [Phase 02]: Font serve via pillow /fonts/{id} jailed under app_data/fonts; SQL metadata frontend-owned — READ-06/D-30; no font bytes over IPC
- [Phase 02]: Search uses view.search whole book + buildSearchOpts without matchWholeWords — READ-07/D-31 CJK grapheme path

### Pending Todos

None yet.

### Blockers/Concerns

Carried from research — resolve during phase planning, not blocking start:

- [Phase 1]: WebView-engine strategy (system WebView vs bundled Chromium) is architectural — decide early; affects CJK CSS parity.
- [Phase 3]: Blink-vs-WebKit CJK CSS parity + font bundling/embedding-license need engine-specific research (`--research-phase`).
- [Phase 7]: WebDAV conflict/merge model is MEDIUM confidence — design against a real proxied WebDAV server (`--research-phase`).

### Major Issues (tracked)

- **[MAJOR][READER-POS] Continuous-scroll position continuity incomplete** — see Deferred Items. Do **not** keep patching ad-hoc in Phase 3; resolve with Phase 4 library progress SSOT (+ Phase 5 locator formalization). Current known failures after Phase-2 reading-core:
  1. Paginate → scroll still lands at book start (stream seed / jump race).
  2. Scroll-mode TOC chapter jump still no-ops (href→spine resolve / jump apply).
  3. Scroll resume / dual-surface jump bus remains fragile (foliate host hidden + ContinuousScrollStream stacked iframes).
  - What already works: pure scroll pan no longer auto-jumps to start; scroll → paginate is acceptable.
  - Note: SQL alone does **not** fix jump/TOC; the hard part is frontend dual-surface position ownership.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| MAJOR / Reader position | Continuous-scroll position continuity (paginate↔scroll seed, scroll TOC jump, dual-surface resume SSOT). Defer to **Phase 4 Local Library** progress model; formalize further in **Phase 5** composite locator. Tracking id: `READER-POS`. | Deferred → Phase 4 (+ Phase 5) | 2026-07-16 |

## Session Continuity

Last session: 2026-07-15T18:41:42.038Z
Stopped at: Phase 3 context gathered
Resume file: .planning/phases/03-cjk-typography-differentiation/03-CONTEXT.md
