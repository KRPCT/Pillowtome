# Phase 2: EPUB Reading Core - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the first demonstrably-usable **immersive, themeable EPUB reading** milestone at Lithium parity: paginate↔scroll, typography knobs, day/night/sepia, immersive chrome + tap zones, TOC jump, CJK-friendly in-book search, and custom font import. Builds on the proven Phase 1 `pillow://` → foliate-js slice.

**In scope:** READ-01..07. Reader chrome/settings/TOC/search UI; global reading preferences persistence; reading-position restore via existing locator seam; custom font copy into app data; desktop keyboard basics; soft-fail path for malformed/FXL/obfuscated books (torture corpus in CI as scoped by roadmap plan 02-04).

**Explicitly NOT in scope (later phases):** CJK typography moat (P3 — 标点挤压/autospace/kinsoku/bundled font); library cover grid & metadata (P4); annotations/highlights/bookmarks productization (P5 — locator *table already used* in P2 for progress only); TXT/other formats (P6); WebDAV sync (P7).

Visual/interaction chrome is **locked by** `.planning/phases/02-epub-reading-core/02-UI-SPEC.md` (approved 2026-07-15). This CONTEXT locks *implementation* choices UI-SPEC does not cover.
</domain>

<decisions>
## Implementation Decisions

### Carried from Phase 1 / UI-SPEC (do not re-decide)
- **D-01..D-13 (P1):** Tauri v2 + React/Vite/TS; foliate-js render; system WebView; `BookSource` storage-handle; book bytes only via `pillow://` (never IPC); composite Locator type + schema v1; DRM detect-and-refuse; clean-room vs Readest AGPL.
- **UI locked:** shadcn radix-nova + Tailwind v4; 极简纸感 day/night/sepia dual-layer tokens; Aa bottom sheet; immersive default with center-toggle + L/R thirds page-turn; 简体中文 copy. See `02-UI-SPEC.md`.

### Reading preferences persistence (READ-01..03, partial READ-02/06)
- **D-20:** Store global reading preferences in a **new SQLite table** via `tauri-plugin-sql` (same binding as schema v1 — no second SQLite). Not `localStorage`.
- **D-21:** Preferences are **global only** in P2 (one profile for all books). No per-book overrides until a later phase.
- **D-22:** Changes **apply immediately** to the foliate renderer and **auto-save** (debounce writes). No separate “应用” button.
- **Fields (minimum):** reading mode (paginate|scroll), theme (day|night|sepia), font family key, font size, line-height, margins, active custom-font id (nullable). Defaults match UI-SPEC body defaults (18px / 1.75 / 24px / system CJK stack / day / paginate).
- **Migration:** append schema v2 migration; never rewrite v1 tables.

### Reading position restore (pre-P5 progress)
- **D-23:** **Persist and restore** position using schema v1 **`locator` table** (CFI + `progress_fraction` + text_pre/exact/post). Do not invent a bare-percentage store (honors D-08).
- **D-24:** Write on foliate `relocate` with **debounce (~500ms)**; **force flush** on reader close / component unmount / app background if available.
- **D-25:** First open or invalid/unresolvable locator → **start at text start** (`goToTextStart` / equivalent). No modal; log failures for debug only.
- **D-26:** Map open book id → `work_id` for locator rows. Planner/executor may ensure a `work` row exists on open/import if missing (UUID + content hash when cheap; otherwise stable id strategy documented in plan — must not block open).

### Custom fonts (READ-06)
- **D-27:** On import, **copy** TTF/OTF/WOFF into **app data** (`fonts/` under app data dir). SQLite metadata: family display name, internal path/id, created_at. Do **not** depend on original path or Android SAF grant for fonts.
- **D-28:** Limits: **max 20** custom fonts; **≤ 20MB** per file. Over limit → refuse with 简体中文 helper (UI-SPEC copy).
- **D-29:** Remove (after UI-SPEC confirm): **delete app-data copy + metadata**. If removed font was active → fall back to system CJK stack. Never delete the user's original file.
- **D-30:** Inject selected face into foliate render documents via `@font-face` (or equivalent) using an app-served URL/path that WebView can load — planner picks protocol detail; book bytes path rules (D-06) still apply to EPUB content, not necessarily to font files, but prefer not shipping font bytes over large IPC payloads.

