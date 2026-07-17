# Phase 4 Reader Overhaul — plan + verified root causes

**Recorded:** 2026-07-16 · **Decisions:** UI/UX 全量到位 · 主色朱砂 `#B4472F`+墨色 · 自动推进+阶段验收
**Verification gate (every phase):** `pnpm test` + `tsc` + `pnpm build` green **and** Android AVD `pnpm tauri android dev` 人工/截图验收 (CLAUDE.md hard gate).

Research: `subagents/workflows/wf_677a1cf9-fbd` (Readest / foliate-js / epub.js / Readium / Apple Books / Kindle). Core lesson: **CFI is the one position currency; offset/% is cosmetic; re-pin on reflow, never clear on timer/scroll.**

## Root causes (verified, file:line)

| id | bug | where | fix |
|----|-----|-------|-----|
| C1 | scroll resume lands at chapter/book top | `ContinuousScrollStream.tsx:451` emits section **base** cfi; `FoliateView.tsx:1130` stores it as real cfi → offset dropped | reportProgress emits **fine** cfi via existing `visibleRangeCfi()`; else null so offset token wins |
| C2 | every real-cfi restore in scroll mode fails | `scroll-cfi.ts:183` `cfiToRange` never strips CFI spine indirection before `toRange` (foliate `resolveCFI` shifts it) | shift spine part like `(parts.parent ?? parts).shift()` |
| C3 | scroll TOC jump no-op | `ContinuousScrollStream.tsx:491` onScroll clears pendingJump on ANY scroll; load-driven layout scroll kills it | clear only on **user-intent** scroll; re-pin on reflow; drop 450ms auto-clear |
| C4 | far TOC jump can't land | `ContinuousScrollStream.tsx:334` requires all preceding heights; far jump loads sparse | reset loaded to contiguous band at target; land by live rect |
| C5 | jumps lost mid-command | `FoliateView.tsx:1205` inline onReady/onTap change identity → onReady effect nulls `streamApiRef` each render | useCallback the stream handlers |
| C6 | paginate→scroll → book start | `FoliateView.tsx:1192` stream mounts reading stale `continuousStartRef=0`; `reading-position.ts:96` spine defaults 0 when `section.current` missing | seed ref synchronously on switch; resolve spine from cfi as last resort |

## Perf (task 2) — DONE (safe subset) + deferred

Shipped (low-risk, desktop-green): `injectStyles` decoupled from urlTick/loaded (kills O(N²) reflow storm; re-inject only on CSS/shim change + a scroller ResizeObserver for --pillow-vh); `reportProgress` reads `loadedRef` (no scroll-effect re-subscription churn); unmount frees every section doc/blob (`sec.unload`); loaded-diff unload on far-jump reseed (bounds jump-heavy memory + fixes reviewer #5). C5 stable handlers also cut effect churn.

Deferred (risk): in-session distance-based unload of far sections during *pure scroll-through* — the naive version thrashes against the re-load effect. A correct fix needs scroll-synchronous windowing (content-visibility spacers for every section, persisted heights). Pure long-scroll still accumulates iframes; revisit if the device pass shows memory pressure.

## Images (task 3)

`buildReadingCss` injects zero `img` rules. Add `img,svg,video{max-width:100%;max-height:var(--pillow-vh,100svh);width:auto;height:auto;object-fit:contain;...}` to BOTH surfaces. **Scroll iframes are content-height → `vh` is meaningless**; inject `--pillow-vh` = `scroller.clientHeight` px. Keep width/height plain `auto` (attribute aspect-ratio → no CLS). Don't fight foliate paginate `setImageSize`.

## UI/UX (task 4, 全量)

Palette: accent `#B4472F` 朱砂, paper `#FFFEF9/#F4ECD8/#12100E`, ink `#1C1915`, hairline rules, CJK UI font, strip Vite scaffold, no glass/gradient.
P0: bottom draggable scrubber + chapter ticks; `返回原位` undo pill + `正在定位…`; Aa live CJK preview strip; edge-to-edge.
P1: settings grouped 字体/版式/中文/主题/控制 + 版式预设; 竖排 (mode-aware); theme swatches + brightness (+warmth); animate chrome (reduced-motion); swipe page-turn (paginate); TOC scrollIntoView.
P2: long-press selection bubble (annotations groundwork); optional always-on status footer; edge-swipe brightness; desktop keyboard nav.

## Sequence

1. **Bugs** C1–C6 + fix blind-spot test (scroll-cfi toRange). 2. **Perf** structural virtualization. 3. **Images**. 4. **UI/UX**.
