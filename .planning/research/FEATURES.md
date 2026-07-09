# Feature Research

**Domain:** Cross-platform ebook reader (Desktop Win/macOS/Linux + Android), differentiator = superior Chinese/CJK reading
**Researched:** 2026-07-09
**Confidence:** HIGH (grounded in current Readest / foliate-js / KOReader / Lithium shipping behavior + 2025 CSS CJK support)

---

## How To Read This Document

Every feature is tagged in one of three buckets:

- **TABLE STAKES** — users leave without it. No competitive credit for having it; heavy penalty for missing it.
- **DIFFERENTIATOR** — competitive edge. Chinese-UX differentiators are flagged **[CN]** and are the product's core reason to exist.
- **ANTI-FEATURE** — deliberately NOT in v1 (scope discipline), with the reason and the alternative.

Complexity = engineering cost given a webview-based reflow engine (foliate-js-class): **LOW / MEDIUM / HIGH**.
Dependencies are called out per feature and consolidated in the Dependency Graph section.

**Reference reality (verified):**
- **Lithium** (Android, EPUB-only): auto library scan, highlights/notes/bookmarks, day/night/sepia, pagination↔scroll, Material UI, ad-free. Pro tier syncs *progress + annotations* (NOT book files) via **Google Drive**. No dictionary, no TTS, no WebDAV.
- **Readest** (capability ceiling): Next.js 16 + Tauri v2 + **foliate-js**. Formats EPUB / MOBI / KF8(AZW3) / FB2 / CBZ / TXT / PDF. Full sync of *files + progress + notes + bookmarks*, plus **KOReader** progress sync and **OPDS/Calibre**. TTS, DeepL/Yandex translate, dictionary lookup, split-screen "Parallel Read", AI summaries. Bundles CJK fonts (LXGW WenKai, MiSans, Source Han Sans, WenQuanYi Micro Hei). AGPL.
- **KOReader**: reference for the *sync protocol* — RESTful kosync server, identifies a document by an MD5 hash, stores furthest reading progress as a percentage/xpointer; self-hostable. StarDict/MDict dictionaries.
- **foliate-js** (the engine to build on): EPUB / MOBI / KF8 / FB2 / CBZ / PDF(experimental via PDF.js). CSS-multicolumn pagination, live scroll↔paginate switch, >2 columns, RTL, **vertical writing mode**, fixed-layout, SSML-emitting TTS module, search (`Intl.Segmenter`/`Collator`), SVG overlay annotations. It renders in a **webview**, so it inherits the host browser's CJK typography engine — this is the strategic lever for the Chinese differentiation.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Missing any of these makes Pillowtome feel like a toy rather than a Readest-level reader.

| Feature | Why Expected | Complexity | Notes / Dependencies |
|---------|--------------|------------|----------------------|
| **EPUB rendering (reflowable)** | The format. Everything else is optional. | HIGH | Core engine (foliate-js). Gates every reading feature. Hard core per PROJECT.md. |
| **Library import + auto-scan** | Users drop files/folders and expect books to appear. | MEDIUM | Needs per-format metadata/cover extraction. Lithium's headline feature. |
| **Cover thumbnails** | A gridded shelf is the mental model of "my library". | LOW–MEDIUM | From EPUB OPF/cover, PDF page 1. Needs thumbnail cache. |
| **Basic metadata (title/author)** | Sort/search/dedup depend on it. | LOW | Parse OPF (EPUB), Exth (MOBI/KF8), PDF info dict. |
| **Sort + filter (title/author/recent/progress)** | Any library >20 books is unusable without it. | LOW | Depends on metadata + reading-progress store. |
| **Pagination ↔ scroll toggle** | The single most-requested layout choice; both Lithium & Readest ship it. | MEDIUM | foliate-js supports live switch. |
| **Font family / size / line-height / margins** | Non-negotiable reading comfort controls. | LOW–MEDIUM | Reflow only (not PDF). Feeds CJK typography layer. |
| **Themes: day / night / sepia** | Baseline eye-comfort expectation (Lithium baseline). | LOW | Add auto night (time/ambient) later. |
| **Full-screen / immersive reading** | "Just the text" is the whole point of a reader. | LOW | Hide chrome, tap zones, keep-awake. |
| **Highlights** | Core annotation; every competitor has it. | MEDIUM | Needs stable text anchor (EPUB CFI / locator) + SVG overlay. |
| **Notes attached to highlights** | Expected companion to highlights. | MEDIUM | Extends highlight data model. |
| **Bookmarks** | Cheapest annotation; users assume it exists. | LOW | Store locator + label. |
| **Reading progress (per book, persistent)** | Reopen = resume exactly. Table stakes even offline. | MEDIUM | Stable locator is the linchpin for sync too. |
| **Table of contents / chapter nav** | Structural navigation of any real book. | LOW | From EPUB nav/NCX. |
| **Search within book** | Expected of any serious reader. | MEDIUM | foliate-js search; **[CN]** must be CJK-aware (segmentation, no word boundaries). |
| **Custom fonts (user-supplied)** | Readers have opinions; Lithium lacks it and gets asked constantly. | LOW–MEDIUM | Font file import + registration. Prereq for good CJK fonts. |
| **WebDAV progress + annotation sync** | Product's stated互通 promise; without it, "cross-platform" is hollow. | HIGH | Depends on locator stability + data model + conflict handling. |
| **TXT support** | Trivially expected; huge in the Chinese web-novel corpus. | LOW–MEDIUM | Encoding detection (GBK/GB18030/UTF-8) + chapter regex. **[CN]** encoding is a real CN pain point. |

