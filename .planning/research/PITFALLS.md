# Pitfalls Research

**Domain:** Cross-platform ebook reader (desktop + Android), Chinese/CJK-first, WebDAV self-hosted sync, multi-format (EPUB core → PDF/MOBI/TXT)
**Researched:** 2026-07-09
**Confidence:** HIGH (domain-specific pitfalls verified against 2025–2026 sources: Tauri v2, foliate-js, Nextcloud chunking docs, MDN CSS CJK, Android storage docs)

> Phase numbers below reference a *proposed* roadmap vocabulary (no ROADMAP.md exists yet):
> **P0** Foundation/architecture (data model, storage + format + sync abstractions) ·
> **P1** EPUB reading core (render/paginate/reflow/theme) ·
> **P2** CJK typography differentiation (fonts, line-break, mixed script, dictionary) ·
> **P3** Library (import/scan/metadata/covers) ·
> **P4** Annotations + reading position/CFI ·
> **P5** WebDAV self-hosted sync (files + progress + annotations, conflict resolution) ·
> **P6** Multi-format (PDF, MOBI/KF8, TXT) ·
> **P7** Android platform hardening (SAF/permissions, battery/perf) ·
> **P8** Cross-platform QA / rendering-consistency / release.
> Many pitfalls must be **designed against in P0** even though they **manifest** in a later phase — those say "design P0, verify PX".

---

## Critical Pitfalls

### Pitfall 1: Assuming one webview = one rendering engine across platforms

**What goes wrong:**
Tauri (and any system-webview approach) renders through a *different* engine per OS: Windows = WebView2 (Blink/Chromium), Android = Android System WebView (Blink/Chromium), macOS/iOS = WKWebView (WebKit), Linux = WebKitGTK (WebKit). "Looks perfect on my Windows dev box" then breaks on macOS/Linux. This bites CJK typography hardest because the newest CJK CSS features are **engine-split**: `text-spacing-trim` (punctuation compression) is effectively Chromium-only and *not Baseline*; `hanging-punctuation` is WebKit-mostly; `word-break: auto-phrase` (BudouX ML segmentation) is Chromium-only. So your flagship "clean Chinese reading" differs between a user's Windows laptop and their MacBook.

**Why it happens:**
Devs test on one platform, and CSS "just works" locally. The webview difference is invisible until you diff-test the same book on Blink vs WebKit.

**How to avoid:**
- Treat "identical CJK rendering on Blink and WebKit" as an explicit acceptance criterion, not a hope.
- Do **not** rely on bleeding-edge CJK CSS (`text-spacing-trim`, `hanging-punctuation`, `word-break: auto-phrase`) as your *only* mechanism. Implement punctuation compression / kinsoku in a JS text-shaping layer you control (or accept graceful degradation), with the CSS feature as a progressive enhancement where supported.
- Maintain a golden-image visual-regression corpus rendered on both engine families (WebView2 + WebKitGTK at minimum) from day one.
- Consider whether the differentiator justifies **bundling a fixed Chromium** (heavier, but one engine everywhere) vs system webview (light, but N engines). Decide in P0 — it is architectural.

**Warning signs:**
Punctuation spacing, line-break points, or justified-line rhythm visibly differ between two OSes on the same EPUB. `caniuse`/MDN shows the feature you leaned on is "limited availability."

**Phase to address:** Decide engine strategy **P0**; enforce visual-regression harness **P1**, gate CJK features **P2**, full matrix **P8**.

---

### Pitfall 2: CJK line-breaking / kinsoku (禁则处理) done wrong

**What goes wrong:**
Chinese text breaks *between any two Han characters* by default, which is correct — but naive engines then let a line **start** with closing punctuation (，。！？》」』) or **end** with opening punctuation (《「『（), which is forbidden by kinsoku rules and looks amateurish to a Chinese reader. Or they apply Japanese `line-break: strict` rules to Simplified Chinese and get subtly wrong behavior. Latin words embedded in Chinese get broken mid-word because `word-break: break-all` was set globally to "make CJK wrap."

**Why it happens:**
Teams reach for a single blunt CSS knob (`word-break: break-all`) that fixes CJK wrapping but destroys Latin word integrity, and they never encode the "prohibited start/end characters" table. Kinsoku (JIS X 4051) is Japanese-origin and gets misapplied to zh.

**How to avoid:**
- Use `line-break: strict` + `overflow-wrap`/`word-break: normal` semantics; never global `break-all`. Let CJK break between ideographs while Latin runs stay whole.
- Encode a **prohibited-start / prohibited-end** character set for zh (closing punctuation can't lead a line; opening punctuation can't trail) and enforce it in your layout pass. Distinguish zh-Hans vs zh-Hant vs ja rule sets — do not treat CJK as one bucket.
- Support "avoid orphan single character on last line" and punctuation-hanging into the margin as polish.
- Build a zh/ja/mixed line-break test fixture (W3C i18n line-break test vectors are a good baseline) into CI.

**Warning signs:**
A line begins with `。` or `，`; a line ends with `（` or `「`; an English word is split with no hyphen; identical paragraph renders with different break points across your target engines.

**Phase to address:** **P2** (core differentiator). Fixture into CI at P2, re-verify P8.

---

### Pitfall 3: CJK font fallback that is ugly, glyph-missing, or bloats the bundle

