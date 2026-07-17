# Phase 5 — Annotations / Highlights (批注·高亮·笔记·书签)

**Status:** planning · **Depends on:** Phase 4 CFI position core (done), multi-format kernel (done)
**Verification gate (every task):** `pnpm test` + `tsc` + `pnpm build` green **and** Android AVD `pnpm tauri android dev` 人工/截图验收 — in **both** paginate and scroll, and across reopen + mode-switch (CLAUDE.md hard gate).

Core lesson carried from P4: **CFI is the one position currency.** An annotation is a CFI **range** + presentation; everything else (offset/%, screen rects) is derived and re-pinned on reflow.

## Goals / scope

- **Highlight** (color palette), **underline**, **note** (highlight + text), **bookmark** (whole-位置 marker, no range).
- **Selection UI**: long-press / selection-end floating bubble → 颜色 / 笔记 / 复制 / (查词 later). Clean-room, 朱砂 palette.
- **Persist + restore**: load a work's annotations on open, draw them; survive reopen, resize, font/版式 change, and paginate↔scroll switch.
- **Sync-ready** from day one: per-record revision + content hash + `change_log` rows (CLAUDE.md: annotations merge additively, never last-write-wins-clobber).
- Out of scope (later): 查词/字典, cross-device conflict UI, export.

## foliate API (grounded — `view.js` / `overlayer.js`)

- `view.addAnnotation(annotation, remove=false)` / `view.deleteAnnotation(a)` — `annotation.value` is a CFI; foliate resolves it to `{index, range}` and emits **`draw-annotation`** `{ draw, annotation, doc, range }`. Our listener calls `draw(Overlayer.highlight, { color })`.
- `Overlayer` statics: `highlight`, `underline`, `strikethrough`, `squiggly`, `outline`, `copyImage` — SVG rects over the content, `redraw()` on reflow. Vars: `--overlayer-highlight-opacity/-blend-mode`.
- Per-section overlayer is created via the **`create-overlayer`** event — **paginate renderer only**. `view.getCFI(index, range)` builds a CFI from a selection Range.
- Selection lives in the section iframe: `doc.defaultView.getSelection()`.

## Key technical challenges / decisions

| # | challenge | plan |
|---|-----------|------|
| A | **Scroll mode has no foliate overlayer** (ContinuousScrollStream owns its own iframes — same gap as in-book links & CJK transform). | Draw in scroll ourselves. **Decision to lock in research:** prefer the **CSS Custom Highlight API** (`CSS.highlights` + `::highlight()`, Chromium 105+, our WebView 134 has it) — no DOM overlay, no per-reflow SVG redraw, survives layout. Fallback: instantiate foliate `Overlayer` per section iframe + `redraw()` on the existing reflow hooks (`injectStyles`/ResizeObserver). Paginate keeps foliate's native overlayer. |
| B | **Selection → CFI range** in both modes. | Paginate: `view.getCFI(index, range)`. Scroll: reuse `scroll-cfi.ts` (already resolves range↔CFI per section) → a `{ cfi, cfiEnd }` or a single range-CFI. Store the range-CFI as the anchor. |
| C | **Selection detection + bubble positioning** across sandboxed iframes. | Listen `selectionchange`/`pointerup` inside each section doc (same injection point as the link-click + autospace shim). Compute the selection's client rect, map iframe→page coords, position a React bubble. Debounce; dismiss on scroll/tap-away. |
| D | **Restore + reflow redraw.** | On open, load annotations for `work_id`; paginate → `view.addAnnotation` each (foliate redraws on pagination); scroll → draw into each section iframe as it loads (mirror link/shim injection), redraw on the reflow hooks. Mode-switch re-applies from the same store. |
| E | **CFI stability vs content transforms.** | 简繁/词不拆行 rewrite content pre-render (transformTarget). Annotations created under a given transform state must still resolve — store the range-CFI (transform is length-preserving for 简繁; 词不拆行 wraps spans → verify CFI survives, else store a text-anchor fallback). **Research item.** |

## Data model (new — schema v7; `change_log` already exists for sync)

```
CREATE TABLE annotation (
  annotation_id TEXT PRIMARY KEY,      -- uuid/hash
  work_id       TEXT NOT NULL,
  type          TEXT NOT NULL,         -- highlight | underline | note | bookmark
  cfi           TEXT NOT NULL,         -- range-CFI (or point-CFI for bookmark)
  color         TEXT,                  -- palette key (null for bookmark)
  text_excerpt  TEXT,                  -- selected text snapshot (search/list/anchor-fallback)
  note          TEXT,                  -- user note (type=note)
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  revision      INTEGER NOT NULL DEFAULT 1,   -- sync
  content_hash  TEXT                         -- sync dedup/merge
);
CREATE INDEX idx_annotation_work ON annotation(work_id);
```
Bookmarks = `type=bookmark` (point-CFI, no color/range) to keep one store + one sync path.

## UI (朱砂, clean-room from UI-SPEC)

- **Selection bubble**: color swatches (highlight) · 下划线 · 笔记 · 复制 · (查词 disabled/later). Appears above/below selection, arrow to anchor.
- **Note editor**: sheet for type=note (create/edit), shows excerpt + textarea.
- **Annotations sheet**: list grouped by chapter → tap jumps (reuse `handleTocNavigate`/jump bus), swipe delete, edit note.
- **Bookmark**: toggle in chrome top bar (current-position point-CFI) + shown in annotations sheet.
- Tapping an existing highlight → re-opens the bubble (edit color / add note / delete).

## Sequence

1. **Store + schema v7** (`annotation` table, `annotation-store.ts`, sync fields + change_log rows) + unit tests.
2. **Selection → range-CFI** both modes (C-injection + B-resolve) + a runnable check.
3. **Drawing**: paginate via foliate `draw-annotation`; scroll via CSS Highlight API (research A) — highlight/underline first.
4. **Selection bubble UI** → create highlight/underline; **note editor**.
5. **Restore on open** + reflow/mode-switch redraw; tap-existing → edit/delete.
6. **Annotations sheet** + **bookmarks**.
7. **Sync-ready** pass (revision/hash/change_log verified; no clobber).

## Research to run first (before task 1)

- CSS Custom Highlight API in Android System WebView 134 (multi-range, `::highlight()` styling, per-iframe registration) vs per-section foliate Overlayer cost — **decision A**.
- CFI-range survival under 词不拆行 span-wrapping (decision E) — pick range-CFI vs text-anchor fallback.
- Readest / Lithium / Apple Books annotation UX + data shape (bubble, color set, note affordance) — clean-room only, don't copy AGPL Readest code.

## Known parallels (reuse, don't reinvent)

Scroll-mode iframe injection (link-click, autospace shim, CJK transform) is the **same seam** annotations need for selection + drawing — factor a shared "per-section-doc hook" if it stays clean. Jump bus (`jumpContinuousToSpine`, `view.goTo`) already handles list→location navigation.
