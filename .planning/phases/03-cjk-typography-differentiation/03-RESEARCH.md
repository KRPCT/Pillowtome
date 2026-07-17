# Phase 3: CJK Typography Differentiation - Research

**Researched:** 2026-07-16
**Domain:** CJK render CSS + font subsystem (Blink/WebKit parity, foliate-js injection)
**Confidence:** HIGH (codebase + prior research + MDN/CLREQ/Noto CJK sources)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Interaction language (session constraint)
- **D-30:** 本阶段及本阶段落地的**用户可见文案**（设置项、说明气泡、错误/空态）使用**简体中文**。技术标识符、代码、文件路径、提交说明中的英文 key 保持英文。

#### Carried from prior phases (do not re-decide)
- **D-01..D-13 (P1)** and **D-20..D-34 (P2)** remain in force, especially:
  - System WebView + feature-detect + owned JS shim + golden-image harness (D-04 / DEC-002)
  - Global prefs only (D-21); live apply + debounced SQLite (D-22)
  - Custom fonts: app-data copy + serve via pillow fonts path (D-27..D-30); system CJK stack fallback
  - Extend `buildReadingCss` / `SettingsSheet` / `SYSTEM_CJK_STACK` — do not invent a parallel render path
  - Clean-room vs Readest AGPL; foliate-js MIT only

#### Feature toggles & settings surface (CJK-01..03 UX)
- **D-31:** In the existing Aa **显示设置** bottom sheet, add a dedicated section **「中文排版」** (alongside 阅读模式 / 主题 / 字体 / 滑杆). Do not create a separate top-level panel in P3.
- **D-32:** Three independent toggles, **all default ON**:
  1. 标点挤压
  2. 盘古之白（中英 / 中数混排间距）
  3. 禁则（避头尾）
- **D-33:** Each toggle has an **info / detail affordance** that explains the term in plain language for non-specialist readers (not jargon-only labels). Copy is 简体中文.
- **D-34:** Persist these flags in the **global** `reading_prefs` row (schema migration append — same pattern as P2). **No per-book overrides** in P3 (honors D-21).

#### CSS pipeline & JS degradation shim
- **D-35:** **Native CSS first** with runtime **feature detection**. Prefer `text-spacing-trim`, `text-autospace`, `line-break` (and related) when the engine supports them.
- **D-36:** JS shim scope is **prioritized for 盘古之白 (autospace)**. Punctuation compression and kinsoku should stay **CSS-primary** with only limited patches if research proves a critical gap; do not build a full three-feature DOM rewriter by default.
- **D-37:** Shim must **avoid permanent DOM mutation** of book text. Prefer CSS / reversible runtime techniques; never rewrite text nodes in a way that breaks selection, in-book search, or future CFI/annotation anchors (Phase 5).
- **D-38:** On weak/old WebViews: **silent graceful degradation**. Keep toggles available; do not block reading behind a mandatory WebView upgrade dialog. No system-level “unsupported engine” wall in v1 of this phase.

#### CJK defaults (CJK-04)
- **D-39:** **Reader prefs win over author styles** for the CJK defaults pipeline — consistent with existing `buildReadingCss` `!important` theme overrides. Goal: any Chinese book opens to Pillowtome’s clean defaults.
- **D-40:** **First-line indent 2em** on body paragraphs (`p` and equivalent body text). **Do not** indent headings (`h1–h6`), blockquotes, and similar non-body blocks (exact selector list is planner discretion within this rule).
- **D-41:** Keep global default **line-height 1.75** (Phase 2 UI-SPEC / `DEFAULT_PREFS`). P3 does **not** change the default numeric value; ensure the injection path keeps CJK comfortable; user slider still overrides.
- **D-42:** “全角引号” means **typography-level** participation in kinsoku / spacing — **do not rewrite** author characters (`"`/`'` → `「」` etc.). Preserve original text for search and locators.

#### Bundled font & fallback (CJK-05)
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

### Deferred Ideas (OUT OF SCOPE)
- Per-book CJK / typography overrides → later (not P3; would revisit D-21)
- Vertical text (竖排), ruby/pinyin, dictionary segmentation → v2 / CJKX / other phases
- Cloud or first-run optional font download → out of scope permanently for v1 charter
- READER-POS continuous-scroll position continuity → Phase 4 (+ Phase 5 locator)
- Bundled Chromium escape hatch → only if P3 golden-image proves system WebView infeasible
- Japanese-specific kinsoku UI / JA font packaging as first-class product surface → not requested; research may note tables but no P3 UI requirement
- Total switch “优化中文排版” master toggle → user preferred three separate switches instead

None of the above expand Phase 3 scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CJK-01 | 标点挤压 (`text-spacing-trim`), default ON, toggleable | CSS property + feature-detect; Noto CJK `halt`/`chws` dependence; silent degrade on WebKit/old Blink |
| CJK-02 | 盘古之白 (`text-autospace`) + JS shim for older WebViews | Native CSS first; reversible non-mutating shim; never permanent text rewrite |
| CJK-03 | 禁则 (kinsoku / `line-break`) | `line-break: strict` + CLREQ prohibited tables; no JA UI in v1 |
| CJK-04 | 中文默认值：2em 首行缩进、line-height 链路、全角引号排版级 | Extend `buildReadingCss` with `!important`; no char rewrite for quotes |
| CJK-05 | 内置 CJK 字体 + coverage-aware fallback + golden-image Blink+WebKit | Noto Sans CJK SC+TC OFL assets via pillow font path; coverage sheet fixtures |
</phase_requirements>

## Summary

