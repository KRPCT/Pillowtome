---
phase: 01-foundation-cross-platform-skeleton
plan: 02
subsystem: core-security
tags: [drm, epub, ocf, zip, thiserror, detect-and-refuse, zip-slip, tdd, off-device-test]

# Dependency graph
requires:
  - phase: 01-01
    provides: portable pillowtome-core crate with declared error/protection seam stubs + pinned zip (=2.4.2, deflate-only)
provides:
  - "core::protection::detect_protection(&[u8]) -> Result<Protection, CoreError> (read-only, never decrypts, D-10)"
  - "Protection enum { None, FontObfuscationOnly, ContentDrm(&'static str), Unknown }"
  - "core::error::CoreError (thiserror: Unsupported/Drm/Corrupt/Io) — the soft-fail surface"
  - "Four committed EPUB fixtures + gen_fixtures.py + off-device protection test suite"
affects: [01-04 (reading slice pre-checks detect_protection before serving bytes), 06 (TXT/MOBI Publication impls extend classification)]

# Tech tracking
tech-stack:
  added: []
  patterns: [detect-and-refuse (never decrypt), soft-fail typed errors over panics, zip-slip guard on read path, dependency-free attribute scan over adding an XML parser]

key-files:
  created: [core/src/protection.rs, core/tests/protection.rs, core/tests/fixtures/gen_fixtures.py, core/tests/fixtures/README.md, core/tests/fixtures/clean.epub, core/tests/fixtures/adept.epub, core/tests/fixtures/font-obfuscated.epub, core/tests/fixtures/corrupt.epub]
  modified: [core/src/error.rs, core/Cargo.toml]

key-decisions:
  - "No XML parser dependency: classify_encryption scans Algorithm/URI attributes directly (lean crate, zero-trust supply-chain baseline)"
  - "Zip-slip entries and missing container.xml both soft-fail as CoreError::Corrupt (reject hostile/invalid archives on the read-only detect path)"
  - "Kindle detected by PalmDB magic (BOOKMOBI/TPZ at offset 60) before the zip parse so it refuses as ContentDrm rather than reporting generic corruption"
  - "zip added as a dev-dependency (same =2.4.2 pin/features) so the zip-slip test builds a hostile archive in memory — no opaque .. binary committed"

requirements-completed: [FND-04]

# Metrics
duration: 8min
completed: 2026-07-09
---

# Phase 1 Plan 02: DRM & Corruption Detect-and-Refuse Summary

**Pure-`core`, off-device-tested `detect_protection()` that reads an EPUB zip read-only, classifies protection three ways (clean / font-obfuscation-only / content-DRM), refuses Adobe ADEPT + Kindle + unknown-algorithm encryption, guards zip-slip, and soft-fails corrupt archives through a typed `CoreError` — never decrypting anything (D-10).**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-09T14:31:31Z
- **Completed:** 2026-07-09T14:39:17Z
- **Tasks:** 2 (TDD: RED then GREEN)
- **Files:** 8 created, 2 modified

## Accomplishments

- Delivered **FND-04**: a portable, side-effect-free DRM/corruption detector living entirely in `pillowtome-core` (zero tauri/platform deps), fully unit-tested off-device — the fastest feedback loop in the phase.
- Implemented the **Pitfall-4 three-way classification** that is the whole point of D-10: `META-INF/encryption.xml` present for *legitimate font obfuscation* is classified `FontObfuscationOnly` (readable), distinctly from Adobe ADEPT / retailer content DRM (refused). Misclassifying obfuscated-font books as DRM would have been a failure; a dedicated test asserts the distinction.
- **Soft-fail, never panic (Pitfall 5):** truncated/garbage zips and EPUBs missing `META-INF/container.xml` return `CoreError::Corrupt`; the render layer shows a friendly "damaged" card instead of crashing.
- **Detect-and-refuse only (D-10/D-11):** no crypto/decrypt dependency linked; the zip is read read-only. ADEPT (`rights.xml`) and Kindle (PalmDB `BOOKMOBI`/`TPZ` magic) are refused as `ContentDrm`.
- **Zip-slip guard (T-01-04):** entries whose normalized path escapes the archive root (or is absolute) are rejected even on this read-only path via `ZipFile::enclosed_name()`.
- Typed `CoreError` (thiserror) with end-user-facing messages: `Unsupported`, `Drm(String)`, `Corrupt`, `Io`.

## Task Commits

Each task committed atomically (SSH-signed, Verified as SakuraRed):

1. **Task 1 (RED): fixtures + CoreError + failing protection tests** — `2a36f36` (test)
2. **Task 2 (GREEN): detect_protection three-way classification + zip-slip guard** — `7897551` (feat)

## Files Created/Modified

- `core/src/protection.rs` — `detect_protection` + `Protection` enum + internal `classify_encryption`, `attr_values`, `is_font_path`, `is_kindle`, `read_entry` helpers; 4 module unit tests for the classifier.
- `core/src/error.rs` — `CoreError` enum via `thiserror` (was a doc-only stub).
- `core/tests/protection.rs` — 6 integration tests over the four fixtures + inline Kindle-magic and zip-slip cases.
- `core/tests/fixtures/{clean,adept,font-obfuscated,corrupt}.epub` — tiny committed fixtures (60 B–1.6 KB).
- `core/tests/fixtures/gen_fixtures.py` — deterministic stdlib generator (auditable construction, no hand-edited binaries).
- `core/tests/fixtures/README.md` — per-fixture construction + expected classification table.
- `core/Cargo.toml` — added `zip` to `[dev-dependencies]` (same `=2.4.2`, `default-features=false, features=["deflate"]`; no new `Cargo.lock` entries).

