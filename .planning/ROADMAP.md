# Roadmap: 枕籍 (Pillowtome)

## Overview

枕籍 (Pillowtome) is built as a **dependency spine, not independent vertical slices**. A cross-platform Tauri v2 shell — proven on real desktop *and* Android hardware — is laid down first, along with the three day-1 abstractions the research is emphatic about: a format-agnostic `Publication` model, a composite self-healing locator (CFI + progress fraction + text_context), and a stable identity + change-log schema (UUID + content hash + logical clock). On that foundation an immersive EPUB reading core reaches Lithium parity, the **CJK typography differentiator is front-loaded** as the product's reason to exist, and the library, annotations, and a second format (TXT) hang off the stable abstractions. Because identity and the locator are format-agnostic and merge-ready from the start, **WebDAV self-hosted sync — the second moat — is purely additive**, never the "Lithium-style late hard refactor" the charter forbids.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation & Cross-Platform Skeleton** - Tauri v2 shell on desktop + real Android, storage-handle abstraction, DRM detect-and-refuse, 3 day-1 abstractions stubbed, key decisions locked
- [x] **Phase 2: EPUB Reading Core** - Immersive, themeable EPUB reading (Lithium-parity milestone): modes, typography knobs, themes, TOC, search, custom fonts
- [x] **Phase 3: CJK Typography Differentiation** - The moat: punctuation compression, autospace, kinsoku, CJK defaults, bundled font + coverage-aware fallback (completed 2026-07-16)
- [x] **Phase 4: Local Library** - SQLite library store with covers, metadata, sort/filter; real Publication trait + stable identity (completed 2026-07-16)
- [ ] **Phase 5: Annotations & Composite Locator** - Highlights, notes, bookmarks, precise cross-device position restore, change-log schema (sync-ready)
- [ ] **Phase 6: TXT Format & Format-Abstraction Validation** - TXT (GBK/GB18030/UTF-8 detection + chapter split) added purely via the Publication abstraction
- [ ] **Phase 7: WebDAV Self-Hosted Sync** - Progress + annotation + selective file sync over self-hosted WebDAV with non-destructive conflict resolution

## Phase Details

### Phase 1: Foundation & Cross-Platform Skeleton

**Goal**: Stand up the cross-platform Tauri v2 skeleton that everything else runs inside, prove it builds and reads a book on real desktop *and* Android hardware, establish the storage-handle abstraction and DRM safety boundary, and lock the three day-1 architectural seams plus the key decisions before any feature binds to them.
**Depends on**: Nothing (first phase)
**Requirements**: FND-01, FND-02, FND-03, FND-04
**Success Criteria** (what must be TRUE):

  1. The app builds, launches, and shows its shell on Windows / macOS / Linux desktop AND on a real Android device.
  2. User can open a bundled sample EPUB end-to-end (open → foliate-js renders a readable page) on both desktop and Android, proving the render pipeline works cross-platform.
  3. User can import a book from device storage; on Android the SAF-granted access persists across app restarts — import flows through the storage-handle abstraction, never raw file paths.
  4. A DRM-encrypted or corrupted book is detected and refused with a clear "unsupported" message; the app never crashes and never attempts decryption.
  5. The three day-1 seams exist as stubs (format-agnostic `Publication` trait, composite locator type, UUID + content-hash + change-log schema) and key decisions are documented (permissive license / foliate-js MIT clean-room, WebView-engine strategy, DRM detect-and-refuse policy).

**Plans**: 5 plans
**UI hint**: no
**Research flag**: yes — Tauri v2 Android maturity, SAF `takePersistableUriPermission` / multi-API-level persistence + Play `MANAGE_EXTERNAL_STORAGE` policy, and the WebView-engine strategy (system WebView vs bundled Chromium) are architectural and benefit from `/gsd-plan-phase --research-phase`.

Plans:

- [x] 01-01-PLAN.md — Cross-platform scaffold: Tauri v2 + React/Vite/TS workspace (portable `pillowtome-core` + `src-tauri`), vendored pinned foliate-js, exact-pinned deps + lockfiles, and the Range-aware `pillow://` custom-protocol byte streamer + CSP (book bytes never cross IPC) [Wave 1, autonomous]
- [x] 01-02-PLAN.md — DRM & corruption detect-and-refuse: pure-`core` `detect_protection()` (clean / font-obfuscation / content-DRM), typed soft-fail, fully off-device unit-tested with tiny fixtures (FND-04) [Wave 2, autonomous, TDD]
- [x] 01-03-PLAN.md — Day-1 seams + schema + decisions: `Publication` trait, composite `Locator`, `BookSource` storage-handle, identity+change-log SQLite migration v1, and the license / WebView-engine / DRM decision records [Wave 2, autonomous]
- [x] 01-04-PLAN.md — Bundled-EPUB thin reading slice on desktop + Android emulator: foliate-js open → render → page-turn, DRM-gated (FND-01, FND-02) [Wave 3, non-autonomous]
- [x] 01-05-PLAN.md — Storage-handle import + Android SAF persisted grants across restart; native-Kotlin-vs-community-plugin supply-chain decision (FND-03) [Wave 4, non-autonomous]

### Phase 2: EPUB Reading Core

**Goal**: Deliver the first demonstrably-usable milestone — immersive, themeable EPUB reading at Lithium parity — so a user can comfortably read a whole EPUB with full control over layout, themes, navigation, and search. Malformed/FXL/obfuscated books soft-fail via a CI torture corpus.
**Depends on**: Phase 1
**Requirements**: READ-01, READ-02, READ-03, READ-04, READ-05, READ-06, READ-07
**Success Criteria** (what must be TRUE):

  1. User can read an EPUB and toggle between paginated and scroll modes in real time.
  2. User can adjust font family, size, line-height, and margins, and switch among day / night / sepia themes.
  3. User can enter immersive full-screen reading with hidden chrome and tap-to-turn page zones.
  4. User can jump to any chapter via the table of contents and search text within the book, with Chinese matching that works without space delimiters.
  5. User can import a custom font and apply it to the reading view.

**Plans**: 5 plans
**UI hint**: yes
**Research flag**: no — foliate-js integration is well-documented and Readest-proven; standard patterns.

Plans:

- [x] 02-00-PLAN.md — Wave 0: vitest pure helpers + SQL capabilities + Foliate ambient types [Wave 0, autonomous]
- [x] 02-01-PLAN.md — Reading chrome foundation + live paginate↔scroll (READ-01) + shadcn primitives [Wave 1, autonomous]
- [x] 02-02-PLAN.md — Typography + day/night/sepia + SCHEMA_V2 prefs/fonts + debounced SQLite prefs (READ-02, READ-03) [Wave 2, autonomous]
- [x] 02-03-PLAN.md — Immersive tap zones + TOC + locator persist/restore + desktop keys (READ-04, READ-05) [Wave 3, autonomous]
- [x] 02-04-PLAN.md — Custom fonts + pillow fonts/ serve + CJK search + torture soft-fail CI (READ-06, READ-07) [Wave 4, autonomous]

### Phase 3: CJK Typography Differentiation

**Goal**: Build the product's reason to exist — a visibly superior Chinese reading experience — as a first-class render/CSS + font subsystem injected into every render document, verified for parity across Blink (Windows/Android) and WebKit (macOS/Linux). Front-loaded right after the reading core because it shapes the render-CSS pipeline and is the competitive moat.
**Depends on**: Phase 2
**Requirements**: CJK-01, CJK-02, CJK-03, CJK-04, CJK-05
**Success Criteria** (what must be TRUE):

  1. Chinese punctuation is automatically compressed (标点挤压 / `text-spacing-trim`), on by default and user-toggleable.
  2. Mixed Chinese-Latin and Chinese-number text gets automatic spacing (盘古之白 / `text-autospace`), with a JS shim so older WebViews degrade gracefully.
  3. Chinese line-breaking obeys kinsoku (禁则): no closing punctuation (。，）」) starts a line and no opening punctuation （「 ends one.
  4. Chinese text uses optimized defaults — 2-character first-line indent, CJK-appropriate line-height, and full-width quotation marks.
  5. Chinese renders with a bundled CJK font and coverage-aware glyph fallback, so no tofu boxes or ransom-note font mixing appear on a glyph-coverage sheet across both engine families.

**Plans**: 4 plans
**UI hint**: yes
**Research flag**: yes — Blink-vs-WebKit CSS feature-parity matrix, the JS text-shaping fallback layer, per zh-Hans/zh-Hant/ja kinsoku prohibited-char tables, and the font subset/variable/optional-download bundling + embedding-license decision need engine-specific verification via `/gsd-plan-phase --research-phase`.

