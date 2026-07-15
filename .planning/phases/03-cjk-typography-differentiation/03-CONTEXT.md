# Phase 3: CJK Typography Differentiation - Context

**Gathered:** 2026-07-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver Pillowtome's **reason to exist**: a visibly superior Chinese reading experience as a first-class **render CSS + font subsystem** injected into every foliate render document, covering CJK-01..CJK-05, verified for parity across Blink (Windows/Android) and WebKit (macOS/Linux).

**In scope:**
- CJK-01 标点挤压 (`text-spacing-trim`), default on, user-toggleable
- CJK-02 盘古之白 / 中英中数混排间距 (`text-autospace`) + JS degradation shim for older WebViews
- CJK-03 禁则 (kinsoku / `line-break`) — 行首不行尾禁则
- CJK-04 中文默认值：首行缩进 2 字、CJK 适配行高链路、全角引号的**排版级**处理
- CJK-05 内置 CJK 字体（简繁完整覆盖）+ 覆盖感知回退链 + glyph coverage / golden-image 验收
- 在现有阅读设置（Aa Sheet）扩展「中文排版」分区与全局 prefs 字段
- 运行时 feature-detect；弱引擎静默降级（DEC-002）

**Explicitly NOT in scope:**
- 竖排 / 注音 ruby / 划词词典 / 简繁转换（v2 / CJKX）
- 应用内字体商店或云端首次下载字体（REQUIREMENTS Out of Scope）
- 连续滚动位置连续性 **READER-POS**（已延期 Phase 4 / 5）
- 书库、批注产品化、TXT、WebDAV（Phases 4–7）
- 捆绑固定 Chromium（仅当 P3 证明系统 WebView 无法达标时的逃生口，不在本阶段实现）

</domain>

<decisions>
## Implementation Decisions

### Interaction language (session constraint)
- **D-30:** 本阶段及本阶段落地的**用户可见文案**（设置项、说明气泡、错误/空态）使用**简体中文**。技术标识符、代码、文件路径、提交说明中的英文 key 保持英文。

### Carried from prior phases (do not re-decide)
- **D-01..D-13 (P1)** and **D-20..D-34 (P2)** remain in force, especially:
  - System WebView + feature-detect + owned JS shim + golden-image harness (D-04 / DEC-002)
  - Global prefs only (D-21); live apply + debounced SQLite (D-22)
  - Custom fonts: app-data copy + serve via pillow fonts path (D-27..D-30); system CJK stack fallback
  - Extend `buildReadingCss` / `SettingsSheet` / `SYSTEM_CJK_STACK` — do not invent a parallel render path
  - Clean-room vs Readest AGPL; foliate-js MIT only

### Feature toggles & settings surface (CJK-01..03 UX)
- **D-31:** In the existing Aa **显示设置** bottom sheet, add a dedicated section **「中文排版」** (alongside 阅读模式 / 主题 / 字体 / 滑杆). Do not create a separate top-level panel in P3.
- **D-32:** Three independent toggles, **all default ON**:
  1. 标点挤压
  2. 盘古之白（中英 / 中数混排间距）
  3. 禁则（避头尾）
- **D-33:** Each toggle has an **info / detail affordance** that explains the term in plain language for non-specialist readers (not jargon-only labels). Copy is 简体中文.
- **D-34:** Persist these flags in the **global** `reading_prefs` row (schema migration append — same pattern as P2). **No per-book overrides** in P3 (honors D-21).

### CSS pipeline & JS degradation shim
- **D-35:** **Native CSS first** with runtime **feature detection**. Prefer `text-spacing-trim`, `text-autospace`, `line-break` (and related) when the engine supports them.
- **D-36:** JS shim scope is **prioritized for 盘古之白 (autospace)**. Punctuation compression and kinsoku should stay **CSS-primary** with only limited patches if research proves a critical gap; do not build a full three-feature DOM rewriter by default.
- **D-37:** Shim must **avoid permanent DOM mutation** of book text. Prefer CSS / reversible runtime techniques; never rewrite text nodes in a way that breaks selection, in-book search, or future CFI/annotation anchors (Phase 5).
- **D-38:** On weak/old WebViews: **silent graceful degradation**. Keep toggles available; do not block reading behind a mandatory WebView upgrade dialog. No system-level “unsupported engine” wall in v1 of this phase.

