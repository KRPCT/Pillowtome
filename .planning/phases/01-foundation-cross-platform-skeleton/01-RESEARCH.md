# Phase 1: Foundation & Cross-Platform Skeleton - Research

**Researched:** 2026-07-09
**Domain:** Cross-platform Tauri v2 app bootstrap (desktop Win/macOS/Linux + Android), custom-protocol byte streaming, foliate-js EPUB render slice, storage-handle/SAF abstraction, SQLite schema stubs, DRM detect-and-refuse
**Confidence:** HIGH on scaffold / custom-protocol / SQLite / DRM-detect; **MEDIUM on Android SAF persistence and emulator end-to-end** (flagged inline)

## Summary

Everything the stack/architecture research already locked (Tauri v2 + React/Vite/TS + foliate-js MIT + SQLite via `tauri-plugin-sql` + Rust workspace with a portable `core`) is confirmed current as of 2026-07-09 and installable with the provisioned toolchain (Rust 1.95, tauri-cli 2.11.2, Node 22.15, pnpm 10.33.2, Java 25, NDK r27, Android targets installed). This phase is a **bootstrap + seam-stubbing** phase, not a feature phase: the goal is a proven cross-platform build, one bundled EPUB rendered end-to-end on desktop *and* the emulator, the opaque `BookSource` storage-handle, DRM detect-and-refuse, and the three day-1 Rust/SQL seams as minimal stubs.

Two areas carry real risk and drive the plan's `autonomous: false` markers. **(1) Android SAF persistence (FND-03):** Tauri's official `dialog` plugin returns `content://` URIs on Android and `fs` can read them *in-session*, but there is **no official folder picker and no `takePersistableUriPermission`** — persistence across restarts requires either the community `tauri-plugin-android-fs` crate (audit + pin required per supply-chain baseline) or a small native Kotlin plugin. **(2) Custom-protocol byte streaming:** Tauri v2's `register_asynchronous_uri_scheme_protocol` + Range-aware responder is the correct, documented mechanism (official `examples/streaming/main.rs`), but the custom-scheme URL format differs per platform and must be whitelisted in CSP.

**Primary recommendation:** Scaffold with `pnpm create tauri-app` (React/TS/pnpm), immediately refactor into a Cargo workspace (`core` + `src-tauri`), register a `pillow://` async URI-scheme protocol with HTTP Range support to feed a **vendored, pinned** foliate-js `<foliate-view>`, model all book access as an opaque `BookSource` enum, stub the schema with `tauri-plugin-sql` migrations, and implement DRM/corruption refusal as a pure-Rust `core` function that is unit-testable off-device. Keep the Android SAF-persistence task and the on-emulator E2E task non-autonomous.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Tauri v2 (`tauri` 2.11.x) — one app, one Rust core, desktop + Android.
- **D-02:** Frontend = React 19 + Vite + TypeScript in the WebView; foliate-js (MIT) vendored at a **pinned commit** as the EPUB render engine (React drives chrome only, not rendering).
- **D-03:** Repo layout = Tauri v2 app over a **Rust workspace**: platform-agnostic `core` crate + `src-tauri` glue crate + `src/` React/Vite frontend; foliate-js vendored under the frontend, pinned. Platform-specific glue isolated behind traits so `core` stays portable and unit-testable off-device.
- **D-04:** Use each platform's **system WebView** (no bundled Chromium in v1). Mitigate CJK divergence with runtime feature-detection + owned JS shim + golden-image harness (harness only *stubbed* in P1, exercised P3). Bundled Chromium is a documented escape hatch only.
- **D-05:** All book access via an opaque **storage-handle (`BookSource`)** in `core` — never a raw path. Desktop = filesystem path; Android = SAF content URI + persisted permission grant (`takePersistableUriPermission`, persisted across restarts). Import produces a handle; grants re-hydrated on launch.
- **D-06:** **Book bytes never cross Tauri IPC.** Small structured data crosses via IPC; large book bytes stream to foliate-js via a **custom protocol** (asset/`pillow://`).
- **D-07:** **Publication model** — Rust trait `Publication`. EPUB only implementor in P1; **stub + EPUB impl only**.
- **D-08:** **Composite self-healing Locator** — `{ work_id, cfi (or part+offset), progress_fraction, text_context }`; never a bare percentage. Type + persistence defined in P1.
- **D-09:** **Identity + change-log schema** — UUID (library item) + content hash + per-device append-only change-log with a logical clock. **SQLite via SQLx / `tauri-plugin-sql`** (one schema both platforms; NOT rusqlite). Schema stubs present-but-unsynced in P1.
- **D-10:** DRM = **detect-and-refuse** (Adobe ADEPT / Kindle / obfuscated); refuse with clear "unsupported"; never decrypt. Malformed/corrupt EPUBs **soft-fail** with a friendly error, no crash.
- **D-11:** Keep foliate-js MIT (pinned commit, attribution retained). Strict **clean-room boundary from AGPL Readest — do NOT copy Readest source.** License-audit every borrowed component. Clean-room discipline locked now.
- **D-12:** **minSdk 26 (Android 8.0)** baseline; NDK r27 (27.2.12479018), `NDK_HOME` set. CJK-CSS tracks System WebView version → feature-detect at runtime, not by API level.
- **D-13:** **Verification substitute (logged deviation):** no physical Android device — "real Android hardware" criterion satisfied via emulator (AVD `Medium_Phone_API_36.1`, API 36) for build+run; physical-device verification deferred. Desktop verified natively. Recorded for the verifier.

### Claude's Discretion
- Exact crate/module names, error types, `cargo tauri` scaffold flags, custom-protocol scheme name, and file layout within the above structure are implementation details for the planner/executor.

