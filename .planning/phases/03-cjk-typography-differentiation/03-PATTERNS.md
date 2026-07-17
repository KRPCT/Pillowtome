# Phase 3: CJK Typography Differentiation - Pattern Map

**Mapped:** 2026-07-16
**Files analyzed:** 22
**Analogs found:** 20 / 22

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/reader/apply-reading-styles.ts` | utility | transform | self (extend) | exact |
| `src/reader/apply-reading-styles.test.ts` | test | batch | self (extend) | exact |
| `src/reader/cjk-feature-detect.ts` | utility | request-response | `src/reader/apply-reading-styles.ts` (pure helper module) | role-match |
| `src/reader/cjk-feature-detect.test.ts` | test | batch | `src/reader/apply-reading-styles.test.ts` | exact |
| `src/reader/cjk-autospace-shim.ts` | utility | transform | `src/reader/ContinuousScrollStream.tsx` `injectStyles` (doc mutation lifecycle) | partial |
| `src/reader/cjk-autospace-shim.test.ts` | test | batch | `src/reader/scroll-mode.test.ts` | role-match |
| `src/reader/cjk-kinsoku.ts` | utility / config | transform | `src/reader/apply-reading-styles.ts` constants export | role-match |
| `src/reader/cjk-kinsoku.test.ts` | test | batch | `src/reader/toc.test.ts` / snapshot-style pure tests | role-match |
| `src/reader/fonts.ts` | service / utility | file-I/O + transform | self (extend stack builders) | exact |
| `src/reader/reading-prefs.ts` | service | CRUD | self (extend row map) | exact |
| `src/reader/SettingsSheet.tsx` | component | event-driven | self (section pattern) | exact |
| `src/reader/FoliateView.tsx` | component / controller | event-driven | self (`buildCss` / `applyPrefsToRenderer` / debounce) | exact |
| `src/reader/ContinuousScrollStream.tsx` | component | streaming | self (`injectStyles` + `readingCss`) | exact |
| `src/App.css` | config | — | self (`.reader-settings-section*` / `.reader-font-list__row`) | exact |
| `src/components/ui/switch.tsx` | component | event-driven | `src/components/ui/toggle.tsx` (shadcn radix-nova) | role-match |
| `src/components/ui/popover.tsx` | component | event-driven | `src/components/ui/sheet.tsx` (Radix primitive wrapper) | role-match |
| `src-tauri/src/migrations.rs` | migration | CRUD | self (`SCHEMA_V2` append pattern) | exact |
| `src-tauri/tests/migration.rs` | test | batch | self (v2 column/seed assertions) | exact |
| `src-tauri/src/fonts.rs` | service | file-I/O | self (`is_safe_font_id` / `resolve_font_path` / `fonts_dir`) | exact |
| `src-tauri/src/protocol.rs` | middleware / route | request-response | self (`parse_font_path` / `serve_font`) | exact |
| `src-tauri/src/lib.rs` | config / provider | file-I/O | self (`materialize_sample` + protocol font branch) | exact |
| `src-tauri/assets/fonts/noto-cjk/*` | config / asset | file-I/O | `src-tauri/assets/sample/sample.epub` + `include_bytes!` | role-match |
| `tests/fixtures/cjk/*` (or `src-tauri`/CI harness) | test / fixture | batch | `core/tests/fixtures/*.epub` + vitest pure helpers | partial |

## Pattern Assignments

### `src/reader/apply-reading-styles.ts` (utility, transform)

**Analog:** self — extend; do not invent a second CSS pipeline.

**Imports / module header pattern** (lines 1–17):
```typescript
/**
 * Pure helpers for foliate-js flow + injected reading CSS (READ-01/02/03).
 * No React / Tauri imports — unit-testable.
 */

export type ReadingMode = "paginate" | "scroll";
export type ReadingTheme = "day" | "night" | "sepia";

