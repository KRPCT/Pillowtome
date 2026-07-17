# Phase 4: Local Library - Context

**Gathered:** 2026-07-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn Pillowtome into a **real local library**: SQLite-backed catalog with covers, metadata, sort/filter; real EPUB **Publication** metadata/cover extraction + stable identity (`work_id` + content hash); import file **and** folder scan; and **[MAJOR `READER-POS`]** a single position SSOT so open-from-library, paginate↔scroll, and continuous-scroll TOC jump do not invent a second jump bus.

**In scope (LIB-01..04 + roadmap success criteria):**
- Import single/multi file + recursive folder scan → library rows
- Cover grid UI + title/author (+ progress affordance)
- Sort/filter (title, author, recently read, progress / reading status)
- Publication trait real EPUB metadata + cover extract
- `work_id` / content-hash identity integration with existing `work` / `locator`
- READER-POS: library open/resume + dual-surface jump apply continuity

**Explicitly NOT in this phase:**
- OPDS / Calibre / series collections (LIB-05/06 → v2)
- Annotations productization (P5) beyond progress locator already used
- CJK typography (P3 — already decided)
- WebDAV sync (P7)
- PDF/MOBI/TXT as library formats (P6+; P4 may refuse non-EPUB cleanly)

</domain>

<decisions>
## Implementation Decisions

### Carried forward (do not re-decide)
- **D-01..D-13 (P1):** Tauri v2; `BookSource` never raw path; book bytes only via `pillow://` (D-06); `Publication` seam; composite Locator; SQLite + change-log spine; DRM detect-and-refuse; clean-room.
- **D-20..D-26 (P2):** Global prefs; locator table for progress; ensure `work` on open; soft-fail 简体中文.
- **D-30 product language:** User-visible library copy stays **简体中文**.
- **UI feel:** 极简纸感 tokens / shadcn patterns from P2 UI-SPEC; library shell should match (exact grid tokens → UI phase / planner).

### Ingest, identity & dedup (LIB-01)
- **D-50:** **Dual entry points:** keep **「导入书籍」** (file / multi-file) and add **「扫描文件夹」**. Desktop: folder picker. Android: SAF tree / directory grant with persistable permission (DEC-004 / FND-03).
- **D-51:** **content_hash dedup — skip + notify.** If blake3 (or existing hash) matches an existing library item, **do not create a second row**. Show calm 简体中文 feedback（如「书库中已有」）. Optional metadata refresh is planner discretion but **must not** fork identity / progress.
- **D-52:** **Register-by-reference storage.** Library items hold a **BookSource handle** (path or content URI) — **do not** bulk-copy full EPUB into app data by default (unlike custom fonts D-27). Covers may be **cached** under app data (small files) without violating D-06 for book bodies.
- **D-53:** **Folder scan:** **recursive** subdirectory walk; **EPUB only** (`.epub`); DRM/corrupt → existing soft-fail path, skip item, aggregate summary for the user (not a hard stop on first error).
- **D-54:** Identity: each library item binds to **`work_id` (UUID) + content_hash**. Reuse/ensure `work` rows consistent with D-26; content_hash is the dedup key (D-51). Format field remains EPUB for P4.

### Cover grid & metadata display (LIB-02, LIB-03)
- **D-55:** Default library view is a **responsive cover grid** (phone ~2–3 columns; wider on tablet/desktop). List-first layout is out of default.
- **D-56:** **Title + author under the cover** (not overlaid on the image by default). Title single-line ellipsis; author secondary/muted.
- **D-57:** Missing cover → **paper-feel placeholder** (calm block / bookish motif + title initial or first 1–2 chars). No broken-image icon spam.
- **D-58:** **Density split:** grid shows **cover + title + author** (+ progress affordance per D-62). Richer fields (language, publisher, etc.) live in a **detail** surface (tap secondary / long-press / detail sheet — planner chooses chrome).

### Sort, filter & empty state (LIB-04)
- **D-59:** Default sort: **最近阅读优先** (last read/open). Never-opened books fall back to **import time**.
- **D-60:** Controls: **top-bar chips + sort control** (not a mandatory full sheet). Sort menu: 标题 / 作者 / 最近阅读 / 进度. Filter chips (reading status): **全部 / 在读 / 未读 / 已读完** derived from progress (exact thresholds planner-defined, e.g. 0 / (0,1) / ≥0.99).
- **D-61:** Empty library: **guided dual CTAs** — 简体中文 empty copy + primary actions **「导入书籍」** and **「扫描文件夹」**.

### Open / resume & READER-POS (success criterion 5)
- **D-62:** Grid progress: **thin progress bar** on the card (optional %); hide bar for unread; finished books may show a small **已读** mark. Do not cover most of the cover art.
- **D-63:** Open from library: **silent resume** — if locator resolves, go there; else text start (D-25). **No** “continue or start over?” modal in P4.
- **D-64:** READER-POS UX: **user-invisible SSOT**. Mode switch and TOC jump must not introduce a second confirmation dialog or a second progress store. Fail soft to text start without modal.
- **D-65:** **last_opened** on open; **last_read** refreshed with debounced locator writes during reading (align D-24). Both feed “最近阅读” sort.