### CJK defaults (CJK-04)
- **D-39:** **Reader prefs win over author styles** for the CJK defaults pipeline — consistent with existing `buildReadingCss` `!important` theme overrides. Goal: any Chinese book opens to Pillowtome’s clean defaults.
- **D-40:** **First-line indent 2em** on body paragraphs (`p` and equivalent body text). **Do not** indent headings (`h1–h6`), blockquotes, and similar non-body blocks (exact selector list is planner discretion within this rule).
- **D-41:** Keep global default **line-height 1.75** (Phase 2 UI-SPEC / `DEFAULT_PREFS`). P3 does **not** change the default numeric value; ensure the injection path keeps CJK comfortable; user slider still overrides.
- **D-42:** “全角引号” means **typography-level** participation in kinsoku / spacing — **do not rewrite** author characters (`"`/`'` → `「」` etc.). Preserve original text for search and locators.

### Bundled font & fallback (CJK-05)
- **D-43:** Bundled family direction: **Noto CJK** line (Sans vs Serif exact package locked in research/planning under OFL + embeddable license audit).
- **D-44:** **Simplified + Traditional both fully covered** in the shipped font set (user explicitly prioritizes complete SC+TC coverage over package size).
- **D-45:** Packaging preference: **variable font / OTC full family; package size is secondary** to coverage quality. Still must be **shipped in-binary / in-app assets** — **no** cloud/first-run font download (REQUIREMENTS out of scope). License audit for embedding is mandatory before pin.
- **D-46:** **Explicit fallback chain** (bundled Noto CJK → existing system CJK stack / custom face rules) plus a **glyph coverage sheet** and **golden-image** checks on **both Blink and WebKit** so success criterion 5 is testable (no tofu, no ransom-note mixing on the coverage corpus).
- **D-47:** Interaction with user custom fonts (READ-06): when a custom face is active it remains first in the stack (P2 behavior), then bundled CJK, then system stack — planner documents the exact CSS order; must not drop CJK coverage behind an incomplete custom face without fallback.