export interface ReadingPrefs {
  mode: ReadingMode;
  theme: ReadingTheme;
  fontFamilyKey: string;
  fontSizePx: number;
  lineHeight: number;
  marginPx: number;
  activeFontId: string | null;
}
```

**Core pattern — defaults + CJK stack constant** (lines 19–32):
```typescript
export const DEFAULT_PREFS: ReadingPrefs = {
  mode: "paginate",
  theme: "day",
  fontFamilyKey: "system",
  fontSizePx: 18,
  lineHeight: 1.75, // D-41: keep; do not change default
  marginPx: 24,
  activeFontId: null,
  // P3: cjkPunctTrim: true, cjkAutospace: true, cjkKinsoku: true
};

export const SYSTEM_CJK_STACK =
  'system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
// P3: also ensure TC names appear in final body stack via fonts.ts
```

**Core pattern — `buildReadingCss` !important overrides** (lines 126–174):
```typescript
export function buildReadingCss(
  prefs: ReadingPrefs,
  fontFaceCss: string,
  fontFamilyCss: string,
): string {
  // …theme colors, body padding, line-height…
  // P3: append CJK block (indent / text-spacing-trim / text-autospace / line-break)
  // gated by prefs.* + caps from cjk-feature-detect
  // Prefer optional 4th arg `caps?: CjkCssCaps` OR bake caps into a pre-call builder in FoliateView
}
```

**Copy rules for P3:**
- Keep pure (no React/Tauri).
- Emit CJK rules with `!important` same as theme paint (D-39).
- Always emit CJK-04 indent; never rewrite quote characters (D-42).
- Never emit `word-break: break-all`.

---

### `src/reader/apply-reading-styles.test.ts` (test, batch)

**Analog:** self.

**Test structure** (lines 1–42, 44–80):
```typescript
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PREFS,
  SYSTEM_CJK_STACK,
  buildReadingCss,
  // …
} from "./apply-reading-styles";

describe("DEFAULT_PREFS / constants", () => {
  it("matches UI-SPEC defaults", () => {
    expect(DEFAULT_PREFS).toEqual({ /* exact object */ });
  });
});

describe("buildReadingCss", () => {
  it("includes font-size, line-height, …", () => {
    const css = buildReadingCss(prefs, "/* face */", SYSTEM_CJK_STACK);
    expect(css).toContain("line-height: 1.8");
    expect(css).not.toContain("Geist");
  });
});
```

**P3 extensions:** assert three CJK defaults `true`; assert `text-indent: 2em` on `body p` and `0` on headings; assert property emission only when toggle+caps; assert OFF paths; assert never `break-all`; assert lineHeight default remains `1.75`.

---

### `src/reader/cjk-feature-detect.ts` (utility, request-response)

**Analog:** pure helper style from `src/reader/apply-reading-styles.ts` + injectable dependency pattern from `applyFoliateLayoutAttrs` / tests using `vi.fn()`.

**Core pattern to implement (from RESEARCH, mirror pure-helper style):**
```typescript
/**
 * Runtime CSS capability probes for CJK features (DEC-002 / D-35).
 * Pure: inject cssSupports for unit tests. Session-cache at call site.
 * Never infer support from OS / API level (D-12).
 */
export interface CjkCssCaps {
  textSpacingTrim: boolean;
  textAutospace: boolean;
  lineBreakStrict: boolean;
}

export function detectCjkCssCaps(
  cssSupports: (property: string) => boolean = (q) =>
    typeof CSS !== "undefined" && typeof CSS.supports === "function"
      ? CSS.supports(q)
      : false,
): CjkCssCaps {
  return {
    textSpacingTrim: cssSupports("text-spacing-trim: normal"),
    textAutospace: cssSupports("text-autospace: normal"),
    lineBreakStrict: cssSupports("line-break: strict"),
  };
}
```

**Session cache pattern:** follow FoliateView module-level / ref caching style (`prefsRef`, one-shot open) — detect once per reader open, not per keystroke. Soft-fail to all-false caps if `CSS` missing (tests / SSR).

---

### `src/reader/cjk-feature-detect.test.ts` (test, batch)

**Analog:** `src/reader/apply-reading-styles.test.ts` + `vi.fn` usage in layout attrs tests (lines 89–105).

```typescript
import { describe, expect, it, vi } from "vitest";
import { detectCjkCssCaps } from "./cjk-feature-detect";