Phase 3 is the product moat: inject a **single CJK typography + font subsystem** into every foliate render document (paginate + continuous-scroll iframes) without inventing a second render path. Almost all wiring already exists — `buildReadingCss` → `renderer.setStyles` / ContinuousScrollStream style tag, `SettingsSheet` sections, `reading_prefs` SQLite row, `SYSTEM_CJK_STACK` + pillow `/fonts/{id}` serve. P3 extends those seams.

**Primary recommendation:** Native CSS first with session-cached `CSS.supports` feature detection; ship **Noto Sans CJK Variable (SC+TC)** as in-app assets under OFL; JS shim **only for autospace** and only via non-permanent techniques (CSS Custom Highlight / reversible wrappers that never rewrite characters); treat punctuation-trim and kinsoku as CSS-primary with silent degrade; prove parity with a **Blink + WebKit golden-image harness** and a glyph coverage sheet.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| CJK CSS defaults + toggles | Browser / Client | — | Extend `buildReadingCss`; inject via existing `setStyles` / scroll CSS path |
| Feature detection | Browser / Client | — | Runtime `CSS.supports` on the live WebView engine (DEC-002) |
| Autospace JS shim | Browser / Client | — | Owned shim; no permanent book-text mutation (D-36/D-37) |
| Aa「中文排版」UI | Browser / Client | — | Extend `SettingsSheet` only |
| Prefs columns for 3 toggles | Database / Storage | Browser / Client | SCHEMA_V3 append on `reading_prefs`; load/save in `reading-prefs.ts` |
| Bundled Noto CJK assets | API / Backend (Tauri) | Browser / Client | Ship in app resources/app_data materialize; serve via pillow fonts path |
| Font stack order | Browser / Client | — | custom → bundled Noto CJK → system stack (`fonts.ts`) |
| Golden-image harness | CI / QA | Browser | Blink (WebView2/Chromium) + WebKit (WKWebView/WebKitGTK) screenshots |
| Coverage sheet / tofu detect | Browser + fixtures | CI | Static HTML fixture + optional pixel/OCR check |
| READER-POS / scroll resume | — | — | **Out of scope** (MAJOR deferred to Phase 4) |

## Standard Stack

### Core (already in tree — do not re-pick)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| foliate-js (vendored) | SHA `78914ae` | Render docs + `setStyles` re-apply | MIT; character CFI; paginate+scroll |
| React / Vite / TS | 19.2.7 / 7.3.6 / 5.9.3 | Settings chrome | Project shell |
| `@tauri-apps/api` | 2.11.1 | `convertFileSrc`, invoke | Font/book URLs |
| `@tauri-apps/plugin-sql` | 2.4.0 | Prefs persistence | SCHEMA_V2 pattern |
| vitest | 3.2.4 | Pure helper unit tests | Phase 2 Wave 0 |
| System WebView | platform | CSS text engine | DEC-002 |

### Supporting (add / pin this phase)

| Artifact | Version / pin | Purpose | When |
|----------|---------------|---------|------|
| **Noto Sans CJK Variable** (SC + TC OTFs or multi-OTC) | pin release tag from `notofonts/noto-cjk` | Bundled body face, full SC+TC | CJK-05 |
| SIL Open Font License 1.1 text | ship with assets | Embedding/subset audit trail | CJK-05 |
| CLREQ-derived kinsoku char tables (app-owned TS) | in-repo constants | Document/test fixtures; CSS is runtime enforcer | CJK-03 |
| Playwright (or equivalent) dual-engine screenshot | exact pin if added | Golden-image Blink+WebKit | CJK-05 gate |
| Optional: `fonttools` / `pyftsubset` (dev-only) | exact pin if used | Subset tooling — only if size force; D-45 says size secondary | build scripts |

### Alternatives Considered

| Instead of | Could Use | Tradeoff | Decision |
|------------|-----------|----------|----------|
| Noto Sans CJK | Noto Serif CJK | Serif more “bookish”; larger perceptual weight; less common on phones | **Sans** — cleaner default for mixed modern CN ebooks; matches current system stack names |
| Super OTC all-langs | SC+TC language-specific variable only | Super OTC includes JP/KR bloat | Prefer **SC+TC variable pair** (or multi-OTC SC+TC) for coverage without KR/JP package tax |
| Character-insert autospace shim | CSS-only / Custom Highlight | Inserting U+0020/thin spaces breaks CFI/search | **Forbidden** (D-37) |
| Full DOM kinsoku rewriter | `line-break: strict` | High risk, low gain; line-break is Baseline | CSS-primary |
| Bundled Chromium | System WebView | Heavy; DEC-002 escape hatch only | **Not in P3** unless golden-image proves failure |
| Cloud font download | In-app assets | Out of scope REQUIREMENTS | Forbidden |
| Readest font/CSS code | Clean-room | AGPL | Forbidden (DEC-001) |

**Installation / asset layout (prescriptive):**

```
src-tauri/assets/fonts/noto-cjk/
  NotoSansCJKsc-VF.otf   # or .ttf variable — pin exact files
  NotoSansCJKtc-VF.otf
  LICENSE                # OFL-1.1
  NOTICE                 # attribution

# At app first-run or build-time materialize (same pattern as sample EPUB):
# app_data/fonts/bundled/noto-sans-cjk-sc.otf
# app_data/fonts/bundled/noto-sans-cjk-tc.otf
# Serve via existing pillow://fonts/{id} path OR reserved bundled ids
```

Do **not** put multi-tens-of-MB fonts under Vite `public/` if that doubles into WebView bundle without Tauri asset control — prefer Tauri resource/app_data materialize like sample books. [VERIFIED: Phase 1 sample materialize pattern + `fonts.rs` app_data serve]

## Package Legitimacy Audit

