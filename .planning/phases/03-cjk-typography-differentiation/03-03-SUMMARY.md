---
phase: 03-cjk-typography-differentiation
plan: 03
subsystem: fonts
tags: [cjk, noto, ofl, playwright, golden, pillow-fonts]

requires:
  - phase: 03-00
    provides: BUNDLED_CJK_FAMILY stub, coverage-sheet scaffold
  - phase: 03-01
    provides: buildBundledCjkFontFaceCss wired into FoliateView
provides:
  - Noto Sans CJK SC+TC OFL assets + LICENSE/NOTICE
  - materialize bundled-noto-sc/tc into app_data/fonts
  - D-47 font-family stack order
  - cjk-golden harness (Blink + WebKit attempt)
affects: [phase-verify, android-smoke]

tech-stack:
  added: [playwright@1.52.0, NotoSansCJKsc-VF.otf, NotoSansCJKtc-VF.otf]
  patterns: [include_bytes materialize, bundled-* excluded from custom count]

key-files:
  created:
    - src-tauri/assets/fonts/noto-cjk/LICENSE
    - src-tauri/assets/fonts/noto-cjk/NOTICE
    - src-tauri/assets/fonts/noto-cjk/NotoSansCJKsc-VF.otf
    - src-tauri/assets/fonts/noto-cjk/NotoSansCJKtc-VF.otf
    - src/reader/fonts.test.ts
    - scripts/cjk-golden.mjs
    - tests/fixtures/cjk/golden/README.md
  modified:
    - src-tauri/src/lib.rs
    - src-tauri/src/fonts.rs
    - src/reader/fonts.ts
    - src/reader/apply-reading-styles.ts
    - package.json
    - pnpm-lock.yaml
    - tests/fixtures/cjk/coverage-sheet.html

key-decisions:
  - "Pin notofonts/noto-cjk Sans Variable OTF SC+TC (~29MB each), not Serif"
  - "Materialize by size match; soft-fail on write errors"
  - "Playwright WebKit optional on Windows — Chromium required for harness exit 0"

patterns-established:
  - "Pattern: bundled font ids bundled-noto-sc|tc via pillow fonts path"

requirements-completed: [CJK-05]

duration: 35min
completed: 2026-07-16
---

# Phase 03: Plan 03 Summary

**Bundled Noto Sans CJK SC+TC OFL faces, coverage-aware stack, and Blink golden harness for CJK-05.**

## Accomplishments

- Assets under `src-tauri/assets/fonts/noto-cjk/` with SIL OFL LICENSE + NOTICE
- `include_bytes!` materialize to `app_data/fonts/bundled-noto-sc.otf` + `bundled-noto-tc.otf`
- `fontFamilyCssFor`: custom → PillowBundledCJK → system (incl. TC)
- `buildBundledCjkFontFaceCss` dual @font-face via pillowFontUrl
- `scripts/cjk-golden.mjs` + `pnpm test:cjk-golden`; Chromium baseline written; WebKit skipped when not installed

## Pin record

- Source: `https://github.com/notofonts/noto-cjk` Sans Variable OTF
- Files: `NotoSansCJKsc-VF.otf`, `NotoSansCJKtc-VF.otf` (main snapshot 2026-07-16)

## Device gate note

Phase verify still needs Android emulator smoke: open CN EPUB after materialize; confirm no pillow font 404 and no tofu. Unit/cargo green alone is insufficient for full font claims (CLAUDE.md).

## Verification

- `cargo test --workspace` pass
- `pnpm test` 72 pass
- `pnpm build` pass
- `node scripts/cjk-golden.mjs` — Chromium ok; WebKit logged skip on this host

## Self-Check: PASSED
