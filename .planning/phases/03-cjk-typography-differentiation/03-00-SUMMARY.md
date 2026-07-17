---
phase: 03-cjk-typography-differentiation
plan: 00
subsystem: reader
tags: [cjk, typography, sqlite, reading-prefs, shadcn, feature-detect]

requires:
  - phase: 02-reading-core
    provides: reading_prefs SCHEMA_V2, ReadingPrefs, apply-reading-styles, fonts path
provides:
  - SCHEMA_V3 CJK toggle columns on reading_prefs
  - ReadingPrefs cjkPunctTrim/cjkAutospace/cjkKinsoku defaults ON
  - detectCjkCssCaps pure probes
  - installAutospaceShim API + textContent invariance tests
  - ZH kinsoku tables for fixtures
  - shadcn switch + popover primitives
  - CJK coverage/kinsoku HTML fixtures
affects: [03-01, 03-02, 03-03]

tech-stack:
  added: [shadcn switch, shadcn popover]
  patterns: [append-only SCHEMA_Vn, injectable CSS.supports, soft-fail prefs map]

key-files:
  created:
    - src/reader/cjk-feature-detect.ts
    - src/reader/cjk-feature-detect.test.ts
    - src/reader/cjk-kinsoku.ts
    - src/reader/cjk-kinsoku.test.ts
    - src/reader/cjk-autospace-shim.ts
    - src/reader/cjk-autospace-shim.test.ts
    - src/components/ui/switch.tsx
    - src/components/ui/popover.tsx
    - tests/fixtures/cjk/coverage-sheet.html
    - tests/fixtures/cjk/kinsoku-samples.html
  modified:
    - src-tauri/src/migrations.rs
    - src-tauri/tests/migration.rs
    - src/reader/apply-reading-styles.ts
    - src/reader/apply-reading-styles.test.ts
    - src/reader/reading-prefs.ts
    - src/reader/fonts.ts

key-decisions:
  - "SCHEMA_V3 ALTER-only with DEFAULT 1 (D-34)"
  - "Wave 0 autospace shim is no-op API + invariance contract; full strategy in 03-01"
  - "Autospace tests use Document stand-in (vitest node env, no jsdom)"

patterns-established:
  - "Pattern: pure CJK helpers under src/reader/cjk-*.ts with injectable deps"
  - "Pattern: CJK prefs soft-fail missing columns to ON"

requirements-completed: [CJK-01, CJK-02, CJK-03, CJK-04]

duration: 25min
completed: 2026-07-16
---

# Phase 03: Plan 00 Summary

**Closed Wave 0 Nyquist gaps: SCHEMA_V3 CJK toggles, ReadingPrefs defaults ON, pure helpers, shadcn switch/popover, and CJK fixture scaffolds.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-16T03:10:00Z
- **Completed:** 2026-07-16T03:15:00Z
- **Tasks:** 2/2
- **Files modified:** 16

## Accomplishments

- SCHEMA_V3 appends `cjk_punct_trim` / `cjk_autospace` / `cjk_kinsoku` with DEFAULT 1; migration set length 3
- `ReadingPrefs` + `DEFAULT_PREFS` carry three CJK booleans default true; `lineHeight` stays 1.75 (D-41)
- Pure modules: `detectCjkCssCaps`, kinsoku tables, `installAutospaceShim` contract, `BUNDLED_CJK_FAMILY` stub
- Official shadcn switch + popover; coverage-sheet + kinsoku-samples fixtures

## Task Commits

1. **Task 1: SCHEMA_V3 + ReadingPrefs CJK fields** - `45b25d9` (feat)
2. **Task 2: Pure CJK helpers + shadcn + fixtures** - `a715e6b` (feat)

## Files Created/Modified

- `src-tauri/src/migrations.rs` — SCHEMA_V3 + migration registration
- `src-tauri/tests/migration.rs` — fresh_db_v3 + column/default assertions
- `src/reader/apply-reading-styles.ts` — ReadingPrefs CJK fields + defaults
- `src/reader/reading-prefs.ts` — row map + bound save params
- `src/reader/cjk-feature-detect.ts` — CSS.supports probes
- `src/reader/cjk-kinsoku.ts` — ZH_PROHIBITED_LINE_START/END
- `src/reader/cjk-autospace-shim.ts` — install/dispose API (Wave 0 no-op)
- `src/reader/fonts.ts` — BUNDLED_CJK_FAMILY + empty buildBundledCjkFontFaceCss
- `src/components/ui/switch.tsx`, `popover.tsx` — shadcn primitives
- `tests/fixtures/cjk/*` — golden/coverage scaffolds

## Deviations

- Autospace unit tests use a minimal Document stand-in instead of `document.implementation` because vitest runs with `environment: "node"` (no DOM globals). Contract coverage (textContent invariance, disposer idempotency, no space insertion) is preserved.

## Verification

- `cargo test --workspace` — pass (7 migration tests including v3)
- `pnpm test` — pass (63 tests)
- `pnpm build` — pass
- Files exist: switch.tsx, popover.tsx, coverage-sheet.html, kinsoku-samples.html

## Self-Check: PASSED

- key-files.created present on disk
- git log grep `03-00` returns commits
- acceptance criteria from both tasks satisfied
