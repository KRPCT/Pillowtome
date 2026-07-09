# Project Research Summary

**Project:** 枕籍 (Pillowtome)
**Domain:** Cross-platform ebook reader (Desktop Win/macOS/Linux + Android), EPUB-first multi-format, CJK-superior typography, WebDAV/self-hosted sync, local-first
**Researched:** 2026-07-09
**Confidence:** HIGH

## Executive Summary

Pillowtome is a Readest-class ebook reader whose single reason to exist is a **visibly superior Chinese (CJK) reading experience**, delivered across desktop and Android with **self-hosted WebDAV sync** instead of any proprietary cloud. The research converges — from four independent angles — on one prescriptive build: **Tauri v2 (shared Rust core) + a Web UI (React 19 + Vite + TypeScript) + foliate-js (MIT) as the EPUB/MOBI/KF8 render engine, SQLite (SQLx / tauri-plugin-sql) for local state, and WebDAV via `reqwest_dav` in the Rust core.** This is the *only* framework family where both the shared logic core (Rust) and the rendering engine (foliate-js in the platform WebView) are genuinely written once and reused on both targets — and it is exactly the shape Readest ships in production, so the risky integration work is already de-risked. Critically, we diverge from Readest where it matters: **WebDAV/self-hosted sync is greenfield** (Readest does not ship it) and is our second moat.

The reason Tauri+foliate-js wins is that **CJK typography is the differentiator, and the WebView is the best CJK engine available for free.** Rendering EPUB HTML/CSS in the system WebView gives us `writing-mode: vertical-rl`, `text-spacing-trim` (punctuation compression 标点挤压), `text-autospace` (中英混排), `line-break: strict` (kinsoku 禁则), `@font-face` + `lang`-based fallback, and ruby/emphasis — the exact feature set clean Chinese layout requires — at zero engineering cost. Flutter has no CSS engine (disqualified); Kotlin Multiplatform would force two renderers (Readium is Android-only). foliate-js also fixes a fatal CJK bug in epub.js (word/space-based offsets misplace progress in Chinese) via **character-level locators**.

The dominant risk is **not** technology choice — it is getting three abstractions right on day 1, before sync and extra formats are built: a **format-agnostic `Publication` model**, a **composite self-healing locator** (`work_id` + CFI/part + progress_fraction + text_context), and a **stable identity + change-log schema** (UUID + content hash + logical clock). Building sync or new formats over unstable IDs / percentage positions is the "Lithium-style late hard refactor" the project charter explicitly forbids. Secondary risks are all designable-around: WebView-engine divergence between Blink and WebKit (CJK CSS differs), WebDAV's dumb-file-store reality (client-side merge, no LWW), and Android scoped-storage/SAF (opaque storage handles, not raw paths).

## Key Findings

### Recommended Stack

The stack is high-confidence and cross-validated by all four research files. One Rust core (format orchestration, SQLite, WebDAV sync, conflict/merge, scanning, metadata) compiles to desktop and Android; one foliate-js WebView layer renders on both. Only thin platform glue (SAF, file pickers, storage paths, WebView quirks) differs. Use permissive licenses only — **foliate-js is MIT; do NOT copy AGPL Readest source.**

**Core technologies:**
- **Tauri v2** (`tauri` 2.11.5) — app shell + Rust core for desktop *and* Android from one project; small binaries, local-first, Readest-proven.
- **Rust** — shared core: format orchestration, DB, WebDAV sync, conflict resolution; compiles to all targets.
- **foliate-js** (MIT, vendor a pinned commit) — EPUB/MOBI/KF8/FB2/CBZ render engine; best CJK fidelity (character-level locators + WebView CSS).
- **React 19 + Vite + TypeScript** — WebView UI; foliate-js is framework-agnostic so UI is not load-bearing for rendering.
- **SQLite via SQLx / `tauri-plugin-sql`** (SQLx 0.8.6) — one schema for library/progress/annotations/sync-state on both platforms (NOT rusqlite — poor mobile fit).
- **`reqwest_dav`** (0.2.1) in the Rust core — WebDAV client, one impl serves both targets.
- **pdf.js** (`pdfjs-dist` 6.1.200) — PDF in the same WebView pipeline (later phase); escalate to `pdfium-render` (BSD) only if large-PDF perf demands. Avoid MuPDF (AGPL).

### Expected Features

The bar is "match Lithium's clean immersive baseline, approach Readest's capability surface, adopt KOReader's self-host ethos — and out-execute all three on Chinese typography, CJK font fallback, and offline dictionary/segmentation." CN-flagged items are the strategic moat and should be over-invested.

