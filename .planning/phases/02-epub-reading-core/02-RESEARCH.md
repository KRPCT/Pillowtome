# Phase 2: EPUB Reading Core - Research

**Researched:** 2026-07-15
**Domain:** foliate-js reading chrome + prefs/locator persistence (Tauri v2 / React / SQLite)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Carried from Phase 1 / UI-SPEC (do not re-decide)
- **D-01..D-13 (P1):** Tauri v2 + React/Vite/TS; foliate-js render; system WebView; `BookSource` storage-handle; book bytes only via `pillow://` (never IPC); composite Locator type + schema v1; DRM detect-and-refuse; clean-room vs Readest AGPL.
- **UI locked:** shadcn radix-nova + Tailwind v4; 极简纸感 day/night/sepia dual-layer tokens; Aa bottom sheet; immersive default with center-toggle + L/R thirds page-turn; 简体中文 copy. See `02-UI-SPEC.md`.

#### Reading preferences persistence (READ-01..03, partial READ-02/06)
- **D-20:** Store global reading preferences in a **new SQLite table** via `tauri-plugin-sql` (same binding as schema v1 — no second SQLite). Not `localStorage`.
- **D-21:** Preferences are **global only** in P2 (one profile for all books). No per-book overrides until a later phase.
- **D-22:** Changes **apply immediately** to the foliate renderer and **auto-save** (debounce writes). No separate “应用” button.
- **Fields (minimum):** reading mode (paginate|scroll), theme (day|night|sepia), font family key, font size, line-height, margins, active custom-font id (nullable). Defaults match UI-SPEC body defaults (18px / 1.75 / 24px / system CJK stack / day / paginate).
- **Migration:** append schema v2 migration; never rewrite v1 tables.

#### Reading position restore (pre-P5 progress)
- **D-23:** **Persist and restore** position using schema v1 **`locator` table** (CFI + `progress_fraction` + text_pre/exact/post). Do not invent a bare-percentage store (honors D-08).
- **D-24:** Write on foliate `relocate` with **debounce (~500ms)**; **force flush** on reader close / component unmount / app background if available.
- **D-25:** First open or invalid/unresolvable locator → **start at text start** (`goToTextStart` / equivalent). No modal; log failures for debug only.
- **D-26:** Map open book id → `work_id` for locator rows. Planner/executor may ensure a `work` row exists on open/import if missing (UUID + content hash when cheap; otherwise stable id strategy documented in plan — must not block open).

#### Custom fonts (READ-06)
- **D-27:** On import, **copy** TTF/OTF/WOFF into **app data** (`fonts/` under app data dir). SQLite metadata: family display name, internal path/id, created_at. Do **not** depend on original path or Android SAF grant for fonts.
- **D-28:** Limits: **max 20** custom fonts; **≤ 20MB** per file. Over limit → refuse with 简体中文 helper (UI-SPEC copy).
- **D-29:** Remove (after UI-SPEC confirm): **delete app-data copy + metadata**. If removed font was active → fall back to system CJK stack. Never delete the user's original file.
- **D-30:** Inject selected face into foliate render documents via `@font-face` (or equivalent) using an app-served URL/path that WebView can load — planner picks protocol detail; book bytes path rules (D-06) still apply to EPUB content, not necessarily to font files, but prefer not shipping font bytes over large IPC payloads.

#### Search & desktop input (READ-07 + desktop UX)
- **D-31:** In-book search uses **foliate-js `view.search()`** async generator + engine matchers/highlight. Prefer engine CJK substring behavior; if gaps appear, add a **thin adapter** (still engine-backed), do **not** build a parallel search index in P2.
- **D-32:** Default search scope = **entire book**; results show snippet + chapter caption (UI-SPEC). Optional “本章 only” is out of P2 must-have.
- **D-33:** Desktop keyboard (phone remains touch-only for these):
  - ← / → and PageUp / PageDown → page turn (paginated) or scroll step if engine supports; do not invent vim keys
  - Esc → close open sheet, else show chrome if immersive
  - `/` or Ctrl+F → open search sheet
- **D-34:** Search debounce **200–300ms** (UI-SPEC); empty state copy per UI-SPEC.

### Claude's Discretion
- Exact SQLite column names / migration SQL wording for prefs + fonts tables
- Debounce constants within the stated ranges
- Whether TOC is left drawer ≥768px vs bottom sheet (UI-SPEC already prefers this — implement as specified)
- Font-face serving mechanism (custom protocol vs asset path) as long as reload-safe and Android-safe
- Torture-corpus fixture set composition for plan 02-04 (must soft-fail, not crash)
- Optional 3s chrome auto-hide timer (UI-SPEC optional) — may ship or skip without re-asking

### Deferred Ideas (OUT OF SCOPE)
- Per-book preference overrides → later (not P2)
- Full annotation/highlight/bookmark UI → Phase 5
- Bundled CJK font + coverage fallback + kinsoku/autospace → Phase 3
- Library cover grid redesign / home shell paper-feel theming → Phase 4
- Sync of prefs/progress over WebDAV → Phase 7 (change_log present-but-unsynced)
- Vim-style keybindings, advanced search filters (regex, chapter-only toggle) → post-P2 backlog
- Physical Android device verification still open from P1 (D-13 emulator substitute)

