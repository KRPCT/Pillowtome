---
phase: 01-foundation-cross-platform-skeleton
plan: 05
subsystem: storage
tags: [android, saf, storage-handle, book-source, supply-chain, custom-protocol]

# Dependency graph
requires:
  - phase: 01-01
    provides: SourceRegistry, pillow:// Range protocol, CSP
  - phase: 01-03
    provides: BookSource storage-handle type
  - phase: 01-04
    provides: proven end-to-end reading slice on desktop + Android
provides:
  - SourceRegistry keyed by BookSource (opaque handle) instead of raw PathBuf
  - Desktop import via file dialog; Android import via SAF picker
  - Persisted SAF URI grants, re-hydrated at launch (survive force-stop + relaunch)
  - protocol::serve_bytes — in-memory Range serving for content:// sources
affects: [Phase 4 (library store binds to BookSource), Phase 7 (sync file plane)]

# Tech tracking
tech-stack:
  added: ["tauri-plugin-android-fs =28.2.2 (android-only target dep)", "tauri-plugin-dialog =2.7.1"]
  patterns: [opaque storage-handle behind BookSource, SAF bytes read in Rust inside the protocol handler, capability surface scoped to the minimum]

key-files:
  created: [src-tauri/capabilities/android.json, src/library/ImportButton.tsx]
  modified: [core/src/source.rs, src-tauri/src/{storage,protocol,commands,lib}.rs, src-tauri/Cargo.toml, Cargo.lock, src-tauri/capabilities/default.json, src/App.tsx, docs/decisions/DEC-004-android-saf-mechanism.md]

key-decisions:
  - "open_read_file_stream deliberately NOT granted — it would allow book bytes over the JS bridge, violating D-06. Bytes are read in Rust inside the pillow:// handler."
  - "File picker, not directory picker — a single-file SAF grant is persistable and matches the P1 single-book import flow."
  - "tauri-plugin-android-fs is a target-gated dependency; desktop never links it, keeping the swap-out cost inside src-tauri."

patterns-established:
  - "BookSource is opaque: pillowtome-core stays platform-free; no plugin type crosses into it (D-05)"
  - "Third-party capability surfaces are granted at the minimum, not at the vendor's ceiling"

requirements-completed: [FND-03]

# Metrics
duration: ~50min
completed: 2026-07-10
---

# Phase 1 Plan 05: Storage-Handle Import + Android SAF Persistence Summary

**Books enter the app through an opaque `BookSource` handle — a filesystem path on desktop, a SAF `content://` URI with a persisted grant on Android — and a previously imported book reopens after a force-stop without re-granting.**

## Accomplishments

- **`SourceRegistry` migrated** `Mutex<HashMap<String, PathBuf>>` → `Mutex<HashMap<String, BookSource>>` (D-05). The bundled `"sample"` re-registers as `BookSource::Path` with a regression assertion — no dangling `PathBuf` insert (closes plan-checker Warning 4).
- **Import flow:** desktop uses `tauri-plugin-dialog`; Android shows the SAF picker, then calls `persist_uri_permission` (`takePersistableUriPermission`) and wraps the URI as `BookSource::ContentUri`.
- **Launch re-hydration:** `rehydrate_imports()` reads `get_all_persisted_uri_permissions()` and re-registers each still-granted file under the same stable id a fresh import would produce — so ids stay consistent across restarts (FND-03).
- **D-06 preserved end-to-end:** SAF bytes are read **in Rust, inside the `pillow://` handler**, and streamed with Range + CORS via the new `protocol::serve_bytes`. IPC returns only `ImportedBook { id, name }` — never bytes.
- **Supply-chain mitigations from DEC-004 executed:** exact pin `=28.2.2`, target-gated so desktop never links it, capability surface scoped to 4 commands, `legacy_storage_permission*` / `notification_permission` features off.

## Task Commits

| Task | What | Commit |
|------|------|--------|
| 1 | Failing tests for `BookSource` registry + in-memory range serving (RED) | `144df8b` |
| 1 | Import via `BookSource` + Android SAF wiring (GREEN) | `bfd96b1` |
| 1 | 「导入书籍」 button + imported-books list | `2a8b98c` |
| 2 | SAF mechanism decision (pre-resolved) + as-built record | `1e4707a`, `a25f99e` |
| 3 | SAF persistence across restart (human-verify) | PASS |

