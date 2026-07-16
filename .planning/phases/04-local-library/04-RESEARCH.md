# Phase 4: Local Library — Research

**Researched:** 2026-07-16  
**Domain:** SQLite library catalog, EPUB metadata/cover extraction, import/scan, READER-POS jump bus  
**Confidence:** HIGH for schema/import patterns (codebase-verified); HIGH for READER-POS root causes (MAJOR doc + code)

## User Constraints (from 04-CONTEXT.md — planner MUST honor)

### Locked decisions
- **D-50:** Dual entry — 导入书籍 + 扫描文件夹 (desktop folder / Android SAF tree)
- **D-51:** content_hash dedup → skip + 简体中文 notify; no second row
- **D-52:** Register-by-reference BookSource; covers may cache in app data; no bulk EPUB copy by default
- **D-53:** Recursive EPUB-only scan; DRM/corrupt soft-fail + aggregate summary
- **D-54:** work_id UUID + content_hash identity; reuse `work` / ensure_work pattern
- **D-55..D-58:** Cover grid; title/author under cover; paper placeholder; grid brief / detail rich
- **D-59..D-61:** Default 最近阅读; top chips + sort; 全部/在读/未读/已读完; empty dual CTA
- **D-62..D-65:** Thin progress bar; silent resume; user-invisible READER-POS SSOT; last_opened + last_read

### Deferred (ignore in plans)
- OPDS/Calibre/series (LIB-05/06), cross-library search, cloud covers, per-book prefs

## Project Constraints (from CLAUDE.md)

- Book bytes never over IPC (`pillow://` only) [VERIFIED: CLAUDE.md / D-06]
- Android emulator gate for library/import/reader changes [VERIFIED: CLAUDE.md]
- Exact pins; soft-fail 简体中文; clean-room vs Readest [VERIFIED: CLAUDE.md]
- Touch/scroll gate for sheets and scroll surfaces [VERIFIED: CLAUDE.md]

## Standard Stack

| Concern | Choice | Confidence | Source |
|---------|--------|------------|--------|
| Catalog DB | Append `SCHEMA_V4` via tauri-plugin-sql (same binding) | HIGH | [VERIFIED: migrations.rs V1–V3] |
| Identity | `work.work_id` + `content_hash` blake3 | HIGH | [VERIFIED: core publication + ensure_work] |
| Storage handle | `BookSource` + SourceRegistry | HIGH | [VERIFIED: source.rs / storage.rs] |
| Metadata/cover | Extend `Publication` / EPUB OPF parse in **Rust core** (or thin pure module); return small structs + write cover file to app_data | HIGH | [ASSUMED] zip/OPF parse via existing zip crate patterns in protection; foliate can open but identity/cover should be native for library without opening WebView |
| Import UI | Evolve `src/App.tsx` + `src/library/*` | HIGH | [VERIFIED: ImportButton exists] |
| Position SSOT | `reading-position.ts` tokens + locator-store + single jump bus in FoliateView | HIGH | [VERIFIED: docs/MAJOR-READER-POS.md] |

### Don't hand-roll
- Second SQLite binding [VERIFIED: Pitfall 6]
- Bare percentage progress store [VERIFIED: D-08]
- Parallel jump systems for library open vs TOC vs mode switch [VERIFIED: MAJOR-READER-POS]
- Full EPUB copy into app data by default [VERIFIED: D-52]
- Readest AGPL code for library UI [VERIFIED: DEC-001]

## Architecture Patterns

### 1. Catalog vs identity tables
**What:** Keep `work` as identity (hash/format). Add **library catalog** table(s) for user-facing shelf fields without rewriting V1.

**Prescriptive shape (planner may rename columns):**
```sql
-- SCHEMA_V4 (append-only)
CREATE TABLE library_item (
  item_id        TEXT PRIMARY KEY,           -- UUID catalog id (or = work_id if 1:1)
  work_id        TEXT NOT NULL REFERENCES work(work_id),
  source_id      TEXT NOT NULL,              -- SourceRegistry id / import id
  title          TEXT NOT NULL,
  author         TEXT,
  cover_file     TEXT,                       -- relative under app_data/covers/
  imported_at    INTEGER NOT NULL,
  last_opened_at INTEGER,
  last_read_at   INTEGER,
  UNIQUE(work_id)                            -- D-51: one shelf row per content identity
);
CREATE INDEX idx_library_last_read ON library_item(last_read_at DESC);
CREATE INDEX idx_library_title ON library_item(title);
```

**When:** 04-01. Map registry `import-*` ids to `source_id`; open path uses `source_id` for pillow fetch and `work_id` for locator.

**Confidence:** HIGH for separation of concerns; MEDIUM for exact column names (discretion).

### 2. Publication metadata + cover
**What:** Extend `Publication` trait (or companion API) with:
- `title()`, `authors()`, optional language
- `cover_bytes()` or write cover to path

**EPUB:** Parse OPF via zip (same family as protection path). Prefer **core** pure functions unit-tested off-device. Cache cover as `covers/{work_id}.jpg|png` under app_data; serve via pillow fonts-like path **or** data URL for small thumbs — prefer file + protocol reuse if already safe.