| Package / asset | Registry | License | Verdict | Disposition |
|-----------------|----------|---------|---------|-------------|
| Noto Sans CJK (notofonts/noto-cjk) | GitHub Google/Adobe | **SIL OFL 1.1** (embedding + subset OK) | OK | Ship binary assets + LICENSE |
| Playwright (if added for golden) | npm | Apache-2.0 | OK | devDependency only; exact pin |
| BudouX / `word-break: auto-phrase` | — | — | DEFER | Chromium-only; not CJK-01..05; no P3 UI |
| Readest font packs / CSS | AGPL app | AGPL | REJECT | Clean-room only |

**Packages removed due to [SLOP]:** none  
**Packages flagged [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
[SettingsSheet 「中文排版」 toggles]
        │ live onPrefsChange (D-22)
        ▼
[ReadingPrefs + cjkPunctTrim / cjkAutospace / cjkKinsoku]
        │ debounced SQL SCHEMA_V3
        ▼
[buildReadingCss(prefs, fontFaceCss, fontFamilyCss, caps)]
        │
        ├─► FoliateView.applyPrefsToRenderer → renderer.setStyles(css)
        └─► ContinuousScrollStream readingCss → iframe #pillow-reading-css

[Feature detect once per reader session]
  CSS.supports('text-spacing-trim','normal')
  CSS.supports('text-autospace','normal')
  CSS.supports('line-break','strict')
        │
        ├─ supported → emit native CSS properties
        └─ autospace unsupported → enable AutospaceShim (non-mutating)

[Font stack]
  @font-face PillowBundledCJK-SC / -TC  (pillow://fonts/bundled-…)
  body font-family:
    "PillowCustom-{id}"?, "PillowBundledCJK", SYSTEM_CJK_STACK

[Golden harness]
  fixtures/cjk-coverage.html + sample CN EPUB pages
  → Blink screenshot + WebKit screenshot → pixel/SSIM gate
```

### Recommended Project Structure (delta)

```
src/reader/
  apply-reading-styles.ts     # extend ReadingPrefs + buildReadingCss CJK block
  cjk-feature-detect.ts       # NEW: CSS.supports probes + session cache
  cjk-autospace-shim.ts       # NEW: reversible autospace only (D-36/D-37)
  cjk-kinsoku.ts              # NEW: prohibited start/end tables (fixtures + docs)
  fonts.ts                    # insert bundled face into stack
  SettingsSheet.tsx           # 「中文排版」 section + info affordances
  reading-prefs.ts            # map 3 new columns
  FoliateView.tsx             # pass caps into buildCss; mount/unmount shim
  ContinuousScrollStream.tsx  # ensure same CSS + shim hook on iframe load

src-tauri/
  assets/fonts/noto-cjk/      # NEW: OFL assets
  src/fonts.rs                # resolve bundled ids + custom ids
  src/protocol.rs             # already serves fonts/{id} — extend allowlist
  src/migrations.rs           # SCHEMA_V3 append

tests/fixtures/cjk/           # NEW: coverage sheet + golden baselines
  coverage-sheet.html
  kinsoku-samples.html
  golden/blink/…
  golden/webkit/…
```

### Pattern 1: Extend `ReadingPrefs` + SCHEMA_V3 (CJK-01..03)

**What:** Three booleans default `true`, global row only.  
**When:** Migration append; never rewrite v1/v2.  
**Prescriptive columns:** [ASSUMED names — discretion OK]

```sql
-- SCHEMA_V3 (append-only)
ALTER TABLE reading_prefs ADD COLUMN cjk_punct_trim INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reading_prefs ADD COLUMN cjk_autospace INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reading_prefs ADD COLUMN cjk_kinsoku INTEGER NOT NULL DEFAULT 1;
```

```ts
// apply-reading-styles.ts
export interface ReadingPrefs {
  // …existing…
  cjkPunctTrim: boolean;  // 标点挤压
  cjkAutospace: boolean;  // 盘古之白
  cjkKinsoku: boolean;    // 禁则
}

export const DEFAULT_PREFS: ReadingPrefs = {
  // …existing…
  cjkPunctTrim: true,
  cjkAutospace: true,
  cjkKinsoku: true,
};
```

Map in `reading-prefs.ts` with soft-fail to defaults (same as P2). [VERIFIED: `reading-prefs.ts` soft-fail pattern]

### Pattern 2: Feature detect once per session (D-35, DEC-002)

**What:** Probe actual CSS capability; never infer from OS/API level (D-12).  
**When:** First open of reader host (or first `buildReadingCss` call); cache on module/session object.

```ts
// cjk-feature-detect.ts
export interface CjkCssCaps {
  textSpacingTrim: boolean;
  textAutospace: boolean;
  lineBreakStrict: boolean;
}

export function detectCjkCssCaps(cssSupports = CSS.supports.bind(CSS)): CjkCssCaps {
  return {
    textSpacingTrim: cssSupports("text-spacing-trim: normal"),
    textAutospace: cssSupports("text-autospace: normal"),
    lineBreakStrict: cssSupports("line-break: strict"),
  };
}
```

**Recommendation:** Session cache is enough; recheck only if WebView process restarts (new app launch). No upgrade dialog (D-38).

### Pattern 3: Single CSS builder — no parallel path (CJK-01..04)

**What:** All CJK rules land inside `buildReadingCss` with `!important` where author CSS must lose (D-39).  
**When:** Every prefs apply; both paginate and continuous scroll.

```ts
// Pseudocode — emit only supported + enabled features
function buildCjkCss(prefs: ReadingPrefs, caps: CjkCssCaps): string {
  const parts: string[] = [];

  // CJK-04 defaults (always on; not toggles)
  parts.push(`
    body p {
      text-indent: 2em !important;
    }
    body h1, body h2, body h3, body h4, body h5, body h6,
    body blockquote, body pre, body li, body td, body th {
      text-indent: 0 !important;
    }
  `);
  // line-height already on body/p from existing builder; keep 1.75 default (D-41)

  if (prefs.cjkPunctTrim && caps.textSpacingTrim) {
    parts.push(`html, body { text-spacing-trim: normal !important; }`);
  }
  // OFF → space-all or omit (engine default); do not invent JS trim rewriter (D-36)

  if (prefs.cjkAutospace && caps.textAutospace) {
    parts.push(`html, body { text-autospace: normal !important; }`);
    // normal ≡ ideograph-alpha + ideograph-numeric (盘古：中英+中数)
  } else if (prefs.cjkAutospace && !caps.textAutospace) {
    // signal shim layer; no permanent DOM rewrite
  } else if (!prefs.cjkAutospace) {
    parts.push(`html, body { text-autospace: no-autospace !important; }`);
  }

  if (prefs.cjkKinsoku && caps.lineBreakStrict) {
    parts.push(`
      html, body {
        line-break: strict !important;
        word-break: normal !important;
        overflow-wrap: break-word !important;
      }
    `);
  } else if (!prefs.cjkKinsoku) {
    parts.push(`html, body { line-break: auto !important; }`);
  }

  // NEVER: word-break: break-all (destroys Latin + kinsoku)
  // NEVER: rewrite " → 「
  return parts.join("\n");
}
```

**Selector note for indent (D-40):** Apply `text-indent: 2em` to `body p` (and optionally `body div > p` if needed). Explicitly zero indent on headings, `blockquote`, `pre`, `li`, table cells. Do not indent first child of chapter title wrappers if they are headings. [ASSUMED exact EPUB selector edge cases — cover with torture CN sample]

### Pattern 4: Safe autospace JS shim (CJK-02, D-36/D-37)

**Prescriptive policy (priority order):**

1. **Native `text-autospace: normal`** when `CSS.supports` true.
2. **CSS Custom Highlight API** (`CSS.highlights` + `Highlight` + `::highlight(pillow-autospace)`) with Range objects over CJK↔Latin/digit boundaries — **no DOM mutation**. Prefer this when `CSS.highlights` exists. [ASSUMED availability varies; detect at runtime]
3. **Reversible wrapper spans** only if Custom Highlight unavailable: split text nodes and wrap boundary-adjacent runs in `<span data-pillow-shim="autospace" class="pillow-as">` with `padding-inline: 0.125em` (or `margin-inline`), **without inserting space characters**. On toggle-off, section unload, or before annotation phase needs raw DOM: **unwrap** and normalize text nodes.
4. **Silent degrade** if neither path works (D-38). Keep toggle ON visually; no toast wall.

**Hard bans:**
- Do not insert U+0020 / U+2009 into book text (breaks CFI character offsets, search excerpts, Phase 5 anchors).
- Do not run a full-book string replace (“Pangu spacing” classic).
- Do not leave wrappers after unmount.

```ts
// cjk-autospace-shim.ts — pattern only
export function installAutospaceShim(doc: Document): () => void {
  // 1) collect text nodes under body
  // 2) find /([\\u3400-\\u9FFF])([A-Za-z0-9])|([A-Za-z0-9])([\\u3400-\\u9FFF])/g boundaries
  // 3) either register CSS Highlight ranges OR wrap without inserting chars
  // return disposer that removes highlights / unwraps spans
}
```

Wire disposer into FoliateView section lifecycle and ContinuousScrollStream `injectStyles` path.

### Pattern 5: Kinsoku tables (CJK-03)

**Runtime enforcer:** `line-break: strict` + `word-break: normal` (Baseline since ~2020 on both engines). [CITED: MDN line-break — widely available July 2020]

**Tables purpose:** documentation, unit tests, golden fixtures — **not** a second layout engine.

**Sources:**
- W3C **CLREQ** §6.1 行首行尾禁则 (prohibition rules for line start/end). [CITED: w3.org/TR/clreq]
- CSS Text `line-break` strictness distinctions for CJK. [CITED: CSS Text Level 3/4]
- Unicode UAX #14 line-breaking classes (CL, OP, QU, etc.) as engine underpinnings. [ASSUMED]

**Prescriptive zh tables (shared core for Hans/Hant):**

```ts
// cjk-kinsoku.ts — illustrative core sets (expand from CLREQ Appendix)
/** Must not start a line (行首禁则) — closing / trailing punctuation */
export const ZH_PROHIBITED_LINE_START = [
  "。", "，", "、", "；", "：", "？", "！",
  "》", "」", "』", "】", "）", "〗", "〉",
  "”", "’", "℃", "%", "‰", "…", "—",
] as const;

/** Must not end a line (行尾禁则) — opening punctuation */
export const ZH_PROHIBITED_LINE_END = [
  "《", "「", "『", "【", "（", "〖", "〈",
  "“", "‘",
] as const;
```

**zh-Hans vs zh-Hant:** Use **one shared prohibition table** in v1. Regional differences in CLREQ are primarily **punctuation glyph position** (Mainland corner vs Taiwan/HK center) and quote preference — not divergent start/end sets for horizontal reading. Do **not** ship separate JA kinsoku UI or JA-only tables in P3. [CITED: CLREQ regional notes] [VERIFIED: 03-CONTEXT discretion — JA not required]

**全角引号 (D-42):** Ensure quotes in the prohibited sets participate in kinsoku/spacing; **do not** convert ASCII quotes in the DOM.

### Pattern 6: Font stack + bundled Noto (CJK-05)

**Pin:** **Noto Sans CJK** (not Serif) — OFL, SC+TC variable (or language-specific variable OTFs). [VERIFIED: notofonts/noto-cjk repo structure Sans/Serif] [ASSUMED exact release filenames until pin audit]

**Why Sans over Serif:** Matches existing `SYSTEM_CJK_STACK` naming (`Noto Sans CJK SC`); better UI/ebook hybrid default; variable sans widely deployed on Android.

**CSS order (D-47):**

```css
/* when custom active */
font-family: "PillowCustom-{id}", "PillowBundledCJK", system-ui, "PingFang SC",
  "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans CJK TC",
  sans-serif !important;

/* system / default */
font-family: "PillowBundledCJK", system-ui, "PingFang SC", "Hiragino Sans GB",
  "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans CJK TC", sans-serif !important;
```

Use **two `@font-face`** entries (SC + TC) with the **same** `font-family: "PillowBundledCJK"` and `unicode-range` if needed, **or** two families stacked. Prefer one family name with dual faces so fallback within the family is seamless.

**Serve path:** Reuse `pillowFontUrl` / protocol `fonts/{id}` with reserved safe ids e.g. `bundled-noto-sc`, `bundled-noto-tc` (must pass `is_safe_font_id`). Materialize from Tauri resources → `app_data/fonts/` on first launch if Resource paths are unreadable on Android (Phase 1 lesson). [VERIFIED: `fonts.rs` + `protocol.rs` + HANDOFF Resource/APK pitfall]

**License gate:** Before merge, commit `LICENSE` (OFL-1.1) + short NOTICE; confirm embedding in app binary allowed (OFL allows). No AGPL font packs. [CITED: DEC-001 discipline]

### Pattern 7: Settings UI「中文排版」(D-31..D-33)

Insert section after **主题** (or after **字体** — prefer **after 主题, before 字体** so typography features sit with theme, fonts remain face-picker). Use existing section spacing (`gap-8`).

Each row: label + Switch/toggle + info button (lucide `Info` / `CircleHelp`) opening a short Sheet/Popover with plain 简体中文:

| Toggle | Suggested helper copy (planner may polish) |
|--------|---------------------------------------------|
| 标点挤压 | 收窄中文标点旁多余空白，让「你好。」这类句子更紧凑、更像印刷书。 |
| 盘古之白 | 在汉字与英文、数字之间自动留出细小间距，例如「读取 PDF」更易扫读。 |
| 禁则 | 避免行首出现句号、逗号，或行尾出现左引号、左括号等不合适的断行。 |

No master toggle. Live apply + debounced save (D-22).

### Anti-Patterns to Avoid

- Parallel “CJK renderer” or second CSS injection path outside `buildReadingCss`
- Global `word-break: break-all`
- Permanent Pangu character insertion
- ASCII → fullwidth quote rewrite
- Inferring CSS support from Android API level
- Cloud font download / optional first-run pack (v1 out of scope)
- Copying Readest CJK CSS/font code
- Expanding P3 to fix READER-POS scroll resume
- Shipping JA-only kinsoku UI “because CLREQ mentions JA”

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Punctuation compression engine | Manual glyph width rewriter | `text-spacing-trim` + Noto CJK features | Engine-native; font `halt`/`chws` |
| Mixed-script spacing | Full DOM text rewriter | `text-autospace` + limited non-mutating shim | CFI/search safety (D-37) |
| Kinsoku layout engine | Custom line breaker | `line-break: strict` + CLREQ test tables | Baseline CSS; tables for tests only |
| Font protocol | New scheme / IPC bytes | Existing `pillow://fonts/{id}` | P2 already shipped |
| Prefs store | localStorage | SCHEMA_V3 + plugin-sql | D-20 |
| Golden harness from scratch browser | Ad-hoc screenshots only on Windows | Dual-engine harness Blink+WebKit | DEC-002 / success criterion 5 |
| Readest CJK packs | Copy AGPL assets | Noto CJK OFL clean-room | DEC-001 |

**Key insight:** P3 is an extension of the Phase 2 CSS/prefs/font pipeline, not a new engine.

## Common Pitfalls

### Pitfall 1: Blink-only CJK CSS assumed universal
**What goes wrong:** Windows looks pro; macOS/Linux/WebKit looks amateur.  
**Why:** `text-spacing-trim` is limited/not Baseline; historically Chromium-led. `text-autospace` only recently Baseline (Nov 2025). `line-break` is the safe shared primitive. [CITED: MDN; PITFALLS.md §1; FEATURES.md]  
**How to avoid:** Feature-detect; CSS progressive enhancement; golden-image on **both** engine families; silent degrade (D-38).  
**Warning signs:** Same EPUB, different punctuation rhythm across OS.

### Pitfall 2: `text-spacing-trim` no-ops without font features
**What goes wrong:** Toggle ON but no visible 挤压.  
**Why:** Property depends on OpenType `halt` / `chws` in the active face. [CITED: MDN text-spacing-trim]  
**How to avoid:** Bundle Noto CJK (known support path on modern stacks); document that system-only faces may trim less; golden tests use bundled face.  
**Warning signs:** Works on Android 13+ system Noto path, fails with incomplete custom font first in stack without fallback.

### Pitfall 3: Autospace shim breaks CFI / selection / future annotations
**What goes wrong:** Phase 5 anchors drift; search excerpts wrong.  
**Why:** Inserted spaces or permanent wrappers change character offsets.  
**How to avoid:** D-37 policy — Custom Highlight or reversible unwrap; never character insertion; unit-test that `textContent` concatenation equals original.  
**Warning signs:** CFI restore off-by-N after toggle autospace.

### Pitfall 4: `word-break: break-all` “fix” for CJK
**What goes wrong:** Latin mid-word splits; kinsoku ignored.  
**How to avoid:** `word-break: normal` + `line-break: strict` only. [VERIFIED: PITFALLS.md §2]

### Pitfall 5: Ransom-note / tofu font stack
**What goes wrong:** Mid-line face switches; □ boxes; SC glyphs in TC text.  
**How to avoid:** Bundled SC+TC Noto; stack order custom → bundled → system; coverage sheet golden. [VERIFIED: PITFALLS.md §3; D-44..D-47]

### Pitfall 6: Android Resource font unreadable
**What goes wrong:** `@font-face` 404 on device.  
**Why:** APK resources not always `std::fs` readable (Phase 1 sample lesson).  
**How to avoid:** Materialize bundled fonts into `app_data/fonts/` then serve via pillow protocol. [VERIFIED: HANDOFF / fonts.rs pattern]

### Pitfall 7: Continuous scroll misses CJK CSS/shim
**What goes wrong:** Paginate looks great; scroll mode reverts to author styles.  
**Why:** Dual surface: foliate `setStyles` vs ContinuousScrollStream style tag.  
**How to avoid:** Same `buildReadingCss` string + same shim install on each iframe `injectStyles`. [VERIFIED: ContinuousScrollStream.tsx injectStyles]

### Pitfall 8: First-line indent on titles / lists
**What goes wrong:** Ugly indented headings.  
**How to avoid:** D-40 selector allowlist; zero indent on non-body blocks; visual check CN sample EPUB.

### Pitfall 9: Quote character rewriting
**What goes wrong:** Search for `"` fails; user-visible text changes.  
**How to avoid:** D-42 typography-level only.

### Pitfall 10: Scope creep into READER-POS
**What goes wrong:** P3 becomes scroll-position bugfix.  
**How to avoid:** STATE.md MAJOR `READER-POS` deferred to Phase 4 — only touch scroll if CJK CSS injection is broken there.

### Pitfall 11: Install size shock without license/size notes
**What goes wrong:** APK + desktop install jumps tens of MB; reviewers surprised.  
**How to avoid:** User accepted size secondary (D-45); still document size in SUMMARY; pin variable SC+TC not full multi-weight static Super set of all languages if avoidable.

### Pitfall 12: Clean-room violation via font/CSS copy
**What goes wrong:** AGPL contagion.  
**How to avoid:** Noto OFL + self-authored CSS; never paste Readest. [VERIFIED: DEC-001]

## Code Examples

### CSS capability matrix (planner reference)

| Feature | CSS | Role | Blink (Win/Android WebView) | WebKit (macOS/Linux) | P3 strategy |
|---------|-----|------|----------------------------|----------------------|-------------|
| 标点挤压 | `text-spacing-trim: normal` | CJK-01 | Modern Chromium: yes (limited history; font-dependent) | Historically weaker / verify at runtime | CSS if caps; else silent degrade — **no JS rewriter** |
| 盘古之白 | `text-autospace: normal` | CJK-02 | Shipping on current Chromium; older WebViews lag | Improving with Baseline 2025; verify | CSS if caps; else **JS non-mutating shim** or silent degrade |
| 禁则 | `line-break: strict` | CJK-03 | Yes (Baseline) | Yes (Baseline) | CSS primary; tables for tests |
| Indent | `text-indent: 2em` | CJK-04 | Universal | Universal | Always inject |
| Line-height | existing `1.75` | CJK-04 | Universal | Universal | Keep default; no change |
| Quotes | kinsoku participation | CJK-04 | via line-break | via line-break | No char rewrite |

Tags: support summary combines [CITED: MDN text-autospace Baseline 2025], [CITED: MDN line-break Baseline 2020], [CITED: MDN text-spacing-trim limited], [VERIFIED: PITFALLS/FEATURES project research]. **Runtime `CSS.supports` is authoritative** — never hardcode OS matrix in product logic.

### Font face builder extension

```ts
// fonts.ts — pattern
export const BUNDLED_CJK_FAMILY = "PillowBundledCJK";

export function buildBundledCjkFontFaceCss(): string {
  return `
    @font-face {
      font-family: "${BUNDLED_CJK_FAMILY}";
      src: url("${pillowFontUrl("bundled-noto-sc")}");
      font-display: swap;
      /* optional unicode-range for SC */
    }
    @font-face {
      font-family: "${BUNDLED_CJK_FAMILY}";
      src: url("${pillowFontUrl("bundled-noto-tc")}");
      font-display: swap;
      /* optional unicode-range for TC */
    }
  `;
}

export function fontFamilyCssFor(key: string, activeFontId: string | null): string {
  const tail = `"${BUNDLED_CJK_FAMILY}", ${SYSTEM_CJK_STACK}`;
  if (key === "system" || !activeFontId) return tail;
  return `"${pillowCustomFamily(activeFontId)}", ${tail}`;
}
```

### Settings section skeleton

```tsx
<section className="reader-settings-section">
  <h3 className="reader-settings-section__title">中文排版</h3>
  {/* three rows: Switch + label + Info button → Dialog/Popover 简体中文 */}
</section>
```

Use existing Switch if present, or ToggleGroup binary, or shadcn `switch` add — planner chooses official registry only (UI-SPEC rule).

## State of the Art

| Old Approach | Current Approach | When | Impact |
|--------------|------------------|------|--------|
| Manual kerning / image hacks | `text-spacing-trim` | CSS Text 4 / Chrome i18n wave | Engine-native 标点挤压 |
| Pangu.js space insertion | `text-autospace` | Broad ~Nov 2025 | Spacing without text rewrite |
| JA-only strict tables | CSS `line-break` + CLREQ | longstanding | Shared CJK strictness |
| System-font-only readers | Bundled Noto CJK OFL | industry standard | Kill tofu on non-CN OS |

**Deprecated for this phase:** permanent Pangu string mutation; `break-all`; cloud fonts; bundled Chromium as default.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `text-spacing-trim` remains CSS-only with silent degrade acceptable for success criterion 1 on WebKit | CJK-01 | May need limited visual polyfill or escape-hatch Chromium later |
| A2 | CSS Custom Highlight or reversible spans can approximate autospace without CFI breakage | CJK-02 | Fall back to silent degrade more often |
| A3 | Shared zh Hans/Hant kinsoku sets suffice | CJK-03 | Rare TC-specific break complaints |
| A4 | Noto Sans Variable SC+TC files fit product size budget user accepted | CJK-05 | Need aggressive subset while keeping D-44 |
| A5 | Reserved font ids `bundled-noto-sc/tc` pass sanitize + protocol | Fonts | Rename to match `is_safe_font_id` |
| A6 | Session-cached feature detect is enough | Caps | Miss mid-session WebView updates (rare) |

## Open Questions

1. **Exact Noto file pin (Sans VF SC+TC vs Super OTC)**  
   - Known: Sans line, OFL, SC+TC full coverage, size secondary (D-43..45).  
   - Unclear: final release tag / file names / whether Mono needed (no).  
   - **Recommendation:** Pin latest stable **Noto Sans CJK language-specific variable SC + TC** pair; license files co-located; measure APK/desktop delta in 03-03.

2. **Autospace shim: Custom Highlight vs reversible spans first**  
   - Known: D-37 forbids permanent mutation.  
   - Unclear: Custom Highlight support in WebView2 / Android WebView / WKWebView versions we care about.  
   - **Recommendation:** Implement detect → Highlight path → span path → silent degrade; unit-test textContent invariance.

3. **Golden harness host**  
   - Known: need Blink + WebKit families (D-46, DEC-002).  
   - Unclear: CI has macOS/Linux WebKit runners?  
   - **Recommendation:** Local dual-run scripts in P3; CI at least Chromium; document WebKit as required phase-gate on dev machine / optional GH macOS runner. WebView2 on Windows + WebKitGTK Linux covers both families if macOS unavailable.

4. **Switch component**  
   - Known: Settings uses ToggleGroup/Slider.  
   - Unclear: whether `switch` already generated.  
   - **Recommendation:** Prefer shadcn official `switch` if missing; keep visual consistent with paper-feel tokens.

## Environment Availability

| Dependency | Required By | Available | Notes |
|------------|------------|-----------|-------|
| Node/pnpm/vitest | Unit tests | ✓ | vitest 3.2.4 pinned |
| Rust/MSVC | Tauri fonts/migrations | ✓ | Windows MSVC for cargo test |
| Android emulator AVD | Device gate (CLAUDE.md) | ✓ (P1) | Mandatory for reader/font CSS claims |
| WebView2 (Windows) | Blink golden | ✓ on Win host | Primary Blink surface |
| WebKitGTK / macOS WKWebView | WebKit golden | environment-dependent | Required for phase success criterion 5 |
| Noto CJK download | CJK-05 | network at pin time | Commit binaries or Git LFS — planner chooses; no runtime download |

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 3.2.4 (TS pure helpers); cargo test (fonts/migrations); visual golden (Playwright or scripted WebView) |
| Config | `vitest.config.ts`; Cargo workspace |
| Quick run | `pnpm test` + `cargo test --workspace` (MSVC on Windows) |
| Full gate | unit + build + golden Blink + golden WebKit + Android emulator smoke |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CJK-01 | CSS emits `text-spacing-trim` only if toggle+caps | unit | `pnpm test -- apply-reading-styles` | ⚠️ extend |
| CJK-01 | OFF omits / disables trim | unit | same | ❌ |
| CJK-02 | CSS emits `text-autospace: normal` when caps | unit | same | ❌ |
| CJK-02 | Shim does not change concatenated textContent | unit | `pnpm test -- cjk-autospace-shim` | ❌ Wave 0 |
| CJK-02 | Shim disposer restores DOM | unit | same | ❌ |
| CJK-03 | CSS emits `line-break: strict` + never `break-all` | unit | apply-reading-styles | ⚠️ extend |
| CJK-03 | Prohibited start/end tables snapshot | unit | `pnpm test -- cjk-kinsoku` | ❌ |
| CJK-04 | `text-indent: 2em` on `p`; 0 on headings | unit | apply-reading-styles | ⚠️ extend |
| CJK-04 | DEFAULT lineHeight remains 1.75 | unit | DEFAULT_PREFS | ⚠️ extend |
| CJK-05 | font stack order custom → bundled → system | unit | fonts.ts tests | ❌ |
| CJK-05 | OFL license file present next to assets | smoke/ci | file existence script | ❌ |
| CJK-05 | Coverage sheet no tofu (bundled face) | golden | dual-engine screenshot | ❌ |
| D-34 | SCHEMA_V3 columns default 1 | integration | `cargo test` migration | ⚠️ extend |
| DEC-002 | Feature detect pure fn | unit | cjk-feature-detect | ❌ |
| Android | Reader + bundled font open | manual/device | `pnpm tauri android dev` | gate |

### Sampling Rate
- **Per task:** `pnpm test` for TS; `cargo test` for Rust font/migration
- **Per wave:** + `pnpm build`
- **Phase gate:** golden-image Blink+WebKit on coverage sheet + CN sample EPUB; Android emulator smoke (CLAUDE.md device gate); toggles persist across relaunch

### Wave 0 Gaps
- [ ] Extend `ReadingPrefs` / `DEFAULT_PREFS` / tests for 3 CJK booleans
- [ ] `cjk-feature-detect.ts` + unit tests with mock `CSS.supports`
- [ ] `cjk-autospace-shim.ts` textContent invariance tests
- [ ] `cjk-kinsoku.ts` table snapshots
- [ ] SCHEMA_V3 migration + migration test
- [ ] Bundled font resolve path + protocol allowlist tests
- [ ] Golden harness scaffold + coverage-sheet fixture
- [ ] SettingsSheet section + a11y labels 简体中文
- [ ] Ensure ContinuousScrollStream gets identical CSS/shim

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V4 Access Control | yes | Font path jail under app_data/fonts; safe ids only |
| V5 Input Validation | yes | Sanitize font ids; SQL bound params for prefs |
| V6 Cryptography | no | — |
| Supply chain | yes | Exact pins; OFL audit; no AGPL fonts |

### Known Threat Patterns

| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| Path traversal via font id | Tampering | `is_safe_font_id` + canonicalize (existing) |
| Oversized bundled assets | Denial | Pin known sizes; no unbounded download |
| XSS via injected CSS from prefs | Elevation | Prefs are booleans/numbers only; CSS builder uses fixed templates |
| EPUB script | Elevation | Engine sandbox; do not enable book scripts |
| License contagion | Legal | OFL Noto only; clean-room |

## Project Constraints (from CLAUDE.md)

- Platforms v1: Windows / macOS / Linux + Android; Chinese UX is a **hard differentiator**.
- **Android emulator gate mandatory** for reader/typography/font/protocol claims — desktop green ≠ Android correct.
- Touch/scroll rules: no full-screen transparent pointer-eating overlays; sheet body `min-h-0 overflow-y-auto`.
- Stack: Tauri v2 + React/Vite/TS + foliate-js MIT + SQLite; **exact pins**.
- **Do not copy Readest AGPL source.**
- Book bytes never cross IPC; fonts prefer protocol serve not IPC dumps.
- Privacy/local-first; no forced cloud (includes no cloud fonts).

## Concrete Answers (planner quick index)

| # | Question | Answer | Tag |
|---|----------|--------|-----|
| 1 | CSS support matrix? | `line-break:strict` Baseline both engines; `text-autospace` modern/Baseline 2025; `text-spacing-trim` limited/font-dependent — always feature-detect | CITED MDN + project PITFALLS |
| 2 | Autospace JS without breaking CFI? | Prefer CSS; else Custom Highlight or reversible non-character wrappers; never insert spaces; silent degrade last | D-36/D-37 + ASSUMED Highlight support |
| 3 | Kinsoku tables? | CLREQ §6.1 shared zh start/end sets; runtime via `line-break:strict`; **no JA UI v1** | CITED CLREQ + CONTEXT |
| 4 | Noto packaging? | **Noto Sans CJK** variable SC+TC, OFL, in-app assets, pillow serve, size secondary | D-43..45 + noto-cjk |
| 5 | Extend pipeline? | SCHEMA_V3 + prefs fields + `buildReadingCss` CJK block + Settings「中文排版」+ fonts stack; same FoliateView/ContinuousScrollStream paths | VERIFIED codebase |
| 6 | Golden harness? | Coverage sheet + CN sample; Blink (WebView2/Chromium) + WebKit; phase-gate screenshots | DEC-002 / D-46 |
| 7 | Defaults? | `text-indent:2em` on body `p`; lh 1.75 unchanged; no quote rewrite | D-40..42 |
| 8 | Escape chain? | custom → PillowBundledCJK → SYSTEM_CJK_STACK (+ TC names) | D-47 |

## Sources

### Primary (HIGH)
- `D:/Github/Pillowtome/.planning/phases/03-cjk-typography-differentiation/03-CONTEXT.md` — D-30..D-47
- `D:/Github/Pillowtome/src/reader/apply-reading-styles.ts`, `SettingsSheet.tsx`, `reading-prefs.ts`, `fonts.ts`, `FoliateView.tsx`, `ContinuousScrollStream.tsx`
- `D:/Github/Pillowtome/src-tauri/src/fonts.rs`, `protocol.rs`, `migrations.rs`
- `D:/Github/Pillowtome/docs/decisions/DEC-002-webview-engine.md`, `DEC-001-license-cleanroom.md`
- `D:/Github/Pillowtome/.planning/research/PITFALLS.md`, `FEATURES.md`, `SUMMARY.md`, `ARCHITECTURE.md`
- MDN: `text-spacing-trim`, `text-autospace`, `line-break`
- W3C CLREQ: https://www.w3.org/TR/clreq/
- Noto CJK: https://github.com/notofonts/noto-cjk

### Secondary (MEDIUM)
- Chrome i18n features blog (historical shipping notes for autospace/trim)
- Project FEATURES.md support dates (trim 2024, autospace Nov 2025)

### Tertiary (LOW)
- Exact pixel thresholds for golden SSIM
- Custom Highlight availability matrix per WebView build — must runtime-detect

## Metadata

**Confidence breakdown:**
- Codebase integration points: **HIGH** — read current reader CSS/font/prefs paths
- CSS capability matrix: **MEDIUM-HIGH** — MDN + project research; still runtime-detect in product
- Autospace shim technique: **MEDIUM** — D-37 constraints clear; Custom Highlight support varies
- Font pin details: **MEDIUM** — family/license locked; exact files to audit at implement time
- Kinsoku: **HIGH** for CSS approach; **MEDIUM** for exhaustive char lists

**Research date:** 2026-07-16  
**Valid until:** 2026-08-16 (30 days; WebView CSS support moves)

---

*Phase: 03-cjk-typography-differentiation*  
*Research completed: 2026-07-16*  
*Ready for planning: yes*

## RESEARCH COMPLETE