Plans:

- [x] 03-00-PLAN.md — Wave 0: SCHEMA_V3 CJK prefs columns + ReadingPrefs defaults ON + pure feature-detect/kinsoku/autospace-shim contracts + shadcn switch/popover + coverage fixtures [Wave 0, autonomous]
- [x] 03-01-PLAN.md — CJK CSS pipeline (`text-spacing-trim`, `text-autospace`, `line-break`/kinsoku) + indent defaults + autospace JS shim on FoliateView & ContinuousScrollStream (CJK-01..04) [Wave 1, autonomous]
- [x] 03-02-PLAN.md — Aa「中文排版」section: three toggles default ON + 简体中文 info popovers (D-30..D-34, D-38) [Wave 1, autonomous]
- [x] 03-03-PLAN.md — Bundled Noto Sans CJK SC+TC OFL + pillow serve + coverage-aware stack + golden-image harness Blink+WebKit (CJK-05) [Wave 2, autonomous]

### Phase 4: Local Library

**Goal**: Turn the reader into a real library: a SQLite-backed catalog with covers, metadata, and sort/filter — and, critically, give the format-agnostic `Publication` trait its real EPUB implementation (native metadata/cover extraction) plus stable identity (`work_id` + content hash) so annotations and sync bind to it later without a refactor.
**Depends on**: Phase 1, Phase 2
**Requirements**: LIB-01, LIB-02, LIB-03, LIB-04
**Success Criteria** (what must be TRUE):

  1. User can import a file or scan a folder and the books automatically appear in the library.
  2. The library displays books as a cover grid.
  3. Each book shows title, author, and other basic metadata (extracted natively via the `Publication` trait).
  4. User can sort and filter the library by title, author, recently read, and reading progress.
  5. **[MAJOR carry-in `READER-POS`]** Opening a book from the library (and switching paginate↔scroll / TOC jump in continuous scroll) restores and navigates from a single position SSOT — not a second ad-hoc jump bus. SQL stores progress; the frontend still owns dual-surface (foliate host vs ContinuousScrollStream) jump apply.

**Plans**: TBD
**UI hint**: yes
**Research flag**: no — standard SQLite metadata/catalog patterns. (`READER-POS` needs an explicit frontend position-bus design during 04 planning, not only schema work.)

Plans:

- [x] 04-00-PLAN.md — SCHEMA_V4 library_item + Publication EPUB metadata/cover extract + library-store types (LIB-01 foundation, LIB-03) [Wave 0]
- [x] 04-01-PLAN.md — Dual ingest: file import + recursive folder scan + content_hash dedup (LIB-01, D-50..D-53) [Wave 1]
- [x] 04-02-PLAN.md — Cover grid UI + sort/filter chips + empty dual CTA + progress bar (LIB-02..04) [Wave 2]
- [x] 04-03-PLAN.md — **[MAJOR `READER-POS`]** Position SSOT + jump bus: library open/resume, paginate↔scroll, scroll TOC (D-63..D-65) [Wave 3]

### Phase 5: Annotations & Composite Locator

**Goal**: Let readers highlight, annotate, and bookmark, and restore their exact place across re-pagination and devices — by formalizing the composite self-healing locator (CFI + progress fraction + text_context) and landing the per-record change-log schema (unsynced), which is the direct prerequisite that makes Phase 7 sync a reconcile rather than a rewrite.
**Depends on**: Phase 2, Phase 4
**Requirements**: ANNO-01, ANNO-02, ANNO-03, ANNO-04
**Success Criteria** (what must be TRUE):

  1. User can highlight selected text in a book.
  2. User can attach a note to a highlight.
  3. User can add bookmarks.
  4. Reopening a book restores the exact last reading position, and highlights/bookmarks stay anchored to their text after font-size/margin changes and across devices (composite locator: CFI → text_context → progress fraction).
  5. Every annotation and position record carries a stable UUID and change-log entry (unsynced), so Phase 7 sync can reconcile without data loss.

**Plans**: 5 plans
**UI hint**: yes
**Research flag**: no — the composite locator is well-specified in ARCHITECTURE; design is decided, execution is standard.

Plans:

**Wave 1**

