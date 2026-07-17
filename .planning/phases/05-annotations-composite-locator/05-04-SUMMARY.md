---
phase: 05-annotations-composite-locator
plan: 04
subsystem: reader
tags: [annotations, selection-bubble, note-editor, bookmarks, ui, touch-gate, cjk]

# Dependency graph
requires:
  - phase: 05-01
    provides: annotation-store CRUD/tombstone (upsert/list/delete) + AnnotationRow
  - phase: 05-03
    provides: onSelection/onSelectExisting/annotations seams + per-section draw/replay
provides:
  - SelectionBubble — one create/edit action bar, both modes, only pointer-events:auto element
  - NoteEditorSheet — note create/edit over the shared .reader-sheet shell
  - AnnotationsSheet — chapter-grouped list + filter + jump (position-bus) + note-safe delete
  - ReaderChrome 批注 entry + bookmark toggle; --anno-* palette tokens (index.css + reading CSS)
affects: [05-05-device-gate, 07-sync]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bubble mounted once on the shared reader root (.reader__view) in FoliateView; covers paginate + scroll via 05-03's onSelection seam"
    - "--anno-* declared BOTH in index.css (outer chrome / swatches) AND injected into the reading CSS (iframe scope) so ::highlight()/paletteColor() resolve inside the closed section docs"
    - "A note is stored on its highlight row (note field set, type kept) — never flips type to 'note' (that would un-draw the mark under 05-03's highlight/underline-only draw path)"
    - "Annotation/bookmark jumps route through the single position-bus (planJump/capturePosition) → view.goTo / jumpContinuousToSpine; no second navigation or position source"

key-files:
  created:
    - src/components/ui/textarea.tsx
    - src/reader/SelectionBubble.tsx
    - src/reader/NoteEditorSheet.tsx
    - src/reader/AnnotationsSheet.tsx
  modified:
    - src/index.css
    - src/App.css
    - src/reader/apply-reading-styles.ts
    - src/reader/FoliateView.tsx
    - src/reader/ReaderChrome.tsx

key-decisions:
  - "Note keeps the highlight's type + color and only sets the note field (deviates from UI-SPEC's literal type='note'): 05-03 draws only highlight/underline, so a 'note' type would erase the mark. Matches the must_have 'saving writes the note without deleting the highlight'."
  - "--anno-* vars injected into the reading CSS as well as index.css: the section iframes are separate documents, so custom props do not cascade in from the outer .reader root; ::highlight() + paletteColor() read them from the section doc."
  - "FoliateView owns annotation state (App never passed the annotations prop): loads listAnnotations(workId) on open, drives both hosts' draw, and reloads after every mutation."

patterns-established:
  - "Selection bubble coordinate mapping done in the host (FoliateView) where iframe/foliate-view/host rects live; SelectionBubble stays pure (reader-root rect in, above/below flip out)"

requirements-completed: [ANNO-01, ANNO-02, ANNO-03]

# Metrics
duration: 20min
completed: 2026-07-17
---

# Phase 5 Plan 04: Annotation UI Surfaces Summary

**The four annotation surfaces landed and wired to the store + position bus: a single selection bubble (4-color create + edit-with-删除, the only pointer-events:auto element), a note editor over the shared sheet, a chapter-grouped 批注 manager that jumps through the single position-bus and two-step-confirms note deletes, and a toolbar bookmark toggle — all 简体中文, reusing the Phase 2 纸感/朱砂 shell, touch-gate-safe.**

## Performance
- **Duration:** ~20 min
- **Tasks:** 3
- **Files:** 9 (4 created, 5 modified)
- **Verification:** `tsc --noEmit` clean; `pnpm build` succeeds; full suite 156/156 green (no test files added — behavior gated on-device in 05-05).

## Accomplishments
- **SelectionBubble.tsx** — one absolutely-positioned bar for create + edit, both modes. 4 swatches (cinnabar first) + 下划线 + 笔记 + 复制, trailing 删除 in edit context, above/below flip (D-75), inline 已复制. It is the ONLY `pointer-events:auto` element — no full-screen capture layer (D-74). 简体中文 `aria-label`s (高亮·朱砂/赭色/黛绿/靛蓝, 下划线, 笔记, 复制, 删除).
- **--anno-* palette** — cinnabar/ochre/green/indigo + `-fill` declared per theme in `index.css` (day/sepia seed @28%, night tint @30%) AND injected into the reading CSS (`annoPaletteCss`) so the iframe `::highlight()` rules from 05-03 and `paletteColor()` resolve inside the closed section docs.
- **NoteEditorSheet.tsx** — bottom sheet over the exact `.reader-sheet` touch-gate body; read-only excerpt (3-line clamp) + autofocus `textarea` (写点想法…); auto-save on close; empty text keeps the highlight.
- **AnnotationsSheet.tsx** — left drawer ≥768px / bottom sheet on phone; 全部/高亮/笔记/书签 filter; rows grouped by chapter (spine → best-effort TOC label); row tap builds a `ReadingPosition` via `position-bus` and jumps then closes; highlight/bookmark delete immediate, note delete two-step (删除 → 确认删除); 简体中文 empty states per filter.
- **ReaderChrome** — 批注 entry (lucide `Highlighter`) + bookmark toggle (`Bookmark`/`BookmarkCheck`), 44×44, aria-labels 批注 / 添加书签 ↔ 移除书签, accent (aria-pressed) when bookmarked-here.
- **FoliateView** — now owns annotation state (loads `listAnnotations(workId)` on open, redraws both hosts on change), maps section-iframe selection rects into reader-root coords, wires create/underline/copy/delete + note open/save + annotations jump/delete + bookmark toggle (`type='bookmark'`, point-CFI, no color).