### Search & desktop input (READ-07 + desktop UX)
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 2 design & requirements
- `.planning/phases/02-epub-reading-core/02-UI-SPEC.md` — approved visual/interaction contract (READ-01..07 UI)
- `.planning/REQUIREMENTS.md` — READ-01..07
- `.planning/ROADMAP.md` → Phase 2 section — goal, success criteria, plan sketch 02-01..04
- `.planning/STATE.md` — current position

### Prior phase locks
- `.planning/phases/01-foundation-cross-platform-skeleton/01-CONTEXT.md` — D-01..D-13
- `docs/decisions/DEC-001-license-cleanroom.md` — clean-room / foliate MIT
- `docs/decisions/DEC-002-webview-engine.md` — system WebView
- `docs/decisions/DEC-003-drm-policy.md` — detect-and-refuse
- `docs/decisions/DEC-004-android-saf-mechanism.md` — SAF / storage-handle (books; fonts use app data copy)

### Architecture research
- `.planning/research/ARCHITECTURE.md` — IPC boundary, locator, Publication spine
- `.planning/research/STACK.md` — Tauri/React/foliate stack
- `.planning/research/PITFALLS.md` — locator stability, WebView divergence, SAF, DRM
- `.planning/research/FEATURES.md` — table-stakes reading features
- `.planning/research/SUMMARY.md` — roadmap implications
- `.planning/PROJECT.md` — product charter / Chinese UX constraint

### Implementation touchpoints (code)
- `src/reader/FoliateView.tsx` — thin reading slice to extend
- `src/reader/error-card.tsx` — soft-fail UI
- `src/lib/pillow.ts` — `pillow://` URL construction (do not hand-roll)
- `src/vendor/foliate-js/view.js` — `search()`, `goTo`, renderer, relocate
- `src-tauri/src/protocol.rs` — Range-aware protocol
- `src-tauri/src/storage.rs` — SourceRegistry
- `src-tauri/src/migrations.rs` — schema v1 (`work` / `locator` / `change_log`)
- `src-tauri/src/commands.rs` — IPC commands pattern
- `HANDOFF.md` — build/run gotchas, platform lessons
- `docs/ANDROID-BUILD.md` — Android build traps

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `FoliateView` + `ErrorCard` — extend; keep DRM gate + pillow fetch + host height lesson
- `pillowUrl()` — sole book URL builder via Tauri `convertFileSrc`
- `SourceRegistry` + `check_protection` + import flow — open path already works for sample + imported ids
- shadcn scaffold: `components.json`, `src/components/ui/button.tsx`, `src/lib/utils.ts`, `src/index.css` tokens
- Schema v1 `locator` / `work` tables ready for progress persistence without redesign
- foliate-js: `view.search()`, TOC progress, paginator/FXL renderer switch, `relocate` events

### Established Patterns
- Book bytes never cross IPC (D-06); only small structs (protection decision, metadata)
- Soft-fail errors with 简体中文 messages (D-10)
- Exact-pinned JS deps + committed lockfiles
- MSVC toolchain required for Windows Rust builds (HANDOFF)

### Integration Points
- Reader mount: `App.tsx` sets `openId` → `<FoliateView id onClose />`
- SQL plugin already wired in `src-tauri` with migrations hook — append v2 for prefs/fonts
- Settings/TOC/search UI: new React components under `src/reader/` (or `src/components/`) using shadcn Sheet/Slider/etc.
- Custom fonts: new Tauri commands for import/list/remove + app-data filesystem

</code_context>

<specifics>
## Specific Ideas

- Prefer **Lithium-like** consistent global typography over per-book quirks in v1 reading core.
- Progress persistence in P2 intentionally **front-loads P5's locator usage** so annotations phase does not rework storage.
- Font strategy: **copy into app data** specifically to avoid Android SAF grant fragility (lessons from DEC-004 / FND-03).
- Search: stay on **foliate-js** path to keep CFI jump + highlight aligned with engine.

</specifics>

<deferred>
## Deferred Ideas

- Per-book preference overrides → later (not P2)
- Full annotation/highlight/bookmark UI → Phase 5
- Bundled CJK font + coverage fallback + kinsoku/autospace → Phase 3
- Library cover grid redesign / home shell paper-feel theming → Phase 4
- Sync of prefs/progress over WebDAV → Phase 7 (change_log present-but-unsynced)
- Vim-style keybindings, advanced search filters (regex, chapter-only toggle) → post-P2 backlog
- Physical Android device verification still open from P1 (D-13 emulator substitute)

None of the above expand P2 scope.

</deferred>

---

*Phase: 2-EPUB Reading Core*
*Context gathered: 2026-07-15*