### Differentiators (Competitive Advantage)

Where Pillowtome wins. **[CN]-flagged items are the strategic moat** and should be over-invested relative to a generic reader.

| Feature | Value Proposition | Complexity | Notes / Dependencies |
|---------|-------------------|------------|----------------------|
| **[CN] CJK punctuation compression (标点挤压)** | The #1 tell of amateur vs. professional Chinese layout — collapse the visual gap around 、。，「」（）. | LOW (if webview modern) / HIGH (if custom) | Ship via CSS **`text-spacing-trim`** (in Chrome & Safari since 2024). Default it ON and tuned per CLREQ. Depends on modern webview. |
| **[CN] Mixed CJK+Latin auto-spacing (中英混排)** | Correct thin gap between 汉字 and Latin/digits ("盘古之白") without manual spaces. | LOW–MEDIUM | CSS **`text-autospace`** reached broad support Nov 2025. Provide toggle + fallback shim for old webviews. |
| **[CN] Kinsoku line-breaking (禁则处理)** | No line may start with 。，）」 or end with （「; correct CJK wrapping. | LOW | CSS `line-break: strict` + `word-break: normal`, tuned. Verify per-webview. |
| **[CN] Bundled CJK fonts + smart fallback** | Kills the "ugly tofu / mismatched fallback" pain point outright. Bundle LXGW WenKai, Source Han Sans/Serif, etc. | MEDIUM | Font packaging + per-glyph coverage-aware fallback chain (CJK Ext-B/C rare-char handling). Big install-size tradeoff → make packs optional-download. |
| **[CN] CJK-aware typographic defaults** | First-line indent 2 字符, no letter-spacing hacks, proper full-width quotes, sensible default line-height (~1.7–1.8 for CJK). | LOW | Pure CSS defaults + presets. Cheapest, highest-perceived-quality win. |
| **[CN] Tap/select-to-lookup dictionary (划词词典)** | Chinese has no spaces → tapping a "word" requires segmentation first. Offline CC-CEDICT + import StarDict/MDict. | HIGH | Depends on **word segmentation (jieba-class)** + dictionary parser + selection UI. Segmentation is the hard, differentiating part. |
| **[CN] Simplified⇄Traditional conversion (简繁转换)** | Read a 繁体 book in 简体 (or vice-versa) at render time. OpenCC phrase-level (not naive char map). | MEDIUM | OpenCC data/port (`opencc-jieba` for phrase accuracy). Render-time text transform hook. |
| **[CN] Pinyin / ruby annotation (注音)** | Learner & children's-book value; overlay pinyin above 汉字. | MEDIUM–HIGH | Needs segmentation + polyphone (多音字) handling + ruby rendering. Niche → post-v1. |
| **Paragraph / selection translation** | Readest sets the bar (DeepL/Yandex). Inline translate of CN↔EN. | MEDIUM | Pluggable provider; keep local-first/privacy stance (user-supplied key, opt-in). Not CJK-exclusive but high CN value. |
| **[CN] Vertical text (竖排 / 直排)** | Classical & Traditional titles; almost no cross-platform reader does it well. | MEDIUM–HIGH | foliate-js supports `writing-mode: vertical-rl`; pagination + tap zones + scrollbar must adapt. Differentiator, niche audience. |
| **Full WebDAV file sync (books + progress + annotations)** | Beyond Lithium (Drive, no files) — self-hosted, privacy-first, no proprietary cloud. This is the sync moat. | HIGH | Depends on library model + file-store abstraction + conflict resolution + stable locator. |
| **KOReader sync-protocol interop** | Plug into the existing self-host ecosystem; sync progress with KOReader devices (Readest already does). | MEDIUM | Implement kosync client: MD5 doc-hash identity + percentage/xpointer progress. Separate locator space from EPUB CFI. |
| **OPDS / Calibre catalog** | Pull from self-hosted Calibre-Web / OPDS servers — power-user library flow. | MEDIUM | OPDS feed parser + auth. Complements, doesn't replace, WebDAV. |
| **Reading statistics** | Streaks, time-read, pages/day — sticky engagement, KOReader-beloved. | MEDIUM | Depends on progress events + local time-tracking store. |
| **Series & collections** | Order a 20-volume 武侠/网文 series correctly; user shelves. | MEDIUM | Series metadata (Calibre `series`/`series_index`) + manual collections model. High CN value (long serialized novels). |
| **TTS (multilingual, incl. Mandarin)** | Readest ships it; foliate-js emits SSML. Hands-free reading. | MEDIUM–HIGH | Platform TTS (Android TTS / OS voices) + **[CN]** CJK sentence segmentation for prosody. PROJECT scopes full TTS product as later. |