None of the above expand P2 scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| READ-01 | Toggle paginate ↔ scroll in real time | `renderer.setAttribute('flow', 'paginated' \| 'scrolled')` on reflowable paginator; live attribute switch without reload |
| READ-02 | Font / size / line-height / margins | `renderer.setStyles(cssString \| [before, after])` + `margin` attribute; inject system/custom font stack |
| READ-03 | Day / night / sepia | Dual-layer: reader root `data-theme` chrome tokens + page bg/fg via `setStyles` |
| READ-04 | Immersive chrome + tap zones | React overlay; `renderer.prev/next` (or `view.goLeft/goRight`); default immersive on `"reading"` |
| READ-05 | TOC jump | `view.book.toc` tree + `view.goTo(href)` |
| READ-06 | Custom font import | Copy to `app_data_dir/fonts/`; SQLite metadata; `@font-face` via app-served URL |
| READ-07 | In-book CJK search | `view.search({ query })` async generator; grapheme granularity = CJK substring; jump via CFI |
</phase_requirements>

## Summary

Phase 2 extends the proven Phase 1 `pillow://` → `<foliate-view>` slice into a Lithium-parity reading surface. Almost all render behavior already lives in vendored foliate-js (`view.js` + `paginator.js` + `search.js`); the work is React chrome, preference/locator persistence, font filesystem, and soft-fail CI — not a new render engine.

The load-bearing APIs are concrete and already present in the pinned vendor tree (`78914ae`): **flow** switches via `renderer.setAttribute('flow', …)`, typography/theme via `renderer.setStyles(…)`, navigation via `view.goTo` / `goToTextStart` / `goLeft|goRight`, progress via the `relocate` custom event (`cfi` + whole-book `fraction` + DOM `range`), and search via `async * view.search({ query })` with default **grapheme** matching (CJK-friendly, no word-boundary requirement). Persistence must use the existing `tauri-plugin-sql` binding (`sqlite:pillow.db`) with a **v2 migration** for prefs/fonts; locator rows reuse schema v1.

**Primary recommendation:** Expand `FoliateView` into a thin engine controller + chrome composition root; drive foliate only through documented attribute/`setStyles`/`goTo`/`search` APIs; persist prefs/locators/fonts through SQLite + app-data copy; never re-introduce book-byte IPC or hand-rolled protocol URLs.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Paginate ↔ scroll toggle | Browser / Client | — | foliate paginator attribute on renderer element |
| Typography + theme injection | Browser / Client | — | `setStyles` into iframe render documents |
| Immersive chrome / tap zones / sheets | Browser / Client | — | React overlay + shadcn Sheet; no native fullscreen required |
| TOC / search UI | Browser / Client | — | Read `book.toc`; consume `view.search()` generator |
| Prefs / fonts metadata persistence | Database / Storage | Browser / Client | SQLite via `tauri-plugin-sql`; UI loads/saves |
| Locator progress persist/restore | Database / Storage | Browser / Client | schema v1 `locator` + `work`; debounced from `relocate` |
| Custom font binary storage | API / Backend (Tauri) | Database / Storage | Rust copies into `app_data_dir/fonts/`; metadata in SQL |
| Font file serve to WebView | API / Backend (Tauri) | Browser / Client | Custom protocol or scoped asset URL (not IPC bytes) |
| Book byte streaming | API / Backend (Tauri) | Browser / Client | Existing `pillow://` only (D-06) |
| DRM / corrupt soft-fail | API / Backend + core | Browser / Client | `check_protection` + ErrorCard (already shipped) |
| Torture-corpus CI | core / cargo tests | — | Off-device fixtures; no WebView required for gate |

## Standard Stack

### Core (already in tree — do not re-pick)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| foliate-js (vendored) | SHA `78914ae` | EPUB open/render/search/TOC/CFI | MIT; character-level CFI; paginate+scroll; used in Phase 1 |
| `@tauri-apps/api` | 2.11.1 | `invoke`, `convertFileSrc`, path | Sole bridge for small IPC + protocol URLs |
| `@tauri-apps/plugin-sql` | 2.4.0 | SQLite from frontend | Official Android+desktop; schema already wired |
| `@tauri-apps/plugin-dialog` | 2.7.1 | Font/book file pickers (desktop) | Already used for book import |
| React / Vite / TS | 19.2.7 / 7.3.6 / 5.9.3 | Reader chrome | Project shell |
| Tailwind v4 + shadcn radix-nova | 4.3.2 / 4.13.0 | Sheets/sliders/toggles | UI-SPEC locked |
| `lucide-react` | 1.24.0 | Toolbar icons | UI-SPEC |
| `pillowtome-core` | path crate | Locator type, blake3 hash, DRM | Platform-free seams |
| `tauri` / `tauri-plugin-sql` (Rust) | 2.11.5 / 2.4.0 | Protocol + migrations | Exact-pinned |

### Supporting (add this phase)

| Library / artifact | Version | Purpose | When to Use |
|--------------------|---------|---------|-------------|
| shadcn `sheet` | local gen | Settings / TOC / Search | UI-SPEC inventory |
| shadcn `slider` | local gen | 字号 / 行距 / 边距 | UI-SPEC |
| shadcn `toggle-group` | local gen | 分页/滚动, 日间/夜间/Sepia | UI-SPEC |
| shadcn `input` | local gen | Search field | UI-SPEC |
| shadcn `scroll-area` | local gen | TOC / results / settings body | UI-SPEC |
| shadcn `separator` | local gen | Sheet section dividers | UI-SPEC |
| shadcn `badge` | optional | Search hit count | optional only |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| foliate `setStyles` | Mutate iframe CSSOM manually | Breaks on section reload; engine already re-applies styles |
| SQLite prefs | `localStorage` | Violates D-20; no Android/desktop parity story; not sync-ready |
| Asset protocol for fonts | Custom `pillowfont://` or pillow path | Asset scopes fragile on Android; custom protocol matches Phase 1 lessons |
| Parallel search index | foliate `view.search` | D-31 forbids; CFI/highlight stay engine-aligned |
| Readest reader code | Clean-room React chrome | AGPL contagion (DEC-001) |

