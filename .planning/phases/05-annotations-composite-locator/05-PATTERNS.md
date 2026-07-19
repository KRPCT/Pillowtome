# Phase 5: Annotations & Composite Locator - Pattern Map

**Mapped:** 2026-07-17
**Files analyzed:** 11 (5 new, 6 modified)
**Analogs found:** 11 / 11 (all in-repo; zero greenfield roles)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/reader/annotation-store.ts` (new) | store | CRUD + append-log | `src/reader/locator-store.ts` | exact (SQL store, same DB) |
| `src/reader/annotation-store.test.ts` (new) | test | CRUD | `src/reader/locator-store.test.ts` | exact |
| `src/reader/anchor-resolver.ts` (new) | utility/resolver | transform (CFI→text→fraction) | `src/reader/scroll-cfi.ts` (`cfiToRange`) + `src/reader/reading-position.ts` | role-match (pure resolver) |
| `src/reader/anchor-resolver.test.ts` (new) | test | transform | `src/reader/scroll-cfi.test.ts` | exact |
| `src/reader/AnnotationBubble.tsx` (new) | component | event-driven (selection) | `src/reader/ReaderTapZones.tsx` (abs-positioned overlay) | role-match |
| `src/reader/AnnotationSheet.tsx` (new; note editor + manager) | component | request-response (list/jump/delete) | `src/reader/TocSheet.tsx` | exact (Sheet + list + onNavigate) |
| `src/reader/scroll-cfi.ts` (modify) | utility | selection→CFI + text search | itself (extend) | self |
| `src/reader/locator-store.ts` (modify) | store | CRUD | itself (fill text_pre/post) | self |
| `src/reader/FoliateView.tsx` (modify) | reader host | event-driven (paginate anno) | itself (event/transform seams) | self |
| `src/reader/ContinuousScrollStream.tsx` (modify) | reader host | event-driven (scroll anno) | itself (onLoad seam L865) | self |
| `src-tauri/src/migrations.rs` (modify) | migration | schema DDL | itself (SCHEMA_V1..V6) | self |

## Pattern Assignments

### `src/reader/annotation-store.ts` (store, CRUD + append-log)

**Analog:** `src/reader/locator-store.ts` — same DB, same param-bind discipline, same soft-fail contract. Copy its shape wholesale; annotations differ only in table (V7) and the mandatory `change_log` append.

**DB open + soft-fail pattern** (`locator-store.ts:14`, `29-31`, `76-79`):
```typescript
const DB_PATH = "sqlite:pillow.db";
async function openDb(): Promise<Database> { return Database.load(DB_PATH); }
// every call wrapped: try { ... } catch (err) { console.warn("[annotation-store] … failed", err); return null; }
```

**Parameterized `$n` binds only — never string-concat** (`locator-store.ts:99-119`, security V5/T-02-sql). Copy the `INSERT … ON CONFLICT DO UPDATE SET col = excluded.col` upsert form for `revision`/`updated_at` bumps.

**Text windowing helper** (`locator-store.ts:129-138`): reuse `textExactFromRange` (already trims + collapses whitespace + caps at `TEXT_EXACT_MAX = 120`). P5 adds symmetric `text_pre`/`text_post` at 16 chars/side (RESEARCH text_context section). Prefer exporting a shared `textContextFromRange(range)` from `locator-store.ts` over duplicating.

**New vs analog — the change_log append (no analog writer exists; P5 is first TS writer):**
- Every create/update/delete appends one `change_log` row AND bumps `sync_meta.logical_clock` **inside the same SQL transaction** (RESEARCH Pitfall 5). locator-store does single statements; annotation-store must use a transaction wrapping the annotation write + `UPDATE sync_meta SET logical_clock = logical_clock + 1` + read-back + `INSERT INTO change_log`.
- `tauri-plugin-sql` has no JS transaction API — do the multi-statement atomic write as one `db.execute` with `BEGIN…COMMIT`, or push it to a Rust command. Planner decides; flag as the one place the locator-store analog does NOT cover.

**Soft-delete tombstone** (D-80): `UPDATE annotation SET deleted = 1, revision = revision + 1, updated_at = $n` + a `change_log` `op='delete'` row. Never physical `DELETE`.

---

### `src/reader/anchor-resolver.ts` (utility/resolver, transform)

**Analog:** `src/reader/scroll-cfi.ts` (`cfiToRange`, `:177-195`) for the CFI→Range step; `src/reader/reading-position.ts` (`isRealCfi`) for the guard. This is NEW shared code called by both locator restore and annotation restore (D-77).

**CFI→Range primary tier** (reuse verbatim, `scroll-cfi.ts:177`):
```typescript
export function cfiToRange(doc: Document, cfi: string): Range | null {
  if (!doc || !CFI.isCFI.test(cfi)) return null;
  // strips spine indirection before CFI.toRange — DO NOT reimplement
}
```
Resolver step 1 = `isRealCfi(cfi)` → `cfiToRange(doc, cfi)` → if range has non-empty client rects, return `{ range }`.

**Text-search fallback tier** (new; use `getBoundingClientRect`/`TreeWalker` idiom already in `scroll-cfi.ts:49-58`, `73-96`): normalize haystack + needle via `convertText(_, 't2s')` from `src/reader/cjk-convert-shim.ts`, exact-match `text_exact`, disambiguate with `text_pre`/`text_post`, map offset→Range with a `SHOW_TEXT` TreeWalker (same NodeFilter pattern as `getVisibleRange`). On hit, write back a fresh CFI (self-heal).

**Fraction last-resort tier**: return `{ fractionTarget }` → nearest paragraph boundary. NEVER bare `scrollTo(%)` (D-78, `locator-store.ts` header "never bare percentage").

**Contract signature** (from RESEARCH Self-Healing Resolver Contract):
```
resolveAnchor(doc, { cfi, text_pre, text_exact, text_post, progress_fraction })
  → { range } | { range, healed:true } | { fractionTarget } | null