### Anti-Features (Deliberately NOT in v1)

| Feature | Why Requested | Why Problematic | Alternative / Decision |
|---------|---------------|-----------------|------------------------|
| **Self-hosted central account cloud** | "One login, syncs everywhere." | Ops burden, privacy liability, contradicts local-first mandate. | WebDAV / self-host only (PROJECT out-of-scope). Account optional/none. |
| **DRM (Adobe ADEPT / Kindle) decryption** | "Read my purchased books." | Legal minefield, brittle, per-vendor cat-and-mouse. | Support only non-DRM / user-owned files. Document the boundary. |
| **iOS / Web official release (v1)** | "Cover every platform." | Doubles QA + store/review overhead pre-PMF. | Architecture stays extensible (webview core ports later). Deferred per PROJECT. |
| **Full-book DeepL translation** | Readest has it; "translate the whole novel." | Cost/quota, latency, quality liability, not the CN-reading moat. | Paragraph/selection translate only; full-book is v2+ (PROJECT names this explicitly). |
| **AI chapter/book summaries** | Trend-chasing; Readest ships it. | Cloud dependency, cost, off-mission vs. "clean reading". | Defer; if built, must be opt-in + BYO-key to keep privacy stance. |
| **Split-screen "Parallel Read"** | Readest showcase feature. | High layout complexity, low daily use, dilutes focus from CN core. | v2+ consideration; not MVP. |
| **Full audiobook (M4B/MP3) player product** | "It reads, why not listen." | A whole media subsystem; PROJECT scopes it out early. | TTS of text only (later phase). No audiobook library. |
| **Bookstore / content storefront** | Monetization temptation. | Turns a reader into a distribution/rights platform. | Out of scope by charter — reader, not store. |
| **Real-time collaborative annotations** | "Share highlights live." | CRDT/presence infra, tiny audience, conflicts with local-first. | Export/import annotations; async WebDAV sync only. |
| **Blanket auto-sync of large PDF libraries over WebDAV** | "Sync everything." | Bandwidth/storage blowups; big PDFs choke naive full-file sync. | Selective/on-demand file sync + always-sync of lightweight progress+annotation deltas. |
| **In-app font marketplace / cloud font fetch** | "More fonts!" | CSP/supply-chain surface, licensing risk. | Bundle vetted OFL CJK fonts + local user-font import only. |

---

## Feature Dependencies

