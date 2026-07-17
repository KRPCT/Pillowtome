# MAJOR: Continuous-scroll position continuity (`READER-POS`)

**Status:** Deferred → **Phase 4 Local Library** (progress SSOT) + formalize further in **Phase 5** composite locator  
**Recorded:** 2026-07-16  
**Tracked in:** `.planning/STATE.md` (Major Issues / Deferred Items), `.planning/ROADMAP.md` Phase 4 plan `04-04`

## Why SQL alone is not enough

Phase 4 will make library progress rows first-class (open book from catalog, sort by recently read, show % complete). That is the right **persistence** home for a single progress SSOT.

But the remaining failures are **frontend dual-surface ownership**:

| Surface | Used when |
|---------|-----------|
| `<foliate-view>` engine | paginate mode |
| `ContinuousScrollStream` stacked iframes | continuous scroll mode (foliate has no multi-section continuous scroll) |

SQL can store `{work_id, cfi|pillow-scroll, progress_fraction}` reliably. It cannot by itself:

1. Seed ContinuousScrollStream when switching paginate → scroll  
2. Apply TOC `href → spineIndex` jumps inside the stream while the engine host is hidden  
3. Re-anchor the engine when switching scroll → paginate  

Those need a **single position SSOT + one jump-command bus** in the reader shell. Phase 4 is still the right moment to finish this, because library open/resume forces one entry path for progress.

## RESOLVED — Phase 4 (2026-07-16), device-verified on AVD Medium_Phone_API_36.1

| # | Scenario | Result |
|---|----------|--------|
| 1 | Scroll pan, stop | **PASS** |
| 2 | Paginate mid-book → switch to scroll | **PASS** — stays on chapter (not book start) |
| 3 | Scroll mode TOC chapter jump | **PASS** — lands on target chapter |
| 4 | Scroll → paginate | **PASS** |
| 5 | Scroll scrubber jump | **PASS** |
| 6 | Resume (close + reopen) | **PASS** — restores near last position (offset-token precision) |

Fixes: C1–C6 (see `READER-PHASE4-PLAN.md`) + reviewer-found cross-iframe coordinate bug
(`scroll-cfi.ts` — node rects are iframe-content space; add `iframe.top`; Playwright-verified)
+ **the device-only NaN bug**: `jumpContinuousToSpine` passed the section BASE cfi as the jump
anchor (`?? sec?.cfi`); `resolveCfiScrollTop` resolved it to a non-rendered node → `getClientRects()`
empty → DOMRect.top = `Infinity+(-Infinity)` = NaN → `scrollTop = NaN` (ignored) → jump silently
no-op'd. Fixed: pass only real fine CFIs as anchors; guard `resolveCfiScrollTop` with
`Number.isFinite`. This is why the desktop/unit-green gate wasn't enough — the Android device gate
caught it.

### Former failures (pre-fix, kept for history)

| # | Scenario | Result |
|---|----------|--------|
| 2 | Paginate mid-book → switch to scroll | FAIL — lands at book start |
| 3 | Scroll mode TOC chapter jump | FAIL — no-op / invalid |

## Root-cause class (do not re-learn)

1. **Two renderers, no shared jump bus** — progress reporting and jump commands got coupled; React batching/remount races dropped jumps (`jumpKey` edge lost when remounting with already-updated key).  
2. **TOC resolve** — need authoritative `view.resolveNavigation(href)` / `book.resolveHref` → `{index}`, then stream `jumpTo(index, 0)`.  
3. **Persist dual-track is OK** — `pillow-scroll:{spine}:{offset}` as reliable token; real `epubcfi(...)` optional precision. Whole-book % must never be the sole resume key.  
4. **foliate native `flow=scrolled` is not a drop-in continuous multi-section solution** — one section at a time; native-flow rewrite already abandoned once (ResizeObserver / layout loops). Prefer fixing the stream jump bus over re-trying native continuous scroll unless Phase 4 research revisits it deliberately.

## Required outcome in Phase 4 (`04-04`)

When planning/executing Phase 4:

1. Define **ReadingPosition SSOT** used by library open + reader:
   - `spineIndex` (required)
   - `offsetFraction` 0..1 top-edge within section (required for scroll surface)
   - optional real `cfi`
   - UI `progress_fraction`
2. Persist via existing `locator` / library progress rows (SQL).  
3. Apply via **one imperative jump command** into ContinuousScrollStream (and `view.goTo` / `renderer.goTo` for paginate).  
4. Acceptance gates (device):
   - Open from library resumes last position in both modes  
   - Paginate → scroll stays on same chapter (not book start)  
   - Scroll TOC jumps to target chapter  
   - Scroll → paginate stays on same chapter  
5. Do **not** keep shipping drive-by patches in Phase 3 CJK work unless a one-line blocker appears.

## Related code (snapshot)

- `src/reader/FoliateView.tsx` — mode switch, TOC, progress upsert  
- `src/reader/ContinuousScrollStream.tsx` — stacked iframe continuous surface  
- `src/reader/reading-position.ts` — token encode/parse helpers started during deferral  
- `src/reader/locator-store.ts` — SQLite locator load/upsert  

## Decision

**Defer.** Continue Phase 3 CJK typography. Reopen `READER-POS` as Phase 4 plan **04-04** (library progress SSOT + continuous-scroll position continuity), with Phase 5 locator formalization consuming the same SSOT rather than inventing a third progress model.