## Decisions Made

- **No XML parser:** `classify_encryption` scans `Algorithm="…"` / `URI="…"` attributes with a tiny dependency-free helper rather than pulling an XML crate — keeps the crate lean and honors the supply-chain zero-trust baseline. The markers we read are simple attributes; a full parser is unwarranted for detect-only.
- **Font-obfuscation nuance is exact:** `FontObfuscationOnly` requires *every* `EncryptionMethod/@Algorithm` to be a known IDPF/Adobe font-obfuscation algorithm **and** every `CipherReference/@URI` to point at a font. A font-obf algorithm aimed at a content document → `Unknown` (refuse); any unknown/retailer algorithm → `ContentDrm` (refuse).
- **Kindle before zip parse:** magic-byte check runs first so a MOBI/AZW blob refuses as `ContentDrm("Kindle")` instead of falling through to generic `Corrupt`.
- **zip-slip + missing container = Corrupt:** both are treated as invalid/hostile archives and soft-fail, so nothing malformed reaches a later extraction path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `detect_protection` failed to compile: borrow of `zip` outlived the function (E0597)**
- **Found during:** Task 2 (GREEN build)
- **Issue:** using `match zip.by_name("…encryption.xml")` as the function's tail expression kept the `Result<ZipFile>` scrutinee temporary (borrowing `zip`) alive until end-of-function, where `zip` is dropped — a borrow-check error.
- **Fix:** extracted a generic `read_entry(&mut zip, name) -> Result<Option<String>, CoreError>` helper that reads the entry into an owned `String` and releases the archive borrow at the call site; the tail `match` now operates on an owned `Option<String>`.
- **Files modified:** `core/src/protection.rs`
- **Verification:** `cargo test -p pillowtome-core protection::` and `--test protection` both exit 0 under MSVC.
- **Committed in:** `7897551`

### Structural note (not a plan deviation)

- **zip dev-dependency added:** the plan declared four fixtures; rather than commit a fifth opaque binary containing a `../evil` path (which tooling may flag) or hand-edit bytes, the zip-slip archive is built in memory in the test via the `zip` crate added to `[dev-dependencies]` at the identical `=2.4.2` pin and features. No new `Cargo.lock` entries; the Kindle case is likewise an inline byte array. This keeps the committed fixture set to the four declared EPUBs and every hostile input is auditable in source.

**Total deviations:** 1 blocking (borrow-check), plus the structural dev-dependency note. No scope creep; every plan artifact and acceptance gate satisfied.

## Build/Environment Notes

- Built and tested through the **MSVC toolchain** per the Wave-1 env defect (host GNU `gcc.exe` silently fails): `vcvars64.bat` + `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc`. No `rust-toolchain.toml` committed (would break Linux/macOS contributors). Android cross-compiles use NDK clang and are unaffected — `core` stays portable with zero platform deps.

## Verification Evidence

- **RED (`2a36f36`):** `cargo test -p pillowtome-core --test protection` → `error[E0432]: unresolved imports pillowtome_core::protection::detect_protection, Protection` (genuine failing state against the stub).
- **GREEN (`7897551`):**
  - `cargo test -p pillowtome-core protection::` → 4 module unit tests pass.
  - `cargo test -p pillowtome-core --test protection` → 6/6 pass: `clean_epub_is_unprotected`, `detects_adept`, `font_obfuscation_is_not_drm`, `corrupt_zip_soft_fails`, `kindle_blob_is_refused`, `zip_slip_entry_is_rejected`.
  - Full `cargo test -p pillowtome-core` → all green (4 + 6 + 0 doctests).
  - No crypto/decrypt dependency present (grep: only doc-comment mentions of "decrypt"/`CipherReference`).

## TDD Gate Compliance

- RED gate: `2a36f36` (`test(01-02): …`) — tests failed to compile against the stub before implementation.
- GREEN gate: `7897551` (`feat(01-02): …`) — implementation makes all assertions pass.
- REFACTOR gate: none needed (implementation was clean; the E0597 fix was an in-GREEN compile fix, not a post-green refactor).

## Threat Model Coverage

| Threat ID | Mitigation delivered |
|-----------|----------------------|
| T-01-DRM | Detect-and-refuse only; no crypto/decrypt dependency linked; zip read read-only (D-10/D-11) |
| T-01-04 | Zip-slip guard: `enclosed_name()` rejects `..`/absolute entries on the read-only detect path (test `zip_slip_entry_is_rejected`) |
| T-01-05 | Malformed/truncated zip and missing container.xml → `CoreError::Corrupt` soft-fail, no panic (test `corrupt_zip_soft_fails`) |

## Known Stubs

None — this plan fully implements its surface. `detect_protection` classifies all fixtures correctly, refuses content DRM + Kindle, soft-fails corrupt zips, and guards zip-slip. (Whether the render layer refuses-with-message or renders a `FontObfuscationOnly` book is a Plan 04 UX decision per 01-RESEARCH Assumption A4; either satisfies D-10.)

## Next Phase Readiness

- FND-04 satisfied off-device: DRM/corrupt detected + refused cleanly, no crash, no decryption; three-way classification distinguishes font-obfuscation from content DRM.
- Plan 01-04's reading slice can call `pillowtome_core::protection::detect_protection(bytes)` as a pre-serve gate before streaming any book over `pillow://`.
- Build note for the verifier/future waves: use the MSVC toolchain + vcvars for desktop builds (broken host GNU gcc).

## Self-Check: PASSED

All claimed files exist on disk; both task commits (`2a36f36`, `7897551`) are present in git history.

---
*Phase: 01-foundation-cross-platform-skeleton*
*Completed: 2026-07-09*