```
EPUB reflow engine (foliate-js / webview)
   ├──enables──> Font/size/line-height/margins
   │                 └──enables──> [CN] CJK typographic defaults
   ├──enables──> Pagination↔scroll, columns, immersion
   ├──enables──> [CN] Punctuation compression / autospace / kinsoku
   │                 └──requires──> MODERN webview (text-spacing-trim, text-autospace)
   ├──enables──> [CN] Vertical text (writing-mode)
   └──enables──> Search-in-book ──requires──> [CN] CJK segmentation (no word boundaries)

Stable locator (EPUB CFI / progress fraction)
   ├──requires──> Reading progress persistence
   ├──requires──> Highlights ── requires ──> Notes
   ├──requires──> Bookmarks
   └──is the linchpin of ──> WebDAV sync  &  KOReader sync

Metadata + cover extraction (per format)
   ├──enables──> Library scan/import, sort/filter, cover shelf
   └──enables──> Series & collections

WebDAV full sync
   ├──requires──> Library data model + file-store abstraction
   ├──requires──> Stable locator (progress) + annotation data model
   └──requires──> Conflict resolution (last-writer / furthest-progress / merge)

[CN] Dictionary lookup (划词)
   ├──requires──> Text selection UI + tap handling
   ├──requires──> [CN] Word segmentation (jieba-class)   <-- also feeds pinyin & CJK search
   └──requires──> Dictionary parser (CC-CEDICT / StarDict / MDict)

[CN] Pinyin ruby ──requires──> segmentation + polyphone resolution + ruby render
[CN] Simp/Trad ──requires──> OpenCC phrase data + render-time transform hook
TTS ──requires──> text extraction + platform TTS + [CN] sentence segmentation
Reading stats ──requires──> progress events + time-tracking store

CONFLICTS / TENSIONS
[PDF fixed-layout]  ⟂  font/size/line-height/CJK spacing  (reflow controls don't apply)
[Vertical text]     ⟂  horizontal pagination assumptions   (tap zones, scrollbar, columns differ)
[Full file sync]    ⟂  large PDF libraries                 (bandwidth/storage)
[Old Android WebView] ⟂ text-spacing-trim/text-autospace   (CN typography silently degrades)
```

### Dependency Notes

- **Stable locator is the single highest-leverage dependency.** Progress, all annotations, WebDAV sync, and KOReader interop all resolve to "where am I in this book, reliably, across re-renders and platforms." Pick the locator scheme (EPUB CFI + percentage) in Phase 1; retrofitting later forces a Lithium-style hard refactor.
- **CN typography leans on a modern webview.** `text-spacing-trim` (2024) and `text-autospace` (broad Nov 2025) give punctuation compression and CJK/Latin spacing nearly for free — *if* the host webview is current. Android System WebView and the desktop webviews (WebView2 / WebKitGTK / WKWebView) vary; treat "guaranteed CJK CSS support" as an architecture constraint (bundle/ship a known-good engine or feature-detect + JS shim). This is a genuine pitfall.
- **Word segmentation is the CN moat's foundation.** Because Chinese lacks spaces, tap-to-define, CJK search relevance, and pinyin all sit on top of a segmenter (jieba-class or `Intl.Segmenter` where adequate). Build it once, reuse three ways.
- **Metadata/cover extraction is per-format** — each new format (MOBI, PDF, TXT) re-pays this cost; sequence formats so library features don't regress.
- **KOReader sync ≠ WebDAV sync.** KOReader identifies documents by MD5 hash and tracks furthest progress only; it is a *separate, additive* interop path, not a substitute for full file+annotation sync. Different identity + locator space.
- **PDF conflicts with the CN typography story.** Fixed-layout PDF ignores font/spacing/kinsoku — so CN differentiation applies to reflow formats (EPUB/TXT/MOBI) only. Set expectations; don't over-invest in PDF for v1.

---

## MVP Definition

### Launch With (v1 — "能读、能标、能换肤、能同步中文")

The vertical slice that proves the thesis: *clean Chinese reading, everywhere, self-hosted.*

- [ ] **EPUB reflow engine** (webview/foliate-js class) — the hard core.
- [ ] **TXT support** — cheap, and the Chinese web-novel entry point (with GBK/GB18030/UTF-8 detection).
- [ ] **Library scan/import + covers + title/author metadata + sort/filter** — a real shelf.
- [ ] **Pagination↔scroll, font/size/line-height/margins, day/night/sepia, immersive mode** — baseline comfort.
- [ ] **[CN] CJK typographic core** — punctuation compression (`text-spacing-trim`), mixed CJK+Latin autospace, kinsoku, 2-char first-line indent, bundled CJK font + smart fallback. **This is the reason to exist — must be visibly better than Readest/Lithium on day 1.**
- [ ] **Highlights + notes + bookmarks** on a stable locator.
- [ ] **Reading progress persistence** (stable CFI+percentage locator).
- [ ] **Search-in-book (CJK-aware)** and **custom user fonts**.
- [ ] **WebDAV sync of progress + annotations** (+ selective book-file sync), with a defined conflict policy (furthest-progress for reading position, last-writer-wins/merge for annotations).