### Deferred Ideas (OUT OF SCOPE)
- Full reading UX/themes/pagination/TOC/search/custom fonts → Phase 2
- CJK typography (compression, autospace, kinsoku, fonts, fallback) + golden-image harness exercise → Phase 3
- SQLite library store, covers, metadata, sort/filter, real Publication impls beyond stub → Phase 4
- Annotations + full Locator use + change-log population → Phase 5
- TXT (later MOBI/PDF) Publication implementations → Phase 6
- WebDAV sync engine, conflict resolution, selective file sync → Phase 7
- Bundled fixed Chromium → escape hatch only
- **In P1 only the seams are stubbed — none of the above is built.**
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FND-01 | App launches + opens one EPUB end-to-end on desktop (Win/macOS/Linux) | Scaffold flow (§Standard Stack, Pattern 1); custom-protocol streaming (Pattern 3); foliate-js render slice (Pattern 4). Verifiable natively via `cargo tauri dev`/`build`. |
| FND-02 | App launches + opens one EPUB end-to-end on Android | `cargo tauri android init/dev/build` (Pattern 2); emulator run (D-13); same foliate-js slice in the Android System WebView. **MEDIUM** — emulator E2E is `autonomous: false`. |
| FND-03 | Import from device storage; Android SAF grant persists across restarts; via storage-handle, not raw paths | `BookSource` enum (Pattern 5); desktop `dialog.open`→path; Android `content://` + persisted grant. **MEDIUM** — persistence needs `tauri-plugin-android-fs` (audit) or native Kotlin; `autonomous: false`. |
| FND-04 | DRM-encrypted or corrupt book detected + refused cleanly, no crash, no decryption | Pure-`core` DRM detector reading `META-INF/encryption.xml` + `rights.xml` + zip validity (Pattern 6, §DRM). Fully unit-testable off-device (`autonomous: true`). |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| App/window lifecycle, plugin registration, custom-protocol registration | Platform Shell (`src-tauri`) | — | Tauri glue owns the runtime; only place a `pillow://` scheme can be registered. |
| Book byte streaming to WebView | Platform Shell (`src-tauri` protocol handler) | Filesystem/SAF | Bytes read from disk/URI and streamed via custom protocol; **never IPC**, never `core`-owned. |
| EPUB parse-for-render, pagination, CFI | WebView (foliate-js) | — | Render engine lives in the WebView; framework-agnostic web component. |
| Reader chrome / "open book" button / error card | WebView (React) | — | UI only; drives foliate-js and bridges its events. |
| `Publication` trait, `Locator` type, DRM/corruption detection, content hash | `core` (portable Rust) | — | Must be off-device unit-testable; no Tauri/platform deps. |
| Storage-handle (`BookSource`) model + resolution to bytes | `core` (model) | Platform Shell (SAF/path resolution shim) | Model is portable; the *resolution* of a SAF URI to bytes is platform glue behind a trait. |
| SQLite schema stubs + migrations | Platform Shell (`tauri-plugin-sql`) | `core` (types) | Plugin runs the DB on both platforms from one migration set; `core` defines the row types. |
| SAF picker + `takePersistableUriPermission` | Platform Shell (native Kotlin / community plugin) | — | Android-only native surface; no portable equivalent. |

## Standard Stack

### Core (all versions verified against npm / crates.io 2026-07-09)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `tauri` (crate) | 2.11.5 | App shell + Rust core for desktop + Android | Locked D-01; only family sharing core+renderer both targets `[VERIFIED: crates.io]` |
| `@tauri-apps/api` | 2.11.1 | JS ↔ Rust bridge, `convertFileSrc`, event API | Same 2.11 minor line as crate `[VERIFIED: npm registry]` |
| `@tauri-apps/cli` | 2.11.4 (installed CLI: `cargo tauri` 2.11.2) | Build/run/bundle + `android` subcommands | `[VERIFIED: npm registry]`; installed `cargo tauri` is 2.11.2 — compatible within 2.11 line |
| `react` / `react-dom` | 19.x | WebView chrome UI | Locked D-02 `[CITED: STACK.md]` |
| `vite` | 6.x/7.x | Dev server + static SPA build | Locked D-02 `[CITED: STACK.md]` |
| `typescript` | 5.x | Type safety | Locked D-02 |
| foliate-js | **vendor pinned git SHA** (npm `foliate-js@1.0.1` exists as identity check) | EPUB parse + render in WebView | Locked D-02; author warns API unstable → vendor a commit, do not track npm range `[VERIFIED: npm registry / CITED: STACK.md]` |
| `tauri-plugin-sql` (crate) | 2.4.0 | SQLite (SQLx-backed) migrations both platforms | Locked D-09 `[VERIFIED: crates.io]` |
| `@tauri-apps/plugin-sql` | 2.4.0 | JS binding to the SQLite DB | `[VERIFIED: npm registry]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@tauri-apps/plugin-fs` + `tauri-plugin-fs` | 2.5.1 (js) | Read book bytes from path/`content://` URI | Import + protocol handler reads the file `[VERIFIED: npm registry]` |
| `@tauri-apps/plugin-dialog` + `tauri-plugin-dialog` | 2.7.1 (js) | File picker (returns path on desktop, `content://` on Android) | Import single book file `[VERIFIED: npm registry]` |
| `uuid` (crate) | 1.x | `work_id` generation | Identity seam (D-09) `[ASSUMED]` |
| `blake3` (crate) | 1.x | Content hash for dedup identity | Publication `content_hash` (D-09) `[ASSUMED]` |
| `zip` **or** `async_zip` (crate) | latest | Read `META-INF/encryption.xml` for DRM detect | Pure-`core` DRM detector (FND-04) `[ASSUMED]` |
| `serde` / `serde_json` (crate) | 1.x | Serialize metadata/locators across IPC | Always `[CITED: STACK.md]` |
| `thiserror` (crate) | 1.x/2.x | Typed `core` error enum for soft-fail | DRM/corrupt error surfacing `[ASSUMED]` |

