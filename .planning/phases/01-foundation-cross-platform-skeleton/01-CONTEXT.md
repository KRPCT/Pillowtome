# Phase 1: Foundation & Cross-Platform Skeleton - Context

**Gathered:** 2026-07-09
**Status:** Ready for planning

> Mode: `--auto`. All gray areas auto-resolved to the research-backed recommended option (see `.planning/research/`). No user questions asked; every decision below is grounded in SUMMARY.md / ARCHITECTURE.md / PITFALLS.md / STACK.md and the PROJECT charter.

<domain>
## Phase Boundary

Stand up the cross-platform **Tauri v2** skeleton that every later feature runs inside, prove it builds and reads one bundled book end-to-end on **desktop (Win/macOS/Linux) and Android**, establish the **storage-handle** abstraction and the **DRM detect-and-refuse** safety boundary, and lock the **three day-1 architectural seams** (Publication model, composite Locator, identity + change-log schema) plus the key decisions — before any feature binds to them.

**In scope:** FND-01, FND-02, FND-03, FND-04. Cross-platform scaffold; IPC + custom-protocol byte streaming; storage-handle; DRM/corrupt refusal; the 3 seams as stubs; a thin end-to-end reading slice using foliate-js.
**Explicitly NOT in scope (later phases):** full reading UX/themes (P2), CJK typography (P3), library store/UI (P4), annotations (P5), TXT & other formats (P6), WebDAV sync engine (P7). Only *stub* the seams here.
</domain>

<decisions>
## Implementation Decisions

### Cross-Platform Framework & Project Structure
- **D-01:** **Tauri v2** (`tauri` 2.11.x) — one app, one Rust core, compiling to desktop *and* Android. Chosen because it is the only framework family where both the shared logic core (Rust) and the render engine (foliate-js in the WebView) are written once and reused on both targets, and it is Readest-proven in production. (STACK — HIGH confidence)
- **D-02:** Frontend = **React 19 + Vite + TypeScript** in the WebView; **foliate-js** (MIT) vendored at a **pinned commit** is the EPUB render engine. foliate-js is framework-agnostic, so React is not load-bearing for rendering — it drives chrome/controls only.
- **D-03:** Repo layout = Tauri v2 app over a **Rust workspace**: a platform-agnostic `core` crate (Publication orchestration, SQLite, locator, sync-later, DRM detection) + the `src-tauri` Tauri glue crate (commands, custom protocol, platform shims) + `src/` React/Vite frontend. foliate-js vendored under the frontend (e.g. `src/vendor/foliate-js/`), pinned. Platform-specific glue (SAF, file pickers, storage paths, WebView quirks) is isolated behind traits so `core` stays portable and unit-testable off-device.

### WebView Engine Strategy (Pitfall 3 — Blink↔WebKit CJK CSS divergence)
- **D-04:** Use each platform's **system WebView** (WebView2/Blink on Windows; Android System WebView/Blink; WKWebView/WebKit on macOS; WebKitGTK on Linux). Do **not** bundle a fixed Chromium in v1 (small binaries, local-first, Readest-proven). Mitigate CJK-CSS divergence with runtime **feature-detection + an owned JS text-shaping fallback shim**, and a **golden-image visual-regression** corpus across Blink & WebKit (harness stubbed in P1, exercised in P3). Bundled-Chromium is a **documented escape hatch** only.

### Storage-Handle Abstraction (Pitfall 6 — Android scoped storage / SAF)
- **D-05:** All book access goes through an opaque **storage-handle** (`BookSource`) in `core` — **never a raw path**. Desktop = filesystem path; Android = **SAF content URI + persisted permission grant** (`takePersistableUriPermission`, persisted across restarts). Import produces a handle; grants are re-hydrated on launch.
- **D-06:** **Book bytes never cross Tauri IPC.** Small structured data (metadata, locators, settings) crosses via IPC; large book bytes are streamed to foliate-js via a **custom protocol** (asset/`pillow://`) so the WebView reads files directly. (ARCHITECTURE boundary rule — reversing this is the Lithium trap.)

### The Three Day-1 Abstractions (Pitfall 1 — EPUB-lock / unstable IDs)
- **D-07:** **Publication model** — a Rust trait `Publication` (per-format metadata/cover/TOC/spine/content-hash). EPUB is the only implementor in P1; the seam makes TXT/MOBI/PDF purely additive. **Stub + EPUB impl only.**
- **D-08:** **Composite self-healing Locator** — `{ work_id, cfi (or part+offset), progress_fraction, text_context }`; **never** a bare percentage. Survives re-pagination and travels across devices. Type + persistence defined in P1 (used fully by annotations in P5).
- **D-09:** **Identity + change-log schema** — stable identity = **UUID** (library item) + **content hash** (dedup / KOReader-style doc identity later); a **per-device append-only change-log with a logical clock** for merge-ready sync. **SQLite via SQLx / `tauri-plugin-sql`** (one schema both platforms; NOT rusqlite). Schema stubs present-but-unsynced in P1 so P5 sync is additive.