it("probes via injected CSS.supports", () => {
  const supports = vi.fn((q: string) => q.includes("line-break"));
  const caps = detectCjkCssCaps(supports);
  expect(caps.lineBreakStrict).toBe(true);
  expect(caps.textAutospace).toBe(false);
});
```

---

### `src/reader/cjk-autospace-shim.ts` (utility, transform)

**Analog (lifecycle):** `src/reader/ContinuousScrollStream.tsx` `injectStyles` — install into document, re-run when CSS/prefs change, dispose on unmount.

**Closest install/dispose shape** (`ContinuousScrollStream.tsx` lines 229–260):
```typescript
const injectStyles = useCallback(
  (iframe: HTMLIFrameElement) => {
    const doc = iframe.contentDocument;
    if (!doc?.head) return;
    let style = doc.getElementById("pillow-reading-css") as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement("style");
      style.id = "pillow-reading-css";
      doc.head.appendChild(style);
    }
    style.textContent = readingCss;
    // …
  },
  [readingCss],
);
```

**Prescriptive shim API (RESEARCH Pattern 4 — implement clean-room):**
```typescript
/** Returns disposer that removes highlights / unwraps reversible spans. */
export function installAutospaceShim(doc: Document): () => void {
  // Prefer CSS Custom Highlight if available; else reversible <span data-pillow-shim="autospace">
  // HARD BAN: no U+0020 / thin-space insertion; textContent concat must equal original
}
```

**Wire points:**
- FoliateView after `setStyles` / section load (paginate render docs).
- ContinuousScrollStream after `injectStyles` when prefs want autospace and caps say unsupported.
- Always call disposer on toggle-off, section unload, component unmount.

---

### `src/reader/cjk-kinsoku.ts` (utility / config, transform)

**Analog:** exported constants in `apply-reading-styles.ts` (`PAGE_COLORS`, `SYSTEM_CJK_STACK`).

**Pattern:** pure exported `as const` string tables + optional helpers; **runtime enforcer stays CSS** (`line-break: strict`). Tables are for unit snapshots + golden fixtures only (D-36 / RESEARCH Pattern 5).

```typescript
export const ZH_PROHIBITED_LINE_START = [/* … */] as const;
export const ZH_PROHIBITED_LINE_END = [/* … */] as const;
```

No DOM rewriter.

---

### `src/reader/fonts.ts` (service / utility, file-I/O + transform)

**Analog:** self — extend face + family builders only.

**Imports / protocol URL pattern** (lines 10–15, 119–152):
```typescript
import { pillowFontUrl } from "../lib/pillow";
import { SYSTEM_CJK_STACK } from "./apply-reading-styles";

export function pillowCustomFamily(id: string): string {
  return `PillowCustom-${id}`;
}

export function buildFontFaceCss(activeFontId: string | null | undefined): string {
  if (!activeFontId) return "";
  const family = pillowCustomFamily(activeFontId);
  const url = pillowFontUrl(activeFontId);
  return `
    @font-face {
      font-family: "${family}";
      src: url("${url}");
      font-display: swap;
    }
  `;
}