- [ ] 05-01-PLAN.md — Persistence + ledger: schema V7 (annotation + sync_meta) + annotation-store CRUD/tombstone/change_log + content_hash [Wave 1, autonomous]
- [ ] 05-02-PLAN.md — Composite self-healing resolver (CFI→text_context→fraction) + locator text_pre/post + scroll selection→CFI [Wave 1, autonomous]

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 05-03-PLAN.md — Selection + drawing mechanics both modes (foliate draw-annotation / CSS Custom Highlight) + restore/replay [Wave 2, autonomous]

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 05-04-PLAN.md — Annotation UI: selection bubble + note editor + annotations sheet + bookmark toggle + 朱砂 palette [Wave 3, autonomous]

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 05-05-PLAN.md — Android emulator acceptance gate + 200+ annotation perf stress [Wave 4, checkpoint]

### Phase 6: TXT Format & Format-Abstraction Validation

**Goal**: Add TXT reading (a big deal for the Chinese web-novel corpus) as a second `Publication` implementation — and in doing so prove that reading, annotations, and the composite locator are genuinely format-agnostic, reserving the PDF/MOBI slot for v2 without touching any position or annotation code.
**Depends on**: Phase 4, Phase 5
**Requirements**: FMT-01
**Success Criteria** (what must be TRUE):

  1. User can open a TXT file and read it; the app auto-detects GBK / GB18030 / UTF-8 encoding and displays text correctly with no mojibake.
  2. TXT content is automatically split into chapters for table-of-contents navigation.
  3. TXT is added purely as a new `Publication` implementation — reading, annotations, and the composite locator work on TXT with no change to their code, confirming the format abstraction is format-agnostic (and the PDF/MOBI slot is reserved for v2).

**Plans**: TBD
**UI hint**: no
**Research flag**: no — CN encoding detection + chapter heuristics are standard; PDF/large-file performance research is deferred to v2 when PDF is implemented.

Plans:

- [ ] 06-01: TXT `Publication` impl — encoding detection (GBK/GB18030/UTF-8) + chapter split + render adapter; verify annotations/locator unchanged

### Phase 7: WebDAV Self-Hosted Sync

**Goal**: Deliver the second moat and the core-value payoff — open a book on any device and reliably continue, with progress, annotations, and selectively-synced files flowing over self-hosted WebDAV and merging without ever silently losing data. Ships last because it requires the stable, format-agnostic locator and identity/change-log schema to already exist.
**Depends on**: Phase 4, Phase 5
**Requirements**: SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05
**Success Criteria** (what must be TRUE):

  1. User can configure and connect to a self-hosted WebDAV server, with credentials stored in the OS keychain and never synced through the WebDAV store itself.
  2. Reading progress syncs across devices — opening a book on a second device resumes at the correct position.
  3. Highlights, notes, and bookmarks sync across devices with none lost.
  4. User can selectively choose which book files sync (not a forced full-library upload), keeping large files from swamping the sync channel.
  5. Concurrent edits from multiple devices merge without data loss — progress takes the furthest position, annotations merge by UUID with tombstone dedup, and genuine conflicts resolve via a clear non-destructive strategy.

**Plans**: TBD
**UI hint**: yes
**Research flag**: yes — the conflict/merge model is MEDIUM confidence: per-device-log CRDT-lite design, Nextcloud chunked-upload v2 semantics, and proxy/ETag edge cases need concrete design against a real proxied WebDAV server via `/gsd-plan-phase --research-phase`.

Plans:

- [ ] 07-01: WebDAV connect/config + keychain credential storage + TLS handling
- [ ] 07-02: State-plane sync — per-device append-only change logs; progress + annotation merge
- [ ] 07-03: File-plane selective book sync — resumable chunked upload, ETag/If-Match concurrency
- [ ] 07-04: Conflict resolution (furthest-progress / OR-Set + tombstones) + background/on-close scheduling incl. Android Doze

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Cross-Platform Skeleton | 5/5 | Executed | 2026-07-10 |
| 2. EPUB Reading Core | 5/5 | Executed | 2026-07-15 |
| 3. CJK Typography Differentiation | 4/4 | Complete   | 2026-07-16 |
| 4. Local Library | 4/4 | Complete   | 2026-07-16 |
| 5. Annotations & Composite Locator | 0/5 | Planned | - |
| 6. TXT Format & Format-Abstraction Validation | 0/TBD | Not started | - |
| 7. WebDAV Self-Hosted Sync | 0/TBD | Not started | - |
