# Phase 1: Foundation & Cross-Platform Skeleton — Discussion Log

**Mode:** `--auto` (non-interactive; recommended/research-backed option chosen for every gray area, no AskUserQuestion). Human-reference audit trail only — not consumed by downstream agents (see `01-CONTEXT.md` for the canonical decisions).

**Date:** 2026-07-09

## Gray areas analyzed & auto-resolved

| # | Gray area | Options considered | Selected (recommended) | Grounding |
|---|-----------|--------------------|------------------------|-----------|
| 1 | Cross-platform framework | Tauri v2 · Flutter · Kotlin Multiplatform · RN/Capacitor | **Tauri v2 (shared Rust core + WebView)** | STACK.md — only stack sharing both core & renderer once; Readest-proven |
| 2 | Render engine | foliate-js · epub.js · readium · native | **foliate-js (MIT, pinned)** | char-level CFI fixes CJK progress bug; MIT clean |
| 3 | Repo structure | single crate · Rust workspace (core + tauri) | **Rust workspace: portable `core` + `src-tauri` glue + React/Vite `src/`** | ARCHITECTURE.md portability/testability |
| 4 | WebView engine strategy | system WebView + shim · bundle fixed Chromium | **System WebView + feature-detect + JS shim; Chromium = escape hatch** | PITFALLS.md #3 (Blink↔WebKit CJK CSS) |
| 5 | Storage handle | raw paths · opaque handle (SAF-aware) | **Opaque `BookSource` handle; Android SAF URI + persisted grant** | PITFALLS.md #6 (scoped storage) |
| 6 | IPC boundary | bytes over IPC · custom protocol | **Small data over IPC; book bytes via custom protocol only** | ARCHITECTURE.md boundary rule |
| 7 | Day-1 abstraction: Publication | defer · stub trait now | **`Publication` trait now; EPUB-only impl** | PITFALLS.md #1 (anti-EPUB-lock) |
| 8 | Day-1 abstraction: Locator | percentage · composite self-healing | **`{work_id, cfi, progress_fraction, text_context}`** | PITFALLS.md #5 (position drift) |
| 9 | Day-1 abstraction: identity/change-log | defer · stub schema now | **UUID + content hash + per-device change-log (SQLite/SQLx)** | PITFALLS.md #7 (sync merge) |
| 10 | DRM policy | attempt · detect-and-refuse | **Detect-and-refuse; soft-fail on corrupt** | charter + PITFALLS |
| 11 | Licensing | copy Readest · clean-room | **foliate-js MIT pinned; clean-room from AGPL Readest** | PITFALLS #13 |
| 12 | Android min SDK / NDK | — | **minSdk 26; NDK r27 (27.2.12479018); runtime CJK feature-detect** | STACK/PITFALLS |
| 13 | Android verification target | physical device · emulator | **Emulator (AVD `Medium_Phone_API_36.1`, API 36); physical deferred** | no device available (logged deviation) |

## Deferred / redirected
- All later-phase capabilities (reading UX, CJK typography, library, annotations, formats, sync) captured in `01-CONTEXT.md` <deferred>; only seams stubbed in P1.

## Notable deviation recorded
- **D-13:** "Real Android hardware" success criterion satisfied via emulator in this environment; physical-device verification deferred until a device is provided. Flagged for the verifier.

---
*Auto-generated during `--auto` discuss-phase.*