### Claude's Discretion
- Exact SQLite column names / migration wording for CJK toggle fields
- Plain-language 简体中文 copy for the three info panels (tone: calm, short, non-academic)
- Whether feature-detect results are cached per session vs rechecked on WebView upgrade
- Exact CSS property set and selector lists within D-35..D-42
- Noto Sans vs Serif final pin, subsetting tooling, and Android/desktop asset layout — constrained by D-43..D-46
- Golden-image harness host (CI job shape, viewport list) as long as Blink + WebKit families are represented
- Kinsoku table sources (CLREQ / CSS) and whether zh-Hans vs zh-Hant tables differ — research locks tables; user did not require JA tables in v1 UI
- How “禁则” toggle maps if engine only exposes coarse `line-break` values

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` → Phase 3 section — goal, success criteria, plan sketch 03-01..03-03, research flag
- `.planning/REQUIREMENTS.md` — CJK-01..CJK-05; Out of Scope (vertical text, ruby, in-app font store / cloud fonts)
- `.planning/PROJECT.md` — Chinese UX as hard differentiator
- `.planning/STATE.md` — current position; READER-POS deferred (do not expand P3 to fix scroll resume)

### Prior phase locks
- `.planning/phases/01-foundation-cross-platform-skeleton/01-CONTEXT.md` — D-01..D-13 (esp. D-04 WebView strategy)
- `.planning/phases/02-epub-reading-core/02-CONTEXT.md` — D-20..D-34 (prefs, fonts, styles injection)
- `.planning/phases/02-epub-reading-core/02-UI-SPEC.md` — Aa sheet layout / defaults to extend (not replace)

### Decisions & research
- `docs/decisions/DEC-002-webview-engine.md` — system WebView + feature-detect + owned JS shim + golden-image
- `docs/decisions/DEC-001-license-cleanroom.md` — no Readest AGPL copy; font/license audit discipline
- `.planning/research/SUMMARY.md` — CJK moat, font bundling risks, Blink↔WebKit parity
- `.planning/research/STACK.md` — WebView CSS as CJK engine; foliate-js
- `.planning/research/PITFALLS.md` — § Blink↔WebKit CJK divergence, font tofu/ransom-note/bloat
- `.planning/research/FEATURES.md` — [CN] typography table-stakes
- `.planning/research/ARCHITECTURE.md` — render CSS pipeline as first-class module

### Implementation touchpoints (code)
- `src/reader/apply-reading-styles.ts` — `buildReadingCss`, `DEFAULT_PREFS`, `SYSTEM_CJK_STACK`
- `src/reader/SettingsSheet.tsx` — Aa sheet sections to extend with「中文排版」
- `src/reader/reading-prefs.ts` — global prefs load/save; schema field mapping
- `src/reader/fonts.ts` — `@font-face` + body stack (custom → system)
- `src/reader/FoliateView.tsx` — applies styles to renderer; integration point for CJK CSS/shim
- `src-tauri/src/fonts.rs` — font serve / app-data fonts (extend carefully for bundled assets)
- `src-tauri/src/migrations.rs` — append-only prefs migration pattern
- `src/vendor/foliate-js/view.js` — language/isCJK hooks; renderer `setStyles`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `buildReadingCss(prefs, fontFaceCss, fontFamilyCss)` — single injection point for CJK CSS defaults and feature toggles
- `SettingsSheet` section pattern (ToggleGroup / sliders / font list) — add「中文排版」section without new navigation shell
- `reading_prefs` SQLite single-row global profile + debounce save — extend columns for three toggles
- `SYSTEM_CJK_STACK` + `fonts.ts` body stack — insert bundled Noto CJK into the chain
- `pillow` font serving path (P2) — model for shipping bundled faces without IPC byte dumps
- Sample EPUB CJK prose under `src-tauri/assets/sample/` — early smoke content

### Established Patterns
- Theme/typography overrides use `!important` to beat author EPUB CSS
- Soft-fail / non-blocking open paths; prefs load fails soft to defaults
- Exact-pinned deps + committed lockfiles; license-sensitive vendoring
- Feature work stays in `src/reader/*` pure helpers + thin React chrome

### Integration Points
- Prefs change → `FoliateView` rebuilds CSS / re-`setStyles` (and any shim enable/disable)
- Schema migration append for new boolean (or equivalent) CJK flags with defaults **true**
- Visual regression / coverage sheet assets live under planning or `src` test fixtures (planner chooses path)
- Android + desktop both hit the same WebView CSS path; detect per runtime engine, not only OS name

</code_context>

<specifics>
## Specific Ideas

- Product bar: **visibly better than Readest/Lithium on Chinese books on day 1** of this phase’s ship, not “CSS properties exist in code.”
- Settings copy must be **reader-friendly**: three professional terms need one-tap plain-language explanations.
- User explicitly accepted **larger install size** to get **full SC + TC** bundled coverage via variable/OTC family.
- Shim philosophy is **surgical** (autospace gap-fill), not a second layout engine inside the book DOM.
- Discussion language constraint: continue product UI in **简体中文**.

</specifics>

<deferred>
## Deferred Ideas

- Per-book CJK / typography overrides → later (not P3; would revisit D-21)
- Vertical text (竖排), ruby/pinyin, dictionary segmentation → v2 / CJKX / other phases
- Cloud or first-run optional font download → out of scope permanently for v1 charter
- READER-POS continuous-scroll position continuity → Phase 4 (+ Phase 5 locator)
- Bundled Chromium escape hatch → only if P3 golden-image proves system WebView infeasible
- Japanese-specific kinsoku UI / JA font packaging as first-class product surface → not requested; research may note tables but no P3 UI requirement
- Total switch “优化中文排版” master toggle → user preferred three separate switches instead

None of the above expand Phase 3 scope.

</deferred>

---

*Phase: 3-CJK Typography Differentiation*
*Context gathered: 2026-07-16*
