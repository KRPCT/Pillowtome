---
phase: 01-foundation-cross-platform-skeleton
plan: 04
subsystem: reader
tags: [foliate-js, custom-protocol, cors, android, drm-gate, epub, cjk]

# Dependency graph
requires:
  - phase: 01-01
    provides: pillow:// Range protocol, SourceRegistry, CSP, pillowUrl helper
  - phase: 01-02
    provides: detect_protection / CoreError (the pre-render DRM gate)
  - phase: 01-03
    provides: Publication / Locator / BookSource seams
provides:
  - Bundled DRM-free CJK sample EPUB, embedded in the binary and materialized to app_data_dir
  - foliate-js reading slice: open -> render a readable page -> page-turn
  - DRM/corruption gate wired ahead of any byte fetch (refuses without calling view.open)
  - Verified end-to-end EPUB read on desktop (Windows) AND Android emulator
affects: [01-05 (BookSource import replaces the fixture path), Phase 2 (full reading UX)]

# Tech tracking
tech-stack:
  added: [foliate-js view.js (vendored, pinned 78914ae), @tauri-apps/api convertFileSrc]
  patterns: [embedded build-time fixture materialized to app_data_dir, delegate platform URL construction to Tauri, DRM gate before byte fetch]

key-files:
  created: [src-tauri/assets/sample/sample.epub, src-tauri/assets/sample/LICENSE.txt, src-tauri/assets/sample/gen_sample.py, src/reader/FoliateView.tsx, src/reader/error-card.tsx, src/vendor-foliate-js.d.ts, docs/ANDROID-BUILD.md]
  modified: [src-tauri/src/lib.rs, src-tauri/src/commands.rs, src-tauri/src/protocol.rs, src-tauri/tests/protocol_range.rs, src/lib/pillow.ts, src/App.tsx, src/App.css, vite.config.ts]

key-decisions:
  - "Sample EPUB is embedded via include_bytes! and materialized to app_data_dir, NOT read through BaseDirectory::Resource — Android packages bundle.resources inside the APK with no filesystem path"
  - "Platform URL construction delegated to Tauri's convertFileSrc; hand-rolled UA sniffing is not knowable-correct (http vs https depends on app config)"
  - "pillow:// responses must carry CORS headers — the WebView never shares an origin with the protocol"

patterns-established:
  - "Every pillow:// response (including 404/416) carries Access-Control-Allow-Origin + Access-Control-Expose-Headers"
  - "DRM gate runs before any byte fetch; on refuse the reader renders ErrorCard and never calls view.open (D-10)"
  - "Build-time fixtures are embedded, not shipped as platform resources"

requirements-completed: [FND-01, FND-02]

# Metrics
duration: ~3h (incl. 3 gate-surfaced defects + Android toolchain remediation)
completed: 2026-07-10
---

# Phase 1 Plan 04: Bundled-EPUB Reading Slice Summary

**A DRM-gated foliate-js reading slice that opens a bundled CJK sample EPUB over `pillow://` and renders a readable, page-turnable page — verified end-to-end on Windows desktop AND the Android emulator.**

## Accomplishments

- Authored a tiny, deterministic, **CC0 self-written CJK sample EPUB** (3.5 KB, EPUB 3, valid `mimetype`/`container.xml`/OPF/nav/spine, no `encryption.xml`, no `rights.xml`). It doubles as an early CJK smoke test.
- Wired the **reading slice**: `check_protection` → `fetch(pillowUrl('sample'))` → `view.open(File)` → `renderer.next()`. Book bytes reach foliate-js only over `pillow://` (D-06); only the tiny verdict struct crosses IPC.
- **DRM gate ahead of the fetch** (D-10): content DRM / unknown encryption refuse with 简体中文 copy and `view.open` is never called; corrupt soft-fails; font-obfuscation-only renders normally.
- **FND-01 and FND-02 verified by human gates** — a readable Chinese page renders and page-turn advances on both desktop and the Android emulator (AVD `Medium_Phone_API_36.1`, API 36, per D-13).
- Fixed **three defects that only the device/browser gates could surface** (see below). Test suite grew 29 → 31.

## Task Commits

| Task | What | Commit |
|------|------|--------|
| 1 | Reading slice + bundled sample + DRM-gated error card | `d26559b` |
| — | fix: CORS headers on every `pillow://` response | `bfa06a7` |
| — | fix: embed sample EPUB, materialize to `app_data_dir` | `03e56aa` |
| — | fix: build `pillow://` URL via `convertFileSrc` | `13b2edb` |
| 2 | Desktop render gate (human-verify) | PASS |
| 3 | Android emulator render gate (human-verify) | PASS |

## Deviations from Plan

Three blocking defects, all found at the human gates. Each is the same failure class: **"it works on desktop" was mistaken for "it is correct."** None were catchable by the existing Rust unit tests.