### Add After Validation (v1.x)

- [ ] **MOBI / KF8 (AZW3)** — once EPUB pipeline + metadata layer are stable (foliate-js already parses them).
- [ ] **[CN] Tap-to-lookup dictionary** (segmentation + CC-CEDICT + StarDict/MDict import) — the marquee CN power feature; trigger once selection + segmentation land.
- [ ] **[CN] Simplified⇄Traditional (OpenCC)** — quick win after render-transform hook exists.
- [ ] **KOReader sync interop** — after core WebDAV sync is proven; opens the self-host ecosystem.
- [ ] **OPDS / Calibre catalog** — when users ask to pull from existing servers.
- [ ] **Series & collections**, **reading statistics** — engagement/retention once the core is sticky.
- [ ] **Paragraph/selection translation** (opt-in, BYO-key).

### Future Consideration (v2+)

- [ ] **PDF** — high effort, conflicts with CN typography story; do it when the reflow product is mature. (foliate-js PDF is experimental.)
- [ ] **[CN] Vertical text (竖排)** — niche but a strong flex once horizontal is polished.
- [ ] **[CN] Pinyin/ruby annotation** — needs polyphone handling; learner niche.
- [ ] **TTS (Mandarin-quality)** — PROJECT defers full TTS; foliate-js SSML makes a later add clean.
- [ ] **CBZ / FB2** — cheap via foliate-js when a comic/format audience appears.
- [ ] **iOS / Web** — architecture-ready port; defer per charter.
- [ ] **AI summaries / Parallel Read / full-book translation** — only if PMF demands and privacy stance preserved (opt-in, BYO-key).

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|-----------|---------------------|----------|
| EPUB reflow engine | HIGH | HIGH | P1 |
| **[CN] CJK typography core (compression/autospace/kinsoku/fonts/defaults)** | HIGH | MEDIUM | **P1** |
| Library scan/import + covers + metadata + sort/filter | HIGH | MEDIUM | P1 |
| Pagination↔scroll / font / theme / immersion | HIGH | MEDIUM | P1 |
| Highlights + notes + bookmarks (stable locator) | HIGH | MEDIUM | P1 |
| Reading progress persistence | HIGH | MEDIUM | P1 |
| WebDAV sync (progress + annotations + selective files) | HIGH | HIGH | P1 |
| TXT (with CN encoding detection) | MEDIUM | LOW | P1 |
| Search-in-book (CJK-aware) | MEDIUM | MEDIUM | P1 |
| Custom user fonts | MEDIUM | LOW | P1 |
| **[CN] Tap-to-lookup dictionary (segmentation + dict)** | HIGH | HIGH | P2 |
| **[CN] Simplified⇄Traditional (OpenCC)** | MEDIUM | MEDIUM | P2 |
| MOBI / KF8 | MEDIUM | MEDIUM | P2 |
| KOReader sync interop | MEDIUM | MEDIUM | P2 |
| OPDS / Calibre | MEDIUM | MEDIUM | P2 |
| Series & collections | MEDIUM | MEDIUM | P2 |
| Reading statistics | MEDIUM | MEDIUM | P2 |
| Paragraph/selection translation (opt-in) | MEDIUM | MEDIUM | P2 |
| PDF | MEDIUM | HIGH | P3 |
| **[CN] Vertical text (竖排)** | LOW–MEDIUM | HIGH | P3 |
| **[CN] Pinyin / ruby** | LOW | HIGH | P3 |
| TTS (Mandarin) | MEDIUM | HIGH | P3 |
| CBZ / FB2 | LOW | LOW | P3 |
| AI summaries / Parallel Read / full-book translate | LOW | HIGH | P3 |

**Priority key:** P1 = must-have for launch · P2 = should-have, add post-validation · P3 = nice-to-have / v2+.

---

## Competitor Feature Analysis