**What goes wrong:**
Three linked failures: (a) **Missing glyphs / tofu (□)** — a Latin UI font has no Han glyphs, so characters vanish or fall back to an ugly system font mid-paragraph. (b) **Ransom-note fallback** — mixing a serif body font with a sans fallback, or Simplified glyphs standing in for Traditional (and vice-versa), or Japanese kanji forms substituting for Chinese hanzi (蘭/兰, 直 have region-variant glyphs). (c) **Bundle bloat** — shipping a full CJK font: unoptimized CJK fonts are 5–20 MB *each*, full Source Han Sans/Noto CJK is ~500+ MB across weights; even one static regional weight is tens of MB.

**Why it happens:**
CJK fonts are enormous (tens of thousands of glyphs) and region-specific. Devs either bundle a giant font (bloat) or rely on the system font (unpredictable, region-wrong on non-Chinese OS locales). The zh-Hans vs zh-Hant vs ja glyph-variant problem is invisible to non-CJK readers.

**How to avoid:**
- Pin an explicit font stack **per language tag** and set `lang`/`xml:lang` correctly so the engine picks the right regional glyph variants (this is why honoring the EPUB's language metadata matters).
- Ship a **licensed, subsettable** default CJK font — Noto CJK / Source Han are OFL, which *explicitly permits subsetting*. Do not bundle a font whose license forbids embedding/subsetting.
- Keep binary size sane: prefer the **variable OTC** (~33 MB whole-family) or a **WOFF2 subset** (a regional variable subset compresses to ~4 MB), or make the good CJK font an **optional first-run download** rather than in the base installer. Never ship the 500 MB full static set.
- Verify glyph coverage: render a high-frequency + rare-character sheet (e.g. 通用规范汉字表 sample + CJK Ext-B edge chars) and detect tofu automatically.

**Warning signs:**
Tofu boxes on rare/variant characters; body text visibly switches typeface mid-line; Traditional readers report "wrong-looking" characters; installer/APK jumps by tens of MB when the font lands; a font-license audit flags "no embedding."

**Phase to address:** **P2**. License audit belongs in P0 (affects overall License decision — note the AGPL/foliate concern in Pitfall 12).

---

### Pitfall 4: Mixed CJK + Latin metrics, baseline, and spacing

**What goes wrong:**
Chinese characters sit on a full-em square with a different baseline and cap-height than Latin; naive mixing yields Latin text that looks vertically misaligned, too small, or floating relative to surrounding Han. Numbers and inline English in a Chinese sentence get cramped or over-spaced. Line-height tuned for Latin makes CJK feel cramped (CJK wants more leading); line-height tuned for CJK makes pure-English chapters feel airy. Fullwidth vs halfwidth punctuation and the space around Latin runs inside CJK ("盘古之白" / 中英之间的空格) is inconsistent.

**Why it happens:**
Latin-first CSS defaults (line-height ~1.4, no ideograph awareness). Teams tune typography on English samples, then CJK inherits bad metrics. The "should there be a space between 中文 and English" question is a real typographic decision that gets ignored.

**How to avoid:**
- Set generous CJK line-height (commonly 1.6–1.8 for body) and expose it as a reading setting; consider separate defaults when the book's primary language is CJK vs Latin (drive off EPUB `dc:language`).
- Handle the CJK↔Latin boundary deliberately: optional thin-space insertion between Han and adjacent Latin/digits (the "盘古之白" convention), applied as a rendering transform, user-toggleable.
- Use per-run font sizing so embedded Latin optically matches Han (Latin often needs a hair larger to match visual weight).
- Prefer `text-spacing-trim` where supported for punctuation kerning, but treat as enhancement (see Pitfall 1).

**Warning signs:**
Inline English looks like it's sinking below the Chinese baseline; digits in a Chinese line look shrunken; readers complain CJK feels "cramped" or English chapters feel "loose"; punctuation gaps look uneven around quotation marks.

**Phase to address:** **P2**.

---

### Pitfall 5: Reading-position / CFI instability across re-pagination and devices

**What goes wrong:**
Reading position stored as a **page number or scroll offset or percentage** silently drifts: changing font size, margin, or screen re-paginates the book and the stored page/percent now points somewhere else. Sync across devices amplifies it — you were on "page 143" on desktop, open Android at a different font size, and land in the wrong chapter. Even proper EPUB CFI can break if the two devices transform the content differently (sanitization, injected styles, different spine handling) or if the file was re-built.

**Why it happens:**
Reflowable EPUB has no intrinsic "page." Percentage/scroll positions are display-dependent, not content-anchored. CFI is content-anchored (character-level) and *does* survive re-pagination — but only if both renderers see the same DOM. Teams pick the easy percentage model, or roll a fragile custom locator instead of CFI.

**How to avoid:**
- Anchor position to a **content locator, not a display coordinate.** Use EPUB CFI (foliate-js already implements a CFI parser/comparator) or an equivalent stable content anchor (spine index + robust text-range/element locator). Store CFI as the source of truth; keep percentage only as a fuzzy fallback for display.
- Make the renderer **DOM-deterministic**: identical sanitization/injection pipeline on every platform so a CFI resolves to the same node everywhere.
- Round-trip test: set position at font size A, change to size B, confirm position holds; then serialize → deserialize on the *other* engine and confirm it lands within a sentence.
- Version the locator format so you can migrate if you change the DOM pipeline (a pipeline change can invalidate stored CFIs — treat as a migration).

**Warning signs:**
"Continue reading" jumps to the wrong spot after a font-size change; cross-device sync lands in a different chapter; annotations (which share the anchor model) drift off their highlighted text after re-pagination.

**Phase to address:** Design the locator model **P0/P1**; harden with annotations **P4**; cross-device verify **P5**.

---

### Pitfall 6: EPUB spec quirks — malformed files, FXL vs reflowable, EPUB2/3, encrypted fonts

**What goes wrong:**
Real-world EPUBs are messy: missing/incorrect `mimetype`, broken `container.xml`, spine/manifest mismatches, absolute paths, HTML that isn't XHTML, EPUB2 (NCX) vs EPUB3 (nav doc) TOC differences, and **fixed-layout (FXL)** books that must NOT be reflowed (comics, illustrated/children's, some CJK vertical layouts) — reflowing them destroys the layout. EPUB3 **font obfuscation** (IDPF/Adobe algorithm) means embedded fonts are byte-mangled and won't load unless you de-obfuscate using the OPF unique-identifier. A parser that assumes clean EPUB3 crashes or silently mis-renders on a large fraction of a real library.

