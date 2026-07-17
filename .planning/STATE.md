---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Phase 5 UI-SPEC approved
last_updated: "2026-07-17T13:52:25.826Z"
last_activity: 2026-07-17 -- Phase 05 planning complete
progress:
  total_phases: 7
  completed_phases: 4
  total_plans: 23
  completed_plans: 18
  percent: 57
---

<!-- NOTE (2026-07-17): the 2026-07-16..17 work ran AD-HOC (outside GSD) at the
     user's direction. It delivered GSD Phase 4 (Local Library) AND the bulk of
     GSD Phase 6 (TXT / multi-format: PDF, MOBI, AZW3, TXT + engine metadata/
     covers), out of roadmap sequence. GSD Phase 5 (Annotations) is PLANNED only
     — see docs/READER-PHASE5-ANNOTATIONS-PLAN.md. Next GSD session should
     reconcile phase status (e.g. an audit) before executing, then plan/execute
     Phase 5. All work is on `main` (PR #1), all commits GitHub-Verified. -->

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-09)

**Core value:** 在任意一端打开书，都能以干净、舒适的中文排版稳定阅读，并与自托管（WebDAV）书库/进度状态可靠互通。
**Current focus:** Phase 04 — local-library

## Current Position

Phase: 04 (local-library) — DELIVERED (ad-hoc). Phase 06 (formats) — bulk DELIVERED ahead of sequence. Phase 05 (annotations) — PLANNED, next.
Status: Ready to execute
Last activity: 2026-07-17 -- Phase 05 planning complete

Progress: [██████░░░░] ~60% (Phases 1–4 done; Phase 6 formats done ahead; Phase 5 planned)

Delivered 2026-07-16..17 (ad-hoc, verified on Android AVD, all formats + both modes):

- Phase 4 Local Library: cover grid + filters, dual ingest, continuous-scroll CFI position core (READER-POS resolved), 朱砂 UI/UX, draggable scrubber.
- Phase 6 (formats, ahead of sequence): PDF (pdf.js), MOBI, AZW3, TXT (custom adapter) rendering; engine title/author/cover backfill; in-book links (filepos:/kindle:); 简繁/词不拆行 for all formats incl. TXT.
- Phase 5 (annotations): plan only — docs/READER-PHASE5-ANNOTATIONS-PLAN.md.

Next GSD entry point: reconcile phase status (audit), then `/gsd-plan-phase` / `/gsd-execute-phase` for Phase 5 (annotations). Work on `main` (branching_strategy: none).

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

- **[MAJOR][READER-POS] Continuous-scroll position continuity — RESOLVED (2026-07-17, Phase 4).** All three failures fixed: (1) paginate→scroll seeds continuousStartRef synchronously; (2) scroll TOC jump resolves href→spine via resolveNavigation + jump bus (no-op fixed); (3) dual-surface resume via single jump bus (`jumpContinuousToSpine` imperative API + re-pin on reflow, bounded window). CFI is the single position currency; fine-CFI on progress, offset fallback. Verified on AVD (TOC multi-jump, resume, mode-switch). Formalize composite locator further in Phase 5 as planned.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| MAJOR / Reader position | Continuous-scroll position continuity (paginate↔scroll seed, scroll TOC jump, dual-surface resume SSOT). Defer to **Phase 4 Local Library** progress model; formalize further in **Phase 5** composite locator. Tracking id: `READER-POS`. | Deferred → Phase 4 (+ Phase 5) | 2026-07-16 |

## Session Continuity

Last session: 2026-07-17T13:00:32.164Z
Stopped at: Phase 5 UI-SPEC approved
Resume file: .planning/phases/05-annotations-composite-locator/05-UI-SPEC.md
Resume action: reconcile GSD phase status vs shipped code (Phase 4 done, Phase 6 formats done ahead), then plan/execute Phase 5 (annotations).
