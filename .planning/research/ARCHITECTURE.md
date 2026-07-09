# Architecture Research

**Domain:** Cross-platform ebook reader (local-first, multi-format, WebDAV-synced, CJK-first) — 枕籍 / Pillowtome
**Researched:** 2026-07-09
**Confidence:** HIGH (stack + component model verified against foliate-js, Tauri v2, and KOReader sync sources; version numbers current as of research date)

---

## Executive Summary (read this first)

The single most important architectural decision is to make **three abstractions concrete on day 1**, even while only EPUB is implemented:

1. **A format-agnostic `Publication` model** — parsers implement an interface; the rest of the app never sees "EPUB" specifics.
2. **A composite, format-agnostic locator** — `{ work_id, cfi-or-part, progress_fraction, text_context }` — that survives re-pagination, edition drift, and cross-device use.
3. **A stable identity + change-log data schema** — UUID `work_id` + content hash + per-record logical clock — so sync is a reconcile over existing records, never a retrofit.

Getting these three right is exactly what prevents the "Lithium-style late hard refactor." Everything below hangs off them.

**Recommended stack (2025+, verified):**

| Layer | Choice | Version (verified) | Why |
|-------|--------|--------------------|-----|
| Cross-platform shell | **Tauri v2** | CLI `2.11.4` | One WebView-based shell for Win/macOS/Linux **and** Android/iOS; Rust backend is the shared native core. Mirrors Readest's proven path. |
| Reading engine | **foliate-js** | `1.0.1` (npm), **MIT** | Reflowable EPUB/MOBI/KF8/FB2/CBZ + PDF (via PDF.js), CSS multi-column pagination, EPUB CFI, annotation overlay, search. The same engine Foliate and Readest use. |
| Frontend UI | **React 19 + TypeScript (Vite SPA)** | — | Shared across every platform (runs in the WebView). Vite SPA over Next.js to avoid SSR complications inside Tauri. |
| Native core | **Rust** (Tauri backend crate) | — | Format metadata parsing, library DB, sync engine — compiled identically for desktop and Android (NDK). |
| Library/state store | **SQLite** via `rusqlite`/`sqlx` | — | Books, metadata, annotations, sync change-log. |
| Sync transport | **WebDAV** via `reqwest_dav` | — | Self-hosted, no proprietary cloud. Client-side merge (WebDAV is a dumb file store). |

> **License note (important):** Readest is **AGPL** — do **not** copy Readest source. The actual rendering engine, **foliate-js, is MIT**; it vendors zip.js (BSD-3), fflate (MIT), PDF.js (Apache) — all permissive. Using foliate-js directly keeps Pillowtome's own license unconstrained. Bundled CJK fonts must be license-audited separately.

---

## Standard Architecture

### System Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│                     PLATFORM SHELL  (Tauri v2 runtime)                  │
│   per-platform: window/SAF/file-picker/storage-paths/bg-scheduler      │
│   ┌─────────────────────────────┐        ┌──────────────────────────┐  │
│   │      WEBVIEW  (shared JS)    │◄─IPC──►│     RUST CORE  (native)  │  │
│   │                             │ events │                          │  │
│   │  ┌───────────┐ ┌──────────┐ │        │  ┌────────────────────┐  │  │
│   │  │ UI Layer  │ │ Reading  │ │        │  │  Publication model │  │  │
│   │  │ (React)   │ │ Engine   │ │        │  │  (format abstract) │  │  │
│   │  │ library / │ │(foliate- │ │        │  │  epub|mobi|pdf|txt │  │  │
│   │  │ reader /  │ │  js)     │ │        │  └─────────┬──────────┘  │  │
│   │  │ settings /│ │ paginate │ │        │  ┌─────────┴──────────┐  │  │
│   │  │ CJK typo  │ │ CFI/overlay│       │  │  Library / Catalog │  │  │
│   │  └───────────┘ └────┬─────┘ │        │  ├────────────────────┤  │  │
│   └──────────────────────┼──────┘        │  │  Annotation+Locator│  │  │
│         ▲ book bytes via │ custom         │  ├────────────────────┤  │  │
│         │ protocol (not IPC copy)         │  │  Sync engine (WebDAV│  │  │
│         └────────────────┼───────────────┤  │   + change log/CRDT)│  │  │
│                          │               │  ├────────────────────┤  │  │
│                          │               │  │  Settings           │  │  │
│                          │               │  └─────────┬──────────┘  │  │
│                          │               └────────────┼─────────────┘  │
├──────────────────────────┼────────────────────────────┼────────────────┤
│                       DATA STORES                                       │
│   ┌───────────────┐  ┌──────────────────┐  ┌────────────────────────┐   │
│   │ SQLite         │  │ Filesystem       │  │ WebDAV (remote)        │   │
│   │ books/meta/    │  │ book files,      │  │ file plane +           │   │
│   │ annotations/   │  │ covers, extracted│  │ state plane (per-device│   │
│   │ change-log     │  │ resources        │  │ logs)                  │   │
│   └───────────────┘  └──────────────────┘  └────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────┘

