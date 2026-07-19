---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Phase 7 executed + Android keyring spike fixed; both ends deployed for manual review
last_updated: "2026-07-19T02:05:00.000Z"
last_activity: 2026-07-19
progress:
  total_phases: 7
  completed_phases: 4
  total_plans: 31
  completed_plans: 29
  percent: 68
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
**Current focus:** Phase 05 — annotations-composite-locator

## Current Position

Phase: 05 (annotations-composite-locator) — EXECUTING
Plan: 7 of 8 (05-08 device acceptance remaining)
Status: Ready to execute
Last activity: 2026-07-18

Progress: [█████████░] 88%

2026-07-18 (branch fix/05-selection-bubble): 05-07 完成 —— 原生 ActionMode 抑制 + debug session `selection-bubble-not-showing` 修复五根因（sandbox timer 死亡 / ReaderTapZones 覆盖层 / TXT CFI 回退 / 分页横带坐标 / tap-zone 同病），设备三轮实证 + 用户人工验收通过。证据：.planning/debug/resolved/。

Device gate (05-05) findings: .planning/phases/05-annotations-composite-locator/05-DEVICE-GATE-FINDINGS.md

- FIXED (committed 25e9a23): app CSP blocked blob: → EPUB/PDF/MOBI/TXT unrenderable in production build (pre-existing since Phase 1, masked by dev-only gate). EPUB + PDF now render on AVD.
- DEFECT 1 (RESOLVED 2026-07-18, 05-07): native WebView selection ActionMode preempts custom SelectionBubble → SuppressSelectionActionModeFrameLayout 抑制 + 五根因修复，两模式气泡设备实证。Blocks the 8-step annotation acceptance.
- DEFECT 2 (minor): PDF outline resolve throws `Te.id.endsWith is not a function` (FoliateView spine resolution assumes string id; PDF ref ids are numeric). Non-fatal; PDF renders.

Delivered 2026-07-16..17 (ad-hoc, verified on Android AVD, all formats + both modes):

- Phase 4 Local Library: cover grid + filters, dual ingest, continuous-scroll CFI position core (READER-POS resolved), 朱砂 UI/UX, draggable scrubber.
- Phase 6 (formats, ahead of sequence): PDF (pdf.js), MOBI, AZW3, TXT (custom adapter) rendering; engine title/author/cover backfill; in-book links (filepos:/kindle:); 简繁/词不拆行 for all formats incl. TXT.
- Phase 5 (annotations): plan only — docs/READER-PHASE5-ANNOTATIONS-PLAN.md.

Next GSD entry point: `/gsd-execute-phase 05` — 05-08 (device acceptance, depends_on 05-07, now unblocked). Work on `fix/05-selection-bubble` (user-directed branch off main; STATE 历史行为记录 branching_strategy: none).

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
| Phase 05 P01 | 12 | 2 tasks | 4 files |
| Phase 05 P02 | 8min | 3 tasks | 6 files |
| Phase 05 P03 | 13 | 3 tasks | 6 files |
| Phase 05 P4 | 20 | 3 tasks | 9 files |
| Phase 05 P05-06 | 3 | 2 tasks | 3 files |

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
- [Phase ?]: [05-01] annotation content_hash = WebCrypto SHA-256 (frontend, no IPC, no new dep), hash_algo tagged per change_log row; two-algorithm split from work.content_hash blake3 — P7 reads hash_algo per record
- [Phase ?]: [05-01] change_log monotonic clock = COALESCE(MAX(logical_clock) per device)+1 computed inside a single atomic INSERT; sync_meta holds device_id only (logical_clock reserved). Delete is a tombstone (deleted=1), never physical DELETE
- [Phase ?]: [05-02] resolveAnchor: one shared CFI→text_context→fraction self-healing chain (D-77) for both locator + annotation restore; never a bare percentage (D-78)
- [Phase ?]: [05-02] anchor text search normalizes to Simplified (convertText t2s), maps offsets only when t2s length-preserving; no jsdom added — minimal in-test DOM + real foliate fromRange/toRange round-trip
- [Phase ?]: [05-03] 滚动高亮走 CSS Custom Highlight API（live Range 零手动重绘），旧机退 per-iframe foliate Overlayer；分页高亮全走闭合-shadow 事件
- [Phase ?]: [05-03] ::highlight registry 名只从 cinnabar|ochre|green|indigo allowlist 构造（T-05-07）；Overlayer 传纯色种子（自带 opacity），滚动半透明由 --anno-*-fill CSS 给
- [Phase ?]: [05-03] 批注重放懒式逐 section（Pitfall 9）；分页 CFI 断裂经 resolveAnchor + view.getCFI 自愈并 upsertAnnotation 回写；重放由 annotations prop 声明式驱动
- [Phase ?]: [05-04] Note stored on its highlight row (note field set, type kept) — never flips to type='note', which 05-03's highlight/underline-only draw would un-draw
- [Phase ?]: [05-04] --anno-* injected into reading CSS (iframe scope) as well as index.css — section iframes are separate docs; custom props do not cascade for ::highlight()/paletteColor()
- [Phase ?]: [05-04] FoliateView owns annotation state; selection bubble mounted once on the shared reader root; edit-context bubble is paginate-only
- [Phase ?]: [05-06] matchSectionByHref: unknown 参数 + typeof 守卫,PDF 数字 ref 静默跳过不抛错;纯函数集中一处修覆盖所有 spine path-match 调用方

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

Last session: 2026-07-18T10:05:00.000Z
Stopped at: Phase 7 executed (5/5 plans, code complete) — device acceptance batch pending
Resume file: .planning/phases/07-webdav-self-hosted-sync/07-04-SUMMARY.md
Resume action: Phase 7 WebDAV sync executed end-to-end (07-00..07-04 + raw-agent auth fix; cargo 174 green, vitest 212 green). Remaining gates: (a) deferred manual batch — AVD production-APK keyring smoke (07-01-T5; first Android compile of the cfg(android) keyring path) + AVD UI acceptance + real-server matrix 坚果云/代理 Nextcloud/dufs (07-04-T5, D-94); (b) 05-08 device acceptance still open. Next entries: run the manual batch, then `/gsd-verify-work 07`.