**Installation:**
```bash
# No new runtime npm packages expected. Generate shadcn components only:
pnpm dlx shadcn@4.13.0 add sheet slider toggle-group input scroll-area separator
# optional:
pnpm dlx shadcn@4.13.0 add badge
```

**Version verification:** `@tauri-apps/plugin-sql@2.4.0`, `dialog@2.7.1`, `lucide-react@1.24.0` match `package.json` pins. [VERIFIED: codebase]

## Package Legitimacy Audit

> No new third-party runtime packages recommended for this phase. UI pieces come from the official shadcn registry into local `src/components/ui/*` using already-installed `radix-ui` / `class-variance-authority` / `lucide-react`.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| *(none new)* | — | — | — | — | OK | N/A — reuse pinned stack |

**Packages removed due to [SLOP] verdict:** none  
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
[User gesture: open book id]
        │
        ▼
[FoliateView controller]
  ├─ invoke(check_protection) ──► [Rust: SourceRegistry + core::detect_protection]
  │                                      │
  │                                      └─ refuse → ErrorCard (soft-fail)
  │
  ├─ ensure work_id (SQL work upsert; content_hash when cheap)
  ├─ load global prefs (SQL reading_prefs)
  ├─ fetch(pillowUrl(id)) ──► [pillow:// protocol] ──► book bytes (never IPC)
  ├─ view.open(File/Blob)
  ├─ apply flow + setStyles + optional @font-face
  ├─ restore locator (SQL) → view.goTo(cfi) | view.goToTextStart()
  │
  ├─ relocate events ──debounce 500ms──► UPSERT locator (cfi, fraction, text_*)
  ├─ Settings sheet ──live──► setAttribute(flow) / setStyles / data-theme
  ├─ TOC sheet ──► view.goTo(href)
  ├─ Search sheet ──debounce 200–300ms──► for await view.search({query})
  │                                         └─ jump via goTo(cfi)
  └─ Font import ──invoke──► [Rust: copy app_data/fonts + SQL fonts row]
                                └─ serve face URL into setStyles @font-face
```

### Recommended Project Structure

```
src/
├── reader/
│   ├── FoliateView.tsx          # engine mount + lifecycle (extend)
│   ├── error-card.tsx           # soft-fail (keep)
│   ├── ReaderChrome.tsx         # toolbar + progress + immersive state
│   ├── ReaderTapZones.tsx       # L/C/R hit regions
│   ├── SettingsSheet.tsx        # Aa bottom sheet
│   ├── TocSheet.tsx
│   ├── SearchSheet.tsx
│   ├── ProgressBar.tsx
│   ├── apply-reading-styles.ts  # build CSS for setStyles + theme tokens
│   ├── reading-prefs.ts         # load/save prefs via plugin-sql
│   ├── locator-store.ts         # load/save locator rows
│   └── fonts.ts                 # list/active font helpers (invoke + SQL)
├── components/ui/               # shadcn: sheet, slider, toggle-group, …
├── lib/pillow.ts                # keep sole book URL builder
└── index.css                    # reader data-theme paper tokens

src-tauri/src/
├── migrations.rs                # append SCHEMA_V2 + Migration version 2
├── commands.rs                  # font import/list/remove (+ maybe ensure_work)
├── lib.rs                       # register commands; optional font protocol
└── fonts.rs                     # NEW: app_data/fonts copy + limits
```

### Pattern 1: Flow toggle (READ-01)

**What:** Set the paginator's `flow` attribute; engine re-renders without reopening the book.  
**When:** Settings 分页/滚动 toggle; also apply on open from prefs.  
**Example:** [VERIFIED: codebase `src/vendor/foliate-js/reader.js`, `paginator.js`]

```ts
// paginated | scrolled — must use setAttribute (no JS property API)
view.renderer?.setAttribute("flow", mode === "scroll" ? "scrolled" : "paginated");
// optional page margins (px only):
view.renderer?.setAttribute("margin", `${marginPx}`);
```

Notes:
- Observed attributes: `flow`, `gap`, `margin`, `max-inline-size`, `max-block-size`, `max-column-count`. [VERIFIED: `paginator.js` static observedAttributes]
- FXL books use `fixed-layout.js` (no `flow` / no `setStyles`) when `book.rendition.layout === 'pre-paginated'`. Disable mode/typography knobs for FXL; still soft-fail only if open throws. [VERIFIED: `view.js` `isFixedLayout`]

### Pattern 2: Style injection (READ-02/03/06)

**What:** `renderer.setStyles(string | [beforeStyle, style])` writes into render-document `<style>` tags and re-applies on section load.  
**When:** Any typography/theme/font change; also after `open` before first paint.  
**Example:** [VERIFIED: `paginator.js` `setStyles`, `reader.js` `getCSS`]

```ts
function buildReadingCss(prefs: ReadingPrefs, fontFaceCss: string): string {
  return `
    ${fontFaceCss}
    html {
      background: ${prefs.pageBg} !important;
      color: ${prefs.pageFg} !important;
    }
    body {
      font-family: ${prefs.fontFamily};
      font-size: ${prefs.fontSizePx}px;
      line-height: ${prefs.lineHeight};
    }
    p, li, blockquote, dd {
      line-height: ${prefs.lineHeight};
    }
  `;
}
view.renderer?.setStyles?.(buildReadingCss(prefs, fontFaceCss));
```

Page theme colors (UI-SPEC): day `#FFFEF9`/`#1C1915`, night `#12100E`/`#E8E2D6`, sepia `#F4ECD8`/`#3B2F1E`.  
Default font stack: `system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`.  
Chrome theme stays on `.reader[data-theme=…]` CSS variables — dual-layer, independent of OS dark mode. [VERIFIED: `02-UI-SPEC.md`]

### Pattern 3: Relocate → composite locator (D-23..25)

**What:** Listen to `relocate`; map engine payload into schema v1 `locator` columns.  
**When:** Every page/scroll snap; debounced write; flush on unmount.  
**Example:** [VERIFIED: `view.js` `#onRelocate`, `progress.js` `getProgress`]

```ts
// e.detail shape (view-level, after SectionProgress merge):
// {
//   fraction,            // whole-book 0..1  ← persist as progress_fraction
//   section: { current, total },
//   location: { current, next, total },
//   tocItem, pageItem,
//   cfi,                 // string ← persist
//   range,               // DOM Range ← derive text_pre/exact/post
// }
view.addEventListener("relocate", (e: CustomEvent) => {
  const { cfi, fraction, range } = e.detail;
  const text = range?.toString?.() ?? "";
  // text_exact = text (trim/window); pre/post from surrounding if available
  scheduleLocatorUpsert({ workId, cfi, progress_fraction: fraction ?? 0, text_* });
});

// restore:
const saved = await loadLocator(workId);
if (saved?.cfi) {
  const ok = await view.goTo(saved.cfi);
  if (!ok) await view.goToTextStart();
} else {
  await view.goToTextStart(); // D-25 — prefer over bare next()
}
```

**Important Phase 1 correction:** current `FoliateView` only stores `{fraction, cfi}` and uses `renderer.next()` for first page. P2 should call `goToTextStart()` / restore CFI and persist text context columns. [VERIFIED: `src/reader/FoliateView.tsx`]

### Pattern 4: Search (READ-07)

**What:** Async generator over whole book (omit `index`) or one section (`index`).  
**When:** Search sheet after 200–300ms idle.  
**Example:** [VERIFIED: `view.js` `search`, `search.js` `searchMatcher`]

```ts
// Default opts → matchWholeWords false → granularity 'grapheme' → CJK substring OK
for await (const result of view.search({ query })) {
  if (result === "done") break;
  if (result.progress != null) { /* optional progress UI */ continue; }
  // section hit:
  // { label: chapterCaption, subitems: [{ cfi, excerpt: { pre, match, post } }] }
  appendResults(result);
}
// jump:
await view.goTo(item.cfi); // or showAnnotation / select
view.clearSearch(); // when query cleared
```

CJK path: `Intl.Segmenter` + `Intl.Collator` with sensitivity `base` by default. Do **not** set `matchWholeWords: true` for Chinese. [VERIFIED: `search.js`]

### Pattern 5: SQLite v2 + frontend access

**What:** Append migration version 2; grant SQL capabilities; load `sqlite:pillow.db` from TS.  
**When:** Prefs, fonts metadata, work ensure, locator upsert.  
**Example:** [CITED: v2.tauri.app/plugin/sql] [VERIFIED: `migrations.rs`, capabilities schemas]

```rust
// migrations.rs — append, never rewrite v1
Migration {
  version: 2,
  description: "reading_prefs_and_custom_fonts",
  sql: SCHEMA_V2, // CREATE TABLE reading_prefs (...); CREATE TABLE custom_font (...);
  kind: MigrationKind::Up,
}
```

```ts
import Database from "@tauri-apps/plugin-sql";
const db = await Database.load("sqlite:pillow.db");
const rows = await db.select<ReadingPrefsRow[]>("SELECT * FROM reading_prefs WHERE id = $1", ["global"]);
await db.execute(
  "INSERT INTO reading_prefs (id, mode, theme, ...) VALUES ($1,$2,$3,...) ON CONFLICT(id) DO UPDATE SET ...",
  [...]
);
```

**Capability gap (must fix in plan):** `src-tauri/capabilities/default.json` currently only has `core:default` and `dialog:allow-open`. Frontend SQL will fail until `sql:default` **and** `sql:allow-execute` are added (select is in default; execute is not). [VERIFIED: codebase + gen schemas]

### Pattern 6: Custom fonts (READ-06)

**What:** Rust command copies file into `app.path().app_data_dir()/fonts/{id}.{ext}`, enforces 20 count / 20MB, writes SQL metadata; frontend injects `@font-face`.  
**When:** Settings 导入字体 / 移除.  
**Recommended serve path (discretion):** Prefer a dedicated custom protocol or a reserved pillow path (`fonts/<id>`) with CORS + path sanitize — **do not** ship font bytes over IPC; **do not** rely on `BaseDirectory::Resource` (Phase 1 Android APK unreadability). Mirror sample materialization pattern in `lib.rs`. [VERIFIED: `lib.rs` sample materialize lesson]

```css
@font-face {
  font-family: "PillowCustom-<id>";
  src: url("http://pillow.localhost/fonts/<id>"); /* platform URL via convertFileSrc or protocol */
  font-display: swap;
}
```

CSP already allows `font-src` for `pillow.localhost` / `pillow:`. [VERIFIED: `tauri.conf.json`]

### Anti-Patterns to Avoid

- **Hand-rolling `pillow://` URLs** — always `convertFileSrc(id, "pillow")` (`src/lib/pillow.ts`). [VERIFIED: HANDOFF + pillow.ts]
- **Book bytes over `invoke`** — D-06 absolute.
- **Copying Readest AGPL source** — DEC-001 clean-room.
- **Bare percentage progress store** — use composite locator columns.
- **`matchWholeWords: true` for CJK search** — breaks substring matching.
- **Applying reflow typography to FXL** — fixed-layout has no `setStyles`/flow.
- **Zero-height reader host** — keep `flex:1; min-height:0` + `foliate-view { height:100% }`.
- **Second SQLite binding** — only `tauri-plugin-sql` / shared sqlx 0.8.6 for tests.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| EPUB pagination / scroll | Custom column layout | foliate paginator `flow` attr | Complex RTL/vertical/resize anchoring already solved |
| CFI create/resolve | Custom anchors | `view.getCFI` / `goTo(cfi)` / `resolveCFI` | Character-level CFI critical for CJK |
| In-book search + highlight | Parallel index | `view.search` + overlayer annotations | CFI + highlight stay coherent |
| Protocol URL per OS | UA sniffing | `convertFileSrc` | Phase 1 Android `https://` bug |
| DRM classification | Ad-hoc zip checks | `check_protection` / core | Soft-fail already tested |
| CSS-in-iframe persistence | Per-load DOM hacks | `renderer.setStyles` | Re-applied on section load |
| shadcn primitives | Custom sheet/slider | Official registry components | UI-SPEC registry safety |

**Key insight:** Phase 2 is chrome + persistence around a complete engine. Re-implementing engine concerns is pure risk.

## Common Pitfalls

### Pitfall 1: Reader host height collapse
**What goes wrong:** Blank page; foliate has no layout box.  
**Why:** Absolute/fixed flex children without `min-height: 0` / explicit height.  
**How to avoid:** Keep Phase 1 CSS contract; UI-SPEC restates it.  
**Warning signs:** Toolbar visible, content white/empty. [VERIFIED: `App.css`, HANDOFF]

### Pitfall 2: Missing CORS / wrong protocol form
**What goes wrong:** `fetch(pillowUrl)` TypeError.  
**Why:** Cross-origin protocol without ACAO, or hand-rolled URL.  
**How to avoid:** Keep `protocol.rs` `cors()`; only `pillowUrl()`.  
**Warning signs:** Works in unit tests, fails in WebView. [VERIFIED: HANDOFF]

### Pitfall 3: SQL capability denial
**What goes wrong:** Prefs/locator writes throw at runtime.  
**Why:** Capabilities omit `sql:default` / `sql:allow-execute`.  
**How to avoid:** Update `default.json` (+ Android cap if split) in Wave 0.  
**Warning signs:** Plugin load OK, execute rejects. [VERIFIED: capabilities]

### Pitfall 4: Relocate fraction mis-read
**What goes wrong:** Progress bar jumps by chapter only.  
**Why:** Renderer-level fraction is **section-local**; view-level `relocate` merges via `SectionProgress` to whole-book `fraction`. Always use the view event, not renderer raw.  
**How to avoid:** Listen on `<foliate-view>`, persist `e.detail.fraction` + `e.detail.cfi`. [VERIFIED: `view.js` `#onRelocate`]

### Pitfall 5: First open uses `next()` only
**What goes wrong:** Skips text start landmarks; restore path inconsistent.  
**Why:** Phase 1 minimal slice called `renderer.next()`.  
**How to avoid:** `goToTextStart()` or restored CFI per D-25. [VERIFIED: FoliateView + view.js]

### Pitfall 6: Fonts via SAF path or Resource dir
**What goes wrong:** Font disappears after restart / unreadable on Android.  
**Why:** SAF grants for books ≠ fonts; APK resources not `std::fs` readable.  
**How to avoid:** Copy into `app_data_dir/fonts/` (D-27); serve via protocol. [VERIFIED: lib.rs sample lesson, DEC-004 lessons]

### Pitfall 7: FXL / malformed treated as hard crash
**What goes wrong:** App panic or uncaught rejection.  
**Why:** Torture corpus includes FXL/corrupt/obfuscated.  
**How to avoid:** Keep DRM gate; try/catch `open`; FXL uses fixed-layout automatically; font-obfuscation **renders** (D-10); only content-DRM/corrupt refuse. CI asserts soft-fail, not “all open”. [VERIFIED: commands.rs + fixtures]

### Pitfall 8: MSVC / exact pins regressions
**What goes wrong:** Windows cargo tests fail under GNU gcc.  
**Why:** Host toolchain trap from Phase 1.  
**How to avoid:** Document vcvars + `stable-x86_64-pc-windows-msvc` in plan verify steps. [VERIFIED: HANDOFF]

### Pitfall 9: Clean-room violation
**What goes wrong:** License contagion.  
**Why:** Temptation to copy Readest reader chrome.  
**How to avoid:** Study architecture only; implement from foliate MIT APIs + UI-SPEC. [VERIFIED: DEC-001 / CLAUDE.md]

### Pitfall 10: Search whole-word default assumptions
**What goes wrong:** Chinese queries return empty.  
**Why:** Word granularity needs spaces.  
**How to avoid:** Leave `matchWholeWords` false; rely on grapheme matcher. [VERIFIED: search.js]

## Code Examples

### Open + init (controller skeleton)

```ts
// Source: Phase 1 FoliateView + foliate view.js init/goToTextStart
const decision = await invoke<ProtectionDecision>("check_protection", { id });
if (!decision.canRender) return fail(decision.message);

const res = await fetch(pillowUrl(id));
const blob = await res.blob();
const view = document.createElement("foliate-view") as FoliateViewElement;
host.append(view);

view.addEventListener("relocate", onRelocate);
await view.open(new File([blob], `${id}.epub`));

view.renderer?.setAttribute("flow", prefs.mode === "scroll" ? "scrolled" : "paginated");
view.renderer?.setAttribute("margin", `${prefs.marginPx}`);
view.renderer?.setStyles?.(buildReadingCss(prefs, fontFaceCss));

const loc = await loadLocator(workId);
if (loc?.cfi) await view.goTo(loc.cfi);
else await view.goToTextStart();
```

### Immersive tap zones (READ-04)

```ts
// Paginated: L/R thirds page-turn; center 34% toggles chrome
function onZonePointer(zone: "left" | "center" | "right") {
  if (prefs.mode === "scroll") {
    toggleChrome(); // do not hijack scroll
    return;
  }
  if (zone === "center") toggleChrome();
  else if (zone === "left") void view.goLeft();
  else void view.goRight();
}
```

### Desktop keys (D-33)

```ts
function onKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape") { closeSheetOrShowChrome(); return; }
  if (e.key === "/" || (e.ctrlKey && e.key.toLowerCase() === "f")) {
    e.preventDefault(); openSearch(); return;
  }
  if (["ArrowLeft", "PageUp"].includes(e.key)) void view.goLeft();
  if (["ArrowRight", "PageDown"].includes(e.key)) void view.goRight();
}
```

### Recommended SCHEMA_V2 shape (discretion — illustrative)

```sql
-- Single-row global prefs (D-20/D-21)
CREATE TABLE reading_prefs (
  id                TEXT PRIMARY KEY, -- 'global'
  mode              TEXT NOT NULL,    -- 'paginate' | 'scroll'
  theme             TEXT NOT NULL,    -- 'day' | 'night' | 'sepia'
  font_family_key   TEXT NOT NULL,    -- 'system' | custom id
  font_size_px      REAL NOT NULL,
  line_height       REAL NOT NULL,
  margin_px         REAL NOT NULL,
  active_font_id    TEXT,             -- nullable FK-ish to custom_font.id
  updated_at        INTEGER NOT NULL
);

CREATE TABLE custom_font (
  id            TEXT PRIMARY KEY,
  family_name   TEXT NOT NULL,
  file_name     TEXT NOT NULL,  -- relative under app_data/fonts/
  byte_size     INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);

INSERT INTO reading_prefs (id, mode, theme, font_family_key, font_size_px, line_height, margin_px, active_font_id, updated_at)
VALUES ('global', 'paginate', 'day', 'system', 18, 1.75, 24, NULL, 0);
```

Locator table already exists — upsert by `work_id` (consider adding a unique index in v2 if missing; v1 has no PRIMARY KEY on locator — plan should either upsert-delete+insert or add `UNIQUE(work_id)` carefully without rewriting v1 semantics). [VERIFIED: migrations.rs — locator lacks PK/unique]

### work_id mapping (D-26)

```ts
// Cheap path: stable UUID v5-like or store map book_registry_id → work_id in SQL.
// Content hash available via Rust: blake3 of bytes already in core::EpubPublication::from_bytes
// Prefer a small command ensure_work(id) that:
//  1) resolves source bytes in Rust (not returned)
//  2) computes blake3
//  3) INSERT OR IGNORE work(...); returns work_id
// Must not block open on hash failure — fall back to deterministic id from registry id.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| epub.js word offsets | foliate character-level CFI | foliate-js era | Correct CJK progress |
| Percentage-only progress | Composite locator | Project day-1 (D-08) | Survives reflow |
| Hand-rolled protocol URLs | `convertFileSrc` | Phase 1 fix | Android open works |
| APK Resource paths | `app_data_dir` materialize | Phase 1 fix | Sample/fonts pattern |

**Deprecated/outdated for this phase:**
- Primary toolbar **下一页** button — replaced by tap zones (UI-SPEC).
- `localStorage` prefs — forbidden by D-20.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `range.toString()` is sufficient for P2 text_exact; pre/post can be empty or simple window | Locator pattern | Weaker self-heal until P5 formalizes text_context extraction |
| A2 | Extending pillow protocol with `/fonts/<id>` (or twin protocol) is Android-safe with same CORS helper | Fonts | May need capability/CSP tweak if separate scheme |
| A3 | Adding `UNIQUE(work_id)` or delete+insert upsert for locator is acceptable in v2 without breaking P5 | Schema | Planner must pick one upsert strategy explicitly |
| A4 | Optional 3s chrome auto-hide can be skipped | Immersive | Product polish only |
| A5 | No new npm deps beyond shadcn-generated files | Stack | If shadcn add pulls unexpected dep, pin exact versions |

## Open Questions

1. **Locator upsert keying**
   - What we know: v1 `locator` has `work_id` FK but no PRIMARY KEY/UNIQUE. [VERIFIED]
   - What's unclear: multi-row vs one-row-per-work for reading position.
   - Recommendation: enforce one progress row per work (delete+insert or add unique index in v2). Annotations later get their own tables in P5 — do not overload locator for highlights.

2. **Font protocol vs asset scope**
   - What we know: pillow CORS + CSP font-src ready; Resource dir fails on Android.
   - What's unclear: exact scheme name.
   - Recommendation: reserved path on existing `pillow` handler under `fonts/` id namespace with `sanitize_id` + allowlist directory — least new surface.

3. **FXL product behavior**
   - What we know: engine auto-selects fixed-layout; roadmap says soft-fail FXL in torture corpus.
   - What's unclear: open-with-limited-UI vs refuse.
   - Recommendation: open FXL if engine can; disable reflow knobs; corpus asserts no crash. Refuse only when `open`/`check_protection` fails.

4. **Frontend test harness**
   - What we know: HANDOFF notes no frontend tests.
   - What's unclear: whether P2 adds vitest.
   - Recommendation: Wave 0 add minimal vitest for pure helpers (`buildReadingCss`, prefs debounce, search result map); keep engine E2E manual/desktop.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Frontend build | ✓ | v22.15.0 | — |
| pnpm | JS deps | ✓ | 10.33.2 | — |
| Rust/cargo | Tauri + tests | ✓ | 1.95.0 | — |
| MSVC vcvars | Windows cargo test | required | BuildTools path in HANDOFF | Fail tests if missing |
| Android SDK/emulator | Optional device gate | present (P1) | API 36.1 emulator | Desktop-only verify for most P2 |
| foliate-js submodule | Render | ✓ | pinned SHA | `git submodule update --init` |

**Missing dependencies with no fallback:** none for desktop implementation.  
**Missing dependencies with fallback:** physical Android device (still open from P1).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Rust: cargo/`tokio`+`sqlx` workspace tests; Frontend: **none yet** (Wave 0 gap) |
| Config file | Cargo workspace; no vitest.config |
| Quick run command | `cargo test --workspace` (under MSVC on Windows) |
| Full suite command | `cargo test --workspace` + `pnpm build` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| READ-01 | flow attribute mapping pure helper | unit (TS) | `pnpm test -- run apply-reading-styles` | ❌ Wave 0 |
| READ-02/03 | CSS builder emits size/lh/margin/colors | unit (TS) | same | ❌ Wave 0 |
| READ-04 | tap zone decision pure fn | unit (TS) | `pnpm test` | ❌ Wave 0 |
| READ-05 | TOC flatten/indent helper | unit (TS) | `pnpm test` | ❌ Wave 0 |
| READ-06 | font limits 20 / 20MB in Rust | unit (Rust) | `cargo test fonts_` | ❌ Wave 0 |
| READ-07 | search opts default grapheme (doc/contract) | unit + manual | assert helper `buildSearchOpts` | ❌ Wave 0 |
| D-20/v2 | migration creates prefs/fonts tables | integration | `cargo test --test migration` | ⚠️ extend existing |
| D-23 | locator upsert shape | unit | `cargo test` / TS | ❌ |
| FND carry | DRM/corrupt soft-fail still green | unit | `cargo test` protection + decide | ✅ |
| Torture | fixtures soft-fail / no panic | unit | `cargo test torture_` or protection fixtures | ⚠️ expand fixtures |
| Build | typecheck + bundle | smoke | `pnpm build` | ✅ script |

### Sampling Rate
- **Per task commit:** `cargo test --workspace` (MSVC) for Rust tasks; `pnpm build` for UI tasks
- **Per wave merge:** full cargo workspace + `pnpm build`
- **Phase gate:** success criteria 1–5 manually on desktop sample EPUB + imported book; emulator smoke optional

### Wave 0 Gaps
- [ ] Add frontend unit test runner (vitest exact-pin) **or** keep pure helpers in Rust-only where possible — planner choice; HANDOFF gap remains if skipped
- [ ] Extend `src-tauri/tests/migration.rs` for schema v2 tables/columns
- [ ] Font command unit tests (size/count limits) with temp dirs
- [ ] Torture corpus expansion: keep `clean`/`corrupt`/`adept`/`font-obfuscated`; add minimal FXL fixture if not present; CI asserts soft-fail classification
- [ ] Capabilities: `sql:default`, `sql:allow-execute` in `default.json` (and Android capability file if required)
- [ ] Expand `FoliateView` ambient types (`goTo`, `search`, `book.toc`, `goToTextStart`, `clearSearch`)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | SourceRegistry + sanitize_id; font path allowlist under app_data/fonts only |
| V5 Input Validation | yes | Font ext allowlist (ttf/otf/woff/woff2? UI-SPEC: TTF/OTF/WOFF); size ≤20MB; SQL bound params `$1` |
| V6 Cryptography | no (DRM refuse only) | Never decrypt; blake3 content hash only |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via book/font id | Tampering | `sanitize_id`; registry allowlist; fonts confined to app_data/fonts |
| ZIP-slip / corrupt EPUB | Denial / Tampering | core zip guard + soft-fail (existing) |
| SQL injection via prefs | Tampering | Parameterized plugin-sql queries |
| Oversized font DoS | Denial | 20MB + count 20 server-side enforce |
| XSS via EPUB script | Elevation | foliate does not support scripted EPUB securely; keep iframe sandbox as engine provides; do not enable book scripts |
| AGPL contamination | (legal) | Clean-room; MIT foliate only |
| Book bytes exfil via IPC | Info disclosure | D-06: only pillow protocol |

## Project Constraints (from CLAUDE.md)

- Platforms v1: Windows / macOS / Linux + Android; Chinese UX is a hard differentiator.
- Privacy / local-first; self-hosted WebDAV later — no forced cloud.
- Stack: Tauri v2 + React/Vite/TS + foliate-js MIT + SQLite (`tauri-plugin-sql` / SQLx) — **exact pins**, committed lockfiles.
- **Do not copy Readest AGPL source**; use foliate-js MIT clean-room.
- Prefer one shared Rust core; keep `core/` free of Tauri/plugin deps.
- Avoid floating version ranges (`^`/`~`/`latest`).
- Vendor foliate-js at pinned SHA (already submodule).
- GSD workflow for repo edits (this research is planning artifact write).

Additional from HANDOFF / Phase 1 (binding in practice):
- Book bytes **never** cross IPC (D-06).
- Windows MSVC toolchain for cargo tests.
- Never hand-roll `convertFileSrc` alternatives.
- `BaseDirectory::Resource` unreadable inside Android APK — use `app_data_dir` for app-owned files.

## Concrete Answers (planner quick index)

| # | Question | Answer | Tag |
|---|----------|--------|-----|
| 1 | Paginate vs scroll? | `view.renderer.setAttribute('flow', 'paginated'\|'scrolled')`; attributeChangedCallback → `render()` | VERIFIED: codebase |
| 2 | Inject styles? | `view.renderer.setStyles(css \| [before, style])`; also `margin` attr in px | VERIFIED: codebase |
| 3 | `search()` CJK? | `for await (const r of view.search({ query }))`; default grapheme, not whole-word; excerpt `{pre,match,post}`; label from TOC | VERIFIED: codebase |
| 4 | TOC + goTo? | `view.book.toc` items `{label,href,subitems?}`; `await view.goTo(href)` | VERIFIED: codebase |
| 5 | relocate → CFI/fraction? | view event detail: whole-book `fraction`, `cfi`, `range`, `tocItem` | VERIFIED: codebase |
| 6 | SQL v2 + frontend? | Append `Migration{version:2,…}`; `Database.load('sqlite:pillow.db')`; add `sql:default`+`sql:allow-execute` | VERIFIED + CITED docs |
| 7 | Fonts path + serve? | `app.path().app_data_dir()/fonts`; copy in Rust; serve via protocol URL; inject `@font-face` | VERIFIED pattern + ASSUMED scheme detail |
| 8 | shadcn adds? | sheet, slider, toggle-group, input, scroll-area, separator (+ optional badge) | VERIFIED: UI-SPEC |
| 9 | Torture soft-fail? | Existing protection fixtures + FXL open-or-gate; assert no panic / ErrorCard path; font-obfuscation still renders | VERIFIED + ASSUMED FXL product choice |
| 10 | P1 pitfalls? | CORS, height collapse, convertFileSrc, Resource/APK, MSVC, no frontend tests | VERIFIED: HANDOFF |

## Sources

### Primary (HIGH confidence)
- `D:/Github/Pillowtome/src/vendor/foliate-js/view.js` — open, relocate, goTo, search, goToTextStart, FXL switch
- `D:/Github/Pillowtome/src/vendor/foliate-js/paginator.js` — flow/margin attributes, setStyles
- `D:/Github/Pillowtome/src/vendor/foliate-js/search.js` — grapheme/word matchers, excerpt
- `D:/Github/Pillowtome/src/vendor/foliate-js/reader.js` — reference integration (flow menu, setStyles, TOC)
- `D:/Github/Pillowtome/src/vendor/foliate-js/README.md` — renderer interface, flow attrs
- `D:/Github/Pillowtome/src/reader/FoliateView.tsx`, `src/lib/pillow.ts`, `src-tauri/src/*`
- `D:/Github/Pillowtome/.planning/phases/02-epub-reading-core/02-CONTEXT.md`, `02-UI-SPEC.md`
- https://v2.tauri.app/plugin/sql/ — Database.load / migrations / permissions

### Secondary (MEDIUM confidence)
- https://v2.tauri.app/reference/javascript/api/namespacepath/ — appDataDir
- `.planning/research/PITFALLS.md` — FXL/malformed/locator pitfalls (phase numbering differs from roadmap)

### Tertiary (LOW confidence)
- Exact FXL product copy beyond ErrorCard / disabled knobs — product discretion

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — already pinned and shipping in Phase 1
- Architecture: HIGH — engine APIs read from vendor source
- Pitfalls: HIGH — Phase 1 HANDOFF + code-verified gaps (SQL caps, locator PK)
- Code examples: HIGH for foliate; MEDIUM for exact SCHEMA_V2 column names (discretion)

**Research date:** 2026-07-15  
**Valid until:** 2026-08-15 (30 days; foliate pinned so API drift limited)

---

*Phase: 02-epub-reading-core*  
*Research completed: 2026-07-15*  
*Ready for planning: yes*
