---
phase: 02-epub-reading-core
plan: 00
subsystem: testing
tags: [vitest, foliate-js, tauri-plugin-sql, pure-helpers, reading-css, tap-zones]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: FoliateView shell, pillow:// protocol, schema v1, tauri-plugin-sql binding
provides:
  - Exact-pinned vitest harness for pure TS reading helpers
  - flowAttr / buildReadingCss / DEFAULT_PREFS / PAGE_COLORS / SYSTEM_CJK_STACK
  - Tap-zone, TOC flatten, and CJK-safe search-opts pure helpers
  - SQL capabilities (sql:default + sql:allow-execute) for prefs/locator writes
  - Expanded Foliate ambient types (goTo, goToTextStart, search, TOC, setStyles)
affects:
  - 02-01 reader chrome and flow application
  - 02-02 prefs SQL persistence
  - 02-03 TOC / search sheets
  - 02-04 custom fonts + style injection

# Tech tracking
tech-stack:
  added: [vitest@3.2.4]
  patterns:
    - "Pure reader helpers colocated with *.test.ts under src/reader/"
    - "Exact-pin devDependencies only; no floating ranges"
    - "Single foliate-types.ts contract module for later waves"

key-files:
  created:
    - vitest.config.ts
    - src/reader/apply-reading-styles.ts
    - src/reader/apply-reading-styles.test.ts
    - src/reader/tap-zones.ts
    - src/reader/tap-zones.test.ts
    - src/reader/toc.ts
    - src/reader/toc.test.ts
    - src/reader/search-opts.ts
    - src/reader/search-opts.test.ts
    - src/reader/foliate-types.ts
  modified:
    - package.json
    - pnpm-lock.yaml
    - tsconfig.node.json
    - src-tauri/capabilities/default.json

key-decisions:
  - "Frontend unit tests use exact-pinned vitest 3.2.4 (node env), not Rust-only"
  - "buildSearchOpts omits matchWholeWords for grapheme/CJK matching (D-31)"
  - "SQL cap grants least privilege: sql:default + sql:allow-execute only"
  - "Foliate types module created without rewriting FoliateView (deferred to 02-01)"

patterns-established:
  - "Pattern: pure helpers never import React or Tauri"
  - "Pattern: margin via renderer.setAttribute, colors/typography via buildReadingCss + setStyles"
  - "Pattern: immersive zones 33/34/33; scroll mode always toggle-chrome"

requirements-completed: [READ-01, READ-02, READ-03, READ-04, READ-05, READ-07]

# Metrics
duration: 2min
completed: 2026-07-15
---

# Phase 2 Plan 00: Wave 0 Validation Gaps Summary

**Exact-pinned vitest harness for pure reading helpers, SQL plugin capabilities, and expanded Foliate ambient types for Wave 1+**

## Performance

- **Duration:** 2 min
- **Started:** 2026-07-15T13:18:52Z
- **Completed:** 2026-07-15T13:20:26Z
- **Tasks:** 2/2
- **Files modified:** 14

## Accomplishments

- Added vitest 3.2.4 (exact pin) with `pnpm test` → `vitest run`; 19 pure-helper unit tests green
- Shipped clean-room pure modules: flow/CSS (READ-01/02/03), tap zones (READ-04), TOC flatten (READ-05), search opts (READ-07)
- Granted `sql:default` + `sql:allow-execute` on main window capability without stripping Android SAF perms
- Expanded Foliate engine contract in `foliate-types.ts` (`goTo`, `goToTextStart`, `search`, `clearSearch`, TOC, `setStyles`)

## Task Commits

Each task was committed atomically:

1. **Task 1: Exact-pin vitest + pure reading helpers with unit tests** - `5843821` (feat)
2. **Task 2: SQL capabilities + expanded Foliate ambient types** - `0bd0ff8` (feat)

**Plan metadata:** (pending docs commit)

## Files Created/Modified

- `vitest.config.ts` - Node env, `src/**/*.test.ts`
- `package.json` / `pnpm-lock.yaml` - vitest 3.2.4 + test scripts
- `tsconfig.node.json` - include vitest.config.ts
- `src/reader/apply-reading-styles.ts` - flowAttr, buildReadingCss, defaults/colors/CJK stack
- `src/reader/tap-zones.ts` - 33/34/33 zones + mode-aware actions
- `src/reader/toc.ts` - depth-first TOC flatten
- `src/reader/search-opts.ts` - 250ms debounce + CJK-safe opts
- `src/reader/*.{test}.ts` - colocated unit coverage (19 tests)
- `src/reader/foliate-types.ts` - ambient FoliateViewElement contract
- `src-tauri/capabilities/default.json` - SQL plugin permissions

## Decisions Made

- Frontend Nyquist path is vitest for pure TS helpers; engine E2E stays manual/desktop
- `buildSearchOpts` returns only `{ query }` after trim — never `matchWholeWords`
- Capability grant is least-privilege SQL only; parameterized queries remain a later-plan duty
- Types module only — FoliateView still uses local narrow interfaces until 02-01

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Wave 0 frontend sampling path ready for 02-01 chrome/flow wiring
- Prefs/locator SQL unblocked for 02-02 once SCHEMA_V2 lands
- Shared types/helpers available so later plans need not redefine contracts
- No floating version ranges introduced

## Verification

- `pnpm test` — 4 files / 19 tests passed
- `pnpm build` — tsc + vite build passed (after Task 1 and Task 2)
- Capabilities include `core:default`, `dialog:allow-open`, `sql:default`, `sql:allow-execute`
- Android SAF capability file left intact

## Self-Check: PASSED

- FOUND: `vitest.config.ts`
- FOUND: `src/reader/apply-reading-styles.ts`
- FOUND: `src/reader/foliate-types.ts`
- FOUND: commit `5843821`
- FOUND: commit `0bd0ff8`

---
*Phase: 02-epub-reading-core*
*Completed: 2026-07-15*