### DRM & Safety Boundary
- **D-10:** DRM = **detect-and-refuse**. Detect Adobe ADEPT / Kindle DRM (and obfuscated content); refuse with a clear "unsupported" message; **never attempt decryption**. Malformed/corrupt EPUBs **soft-fail** with a friendly error — no crash. (charter + Pitfalls 5/6/14)

### Licensing / Clean-room
- **D-11:** Keep **foliate-js MIT** (pinned commit, attribution retained). Maintain a strict **clean-room boundary from AGPL Readest — do NOT copy Readest source.** License-audit every borrowed component's contagion surface. Final app license TBD before first public release; the clean-room discipline is **locked now**.

### Android Build Config & Verification
- **D-12:** **minSdk 26 (Android 8.0)** baseline; NDK **r27 (27.2.12479018)**, `NDK_HOME` set. Note: CJK-CSS support tracks the **System WebView version** (updatable independent of API level) — so P1/P3 must **feature-detect at runtime**, not assume by API level.
- **D-13:** **Verification substitute (logged deviation):** no physical Android device/SDK-device is available in this environment. The "real Android hardware" success criterion is satisfied via the installed Android **emulator** (AVD `Medium_Phone_API_36.1`, API 36) for build+run verification; **physical-device** verification is deferred until a device is provided. Desktop is verified natively. Rationale: user opted to enable Android tooling; emulator is the available target. This deviation is intentional and recorded for the verifier.

### Claude's Discretion
- Exact crate/module names, error types, `cargo tauri` scaffold flags, custom-protocol scheme name, and file layout within the above structure are implementation details for the planner/executor.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture & Build Order
- `.planning/research/ARCHITECTURE.md` — component boundaries, the 3 day-1 abstractions, IPC/custom-protocol rule, build order
- `.planning/research/SUMMARY.md` §"Architecture Approach" & §"Implications for Roadmap" (Phase 0/1) — the dependency spine and what P1 must lock
### Stack & Versions
- `.planning/research/STACK.md` — Tauri v2 / React / foliate-js / SQLx / reqwest_dav versions + rationale + "what NOT to use"
### Pitfalls to design against (all "design in P0/P1")
- `.planning/research/PITFALLS.md` §§1,3,5,6,7,10,12,13 — EPUB-lock, WebView divergence, locator stability, SAF, sync-schema, DRM, license
### Feature landscape (for the reading slice only)
- `.planning/research/FEATURES.md` §"Table Stakes" (EPUB rendering row) + Dependency Graph
### Charter & Scope
- `.planning/PROJECT.md` — strategic decisions & constraints
- `.planning/REQUIREMENTS.md` — FND-01..04 (this phase)
- `.planning/ROADMAP.md` → Phase 1 section — goal, success criteria, research flag
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield repo (only `.planning/` exists). This phase creates the initial scaffold.

### Established Patterns
- None yet. This phase *establishes* the patterns (workspace layout, trait seams, storage-handle, IPC boundary) that all later phases must follow.

### Integration Points
- Local toolchain verified present: Rust 1.95 + cargo, Tauri CLI 2.11.2 (`cargo tauri`), Node 22 + pnpm 10.33, Java 25, Android SDK (platforms 35/36, build-tools, platform-tools, emulator + AVD `Medium_Phone_API_36.1`), NDK r27 installed, Rust Android targets added. `ANDROID_HOME` / `NDK_HOME` set for the user env.
</code_context>

<specifics>
## Specific Ideas

- **Readest** is the *architectural reference* (same Tauri v2 + foliate-js shape) but is **AGPL — reference only, never copy source**.
- **foliate-js** is the render engine; character-level CFI locators fix the epub.js CJK progress bug.
- **KOReader** identity (MD5 doc-hash, furthest progress) is a *later* interop path (v2) — only the content-hash seam is reserved now.
</specifics>

<deferred>
## Deferred Ideas

- Full reading UX, themes, pagination knobs, TOC, search, custom fonts → **Phase 2**
- CJK typography (punctuation compression, autospace, kinsoku, fonts, fallback) + golden-image harness exercise → **Phase 3**
- SQLite library store, covers, metadata, sort/filter, real Publication impls beyond stub → **Phase 4**
- Annotations (highlight/note/bookmark) + full Locator use + change-log population → **Phase 5**
- TXT (and later MOBI/PDF) Publication implementations → **Phase 6**
- WebDAV sync engine, conflict resolution, selective file sync → **Phase 7**
- Bundled fixed Chromium → escape hatch only, do not build unless CJK parity proves infeasible in P3

None of the above are built in P1 — only their seams are stubbed.
</deferred>

---

*Phase: 1-Foundation & Cross-Platform Skeleton*
*Context gathered: 2026-07-09*
