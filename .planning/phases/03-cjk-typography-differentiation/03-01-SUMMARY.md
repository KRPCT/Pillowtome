---
phase: 03-cjk-typography-differentiation
plan: 01
subsystem: reader
tags: [cjk, css, autospace, foliate, continuous-scroll]

requires:
  - phase: 03-00
    provides: ReadingPrefs CJK fields, detectCjkCssCaps, installAutospaceShim API, buildBundledCjkFontFaceCss stub
provides:
  - buildReadingCss CJK rules gated by CjkCssCaps
  - shouldInstallAutospaceShim pure helper
  - Full installAutospaceShim with disposer
  - FoliateView session caps + dual-surface CSS/shim wiring
affects: [03-02, 03-03]

tech-stack:
  added: []
  patterns: [single CSS builder, session-cached CSS.supports, reversible autospace shim]

key-files:
  created: []
  modified:
    - src/reader/apply-reading-styles.ts
    - src/reader/apply-reading-styles.test.ts
    - src/reader/cjk-autospace-shim.ts
    - src/reader/cjk-autospace-shim.test.ts
    - src/reader/FoliateView.tsx
    - src/reader/ContinuousScrollStream.tsx

key-decisions:
  - "Optional 4th buildReadingCss arg caps defaults to NO_CJK_CAPS"
  - "Shim only when cjkAutospace ON and native text-autospace unsupported"
  - "No WebView upgrade wall (D-38)"

patterns-established:
  - "Pattern: buildCjkCss pure block appended to buildReadingCss"
  - "Pattern: ContinuousScrollStream autospaceShimEnabled prop + per-iframe disposer"

requirements-completed: [CJK-01, CJK-02, CJK-03, CJK-04]

duration: 20min
completed: 2026-07-16
---

# Phase 03: Plan 01 Summary

**CJK render CSS (trim/autospace/kinsoku/indent) and reversible autospace shim wired into both paginate and continuous-scroll surfaces.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2/2
- **Files modified:** 6

## Accomplishments

- `buildReadingCss` emits CJK-01..04 rules gated by prefs + `CjkCssCaps`
- `installAutospaceShim` implements Highlight → reversible spans → silent degrade with textContent invariance
- FoliateView session-caches caps, includes `buildBundledCjkFontFaceCss()`, passes same CSS string to ContinuousScrollStream
- Continuous scroll installs/disposes shim per iframe when enabled

## Task Commits

1. **Task 1: buildReadingCss CJK block** - (see git log 03-01)
2. **Task 2: Shim + dual-surface wiring** - (see git log 03-01)

## Deviations

- Node tests use Document stand-in; span path exercises silent-degrade when TreeWalker yields no text nodes. Contract tests cover invariance + shouldInstall gating.

## Verification

- `pnpm test` — 69 passed
- `pnpm build` — pass

## Self-Check: PASSED