export function fontFamilyCssFor(
  fontFamilyKey: string,
  activeFontId: string | null | undefined,
): string {
  if (fontFamilyKey === "system" || !activeFontId) {
    return SYSTEM_CJK_STACK; // P3: insert PillowBundledCJK before system stack
  }
  return `"${pillowCustomFamily(activeFontId)}", ${SYSTEM_CJK_STACK}`;
}
```

**P3 copy rule (D-47):**
```typescript
export const BUNDLED_CJK_FAMILY = "PillowBundledCJK";
// buildBundledCjkFontFaceCss() → two @font-face, same family, pillowFontUrl("bundled-noto-sc"|"bundled-noto-tc")
// fontFamilyCssFor: custom? → "PillowCustom-id", "PillowBundledCJK", SYSTEM_CJK_STACK(+TC)
```

**Reserved ids must pass Rust `is_safe_font_id`:** alphanumeric + `-` / `_` only, no dots — `bundled-noto-sc` / `bundled-noto-tc` are valid.

---

### `src/lib/pillow.ts` (utility — reuse, rarely modify)

**Analog for all font URLs** (lines 23–31):
```typescript
export function pillowFontUrl(fontId: string): string {
  return convertFileSrc(`fonts/${fontId}`, "pillow");
}
```
Do not hand-roll hosts. Bundled faces use the same helper.

---

### `src/reader/reading-prefs.ts` (service, CRUD)

**Analog:** self — soft-fail load + parameterized upsert.

**Row map + soft-fail** (lines 21–80):
```typescript
interface ReadingPrefsRow {
  id: string;
  mode: string;
  theme: string;
  font_family_key: string;
  font_size_px: number;
  line_height: number;
  margin_px: number;
  active_font_id: string | null;
  updated_at: number;
  // P3: cjk_punct_trim, cjk_autospace, cjk_kinsoku (INTEGER 0/1)
}

function rowToPrefs(row: ReadingPrefsRow): ReadingPrefs {
  return {
    // existing fields with DEFAULT_PREFS fallbacks
    // P3: cjkPunctTrim: row.cjk_punct_trim !== 0 (default true if missing)
  };
}

export async function loadReadingPrefs(): Promise<ReadingPrefs> {
  try {
    // SELECT … WHERE id = $1
    if (!rows?.length) return { ...DEFAULT_PREFS };
    return rowToPrefs(rows[0]);
  } catch (err) {
    console.warn("[reading-prefs] load failed; using defaults", err);
    return { ...DEFAULT_PREFS };
  }
}
```

**Save pattern** (lines 82–111): single-row `INSERT … ON CONFLICT(id) DO UPDATE` with bound `$n` params only (T-02-sql). Extend column list; never localStorage.

**Debounce constant** (line 16): `PREFS_SAVE_DEBOUNCE_MS = 400` — keep; FoliateView already uses it.

---

### `src/reader/SettingsSheet.tsx` (component, event-driven)

**Analog:** self — section order + live `onPrefsChange`.

**Shell / scroll body** (lines 61–81) — do not break Android scroll gate:
```tsx
<SheetContent
  side="bottom"
  className="reader-settings-sheet reader-sheet flex max-h-[min(85vh,720px)] flex-col gap-0 p-0"
  showCloseButton
>
  <SheetHeader className="reader-sheet__header shrink-0 px-4 pt-4 pb-2">
    <SheetTitle>显示设置</SheetTitle>
    <SheetDescription className="sr-only">
      调整阅读模式、主题、中文排版与字体选项  {/* extend sr-only copy */}
    </SheetDescription>
  </SheetHeader>
  <div className="reader-sheet__body min-h-0 flex-1 overflow-y-auto overscroll-contain px-0 [-webkit-overflow-scrolling:touch] [touch-action:pan-y]">
    <div className="flex flex-col gap-8 px-4 pb-8">
```

**Section pattern** (lines 82–139) — copy structure for **中文排版** inserted **after 主题, before 字体**:
```tsx
<section className="reader-settings-section">
  <h3 className="reader-settings-section__title">主题</h3>
  <ToggleGroup /* … */ onValueChange={(value) => {
    if (!value) return;
    onPrefsChange({ theme: value as ReadingTheme });
  }} />
</section>
```

**P3 row pattern (new):**
```tsx
<section className="reader-settings-section">
  <h3 className="reader-settings-section__title">中文排版</h3>
  {/* 3 rows: label | info Button | Switch
      onCheckedChange → onPrefsChange({ cjkPunctTrim: v }) etc.
      Defaults ON; never disable based on caps (D-38)
      Copy from 03-UI-SPEC 简体中文 table */}
