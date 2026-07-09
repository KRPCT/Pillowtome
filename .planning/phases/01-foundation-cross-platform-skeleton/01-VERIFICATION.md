---
phase: 01-foundation-cross-platform-skeleton
verified: 2026-07-10T00:00:00Z
status: partial
score: 5/5 criteria substantively achieved; 3 satisfied via authorized substitution (D-13 emulator / single desktop OS)
verifier: Claude (gsd-verifier)
test_suite: 35/35 green (cargo test --workspace, MSVC toolchain)
authorized_substitutions:
  - decision: D-13
    substitution: "Android emulator (AVD Medium_Phone_API_36.1, API 36) substitutes for a physical Android device"
    recorded_in: "01-CONTEXT.md D-13; REQUIREMENTS.md traceability (FND-02/03 'emulator per D-13; physical device pending')"
    scope: "SC1, SC2, SC3 Android portion"
gaps: []
follow_ups:
  - "Physical Android device verification of FND-02/FND-03 (emulator is the D-13 substitute; deferred until a device is provided)"
  - "Desktop launch verified on Windows only; macOS (WebKit) and Linux (WebKitGTK) not exercised in this environment"
  - "pillowUrl() has NO automated regression guard — defect #3 (wrong per-platform URL) is caught only by a device/browser gate; add a frontend test harness"
  - "materialize_sample()/Android APK-resource read path has no off-device regression guard — defect #2 is inherently device-gated; document as a required device smoke check"
  - "bundle.resources still globs assets/sample/* and ships gen_sample.py into the APK (harmless; the resource path is now unused for reading) — flag for /gsd-code-review"
  - "Android toolchain fixes (Gradle dist pin, JDK-21 daemon) live in gitignored src-tauri/gen/android/ — reproducibility is tribal knowledge in docs/ANDROID-BUILD.md"
---

# Phase 1: Foundation & Cross-Platform Skeleton — Verification Report

**Phase Goal:** Stand up the cross-platform Tauri v2 skeleton, prove it builds and reads a book on desktop *and* Android hardware, establish the storage-handle abstraction and DRM safety boundary, and lock the three day-1 seams + key decisions before any feature binds to them.

**Verified:** 2026-07-10
**Status:** partial (goal substantively achieved; 3 criteria met via authorized substitution)
**Re-verification:** No — initial verification
**Method:** Goal-backward. Every claim checked against source; SUMMARY narrative treated as unproven. Full workspace test suite executed once (35/35 green under MSVC per the documented build-env defect).

## Goal Achievement — 5 Success Criteria

| # | Success Criterion | Verdict | Evidence |
|---|-------------------|---------|----------|
| 1 | App builds, launches, shows shell on Win/macOS/Linux desktop AND on a real Android device | **PARTIAL** | Workspace builds (35/35 tests compile+pass, MSVC). Desktop launch human-gate PASS on **Windows only** (macOS/Linux not run here). Android launch human-gate PASS on **emulator** AVD Medium_Phone_API_36.1 (D-13), not a physical device. Goal met via authorized substitution; literal "real device" + macOS/Linux unproven. |
| 2 | Open bundled sample EPUB end-to-end (foliate-js renders a readable page) on desktop and Android | **VERIFIED*** | `sample.epub` present (3513 B, valid PK zip, DRM-free — asserted by `sample_is_clean_epub`). `FoliateView.tsx` wires check_protection → `fetch(pillowUrl)` → `view.open` → `renderer.next()`. Human gates PASS: readable Chinese page + page-turn on Windows desktop and Android emulator. *Cross-platform render proven modulo physical device (D-13). |
| 3 | Import from device storage; Android SAF grant persists across restart; flows through storage-handle, never raw paths | **VERIFIED*** | `SourceRegistry` keyed by opaque `BookSource` (not `PathBuf`). Android: SAF picker → `persist_uri_permission` → `BookSource::ContentUri`; `rehydrate_imports()` re-registers persisted grants at launch. Emulator human-gate PASS, machine-corroborated by `dumpsys` (UriPermission survived `am force-stop`, reopened without re-grant). No raw path in core (unit-asserted). *SAF-persistence proven on emulator (D-13). |
| 4 | DRM/corrupt book detected and refused with clear "unsupported" message; never crashes, never decrypts | **VERIFIED** | `detect_protection` three-way classify; ADEPT/Kindle/unknown → refuse; corrupt → typed `CoreError::Corrupt` soft-fail; zero crypto/decrypt dependency. 6 integration + 4 module + 4 `decide()` tests green. Frontend renders `ErrorCard` (简体中文) and never calls `view.open` on refuse. Fully off-device — no emulator caveat. |
| 5 | Three day-1 seams exist as stubs + key decisions documented | **VERIFIED** | `Publication` trait + `Format`/`EpubPublication`; composite `Locator{work_id,cfi,progress_fraction,text_context}` — never a bare % (progress always present, serde-tested); schema v1 migration (`work` UUID+content_hash, `locator`, `change_log` w/ `logical_clock`) — migration test green; `BookSource` opaque handle. DEC-001 (license clean-room), DEC-002 (WebView engine), DEC-003 (DRM policy), DEC-004 (SAF) all Accepted + substantive. |