**Why it happens:**
Devs test against a handful of well-formed EPUBs (often EPUB3 from one source). The long tail — Calibre-converted, scanned, DRM-free-store, old EPUB2, Chinese-community-packaged files — exposes every spec corner. FXL detection (`rendition:layout`) is easy to skip.

**How to avoid:**
- Lean on a proven engine (foliate-js parses EPUB/MOBI/AZW3/FB2/CBZ and handles many quirks) rather than writing your own OPF/OCF parser. But wrap it: fail *soft* — a book that won't parse should show an error card, never crash the app.
- Detect and honor `rendition:layout: pre-paginated` (FXL): switch to fixed-viewport rendering, disable font-size reflow controls for that book.
- Implement EPUB3 **font de-obfuscation** (needs the package `unique-identifier`), or embedded CJK fonts in obfuscated books silently fall back to tofu.
- Support both NCX (EPUB2) and nav-doc (EPUB3) TOC; degrade to spine order if both missing.
- Build a "torture corpus" of malformed/edge EPUBs (epubcheck-failing samples, FXL, EPUB2, obfuscated-font) into CI.

**Warning signs:**
App crashes or shows blank on certain imported books; a comic/illustrated book reflows into garbage; embedded font shows tofu (obfuscation not handled); TOC empty on older books.

**Phase to address:** Core parsing + soft-fail **P1**; FXL + obfuscation + EPUB2 TOC **P1/P6**; torture corpus in CI **P1** onward.

---

### Pitfall 7: Sync conflict resolution = last-write-wins → silent annotation/progress loss

**What goes wrong:**
Naive WebDAV sync uploads the whole "state" file and the last device to write wins. User highlights 10 passages on the train (offline Android), meanwhile reads on desktop; on reconnect one device's state clobbers the other's — **highlights and notes silently vanish**, or reading progress jumps backward. Because sync is "files on WebDAV," there's no server-side merge; whoever PUTs last overwrites.

**Why it happens:**
WebDAV is dumb file storage — no merge, no transactions, no conflict API. Treating the annotation/progress DB as one opaque blob makes any concurrent edit a lost-update. Progress is *especially* prone because both devices touch it constantly.

**How to avoid:**
- Model sync data for **merge, not overwrite.** Annotations are an append-mostly set keyed by stable IDs (per-annotation UUID + content anchor + updated-at + tombstones for deletes). Merge = union with per-item last-writer-wins by timestamp, not whole-file LWW. This is effectively a CRDT-lite / operation-log design — decide it in **P0**, because retrofitting a merge model onto a blob store is a painful migration.
- Progress: use "furthest-read" or explicit device-aware reconciliation with a monotonic clock/logical timestamp; never let a stale device silently rewind another. Surface a conflict prompt only when genuinely divergent.
- Detect concurrent modification via ETag/If-Match on WebDAV PUT (see Pitfall 8) so you can *detect* a conflict instead of blindly overwriting.
- Keep an on-device change log so an interrupted sync is replayable and never partially applied.

**Warning signs:**
Users report "my highlights disappeared" or "it forgot where I was"; annotation count decreases after a sync; two devices ping-pong progress backward.

**Phase to address:** Data model **P0**; annotation IDs/anchors **P4**; conflict/merge engine **P5**. This is the single highest-regret pitfall to get wrong late.

---

### Pitfall 8: WebDAV client edge cases — chunking, timeouts, ETags, provider quirks

**What goes wrong:**
Syncing whole book files (EPUBs are MBs; PDFs can be 100s of MB) over WebDAV hits every rough edge: large PUTs time out at a reverse proxy / load balancer (504) mid-transfer; Nextcloud's **chunked upload v2** has strict rules (a `Destination` header is required, chunk names must be integers 1–10000, chunk size 5 MB–5 GB except the last, assembly can return **423 Locked** while finalizing and **504** on slow storage assembly); a Cloudflare/proxy 100 MB body cap silently blocks non-chunked PUTs; `upload_max_filesize`/`post_max_size` don't even apply to WebDAV PUT so the real limit is the webserver/PHP timeout; different providers (Nextcloud vs generic WebDAV vs Synology vs box.com-style) diverge on `PROPFIND` depth, `MOVE`, percent-encoding, and trailing-slash behavior; time skew breaks last-modified-based sync.

**Why it happens:**
"WebDAV" is a loose family, not one behavior. Teams implement against one server (often a local one with no proxy), so timeouts, chunking, locking, and provider quirks never surface until a user's real Nextcloud-behind-nginx setup.

