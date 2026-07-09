<!-- GSD:project-start source:PROJECT.md -->

## Project

**枕籍（Pillowtome）**

枕籍是一款**多平台互通的电子书阅读器**：以优秀的中文阅读体验为差异化，对标 Readest 级能力（多格式、书库、批注、主题、自托管同步），v1 覆盖**桌面（Windows / macOS / Linux）+ Android**。产品路径是按 Readest 级能力分里程碑交付——**架构按完整阅读器一次到位，功能分阶段填满**；早期里程碑可对齐 Lithium 的沉浸式 EPUB 核心体验，再扩展多格式与全量同步。

**Core Value:** 在任意一端打开书，都能以**干净、舒适的中文排版**稳定阅读，并与自托管（WebDAV）书库/进度状态**可靠互通**。

### Constraints

- **Platforms (v1)**：Windows / macOS / Linux 桌面 + Android；iOS/Web 后置但架构宜可扩展
- **Sync**：默认自托管 WebDAV；不强制依赖 Google Drive / 专有云
- **Privacy**：本地优先；同步内容用户可控；无广告、无追踪式变现
- **Chinese UX**：中文阅读质量是差异化硬指标，不可为「先英文跑通」长期牺牲
- **Architecture**：多格式 + 同步从设计日起纳入边界，避免 Lithium 式后期硬拆
- **Tech stack**：待研究锁定；优先可维护的跨端方案，避免无必要的双写 UI
- **License**：待定（若借鉴 AGPL 组件如 foliate-js 周边需审许可证传染面）

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## TL;DR — Prescriptive Recommendation

## Framework Family Comparison (the load-bearing decision)

| Family | Shared logic core | Shared *renderer* across desktop+Android | CJK EPUB fidelity | Desktop maturity | Android maturity | Verdict |
|--------|-------------------|------------------------------------------|-------------------|------------------|------------------|---------|
| **Tauri v2 + web UI + foliate-js** ⭐ | Rust (one core) | **Yes** — foliate-js in WebView, one impl | **Excellent** (rides WebView CSS engine) | High | Medium-High (stable since 2.0 GA Oct 2024) | **PRIMARY** |
| Kotlin Multiplatform + Compose MP | Kotlin (one core) | **No** — Readium navigator is Android-only; desktop needs a separate renderer | Good on Android (Readium); unproven on desktop | Medium (CMP desktop young for readers) | High (native) | Secondary / Android-native alt |
| Flutter (Dart) | Dart (one core) | Yes (widgets) — **but no HTML/CSS engine** | **Poor** without an embedded WebView; CJK line-break/vertical writing is a huge custom build | Good | Excellent | Not recommended (EPUB+CJK blocker) |
| React Native / Capacitor / Electron+Capacitor | JS (one core) | Partial | Good (WebView) but two shells | Electron only, heavy | Good | Not recommended (Tauri v2 dominates it) |

### Why Tauri v2 wins for *this* project

- **CJK typography is the differentiator, and the WebView is the best CJK engine available for free.** foliate-js renders EPUB HTML/CSS in the system WebView (Chromium-based WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux, Android System WebView / Chromium on Android). That means we inherit, at zero engineering cost, the exact CSS features CJK reading needs: `writing-mode: vertical-rl` (竖排), `text-spacing` / `text-autospace` (中英混排间距), `hanging-punctuation` + `text-align: justify` with `line-break: strict/normal` (标点挤压/避头尾 kinsoku), `@font-face` embedding + `lang`-based font fallback, and `text-emphasis` (着重号) / ruby (注音). No other family gives you all of this without re-implementing a text engine.
- **One Rust core, literally shared.** Format orchestration, library DB (SQLite), WebDAV sync, conflict resolution, file scanning, cover/metadata extraction — all live in Rust and compile to both desktop and Android from one codebase. This is exactly the "avoid needless double-writing" constraint in PROJECT.md.
- **foliate-js is MIT** (not AGPL). We can use it directly. (Readest is AGPL — study its shape, do **not** copy its code.)
- **Proven:** Readest = Next.js 16 + Tauri v2 + foliate-js on macOS/Windows/Linux/Android/iOS/Web. The risky integration work is already demonstrated.
- **Small binaries, local-first, no runtime cloud dependency** — aligns with privacy-first, no-ads, account-optional goals.