### Android SAF (choose one — see §Common Pitfalls #3)
| Option | Version | Tradeoff |
|--------|---------|----------|
| `tauri-plugin-android-fs` (community, aiueo13) | crate 1.0.0 | Provides SAF picker + persisted-URI permission out of the box. **Community, 36★, no GitHub releases, MIT/Apache. MUST audit + pin per supply-chain baseline.** Fastest path. |
| Native Kotlin plugin (hand-written) | — | Full control, no third-party trust surface; more work (Kotlin: `ACTION_OPEN_DOCUMENT[_TREE]` + `takePersistableUriPermission`). Aligns with global CLAUDE.md "prefer local code over new third-party packages." |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Async URI-scheme protocol | Synchronous `register_uri_scheme_protocol` | Blocks the main thread on large reads — use async for book bytes. |
| foliate-js npm 1.0.1 | Vendored pinned commit | D-02 mandates pinned commit (author warns API unstable); npm range forbidden by supply-chain baseline. |
| `tauri-plugin-sql` migrations | SQLx-in-`core` directly | P1 avoids linking two SQLite bindings (symbol-clash risk, see §Pitfalls #6). Use plugin migrations in P1; add SQLx-in-core later only if core needs heavy DB logic. |

**Installation:**
```bash
# Scaffold (choose React, TypeScript, pnpm)
pnpm create tauri-app@latest pillowtome
# Rust android targets already installed (verified): aarch64/armv7/i686/x86_64-linux-android

# Frontend
pnpm add @tauri-apps/api@2.11.1 @tauri-apps/plugin-sql@2.4.0 @tauri-apps/plugin-fs@2.5.1 @tauri-apps/plugin-dialog@2.7.1
pnpm add -D @tauri-apps/cli@2.11.4 typescript@5 vite

# foliate-js: vendor a pinned commit, do NOT add as npm dep
#   git submodule add https://github.com/johnfactotum/foliate-js src/vendor/foliate-js
#   git -C src/vendor/foliate-js checkout <PINNED_SHA>   # record SHA + retain MIT LICENSE

# src-tauri/Cargo.toml (exact pins, commit Cargo.lock):
#   tauri = "2.11.5"
#   tauri-plugin-sql = { version = "2.4.0", features = ["sqlite"] }
#   tauri-plugin-fs = "2"      ; tauri-plugin-dialog = "2"
#   serde = { version = "1", features = ["derive"] } ; serde_json = "1" ; thiserror = "2"
# core/Cargo.toml:
#   uuid = { version = "1", features = ["v4"] } ; blake3 = "1" ; zip = "2" ; thiserror = "2" ; serde = { version="1", features=["derive"] }
```

**Version verification:** `@tauri-apps/*` and foliate-js verified via `npm view` on 2026-07-09; `tauri` 2.11.5, `tauri-plugin-sql` 2.4.0, `sqlx` 0.9.0 verified via crates.io. `sqlx` bumped from STACK.md's 0.8.6 to **0.9.0** — but P1 uses the plugin, not direct SQLx, so this is not a P1 blocker (revisit when SQLx-in-core lands, Phase 4/5).

## Package Legitimacy Audit

| Package | Registry | Age (publish) | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|---------------|-----------|-------------|---------|-------------|
| `@tauri-apps/api` | npm | 2026-06-17 | 1.80M/wk | github.com/tauri-apps/tauri | SUS ("too-new") | **Approved** — official org, 1.8M dl; "too-new" = recent 2.11 minor, not slop |
| `@tauri-apps/cli` | npm | 2026-06-28 | 1.51M/wk | github.com/tauri-apps/tauri | SUS ("too-new") | **Approved** — same rationale |
| `@tauri-apps/plugin-sql` | npm | 2026-04-04 | 50k/wk | github.com/tauri-apps/plugins-workspace | OK | Approved |
| `@tauri-apps/plugin-fs` | npm | 2026-05-02 | 322k/wk | tauri-apps/plugins-workspace | OK | Approved |
| `@tauri-apps/plugin-dialog` | npm | 2026-05-02 | 800k/wk | tauri-apps/plugins-workspace | OK | Approved |
| foliate-js | npm | 2025-04-21 | 1.6k/wk | github.com/johnfactotum/foliate-js | OK | Approved (MIT; low dl expected — niche engine; **vendor pinned commit, not npm dep**) |
| `tauri`, `tauri-plugin-sql`, `sqlx`, `uuid`, `blake3`, `zip` | crates.io | current | n/a (sandbox blocked crates.io downloads API) | official/well-known | ASSUMED-OK | Approved — official Tauri org + top-tier crates; planner should re-run `cargo`-side legitimacy check when network available |
| `tauri-plugin-android-fs` | crates.io | 1.0.0 | unknown (36★, no releases) | github.com/aiueo13/tauri-plugin-android-fs | **SUS** | **Flagged** — community, low stars, no releases. If chosen for FND-03, planner MUST add `checkpoint:human-verify` before install + pin exact rev/SHA + audit Kotlin source |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `tauri-plugin-android-fs` (only if the plan chooses the plugin path over native Kotlin — gate behind `checkpoint:human-verify`). The official `@tauri-apps/*` "too-new" flags are false positives (official org, millions of weekly downloads).

## Architecture Patterns

### System Architecture Diagram
```
[User clicks "Open bundled EPUB"] (React chrome, WebView)
        │  invoke IPC command  ─────────────────────────────┐
        ▼                                                    ▼
[React builds pillow:// URL for the book]        [src-tauri command: resolve BookSource → file path/URI]
        │                                                    │
        │  <foliate-view>.open(Blob from fetch(pillow://…))  │  (DRM/corrupt pre-check in core BEFORE serving)
        ▼                                                    ▼
[fetch("pillow://localhost/<id>")] ──Range GET──► [async URI-scheme protocol handler (src-tauri)]
        │                                                    │  reads bytes from disk / content:// via fs
        │  206 Partial Content (bytes streamed, ≤1MB/range)  │
        ▼                                                    │
[zip.js/foliate-js parses EPUB sections] ◄───────────────────┘
        │  paginate (CSS multi-column) → render one page
        ▼
[relocate event → progress] ──IPC (small data)──► [core: build Locator stub, persist via tauri-plugin-sql]
                                                          │
                                                          ▼
                                        [SQLite in app_data_dir (desktop + Android)]

DRM/corrupt path: [import file] → core::detect_protection(bytes) →
     if encrypted/ADEPT/corrupt → return typed error → React shows "unsupported / damaged" card (no crash, no serve)
```

### Recommended Project Structure (matches D-03 / ARCHITECTURE.md)
```
pillowtome/
├── Cargo.toml                # [workspace] members = ["core", "src-tauri"]
├── package.json  vite.config.ts  tsconfig.json  pnpm-lock.yaml
├── core/                     # portable Rust — NO tauri/platform deps, unit-testable off-device
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs
│       ├── publication/mod.rs   # trait Publication + Format enum (STUB + epub detect)
│       ├── locator.rs           # composite Locator type (STUB)
│       ├── source.rs            # BookSource enum (storage-handle)
│       ├── protection.rs        # DRM/corruption detect-and-refuse (FND-04, testable)
│       └── error.rs             # thiserror CoreError (Unsupported / Drm / Corrupt / …)
├── src-tauri/                # Tauri glue crate
│   ├── Cargo.toml
│   ├── tauri.conf.json       # CSP, custom-protocol allowlist, min-sdk, bundle
│   ├── build.rs
│   ├── capabilities/*.json   # fs/dialog/sql permissions
│   ├── src/
│   │   ├── main.rs / lib.rs  # register pillow:// async protocol + plugins + commands
│   │   ├── protocol.rs       # Range-aware byte streamer
│   │   ├── commands.rs       # thin IPC → core
│   │   ├── storage.rs        # BookSource → bytes (path vs SAF), platform-gated
│   │   └── migrations.rs     # tauri-plugin-sql Migration set (schema stubs)
│   └── gen/android/          # generated by `cargo tauri android init`
├── src/                      # React/Vite/TS frontend
│   ├── main.tsx  App.tsx     # "open bundled EPUB" + error card
│   ├── reader/FoliateView.tsx
│   └── vendor/foliate-js/    # pinned MIT commit (submodule) + LICENSE retained
└── assets/sample/*.epub      # one bundled DRM-free sample for FND-01/02
```

### Pattern 1: Cargo workspace over the Tauri scaffold
**What:** `create-tauri-app` emits a single `src-tauri` crate. Convert the repo root `Cargo.toml` into `[workspace] members = ["core", "src-tauri"]`, add `core = { path = "../core" }` to `src-tauri`. `core` has zero Tauri deps so it compiles and unit-tests on the host without a device or WebView.
**When to use:** Immediately after scaffold, before any code.
**Why:** D-03 portability + off-device testability of DRM/Publication/Locator. Android cross-compiles `core` via NDK unchanged.

### Pattern 2: Android build + emulator run (Tauri 2.11)
```bash
# One-time: ensure env is exported (see Environment Availability — currently EMPTY in the build shell)
export ANDROID_HOME=<sdk>   NDK_HOME=<ndk r27>
cargo tauri android init          # generates src-tauri/gen/android (Gradle project)
# set minSdk 26 in gen/android build.gradle.kts (or tauri.conf.json > bundle.android.minSdkVersion)
emulator -avd Medium_Phone_API_36.1 &     # start provisioned AVD (API 36)
cargo tauri android dev           # builds, installs, runs on the running emulator, live-reload
cargo tauri android build --apk   # release/verification artifact
```
**Gotchas (2025–2026, verified):** (a) `ANDROID_HOME`/`NDK_HOME` must be visible to the build shell — **both are empty in this environment's shell** (§Environment Availability); (b) every plugin must declare Android support — the ones chosen (`fs`, `sql`, `dialog`) do; (c) Android custom-protocol URL uses **`https://<scheme>.localhost`**, not `<scheme>://` (see Pattern 3); (d) System WebView version, not API level, gates CSS — irrelevant to P1's plain render but relevant to feature-detection stub.

### Pattern 3: Range-aware custom protocol (book bytes, never IPC)
**What:** Register an async URI-scheme protocol; read the `range` request header; respond `200` (full) / `206 Partial Content` (`Content-Range: bytes s-e/len`) / `416`. Official reference: `tauri-apps/tauri/examples/streaming/main.rs` (caps each range at 1 MB `MAX_LEN`, supports `multipart/byteranges`).
```rust
// src-tauri: register on the Builder
tauri::Builder::default()
  .register_asynchronous_uri_scheme_protocol("pillow", move |_ctx, request, responder| {
      // 1. parse book id from request.uri()
      // 2. resolve BookSource -> bytes source (path or content:// via fs)
      // 3. read "range" header; build http::Response with 200/206/416 + Content-Range/Content-Length
      // 4. responder.respond(response)   // responds once, consumes self
  })
  // ...plugins, commands
```
**Platform URL format (critical):** Windows `http://pillow.localhost/…`, **Android `https://pillow.localhost/…`**, macOS/Linux `pillow://localhost/…`. Build the URL per-platform (or centralize a helper); do not hard-code one form.
**CSP implications:** `tauri.conf.json > app.security.csp` must whitelist the scheme where foliate-js fetches it. Add the per-platform host to `connect-src` (and `img-src`/`media-src`/`style-src`/`font-src` since EPUB resources load through it), e.g. `connect-src 'self' ipc: http://ipc.localhost http://pillow.localhost https://pillow.localhost pillow:` . Missing CSP entries surface as silent fetch failures.
**Why (D-06):** bytes stream directly to the WebView; IPC carries only metadata/locators. Reversing this is the "Lithium trap."

### Pattern 4: foliate-js minimal open→paginate slice
**What:** Import the vendored `view.js`, create a `<foliate-view>`, call `open()` with a `Blob`/`File` obtained by `fetch`-ing the `pillow://` URL.
```ts
import './vendor/foliate-js/view.js'          // defines <foliate-view> custom element
const view = document.createElement('foliate-view')
container.append(view)
const res  = await fetch(pillowUrl)           // bytes over custom protocol, NOT IPC
const blob = await res.blob()
await view.open(new File([blob], 'sample.epub'))   // File/Blob/URL all accepted
view.addEventListener('relocate', e => {/* e.detail.fraction, e.detail.cfi → IPC to core */})
view.renderer?.next()                          // paginate one page (proves render pipeline)
```
**P1 scope:** open + render + one page-turn is enough to prove FND-01/02. Full chrome (modes/themes/TOC/search) is Phase 2.
**Note (MEDIUM):** For the P1 slice, fetching the whole EPUB into a Blob is acceptable (small bundled sample; still travels via custom protocol, not IPC). True *ranged/random-access* loading (zip.js reading only needed entries via Range) is an optimization deferred to Phase 2 — the Range-capable protocol from Pattern 3 already supports it.

### Pattern 5: Opaque storage-handle (`BookSource`)
```rust
// core/src/source.rs — portable model
pub enum BookSource {
    Path(std::path::PathBuf),   // desktop
    ContentUri(String),         // Android SAF content:// URI (+ persisted grant flag)
}
```
- **Desktop import:** `dialog.open()` → filesystem path → `BookSource::Path`.
- **Android import:** `dialog.open()` returns a `content://` URI; `fs` reads it **in-session**. Wrap as `BookSource::ContentUri`.
- **Persistence across restarts (FND-03, the hard part):** the OS grant from a plain `dialog.open` is **not** persisted — reopening after restart fails. Persisting requires `takePersistableUriPermission` (native SAF), provided by `tauri-plugin-android-fs` **or** a hand-written Kotlin plugin. Re-hydrate grants on launch.
**Why:** D-05 — never a raw path; Android scoped storage makes paths meaningless (Pitfall #9 / #3 below).

### Anti-Patterns to Avoid
- **Shipping book bytes over IPC** (D-06 violation) — doubles memory, stalls the bridge. Use the custom protocol.
- **Raw file paths in `core`/DB** — breaks on Android scoped storage. Use `BookSource`.
- **Tracking foliate-js via floating npm range** — author warns API breaks; violates supply-chain baseline. Vendor a pinned commit.
- **Copying Readest (AGPL) source** — license contagion (D-11). Reference architecture only.
- **Linking two SQLite bindings** (`tauri-plugin-sql`'s SQLx + a separate `rusqlite`/`sqlx`) in P1 — `libsqlite3-sys` symbol clash. Single binding.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| EPUB parsing / pagination / CFI | Custom OPF/OCF parser + paginator | foliate-js (vendored) | CFI, reflow, RTL, CJK edge cases are a multi-year tar pit (Pitfall #5 in ARCHITECTURE anti-patterns) |
| Range/byte streaming to WebView | Custom HTTP server | `register_asynchronous_uri_scheme_protocol` + `examples/streaming` pattern | Official, handles 206/416/multipart |
| SQLite migrations both platforms | Manual schema SQL runner | `tauri-plugin-sql` `Migration` set (transactional) | Runs identically desktop + Android, in app_data_dir |
| SAF persistence | Reinvent scoped-storage handling | `tauri-plugin-android-fs` (audited) or thin native Kotlin | `takePersistableUriPermission` semantics + dual-URI directory model are subtle |
| Content identity hash | Custom checksum | `blake3` | Fast, standard, stable across platforms |

**Key insight:** P1's job is to *wire* proven components correctly and stub seams — almost nothing here should be original algorithm work. The only bespoke code is the `BookSource` model, the DRM-detect function, and the seam type stubs.

## Runtime State Inventory

> Greenfield repo (only `.planning/` exists). Not a rename/refactor phase. **This section is informational** — P1 *creates* runtime state that later phases must track.

| Category | Items (created in P1) | Action Required |
|----------|------------------------|------------------|
| Stored data | SQLite DB in `app_data_dir` (schema stubs, unsynced) | None now — schema versioned via migrations from v1 |
| Live service config | None | None |
| OS-registered state | Android SAF persisted URI grants (if FND-03 persistence implemented) | Re-hydrate grants on launch; treat as durable OS state |
| Secrets/env vars | `ANDROID_HOME`, `NDK_HOME` (build-time only) | Ensure exported in build shell (currently empty here) |
| Build artifacts | `src-tauri/gen/android/` (generated), `target/`, `dist/` | Git-ignore generated Android project except intentional edits (minSdk) |

## Common Pitfalls

### Pitfall 1: Custom-protocol URL format assumed uniform across platforms
**What goes wrong:** Hard-coding `pillow://localhost/…` works on macOS/Linux but the fetch 404s/fails on Windows (`http://pillow.localhost`) and Android (`https://pillow.localhost`).
**Why:** Each WebView handles custom schemes differently; Windows/Android require http(s)+localhost host.
**How to avoid:** Build the URL per-platform (detect via `@tauri-apps/plugin-os` or a compile-time helper); whitelist all forms in CSP.
**Warning signs:** "Open EPUB" works on dev desktop, blank/failed fetch on Android.

### Pitfall 2: CSP blocks the book fetch silently
**What goes wrong:** `<foliate-view>.open(fetch(pillow://…))` yields an empty/failed response with no obvious error.
**How to avoid:** Add the scheme host to `connect-src` **and** resource directives (`img-src`, `media-src`, `style-src`, `font-src`) because EPUB internal resources also load through the render pipeline.

### Pitfall 3: Android SAF grant not persisted → import "forgets" the book after restart (FND-03)
**What goes wrong:** `dialog.open` returns a usable `content://` URI, import looks done, but after an app restart the URI is no longer accessible.
**Why:** The transient grant is not persisted; only `takePersistableUriPermission` survives reboots, and no official Tauri plugin calls it (issue #14587 → plugins-workspace #933, open).
**How to avoid:** Use `tauri-plugin-android-fs` (audit + pin) or a native Kotlin plugin; re-hydrate persisted grants at launch. **Verify on the emulator by force-stopping + relaunching.**
**Warning signs:** Works in the same session, fails after kill/relaunch.

### Pitfall 4: DRM detection misclassifies font-obfuscation as content DRM (FND-04)
**What goes wrong:** Refusing every EPUB that has a `META-INF/encryption.xml` — but that file is *also* present for legitimate IDPF/Adobe **font obfuscation** (reversible, key derived from the EPUB's own uid), which is not DRM.
**Why:** `encryption.xml` covers three cases: font obfuscation (OK to render), algorithm encryption, and retailer content DRM.
**How to avoid:** Parse `encryption.xml`; classify by `EncryptionMethod/@Algorithm` and which files are encrypted. If only fonts are obfuscated via the IDPF/Adobe algorithms → *not* DRM (P1 may still refuse-with-message or render without fonts; refuse-cleanly is acceptable for P1). Presence of `META-INF/rights.xml` (ADEPT) or content resources encrypted with unknown/retailer algorithms → **refuse**. Kindle (`.azw/.kfx`) isn't an EPUB container — detect by magic bytes and refuse.
**Warning signs:** All obfuscated-font books rejected, or all encrypted books wrongly opened.

### Pitfall 5: Malformed EPUB crashes the app instead of soft-failing (FND-04)
**How to avoid:** Wrap parse/detect in a typed `Result`; a bad zip / missing `container.xml` returns `CoreError::Corrupt`, surfaced as an error card — never a panic. Build a tiny torture fixture (truncated zip, missing mimetype) into `core` unit tests now (full corpus is Phase 2).

### Pitfall 6: Two SQLite bindings linked → `libsqlite3-sys` symbol clash
**How to avoid:** P1 uses only `tauri-plugin-sql`. Do not also add `rusqlite` or a second `sqlx` link. (SQLx 0.9 loosens `libsqlite3-sys` ranges, but avoid the situation entirely in P1.)

### Pitfall 7: Emulator ≠ physical device (D-13 logged deviation)
**What goes wrong:** Emulator System WebView / storage behavior can differ from real hardware; treating emulator green as full FND-02/03 proof.
**How to avoid:** Record the deviation (already in D-13); keep physical-device verification as a deferred item; mark emulator-dependent tasks `autonomous: false`.

## Code Examples

### DRM / corruption detect-and-refuse (pure `core`, unit-testable — FND-04)
```rust
// core/src/protection.rs
pub enum Protection { None, FontObfuscationOnly, ContentDrm(&'static str), Unknown }

/// Reads the EPUB zip WITHOUT decrypting anything.
pub fn detect_protection(epub_bytes: &[u8]) -> Result<Protection, CoreError> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(epub_bytes))
        .map_err(|_| CoreError::Corrupt)?;                 // bad zip → soft-fail
    // ADEPT marker
    if zip.by_name("META-INF/rights.xml").is_ok() {
        return Ok(Protection::ContentDrm("Adobe ADEPT"));
    }
    match zip.by_name("META-INF/encryption.xml") {
        Err(_) => Ok(Protection::None),                    // no encryption.xml → plaintext
        Ok(mut f) => {
            let mut xml = String::new();
            std::io::Read::read_to_string(&mut f, &mut xml).map_err(|_| CoreError::Corrupt)?;
            Ok(classify_encryption(&xml))                  // font-obf algos → FontObfuscationOnly
        }                                                  // else → ContentDrm/Unknown
    }
}
```

### `tauri-plugin-sql` schema-stub migration (D-09, both platforms)
```rust
// src-tauri/src/migrations.rs
use tauri_plugin_sql::{Migration, MigrationKind};
pub fn migrations() -> Vec<Migration> {
  vec![Migration {
    version: 1,
    description: "seed_stub_schema",
    kind: MigrationKind::Up,
    sql: r#"
      CREATE TABLE work (
        work_id       TEXT PRIMARY KEY,   -- UUID (stable identity)
        content_hash  TEXT NOT NULL,      -- blake3 (dedup identity, KOReader-interop later)
        format        TEXT NOT NULL,
        created_at     INTEGER NOT NULL
      );
      CREATE TABLE locator (              -- composite self-healing locator (D-08 stub)
        work_id       TEXT NOT NULL REFERENCES work(work_id),
        cfi           TEXT,               -- primary anchor (EPUB CFI) or part+offset
        progress_fraction REAL,           -- 0..1, always present
        text_pre TEXT, text_exact TEXT, text_post TEXT,
        updated_at    INTEGER NOT NULL
      );
      CREATE TABLE change_log (           -- per-device append-only log (D-09 stub, unsynced)
        id         TEXT PRIMARY KEY,      -- UUID
        device_id  TEXT NOT NULL,
        logical_clock INTEGER NOT NULL,   -- monotonic per device
        entity     TEXT NOT NULL, op TEXT NOT NULL, payload TEXT,
        created_at INTEGER NOT NULL
      );
    "#,
  }]
}
// registered: tauri_plugin_sql::Builder::default().add_migrations("sqlite:pillow.db", migrations())
```
DB path resolves under `app_data_dir` on both desktop and Android (plugin forces appData); no per-platform path code needed.

### Publication trait + Locator (seam stubs — D-07/D-08)
```rust
// core/src/publication/mod.rs
pub enum Format { Epub /* Txt, Mobi, Pdf later */ }
pub trait Publication {
    fn format(&self) -> Format;
    fn content_hash(&self) -> String;         // blake3 hex
    // metadata()/toc()/cover()/section_sizes() land in Phase 4 — kept minimal in P1
}
// core/src/locator.rs
pub struct Locator {
    pub work_id: uuid::Uuid,
    pub cfi: Option<String>,
    pub progress_fraction: f64,
    pub text_context: TextContext,   // { pre, exact, post }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `register_uri_scheme_protocol` (sync) | `register_asynchronous_uri_scheme_protocol` | Tauri 2.x | Non-blocking large-file streaming; use async for book bytes |
| Windows custom `tauri://` scheme | `http://<scheme>.localhost` on Windows/Android | Tauri 2.x | Per-platform URL + CSP handling required |
| `sqlx` 0.8.6 (STACK.md) | `sqlx` 0.9.0 | 2026 | Not a P1 concern (plugin used); revisit for SQLx-in-core |
| rusqlite for mobile | `tauri-plugin-sql` (SQLx) | Tauri v2 | One binding both platforms; avoid dual-link |

**Deprecated/outdated:**
- Tracking foliate-js by npm range — author explicitly warns the API may break; vendor a pinned commit.
- Assuming raw file paths cross-platform — Android scoped storage forbids it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `tauri-plugin-android-fs` correctly implements `takePersistableUriPermission` and works with Tauri 2.11 | SAF options | FND-03 persistence path invalid → fall back to native Kotlin (more effort). Gate behind `checkpoint:human-verify`. |
| A2 | `uuid`/`blake3`/`zip`/`thiserror` crate versions (marked ASSUMED) are current + compatible | Supporting stack | Minor — re-verify `cargo add` at plan time when crates.io reachable |
| A3 | crates.io versions for `tauri`/`tauri-plugin-sql`/`sqlx` (verified via WebFetch of crates.io API, but the cargo-side legitimacy seam couldn't run — sandbox blocked crates.io) | Package audit | Low — cross-checked against official Tauri release notes |
| A4 | Font-obfuscation-only EPUBs may be refused-with-message in P1 rather than rendered | DRM (Pitfall 4) | If product wants obfuscated-font books to render, P1's refuse-clean is a UX gap → revisit; acceptable for P1 per D-10 |
| A5 | Fetching whole bundled EPUB into a Blob (not ranged) is acceptable for the P1 slice | Pattern 4 | Fine for small sample; large real books need ranged loading (Phase 2) |

## Open Questions

1. **SAF persistence implementation choice (plugin vs native Kotlin)**
   - Known: official plugins don't persist grants; both a community crate and native Kotlin can.
   - Unclear: whether `tauri-plugin-android-fs` is trustworthy/maintained enough for the supply-chain baseline.
   - Recommendation: planner spikes both in one non-autonomous task; prefer native Kotlin if the audit of the community plugin is unsatisfying (global CLAUDE.md: "prefer local code over new third-party packages when small and auditable").
2. **Depth of DRM detection in P1**
   - Known: `encryption.xml` + `rights.xml` presence detection is straightforward and unit-testable.
   - Unclear: how far to classify (font-obf vs content DRM vs Kindle magic bytes) in P1 vs deferring nuance to Phase 6.
   - Recommendation: implement the three-way `Protection` classification now (cheap), refuse content DRM + Kindle, and either refuse or render font-obf-only (planner's call, both satisfy D-10).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust + cargo | All Rust build | ✓ | 1.95.0 | — |
| Tauri CLI (`cargo tauri`) | Build/run/android | ✓ | 2.11.2 | — |
| Node | Frontend build | ✓ | 22.15.0 | — |
| pnpm | JS deps | ✓ | 10.33.2 | — |
| Java (JDK) | Android/Gradle | ✓ | 25.0.2 | — |
| Rust android targets | `android build` | ✓ | aarch64/armv7/i686/x86_64-linux-android | — |
| Android emulator + AVD | FND-02/03 verify | ✓ (per D-13) | `Medium_Phone_API_36.1` API 36 | Physical device (deferred) |
| NDK r27 | Android cross-compile | ✓ (installed per context) | 27.2.12479018 | — |
| `ANDROID_HOME` env | android init/dev/build | **✗ in build shell** | empty | Export before Android tasks |
| `NDK_HOME` env | android cross-compile | **✗ in build shell** | empty | Export before Android tasks |
| Physical Android device | "real hardware" criterion | ✗ | — | **Emulator (D-13 logged deviation)** |
| crates.io downloads API | cargo legitimacy seam | ✗ (sandbox-blocked) | — | Re-run `cargo`-side checks when network-open |

**Missing dependencies with no fallback:** none blocking.
**Missing with fallback:** `ANDROID_HOME`/`NDK_HOME` empty in the automation shell — the executor MUST export them (they are set in the user env per context) before any `cargo tauri android *` task; physical device → emulator (D-13).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Rust `cargo test` (for `core`) + Vitest (frontend, if any logic) — **none configured yet (Wave 0)** |
| Config file | none — greenfield (Wave 0 creates `core/tests/`, optional `vitest.config.ts`) |
| Quick run command | `cargo test -p pillowtome-core` |
| Full suite command | `cargo test --workspace && pnpm test` (+ manual desktop/emulator smoke) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FND-01 | Desktop launch + open bundled EPUB renders a page | smoke (manual + `cargo tauri dev`) | `cargo tauri dev` then open sample | ❌ Wave 0 (bundled sample + slice) |
| FND-02 | Android emulator launch + open bundled EPUB renders | smoke (manual, emulator) | `cargo tauri android dev` on running AVD | ❌ Wave 0 — **autonomous: false** |
| FND-03 | Import via storage-handle; SAF grant persists across restart | integration (emulator, manual restart) | import → force-stop → relaunch → reopen | ❌ Wave 0 — **autonomous: false** |
| FND-04 | DRM/corrupt detected + refused, no crash | unit (off-device) | `cargo test -p pillowtome-core protection::` | ❌ Wave 0 — **autonomous: true** |
| Seams | Publication/Locator/schema stubs compile + migrate | unit + migration | `cargo test --workspace`; app boot runs migrations | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cargo test -p pillowtome-core` (fast, off-device) + `cargo build --workspace`.
- **Per wave merge:** `cargo test --workspace` + `cargo tauri build` (desktop) green.
- **Phase gate:** desktop E2E (FND-01) + emulator E2E (FND-02/03, manual, D-13) + FND-04 unit suite green before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `core/tests/protection.rs` — covers FND-04 (encryption.xml/rights.xml/corrupt-zip fixtures)
- [ ] `assets/sample/*.epub` — one small DRM-free sample bundled for FND-01/02
- [ ] `core/tests/fixtures/` — tiny EPUBs: clean, ADEPT-marked, font-obfuscated, truncated/corrupt
- [ ] Framework install: `cargo test` is built-in; add Vitest only if frontend logic needs it
- [ ] Migration smoke: assert `pillow.db` migrates to version 1 on first boot

## Security Domain

> `security_enforcement: true`, `security_asvs_level: 1` in config — section required.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Custom-protocol boundary + `core`/glue separation; bytes-not-IPC rule documented |
| V5 Validation/Encoding | yes | Validate EPUB zip entries; **zip-slip guard** (normalize `../` paths) even in P1 detect path |
| V6 Cryptography | yes (boundary) | **Never** implement decryption (D-10); detect-and-refuse only |
| V12 Files/Resources | yes | Untrusted EPUB bytes: read-only parse, jailed extraction, no path traversal |
| V14 Config | yes | Strict CSP; custom-protocol allowlist minimal; disable JS in book content webview (Phase 2 hardening, note now) |
| V2 Auth / V3 Session / V4 Access | no | No auth/session/multi-user in P1 (WebDAV creds are Phase 7) |

### Known Threat Patterns for Tauri v2 + WebView + untrusted EPUB
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Zip-slip from malformed EPUB (`../` entries) | Tampering | Normalize/validate every archive entry; jailed dir; reject traversal |
| Malicious EPUB HTML/JS executing in render context | Elevation/Info-disclosure | Strict CSP; block remote resource loads from book content; (Phase 2) sanitize/disable JS in book iframe |
| DRM circumvention pulled in | Legal/Repudiation | Detect-and-refuse only; no decrypt libs linked (D-10, D-11) |
| Over-broad custom-protocol scope | Info-disclosure | Protocol resolves only registered `work_id`s to their bytes; no arbitrary path read |
| Supply-chain (community `tauri-plugin-android-fs`, floating foliate-js) | Tampering | Pin exact commit/rev; audit; `checkpoint:human-verify`; committed `Cargo.lock`/`pnpm-lock.yaml` |

## Sources

### Primary (HIGH confidence)
- [Tauri streaming example — examples/streaming/main.rs](https://github.com/tauri-apps/tauri/blob/dev/examples/streaming/main.rs) — Range-aware async URI-scheme protocol (200/206/416, 1MB cap, multipart).
- [Tauri CSP docs](https://v2.tauri.app/security/csp/) + [custom protocol http-scheme commit](https://github.com/tauri-apps/tauri/commit/4cb51a2d56cfcae0749062c79ede5236bd8c02c2) — per-platform URL format + `connect-src` config.
- [Tauri SQL plugin](https://v2.tauri.app/plugin/sql/) + [plugins-workspace #1653 (DB location)](https://github.com/tauri-apps/plugins-workspace/issues/1653) — migrations, app_data_dir on Android.
- [foliate-js README](https://github.com/johnfactotum/foliate-js) — `<foliate-view>`, `open()`, `relocate`, `goTo`.
- npm registry (`npm view`, 2026-07-09) — `@tauri-apps/api` 2.11.1, `/cli` 2.11.4, `/plugin-sql` 2.4.0, `/plugin-fs` 2.5.1, `/plugin-dialog` 2.7.1, `foliate-js` 1.0.1.
- crates.io (WebFetch, 2026-07-09) — `tauri` 2.11.5, `tauri-plugin-sql` 2.4.0, `sqlx` 0.9.0.

### Secondary (MEDIUM confidence)
- [Tauri folder-picker issue #14587](https://github.com/tauri-apps/tauri/issues/14587) → plugins-workspace #933 — no official Android folder picker / persisted grant.
- [tauri-plugin-android-fs](https://github.com/aiueo13/tauri-plugin-android-fs) — community SAF picker + permission mgmt (needs audit).
- [Tauri FS on Android (philrich.dev)](https://philrich.dev/tauri-fs-android/) — `dialog.open` returns `content://`, `fs` reads it in-session.
- [DeDRM_tools adeptBook detection (DeepWiki)](https://deepwiki.com/apprenticeharper/DeDRM_tools/4-adobe-drm-removal) + [w3c/publ-epub-revision #575](https://github.com/w3c/publ-epub-revision/issues/575) — encryption.xml/rights.xml detection, three encryption classes.

### Tertiary (LOW confidence)
- Assumed crate versions for `uuid`/`blake3`/`zip`/`thiserror` (re-verify at plan time).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified against npm + crates.io.
- Scaffold / workspace / custom protocol / SQLite / DRM-detect: HIGH — official docs + example code.
- Android SAF persistence: MEDIUM — no official plugin; community crate or native Kotlin, unverified on this env.
- Emulator end-to-end (FND-02/03): MEDIUM — D-13 deviation; needs on-device manual run.

**Research date:** 2026-07-09
**Valid until:** 2026-08-09 (30 days; Tauri mobile + foliate-js API move; re-verify Android SAF state and versions if planning slips)
