---
phase: 01-foundation-cross-platform-skeleton
plan: 01
subsystem: infra
tags: [tauri, rust, react, vite, foliate-js, custom-protocol, sqlite, supply-chain, cargo-workspace]

# Dependency graph
requires:
  - phase: none
    provides: greenfield — this plan creates the initial scaffold
provides:
  - Cargo workspace (pillowtome-core portable crate + pillowtome src-tauri glue crate)
  - Exact-pinned deps with committed Cargo.lock + pnpm-lock.yaml (no floating ranges)
  - Vendored foliate-js submodule pinned to 78914ae (MIT LICENSE retained)
  - Range-aware pillow:// async URI-scheme protocol (200/206/416, 1 MiB cap), scope-guarded
  - SourceRegistry managed state with bundled sample pre-registered at setup (id "sample")
  - Per-platform pillowUrl() URL builder + CSP whitelisting the scheme
  - Declared core seam stubs (error/protection/publication/locator/source)
  - src-tauri stubs (commands/migrations) with sql migration set wired
affects: [01-02 (DRM/protection + error), 01-03 (Publication/Locator/BookSource + schema), 01-04 (reading slice + bundled sample), 05 (BookSource migration)]

# Tech tracking
tech-stack:
  added: [tauri 2.11.5, tauri-plugin-sql 2.4.0 (sqlite), react 19.2.7, vite 7.3.6, typescript 5.9.3, foliate-js@78914ae, uuid, blake3, zip (deflate-only), thiserror]
  patterns: [cargo workspace with portable core, custom-protocol byte streaming (never IPC), registry-scoped resource resolution, exact-pin supply-chain baseline]

key-files:
  created: [Cargo.toml, core/Cargo.toml, core/src/lib.rs, core/src/{error,protection,locator,source}.rs, core/src/publication/mod.rs, src-tauri/src/{protocol,storage,commands,migrations}.rs, src-tauri/tests/protocol_range.rs, src/lib/pillow.ts, src/vendor/VENDOR-foliate-js.md, .gitmodules]
  modified: [src-tauri/src/lib.rs, src-tauri/Cargo.toml, src-tauri/tauri.conf.json, src-tauri/capabilities/default.json, package.json, src/App.tsx, index.html]

key-decisions:
  - "Built desktop with the installed MSVC Rust toolchain: the default GNU host toolchain's gcc silently fails (env defect)"
  - "Scoped zip to pure-Rust deflate (EPUB OCF needs only store+deflate) to avoid native lzma C compilation"
  - "Pinned TS/Vite/@vitejs-plugin-react to the plan-specified major lines (5/7/4), not the newest majors (7/8/6) which break the scaffold"
  - "Deferred tauri-plugin-fs / tauri-plugin-dialog to their consuming import plan to avoid unused-dependency surface; added tauri-plugin-sql now (migrations wired)"

patterns-established:
  - "Custom-protocol byte streaming: book bytes reach the WebView only via pillow://, never Tauri IPC (D-06)"
  - "Registry-scoped resolution: pillow:// resolves only registry-known ids; sanitize_id rejects path separators and .. traversal (T-01-01)"
  - "Supply-chain zero-trust: exact version pins (= for cargo, bare for npm), committed lockfiles, vendored pinned foliate-js"
  - "Pre-declared seam modules so downstream plans fill their own files without touching shared crate roots"

requirements-completed: []  # FND-01/FND-02 are advanced+unblocked here but complete in Plan 04 (need the end-to-end reading slice) — left Pending intentionally.

# Metrics
duration: 27min
completed: 2026-07-09
---

# Phase 1 Plan 01: Foundation & Cross-Platform Skeleton Summary

**Compiling cross-platform Tauri v2 Cargo workspace with a Range-aware `pillow://` byte-streaming protocol, the bundled sample pre-registered in a scope-guarded SourceRegistry, vendored pinned foliate-js, and exact-pinned deps with committed lockfiles.**

## Performance

- **Duration:** ~27 min
- **Started:** 2026-07-09T10:39:38Z
- **Completed:** 2026-07-09T11:06:34Z
- **Tasks:** 3
- **Files modified:** 58 (incl. one-time scaffold + 15 bundled icons)

