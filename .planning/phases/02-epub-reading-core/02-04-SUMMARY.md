---
phase: 02-epub-reading-core
plan: 04
subsystem: ui
tags: [custom-fonts, search, pillow-protocol, torture-soft-fail, READ-06, READ-07]

# Dependency graph
requires:
  - phase: 02-epub-reading-core
    provides: SettingsSheet font stub, search-opts, SCHEMA_V2 custom_font, immersive chrome (02-00..02-03)
  - phase: 01-foundation
    provides: pillow:// protocol, app_data_dir materialize pattern, protection decide path
provides:
  - Custom font import/copy/remove under app_data/fonts with max 20 / 20MB (READ-06, D-27..D-29)
  - pillow fonts/ path serve + @font-face PillowCustom-{id} injection (D-30)
  - SearchSheet whole-book view.search + 250ms debounce + CFI jump (READ-07, D-31..D-34)
  - Desktop / and Ctrl+F open search; Esc closes search first (D-33 complete)
  - Torture soft-fail decide matrix CI (corrupt/DRM/font-obfuscation/random bytes)
affects:
  - Phase 3 CJK typography (custom face + setStyles pipeline ready)
  - Phase 5 annotations (search CFI path related)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Rust import_font/remove_font return FontMeta only; SQL custom_font on frontend"
    - "pillowFontUrl via convertFileSrc('fonts/{id}', 'pillow'); protocol jailed under app_data/fonts"
    - "Search: buildSearchOpts omits matchWholeWords; for-await view.search whole book"

key-files:
  created:
    - src-tauri/src/fonts.rs
    - src/reader/fonts.ts
    - src/reader/SearchSheet.tsx
  modified:
    - src-tauri/src/protocol.rs
    - src-tauri/src/lib.rs
    - src-tauri/src/commands.rs
    - src/lib/pillow.ts
    - src/reader/SettingsSheet.tsx
    - src/reader/FoliateView.tsx
    - src/reader/foliate-types.ts
    - src/App.css

key-decisions:
  - "Font serve path: pillow /fonts/{id} not SourceRegistry; canonicalize under fonts_dir"
  - "Frontend owns custom_font SQL INSERT/DELETE; Rust owns filesystem limits"
  - "No FXL fixture crafted — soft-fail asserted on random/truncated bytes instead"

patterns-established:
  - "Pattern: pillowFontUrl + buildFontFaceCss + fontFamilyCssFor(activeFontId)"
  - "Pattern: SearchSheet debounce SEARCH_DEBOUNCE_MS then for await view.search"
  - "Pattern: Esc closes search → settings → toc → show chrome"

requirements-completed: [READ-06, READ-07]

# Metrics
duration: 6min
completed: 2026-07-15
---

# Phase 2 Plan 04: Custom Fonts, Search & Torture Soft-Fail Summary

**Custom fonts (app_data copy + pillow serve + @font-face) and CJK whole-book search with soft-fail CI**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-15T13:32:55Z
- **Completed:** 2026-07-15T13:38:46Z
- **Tasks:** 2/2
- **Files modified:** 13

## Accomplishments

- `fonts.rs`: MAX_CUSTOM_FONTS=20, MAX_FONT_BYTES=20MiB; import/remove confined under app_data/fonts; unit tests for size/count/ext/traversal
- Protocol `parse_font_path` + `serve_font` with font Content-Type + CORS; no SourceRegistry for fonts
- Frontend `fonts.ts` + Settings 导入/移除 + live `@font-face` / `PillowCustom-{id}` via setStyles
- `SearchSheet`: sticky 搜索书中内容, 250ms debounce, buildSearchOpts (no matchWholeWords), snippet+caption, goTo(cfi)
- Keyboard: `/` and Ctrl/Cmd+F open search; Esc closes search first (D-33 complete)
- Torture matrix test: corrupt/DRM/font-obfuscation/random/truncated soft-fail without panic

## Task Commits

Each task was committed atomically:

1. **Task 1: Font filesystem + pillow fonts/ + Settings apply** - `f2f73af` (feat)
2. **Task 2: SearchSheet + keyboard + torture soft-fail** - `d649c75` (feat)

**Plan metadata:** (pending docs commit)

## Files Created/Modified

- `src-tauri/src/fonts.rs` — import/remove + limit helpers + unit tests
- `src-tauri/src/protocol.rs` — fonts/ path serve + parse_font_path
- `src-tauri/src/lib.rs` — register fonts commands + protocol branch
- `src-tauri/src/commands.rs` — torture_soft_fail_decide_matrix
- `src/reader/fonts.ts` — invoke + SQL list/import/remove + face CSS helpers
- `src/reader/SearchSheet.tsx` — 搜索 sheet
- `src/reader/SettingsSheet.tsx` — live import/remove UI
- `src/reader/FoliateView.tsx` — fonts + search wiring + keys
- `src/lib/pillow.ts` — pillowFontUrl
- `src/App.css` — font row remove + search sheet styles

## Decisions Made

- Font bytes only via pillow protocol path under app_data/fonts (never IPC)
- SQL metadata ownership stays on frontend with `$n` binds (T-02-sql)
- No hand-crafted FXL fixture — random/truncated soft-fail covers process safety; FXL reflow lock already from 02-01

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- READ-06 / READ-07 delivered — Phase 2 reading-core plans complete
- Custom face + setStyles pipeline ready for Phase 3 CJK CSS injection
- Soft-fail protection path still CI-green; fixtures unchanged under core/tests/fixtures
- Engine still DRM-gated + pillow:// only; no book/font bytes over IPC

## Verification

- `cargo test --workspace` — all passed (MSVC; fonts + torture matrix green)
- `pnpm test` — 4 files / 19 tests passed
- `pnpm build` — tsc + vite build passed
- Grep: MAX_CUSTOM_FONTS/MAX_FONT_BYTES; fonts/ protocol; 搜索书中内容; no matchWholeWords true; Ctrl+F and key === "/"

## Self-Check: PASSED

- FOUND: `src-tauri/src/fonts.rs`
- FOUND: `src/reader/fonts.ts`
- FOUND: `src/reader/SearchSheet.tsx`
- FOUND: `src-tauri/src/protocol.rs`
- FOUND: commit `f2f73af`
- FOUND: commit `d649c75`

---
*Phase: 02-epub-reading-core*
*Completed: 2026-07-15*
