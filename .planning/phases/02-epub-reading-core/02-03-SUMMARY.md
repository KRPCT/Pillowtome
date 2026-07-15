---
phase: 02-epub-reading-core
plan: 03
subsystem: ui
tags: [foliate-js, immersive, tap-zones, toc, locator, ensure_work, READ-04, READ-05]

# Dependency graph
requires:
  - phase: 02-epub-reading-core
    provides: tap-zones/toc helpers, UNIQUE locator index, prefs shell, FoliateView open path (02-00..02-02)
  - phase: 01-foundation
    provides: SourceRegistry, pillow://, schema v1 work/locator, EpubPublication blake3
provides:
  - Immersive chrome default + ReaderTapZones (READ-04)
  - TocSheet with goTo(href) (READ-05)
  - ensure_work IPC (workId+contentHash only) + locator-store upsert/load
  - Debounced relocate persist + unmount flush + CFI restore / goToTextStart (D-23..D-26)
  - Desktop Esc / arrows / PageUp/PageDown (D-33 partial)
affects:
  - 02-04 search sheet + custom fonts + keyboard `/` Ctrl+F
  - Phase 5 annotations (locator table already in use for progress)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ensure_work returns only workId+contentHash; frontend INSERT OR IGNORE work"
    - "Locator upsert ON CONFLICT(work_id) with $n binds; 500ms debounce + unmount flush"
    - "Immersive: chromeVisible=false on reading; center toggle; L/R page in paginate"

key-files:
  created:
    - src/reader/ReaderTapZones.tsx
    - src/reader/TocSheet.tsx
    - src/reader/locator-store.ts
  modified:
    - src/reader/FoliateView.tsx
    - src/App.css
    - src-tauri/src/commands.rs
    - src-tauri/src/lib.rs

key-decisions:
  - "work_id = blake3 content_hash hex (no UUID v5; crate only enables v4); fallback work-{registry_id}"
  - "ensure_work hashes in Rust; frontend owns SQL INSERT OR IGNORE + locator upsert"
  - "Skipped optional 3s chrome auto-hide (CONTEXT discretion)"
  - "Search shortcut deferred to 02-04 (SearchSheet not present)"

patterns-established:
  - "Pattern: relocate → scheduleLocatorUpsert(500ms) → force flush on unmount/back"
  - "Pattern: invalid CFI soft-fails to goToTextStart without modal (D-25)"
  - "Pattern: sheets disable tap zones via pointer-events; Esc closes sheet first"

requirements-completed: [READ-04, READ-05]

# Metrics
duration: 4min
completed: 2026-07-15
---

# Phase 2 Plan 03: Immersive Reading, TOC & Locator Progress Summary

**Immersive tap zones + TOC goTo + composite locator restore/persist via ensure_work (no book bytes over IPC)**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-15T13:28:57Z
- **Completed:** 2026-07-15T13:33:30Z
- **Tasks:** 2/2
- **Files modified:** 7

## Accomplishments

- `ensure_work` command: SourceRegistry → resolve_bytes → blake3 via `EpubPublication::from_bytes` → `{ workId, contentHash }` only (D-06/D-26)
- `locator-store.ts`: load/upsert with `ON CONFLICT(work_id)`, `LOCATOR_DEBOUNCE_MS=500`, relocate→row mapper
- Immersive default when status becomes `reading`; center 34% toggles chrome; L/R 33% page in paginate; scroll zones toggle only (READ-04)
- `TocSheet` 目录 with flattenToc, left drawer ≥768px / bottom on phone, empty 暂无目录, goTo(href) (READ-05)
- Restore: loadLocator → goTo(cfi) or goToTextStart; invalid CFI soft-fail; unmount/back flush (D-23..D-25)
- Desktop keys: ArrowLeft/Right, PageUp/Down, Escape (D-33 partial; search shortcut deferred)

## Task Commits

Each task was committed atomically:

1. **Task 1: ensure_work + locator-store (D-23..D-26)** - `c0ece2e` (feat)
2. **Task 2: Immersive chrome, tap zones, TOC, keyboard, restore/flush** - `4d2afba` (feat)

**Plan metadata:** (pending docs commit)

## Files Created/Modified

- `src-tauri/src/commands.rs` — `ensure_work` + `EnsureWorkResult` + pure work_id helpers/tests
- `src-tauri/src/lib.rs` — register `ensure_work` in generate_handler
- `src/reader/locator-store.ts` — load/upsert/ensureWorkRow/relocateToLocatorRow
- `src/reader/ReaderTapZones.tsx` — transparent L/C/R overlay
- `src/reader/TocSheet.tsx` — 目录 sheet/drawer
- `src/reader/FoliateView.tsx` — immersive lifecycle, locator, TOC, keyboard
- `src/App.css` — tap-zone + TOC paper-feel styles

## Decisions Made

- Content-addressed `work_id` = blake3 hex (documents UUID v5 alternative avoided due to uuid feature set)
- Rust hash path + frontend SQL path (recommended clean path from plan)
- No 3s auto-hide timer (optional per CONTEXT)
- Search toolbar remains stub until 02-04

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- READ-04 / READ-05 delivered
- Locator progress path ready for P5 annotations reuse
- Ready for 02-04: custom fonts, search sheet, keyboard `/`/Ctrl+F, torture soft-fail
- Engine still DRM-gated + pillow:// only; no book bytes over IPC

## Verification

- `cargo test --workspace` — all passed (MSVC; ensure_work unit tests green)
- `pnpm test` — 4 files / 19 tests passed
- `pnpm build` — tsc + vite build passed
- Grep: ensure_work registered; ON CONFLICT + LOCATOR_DEBOUNCE_MS=500; resolveTapZone/tapZoneAction; 目录/暂无目录; goToTextStart; Escape/ArrowLeft; no 下一页

## Self-Check: PASSED

- FOUND: `src/reader/ReaderTapZones.tsx`
- FOUND: `src/reader/TocSheet.tsx`
- FOUND: `src/reader/locator-store.ts`
- FOUND: `src/reader/FoliateView.tsx`
- FOUND: `src-tauri/src/commands.rs`
- FOUND: `src-tauri/src/lib.rs`
- FOUND: commit `c0ece2e`
- FOUND: commit `4d2afba`

---
*Phase: 02-epub-reading-core*
*Completed: 2026-07-15*