</section>
```

**Live apply:** partial prefs only — same as sliders (lines 235–238):
```tsx
onPrefsChange({ fontSizePx: v });
// → onPrefsChange({ cjkAutospace: checked });
```

**shadcn add:** official `switch` + `popover` only (`components.json` registries stay empty). Style analog: `src/components/ui/toggle.tsx` / `sheet.tsx` (radix-nova, `cn`, `data-slot`).

---

### `src/App.css` (config)

**Analog:** settings section + list row styles (lines 619–663).

```css
.reader-settings-section__title { font-size: 16px; font-weight: 600; /* … */ }
.reader-font-list__row {
  display: flex;
  align-items: stretch;
  gap: 4px;
}
```

**P3 add (UI-SPEC):**
```css
.reader-cjk-row { /* flex; items-center; min-height: 48px; gap: 8px */ }
.reader-cjk-row__label { flex: 1; font-size: 14px; }
.reader-cjk-row__info { /* 44×44 hit; muted icon */ }
.reader-cjk-row__switch { /* switch wrapper */ }
```
Reuse `--reader-accent` / `--reader-muted` / `--reader-border` under `.reader[data-theme]` (`src/index.css` lines 12–44). No new color tokens.

---

### `src/reader/FoliateView.tsx` (component / controller, event-driven)

**Analog:** self — single CSS build path + debounced prefs save.

**CSS build + apply** (lines 158–202):
```typescript
const buildCss = useCallback((next: ReadingPrefs) => {
  return buildReadingCss(
    next,
    buildFontFaceCss(next.activeFontId), // P3: + buildBundledCjkFontFaceCss()
    fontFamilyCssFor(next.fontFamilyKey, next.activeFontId),
  );
}, []);

const applyPrefsToRenderer = useCallback(
  (next: ReadingPrefs) => {
    const css = buildCss(next);
    setContinuousCss(css); // continuous path gets SAME string
    // …paginate: renderer.setStyles?.(css)
  },
  [buildCss],
);
```

**Debounced save** (lines 204–211, 248–256):
```typescript
const scheduleSave = useCallback((next: ReadingPrefs) => {
  if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  saveTimerRef.current = setTimeout(() => {
    void saveReadingPrefs(next).catch((err) => {
      console.warn("[FoliateView] prefs save failed", err);
    });
  }, PREFS_SAVE_DEBOUNCE_MS);
}, []);

const handlePrefsChange = useCallback(
  (partial: Partial<ReadingPrefs> | ReadingPrefs) => {
    const next: ReadingPrefs = { ...prefsRef.current, ...partial };
    setPrefs(next);
    applyPrefsToRenderer(next);
    scheduleSave(next);
  },
  [applyPrefsToRenderer, scheduleSave],
);
```

**Open-path style apply** (lines 808–814):
```typescript
view.renderer?.setStyles?.(
  buildReadingCss(
    loaded,
    buildFontFaceCss(loaded.activeFontId),
    fontFamilyCssFor(loaded.fontFamilyKey, loaded.activeFontId),
  ),
);
```

**P3 integration:**
1. Session-cache `detectCjkCssCaps()` once on open; pass into `buildReadingCss` / `buildCss`.
2. Always prepend bundled `@font-face` CSS.
3. When `cjkAutospace && !caps.textAutospace`, install shim on render docs; dispose on change/unmount.
4. Continuous stream already receives `readingCss={continuousCss}` (line 1097) — keep that single string path; do not fork CJK CSS.

---

### `src/reader/ContinuousScrollStream.tsx` (component, streaming)

**Analog:** self — `readingCss` prop + `injectStyles` (lines 48, 229–260).

**Critical parity rule (Pitfall 7):** any CJK CSS must arrive via the same `readingCss` string FoliateView builds. If shim needs per-iframe install, add optional `onIframeDocumentReady?(doc)` or call `installAutospaceShim` inside/after `injectStyles` based on a boolean prop — still no second CSS builder.

```typescript
// After style.textContent = readingCss;
// if (autospaceShimEnabled) installAutospaceShim(doc) + store disposer per iframe
```

---

### `src-tauri/src/migrations.rs` (migration, CRUD)

**Analog:** `SCHEMA_V2` append-only pattern (lines 52–107).

```rust
/// Schema v2 DDL — reading prefs, custom fonts metadata, locator uniqueness.
/// Append-only: never rewrite [`SCHEMA_V1`].
pub const SCHEMA_V2: &str = r#"
CREATE TABLE reading_prefs ( /* … */ );
// …
"#;