**Do not** require opening foliate to list the library.

**Confidence:** HIGH need; MEDIUM exact OPF parser approach (zip + XML in Rust — use existing deps if present).

### 3. Import / scan pipeline
**Flow:**
1. Pick file(s) or folder (SAF tree on Android)
2. For each candidate `.epub`: `check_protection` → refuse DRM; soft-fail corrupt
3. Hash bytes (stream where possible) → content_hash
4. If hash exists in `work`/`library_item` → skip + collect “已有” (D-51)
5. Else: register SourceRegistry, ensure work row, extract metadata/cover, insert library_item
6. Return aggregate summary 简体中文

**Folder scan:** recursive; progress UI discretionary for large trees.

**Confidence:** HIGH [VERIFIED: import + registry patterns]

### 4. Library UI
**What:** Replace thin `library__list` with cover grid per D-55..D-58. Sort/filter client-side first if N is small; SQL ORDER BY/WHERE when scaling.

**Empty state:** dual CTA (D-61).

**Progress bar:** from `locator.progress_fraction` join (D-62).

**Confidence:** HIGH for UX locks; MEDIUM for virtualization threshold.

### 5. READER-POS jump bus (04-04) — critical
**Problem:** Dual surface (foliate vs ContinuousScrollStream); jumpKey remount races; paginate→scroll seeds book start; TOC no-op in scroll. [VERIFIED: docs/MAJOR-READER-POS.md]

**Required design:**
```
ReadingPosition { spineIndex, offsetFraction, cfi?, fraction? }
  ↑ persist via locator-store (cfi may be pillow-scroll: or epubcfi)
  ↓ apply via one imperative API:

applyPosition(pos, surface: 'paginate' | 'scroll')
  - paginate: view.goTo(cfi|href) / renderer
  - scroll: ContinuousScrollApi.jumpTo(spineIndex, offset, cfi)

Commands (single bus):
  - openFromLibrary(workId) → load locator → applyPosition
  - modeSwitch(nextMode) → capture from current surface → apply to other
  - tocJump(href) → resolve to spineIndex → applyPosition
```

**Do not** couple progress *reporting* to jump *commands*. Parent SSOT owns targets; stream reports only.

**Acceptance (device):** library open both modes; paginate→scroll same chapter; scroll TOC; scroll→paginate.

**Confidence:** HIGH root cause; HIGH required outcome; MEDIUM exact React remount strategy (planner + existing ContinuousScrollApi).

## Common Pitfalls

| Pitfall | Mitigation |
|---------|------------|
| Path-based library | BookSource only (D-05/D-52) |
| Duplicate books | UNIQUE work_id / content_hash (D-51) |
| Cover IPC of large images | App-data cache + bounded size |
| Library open without work_id | ensure_work before locator |
| Second progress store for “library %” | Join locator only |
| Jump bus races | Imperative API + mount key discipline (MAJOR doc) |
| Phase 3 CJK regression | Don't touch CJK CSS except if open path requires |

## Code Examples (touchpoints)

- `core/src/publication/mod.rs` — extend trait
- `src-tauri/src/commands.rs` — `import`, `imported_books`, `ensure_work`
- `src/library/ImportButton.tsx` — extend / sibling FolderScanButton
- `src/App.tsx` — library shell
- `src/reader/reading-position.ts`, `locator-store.ts`, `FoliateView.tsx`, `ContinuousScrollStream.tsx`
- `src-tauri/src/migrations.rs` — SCHEMA_V4
- `docs/MAJOR-READER-POS.md` — mandatory for 04-04

## Validation Architecture

Automated sampling for Nyquist-style coverage of LIB + READER-POS unit layers:

| Requirement | Testable behavior | Level | Command / artifact |
|-------------|-------------------|-------|---------------------|
| LIB-01 | Import inserts library_item; duplicate hash skips | unit/integration | rust + vitest + cargo migration |
| LIB-02/03 | Grid renders title/author/cover path | unit (pure mappers) + build | pnpm test / manual |
| LIB-04 | Sort/filter pure functions | unit | vitest |
| Identity | content_hash stable; work UNIQUE | cargo | cargo test |
| READER-POS | encode/parse pillow-scroll; positionFromLocatorCfi | unit | existing reading-position.test.ts + extend |
| READER-POS | jump apply pure helpers if extracted | unit | new tests |
| Device | open/resume, mode switch, TOC scroll | manual/UAT | emulator gate |

**Nyquist note:** Full dual-surface jump cannot be fully proven in node vitest; device gates in VALIDATION.md / UAT are mandatory for 04-04.

## RESEARCH COMPLETE

Planner should produce waves:
1. Schema + Publication extract + identity (04-01)
2. Import/scan pipeline (04-02) depends 01
3. Library UI (04-03) depends 01–02
4. READER-POS bus (04-04) depends 01 (+ can parallel UI after position API stable; prefer after 02 so open-from-library exists)