```

---

### `src/reader/AnnotationSheet.tsx` (component, note editor + manager)

**Analog:** `src/reader/TocSheet.tsx` — near-exact fit. Copy its structure directly: `useIsDesktop` (drawer ≥768px / bottom sheet phone), `Sheet`/`SheetContent`/`SheetHeader`/`SheetTitle`, grouped scroll list, `onNavigate`-then-close.

**Sheet shell + touch-gate-safe scroll body** (`TocSheet.tsx:85-111`) — copy the className string verbatim, it already satisfies the CLAUDE.md scroll gate:
```tsx
<SheetContent side={isDesktop ? "left" : "bottom"} className="… flex … flex-col gap-0 p-0" showCloseButton>
  <SheetHeader className="reader-sheet__header shrink-0 …">…</SheetHeader>
  <div className="reader-sheet__body … min-h-0 flex-1 overflow-y-auto overscroll-contain
       [-webkit-overflow-scrolling:touch] [touch-action:pan-y]">
```
This is the mandated `flex-col` + `shrink-0` header + `flex-1 min-h-0 overflow-y-auto` + `touch-action:pan-y` body (CLAUDE.md touch/scroll gate rule 3). DO NOT deviate.

**List item + jump** (`TocSheet.tsx:120-140`): per-chapter grouped `<ul>`/`<button onClick={onNavigate}>`. Annotation manager groups by chapter, taps jump via `position-bus` (below), swipe-to-delete calls `annotation-store` tombstone.

**Empty state** (`TocSheet.tsx:103-109`): copy the 简体中文 `role="status"` empty card ("暂无批注").

**Note editor**: same Sheet shell, body = `<textarea>` bound to `annotation.note`; save calls `annotation-store` update (bumps revision + change_log).

---

### `src/reader/AnnotationBubble.tsx` (component, event-driven selection)

**Analog:** `src/reader/ReaderTapZones.tsx` (absolute-positioned reader overlay). No exact bubble analog exists — this is the most novel UI, but the constraint is well-defined.

**Touch-gate rule (D-74 / CLAUDE.md, NON-NEGOTIABLE):** bubble is a React absolutely-positioned SMALL element; `pointer-events:auto` ONLY on the bubble itself. NEVER a full-screen `pointer-events:auto` capture layer (Pitfall 8). Dismiss by listening to the scroller's existing `scroll`/`pointerdown` (`ContinuousScrollStream.tsx:761-763` `markGesture` seam).

**Coordinate mapping** (RESEARCH Selection→Bubble): scroll = `range.getClientRects()[0]` + `iframe.getBoundingClientRect().top`; paginate = rects + `foliate-view` host rect translate. Flagged as the Android-emulator acceptance hard-gate (closed shadow coord mapping).

---

### `src-tauri/src/migrations.rs` (migration, schema DDL) — MODIFY

**Analog:** itself, SCHEMA_V1..V6. Append-only doctrine is explicit in the file header and every version comment.

**Copy the exact append pattern** (`migrations.rs:134-137` V6 + `178-183` registration):
```rust
pub const SCHEMA_V7: &str = r#" … CREATE TABLE annotation … CREATE TABLE sync_meta … "#;
// then in migrations(): push Migration { version: 7, description: "annotations_and_sync_meta",
//   sql: SCHEMA_V7, kind: MigrationKind::Up }
```
Note `migrations.rs:78` already reserves: "annotations use separate tables in P5". V7 DDL is fully specified in RESEARCH "Data Model — schema V7". `change_log` (V1, `:41-49`) is REUSED unchanged — do not alter it.

**Test:** extend `src-tauri/tests/migration.rs` to assert V7 applies against `sqlite::memory:` (same off-device pattern the header documents).

---

### Modified reader hosts (event seams — no new file, wire into existing)

**`FoliateView.tsx` (paginate):** annotation events attach at the existing foliate-event region.
- `transformTarget` `'data'` handler at `FoliateView.tsx:1327` — CFI computed on already-transformed DOM (Challenge E: no special timing needed).
- `reopenTick` full-reopen on 简繁/词不拆行 toggle at `:263` / `:1513-1516` — this is exactly when structural CFI can break → resolver text_context rescue re-anchors annotations from store.
- Add listeners alongside `view.addEventListener("relocate", …)` (`:1275`): `load` (attach selection listener to `e.detail.doc` — only reachable seam in closed shadow), `draw-annotation`, `create-overlayer`, `show-annotation`. Draw via `view.addAnnotation({ value: cfi, type, color })` + `getCFI`.

**`ContinuousScrollStream.tsx` (scroll):** the per-section-doc seam is `onLoad` at `:865`.
- `injectStyles(iframe)` at `:867` — inject `::highlight()` CSS rules here (per-iframe registry, RESEARCH Item A).
- Existing `doc.addEventListener("pointerdown"/"pointerup"/"click")` block at `:889-894` — add `selectionchange`/`pointerup` settle + CSS Custom Highlight `Highlight` re-registration for this section's annotations in the SAME block (D-74 same seam as link-click/autospace). Lazy: only draw annotations hitting this section (Pitfall 9, perf stress test required per memory).

---

### `src/reader/locator-store.ts` (modify) + `src/reader/scroll-cfi.ts` (modify)

**locator-store.ts:** fill `text_pre`/`text_post` (currently `null` at `:167-169` `// P2: pre/post empty`). Reuse/extend `textExactFromRange` (`:129`) into a symmetric window helper shared with annotation-store. `relocateToLocatorRow` (`:144`) populates pre/post from the relocate range.