**Score:** 5/5 criteria substantively achieved. SC4 and SC5 are literally, fully verified off-device. SC1/SC2/SC3 are achieved with the D-13 emulator (and Windows-only desktop) substitution — an intentional, pre-recorded deviation.

## Binding Constraints (01-CONTEXT.md) — Compliance

| Constraint | Status | Evidence |
|-----------|--------|----------|
| D-05 BookSource opaque; core platform-free | ✓ | `core/Cargo.toml` has no tauri/android dep; `BookSource` is the only book-access type; `content_uri_carries_no_filesystem_path` test asserts no path leak. |
| D-06 Book bytes NEVER cross IPC | ✓ | `invoke_handler` = check_protection/import/imported_books/is_android — none return bytes. Bytes stream only via `pillow://`; SAF bytes read in Rust inside the handler. IPC carries `{id,name}` / verdict only. |
| D-07/08/09 three seams stubbed | ✓ | See SC5. Publication EPUB-only; Locator composite; schema v1 present-but-unsynced. |
| D-10 DRM detect-and-refuse; font-obf renders; corrupt soft-fails | ✓ | See SC4. `FontObfuscationOnly` renders; content DRM/unknown refuse; no decryption. |
| D-11 clean-room, foliate-js MIT pinned | ✓ | Vendored submodule @78914ae, MIT LICENSE retained; DEC-001. (Out-of-scope src/vendor not reviewed.) |
| T-01-01 pillow:// resolves only via registry; sanitize_id rejects `/ \ ..` | ✓ | `sanitize_id` + `serve` resolve only registry ids; traversal → 404 (tested). |
| T-01-03 custom-protocol responses carry CORS | ✓ | `cors()` wraps every response incl. 404/416; `every_response_carries_cors` + `serve_bytes_honors_range_and_cors` regression tests green. |
| Supply chain: exact pins, lockfiles, scoped plugin | ✓ | No `^/~/>=/latest` in any Cargo.toml; `tauri-plugin-android-fs =28.2.2` target-gated to android, capability scoped to 4 read-only commands (`android.json`); `open_read_file_stream` deliberately withheld (would violate D-06). |
| Restrictive CSP; book content no remote fetch | ✓ | CSP whitelists only self/ipc/pillow forms in connect/img/media/style/font-src; no remote origins. |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full workspace suite | `cargo test --workspace` (MSVC+vcvars) | 35 passed, 0 failed (10 lib + 3 migration + 5 protocol_range + 11 core + 6 protection) | ✓ PASS |
| Sample is a real DRM-free EPUB | `sample_is_clean_epub` | PK magic + `detect_protection == None` | ✓ PASS |
| No floating version ranges | grep `^ ~ >= latest` in Cargo.tomls | none | ✓ PASS |
| Android plugin pin | grep Cargo.toml | `=28.2.2` target-gated | ✓ PASS |

Desktop/Android render + SAF-persistence are human/device gates (not automatable off-device) — see Human Verification.

## Adversarial Assessment of the Two Known Caveats

### Caveat A — Emulator vs "real Android device" (D-13)

The Android emulator boots a full system image with the actual Android System WebView (Blink), real SAF/DocumentsProvider, and real APK packaging. For exactly what Phase 1 must prove — APK builds+launches, foliate-js renders in the Android WebView, SAF grant persists across force-stop — the emulator exercises the same system APIs and code paths as hardware. The three device-surfaced defects (APK-resource unreadability, http-vs-https scheme, cross-origin CORS) are precisely the platform-integration class an emulator reveals. What the emulator does **not** cover (real WebView-version CJK-CSS variance → P3/feature-detected; hardware perf; OEM SAF quirks) is **not** a Phase-1 criterion.