**Must have (table stakes):**
- EPUB reflow rendering (the hard core; gates everything)
- Library import/auto-scan + covers + title/author metadata + sort/filter
- Pagination↔scroll toggle, font/size/line-height/margins, day/night/sepia, immersive mode
- Highlights + notes + bookmarks on a **stable locator**; reading-progress persistence
- Search-in-book (must be CJK-aware), custom user fonts
- TXT support (with GBK/GB18030/UTF-8 detection — big for the Chinese web-novel corpus)
- WebDAV sync of progress + annotations (+ selective book-file sync)

**Should have (competitive — [CN] = the moat):**
- **[CN] CJK typography core** — punctuation compression, mixed CJK+Latin autospace, kinsoku, 2-char indent, bundled font + smart fallback. *Must be visibly better than Readest/Lithium on day 1.*
- **[CN] Tap-to-lookup dictionary** (segmentation + CC-CEDICT/StarDict/MDict) — the marquee CN power feature
- **[CN] Simplified⇄Traditional (OpenCC)**; KOReader sync interop; OPDS/Calibre; series & collections; reading statistics; paragraph/selection translation (opt-in, BYO-key)

**Defer (v2+):**
- PDF (high effort, conflicts with CN typography story); **[CN] vertical text (竖排)**; **[CN] pinyin/ruby**; TTS; CBZ/FB2; iOS/Web; AI summaries / Parallel Read / full-book translation

### Architecture Approach

Local-first, WebView-based, with a strict boundary rule: **small structured data crosses WebView↔Rust via Tauri IPC; large book bytes NEVER cross IPC** — the shell exposes them via a custom protocol so foliate-js reads files directly. Sync depends one-directionally on the data models (never the reverse — reversing this is the Lithium trap). The three day-1 abstractions (Publication model, composite locator, identity+change-log schema) are introduced while only EPUB exists, making sync and new formats purely additive.

**Major components:**
1. **Platform Shell (Tauri v2)** — window lifecycle, file pickers, Android SAF, storage paths, background-sync scheduling.
2. **Reading Engine (foliate-js)** — parse-for-render, CSS multi-column pagination, scroll/paginate, CFI, highlight overlay, in-book search.
3. **CJK Typography subsystem** — font manager + fallback chain + CSS pipeline injected into every render document (first-class module, not a stylesheet afterthought).
4. **Publication model (Rust trait)** — per-format metadata/cover/TOC/hash extraction; the anti-EPUB-lock seam.
5. **Library + Annotation/Locator + Settings (Rust + SQLite)** — single source of truth; composite locator shared across all three.
6. **Sync engine (Rust + `reqwest_dav`)** — two-plane sync (file plane + state plane), per-device append-only change logs, client-side merge.

### Critical Pitfalls

1. **EPUB-only lock-in + unstable IDs (the Lithium trap)** — define the format-engine abstraction, composite locator, and UUID+hash+change-log schema in P0, while only EPUB exists. Retrofitting is a HIGH-cost rewrite.
2. **Sync = last-write-wins → silent annotation/progress loss** — WebDAV has no server merge; model state for merge (per-item UUIDs + tombstones + logical clock; OR-Set for annotations, furthest-progress/LWW-per-key for progress). Decide in P0. Highest-regret pitfall to get wrong late.
3. **Trusting the WebView's default CJK handling / Blink-vs-WebKit divergence** — bleeding-edge CJK CSS (`text-spacing-trim`, `word-break: auto-phrase`) is Chromium-only. Own a JS text-shaping fallback layer, bundle region-correct SC/TC fonts with an explicit fallback chain, and keep a golden-image visual-regression corpus on both engine families.
4. **CJK font fallback: tofu, ransom-note mixing, or 500 MB bloat** — pin font stack per `lang` tag; ship subsettable OFL fonts (variable OTC ~33 MB or WOFF2 subset ~4 MB, or optional first-run download); auto-detect tofu on a coverage sheet; license-audit for embedding.
5. **Reading-position/CFI instability + CJK word-lookup without segmentation** — anchor position to a content locator (CFI + text_context + fraction), never a percentage; and gate the dictionary feature on a real CJK segmenter (jieba-class / `Intl.Segmenter`) so tap-to-define selects whole words.
6. **Android scoped storage / SAF + Tauri mobile gaps** — design import around an opaque storage handle (not raw paths) from P0; persist SAF URI grants; budget native Kotlin for SAF/share/background; stand up a real-hardware Android vertical slice in P0/P1.

## Implications for Roadmap

Research strongly agrees on a dependency-driven spine: **render engine → identity/locator/schema → sync/formats hang off it.** The CJK differentiator is front-loaded in parallel because it is the reason to exist. A recommended ~8-phase structure (aligning ARCHITECTURE's build order with PITFALLS' P0–P8 vocabulary):