**scroll-cfi.ts:** extend with selection→CFI round-trip (already has `cfiToRange`, `visibleRangeCfi`, `getVisibleRange`). Selection→CFI = `CFI.fromRange` + `CFI.joinIndir(baseCfi, …)` — same idiom as `visibleRangeCfi:161-163`. Extend `scroll-cfi.test.ts` with selection round-trip cases.

## Shared Patterns

### SQL access + soft-fail
**Source:** `src/reader/locator-store.ts:14,29-31,76-79`
**Apply to:** `annotation-store.ts`, `sync_meta` access
- `Database.load("sqlite:pillow.db")`; every op `try/catch` → `console.warn("[…] failed", err)` + null return (软失败 简体中文). Parameterized `$n` binds only, never string concat (security V5).

### CFI resolution
**Source:** `src/reader/scroll-cfi.ts:177-195` (`cfiToRange`), `epubcfi.js` (`CFI.fromRange`/`toRange`/`joinIndir`)
**Apply to:** `anchor-resolver.ts`, scroll selection→CFI, annotation draw
- Never hand-roll CFI. Strip spine indirection before `toRange` (the `:188-189` shift). Guard with `CFI.isCFI.test` / `isRealCfi`.

### Sheet shell (touch-gate compliant)
**Source:** `src/reader/TocSheet.tsx:28-44` (`useIsDesktop`), `:85-111` (SheetContent + body classes)
**Apply to:** `AnnotationSheet.tsx` (note editor + manager)
- `flex flex-col` / `shrink-0` header / `flex-1 min-h-0 overflow-y-auto [touch-action:pan-y]` body. This is the CLAUDE.md scroll-gate-safe layout — copy verbatim.

