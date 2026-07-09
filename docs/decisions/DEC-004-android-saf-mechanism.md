# DEC-004: Android SAF persistence via `tauri-plugin-android-fs` (audited, exact-pinned)

- **Status:** Accepted
- **Date:** 2026-07-09
- **Phase:** 1 (Foundation & Cross-Platform Skeleton) — Plan 01-05, `checkpoint:decision` gate
- **Decider:** Project owner (explicit choice over the recommended native-Kotlin path)
- **Sources:** CONTEXT.md D-05/D-12; 01-RESEARCH.md §Storage-handle / SAF; global CLAUDE.md §Supply-Chain Zero Trust

## Statement

FND-03 requires Android SAF folder/file access whose permission **survives app restart**.
Tauri v2 ships **no** `takePersistableUriPermission` binding and **no** folder picker
(upstream issue open). Two paths existed: write a small native Kotlin plugin, or adopt the
community crate **`tauri-plugin-android-fs`**.

The project owner chose the **community crate**, pinned exactly to **`=28.2.2`**, with the
mitigations below. The recommendation on record had been native Kotlin (per the global rule
*"Prefer local code over new third-party packages when the needed behavior is small and
auditable"*); this decision knowingly overrides it in exchange for delivery speed and
broader SAF coverage.

## Supply-chain audit (performed 2026-07-09, before adoption)

**Crate:** `tauri-plugin-android-fs` · repo `github.com/aiueo13/tauri-plugin-android-fs`
**Versions reviewed:** `28.2.2` (published 2026-06-23) and `28.4.0` (published 2026-07-07)
**Downloads:** 53,229 total / 6,315 recent · **GitHub:** 36★, 4 forks, 0 open issues, not archived

| Check | Finding |
|---|---|
| License | crates.io `MIT OR Apache-2.0`; repo declares `Apache-2.0`. Both permissive → **no AGPL contagion** (DEC-001 holds). Minor metadata discrepancy noted. |
| Prebuilt binaries | **None.** No `.aar` / `.jar` / `.so` / `.class`. Android side ships as readable **Kotlin source** (compiled by our gradle). Auditable. |
| Install-time hook (`build.rs`) | **Present.** Reviewed in full (2,970 bytes). Uses the standard `tauri_plugin::Builder` + `android_path("android")` + `global_scope_schema`. Reads `CARGO_FEATURE_*` to conditionally add Android permissions. **Side effect: calls `tauri_plugin::mobile::update_android_manifest(...)`, which rewrites our app's `AndroidManifest.xml` at build time.** Standard for Tauri mobile plugins, but it is real build-time mutation of our app manifest. |
| Network / process spawn in `build.rs` | **None.** No `reqwest`/`curl`/`ureq`/`Command::new`/download. (An earlier grep "hit" on `remove_dir` was a false positive — it matched the literal command name `"remove_dir_all"` in the `COMMANDS` array, not a filesystem call.) |
| Maintainer | **Single maintainer** (`aiueo13`), sole crates.io owner, sole contributor (17 commits). |
| Transitive risk | Depends on **`sync_async ^0.1.0`** — a one-version, never-updated crate **by the same author** (10k downloads, essentially all from this plugin). Self-dependency increases account-compromise blast radius. |
| Version ranges | Upstream declares caret ranges (`^2`, `^1`, …). Contained: our committed `Cargo.lock` pins the fully resolved graph. `tauri ^2.8.2` is satisfied by our pinned `tauri 2.11.5`. |
| Capability surface | **Oversized.** The plugin exposes 50+ commands (`read_file`, `write_file`, `remove_dir_all`, MediaStore, thumbnails, notifications, share/view dialogs). We need ~4. |

## Decision detail

1. **Pin `=28.2.2`, not `28.4.0`.** `28.4.0` was 2 days old at audit time; `28.2.2` has ~2.5 weeks
   of soak with an identical file structure and no yanks. Zero-trust favors the soaked release.
   Exact pin (`=`), never a caret range.
2. **Scope the capability surface.** Grant only the commands FND-03 needs via Tauri's capability
   system in `src-tauri/capabilities/default.json`:
   `show_open_dir_picker`, `persist_picker_uri_permission`, `check_persisted_picker_uri_permission`,
   `open_read_file_stream` (+ `release_persisted_picker_uri_permission` for revoke).
   Do **not** grant the write/remove/MediaStore/notification commands.
3. **Do not enable** the `legacy_storage_permission*` or `notification_permission` cargo features —
   they make `build.rs` inject extra `<uses-permission>` entries into our manifest.
4. **Review the generated `AndroidManifest.xml`** after the first build and commit it, so any future
   build-time manifest mutation shows up as a reviewable diff rather than a silent change.
5. **Keep `BookSource` opaque (D-05).** The plugin is an implementation detail behind the
   `BookSource::ContentUri` variant. No plugin type leaks into `pillowtome-core`, which stays
   platform-free. This preserves the exit: swapping to native Kotlin later touches only `src-tauri`.
6. **Re-audit on upgrade.** Any version bump re-runs this audit (diff `build.rs`, re-check for blobs).

## Consequences

**Positive:** FND-03 lands without hand-writing JNI glue; broader SAF coverage (pickers, streams,
persisted grants) than we'd build ourselves; permissive license; source-auditable Kotlin.

**Negative:** A single-maintainer dependency (plus a self-authored transitive crate) enters the
build graph, and a `build.rs` mutates our AndroidManifest. Mitigated by exact pinning, capability
scoping, feature-flag restraint, committing the generated manifest, and the `BookSource` abstraction
that keeps the swap-out cost confined to `src-tauri`.

**Exit path:** if the maintainer goes dark or a supply-chain incident occurs, replace with the
native Kotlin plugin originally recommended. Blast radius is one file behind `BookSource::ContentUri`.

## Related

- DEC-001 (license clean-room) — permissive license confirmed, no AGPL contagion
- CONTEXT.md D-05 (opaque storage-handle), D-12 (minSdk 26 / NDK r27)
- Global CLAUDE.md §Supply-Chain Zero Trust (exact pins; install-time hooks are code-execution surfaces)