pub fn migrations() -> Vec<Migration> {
    vec![
        Migration { version: 1, description: "seed_stub_schema", sql: SCHEMA_V1, kind: MigrationKind::Up },
        Migration { version: 2, description: "reading_prefs_and_custom_fonts", sql: SCHEMA_V2, kind: MigrationKind::Up },
        // P3:
        // Migration { version: 3, description: "cjk_typography_prefs", sql: SCHEMA_V3, kind: MigrationKind::Up },
    ]
}
```

**Prescriptive SCHEMA_V3 (ALTER only — existing DBs already have seed row):**
```sql
ALTER TABLE reading_prefs ADD COLUMN cjk_punct_trim INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reading_prefs ADD COLUMN cjk_autospace INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reading_prefs ADD COLUMN cjk_kinsoku INTEGER NOT NULL DEFAULT 1;
```
Do not rewrite V1/V2. Defaults `1` = ON (D-32/D-34).

---

### `src-tauri/tests/migration.rs` (test, batch)

**Analog:** self — `fresh_db_v2`, `has_column`, seed assertions, migration set length (lines 23–30, 85–123, 157–174).

```rust
async fn fresh_db_v2() -> SqliteConnection { /* apply V1 then V2 */ }
// P3: fresh_db_v3() = v2 + SCHEMA_V3

#[tokio::test]
async fn schema_v2_seeds_global_prefs_row() { /* … */ }

#[test]
fn migration_set_is_v1_then_v2_up() {
    let set = migrations();
    assert_eq!(set.len(), 2, /* P3: becomes 3 */);
}
```

**P3 tests:** after V3, columns exist and default `1` on existing `global` row; `migrations().len() == 3`; description/sql identity for SCHEMA_V3.

---

### `src-tauri/src/fonts.rs` (service, file-I/O)

**Analog:** self — path jail + safe ids.

**Safe id + resolve** (lines 171–252):
```rust
pub fn resolve_font_path(fonts_dir: &Path, id: &str) -> Option<PathBuf> {
    if !is_safe_font_id(id) { return None; }
    // first {id}.{ttf|otf|woff} under fonts_dir; canonicalize; starts_with jail
}

pub fn is_safe_font_id(id: &str) -> bool {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") || id.contains('.') {
        return false;
    }
    id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}
```

**P3:** materialize bundled Noto into `app_data/fonts/` as `bundled-noto-sc.otf` / `bundled-noto-tc.otf` (or `.ttf`). Prefer **not** counting bundled faces toward `MAX_CUSTOM_FONTS` if `count_font_files` is used for import limits — either exclude `bundled-*` prefix in count, or store under `app_data/fonts/bundled/` with protocol resolve extended carefully (prefer flat ids under same dir to reuse `serve_font` unchanged).

**Family of pure functions + unit tests module** (lines 277+) — extend with bundled resolve / safe reserved ids tests.

---

### `src-tauri/src/protocol.rs` (middleware / route, request-response)

**Analog:** self — fonts path already first-class.

**Parse + serve** (lines 119–184):
```rust
pub fn parse_font_path(raw_path: &str) -> Option<String> { /* fonts/{id} → id */ }