### Jump bus (single SSOT)
**Source:** `src/reader/position-bus.ts` (`planJump`, `positionForTocSpine`)
**Apply to:** annotation/bookmark list tap-to-jump
- Do NOT invent a second progress/jump store (`position-bus.ts:5-6`). Route annotation jumps through the existing bus → `view.goTo` (paginate) / scroll `jumpTo`.

### Append-only migration
**Source:** `src-tauri/src/migrations.rs:134-137,178-183`
**Apply to:** V7
- New `SCHEMA_Vn` const + `Migration { version, description, sql, kind: Up }` push. Never rewrite prior schemas. Reuse `change_log` (V1) unchanged.

### CJK normalization for text search
**Source:** `src/reader/cjk-convert-shim.ts` (`convertText`, opencc-js@1.4.1, already installed)
**Apply to:** `anchor-resolver.ts` text-search tier
- Normalize needle + haystack to Simplified (`convertText(_, 't2s')`) before compare so search survives 简繁 toggle. `Intl.Segmenter` (already used in `cjk-content-transform.ts`) for word-boundary disambiguation.

## No Analog Found

| File | Role | Data Flow | Reason / Mitigation |
|------|------|-----------|---------------------|
| `AnnotationBubble.tsx` | component | event-driven selection | No selection-bubble exists. Closest structural analog = `ReaderTapZones.tsx` (abs-positioned overlay). Coordinate mapping in closed shadow root (paginate) is the Android-emulator acceptance hard-gate. |
| change_log transactional writer | store logic | append-log | P5 is the FIRST TS writer of `change_log` (grep-confirmed in RESEARCH). No existing writer to copy; clock+append must be atomic (transaction or Rust command). locator-store's single-statement pattern does NOT cover it — flagged for planner. |
| content_hash (blake3) command | Rust command | transform | Reuse existing `work.content_hash` blake3 in Rust core via `invoke`; RESEARCH open-question 2 (blake3-via-invoke vs WebCrypto SHA-256) — planner decides, must record algorithm in change_log payload. |

## Metadata

**Analog search scope:** `src/reader/`, `src/components/ui/`, `src/library/`, `src-tauri/src/`
**Files scanned:** locator-store.ts, migrations.rs, scroll-cfi.ts, position-bus.ts, TocSheet.tsx, reading-position.ts; grepped ContinuousScrollStream.tsx + FoliateView.tsx seams
**Pattern extraction date:** 2026-07-17
</content>
</invoke>