### 1. [Rule 3 — Blocking] `pillow://` responses carried no CORS headers
- **Symptom:** desktop showed 「文件已损坏或无法读取。」 — the generic frontend `catch`, not the DRM verdict.
- **Cause:** in `tauri dev` the page origin is the Vite dev server (`http://localhost:1420`), so `fetch('http://pillow.localhost/sample')` is **cross-origin**. Without `Access-Control-Allow-Origin` the WebView blocks the request before the handler's status is observable. This would also have failed in a release build (`tauri.localhost` → `pillow.localhost` is still cross-origin).
- **Why tests missed it:** `protocol_range.rs` calls `serve()` directly in Rust, never through a browser origin.
- **Fix:** every response (incl. 404/416) now carries `Access-Control-Allow-Origin: *` + `Access-Control-Expose-Headers`. `*` is safe: `serve()` resolves ids only through `SourceRegistry` and rejects traversal (T-01-01). Regression test `every_response_carries_cors` added. — `bfa06a7`

### 2. [Rule 3 — Blocking] `BaseDirectory::Resource` is not readable via `std::fs` on Android
- **Symptom:** emulator showed 「无法读取书籍文件。」 (`std::fs::read` failed).
- **Cause:** `bundle.resources` are packaged **inside the APK** as Android assets (`assets/assets/sample/sample.epub`); there is no filesystem path. Confirmed by `adb`: the app's `files/` dir contained only `profileInstalled`. Desktop worked only because resources are copied next to the binary.
- **Fix:** embed the 3.5 KB fixture with `include_bytes!` and materialize it into `app_data_dir()` on first launch (idempotent, rewrites when stale). One code path on both platforms; no JNI/AssetManager. Semantically honest — the sample is a **build-time fixture**, not user content; real books arrive as a `BookSource` in Plan 01-05. Guard test `sample_is_clean_epub` asserts the embedded fixture is a valid, DRM-free EPUB. — `03e56aa`

### 3. [Rule 3 — Blocking] Hand-rolled per-platform `pillow://` URL sent Android to `https://`
- **Symptom:** emulator console `TypeError: Failed to fetch` at `FoliateView.tsx`; page origin logged as `http://tauri.localhost`.
- **Cause:** `pillowUrl()` sniffed `navigator.userAgent` and returned `https://pillow.localhost/<id>` on Android. Per `tauri-2.11.5/src/app.rs:2127`, Windows **and Android** use `http://<scheme>.localhost/<path>`. Worse, http-vs-https depends on `app.security.dangerousUseHttpScheme` — a config the frontend cannot know. The Windows branch was merely lucky.
- **Fix:** delegate to Tauri's injected `convertFileSrc(id, 'pillow')`, which is platform- and config-correct by construction and URL-encodes the id. All UA sniffing removed. — `13b2edb`

## Environment Remediation (Android toolchain)

Cleared three environment blockers before the emulator gate could run. Documented in `docs/ANDROID-BUILD.md`.

1. **Symlink denied** — `tauri-cli` symlinks the `.so` into `jniLibs/`; Windows blocks this without Developer Mode. Resolved by the operator enabling Developer Mode.
2. **Gradle distribution download timed out** (`services.gradle.org` unreachable). Resolved by pointing the wrapper at the **already-cached, already-verified `gradle-8.14.3-all`** dist (`-all` ⊃ `-bin`). No third-party mirror introduced — supply-chain surface unchanged.
3. **JDK 25 vs Gradle 8.14.3** — Zulu 25 is first on `PATH`; Gradle 8.14.3 supports ≤ JDK 24. Pinned the daemon JVM to JDK 21 and set `JAVA_HOME` for the launcher.

⚠️ **`src-tauri/gen/android/` is gitignored** (Tauri regenerates it), so fixes 2 and 3 are **local-only and will be lost** on `tauri android init` or on a fresh machine. `docs/ANDROID-BUILD.md` records the reproduction steps. A follow-up should make this reproducible rather than tribal knowledge.

## Verification Evidence

- `cargo test --workspace` (MSVC) — **31 passed, 0 failed** (was 29 pre-fix; +`every_response_carries_cors`, +`sample_is_clean_epub`).
- `pnpm build` (tsc + Vite) — green; foliate-js epub/zip/paginator chunks bundle.
- **FND-01 (desktop):** human gate PASS — readable Chinese page renders, page-turn advances.
- **FND-02 (Android emulator, D-13):** human gate PASS — same page renders in the Android System WebView.
- `sample.epub` structurally verified: 7 entries, `mimetype = application/epub+zip` stored first, no `encryption.xml`, no `rights.xml`.
- D-06 grep-verified: no byte-returning IPC command in `commands.rs`.

## Known Gaps / Follow-ups

- **Physical Android device** untested — the emulator is the D-13 substitute. Real-device verification remains open.
- `bundle.resources` still globs `assets/sample/*`, which ships `gen_sample.py` into the APK. Harmless but untidy; the resource path is now unused for reading. Flag for `/gsd-code-review`.
- No frontend test harness, so `pillowUrl` has no unit guard — mitigated by delegating to Tauri rather than hand-rolling.
- Android toolchain fixes live in a gitignored directory (see above).

## Next Plan Readiness

Plan 01-05 (storage-handle import + Android SAF persisted grants) is unblocked: `BookSource` exists (01-03), the registry/protocol path is proven on both platforms, and the SAF mechanism decision is recorded in `docs/decisions/DEC-004-android-saf-mechanism.md`.

## Self-Check: PASSED

All four commits present; 31/31 tests green; both human gates confirmed by the operator.

---
*Phase: 01-foundation-cross-platform-skeleton*
*Completed: 2026-07-10*