## Accomplishments
- Refactored the `create-tauri-app` scaffold into a Cargo `[workspace]`: portable `pillowtome-core` (zero tauri/platform deps, off-device unit-testable) + `pillowtome` src-tauri glue crate.
- Wired the boundary rule that matters: a Range-aware `pillow://` async URI-scheme protocol answering 200/206/416 (1 MiB cap), reading only the requested slice from disk — book bytes never cross IPC (D-06).
- Pre-registered the bundled sample under id `"sample"` at Builder `.setup()` via `BaseDirectory::Resource` (BLOCKER-1 fix) so `pillow://.../sample` resolves the moment Plan 04 drops the file.
- Scope-guarded the protocol: `sanitize_id` rejects path separators and `..` traversal; only registry-known ids resolve (threat T-01-01).
- Vendored foliate-js as a pinned submodule (78914ae, MIT LICENSE retained); every dep exact-pinned with committed `Cargo.lock` + `pnpm-lock.yaml`; no floating ranges.
- Declared all core seam stubs + src-tauri stubs (with the sql migration set wired) so Plans 01-02/01-03 fill their own files without touching shared roots; built a 简体中文 React shell.

## Task Commits

Each task was committed atomically (all signed, Verified as SakuraRed):

1. **Task 1: Workspace + toolchain scaffold + pins + vendored foliate-js** - `8500164` (chore)
2. **Task 2: Core seam stubs + app config + 简体中文 React shell** - `93ec26d` (feat)
3. **Task 3: Range-aware pillow:// protocol + SourceRegistry + sample registration + CSP + URL helper** - `5fbe5fb` (feat)

## Files Created/Modified
- `Cargo.toml` - `[workspace] members = ["core", "src-tauri"]` + shared release profile.
- `core/Cargo.toml`, `core/src/lib.rs` - portable crate; declares error/protection/publication/locator/source seam modules.
- `core/src/{error,protection,locator,source}.rs`, `core/src/publication/mod.rs` - compiling seam placeholders (filled by 01-02/01-03).
- `src-tauri/src/protocol.rs` - `register_asynchronous_uri_scheme_protocol` handler + pure `parse_range` + `serve()`.
- `src-tauri/src/storage.rs` - `SourceRegistry` (`Mutex<HashMap<String,PathBuf>>`) + `sanitize_id` scope guard.
- `src-tauri/src/lib.rs` - Builder: pillow scheme registration, sql `add_migrations`, sample registration at setup.
- `src-tauri/src/{commands,migrations}.rs` - stubs (`migrations()`=`vec![]`, `SCHEMA_V1=""`).
- `src-tauri/tests/protocol_range.rs` - parse_range 200/206/416 + temp-fixture registry→protocol serve.
- `src-tauri/tauri.conf.json` - minSdk 26, bundle `assets/sample/*`, CSP with pillow forms in connect/img/media/style/font-src.
- `src-tauri/capabilities/default.json` - dropped `opener:default` (opener plugin removed).
- `src/lib/pillow.ts` - per-platform `pillowUrl()` (http/https/scheme).
- `src/App.tsx`, `index.html` - 简体中文 shell (lang=zh-CN), no book-bytes IPC.
- `package.json`, `Cargo.lock`, `pnpm-lock.yaml` - exact pins + committed lockfiles.
- `.gitmodules`, `src/vendor/VENDOR-foliate-js.md` - pinned foliate-js provenance.

## Decisions Made
- **MSVC toolchain for desktop builds:** the machine's default GNU Rust toolchain (`stable-x86_64-pc-windows-gnu`) has a broken `gcc.exe` (silent exit 1 even on trivial compiles / linking). The MSVC toolchain (`stable-x86_64-pc-windows-msvc` + BuildTools at `C:\BuildTools`) works; all builds/tests were run through a vcvars64 wrapper. See "Environment / follow-up".
- **zip → pure-Rust deflate only:** EPUB OCF archives use only Stored+Deflate, so `default-features = false, features = ["deflate"]` avoids the native lzma/bzip2/zstd C backends (which also failed to build) and shrinks supply-chain surface.
- **Version-line pinning over newest-major:** newest registry majors are TS 7 / Vite 8 / @vitejs/plugin-react 6 / zip 8, which break the plan-specified scaffold. Pinned exactly within the plan's major lines (TS 5.9.3, Vite 7.3.6, plugin-react 4.7.0, zip 2.4.2).
- **fs/dialog deferred:** `tauri-plugin-fs` / `tauri-plugin-dialog` are not used in Wave 1 (the protocol reads via `std::fs`); deferred to the import plan to avoid unused-dependency surface (global supply-chain baseline). `tauri-plugin-sql` added now because the migration set is wired now. `pillowtome-core` path dep added to `src-tauri` (deferred from Task 1).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] zip default features pulled a C-compiled lzma backend that failed to build**
- **Found during:** Task 1 (`cargo build --workspace`)
- **Issue:** `zip = "2.x"` default features build `lzma-sys` (native xz), whose `gcc` invocation failed.
- **Fix:** `zip = { version = "=2.4.2", default-features = false, features = ["deflate"] }` (pure Rust; all EPUB needs).
- **Files modified:** `core/Cargo.toml`
- **Verification:** `cargo build --workspace` green.
- **Committed in:** `8500164`

