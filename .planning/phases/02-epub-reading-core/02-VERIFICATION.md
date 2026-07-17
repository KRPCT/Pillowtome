---
phase: 02-epub-reading-core
verified: 2026-07-15T14:00:00Z
status: passed
score: 5/5 roadmap success criteria verified
overrides_applied: 0
# Code + automated evidence cover all must-haves. Manual desktop UAT still
# recommended for visual/interaction polish (not treated as status blockers).
---

# Phase 2: EPUB Reading Core Verification Report

**Phase Goal:** Deliver the first demonstrably-usable milestone — immersive, themeable EPUB reading at Lithium parity — so a user can comfortably read a whole EPUB with full control over layout, themes, navigation, and search. Malformed/FXL/obfuscated books soft-fail via a CI torture corpus.

**Verified:** 2026-07-15T14:00:00Z  
**Status:** passed  
**Re-verification:** No — initial verification  
**Score:** 5/5 roadmap success criteria; plan must-haves covered by code + automated evidence

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | User can read an EPUB and toggle between paginated and scroll modes in real time | ✓ VERIFIED | `SettingsSheet` mode toggle → `handlePrefsChange` → `renderer.setAttribute("flow", flowAttr(mode))` in `FoliateView.tsx`; no book reload on mode change. FXL locks mode (`fxlLocked`). Pure helper `flowAttr` unit-tested. |
| 2 | User can adjust font family, size, line-height, and margins, and switch among day / night / sepia themes | ✓ VERIFIED | Aa sheet sliders + theme toggles; `buildReadingCss` + `margin` attr + `data-theme` on reader root; prefs load/save via SQLite `reading_prefs` (`reading-prefs.ts`, SCHEMA_V2). Defaults match UI-SPEC (18/1.75/24/system/day/paginate). |
| 3 | User can enter immersive full-screen reading with hidden chrome and tap-to-turn page zones | ✓ VERIFIED | On `status === "reading"`, `chromeVisible` set false; center 34% toggles chrome; L/R 33% page-turn in paginate; scroll mode all zones toggle only (`tap-zones.ts` + `ReaderTapZones.tsx`). Desktop Esc/arrows/PageUp/Down wired. |
| 4 | User can jump via TOC and search text with Chinese matching without space delimiters | ✓ VERIFIED | `TocSheet` + `flattenToc` + `view.goTo(href)`; `SearchSheet` uses `view.search(buildSearchOpts)` whole-book, **never** `matchWholeWords`, 250ms debounce; results show snippet + chapter caption; jump via `goTo(cfi)`. |
| 5 | User can import a custom font and apply it to the reading view | ✓ VERIFIED | Rust `import_font` / `remove_font` (max 20, ≤20MB, TTF/OTF/WOFF); SQL `custom_font`; `@font-face` via `pillowFontUrl` + `pillow://fonts/{id}` protocol serve; apply through `setStyles`; remove falls back to system stack. |

**Score:** 5/5 truths verified

### Plan Must-Have Truths (merged, non-roadmap detail)