### Claude's Discretion
- Exact SQLite table/column names beyond existing `work` / `locator` (new library catalog tables vs extend `work` — planner designs append-only migrations)
- Cover image format/size cache policy under app data
- Exact progress thresholds for 在读/已读完
- Detail surface interaction (long-press vs second tap vs info icon)
- Desktop multi-select import UX details
- READER-POS internal jump-command bus shape (must be one SSOT; implementation design is planner/research)
- Whether folder scan shows a progress sheet for large trees

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` — Phase 4: Local Library (goal, success criteria, plans 04-01..04 sketch)
- `.planning/REQUIREMENTS.md` — LIB-01..LIB-04 (v1); LIB-05/06 deferred v2
- `.planning/PROJECT.md` — product charter, local-first, 简体中文 UX
- `.planning/STATE.md` — project position

### Prior phase locks
- `.planning/phases/01-foundation-cross-platform-skeleton/01-CONTEXT.md` — D-01..D-13 (BookSource, Publication stub, locator, schema, DRM)
- `.planning/phases/02-epub-reading-core/02-CONTEXT.md` — D-20..D-26 (prefs, locator progress, work_id)
- `.planning/phases/02-epub-reading-core/02-UI-SPEC.md` — paper-feel visual language to extend for library shell
- `.planning/phases/03-cjk-typography-differentiation/03-CONTEXT.md` — D-30 language; CJK not reopened here

### Decisions & architecture
- `docs/decisions/DEC-001-license-cleanroom.md`
- `docs/decisions/DEC-002-webview-engine.md`
- `docs/decisions/DEC-003-drm-policy.md`
- `docs/decisions/DEC-004-android-saf-mechanism.md` — SAF / folder grants
- `.planning/research/ARCHITECTURE.md` — Publication, identity, IPC/pillow boundary
- `.planning/research/PITFALLS.md` — EPUB-lock, SAF, locator stability
- `.planning/research/FEATURES.md` — library table-stakes
- `HANDOFF.md` / `docs/ANDROID-BUILD.md` — Android import & device gate

### Implementation touchpoints (code)
- `core/src/publication/mod.rs` — Publication trait / EpubPublication stub to flesh out
- `core/src/source.rs` — BookSource
- `core/src/locator.rs` — composite locator
- `src-tauri/src/migrations.rs` — SCHEMA_V1..V3 append-only pattern
- `src-tauri/src/storage.rs` — SourceRegistry
- `src-tauri/src/commands.rs` — import / ensure_work patterns
- `src/App.tsx` — current home “打开示例 / 导入” shell to evolve into library
- `src/reader/FoliateView.tsx` + `src/reader/ContinuousScrollStream.tsx` + `src/reader/reading-position.ts` — READER-POS dual surface
- `src/reader/locator-store.ts` — progress SQL

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `BookSource` + SAF rehydrate + `SourceRegistry` — library rows should reference handles, not paths as strings in UI
- `work` / `locator` schema + `ensure_work` / locator debounce — progress SSOT foundation
- `EpubPublication` stub (`content_hash` via blake3) — P4 fills metadata/cover
- Home `App.tsx` import list is a **thin** precursor, not the cover grid
- Reader dual surface already has continuous-scroll position work; P4 must **unify** open-from-library with one jump bus (roadmap MAJOR READER-POS)

### Established Patterns
- Append-only SQL migrations (V1→V2→V3)
- Soft-fail 简体中文; DRM refuse never decrypt
- Book bytes never over IPC; covers/metadata OK as small structs or app-data files served carefully
- Global prefs only — library is per-book **catalog**, not per-book typography overrides

### Integration Points
- Import pipeline must register SourceRegistry + library catalog + work identity in one coherent flow
- Opening a library item → existing FoliateView open path with work_id + locator restore
- Folder scan on Android requires persisted tree URI grants (DEC-004)

</code_context>

<specifics>
## Specific Ideas

- User consistently chose **recommended** options: dual ingest, hash skip, reference storage, recursive EPUB scan, cover grid with under-title text, paper placeholder, status chips + sort control, silent resume, thin progress bar, invisible READER-POS SSOT.
- Product language remains 简体中文 for all library chrome and empty/error states.

</specifics>

<deferred>
## Deferred Ideas

- **LIB-05 / LIB-06:** OPDS, Calibre, series/collections → v2 (REQUIREMENTS)
- **Library full-text search across books** → not in LIB-01..04; future phase if desired
- **Cloud cover download** → out of local-first / no mandatory network for core path
- **Per-book reading prefs** → still later (D-21)
- **Physical Android device gate** — still open from D-13; emulator remains substitute unless device provided
- **Bulk multi-select delete / export** — not decided; planner may include minimal “remove from library” as hygiene if needed for LIB-01 completeness (remove = unregister handle + catalog row; do not delete user file by default)

None of the above expand P4 success criteria unless planner marks a minimal remove as necessary for a usable library.

</deferred>

---

*Phase: 4-Local Library*
*Context gathered: 2026-07-16*