**2. [Rule 3 - Blocking] Host GNU Rust toolchain's gcc silently fails (env defect)**
- **Found during:** Task 1 (`cargo build --workspace`)
- **Issue:** default `stable-x86_64-pc-windows-gnu` toolchain uses `gcc.exe`, which exits 1 with no output on any compile/link (blake3 SIMD, final linking). Not fixable from within the plan.
- **Fix:** built desktop with the installed MSVC toolchain via a captured `vcvars64` wrapper (`RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc`). No repo-level toolchain pin committed (would be non-portable for Linux/macOS contributors).
- **Verification:** `cargo build --workspace`, `cargo test -p pillowtome-core`, `cargo test -p pillowtome --test protocol_range` all green under MSVC.
- **Committed in:** n/a (environment/build-shell config, not source)

**3. [Rule 3 - Blocking] Pinned zip 2.6.1 was yanked**
- **Found during:** Task 1
- **Issue:** crates.io max-stable zip 2.6.1 is yanked; resolution failed.
- **Fix:** pinned latest non-yanked 2.x → `=2.4.2`.
- **Committed in:** `8500164`

**4. [Rule 2 - Missing Critical] VENDOR provenance relocated to keep the submodule clean**
- **Found during:** Task 1
- **Issue:** a `VENDOR.md` inside `src/vendor/foliate-js/` would dirty the submodule (parent can't track files under a submodule path).
- **Fix:** recorded provenance at `src/vendor/VENDOR-foliate-js.md` (adjacent, parent-tracked) instead.
- **Committed in:** `8500164`

---

**Total deviations:** 4 (3 blocking, 1 structural). Plus scoped decisions above (version-line pinning, fs/dialog deferral, assets-under-src-tauri, opener kept through Task 1 then removed in Task 3).
**Impact on plan:** All necessary for a green build under a zero-trust pin policy on this machine. No feature scope creep — every plan artifact/acceptance gate satisfied.

## Issues Encountered
- **Broken host GNU gcc** (see deviation 2) is the only significant environment issue — resolved by using the MSVC toolchain. Future waves and the phase verifier MUST build desktop with MSVC (`C:\BuildTools\VC\Auxiliary\Build\vcvars64.bat` + `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc`) until the GNU toolchain is repaired. Android cross-compiles use NDK clang and are unaffected.

## Verification Evidence
- Task 1: `pnpm install --frozen-lockfile` exit 0; `cargo build --workspace` green; float-range grep clean; foliate-js pinned submodule, MIT LICENSE, not an npm dep.
- Task 2: `cargo test -p pillowtome-core` exit 0 (stub baseline); `pnpm build` exit 0; minSdk 26 + `assets/sample/*` set.
- Task 3: `cargo test -p pillowtome --test protocol_range` → 4/4 pass (parse_range 200/206/416 + temp-fixture serve 200/206 + 404 unknown + 404 traversal); all acceptance greps PASS (protocol registered, sample registered, CSP pillow forms in connect/img/media/style/font-src, `pillowUrl` exported, no book-bytes IPC command).

## Known Stubs
Intentional, plan-scoped stubs (documented in each file, resolved by the named plan):
- `core/src/{error,protection}.rs` — filled by Plan 01-02 (DRM detect-and-refuse, FND-04).
- `core/src/{publication/mod,locator,source}.rs` — filled by Plan 01-03 (Publication/Locator/BookSource, schema).
- `src-tauri/src/migrations.rs` (`migrations()`=`vec![]`, `SCHEMA_V1=""`) — filled by Plan 01-03.
- `src-tauri/assets/sample/PLACEHOLDER.md` — real `sample.epub` dropped by Plan 04; registry→protocol plumbing already live.

None of these block this plan's goal (foundation + byte-streaming boundary); each is required-later, not required-now.

## Next Phase Readiness
- Workspace compiles; core is off-device unit-testable; `pillow://` protocol + SourceRegistry + sample registration + CSP are live and tested.
- Plans 01-02 (protection/error) and 01-03 (Publication/Locator/BookSource + schema) are unblocked — their target files are declared stubs.
- FND-01/FND-02 (end-to-end EPUB open on desktop/Android) are **unblocked but not complete** — they need the Plan 04 reading slice + bundled `sample.epub`; left Pending intentionally.
- **Build note for verifier/future waves:** use the MSVC toolchain + vcvars for desktop builds (broken host GNU gcc).

## Self-Check: PASSED

All claimed files exist on disk and all three task commits are present in git history
(`8500164`, `93ec26d`, `5fbe5fb`).

---
*Phase: 01-foundation-cross-platform-skeleton*
*Completed: 2026-07-09*