| Feature | Lithium | Readest | KOReader | **Pillowtome plan** |
|---------|---------|---------|----------|---------------------|
| Formats | EPUB only | EPUB/MOBI/KF8/FB2/CBZ/TXT/PDF | EPUB/PDF/CBZ/TXT/MOBI + many | EPUB+TXT (v1) → MOBI/KF8 → PDF (arch. not EPUB-locked) |
| Engine | Native Android | foliate-js (webview) | Native (MuPDF/crengine) | Webview reflow core (foliate-js class), shared desktop+Android |
| Pagination + scroll | Yes | Yes | Yes | Yes (P1) |
| Themes | Day/night/sepia (+custom in Pro) | Font/theme/color | Extensive | Day/night/sepia + CN-tuned presets (P1) |
| Highlights/notes/bookmarks | Yes | Yes | Yes | Yes on stable locator (P1) |
| **CJK punctuation/spacing** | Minimal | Bundled CN fonts; relies on webview | crengine CJK (decent) | **Default-on `text-spacing-trim` + `text-autospace` + kinsoku, tuned per CLREQ — the moat (P1)** |
| **CJK font fallback** | Weak | Bundles LXGW/MiSans/Source Han | Configurable | **Smart coverage-aware fallback + optional font packs (P1)** |
| **Dictionary (划词)** | None (requested) | Look-up + StarDict/MDict | StarDict/MDict | **Segmentation-backed tap-lookup + CC-CEDICT/StarDict/MDict (P2)** |
| **Simp/Trad, pinyin, vertical** | No | Partial | Some | **OpenCC (P2), pinyin & 竖排 (P3) — CN depth** |
| Sync — progress/annotations | Google Drive (Pro) | Full cloud + KOReader | kosync server | **WebDAV self-host, no proprietary cloud (P1)** |
| Sync — book files | No | Yes | via filesystem | **Selective WebDAV file sync (P1)** |
| OPDS/Calibre | No | Yes | Yes (OPDS) | P2 |
| TTS | No | Yes | Yes | P3 (defer per charter) |
| Translation | No | DeepL/Yandex + full-book | Some | Paragraph/selection opt-in (P2); no full-book v1 |
| License / stance | Freemium, closed | AGPL, cloud tier | GPLv3 | Local-first, privacy-first, no ads; license TBD (AGPL-contagion audit if reusing foliate-js) |

**Positioning:** Match Lithium's clean immersive baseline, approach Readest's capability surface, adopt KOReader's self-host sync ethos — and **out-execute all three on Chinese typography, CJK font fallback, and offline dictionary/segmentation**, while deliberately *not* chasing Readest's cloud-AI-parallel-read breadth.

---

## Sources

- Readest — GitHub README & site (features, formats, tech stack, CJK fonts, sync/KOReader/OPDS): https://github.com/readest/readest , https://readest.com/
- foliate-js — GitHub README (formats, pagination, scroll/paginate, RTL, vertical writing, fixed-layout, TTS SSML, search, overlay annotations): https://github.com/johnfactotum/foliate-js
- Foliate vertical-text issue #63 (RTL + vertical writing support): https://github.com/johnfactotum/foliate/issues/63
- KOReader progress-sync wiki + kosync server (MD5 doc-hash identity, furthest progress, self-host): https://github.com/koreader/koreader/wiki/Progress-sync , https://github.com/koreader/koreader-sync-server
- Lithium — Google Play / MobileRead wiki (EPUB-only, Drive Pro sync of progress+annotations not files, no dictionary): https://wiki.mobileread.com/wiki/Lithium
- CSS `text-spacing-trim` (CJK punctuation kerning; Chrome/Safari 2024) — MDN + Chrome i18n blog: https://developer.mozilla.org/en-US/docs/Web/CSS/text-spacing-trim , https://developer.chrome.com/blog/css-i18n-features
- CSS `text-autospace` (CJK/Latin spacing; broad support Nov 2025) — MDN: https://developer.mozilla.org/en-US/docs/Web/CSS/text-autospace
- OpenCC (Simplified/Traditional, phrase-level, opencc-jieba): https://github.com/BYVoid/OpenCC
- Jieba (Chinese word segmentation for lookup/pinyin/search): https://github.com/fxsjy/jieba
- CLREQ — W3C Requirements for Chinese Text Layout (kinsoku, punctuation, ruby reference)

---
*Feature research for: cross-platform CJK-first ebook reader (枕籍 / Pillowtome)*
*Researched: 2026-07-09*