### Phase 0: Foundation & Cross-Platform Skeleton
**Rationale:** Everything runs inside the shell; the three day-1 abstractions and key decisions must exist before any feature binds to them.
**Delivers:** Tauri v2 + React WebView + IPC bridge + custom-protocol byte streaming; storage-handle abstraction; `Publication` trait + `work_id`/content-hash + change-log schema stubs; **decisions locked: license (permissive, foliate-js MIT), WebView-engine strategy, DRM = detect-and-refuse policy**; a thin end-to-end reading slice building on real desktop *and* Android hardware.
**Avoids:** Pitfalls 1, 7, 9, 10, 12, 13 (all "design in P0").

### Phase 1: EPUB Reading Core (Lithium-parity milestone)
**Rationale:** Prove immersive EPUB reading before library/sync; this is the first demonstrably-usable milestone.
**Delivers:** Open EPUB via custom protocol → foliate-js paginate + scroll; day/night/sepia; font/size/margin/line-height; local CFI position persistence; soft-fail on malformed/FXL/obfuscated books (torture corpus in CI).
**Uses:** foliate-js, WebView CSS pipeline. **Avoids:** Pitfalls 5, 6, 14.

### Phase 2: Library Store
**Rationale:** The `Publication` abstraction and stable identity must be real before annotations/sync bind to them (even though only EPUB implements them).
**Delivers:** SQLite schema (books/metadata/covers/collections); Rust EPUB metadata+cover extract; import/scan; library UI; sort/filter.
**Implements:** Publication model + Library/Catalog component.

### Phase 3: Annotations + Composite Locator
**Rationale:** Locator + change-log schema are the sync prerequisites; adding them now avoids a later migration.
**Delivers:** Highlights/notes/bookmarks via foliate-js overlay; composite Locator formalized (CFI + fraction + text_context); reading-position store; change-log columns present (unsynced).
**Avoids:** Pitfall 5 (position drift), sets up Pitfall 7 prevention.

### Phase 4: CJK Typography Differentiation (front-loaded, parallel from P1)
**Rationale:** The product's reason to exist; shapes the render-CSS pipeline. Can start right after Phase 1.
**Delivers:** Font manager + SC/TC/JP coverage-aware fallback; CSS injection (`text-spacing-trim`, `text-autospace`, `line-break`/kinsoku, optional BudouX); punctuation compression; mixed-script spacing; CJK-aware defaults; dictionary/word-segmentation hook point; CJK-aware search.
**Addresses:** all [CN] table-stakes typography. **Avoids:** Pitfalls 2, 3, 4, 15.

### Phase 5: WebDAV Self-Hosted Sync
**Rationale:** Requires a stable format-agnostic locator + identity/change-log schema — hence strictly after 2 and 3.
**Delivers:** Two-plane sync (file + state); per-device change logs; `reqwest_dav`; conflict resolution (progress furthest/LWW-per-key; annotations OR-Set + tombstones); ETag/If-Match concurrency; resumable chunked upload; background/on-close scheduling.
**Avoids:** Pitfalls 7, 8, 14 (sync scheduling).

### Phase 6: Multi-Format Expansion
**Rationale:** Purely additive via the format abstraction — sync/annotation untouched. Can run parallel to Phase 5.
**Delivers:** TXT (CN encoding detection) early; MOBI/KF8; then PDF (pdf.js, lazy/virtualized, memory-capped) as a separate render pipeline; FB2/CBZ opportunistically.
**Avoids:** Pitfalls 6, 11, 12.

### Phase 7: Android Hardening + Advanced CN Features
**Rationale:** Built on a complete, synced, multi-format base.
**Delivers:** SAF implementation + persisted permissions + multi-API-level QA; battery profiling; **[CN] tap-to-lookup dictionary** (segmentation + CC-CEDICT/StarDict/MDict); **[CN] OpenCC 简繁**; KOReader sync interop; OPDS/Calibre; reading stats; opt-in translation. Later: vertical text (竖排), pinyin/ruby, TTS.
**Avoids:** Pitfalls 9, 14.

### Phase 8: Cross-Platform QA & Release
**Delivers:** Golden-image visual-regression on Blink + WebKit; full pitfall verification matrix ("Looks Done But Isn't" checklist); security hardening (sandbox untrusted EPUB JS, block remote fetches, keychain for WebDAV creds).

### Phase Ordering Rationale

- **Spine before branches:** render → identity/locator/schema (P0–P3) must precede sync (P5) and formats (P6); the two later groups are additive *only* because the abstractions exist first. This directly implements the anti-Lithium-refactor principle every research file emphasizes.
- **Differentiator front-loaded:** CJK typography (P4) runs in parallel from P1 because it defines the render-CSS pipeline and is the competitive moat — it must be visibly better on day 1, not bolted on.
- **Sync deliberately late but designed early:** the *schema* for merge is decided in P0/P3; the *engine* ships in P5 once the locator is stable. This splits the highest-regret pitfall (LWW loss) into cheap early design + safe later build.
- **PDF deferred:** highest effort, conflicts with the CN reflow story, and OOM-risky on Android — the P0 interface reserves a slot but implementation waits for P6.