## Deviations from Plan

### 1. [Reasoned pushback on DEC-004's illustrative capability list] `open_read_file_stream` withheld
DEC-004 listed `open_read_file_stream` among the commands to grant. The executor declined: granting it would let book bytes stream over the **JS bridge**, violating **D-06** (bytes never cross IPC). Bytes are instead read in Rust inside the `pillow://` handler. D-06 is a hard constraint; DEC-004's list was an illustrative ceiling. Surfaced in DEC-004 "As-built", not applied silently.

### 2. [Scope refinement] File picker instead of directory picker
`show_open_file_picker` replaces `show_open_dir_picker`. A single-file SAF grant is persistable and matches the P1 single-book import flow; directory access is a broader permission than FND-03 requires. Recorded in DEC-004 "As-built".

### 3. [Mitigation #4 satisfied differently than written]
DEC-004 said "commit the generated `AndroidManifest.xml`". It lives under `src-tauri/gen/android/`, which is **gitignored**. Instead, the `<uses-permission>` delta was determined from the plugin's `build.rs`: the permissions vector is populated **only** behind `CARGO_FEATURE_LEGACY_STORAGE_PERMISSION*` / `CARGO_FEATURE_NOTIFICATION_PERMISSION`, both off in our config, so `update_android_manifest` writes an **empty** block. **Net manifest permission delta: zero.** This is the intended outcome of mitigation #3.

## Verification Evidence

- `cargo test --workspace` (MSVC) — **35 passed, 0 failed** (was 31; +4 new). No regressions: `every_response_carries_cors` and `sample_is_clean_epub` still green.
- `pnpm build` (tsc + Vite) — green.
- Android Rust cross-compile — `cargo build --target aarch64-linux-android --lib` succeeded; both new plugins compiled for the target.
- **Pin verified:** `Cargo.lock` resolves `tauri-plugin-android-fs 28.2.2` (and the audit-flagged `sync_async 0.1.0` transitive) against `tauri 2.11.5`. No bump needed.
- **Portability verified:** `core/Cargo.toml` has no tauri/android dependency; no plugin type appears in `core/src/`.
- **Capability scope verified:** `capabilities/android.json` grants exactly 4 commands; no write/remove/MediaStore/notification/thumbnail/share/read-stream.
- **D-06 verified:** IPC surface is `check_protection`, `is_android`, `import`, `imported_books`; `ImportedBook { id, name }` carries no bytes.
- **FND-03 verified on device (D-13 emulator), machine-corroborated:**
  - `dumpsys activity permissions` shows a `UriPermission` for `content://…/Download/pillowtome-test.epub` granted to `com.pillowtome.app`.
  - The grant **survived `am force-stop`** — a transient task grant would not, so it is genuinely persisted.
  - After relaunch: process starts clean, **no panic, no `SecurityException`, no read failure** on the `rehydrate_imports()` path; grant still held.
  - Operator confirmed the book reopens without any re-grant prompt.

## Known Gaps / Follow-ups

- **Physical device untested** — emulator is the D-13 substitute.
- `sync_async 0.1.0` (single-version, same author as the plugin) is now in the build graph. Accepted cost of DEC-004; re-audit on any version bump.
- Android SAF ids are derived from the URI; a future library store (Phase 4) should key on the content hash instead so re-imports dedupe.
- `bundle.resources` still ships `gen_sample.py` into the APK (carried over from 01-04). Flag for code review.

## Next Phase Readiness

Phase 1 is functionally complete: all four requirements (FND-01..04) are satisfied. `BookSource` is the single import seam that Phase 4 (library store) and Phase 7 (sync file plane) will bind to.

## Self-Check: PASSED

Four commits present and signed; 35/35 tests green; SAF persistence corroborated by `dumpsys` across a force-stop.

---
*Phase: 01-foundation-cross-platform-skeleton*
*Completed: 2026-07-10*