**How to avoid:**
- Implement **resumable chunked upload** for large files with retry/backoff, and support Nextcloud chunked-upload v2 semantics explicitly (Destination header, chunk sizing, numbered chunks). Treat **423 Locked** and **504** on finalize as *retryable*, not fatal.
- Use **ETag + If-Match / If-None-Match** for optimistic concurrency (also powers conflict detection in Pitfall 7).
- Never trust client/server clock equality — use ETags or content hashes for change detection, not raw mtime.
- Abstract the provider behind an interface and test against a matrix: Nextcloud (behind a proxy), a bare WebDAV server, and one "quirky" provider. Handle percent-encoding, `PROPFIND Depth`, and trailing slashes defensively.
- Set generous, configurable timeouts; stream files (don't buffer a 300 MB PDF in memory).

**Warning signs:**
Uploads of large books fail or hang on real servers but work locally; intermittent 423/504; "works on my Nextcloud but not the user's"; sync corrupts a file because a partial PUT was treated as complete.

**Phase to address:** **P5**. Prototype against a real proxied Nextcloud early in P5, not at the end.

---

### Pitfall 9: Android scoped storage / SAF / permissions mishandled

**What goes wrong:**
The app assumes free filesystem access (import a folder of EPUBs by path) — but Android 10+ enforces **scoped storage**. Direct paths into shared storage fail; `Android/data` and `Android/obb` are off-limits; on Android 11+ SAF **can't grant** the SD-card root or `Download` directory. Requesting **`MANAGE_EXTERNAL_STORAGE`** ("All files access") to sidestep this triggers a **Google Play policy review** — Play restricts it to genuine file-manager/backup use cases and will reject a reader that can't justify it, blocking release. Meanwhile SAF `content://` URI permissions must be *persisted* (`takePersistableUriPermission`) or the granted folder access is lost on the next launch.

**Why it happens:**
Desktop-first mental model (real file paths). The team builds the library-import flow on desktop, then discovers Android's storage model is fundamentally different and `File` paths don't work.

**How to avoid:**
- Design the library/import layer around an **opaque storage handle**, not a raw path, from **P0** — desktop uses paths, Android uses SAF `content://` URIs behind the same interface.
- Use SAF `ACTION_OPEN_DOCUMENT_TREE` (folder) / `ACTION_OPEN_DOCUMENT` (file), and **persist** URI permissions across launches. Keep imported books in app-specific storage or track their document URIs.
- Assume you will **not** get `MANAGE_EXTERNAL_STORAGE` on Play — do not architect the import flow to depend on all-files access. If you truly need it, plan the Play Console declaration + demo video, and expect friction/rejection risk.
- Test on Android 11, 13, and 14+ (storage rules tightened repeatedly).

**Warning signs:**
Import works in dev (older API / sideloaded) but users on Android 13+ can't add books; granted folders "forget" access after restart; Play pre-launch report flags storage permission; Play rejects the `MANAGE_EXTERNAL_STORAGE` declaration.

**Phase to address:** Storage abstraction **P0**; SAF implementation + persisted permissions **P7**; verify on multiple API levels **P7/P8**.

---

### Pitfall 10: Tauri v2 Android maturity gaps (or equivalent Flutter-desktop gaps)

**What goes wrong:**
Tauri v2 mobile is production-*capable* (stable since Oct 2024, current 2.9.x Dec 2025) and Readest proves an EPUB reader on Tauri v2 + Android is viable — but the maturity gaps are real: **incomplete mobile docs**, **limited/awkward mobile E2E testing** (no clean way to E2E-test all targets), and plugins that **don't declare platform support**, so a plugin you depend on may not work on Android and you find out at build/runtime. Platform-specific capabilities (SAF, share sheet, background behavior) require **writing native Kotlin/Swift plugin code**, not just JS. The mirror risk if you pick Flutter instead: **Flutter desktop** (Linux/Windows especially) is less battle-tested than mobile, and you lose the mature webview-based EPUB engine (foliate-js) that the Tauri path gives you — you'd re-implement CJK reflow in a canvas/native text stack.

**Why it happens:**
Framework marketing says "one codebase, all platforms." Reality: the shared core is real, but each platform's edges (testing, native plugins, background/lifecycle) still need per-platform work and native code. Teams under-budget the native-glue and testing effort.

**How to avoid:**
- Pin exact framework versions (no `^`/`latest`); Tauri v2.9.x line as of late 2025. Verify each dependency plugin explicitly lists Android support before adopting.
- Budget for **native plugin code** (Kotlin for SAF/share/background on Android) up front — it is not optional glue, it is a workstream.
- Stand up a **thin end-to-end vertical slice on real Android hardware in P0/P1** (open a bundled EPUB, render, persist a setting) to surface webview/plugin/lifecycle gaps before the architecture is locked.
- Keep the shared core (parsing, sync, data model) in portable Rust/TS and keep platform glue thin and replaceable, so a framework surprise doesn't sink the core.

**Warning signs:**
A chosen plugin has no Android implementation; mobile build breaks with capability/permission errors; you can't write an automated test for the Android reading flow; background/lifecycle behavior (autosave on backgrounding) is flaky.

**Phase to address:** Framework decision + Android spike **P0**; native plugins **P7**; test harness **P1** onward.

---

### Pitfall 11: Large-PDF rendering — performance and memory blowups

**What goes wrong:**
PDF is a different beast from reflowable EPUB. A 300 MB scanned-image PDF or a 1,200-page textbook renders fine on desktop but **OOM-crashes on Android**, or scrolls at single-digit FPS. Rendering all pages eagerly, decoding full-resolution images, or holding the whole document in memory kills low-RAM phones. Text-selection/annotation on a PDF (needed for the annotation feature) is far harder than on EPUB and often gets bolted on wrong.

**Why it happens:**
The reflowable-EPUB rendering path (DOM, cheap) doesn't transfer to PDF (page raster/vector, expensive). Teams reuse the EPUB mental model and discover PDF needs tiling, lazy page rendering, and memory caps — usually after a phone crashes.

**How to avoid:**
- Treat PDF as a **separate render pipeline** behind the same format-engine interface (this is why "not EPUB-only" architecture in P0 matters — see Pitfall 12).
- **Lazy/virtualized** page rendering: render only visible (± buffer) pages, tile large pages, downscale to viewport DPI, and hard-cap the page-image cache. Recycle offscreen pages.
- Set a memory budget for Android and test with genuinely large books (100 MB+ scanned, 1000+ pages) on a mid/low-end device, not just an emulator.
- Defer PDF to **P6** deliberately; don't let it destabilize the EPUB core, but make sure the P0 interface can host it.

**Warning signs:**
Android low-memory kills on big PDFs; page-turn latency spikes with document size; memory climbs monotonically while scrolling (leak / unbounded cache); annotation on PDF misbehaves.

**Phase to address:** Interface reserved **P0**; implementation + memory tests **P6**.

---

### Pitfall 12: Architecture locked to "EPUB-only" + AGPL/GPL license contagion

**What goes wrong:**
Two coupled traps. (a) **Format lock-in**: building the reader assuming EPUB DOM everywhere (positions as DOM ranges, rendering as HTML) makes adding PDF/MOBI a *hard refactor* later — exactly the "Lithium-style late rebuild" the project explicitly wants to avoid. (b) **License contagion**: the obvious engine choices carry copyleft. **Readest is AGPL-3.0** — copying its code/architecture pulls AGPL obligations (network-use source disclosure). **foliate-js is MIT** (safe to use permissively) but the desktop app **Foliate is GPL-3.0**. Mixing an AGPL reference implementation into a product you may not want to fully open-source is a license landmine discovered at ship time.

**Why it happens:**
EPUB is the "hard core first," so the whole stack gets shaped around EPUB. And "just look at how Readest does it" turns into copying AGPL code without noticing the license.

**How to avoid:**
- In **P0**, define a **format-engine abstraction**: `open() → document`, `locator ↔ position`, `render(viewport)`, `extractText/selection`, `toc`, capabilities flags (reflowable? FXL? selectable text?). EPUB, PDF, MOBI, TXT are implementations. Reading position (Pitfall 5), annotations (Pitfall 7), and rendering all sit above this seam.
- **Decide the License in P0** and audit every borrowed component: foliate-js (MIT) can be used permissively; do **not** copy Readest (AGPL) source unless you accept AGPL for the whole product. Document each dependency's license and the contagion surface.
- Keep a clean-room boundary: use foliate-js as a library dependency, don't fork AGPL apps.

**Warning signs:**
Reading-position/annotation code references EPUB DOM specifics directly; adding TXT/PDF requires touching the reading-position or annotation code; a license scan finds AGPL code paths; you can't state your product's license confidently.

**Phase to address:** Abstraction + license decision **P0**; each format slots in **P6**.

---

### Pitfall 13: Crossing DRM boundaries (legal + store-policy landmine)

**What goes wrong:**
To "support all the user's books," someone implements decryption of **Adobe ADEPT** EPUB/PDF or **Kindle KFX/AZW** DRM (or bundles DeDRM-style logic). ADEPT is technically cracked and libraries exist, but shipping DRM *circumvention* is legally hazardous (DMCA §1201 and equivalents) and will get the app **removed from Google Play / app stores**, and taints an open-source project. The reader ends up entangled in exactly the content-distribution/legal mess the project scopes out.

**Why it happens:**
Users have DRM'd purchases and ask for support; it feels like a feature. The line between "read a file the user owns" and "circumvent a technical protection measure" gets blurred.

**How to avoid:**
- **Explicit non-goal:** the reader opens **DRM-free** content only (EPUB/PDF/MOBI/TXT without DRM). Do not implement, bundle, or link DRM-removal. foliate-js/Foliate deliberately don't handle DRM — follow that boundary.
- When a DRM'd file is imported, detect encryption (`encryption.xml` / ADEPT rights, Kindle DRM markers) and show a clear "this book is DRM-protected and can't be opened" message — never attempt to strip it.
- Note the tailwind: Amazon now offers DRM-free EPUB/PDF downloads for owned books, and much CJK content is DRM-free — so the addressable library is large without touching DRM.
- Keep this decision written in PROJECT scope so no one "helpfully" adds it later.

**Warning signs:**
An issue/PR proposes "ADEPT support" or vendoring a DeDRM library; code references decryption keys; store review flags circumvention.

**Phase to address:** Written policy **P0**; DRM *detection & refusal* (not removal) **P1/P6**.

---

### Pitfall 14: Battery / performance drain in continuous reading

**What goes wrong:**
Reading is a long-session, low-interaction activity — yet the app burns battery: a per-frame animation/timer left running, a webview repainting continuously, polling sync on a tight interval, keeping the screen render loop hot, or re-laying-out the whole book on every scroll tick. On Android this shows as fast battery drain and thermal throttling during a 2-hour reading session; the OS may also kill a mis-behaving background sync.

**Why it happens:**
Web-stack readers inherit web habits (rAF loops, frequent reflow, interval polling) that are fine for short interactions but ruinous over an hour of reading. Sync-on-timer is easy; sync-on-meaningful-change is more work.

**How to avoid:**
- Idle by default: no animation/timer running while the reader is just displaying a page. Pre-paginate/measure once per layout change, not per scroll frame.
- Sync on **events + debounced idle**, respect Android background/Doze limits (WorkManager-style deferred sync), not a tight polling loop. Autosave progress on lifecycle transitions (backgrounding), not continuously.
- Support dark/OLED-true-black theme (real power win on OLED phones) — dovetails with the required day/night/sepia themes.
- Profile a real continuous-reading session on-device (battery historian / energy profiler); watch for wakelocks and steady CPU while "idle."

**Warning signs:**
Phone warms up or battery drops fast while just reading; CPU shows steady usage on a static page; sync fires constantly; OS kills background sync.

**Phase to address:** Reader loop discipline **P1**; sync scheduling **P5**; battery profiling **P7/P8**.

---

### Pitfall 15: CJK dictionary / word-lookup without word segmentation

**What goes wrong:**
The differentiator includes 划词词典/翻译 (word lookup/translation). But Chinese has **no spaces between words** — tapping a character or naive double-click selects one hanzi or the wrong span, not the actual word (e.g. "沙发" vs "沙"/"发"). Latin double-click-to-select-word logic produces nonsense on Chinese. Lookup then queries a fragment and returns garbage, making the feature feel broken.

**Why it happens:**
Selection/lookup is built on the browser's Latin word model. CJK requires a segmentation pass (dictionary-based or ML) to know word boundaries; teams skip it and select by character or by punctuation-delimited run.

**How to avoid:**
- Add a **CJK word-segmentation** step for selection/lookup (dictionary-driven like jieba-style, or `Intl.Segmenter` with `granularity: 'word'` where the engine supports CJK segmentation — check per-webview). On tap, expand selection to the segmented word, offer adjacent merges.
- Bundle or fetch a dictionary (CC-CEDICT for zh→en is a common permissive choice; check license) and design the lookup UI to show pinyin + gloss.
- Distinguish zh-Hans/zh-Hant and traditional/simplified lookups.

**Warning signs:**
Tap-to-define selects a single character or the whole sentence; lookups return no result for obviously valid words; Traditional text lookups fail against a Simplified-only dictionary.

**Phase to address:** **P2** (differentiator; can be a later wave within P2 after core reading works).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Store reading position as percentage/scroll offset | Trivial to implement | Position drifts on font change + across devices; annotations built on it also drift; painful migration to CFI | Never for the source-of-truth; OK only as a *fuzzy fallback* alongside a content anchor |
| Sync state as one opaque blob (whole-DB PUT) | Fast to ship sync | Last-write-wins silently loses highlights/notes; retrofitting a merge model is a data migration | Never once annotations exist; acceptable only for a solo-device pre-sync prototype |
| Global `word-break: break-all` to make CJK wrap | One line, CJK wraps | Breaks Latin words mid-word; ignores kinsoku prohibited chars | Never in production; throwaway spike only |
| Bundle full static CJK font | Guaranteed glyphs | +tens of MB (up to 500 MB full family) installer/APK bloat | Only a subset/variable/WOFF2; or optional download |
| Copy Readest code/architecture directly | Big head start | AGPL-3.0 contagion across the whole product | Only if you accept AGPL for the entire product |
| Assume raw file paths for library import | Works on desktop instantly | Breaks on Android scoped storage; forces rework of import + sync | Desktop-only prototype; never as the cross-platform model |
| Write your own EPUB/OPF parser | "Full control" | Re-discovers every spec quirk (obfuscation, EPUB2 NCX, FXL, malformed) | Never — use foliate-js and wrap it |
| Ship DRM-removal to "support all books" | Users happy short-term | Legal (DMCA §1201) + store removal + project taint | Never |
| Poll sync on a fixed timer | Simple | Battery drain, Doze kills it, race conditions | Never on mobile; event+debounce instead |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| WebDAV (generic) | Assume one behavior; buffer whole file; trust mtime | Provider-abstracted client; stream + chunk large files; ETag/If-Match for change detection |
| Nextcloud chunked upload v2 | Skip `Destination` header; wrong chunk sizing; treat 423/504 as fatal | Follow v2 rules (Destination header, numbered chunks 1–10000, 5 MB–5 GB); retry 423 Locked / 504 finalize with backoff |
| Reverse proxy (nginx/Cloudflare in front of Nextcloud) | 100 MB body cap / short proxy timeout silently blocks PUT | Chunked resumable upload; configurable timeouts; test *behind a proxy* not just direct |
| Android SAF | Forget `takePersistableUriPermission`; expect SD root/Download access on 11+ | Persist URI grants; use `OPEN_DOCUMENT_TREE`; keep books in app storage or track document URIs |
| Google Play policy | Request `MANAGE_EXTERNAL_STORAGE` casually | Avoid it; architect around SAF; if unavoidable, plan the declaration + demo video and expect scrutiny |
| Tauri plugin ecosystem | Adopt a plugin without checking Android support | Verify each plugin lists Android; write native Kotlin for SAF/share/background yourself |
| foliate-js (MIT) vs Foliate/Readest (GPL/AGPL) | Copy AGPL app code thinking it's "the library" | Depend on foliate-js (MIT); don't fork the AGPL app |
| CC-CEDICT / dictionary data | Ignore license / ship Simplified-only | Verify license (CC-BY-SA for CC-CEDICT); support Hans+Hant lookup |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Eager full-book pagination/measure | Slow book open; jank on font change | Paginate lazily / virtualize; measure per layout-change not per frame | Long books (>1000 pages) / low-end Android |
| Whole-PDF in memory + full-res decode | OOM crash on Android; scroll jank | Virtualize pages, tile, downscale to viewport DPI, cap image cache | 100 MB+ scanned PDFs on <4 GB RAM phones |
| Unbounded page/render cache | Memory climbs while scrolling | Hard cap + recycle offscreen pages | Sustained scrolling of any large doc |
| rAF/animation loop left running while idle | Battery + thermal in long sessions | Idle-by-default reader; no timers on a static page | Any 1-hour+ reading session |
| Sync polling on a tight interval | Battery drain; Doze kills sync | Event-driven + debounced idle sync (WorkManager) | Mobile, background, over hours |
| Re-layout of full book on every scroll tick | Scroll jank grows with doc size | Incremental layout; cache column geometry | Larger books, weaker devices |
| Loading full CJK font eagerly | Slow first render; memory spike | Subset/variable font; lazy-load non-base weights | Any device on first book open |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Rendering untrusted EPUB HTML/JS without sandboxing | Malicious EPUB runs scripts, exfiltrates via network, or breaks out of the reader | Sanitize/strip scripts; disable JS in book content webview; strict CSP; no remote fetches from book content |
| Book content making outbound network requests (remote images/CSS/beacons) | Reading-habit tracking / "phone home" from a book; privacy violation (project is privacy-first) | Block remote resource loads from book content by default; localize/allowlist explicitly |
| Storing WebDAV credentials in plaintext / app config | Self-hosted server creds leak from a stolen device or synced config | OS keychain/Keystore for credentials; never sync creds through the WebDAV store itself |
| Trusting server TLS loosely for self-hosted WebDAV | MITM on sync; credential/library theft | Enforce TLS; allow user-pinned cert for self-signed but *warn*, don't silently accept |
| Path traversal from malformed EPUB/ZIP entries (`../`) | Zip-slip writes files outside the sandbox | Validate/normalize every archive entry path; extract into a jailed dir |
| Syncing plaintext annotations to a shared/untrusted WebDAV | Personal notes exposed on a shared server | Document the trust model; consider optional client-side encryption of the sync payload |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Latin-tuned typography defaults applied to Chinese | Cramped, "cheap"-looking CJK — kills the core differentiator | CJK-aware defaults (line-height 1.6–1.8, kinsoku, punctuation trim) driven by `dc:language` |
| Line starts with `。，` / ends with `（「` | Reads as amateurish to Chinese readers | Enforce prohibited-start/end char rules |
| Position/highlights drift after font-size change | "It lost my place / my notes" — erodes trust | Content-anchored CFI locators (Pitfall 5) |
| Silent sync overwrite | Highlights/progress vanish — worst-feeling data loss | Per-item merge + conflict surfacing (Pitfall 7) |
| Reflowing a fixed-layout (comic/illustrated) book | Layout turns to garbage | Detect FXL, switch to fixed-viewport, disable reflow controls |
| No day/night/sepia + OLED-black | Eye strain at night; battery drain | Ship required themes incl. true-black; respect system theme |
| Tap-to-define selects one hanzi | Dictionary feature feels broken | CJK word segmentation on selection (Pitfall 15) |
| Import fails silently on Android | User "can't add books," no idea why | SAF flow with clear guidance; explain scoped-storage limits |
| Crash on a malformed book | One bad file bricks the library view | Soft-fail per book: error card, never crash the app |

## "Looks Done But Isn't" Checklist

- [ ] **EPUB rendering:** Works on clean EPUB3 — verify malformed/EPUB2-NCX/FXL/obfuscated-font books via a torture corpus, and that failures soft-fail (no crash).
- [ ] **CJK typography:** Looks fine on Blink (Windows/Android) — verify identical behavior on **WebKit** (macOS/Linux) for line-break, punctuation compression, mixed-script baseline.
- [ ] **Reading position:** Restores at the same font size — verify it holds **after a font-size/margin change** and **across two devices/engines** (CFI, not %).
- [ ] **Annotations:** Save and reload — verify anchors survive re-pagination and that a **concurrent-edit merge** keeps both devices' highlights (no LWW loss).
- [ ] **WebDAV sync:** Works against a local server — verify **large-file chunked upload behind a reverse proxy** on real Nextcloud, with 423/504 retry.
- [ ] **Android storage:** Import works in dev — verify on **Android 13/14+ scoped storage** with **persisted** SAF permissions surviving restart.
- [ ] **PDF:** Opens a small PDF — verify a **100 MB+ / 1000-page** book doesn't OOM on a mid/low-end phone.
- [ ] **Fonts:** Glyphs render — verify **no tofu** on rare/variant chars and correct zh-Hans vs zh-Hant glyph variants; confirm license permits embedding/subsetting.
- [ ] **DRM:** Opens DRM-free books — verify DRM'd files are **detected and refused** (not attempted, not crashed).
- [ ] **Battery:** Reads a page — verify a **1-hour session** shows no steady CPU/wakelock on a static page.
- [ ] **License:** Product builds — verify no **AGPL** (Readest) code paths pulled in; foliate-js (MIT) usage is clean.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Position stored as % (Pitfall 5) | MEDIUM | Add CFI/content anchor as new source of truth; keep % as fallback; migrate on next open (best-effort re-anchor) |
| Blob-LWW sync already lost data (Pitfall 7) | HIGH | Reconstruct from per-device local logs if kept; introduce per-item IDs + tombstones + merge; without local history, some loss is unrecoverable → prevention is the only real fix |
| EPUB-only architecture (Pitfall 12) | HIGH | Extract a format-engine interface behind existing EPUB path, then re-home position/annotation code above it — significant refactor (the exact cost the project wants to avoid) |
| AGPL contamination (Pitfall 12) | HIGH | Clean-room rewrite of tainted paths, or relicense whole product AGPL; either is costly late |
| Android storage assumed paths (Pitfall 9) | MEDIUM | Introduce storage-handle abstraction; rebuild import on SAF; re-import existing library |
| Bundle bloat from full font (Pitfall 3) | LOW | Swap to subset/variable/WOFF2 or move to optional download; ship in a point release |
| Chosen Tauri plugin lacks Android (Pitfall 10) | MEDIUM | Write native Kotlin plugin, or swap plugin; contained if core stayed portable |
| DRM circumvention shipped (Pitfall 13) | HIGH | Remove immediately; store takedown/appeal; reputational — avoid entirely |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Webview engine divergence | P0 decide, P8 enforce | Golden-image diff on Blink + WebKit matches |
| 2. CJK line-break / kinsoku | P2 | zh/ja line-break test fixtures pass on all engines |
| 3. CJK font fallback / bloat / license | P0 license, P2 impl | No tofu on coverage sheet; installer size in budget; license audit clean |
| 4. Mixed CJK+Latin metrics | P2 | Baseline/spacing review on mixed-script samples |
| 5. Reading-position / CFI stability | P0/P1 design, P4/P5 verify | Position holds across font change + across devices |
| 6. EPUB spec quirks | P1 (+P6) | Torture corpus renders or soft-fails; FXL/obfuscation handled |
| 7. Sync conflict / LWW loss | P0 data model, P5 engine | Concurrent-edit test keeps both devices' annotations |
| 8. WebDAV client edge cases | P5 | Large chunked upload behind real proxied Nextcloud succeeds/retries |
| 9. Android scoped storage / SAF | P0 abstraction, P7 impl | Import + persisted permissions work on Android 13/14+ |
| 10. Tauri v2 Android maturity | P0 spike, P7 native | End-to-end Android reading slice on real hardware |
| 11. Large-PDF perf/memory | P0 interface, P6 impl | 100 MB+/1000-page PDF stable on low-end phone |
| 12. EPUB-only lock-in + AGPL | P0 | Format interface exists; TXT/PDF slot without touching position code; license scan clean |
| 13. DRM boundary | P0 policy, P1/P6 detect | DRM'd file detected + refused, never decrypted |
| 14. Battery / continuous reading | P1 loop, P5 sync, P7 profile | 1-hour on-device session: no idle CPU/wakelock |
| 15. CJK word-lookup segmentation | P2 | Tap-to-define selects correct multi-char words (Hans+Hant) |

## Sources

- Tauri v2 mobile status & gaps — [Tauri 2.0 Stable](https://v2.tauri.app/blog/tauri-20/), [Mobile Plugin Development](https://v2.tauri.app/develop/plugins/develop-mobile/), [Tauri v2: One Codebase 4 All? (andamp)](https://andamp.io/insights/blog/tauri-v2-one-codebase-4-all), [Tauri 2 troubleshooting](https://fixdevs.com/blog/tauri-2-not-working/)
- foliate-js engine, CFI, pagination limits & Readest lineage — [foliate-js GitHub](https://github.com/johnfactotum/foliate-js), [EPUB CFI system (DeepWiki)](https://deepwiki.com/johnfactotum/foliate-js/5.1-epub-cfi-system), [Foliate (Wikipedia)](https://en.wikipedia.org/wiki/Foliate_(software))
- Nextcloud WebDAV chunked upload v2 rules, 423/504, proxy caps — [Chunked file upload (Nextcloud dev manual)](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/WebDAV/chunking.html), [Big file upload config](https://docs.nextcloud.com/server/stable/admin_manual/configuration_files/big_file_upload_configuration.html), [rclone Nextcloud chunked v2 PR](https://github.com/rclone/rclone/pull/6133), [client timeout recopy issue #6279](https://github.com/nextcloud/server/issues/6279)
- Android scoped storage / SAF / MANAGE_EXTERNAL_STORAGE — [Storage updates in Android 11](https://developer.android.com/about/versions/11/privacy/storage), [Scoped storage (AOSP)](https://source.android.com/docs/core/storage/scoped), [All files access policy (Play Console)](https://support.google.com/googleplay/android-developer/answer/10467955)
- CJK CSS (line-break, text-spacing-trim, hanging-punctuation, word-break) — [MDN line-break](https://developer.mozilla.org/en-US/docs/Web/CSS/line-break), [MDN text-spacing-trim](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/text-spacing-trim), [CJK Typesetting 2025 (Asian Absolute)](https://asianabsolute.co.uk/blog/cjk-typesetting-challenges-workflows-and-best-practices/), [text-spacing-trim guide (modern-css)](https://modern-css.com/cjk-and-quote-spacing-without-manual-kerning/)
- Reflowable vs fixed-layout & reading-position instability — [Reflowable vs Fixed Layout (StreetLib)](https://help.streetlib.com/article/411-reflowable-vs-fixed-layout-epub), [EPUB advantages/limitations (PublishDrive)](https://help.publishdrive.com/the-epub-format-advantages-and-limitations)
- CJK font size / subsetting / OFL licensing — [Source Han Sans goes variable (Adobe)](https://blog.adobe.com/en/publish/2021/04/08/source-han-sans-goes-variable), [Noto CJK (Google)](https://developers.googleblog.com/noto-a-cjk-font-that-is-complete-beautiful-and-right-for-your-language-and-region/), [CJK Font Optimization](https://font-converters.com/languages/cjk-font-optimization)
- DRM boundary (ADEPT/KFX, legality, DRM-free trend) — [Adobe DRM security (Locklizard)](https://www.locklizard.com/adobe-digital-editions-epub/), [Foliate feature/format scope](https://johnfactotum.github.io/foliate/), [Amazon DRM-free downloads (How-To Geek)](https://www.howtogeek.com/amazon-will-let-you-download-books-without-drm/)
- Project context — `.planning/PROJECT.md` (枕籍/Pillowtome); benchmarks Lithium / Readest / KOReader

---
*Pitfalls research for: cross-platform CJK-first ebook reader (枕籍/Pillowtome)*
*Researched: 2026-07-09*
