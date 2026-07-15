---
phase: 02-epub-reading-core
plan: 01
subsystem: ui
tags: [foliate-js, shadcn, reader-chrome, flow-toggle, READ-01, data-theme]

# Dependency graph
requires:
  - phase: 02-epub-reading-core
    provides: flowAttr / DEFAULT_PREFS / foliate-types / vitest helpers (02-00)
  - phase: 01-foundation
    provides: FoliateView DRM+pillow open path, shadcn button scaffold
provides:
  - UI-SPEC reader chrome shell (toolbar + 2px progress + data-theme root)
  - Live paginate↔scroll via renderer.setAttribute("flow", flowAttr(...))
  - shadcn sheet/slider/toggle-group/input/scroll-area/separator (+toggle)
  - Settings bottom Sheet stub with 阅读模式 ToggleGroup for 02-02 extension
affects:
  - 02-02 typography/theme prefs + SCHEMA_V2
  - 02-03 immersive tap zones + TOC + locator
  - 02-04 custom fonts + search sheets

# Tech tracking
tech-stack:
  added: [sheet, slider, toggle-group, toggle, input, scroll-area, separator (shadcn official)]
  patterns:
    - "flow only via setAttribute + flowAttr helper (never JS property)"
    - "Reader dual-layer data-theme tokens independent of OS dark"
    - "Settings sheet extensible sections; live apply no reload (D-22)"

key-files:
  created:
    - src/reader/ReaderChrome.tsx
    - src/reader/ProgressBar.tsx
    - src/components/ui/sheet.tsx
    - src/components/ui/slider.tsx
    - src/components/ui/toggle-group.tsx
    - src/components/ui/toggle.tsx
    - src/components/ui/input.tsx
    - src/components/ui/scroll-area.tsx
    - src/components/ui/separator.tsx
  modified:
    - src/reader/FoliateView.tsx
    - src/index.css
    - src/App.css

key-decisions:
  - "Settings uses real bottom Sheet + ToggleGroup for mode so 02-02 extends sections"
  - "goToTextStart after open instead of bare renderer.next() (D-25 early)"
  - "FXL pre-paginated disables mode toggle (soft product rule)"
  - "chromeVisible defaults true this plan; immersive hide is 02-03"

patterns-established:
  - "Pattern: FoliateView composition root owns engine + chrome + sheets"
  - "Pattern: ReaderChrome props for title/fraction/slots; ProgressBar fraction 0..1"
  - "Pattern: setAttribute('flow', flowAttr(mode)) on every mode change without view.open"

requirements-completed: [READ-01]

# Metrics
duration: 2min
completed: 2026-07-15
---

# Phase 2 Plan 01: Reading Chrome + Live Flow Toggle Summary

**UI-SPEC reader shell with live paginate↔scroll via `setAttribute('flow', flowAttr(...))` and official shadcn sheet primitives**

## Performance

- **Duration:** 2 min
- **Started:** 2026-07-15T13:21:17Z
- **Completed:** 2026-07-15T13:23:05Z
- **Tasks:** 2/2
- **Files modified:** 12

## Accomplishments

- Installed official-registry shadcn primitives for later sheets (sheet, slider, toggle-group, input, scroll-area, separator; toggle transitive)
- Replaced Phase 1 关闭/下一页 chrome with UI-SPEC toolbar (返回 / title / 进度% / 目录 / 搜索 / 显示设置) + 2px accent progress bar
- Dual-layer `data-theme="day|night|sepia"` reader tokens; `min-height: 0` view host preserved
- READ-01: mode ToggleGroup in 显示设置 bottom Sheet applies flow live without reopening the book
- Open path uses `goToTextStart()` + initial `flowAttr`; FXL books lock mode toggle

## Task Commits

Each task was committed atomically:

1. **Task 1: Install official shadcn primitives for reader sheets** - `ebcf92e` (chore)
2. **Task 2: Reader shell structure + live flow toggle (READ-01)** - `47929a9` (feat)

**Plan metadata:** (pending docs commit)

## Files Created/Modified

- `src/components/ui/sheet.tsx` (+slider, toggle-group, toggle, input, scroll-area, separator) — shadcn official primitives
- `src/reader/ReaderChrome.tsx` — 48px toolbar + progress caption + icon slots
- `src/reader/ProgressBar.tsx` — 2px hairline accent progress
- `src/reader/FoliateView.tsx` — composition root, flow toggle, settings sheet stub
- `src/index.css` — reader `[data-theme]` paper-feel tokens
- `src/App.css` — fixed flex reader layout + chrome styles

## Decisions Made

- Prefer real Settings Sheet + ToggleGroup over inline control so 02-02 extends sections rather than rebuilds
- Early D-25: first open uses `goToTextStart()` (full locator restore still 02-03)
- FXL (`pre-paginated`) disables 阅读模式 toggle with helper caption
- `chromeVisible` prop wired but default true (immersive hide deferred to 02-03)

## Deviations from Plan

None - plan executed exactly as written.

(Transitive `toggle.tsx` generated with toggle-group — expected shadcn dependency, not a scope change.)

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- READ-01 foundation shipping; ready for 02-02 typography/theme + SCHEMA_V2 prefs
- Sheet primitives installed for TOC/search/settings expansion
- Engine still DRM-gated + pillow:// only (T-02-ipc / D-06)
- TOC/Search toolbar handlers intentionally stubbed until 02-03

## Verification

- `pnpm test` — 4 files / 19 tests passed
- `pnpm build` — tsc + vite build passed
- Grep: `setAttribute` + `flowAttr` + `goToTextStart` present; no primary 下一页; 显示设置/目录/搜索/返回 present; `data-theme="day"` tokens; `min-height: 0`; registries empty

## Self-Check: PASSED

- FOUND: `src/components/ui/sheet.tsx`
- FOUND: `src/reader/ReaderChrome.tsx`
- FOUND: `src/reader/ProgressBar.tsx`
- FOUND: `src/reader/FoliateView.tsx` (≥120 lines, setAttribute)
- FOUND: commit `ebcf92e`
- FOUND: commit `47929a9`

---
*Phase: 02-epub-reading-core*
*Completed: 2026-07-15*