pub fn serve_font(
    fonts_dir: Option<&std::path::Path>,
    font_id: &str,
    range_header: Option<&str>,
) -> Response<Vec<u8>> {
    let Some(path) = resolve_font_path(dir, font_id) else {
        return status_only(StatusCode::NOT_FOUND);
    };
    // CORS + font Content-Type + Range
}
```

**P3:** likely **no protocol rewrite** if bundled files land as safe flat ids under `fonts_dir`. Keep unit tests for `parse_font_path` rejecting traversal (lines 356–367).

---

### `src-tauri/src/lib.rs` (config / provider, file-I/O)

**Analog:** sample materialize (lines 19–52, 96–103, 133–141).

```rust
const SAMPLE_EPUB: &[u8] = include_bytes!("../assets/sample/sample.epub");

fn materialize_sample(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    // rewrite when on-disk bytes differ — same pattern for bundled fonts
    Ok(path)
}

// protocol branch:
if let Some(font_id) = protocol::parse_font_path(&path) {
    let fonts_dir = fonts::fonts_dir(app).ok();
    let response = protocol::serve_font(fonts_dir.as_deref(), &font_id, range.as_deref());
    responder.respond(response);
    return;
}
```

**P3:** `include_bytes!` (or resource materialize) for Noto SC/TC into `fonts_dir` on setup; **do not** rely on Android APK Resource paths via `std::fs` (same pitfall as sample). Optional: skip rewrite if size+hash match to avoid multi-MB write every launch.

---

### `src-tauri/assets/fonts/noto-cjk/*` (asset)

**Analog:** `src-tauri/assets/sample/sample.epub` + `include_bytes!` in `lib.rs`.

Layout (RESEARCH):
```
src-tauri/assets/fonts/noto-cjk/
  NotoSansCJKsc-VF.otf   # pin exact release
  NotoSansCJKtc-VF.otf
  LICENSE                # OFL-1.1
  NOTICE
```
License files co-located (DEC-001). No cloud download.

---

### `src/components/ui/switch.tsx` / `popover.tsx` (component)

**Analog:** existing shadcn radix-nova wrappers:
- `src/components/ui/toggle.tsx` — `cn`, CVA optional, `data-slot`, `"use client"` where present
- `src/components/ui/sheet.tsx` — Radix primitive re-export pattern

**Install rule:** official registry only; keep `components.json` `"registries": {}` empty (03-UI-SPEC). Wire Switch checked styling to reader accent under `.reader[data-theme]` (UI-SPEC token note).

---

### `tests/fixtures/cjk/*` + golden harness (test / fixture)

**Analog:** `core/tests/fixtures/*.epub` for static fixtures; vitest pure helpers for unit gates. **No existing dual-engine golden harness** in-repo — treat as partial / RESEARCH-driven.

Suggested structure (RESEARCH):
```
tests/fixtures/cjk/
  coverage-sheet.html
  kinsoku-samples.html
  golden/blink/…
  golden/webkit/…
```

Unit layer still lives next to source: `src/reader/*.test.ts` (existing convention).

---

## Shared Patterns

### 1. Pure reader helpers (no React/Tauri)

**Source:** `src/reader/apply-reading-styles.ts`, `scroll-mode.ts`, `toc.ts`  
**Apply to:** `cjk-feature-detect.ts`, `cjk-kinsoku.ts`, CSS string builders, most of `cjk-autospace-shim.ts` (DOM APIs OK; no Tauri).

```typescript
/**
 * Pure helpers … No React / Tauri imports — unit-testable.
 */
```

### 2. Soft-fail prefs / non-blocking UX

**Source:** `src/reader/reading-prefs.ts` lines 66–79; FoliateView catch/warn  
**Apply to:** prefs load with new CJK columns; feature-detect failure → silent degrade (D-38); font materialize failure → system stack still works.

```typescript
} catch (err) {
  console.warn("[reading-prefs] load failed; using defaults", err);
  return { ...DEFAULT_PREFS };
}
```

### 3. Live apply + debounced SQLite (D-22)

**Source:** `FoliateView.tsx` `handlePrefsChange` + `scheduleSave` + `PREFS_SAVE_DEBOUNCE_MS`  
**Apply to:** three CJK toggles — same path as theme/fontSize; no separate 应用 button.

### 4. Single CSS injection path

**Source:** `buildReadingCss` → `renderer.setStyles` **and** `ContinuousScrollStream` `#pillow-reading-css`  
**Apply to:** all CJK-01..04 rules. Never a parallel “CJK renderer.”

