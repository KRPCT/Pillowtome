---
status: human_needed
phase: 03-cjk-typography-differentiation
score: 12/14
completed: 2026-07-16
---

# Phase 03 Verification — CJK Typography Differentiation

## Goal

Chinese typography moat: 标点挤压 / 盘古之白 / 禁则 / indent defaults / bundled Noto SC+TC, controllable from Aa settings, injected via single CSS path on paginate + continuous scroll.

## Requirement Traceability

| ID | Must-have | Evidence | Status |
|----|-----------|----------|--------|
| CJK-01 | 标点挤压 CSS when toggle+caps | `buildCjkCss` + tests emit `text-spacing-trim: normal` | ✓ automated |
| CJK-02 | 盘古之白 CSS or reversible shim | native `text-autospace` + `installAutospaceShim` + ContinuousScrollStream prop | ✓ automated |
| CJK-03 | 禁则 `line-break: strict` + tables | buildReadingCss + cjk-kinsoku tables/tests | ✓ automated |
| CJK-04 | indent 2em / lh 1.75 / no quote rewrite | buildCjkCss always indent; DEFAULT_PREFS.lineHeight 1.75 | ✓ automated |
| CJK-05 | Bundled Noto SC+TC + stack + golden | assets OFL, materialize, fonts.ts stack, cjk-golden Blink | ✓ automated (WebKit optional host; Android smoke pending) |

## Automated Checks

- `cargo test --workspace` — pass (migration v3 + font bundled id tests)
- `pnpm test` — 72 pass
- `pnpm build` — pass
- `node scripts/cjk-golden.mjs` — Chromium baseline written; WebKit skipped on Windows host without browser binary

## Must-haves Spot-check

| Truth | Result |
|-------|--------|
| SCHEMA_V3 columns DEFAULT 1 | ✓ migrations.rs + migration tests |
| ReadingPrefs three CJK defaults true | ✓ apply-reading-styles + tests |
| detectCjkCssCaps pure injectable | ✓ cjk-feature-detect tests |
| buildReadingCss single path both surfaces | ✓ FoliateView buildCss + ContinuousScrollStream readingCss |
| Settings 中文排版 after 主题 | ✓ SettingsSheet.tsx |
| PillowBundledCJK stack order | ✓ fonts.test.ts |
| No upgrade wall copy | ✓ no 请升级/功能不可用 for CJK |
| No permanent space insertion strategy | ✓ autospace tests textContent invariance |

## Human Verification Needed

1. **Desktop Aa sheet:** Open reader → 显示设置 → confirm section order 阅读模式 / 主题 / **中文排版** / 字体; toggle three switches live; info popovers show UI-SPEC copy.
2. **Desktop render:** CN EPUB with punctuation + mixed Latin/digits; toggles ON change spacing/line-break visually on capable Chromium WebView; OFF reverts without crash.
3. **Continuous scroll:** Mode 滚动 — same CJK CSS applies across section iframes; no missing styles at chapter boundaries.
4. **Android emulator smoke (required for CJK-05 claim):** First launch materializes bundled fonts; open sample/CN book; no tofu boxes; no pillow `fonts/bundled-noto-*` 404 in logs.
5. **WebKit golden (optional on Windows):** `pnpm exec playwright install webkit && pnpm test:cjk-golden` — compare blink vs webkit PNGs for ransom-note.

## Gaps

None blocking automated path. Human/device items above gate full “font claims complete” per CLAUDE.md.

## next_action

Run `/gsd-verify-work 3` for human UAT walkthrough, then advance when UAT passes.

## next_command

`/gsd-verify-work 3`