SHARED CORE  = Rust core crate + React UI + foliate-js  (identical on every platform)
PER-PLATFORM = only the thin Tauri shell config + capability shims (SAF, dialogs, bg work)
```

### Component Responsibilities

| Component | Owns (boundary) | Typical Implementation | Talks to |
|-----------|-----------------|------------------------|----------|
| **Platform Shell** | Window lifecycle, file pickers, Android SAF, storage paths, background-sync scheduling, deep links | Tauri v2 config + a few plugins (fs, dialog, notification, background task) | Hosts WebView + Rust core |
| **UI Layer** | Library browsing, reader chrome, settings, annotation UI, dictionary popover | React 19 + TS, Zustand for state | foliate-js (direct JS), Rust core (IPC) |
| **Reading Engine** | Parse-for-render, pagination (CSS multi-column), scroll/paginated modes, CFI, highlight overlay, in-book search, TTS hooks | **foliate-js** (`view.js` entry) | UI (JS API), gets book bytes via custom protocol |
| **CJK Typography** | Font management + fallback chain, CSS injection into the render iframe (text-spacing-trim, text-autospace, line-break, kinsoku), punctuation compression, word-segmentation hook | CSS pipeline + bundled fonts + optional BudouX | Reading Engine (injects into its document) |
| **Publication model** | Format abstraction: detect format, extract metadata/cover/TOC, content hash, optional full-text index | Rust trait `Publication`, one impl per format (`epub`,`mobi`,`pdf`,`txt`,…) | Library, Import |
| **Library / Catalog** | Books, metadata, covers, collections/tags, sort/filter, import/scan | Rust + SQLite (`rusqlite`/`sqlx`) | Publication model, UI (via IPC) |
| **Annotation + Locator** | Highlights/notes/bookmarks, reading position, the composite locator type, text-context anchors | Rust types + SQLite; overlay rendered by foliate-js | Reading Engine, Sync |
| **Sync engine** | Identity (`work_id`+hash), change tracking, WebDAV file+state planes, client-side merge/conflict resolution, scheduling | Rust + `reqwest_dav` + logical-clock change log | Library, Annotation, Settings, WebDAV |
| **Settings/Theming** | Global vs per-work settings, themes (day/night/sepia), layout knobs, sync-scoping of each setting | Rust store + React theming | UI, Sync |

**The one boundary rule that matters:** small structured data (positions, annotations, library queries, settings) crosses the WebView↔Rust boundary via **Tauri IPC**; **large book bytes never cross IPC** — the shell exposes them to the WebView through a **custom protocol / asset stream**, so foliate-js reads the file directly and nothing is duplicated in JS memory. (Readest does the same: native Rust parsers do metadata-only extraction "to avoid heavy IPC transfers of large book files.")

---

## Recommended Project Structure

```
pillowtome/
├── apps/
│   └── shell/                     # Tauri v2 app — desktop + Android targets
│       ├── src-tauri/             # Rust: main.rs, IPC commands, plugin/capability config
│       │   ├── src/commands/      # thin IPC surface → calls into `core`
│       │   └── tauri.conf.json    # per-platform config, custom protocol registration
│       └── gen/android/           # generated Android project (Tauri)
├── core/                          # Rust shared core — NO UI, unit-testable in isolation
│   ├── publication/               # FORMAT ABSTRACTION LAYER
│   │   ├── mod.rs                 #   trait Publication + Format detection/registry
│   │   ├── epub.rs                #   impl Publication for Epub   (hard core first)
│   │   ├── mobi.rs                #   impl (KF8/AZW3)             (later phase)
│   │   ├── pdf.rs  txt.rs  fb2.rs #   impls                        (later phases)
│   ├── locator/                   # composite locator types (SHARED, format-agnostic)
│   ├── library/                   # SQLite schema, catalog, import/scan, covers
│   ├── annotation/                # highlights/notes/bookmarks + reading position
│   ├── sync/                      # WebDAV client, change-log, merge/CRDT, scheduler
│   │   ├── identity.rs            #   work_id + content hash + book matching
│   │   ├── changelog.rs           #   logical clock, tombstones, per-device logs
│   │   ├── webdav.rs              #   reqwest_dav transport (file + state planes)
│   │   └── merge.rs               #   conflict resolution (LWW / OR-Set)
│   └── settings/                  # settings store + sync-scoping metadata
├── web/                           # React + TS frontend (WebView) — shared everywhere
│   ├── reader/                    #   foliate-js integration, reader chrome, overlay UI
│   ├── library/                   #   catalog/collections UI
│   ├── typography/                #   CJK CSS pipeline + font manager  (differentiator)
│   ├── settings/                  #   settings + theme UI
│   ├── ipc/                       #   typed bindings to Rust commands/events
│   └── store/                     #   Zustand state
├── vendor/
│   └── foliate-js/                # MIT engine, pinned to an exact commit/version
└── assets/fonts/                  # bundled, license-audited CJK fonts (SC/TC + fallback)
```

### Structure Rationale

- **`core/` is UI-free Rust:** it compiles identically for desktop and Android (Tauri cross-compiles via NDK). This *is* the "shared core logic across desktop + Android" the project requires — the platform difference is confined to `apps/shell/src-tauri` config and a couple of capability shims.
- **`core/publication/` isolates format specifics:** the rest of `core` and all of `web` depend only on the `Publication` trait and the `locator` types, never on `epub.rs`. Adding MOBI/PDF later is *additive* (a new file + registry entry), not a refactor.
- **`core/locator/` is its own module:** the locator is shared by annotation, reading-position, and sync — keeping it separate forces it to stay format-agnostic.
- **`web/typography/` is a first-class module, not a stylesheet afterthought:** CJK quality is the product's differentiator, so the CSS pipeline + font-fallback logic gets its own home and is injected into every render document.
- **`vendor/foliate-js` pinned:** supply-chain zero-trust — pin to an exact version/commit, no floating ranges.

---

## Architectural Patterns

### Pattern 1: Two-sided Format Abstraction (Rust trait + JS book interface)

**What:** A format is "supported" only when it satisfies **two** interfaces — a Rust `Publication` trait (library-level: metadata, cover, hash, TOC, optional full-text) and the foliate-js **book interface** (render-level: sections, DOM, CFI resolution). Parsing is split by cost: heavy metadata parse happens once in Rust; render parse happens lazily in foliate-js reading the raw bytes.

**When to use:** Always, from the first EPUB. This is the anti-EPUB-lock guarantee.

**Trade-offs:** Two implementations per format is slightly more work, but each is small and the split is exactly why big book files never traverse IPC. Formats already covered by foliate-js (EPUB/MOBI/KF8/FB2/CBZ/PDF) only need the *Rust* side written; the render side is free.

**Example (Rust library side):**
```rust
pub trait Publication {
    fn format(&self) -> Format;
    fn metadata(&self) -> Metadata;           // title, authors, lang, identifiers
    fn cover(&self) -> Option<Vec<u8>>;
    fn toc(&self) -> Vec<TocEntry>;
    fn content_hash(&self) -> Hash;           // stable book identity (blake3)
    fn section_sizes(&self) -> Vec<u64>;      // feeds progress_fraction
}
```

**Example (foliate-js render side — the interface every format adapter satisfies):**
```js
// A "book" for foliate-js needs, at minimum, .sections + section.load()
book = {
  sections: [{ load(), unload(), createDocument(), size, linear, cfi, id }, …],
  dir: "ltr" | "rtl",            // page progression (rtl matters for CJK/vertical later)
  toc, pageList, metadata, rendition,
  resolveHref(href), resolveCFI(cfi), isExternal(href),
}
```

### Pattern 2: Composite, Self-healing Locator

**What:** A reading position / annotation anchor is **not** a page number or a raw offset. It is a composite that degrades gracefully:

```
Locator {
  work_id:          Uuid,       // binds to the WORK, not a file path
  format:           Format,
  primary:          Anchor,     // EPUB → CFI string;  others → foliate "part" {index,id,offset}
                                //                     PDF → {page, x, y}
  progress_fraction: f64,       // 0..1 global, from cumulative section_sizes — always present
  text_context:     { pre: String, exact: String, post: String }, // for re-location by text
}
```

**Resolution order on any device:** try `primary` (CFI/part) → if structure shifted, **re-locate by `text_context`** (the CFI spec explicitly endorses using preceding/trailing text to recompute steps) → else fall back to `progress_fraction`. This is what makes a position **survive re-pagination, font/size changes, edition drift, and format differences** across devices.

**When to use:** For every reading position, bookmark, highlight, and note — from Phase 3 onward. Never store a bare page index.

**Trade-offs:** Records are a bit larger (text snippets), but text-context is the single feature that saves annotations when the same title exists in two slightly different files on two devices.

### Pattern 3: Local-first with Two-plane WebDAV Sync + Client-side Merge

**What:** Every write hits **local SQLite immediately**; sync is a background reconcile. Sync uses **two independent planes** over the same WebDAV endpoint:

- **File plane** — book binaries + covers. Large, effectively immutable, content-addressed by hash. Change detection via ETag/Last-Modified + hash; mostly one-way replication with dedup. Per-book opt-in.
- **State plane** — progress, annotations, collections, settings. Small, frequent, mergeable. Serialized as **per-device append-only change logs** (JSON) written to WebDAV; each client pulls all device logs, merges into local SQLite, writes back only its own log.

**When to use:** Because WebDAV is a *dumb file store* with **no server-side locking or transactions**, the merge must be client-side. This per-device-log model is the same one KOReader's sync plugins use and it works with any vanilla WebDAV host (Nextcloud, Apache mod_dav, `rclone serve webdav`, Synology).

**Trade-offs:** No real-time push (poll/interval or on-open/on-close sync). Slightly more storage (per-device logs). In exchange: no central server to run, full privacy, offline-first, and no data loss.

---

## Data Flow

### Primary Flow: import → parse → store → render → annotate → sync

```
[Import file / scan folder]
        │  (Platform Shell: file picker / SAF)
        ▼