### 5. `!important` author-style defeat

**Source:** `buildReadingCss` theme paint (lines 136–172)  
**Apply to:** text-indent, text-spacing-trim, text-autospace, line-break, font-family stack.

### 6. pillow protocol + convertFileSrc (no IPC bytes)

**Source:** `src/lib/pillow.ts`, `protocol.rs` `serve_font`, `fonts.rs`  
**Apply to:** bundled Noto URLs. Metadata/commands only over IPC; font bytes via `pillow://…/fonts/{id}`.

### 7. Append-only SQLite migrations

**Source:** `migrations.rs` SCHEMA_V1 → V2; `tests/migration.rs`  
**Apply to:** SCHEMA_V3 ALTER columns with DEFAULT 1.

### 8. App-data materialize for Android-readable assets

**Source:** `lib.rs` `materialize_sample`  
**Apply to:** bundled font binaries (APK Resource unreadable via `std::fs`).

### 9. Safe flat font ids

**Source:** `fonts.rs` `is_safe_font_id`  
**Apply to:** reserved `bundled-noto-sc` / `bundled-noto-tc` (no dots in id).

### 10. Settings sheet Android scroll gate

**Source:** `SettingsSheet.tsx` body + `App.css` `.reader-sheet__body` + CLAUDE.md  
**Apply to:** longer sheet after 中文排版 section — keep `min-h-0 flex-1 overflow-y-auto` + touch pan-y.

### 11. User-facing 简体中文, code keys English

**Source:** SettingsSheet copy; fonts error strings; D-30  
**Apply to:** 中文排版 labels, info popovers, a11y `aria-label`s from 03-UI-SPEC.

### 12. Clean-room / license discipline

**Source:** DEC-001, CLAUDE.md, SettingsSheet header comment  
**Apply to:** Noto OFL only; self-authored CSS/shim; never paste Readest.

---

## No Analog Found

| File / concern | Role | Data Flow | Reason |
|----------------|------|-----------|--------|
| Dual-engine golden-image harness (Playwright/WebView screenshots Blink+WebKit) | test | batch | No visual regression harness in-repo yet; use RESEARCH + DEC-002 |
| CSS Custom Highlight autospace path | utility | transform | No existing Highlight usage; implement with feature-detect + reversible span fallback |

Planner should use 03-RESEARCH.md Patterns 4 & 7 and 03-UI-SPEC for those two areas; unit-test textContent invariance remains mandatory even without a prior analog.

---

## Metadata

**Analog search scope:**  
`src/reader/*`, `src/lib/pillow.ts`, `src/components/ui/*`, `src/App.css`, `src/index.css`, `src-tauri/src/{fonts,protocol,migrations,lib}.rs`, `src-tauri/tests/migration.rs`, `src-tauri/assets/sample`, `core/tests/fixtures`, phase docs CONTEXT/RESEARCH/UI-SPEC, CLAUDE.md

**Files scanned:** ~35 primary sources (reader modules + Tauri font/migration/protocol/lib + tests + CSS)

**Pattern extraction date:** 2026-07-16

**Key planner constraints from map:**
1. Extend — do not replace — `buildReadingCss` / SettingsSheet / fonts stack / reading_prefs.
2. SCHEMA_V3 is ALTER-only with defaults ON.
3. Bundled fonts = sample-style `include_bytes!` + app_data materialize + existing `serve_font`.
4. Autospace shim must return disposer; never permanent text rewrite.
5. Continuous scroll and paginate must share one CSS string path.