| Plan | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 02-00 | Pure helpers + vitest + SQL caps + Foliate types | ✓ VERIFIED | `vitest` 3.2.4 exact; tests for styles/tap/toc/search; `sql:default` + `sql:allow-execute`; `foliate-types.ts` exposes goTo/goToTextStart/search/clearSearch/book.toc/goLeft/goRight |
| 02-01 | Live flow toggle; UI-SPEC chrome slots; no 下一页 button | ✓ VERIFIED | Chrome slots 返回/title/目录/搜索/Aa (`Type`); no primary next-page button; fixed flex reader + `min-height:0` view host |
| 02-02 | Prefs debounce save; SCHEMA_V2; UNIQUE locator index | ✓ VERIFIED | 400ms prefs debounce; SCHEMA_V2 `reading_prefs` + `custom_font` + `idx_locator_work_id`; migration tests |
| 02-03 | Immersive default; locator upsert/restore; ensure_work; desktop keys | ✓ VERIFIED | 500ms relocate debounce + unmount flush; `goTo(cfi)` / `goToTextStart`; `ensure_work` command registered; Esc/arrows/Page keys + `/` and Ctrl+F |
| 02-04 | Font limits + protocol serve; CJK search; torture soft-fail | ✓ VERIFIED | Font unit tests for limits; protocol `fonts/` path + sanitize; `torture_soft_fail_decide_matrix` + protection fixtures |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/reader/FoliateView.tsx` | Engine controller + composition root | ✓ VERIFIED | ~600 lines; flow/styles/prefs/locator/TOC/search/fonts/keys wired |
| `src/reader/ReaderChrome.tsx` | 48px toolbar + slots | ✓ VERIFIED | UI-SPEC slots; immersive hide when `chromeVisible=false` |
| `src/reader/ProgressBar.tsx` | 2px accent progress | ✓ VERIFIED | Under toolbar |
| `src/reader/SettingsSheet.tsx` | Aa sheet mode/theme/font/sliders | ✓ VERIFIED | Live apply, no 应用 button |
| `src/reader/ReaderTapZones.tsx` | L/C/R hit regions | ✓ VERIFIED | Uses resolveTapZone/tapZoneAction |
| `src/reader/TocSheet.tsx` | 目录 nested jump | ✓ VERIFIED | Left drawer ≥768px / bottom sheet phone |
| `src/reader/SearchSheet.tsx` | 搜索 + debounce + results | ✓ VERIFIED | Placeholder 搜索书中内容 |
| `src/reader/apply-reading-styles.ts` | flowAttr + buildReadingCss | ✓ VERIFIED | Pure; unit tests |
| `src/reader/reading-prefs.ts` | SQLite load/save | ✓ VERIFIED | Bound `$1` params; never localStorage |
| `src/reader/locator-store.ts` | ON CONFLICT upsert | ✓ VERIFIED | Composite locator fields |
| `src/reader/fonts.ts` | import/list/remove + face CSS | ✓ VERIFIED | pillowFontUrl |
| `src/reader/foliate-types.ts` | Ambient engine contract | ✓ VERIFIED | Required APIs present |
| `src-tauri/src/migrations.rs` | SCHEMA_V2 | ✓ VERIFIED | v1 preserved; v2 append |
| `src-tauri/tests/migration.rs` | v2 assertions | ✓ VERIFIED | reading_prefs/custom_font/index |
| `src-tauri/src/fonts.rs` | copy/list limits | ✓ VERIFIED | MAX_CUSTOM_FONTS=20, MAX_FONT_BYTES=20MiB |
| `src-tauri/src/protocol.rs` | fonts/ path serve | ✓ VERIFIED | parse_font_path + resolve under app_data/fonts |
| `src-tauri/src/commands.rs` | ensure_work + torture matrix | ✓ VERIFIED | Registered in lib.rs |
| `src-tauri/capabilities/default.json` | sql permissions | ✓ VERIFIED | sql:default + sql:allow-execute |
| `src/components/ui/{sheet,slider,toggle-group,input,scroll-area,separator}.tsx` | shadcn primitives | ✓ VERIFIED | Present |
| `vitest.config.ts` + pure `*.test.ts` | Unit harness | ✓ VERIFIED | Orchestrator: 19/19 pnpm test |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| FoliateView | apply-reading-styles | flowAttr + setAttribute flow | ✓ WIRED | Live on prefs change and open |
| FoliateView | setStyles / margin | buildReadingCss + font face | ✓ WIRED | Typography + theme + custom face |
| SettingsSheet | FoliateView prefs | onPrefsChange | ✓ WIRED | Immediate apply + debounced SQL |
| reading-prefs / locator-store / fonts | sqlite:pillow.db | plugin-sql $n binds | ✓ WIRED | No string concat SQL |
| FoliateView | relocate | upsertLocator 500ms + flush | ✓ WIRED | unmount + back flush |
| TocSheet | view.goTo | onNavigate(href) | ✓ WIRED | Soft-fail → goToTextStart |
| SearchSheet | view.search | buildSearchOpts for-await | ✓ WIRED | No matchWholeWords; goTo(cfi) jump |
| fonts.ts | pillow protocol | pillowFontUrl / convertFileSrc | ✓ WIRED | fonts/{id} path |
| protocol.rs | app_data/fonts | resolve_font_path sanitize | ✓ WIRED | Path confinement tests |
| lib.rs | import_font / remove_font / ensure_work | invoke_handler | ✓ WIRED | Commands registered |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| FoliateView | prefs | loadReadingPrefs → SQLite | Seed row + user upserts | ✓ FLOWING |
| FoliateView | location / progress | foliate `relocate` event | Engine fractions/CFI | ✓ FLOWING |
| FoliateView | tocItems | view.book.toc after open | Real EPUB TOC | ✓ FLOWING |
| FoliateView | customFonts | listCustomFonts SQL + import_font | Disk + SQL metadata | ✓ FLOWING |
| SearchSheet | hits | view.search async generator | Engine match excerpts | ✓ FLOWING |
| ProgressBar | fraction | location.fraction from relocate | Live progress | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command / evidence | Result | Status |
| -------- | ------------------ | ------ | ------ |
| Frontend unit suite | Orchestrator: `pnpm test` | 19/19 passed | ✓ PASS |
| Rust workspace tests | Orchestrator: `cargo test --workspace` (MSVC) | green | ✓ PASS |
| Production build | Orchestrator: `pnpm build` | green | ✓ PASS |
| Pure helpers present | `src/reader/*.test.ts` (styles, tap, toc, search) | files exist | ✓ PASS |
| Torture soft-fail unit | `torture_soft_fail_decide_matrix` in commands.rs | corrupt/DRM/random soft-fail; font-obf can render | ✓ PASS |
| Font limit enforcement | fonts.rs unit tests | 20 count / 20MB / ext | ✓ PASS |
| Full desktop E2E immersive UI | — | no automated E2E harness | ? SKIP (manual UAT recommended) |

### Probe Execution

| Probe | Command | Result | Status |
| ----- | ------- | ------ | ------ |
| — | — | No phase-declared `scripts/*/tests/probe-*.sh` | SKIP |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
| ----------- | -------------- | ----------- | ------ | -------- |
| READ-01 | 02-00, 02-01, 02-02 | Paginate ↔ scroll live | ✓ SATISFIED | flowAttr + Settings mode toggle |
| READ-02 | 02-00, 02-02 | Font/size/line-height/margins | ✓ SATISFIED | setStyles + margin attr + Aa sliders |
| READ-03 | 02-00, 02-02 | Day/night/sepia | ✓ SATISFIED | data-theme + PAGE_COLORS |
| READ-04 | 02-00, 02-03 | Immersive + tap zones | ✓ SATISFIED | chrome hide + ReaderTapZones |
| READ-05 | 02-00, 02-03 | TOC chapter jump | ✓ SATISFIED | TocSheet → goTo |
| READ-06 | 02-04 | Custom font import/apply | ✓ SATISFIED | fonts.rs + fonts.ts + protocol |
| READ-07 | 02-00, 02-04 | CJK-friendly in-book search | ✓ SATISFIED | search without matchWholeWords |

No orphaned Phase 2 requirements. All READ-01..07 claimed by plans and marked complete in REQUIREMENTS.md with code evidence.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | No TBD/FIXME/XXX debt markers in phase reader/fonts/migrations/protocol code | — | clean |
| `locator-store.ts` | text_pre/text_post null | P2 intentional (research A1) | ℹ️ Info | Full composite text context reserved for Phase 5; CFI + fraction + text_exact present |
| Visual E2E | — | No automated immersive UI E2E | ℹ️ Info | Expected; pure helpers + unit/integration cover logic |

No blocker debt markers. No hollow stubs found in primary reader paths.

### Recommended Manual Desktop UAT (non-blocking)

Automated verification cannot fully prove WebView visual/interaction quality. Recommended before treating Phase 2 as ship-ready UX:

1. **Paginate ↔ scroll** — open sample EPUB, toggle 分页/滚动 in Aa; confirm no reload and layout switches.
2. **Typography + themes** — change 字号/行距/边距 and 日间/夜间/Sepia; confirm page + chrome update live and survive restart.
3. **Immersive + taps** — confirm chrome hidden on enter; center shows chrome; L/R turn pages in paginate; scroll mode does not steal scroll.
4. **TOC + search** — jump chapter; search a Chinese substring without spaces; jump result via CFI.
5. **Custom font** — import TTF/OTF/WOFF, apply, remove; confirm system fallback when active font removed; refuse oversize/overcount with 简体中文 message.
6. **Keyboard** — ←/→, PageUp/Down, Esc, `/`, Ctrl+F on desktop.
7. **Soft-fail** — open corrupt/DRM fixtures → ErrorCard, no crash (CI covers classify; desktop confirms UI path).

### Gaps Summary

**No blocking gaps.** Phase 2 goal is achieved in code:

- Lithium-parity reading core (mode, typography, themes, immersive chrome, TOC, search, custom fonts) is implemented and wired end-to-end.
- Prefs and progress use SQLite (not localStorage) with schema v2 and composite locator upsert.
- Font pipeline is confined to app_data + pillow protocol.
- Protection/torture soft-fail is unit-tested; FXL locks reflow without process crash path.
- Orchestrator automated evidence: cargo green, 19/19 vitest, pnpm build green.

Known residual risk (not a phase gap): lack of automated full-app E2E for immersive UI and live foliate search CJK behavior in a real WebView — covered by unit contracts + recommended manual UAT.

### Deferred (later phases — not Phase 2 gaps)

| Item | Addressed In | Evidence |
| ---- | ------------ | -------- |
| CJK typography moat (挤压/autospace/kinsoku/bundled font) | Phase 3 | ROADMAP Phase 3 SC 1–5 / CJK-01..05 |
| Full annotations + rich composite locator self-heal | Phase 5 | ANNO-01..04; P2 uses locator for progress only |
| Library cover grid / home theming | Phase 4 | LIB-* |
| Physical Android device re-verify of reader chrome | open from P1 D-13 | Emulator substitute documented |

---

_Verified: 2026-07-15T14:00:00Z_  
_Verifier: Claude (gsd-verifier)_