### Tauri v2 Android maturity — honest assessment (Confidence: MEDIUM-HIGH)

- Mobile (Android + iOS) has been **stable since the Tauri 2.0 GA (October 2024)**; current line is **2.11.x** (`tauri` crate 2.11.5, mid-2026). It is no longer experimental, and Readest ships an Android build on it.
- **Risk 1 — WebView version variance:** Android uses the device's *System WebView* (Chromium). On modern devices it auto-updates via Play Store and is very current, but on old/AOSP/de-Googled devices it can lag, which affects newer CSS (e.g. `text-autospace`). *Mitigation:* set a minimum WebView/Chromium baseline, feature-detect and fall back (JS shim for autospace), test on real low-end devices.
- **Risk 2 — thinner mobile plugin ecosystem:** fewer mobile-specific plugins than desktop, and native mobile plugin authoring is Kotlin/Swift. *Mitigation:* our needs (`fs`, `sql`, `http`/`dialog`/`fs-watch`) are covered by official plugins that explicitly support Android.
- **Risk 3 — mobile debugging ergonomics** are worse than pure-native. Budget time for device QA.
- Net: acceptable and de-risked for a Readest-level target; **not** bleeding-edge anymore.

### Why the alternatives lose (short form)

- **Flutter:** No CSS/HTML layout engine. `epubx` is a *parser*, not a renderer; reader packages paint into Flutter widgets, so advanced CJK line-breaking, punctuation compression, and vertical writing are essentially unsupported and would be a multi-quarter custom typography engine. The escape hatch (embed `flutter_inappwebview` and run foliate-js inside) reintroduces the WebView and the Dart↔JS bridge — at which point Tauri is the cleaner version of the same idea. **CJK fidelity is the disqualifier.**
- **Kotlin Multiplatform + Compose MP:** The Kotlin core (parsing, sync, Room/SQLDelight) genuinely shares. But the **Readium Kotlin navigator renders EPUB via an Android WebView + Readium CSS and is Android-only** — there is *no* first-class Readium/Compose EPUB navigator for desktop JVM. You'd share the core but **build and maintain two renderers** (Android WebView vs. a desktop Chromium-embed like JCEF), which is the exact double-write we're told to avoid. Excellent if the product were Android-first native; wrong shape for "one core + one renderer on both."
- **React Native:** desktop (Windows/macOS via community forks) is second-class and Linux is effectively absent → fails the desktop requirement.
- **Electron + Capacitor:** works, but it's *two* native shells (Electron desktop + Capacitor mobile), ~100 MB+ desktop binaries, and no shared native core. Tauri v2 delivers desktop + Android from one project with a shared Rust core and small binaries — strict improvement for this use case.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Tauri** | 2.11.x (`tauri` crate 2.11.5; `@tauri-apps/api` 2.11.1; `@tauri-apps/cli` 2.11.4) | App shell + Rust core for desktop **and** Android from one project | Only family sharing both core *and* renderer across targets; small binaries; local-first; the Readest-proven path. |
| **Rust** | 1.8x (current stable, edition 2021/2024) | Shared core: format orchestration, DB, sync, conflict resolution | One core compiles to Win/macOS/Linux + Android; strong for parsing/IO; where WebDAV and DB logic live. |
| **foliate-js** | pin a vendored commit (npm `foliate-js@1.0.1` exists; author warns API is unstable) | EPUB / MOBI / KF8(AZW3) / FB2 / CBZ parsing + reflowable & fixed-layout rendering in the WebView | **Best CJK support** (character-level locations, not epub.js's word offsets → correct progress in CJK), multi-format, **MIT**, actively maintained, used by Foliate + Readest. |
| **React** | 19.x | WebView UI (library, reader chrome, settings, annotations) | Mature, huge ecosystem; foliate-js is framework-agnostic (web components) so UI framework is not load-bearing for rendering. Svelte 5 / SolidJS are fine lighter alternatives. |
| **Vite** | 6.x/7.x | Dev server + static build feeding the WebView | Lightest, fastest Tauri front-end toolchain; simpler than Next.js for an offline SPA. |
| **TypeScript** | 5.x | Type safety across the WebView layer + Tauri command bindings | Standard; pairs with `tauri-specta` for typed Rust↔JS command contracts. |
| **SQLite (via SQLx)** | SQLx 0.8.6 through `tauri-plugin-sql` v2 | Local library metadata, reading progress, annotations, sync state | **Official plugin, SQLx-backed, supports Android *and* desktop** — one schema, one data layer both sides. rusqlite does **not** target mobile well. |
| **reqwest_dav** | 0.2.1 | WebDAV sync client in the Rust core | Async (tokio+reqwest), Basic/Digest auth, GET/PUT/MOVE/COPY/DELETE/MKCOL/PROPFIND — everything a self-hosted library+progress sync needs; runs identically on both targets. |
| **pdf.js (`pdfjs-dist`)** | 6.1.200 (Jun 2026) | PDF rendering in the WebView (Phase: PDF) | Same WebView pipeline as foliate-js; zero native deps; what Readest uses. Swap to native pdfium later only if large-PDF perf demands it. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@tauri-apps/plugin-fs` | v2 | Sandboxed file access, library import/scan | Always (book files on disk; DB holds metadata only). |
| `@tauri-apps/plugin-sql` | v2 | JS binding to the SQLx SQLite DB | Always — primary storage access from the UI. |
| `@tauri-apps/plugin-http` / `reqwest` | v2 / 0.12.x | Networking; OPDS/Calibre feeds; WebDAV via Rust | Sync + catalog phases. Prefer doing WebDAV in Rust (`reqwest_dav`), not JS, so logic is shared. |
| `@tauri-apps/plugin-dialog`, `-os`, `-deep-link` | v2 | File pickers, platform info, "open with" | Import UX, platform-conditional behavior. |
| `tauri-specta` | latest | Generate typed TS bindings for Rust commands | Recommended for a maintainable Rust↔UI boundary. |
| `fflate` / `zip.js` | current | ZIP/deflate (EPUB is a zip; KF8 embedded fonts are zlib) | Bundled/used by foliate-js; needed for font decompression. |
| `sqlx` (Rust, direct) | 0.8.6 | Heavy DB logic on the Rust side (migrations, batch sync writes) | When sync/conflict logic should live in the core rather than the UI. |
| `serde` / `serde_json` | 1.x | Serialize sync payloads, annotations, settings | Always. |
| `pdfium-render` | 0.9.2 | Native PDF raster via a Rust sidecar (bundled PDFium, BSD) | **Later phase**, only if pdf.js is too slow on large/complex PDFs. |
| ICU / `Intl.Segmenter` (WebView built-in) | — | CJK word segmentation for search, dictionary word-lookup | Dictionary/word-lookup differentiator; foliate-js search already uses `Intl.Collator`/`Intl.Segmenter`. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Tauri CLI 2.11.x | Build/run/bundle desktop + `tauri android` for Android | Requires Android SDK/NDK + Rust Android targets (`aarch64-linux-android`, etc.). |
| pnpm 10.26.2 (exact) + committed `pnpm-lock.yaml` | JS dependency management | Per supply-chain baseline: exact versions, no `^`/`~`/`latest`. |
| Cargo + committed `Cargo.lock` | Rust deps | Pin exact; audit install-time hooks. |
| Android Studio (SDK/NDK/emulator) | Android build + device QA | Needed for WebView-version testing on real/low-end devices. |
| `cargo-tauri`, `tauri-specta`, `sqlx-cli` | Bindings + migrations | `sqlx migrate` for schema; `sqlx` offline mode for CI without a DB. |

## EPUB / Format Rendering Engines — evaluated (with CJK verdicts)

| Engine | License | Formats | Pagination vs Scroll | CJK typography | Font embed/fallback | Verdict |
|--------|---------|---------|----------------------|----------------|---------------------|---------|
| **foliate-js** ⭐ | MIT | EPUB, MOBI, KF8/AZW3, FB2, CBZ (+PDF via pdf.js) | Both — CSS multi-column paginator **and** scrolled flow | **Excellent** — inherits WebView CSS: vertical-rl, text-spacing/autospace, hanging-punctuation, line-break, ruby, emphasis. **Character-level** locations fix CJK progress bugs that plague epub.js. | Full `@font-face` + `lang`-based fallback (WebView) | **PRIMARY** |
| epub.js | BSD-2 | EPUB (+ some) | Both (CSS columns) | **Poor for CJK progress** — *word/space-based* offsets misplace locations in Chinese/Japanese; **effectively unmaintained**. | WebView `@font-face` | **Avoid** |
| Readium (readium-js / readium-css / Thorium) | BSD-3 | EPUB, PDF, audiobooks | Paginated; **vertical writing disables CSS-column pagination** (scroll-like) | **Good** — Readium CSS has RTL/CJK + Japanese vertical writing (validated by JA users), ruby-hide, script-aware settings injection | Custom fonts supported | Strong but **heavier + different arch**; overkill vs. foliate-js for our shell |
| Readium **Kotlin** navigator | BSD-3 | EPUB, PDF, audiobooks, comics | Paginated + scroll; animated page turns | **Good on Android** (WebView + Readium CSS, vertical writing, custom fonts) | Yes | Great **only in a KMP/Android-native stack** — Android-only, so it breaks one-renderer goal |
| Native/custom (Flutter widgets, CoreText, etc.) | — | varies | custom | **Hard** — no CSS engine; kinsoku/vertical/mixed-script is a big custom build (cf. teams abandoning WebView *for* CoreText only after major investment) | manual | **Avoid** for v1 |

## Storage & Sync — evaluated

- **Tauri:** `tauri-plugin-sql` (SQLx-backed) — **supports Android and desktop**, one schema both sides. For heavier core logic, use **SQLx 0.8.6** directly in Rust (async). **Do not use `rusqlite` (0.38.0) as the Android store** — it's sync-only and not a good mobile fit.
- KMP alternative: **SQLDelight 2.x** (SQL-first, longest KMP track record) or **Room 2.7+** (KMP-capable since 2024, Google-backed). Flutter alternative: **Drift 2.34.1** (bundles SQLite 3.x). These matter only if you pick a non-Tauri family.
- Keep **book files on disk**; the DB stores metadata, positions (CFI/foliate locations), highlights, notes, bookmarks, and per-item sync revision/hash.
- Do it in the **Rust core with `reqwest_dav` 0.2.1** so one implementation serves both platforms. This is a real differentiator: **Readest does NOT ship WebDAV** (open feature requests #356/#577; it uses its own cloud) — so this is greenfield, and Tauri's Rust-core architecture is the ideal place to build it.
- Design for **full sync** (files + progress + annotations): per-record revisions + content hashes, last-write-wins for progress, additive/merge for annotations, and a manifest for library files. Consider **KOReader progress-sync protocol compatibility** later for ecosystem interop (PROJECT.md references it).
- Per stack, WebDAV client libs: Rust `reqwest_dav`; Kotlin `sardine-android`/OkHttp; Dart `webdav_client`. Rust in the Tauri core is the pick.

## PDF, MOBI/KF8, and "one core" specifics

- **PDF:** Start with **pdf.js (`pdfjs-dist` 6.1.200)** in the same WebView pipeline — consistent, zero native deps, Readest-proven; fine for v1's PDF phase. **Escalate to native only if needed:** `pdfium-render` 0.9.2 (PDFium, **BSD**, bundled lib, Rust sidecar rendering to images) for large/complex PDFs. **Avoid MuPDF for the default path** — it's **AGPL/commercial dual-license** (license-contagion risk for a possibly non-AGPL product); use PDFium instead. pdf.js has known color/fidelity edge cases but is adequate; PDFium is faster and more accurate on heavy PDFs.
- **MOBI/KF8:** foliate-js covers it (see note above). No separate library needed for v1's later MOBI phase.
- **One core across desktop+Android:** the Rust crate (format orchestration, SQLx DB, `reqwest_dav` sync, conflict/merge, scanning, metadata) + the foliate-js WebView layer are compiled/loaded on both targets from a single source tree. Only thin platform glue (permissions, file pickers, storage paths, WebView quirks) differs. **This is Tauri's core value prop, and Readest demonstrates it in production.**

## Installation

# --- Scaffold (Tauri v2 + React + Vite + TS) ---

# Rust Android targets

# --- Front-end (WebView UI) ---

# foliate-js: VENDOR a pinned commit (author warns the API is unstable) rather than tracking a floating range

#   git subtree/submodule of johnfactotum/foliate-js @ <pinned-sha>, or copy MIT sources into /vendor

# --- Rust core (src-tauri/Cargo.toml, exact versions, commit Cargo.lock) ---

# tauri = "2.11.5"

# tauri-plugin-sql = { version = "2", features = ["sqlite"] }

# sqlx = { version = "0.8.6", features = ["runtime-tokio", "sqlite"] }

# reqwest_dav = "0.2.1"

# serde = { version = "1", features = ["derive"] }  ; serde_json = "1"

# (later PDF phase) pdfium-render = "0.9.2"

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Tauri v2 (Rust core + WebView) | Kotlin Multiplatform + Compose MP + Readium Kotlin 3.2.0 | If the product were **Android-first native** and desktop were secondary/deferred; accept two renderers. |
| Tauri v2 | Flutter 3.44 + `flutter_inappwebview` + foliate-js inside | Only if you must have Flutter's UI toolkit; you still end up hosting foliate-js in a WebView — Tauri is the cleaner form. |
| React 19 + Vite | Next.js 16 (static export) | If you want Readest's exact front-end shape / SSR-style DX; heavier than needed for an offline SPA. |
| React 19 + Vite | Svelte 5 / SolidJS | Smaller bundles, leaner reader chrome; foliate-js is framework-agnostic so either is fine. |
| foliate-js | Readium (readium-js / Thorium) | If you need formal Readium/LCP DRM, audiobooks, and standards-certified accessibility over a custom reader. |
| pdf.js | pdfium-render (PDFium) | When large/complex PDFs are slow or mis-rendered in the WebView (dedicated PDF phase). |
| tauri-plugin-sql (SQLx) | SQLx direct in Rust | When sync/merge logic should live entirely in the core, not the UI. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **epub.js** | Effectively unmaintained; **word/space-based location offsets misplace reading progress in CJK** — fatal for the Chinese-reading differentiator. | **foliate-js** (character-level locations, active, MIT). |
| **Flutter native EPUB rendering** (epubx-into-widgets) | No CSS/HTML engine → no kinsoku/punctuation-compression/vertical writing without a huge custom typography build. | Tauri + foliate-js in WebView. |
| **rusqlite as the Android store** | Sync-only, poor mobile fit; splits your data layer between platforms. | **SQLx / tauri-plugin-sql** (works on Android + desktop). |
| **MuPDF (default path)** | **AGPL/commercial** dual license → contagion risk if the product isn't AGPL. | **PDFium** (`pdfium-render`, BSD) or pdf.js. |
| **Copying Readest source** | Readest is **AGPL-3.0** — copying code forces AGPL on Pillowtome. | Learn its architecture; use **foliate-js (MIT)** + pdf.js directly. |
| **Electron (+Capacitor) for this** | Two native shells, ~100 MB+ binaries, no shared native core. | Tauri v2 (desktop + Android, one Rust core). |
| **React Native for desktop** | Windows/macOS forks are second-class; Linux effectively unsupported. | Tauri v2. |
| **Floating version ranges** (`^`, `~`, `latest`, unbounded `>=`) | Supply-chain baseline; reproducibility. | Exact pins + committed `pnpm-lock.yaml` / `Cargo.lock`. |
| **Tracking foliate-js by floating dep** | Author explicitly says the API may break at any time. | **Vendor a pinned commit/SHA.** |

## Stack Patterns by Variant

- Use Tauri v2 + foliate-js, and lean on WebView CSS: `writing-mode`, `text-spacing`/`text-autospace`, `hanging-punctuation`, `line-break: strict`, `text-emphasis`, ruby, `@font-face` + `lang` fallback.
- Bundle CJK fonts (e.g. Source Han / Noto CJK subsets) to avoid ugly device fallback; feature-detect `text-autospace` on old Android WebViews and shim.
- Because: these are the exact features that fix 断行/标点挤压/混排/竖排, and the WebView provides them natively.
- Use Kotlin Multiplatform + Compose MP + Readium Kotlin 3.2.0 (Room/SQLDelight, sardine WebDAV).
- Because: best native Android EPUB + CJK, at the cost of a separate desktop renderer.
- Adopt Readium (Thorium/Readium Web) instead of foliate-js.
- Because: foliate-js is a lean reader, not a DRM/standards platform.
- Add a PDFium Rust sidecar (`pdfium-render`) rendering pages to images, keep pdf.js for light PDFs.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `tauri` 2.11.5 | `@tauri-apps/api` 2.11.1, `@tauri-apps/cli` 2.11.4 | Keep crate/JS/CLI on the same 2.11 minor line. |
| `tauri-plugin-sql` v2 (sqlite) | SQLx 0.8.6 | Plugin is SQLx-backed; if you also link rusqlite, note SQLx ≥0.9 loosens `libsqlite3-sys` to a range to avoid symbol clashes — prefer a single SQLite binding. |
| foliate-js (pinned) | `pdfjs-dist` 6.1.200, `fflate` | foliate-js delegates PDF to pdf.js and uses fflate for KF8/zip inflate. |
| Tauri Android | Android System WebView (Chromium) | CSS feature availability tracks the device WebView version; set a min baseline + shims. |
| Rust Android build | NDK + `aarch64/armv7/x86_64-linux-android` targets | Required for `tauri android build`. |
| Readium Kotlin 3.2.0 (alt path) | Android 5.0+; API <26 needs core-library desugaring | Only relevant to the KMP alternative. |

## Confidence Levels

| Claim | Confidence |
|-------|------------|
| Tauri v2 + foliate-js is the correct primary family for CJK-superior, one-core desktop+Android | **HIGH** — matches Readest's production shape + WebView CSS reality. |
| ONE shared Rust core serves desktop + Android in this stack | **HIGH** — Tauri's core design; Readest demonstrates it. |
| foliate-js has the best CJK EPUB fidelity among JS engines | **HIGH** — character-level locations + WebView CSS; epub.js word-offsets documented as CJK-breaking. |
| SQLx/tauri-plugin-sql is the right cross-platform store | **HIGH** — official Android+desktop support; rusqlite mobile gap documented. |
| WebDAV via `reqwest_dav` in Rust core is the right sync path | **HIGH** for architecture; **MEDIUM** on conflict-model details (needs design in roadmap). |
| pdf.js now, PDFium later | **MEDIUM-HIGH** — pdf.js adequate; escalate on measured perf. |
| Tauri Android maturity is production-acceptable | **MEDIUM-HIGH** — stable since 2.0 GA; WebView-variance + thinner mobile plugins are the caveats. |
| Exact latest versions cited | **HIGH** — verified against official release pages/registries (Jul 2026). |

## Sources

- [Tauri Core Ecosystem Releases](https://v2.tauri.app/release/) — verified `tauri` 2.11.5, `@tauri-apps/api` 2.11.1, `@tauri-apps/cli` 2.11.4.
- [Tauri 2.0 Stable Release](https://v2.tauri.app/blog/tauri-20/) + [Mobile plugin dev](https://v2.tauri.app/develop/plugins/develop-mobile/) — mobile (Android/iOS) stable since GA; WebView model.
- [Tauri SQL plugin](https://v2.tauri.app/plugin/sql/) — SQLx-backed, Android + desktop support.
- [Readest README](https://github.com/readest/readest/blob/main/README.md) — Next.js 16 + Tauri v2 + foliate-js + pdf.js + zip.js/fflate; formats EPUB/MOBI/KF8/FB2/CBZ/TXT/PDF.
- [Readest WebDAV feature request #356](https://github.com/readest/readest/issues/356) / [#577](https://github.com/readest/readest/issues/577) — WebDAV/self-hosted NOT shipped; our greenfield differentiator.
- [foliate-js repo](https://github.com/johnfactotum/foliate-js) + [MOBI/KF8 parser (DeepWiki)](https://deepwiki.com/johnfactotum/foliate-js/4.3-mobikf8-parser) — MIT, character-level offsets, MOBI/KF8 support & perf caveats, `Intl.Segmenter` search.
- [Readium: RTL & CJK support](https://blog.readium.org/support-rtl-cjk-readium-web/) + [Thorium v2.4.0](https://github.com/edrlab/thorium-reader/releases/tag/v2.4.0) + [readium-css i18n](https://readium.org/readium-css/docs/CSS17-i18n_typography.html) — CJK/vertical writing; pagination disabled in vertical mode.
- [Readium Kotlin toolkit](https://github.com/readium/kotlin-toolkit) + [v3.2.0 note](https://blog.readium.org/release-note-kotlin-toolkit-version-3-2-0/) — Android-only navigator, 3.2.0, custom fonts, vertical writing.
- [reqwest_dav crate](https://crates.io/crates/reqwest_dav) — 0.2.1, async WebDAV client.
- [rusqlite vs SQLx (2026)](https://aarambhdevhub.medium.com/rust-orms-in-2026-diesel-vs-sqlx-vs-seaorm-vs-rusqlite-which-one-should-you-actually-use-706d0fe912f3) — rusqlite 0.38.0 sync-only/no mobile; SQLx 0.8.6.
- [pdfjs-dist on npm](https://www.npmjs.com/package/pdfjs-dist) — 6.1.200 (Jun 2026).
- [pdfium-render](https://crates.io/crates/pdfium-render) — 0.9.2 (BSD PDFium); MuPDF AGPL caveat from PDF engine surveys.
- [Compose Multiplatform 1.10/1.11](https://blog.jetbrains.com/kotlin/2026/01/compose-multiplatform-1-10-0/) + [KMP compatibility](https://kotlinlang.org/docs/multiplatform/compose-compatibility-and-versioning.html) — CMP 1.11.x stable; desktop JVM has no Readium navigator.
- [Flutter release notes](https://docs.flutter.dev/release/release-notes) — 3.44 (May 2026); [Flutter Gems ePub](https://fluttergems.dev/epub/) / [epubx](https://fluttergems.dev/packages/epubx/) — parser-only, no CSS engine.
- [Next.js 16](https://nextjs.org/blog/next-16) — GA Oct 21 2025 (alt front-end).
- [Drift](https://pub.dev/packages/drift) 2.34.1 / [SQLDelight vs Room KMP](https://docs.bswen.com/blog/2026-03-14-room-vs-sqldelight-kmp/) — non-Tauri storage alternatives.

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
