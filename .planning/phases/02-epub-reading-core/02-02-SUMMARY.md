---
phase: 02-epub-reading-core
plan: 02
subsystem: ui
tags: [foliate-js, tauri-plugin-sql, reading-prefs, setStyles, SCHEMA_V2, READ-02, READ-03]

# Dependency graph
requires:
  - phase: 02-epub-reading-core
    provides: flowAttr / DEFAULT_PREFS / PAGE_COLORS / SQL caps / ReaderChrome (02-00, 02-01)
  - phase: 01-foundation
    provides: schema v1 migrations, tauri-plugin-sql binding, FoliateView open path
provides:
  - SCHEMA_V2 reading_prefs + custom_font + idx_locator_work_id
  - Global prefs load/save via plugin-sql bound params (D-20..22)
  - SettingsSheet Aa bottom sheet (mode/theme/font stub/sliders)
  - Live setStyles + margin attribute + data-theme dual-layer themes
affects:
  - 02-03 locator progress upsert (UNIQUE work_id ready)
  - 02-04 custom font import into custom_font + @font-face injection

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Append-only SCHEMA_Vn constants; never rewrite prior schema strings"
    - "Prefs via Database.load(sqlite:pillow.db) + $n binds; never localStorage"
    - "Live apply setStyles/margin/data-theme then debounced save (400ms)"

key-files:
  created:
    - src/reader/reading-prefs.ts
    - src/reader/SettingsSheet.tsx
  modified:
    - src-tauri/src/migrations.rs
    - src-tauri/tests/migration.rs
    - src/reader/FoliateView.tsx
    - src/App.css
    - src/reader/apply-reading-styles.ts

key-decisions:
  - "SCHEMA_V2 seeds global defaults in SQL; loadReadingPrefs fails soft to DEFAULT_PREFS"
  - "PREFS_SAVE_DEBOUNCE_MS = 400; force flush on FoliateView unmount"
  - "Import font CTA present but disabled until 02-04 (no onImportFont)"
  - "FXL books skip flow/setStyles; chrome data-theme still applies"

patterns-established:
  - "Pattern: SettingsSheet controlled via prefs + onPrefsChange(partial)"
  - "Pattern: applyPrefsToRenderer = setAttribute(flow|margin) + setStyles(buildReadingCss)"
  - "Pattern: UNIQUE idx_locator_work_id enables INSERT ON CONFLICT for progress"

requirements-completed: [READ-02, READ-03]

# Metrics
duration: 3min
completed: 2026-07-15
---

# Phase 2 Plan 02: Typography, Themes & Global Prefs Summary

**SCHEMA_V2 reading_prefs + live setStyles/margin/data-theme SettingsSheet with debounced SQLite global prefs**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-15T13:24:27Z
- **Completed:** 2026-07-15T13:28:02Z
- **Tasks:** 2/2
- **Files modified:** 6

## Accomplishments

- Appended SCHEMA_V2: `reading_prefs` (seeded global defaults), `custom_font` metadata stub, `idx_locator_work_id` UNIQUE — without rewriting SCHEMA_V1
- Migration smoke tests cover v2 tables, seed row, unique index enforcement, migration set length 2
- `reading-prefs.ts`: `Database.load("sqlite:pillow.db")`, SELECT/upsert with `$1..$9` binds, 400ms debounce constant
- Full Aa SettingsSheet: 阅读模式 / 主题 / 字体 stub / 字号 / 行距 / 边距 with UI-SPEC 简体中文 copy; live apply, no 应用 button
- FoliateView loads prefs on open, applies flow+margin+setStyles+data-theme, debounces save, flushes on unmount

## Task Commits

Each task was committed atomically:

1. **Task 1: SCHEMA_V2 migration + migration tests** - `0f5c00a` (feat)
2. **Task 2: reading-prefs store + SettingsSheet + live setStyles theming** - `fb2cb06` (feat)

**Plan metadata:** (pending docs commit)

## Files Created/Modified

- `src-tauri/src/migrations.rs` — SCHEMA_V2 + migrations() v1+v2
- `src-tauri/tests/migration.rs` — v2 table/seed/unique/migration-set tests
- `src/reader/reading-prefs.ts` — load/save global prefs via plugin-sql
- `src/reader/SettingsSheet.tsx` — Aa bottom sheet UI-SPEC sections
- `src/reader/FoliateView.tsx` — prefs state, live apply, debounced save
- `src/App.css` — font list + slider caption styles under reader tokens

## Decisions Made

- Fail-soft prefs load → DEFAULT_PREFS (SQL unavailable in pure web tests)
- Debounce 400ms within D-22 auto-save range; unmount flush for durability
- Font import is UI-present but disabled (no handler) until 02-04
- apply-reading-styles.ts left unchanged — PAGE_COLORS/buildReadingCss already correct from 02-00

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Windows cargo test required MSVC toolchain (`stable-x86_64-pc-windows-msvc` + vcvars64) — resolved per HANDOFF; 6/6 migration tests green

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- READ-02 / READ-03 code path complete (sliders/themes → setStyles + data-theme + SQLite)
- Locator UNIQUE ready for 02-03 progress upsert
- `custom_font` table ready for 02-04 import metadata
- No localStorage in prefs path; parameterized SQL only (T-02-sql)

## Verification

- `cargo test --test migration` — 6 passed (MSVC)
- `pnpm test` — 4 files / 19 tests passed
- `pnpm build` — tsc + vite build passed
- Grep: `sqlite:pillow.db`, `ON CONFLICT`, `$1` in reading-prefs; 字号/行距/边距/日间/夜间/Sepia in SettingsSheet; setStyles + margin in FoliateView; no localStorage API usage

## Self-Check: PASSED

- FOUND: `src-tauri/src/migrations.rs`
- FOUND: `src-tauri/tests/migration.rs`
- FOUND: `src/reader/reading-prefs.ts`
- FOUND: `src/reader/SettingsSheet.tsx`
- FOUND: `src/reader/FoliateView.tsx`
- FOUND: `src/App.css`
- FOUND: commit `0f5c00a`
- FOUND: commit `fb2cb06`

---
*Phase: 02-epub-reading-core*
*Completed: 2026-07-15*