[Rust: detect format]──►[Publication::metadata + cover + content_hash + section_sizes]
        │                                     │
        ▼                                     ▼
[assign/lookup work_id]                [store file → filesystem]
        │                                     │
        ▼                                     ▼
[Library store: INSERT book row + metadata + cover + collection]  ──► SQLite
        │
        ▼
[UI Library list]──(user opens book)──►[Shell exposes bytes via CUSTOM PROTOCOL]
                                                │  (NOT copied over IPC)
                                                ▼
                                   [foliate-js: parse sections → paginate (CSS multi-col)]
                                                │  (+ CJK typography CSS injected)
                                                ▼
                                   [Render + restore last Locator (CFI→text→fraction)]
                                                │
              (user highlights/notes/bookmarks) ▼
                                   [foliate-js overlay + build Locator]
                                                │  IPC (small structured data)
                                                ▼
                                   [Rust Annotation store: INSERT + changelog entry] ──► SQLite
                                                │
                          (background / on close) ▼
                                   [Sync engine: merge local changelog ↔ WebDAV per-device logs]
                                                │
                                                ▼
                                   [WebDAV: state plane (+ file plane if enabled)]
```

**Direction rules:**
- UI **reads** library/annotation data by querying Rust core via IPC; it **writes** by issuing commands that the core persists then optionally syncs. UI never touches SQLite or WebDAV directly.
- foliate-js is a **pure render/interaction** component: it consumes book bytes + a target Locator and emits interaction events (relocated, selected). It never persists — the UI layer bridges its events to Rust.
- Sync is **one directional dependency only**: it depends on Library/Annotation/Settings data models; those models must never depend on sync. (Reversing this is the Lithium trap.)

### State Management (in the WebView)

```
[Zustand stores]  ◄─── IPC events (sync applied, library changed) ─── [Rust core]
      │ subscribe
      ▼