### Research Flags

Phases likely needing deeper research during planning (`/gsd-plan-phase --research-phase`):
- **Phase 5 (WebDAV sync):** conflict-model details are MEDIUM confidence; per-device-log CRDT-lite design, Nextcloud chunked-upload v2 semantics, and proxy/ETag edge cases need concrete design against a real proxied server.
- **Phase 4 (CJK typography):** Blink-vs-WebKit CSS feature-parity matrix and the JS text-shaping fallback layer need engine-specific verification; kinsoku prohibited-char tables per zh-Hans/zh-Hant/ja.
- **Phase 6 (PDF):** large-PDF virtualization/memory strategy on low-end Android; pdf.js vs pdfium-render escalation criteria.
- **Phase 7 (dictionary/SAF):** CJK segmenter choice + dictionary licensing (CC-CEDICT CC-BY-SA), and Android SAF/`MANAGE_EXTERNAL_STORAGE` Play-policy specifics.

Phases with standard patterns (skip research-phase):
- **Phase 1 (EPUB core):** foliate-js integration is well-documented and Readest-proven.
- **Phase 2 (Library store):** standard SQLite metadata patterns.
- **Phase 3 (Annotations/Locator):** patterns are well-specified in ARCHITECTURE (composite locator) — design is decided, execution is standard.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified against official registries (Jul 2026); Readest demonstrates the exact shape in production. MEDIUM only on later PDF/MOBI perf specifics. |
| Features | HIGH | Grounded in current Readest / foliate-js / KOReader / Lithium shipping behavior + 2025 CSS CJK support. |
| Architecture | HIGH | Component model verified against foliate-js, Tauri v2, and KOReader sync sources; version numbers current. |
| Pitfalls | HIGH | Domain-specific pitfalls verified against 2025–2026 Tauri/foliate-js/Nextcloud/MDN/Android sources. |

**Overall confidence:** HIGH

### Gaps to Address

- **WebDAV conflict/merge model:** architecture is clear (two-plane, per-device logs, client-side merge) but concrete conflict resolution and provider-quirk handling need design + prototyping against a real proxied Nextcloud early in Phase 5.
- **CJK CSS cross-engine parity:** exact degradation behavior on WebKit (macOS/Linux) vs Blink (Windows/Android) for `text-spacing-trim`/`text-autospace` needs a golden-image harness before committing UX guarantees; may justify a JS shaping fallback or a bundled fixed Chromium (architectural, decide early).
- **Font bundling strategy:** subset vs variable vs optional-download tradeoff, plus per-font embedding-license audit, must be settled before Phase 4 ships.
- **Tauri Android maturity edges:** native Kotlin plugin workstream (SAF/share/background) and mobile E2E testing are under-documented — de-risk with a real-hardware slice in Phase 0.
- **License decision:** must be locked in Phase 0; keep a clean-room boundary from AGPL Readest and audit every borrowed component's contagion surface.

## Sources

### Primary (HIGH confidence)
- Tauri v2 release/ecosystem, SQL plugin, mobile docs — verified crate/CLI/API versions and Android support.
- foliate-js (GitHub + DeepWiki) — MIT, character-level CFI locators, MOBI/KF8, book interface, search.
- Readest (GitHub README + DeepWiki architecture) — Next.js+Tauri v2+foliate-js shape; native Rust metadata parse to avoid IPC transfer; WebDAV NOT shipped (#356/#577).
- KOReader progress-sync wiki + sync-server — MD5 doc-hash identity, furthest-progress, WebDAV per-device logs.
- W3C EPUB CFI 1.1 + Locators — re-location via preceding/trailing text.
- MDN + Chrome i18n — `text-spacing-trim` (2024), `text-autospace` (Nov 2025), `line-break`, `word-break: auto-phrase`/BudouX.
- Nextcloud WebDAV chunked-upload v2 docs; Android scoped-storage/SAF + Play all-files-access policy.

### Secondary (MEDIUM confidence)
- `reqwest_dav`, `pdfium-render`, SQLx-vs-rusqlite surveys — Rust component choices and mobile fit.
- CLREQ / CJK typesetting best-practice articles — kinsoku, punctuation, font fallback.
- OpenCC / jieba / CC-CEDICT — segmentation + Simp/Trad + dictionary licensing.

### Tertiary (LOW confidence)
- Later-phase PDF performance specifics (pdf.js vs PDFium on large/complex docs) — needs on-device measurement.
- KMP/Flutter alternative paths — evaluated and rejected; retained only as contingency references.

---
*Research completed: 2026-07-09*
*Ready for roadmap: yes*