## Task Commits
1. **Task 1: selection bubble + --anno-* palette + textarea** — `88124bb` (feat)
2. **Task 2: note editor + annotations management sheets** — `5010628` (feat)
3. **Task 3: bookmark toggle + annotations sheet entry** — `6888706` (feat)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug avoidance] Note stored on the highlight row, not type='note'**
- **Found during:** Task 2
- **Issue:** UI-SPEC says saving a note sets `type='note'`. But 05-03's draw path renders only `highlight`/`underline` rows, so flipping to `note` would silently un-draw the highlight — contradicting the must_have "saving writes the note without deleting the highlight."
- **Fix:** Keep the row's original type + color and only set the `note` field; empty note → `note=null`, highlight kept. AnnotationsSheet's 笔记 filter matches `note != null`.
- **Files:** src/reader/FoliateView.tsx, src/reader/NoteEditorSheet.tsx

**2. [Rule 3 - Blocking] --anno-* vars injected into the reading CSS (iframe scope)**
- **Found during:** Task 1
- **Issue:** 05-03's `::highlight()` rules and `paletteColor()` read `--anno-*` from each section doc, but section iframes are separate documents — custom properties do not cascade in from the outer `.reader` root, so `index.css` alone would leave them undefined inside the iframe.
- **Fix:** Added `annoPaletteCss(theme)` to `apply-reading-styles.ts` and emitted it into the injected `html{}` block. index.css keeps the same tokens for the outer chrome (bubble swatches).
- **Files:** src/reader/apply-reading-styles.ts, src/index.css

**3. [Scope] ContinuousScrollStream not modified; FoliateView selection props dropped**
- The plan listed `ContinuousScrollStream.tsx` under Task 1, but its 05-03 `onSelection` seam + scroll-gesture dismiss are already sufficient; the bubble mounts once on the shared reader root and covers both modes. FoliateView's now-unused `onSelection`/`onSelectExisting` props were removed from the destructure (App never passed them — selection is handled internally).

## Known Stubs
None (functional). Cross-plan seams, not stubs:
- **On-device positioning + finger-swipe delete** are the **05-05** device gate: closed-shadow (paginate) iframe→page coordinate mapping and scroll-mode finger-swipe are only truthfully verifiable on the AVD (CLAUDE.md Android/touch gates).
- **Scroll-mode edit context** (tap an existing highlight → edit bubble) is not wired: CSS Custom Highlight has no hit-testing, so the edit bubble is paginate-only via foliate `show-annotation` (consistent with 05-03, which only exposed `onSelectExisting` for paginate). Recolor/delete of a scroll highlight is reachable via the 批注 sheet.
- **Swipe-to-delete** is rendered as a trailing 删除 control (works on desktop + touch); the horizontal-swipe reveal is a 05-05 device refinement.

## Threat Flags
No new surface. `dangerouslySetInnerHTML` = 0 across all Phase 5 components (note + excerpt are React text nodes, T-05-10 mitigate). `textarea` is an official shadcn source copy — `components.json` `registries:{}` stays empty, no new npm dependency (T-05-SC accept). Bubble is the sole `pointer-events:auto` element; no full-screen capture layer (T-05-12 mitigate; finger-swipe verified in 05-05).

## Next Phase Readiness
- **05-05 device gate:** verify bubble/sheet anchoring in both modes on the AVD, finger vertical-swipe on the sheets, and multi-annotation lazy-draw stress.
- **07-sync:** every create/edit/delete already appends a `change_log` row via annotation-store; the UI adds no new sync surface.

## Self-Check: PASSED
- src/reader/SelectionBubble.tsx / NoteEditorSheet.tsx / AnnotationsSheet.tsx / src/components/ui/textarea.tsx FOUND on disk.
- Commits 88124bb / 5010628 / 6888706 present in git log.
- `tsc --noEmit` clean, `pnpm build` success, 156/156 tests green.

---
*Phase: 05-annotations-composite-locator*
*Completed: 2026-07-17*