[React components] ──► [actions] ──► IPC commands ──► [Rust core] ──► SQLite / WebDAV
      ▲                                                     │
      └──────────────── foliate-js events ◄─────────────────┘
```

### Key Data Flows

1. **Position restore (cross-device):** On open, Rust returns the latest synced Locator for the `work_id`; foliate-js resolves it CFI→text-context→fraction. A position set on Android resolves correctly on desktop despite different pagination.
2. **Annotation merge:** Two devices highlight offline → each appends to its own change log → on next sync both logs are unioned (set semantics + tombstones); nothing is dropped.
3. **File vs state split:** Reading progress (bytes) syncs every session; a 300 MB PDF syncs once (or never, if the user keeps it local) — the two never share a channel.

---

## Recommended Build Order (dependency-driven)

The spine (render engine → locator → data schema) is built before sync and before extra formats, because sync and formats *hang off* the spine. Building sync early against unstable IDs is precisely the refactor to avoid.

```
Phase 0  Shell skeleton            ── depends on: none
Phase 1  EPUB render core          ── depends on: 0        ◄── LITHIUM-PARITY MILESTONE
Phase 2  Library store             ── depends on: 0,1
Phase 3  Annotation + Locator      ── depends on: 1,2
Phase 4  CJK typography subsystem  ── depends on: 1  (differentiator; front-loaded)
Phase 5  WebDAV sync engine        ── depends on: 2,3  (needs stable schema + locator)
Phase 6  Multi-format expansion    ── depends on: 2,3  (additive via abstraction)
Phase 7  Advanced (OPDS/TTS/dict/vertical CJK) ── depends on: 5,6
```

| Phase | Delivers | Hard dependency | Why this order |
|-------|----------|-----------------|----------------|
| **0 — Shell skeleton** | Tauri v2 + React WebView + IPC bridge + storage paths; builds & launches on desktop **and** Android | — | Everything runs inside the shell; prove cross-platform build first. |
| **1 — EPUB render core** | Open one EPUB from disk (custom protocol) → foliate-js paginate + scroll; day/night/sepia; font/size/margin/line-height; **local** CFI position persistence | 0 | **This is the immersive-EPUB / Lithium-parity milestone:** "can read, can theme, position sticks." No library or sync yet. |
| **2 — Library store** | SQLite schema (books, metadata, covers, collections); Rust EPUB metadata+cover extract; import/scan; library UI; **`Publication` trait + `work_id` + content hash introduced here even though only EPUB implements them** | 0,1 | The abstraction and stable identity must exist *before* annotations/sync bind to them. |
| **3 — Annotation + Locator** | Highlights/notes/bookmarks via foliate-js overlay; annotation DB; the **composite Locator formalized** (CFI + fraction + text-context); reading-position store; change-log columns present (unsynced) | 1,2 | Locator + change-log schema are the sync prerequisites; adding them now avoids a schema migration later. |
| **4 — CJK typography** | Font manager + SC/TC/JP fallback chain; CSS injection into render doc (`text-spacing-trim`, `text-autospace`, `line-break`/`word-break`, kinsoku; optional BudouX phrase-breaking); punctuation compression; mixed CJK+Latin spacing; dictionary/word-lookup hook point | 1 | Can start in parallel after Phase 1; it shapes the render-CSS pipeline. Front-loaded because CJK quality is the product's reason to exist. |
| **5 — WebDAV sync engine** | Two-plane sync (file + state); per-device change logs; `reqwest_dav` transport; conflict resolution (progress LWW; annotations OR-Set + tombstones; settings LWW per key); background/on-close scheduling incl. Android | 2,3 | Requires a stable, format-agnostic locator and a stable identity/change-log schema — hence *after* 2 and 3, never before. |
| **6 — Multi-format** | MOBI/KF8, TXT, PDF (PDF.js fixed-layout), FB2/CBZ — each = new `Publication` impl (Rust metadata) + confirm foliate-js render adapter | 2,3 | Purely additive: sync/annotation untouched because the locator is already format-agnostic. Can run parallel to 5. |
| **7 — Advanced** | OPDS/Calibre import, TTS, dictionary product, translation path, vertical CJK (`writing-mode: vertical-rl`) | 5,6 | Built on a complete, synced, multi-format base. |

**Critical sequencing principle:** Phases 2–3 introduce the abstraction (`Publication` trait), the identity (`work_id`+hash), and the composite locator **while only EPUB exists**. That is the whole game — it means Phase 5 (sync) and Phase 6 (formats) are additive, not a rewrite. Skipping this and hard-coding EPUB page positions with autoincrement IDs is the Lithium late-refactor failure mode.

---

## Scaling Considerations

(For a local-first reader the axis is **library size, file size, and sync volume** — not user count.)

| Scale | Architecture adjustments |
|-------|--------------------------|
| Small library (< 500 books) | Everything trivial. SQLite + eager cover thumbnails. No optimization needed. |
| Large library (500–50k books) | Index metadata columns; lazy-load covers as downscaled thumbnails (store separately from originals); paginate/virtualize the library grid; move full-text search to SQLite FTS5, built incrementally on import, not on open. |
| Large individual files (big PDFs, image-heavy CBZ) | Stream via custom protocol (never load whole file into JS); rely on PDF.js page-range loading; cache rendered page bitmaps with an LRU; keep such files **local-only by default** in the sync file plane. |
| High sync volume / many devices | Compact per-device change logs periodically (snapshot + truncate); cap text-context snippet length; debounce progress writes; sync state plane on interval/open/close, file plane on explicit action. |

### Scaling Priorities

1. **First bottleneck — library UI with big catalogs:** covers and un-virtualized lists. Fix with thumbnail generation + list virtualization before anything else.
2. **Second bottleneck — big-file rendering + sync:** large PDFs stall the WebView and bloat sync. Fix with streamed/range loading and the file-plane opt-out.
3. **Third — change-log growth:** long-lived devices accumulate log entries. Fix with periodic snapshot+truncate.

---

## Anti-Patterns

### Anti-Pattern 1: EPUB-locked position model
**What people do:** Store reading position as a page number or `spine_index + char_offset` with EPUB-specific columns.
**Why it's wrong:** Breaks on re-pagination, breaks for PDF/MOBI, breaks across devices — forces a schema rewrite when formats or sync arrive (the Lithium trap).
**Do this instead:** Composite, format-agnostic `Locator` (CFI/part + progress_fraction + text_context) from Phase 3.

### Anti-Pattern 2: Sync bolted on late, over local IDs
**What people do:** Ship local-only with autoincrement rowids as record keys, add sync later keyed on those rowids.
**Why it's wrong:** Rowids collide across devices; there is no stable book identity or change history to merge — a full data-model refactor.
**Do this instead:** UUID `work_id` + content hash + per-record logical clock in the schema's **first** version (Phase 2/3), even before any sync code exists.

### Anti-Pattern 3: One sync channel for files and state
**What people do:** Re-upload the whole book (or a big metadata blob) whenever progress changes.
**Why it's wrong:** Wastes bandwidth, causes conflicts on large files, and couples a 300 MB PDF's lifecycle to a 20-byte progress update.
**Do this instead:** Two planes — content-addressed file plane (opt-in, immutable) vs small mergeable state plane.

### Anti-Pattern 4: Assuming a smart sync server on WebDAV
**What people do:** Design merge logic that expects locking, transactions, or server-side conflict resolution.
**Why it's wrong:** WebDAV is a dumb file store; there is no server compute.
**Do this instead:** Client-side merge over per-device append-only logs (CRDT-ish: LWW for progress, OR-Set + tombstones for annotations). Same model KOReader sync plugins use.

### Anti-Pattern 5: Hand-rolling pagination / reflow
**What people do:** Build a custom EPUB paginator.
**Why it's wrong:** CFI accuracy, RTL, reflow, and CJK edge cases are a multi-year tar pit.
**Do this instead:** Use foliate-js (CSS multi-column, bisection range detection, CFI, overlay all solved and MIT-licensed).

### Anti-Pattern 6: Trusting the WebView's default CJK handling
**What people do:** Let the system pick CJK fonts and default line-breaking.
**Why it's wrong:** Ugly fallback fonts, broken kinsoku, no punctuation compression, wrong CJK+Latin spacing — kills the one differentiator.
**Do this instead:** Dedicated CJK CSS pipeline (`text-spacing-trim`, `text-autospace`, `line-break`, optional BudouX) + bundled, region-correct fonts (SC/TC) + an explicit fallback chain, injected into every render document.

### Anti-Pattern 7: Copying AGPL Readest code
**What people do:** Lift Readest components to move fast.
**Why it's wrong:** AGPL is copyleft over the network boundary — it would force Pillowtome's license and contaminate distribution.
**Do this instead:** Use MIT foliate-js directly; write Pillowtome's own core; keep the license choice free. (Readest is a *reference*, not a source to copy.)

### Anti-Pattern 8: Shipping book bytes over IPC
**What people do:** Read a file in Rust and pass its bytes to the WebView through an IPC command.
**Why it's wrong:** Doubles memory, serializes megabytes, stalls the bridge.
**Do this instead:** Register a custom protocol / asset stream so foliate-js reads bytes directly; IPC carries only small structured data.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| WebDAV host (Nextcloud, Apache mod_dav, `rclone serve webdav`, Synology) | `reqwest_dav` over HTTPS: PROPFIND (list) / GET / PUT / ETag / Last-Modified | No locking → client-side merge. Self-hosted, privacy-first, no proprietary cloud dependency. |
| OPDS / Calibre content server (Phase 7) | HTTP(S) OPDS feed parse; optional Calibre metadata | Catalog import only; not a store. |
| Dictionaries (Phase 4 hook, Phase 7 product) | Local StarDict/MDX lookup first; optional online lookup/translation | Word-segmentation (BudouX / ICU) feeds lookup for CJK. Keep offline-capable for privacy. |
| Platform capabilities | Tauri plugins: fs, dialog, notification, background task; Android SAF for scoped storage | The *only* per-platform code; keep behind a thin shim so `core` stays platform-agnostic. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| WebView (JS) ↔ Rust core | **Tauri IPC** (commands + events) for small structured data | Positions, annotations, library queries, settings. Typed bindings in `web/ipc`. |
| WebView ↔ book bytes | **Custom protocol / asset stream** | Large files bypass IPC entirely. |
| UI layer ↔ foliate-js | Direct JS calls + engine events (same WebView context) | UI bridges foliate-js events → IPC; foliate-js never persists. |
| Rust core ↔ SQLite | Direct (`rusqlite`/`sqlx`) | Single source of truth for library/annotation/change-log. |
| Rust core ↔ WebDAV | `reqwest_dav` over HTTPS | Sync engine only; nothing else touches the network. |
| Sync ↔ data models | **One-way:** sync depends on Library/Annotation/Settings; never the reverse | Enforcing this direction is what keeps sync from forcing a refactor. |

---

## Sources

- [readest/readest (GitHub)](https://github.com/readest/readest) and [Readest architecture — DeepWiki](https://deepwiki.com/readest/readest) — Next.js + Tauri v2 + foliate-js hybrid; native Rust metadata parsers to avoid IPC transfer of large files.
- [johnfactotum/foliate-js — README](https://github.com/johnfactotum/foliate-js/blob/main/README.md) and [DeepWiki: EPUB CFI system](https://deepwiki.com/johnfactotum/foliate-js/5.1-epub-cfi-system) — MIT license; module structure; the book interface every format implements; CSS multi-column pagination; CFI/part locators; overlay/search/progress modules.
- [foliate-js on npm](https://www.npmjs.com/package/foliate-js) / [libraries.io](https://libraries.io/npm/foliate-js) — version `1.0.1`.
- [Tauri Core Ecosystem Releases](https://v2.tauri.app/release/) and [Tauri 2.0 Stable](https://v2.tauri.app/blog/tauri-20/) — CLI `2.11.4`; desktop + Android/iOS from one codebase.
- [EPUB Canonical Fragment Identifiers 1.1 (W3C)](https://w3c.github.io/epub-specs/epub33/epubcfi/) and [EPUB Locators (W3C)](https://w3c.github.io/epub-specs/epub33/locators/) — CFI interoperability; re-location via preceding/trailing text for robustness across re-pagination.
- [KOReader sync/annotation plugins — DeepWiki](https://deepwiki.com/koreader/koreader/9.3-content-and-sync-plugins), [AnnotationSync.koplugin](https://github.com/dani84bs/AnnotationSync.koplugin), [highlightsync.koplugin](https://github.com/gitalexcampos/highlightsync.koplugin) — MD5 book identity; WebDAV PROPFIND/GET; timestamp-LWW for progress, position/merge for annotations.
- [MDN: text-spacing-trim](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/text-spacing-trim), [Chrome: new international CSS features](https://developer.chrome.com/blog/css-i18n-features), [Typotheque: CJK typesetting](https://www.typotheque.com/articles/typesetting-cjk-text) — `text-spacing-trim`, `text-autospace`, `word-break: auto-phrase` (BudouX), kinsoku, region-specific font fallback.
- [reqwest_dav (lib.rs)](https://lib.rs/crates/reqwest_dav), [epub crate (docs.rs)](https://docs.rs/epub), [lib-epub](https://crates.io/crates/lib-epub) — Rust WebDAV client and EPUB metadata parsing crates.

---
*Architecture research for: cross-platform ebook reader (枕籍 / Pillowtome)*
*Researched: 2026-07-09*