**Judgment:** The emulator is an *acceptable and adequate* substitute for the Phase-1 goals, and the deviation is pre-authorized in D-13 and recorded in the requirements traceability. It does **not** literally satisfy the "real Android device" wording. This is the reason the phase is **partial, not passed** — physical-device sign-off is an open, authorized-deferred follow-up, not a blocker.

### Caveat B — Would the test suite catch a regression of each of the three defects?

| Defect | Regression guard | Would tests catch it? |
|--------|------------------|-----------------------|
| #1 Missing CORS on pillow:// | `every_response_carries_cors` (200/206/416/404/404) + `serve_bytes_honors_range_and_cors` | **YES** — automated, covers file + in-memory paths. |
| #2 Android APK-resource unreadable via std::fs | `sample_is_clean_epub` guards the *embedded bytes* only; `materialize_sample()` and the "don't read via BaseDirectory::Resource on Android" behavior have **no** unit test | **NO** — inherently a device/emulator-only behavior (can't unit-test Android FS semantics off-device on Windows). Resurfaces only at the device gate. |
| #3 Wrong per-platform pillow:// URL | none — SUMMARY explicitly notes "no frontend test harness, pillowUrl has no unit guard" | **NO** — mitigated *structurally* (delegates to Tauri's `convertFileSrc`, so little remains to regress) but zero automated guard. |

**Judgment:** Only 1 of 3 defects has an automated regression guard. #2 and #3 remain guarded solely by device/human gates. #2 is an inherent off-device limitation; #3 is a real coverage gap worth a frontend test harness. Both are follow-ups, not Phase-1 blockers (the fixes are in place and verified at the gates).

## Required Artifacts

| Artifact | Status | Notes |
|----------|--------|-------|
| `core/src/{protection,error,locator,source,publication}` | ✓ VERIFIED | Substantive, wired, unit-tested; zero platform deps. |
| `src-tauri/src/{protocol,storage,commands,migrations,lib}` | ✓ VERIFIED | Range+CORS protocol, registry, DRM gate, schema v1, SAF wiring. |
| `src-tauri/assets/sample/sample.epub` | ✓ VERIFIED | 3513 B valid DRM-free EPUB; embedded via include_bytes! + materialized. |
| `src/{App,reader/FoliateView,reader/error-card,lib/pillow,library/ImportButton}` | ✓ VERIFIED | Reading slice + import UI wired; 简体中文 shell; no book-bytes IPC. |
| Tests: protection, protocol_range, migration + module tests | ✓ VERIFIED | 35/35 green. |
| DEC-001/002/003/004 | ✓ VERIFIED | All Accepted, substantive (2.7–9.6 KB). |

## Human Verification Required (authorized-deferred per D-13)

### 1. Physical Android device — build, launch, render, SAF persistence
**Test:** Deploy to a real Android phone; open the bundled sample (page renders + page-turn); import a book via SAF; force-stop; relaunch; reopen without re-granting.
**Expected:** Matches the emulator result (readable page; grant persists).
**Why human:** Physical hardware unavailable in this environment (D-13); emulator is the recorded substitute.

### 2. macOS (WebKit) / Linux (WebKitGTK) desktop launch + render
**Test:** `cargo tauri dev` on macOS and Linux; open sample.
**Expected:** Shell shows; page renders via the WebKit path (`pillow://localhost/<id>` per CSP).
**Why human:** Only Windows desktop was available; WebKit engines not exercised.

## Gaps Summary

No blocking gaps. The phase goal — a cross-platform Tauri v2 skeleton that builds and reads a book, with the storage-handle abstraction, DRM safety boundary, three day-1 seams, and key decisions locked — is substantively achieved and backed by a green 35-test suite plus machine-corroborated (dumpsys) SAF persistence. The phase is **partial rather than passed** solely because SC1/SC2/SC3 are satisfied through the pre-authorized D-13 emulator substitution (and Windows-only desktop), and because two of the three previously-device-surfaced defects (#2 Android resource path, #3 pillowUrl) lack automated regression guards. All items are recorded as follow-ups; none require rework before Phase 2, which does not depend on physical-device sign-off.

---

_Verified: 2026-07-10_
_Verifier: Claude (gsd-verifier)_
