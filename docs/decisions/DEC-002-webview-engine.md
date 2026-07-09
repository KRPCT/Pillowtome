# DEC-002: WebView-Engine Strategy — system WebView + runtime feature-detection + owned JS shim

- **Status:** Accepted
- **Date:** 2026-07-09
- **Phase:** 1 (Foundation & Cross-Platform Skeleton)
- **Sources:** CONTEXT.md D-04, D-12; PITFALLS.md §3 (Blink↔WebKit CJK CSS divergence); STACK.md; ARCHITECTURE.md

## Statement

Pillowtome renders through **each platform's system WebView** — WebView2/Blink on
Windows, Android System WebView/Blink on Android, WKWebView/WebKit on macOS, and
WebKitGTK on Linux. We **do not bundle a fixed Chromium** in v1. To mitigate the
Blink↔WebKit divergence in CJK CSS (the differentiator surface — `text-autospace`,
`text-spacing`, `hanging-punctuation`, `line-break`, vertical writing, ruby,
emphasis), we rely on:

1. **Runtime feature-detection** — probe the actual CSS capability at runtime,
   never assume it from the OS/API level.
2. **An owned JS text-shaping fallback shim** — our own code that fills gaps
   (e.g. autospace) where the WebView lacks native support.
3. **A golden-image visual-regression corpus** across Blink and WebKit — the
   harness is *stubbed* in Phase 1 and *exercised* in Phase 3 (CJK typography).

A **bundled fixed Chromium is a documented escape hatch only**, to be built in
P3 solely if CJK parity proves infeasible on system WebViews.

## Rationale

- The **WebView is the best CJK text engine available for free**: rendering
  EPUB HTML/CSS in the system WebView inherits `writing-mode: vertical-rl`,
  autospace, punctuation compression / kinsoku, `@font-face` + `lang` fallback,
  ruby, and emphasis at zero engineering cost. No other approach gives all of
  this without building a text engine.
- **System WebViews keep binaries small and local-first** and match the
  Readest-proven production shape.
- **CJK-CSS support tracks the System WebView version, not the Android API
  level** (D-12): a modern WebView on an old device can be current, and vice
  versa. Therefore capability must be **feature-detected at runtime**, not
  inferred from the platform version.
- Blink and WebKit diverge on newer CJK CSS; an owned shim + a golden-image
  corpus catch regressions and paper over gaps without abandoning the
  system-WebView model.

## Consequences

- No bundled Chromium ships in v1; binaries stay small and each platform tracks
  its own WebView.
- Phase 1 stubs the feature-detection hook and the golden-image harness; Phase 3
  builds the CJK shim and exercises the visual-regression corpus across both
  engines.
- On old/AOSP/de-Googled devices with a lagging System WebView, the JS shim is
  the fallback; if parity is ultimately unreachable, the bundled-Chromium escape
  hatch is invoked (a deliberate, documented last resort — not the default).
- Any CJK feature must degrade gracefully behind a runtime capability check.

## References

- D-04 (system WebView, no bundled Chromium in v1; feature-detect + JS shim +
  golden-image harness; bundled Chromium = escape hatch).
- D-12 (CJK-CSS tracks WebView version, not API level → feature-detect at runtime).
- PITFALLS.md §3 (Blink↔WebKit CJK CSS divergence).
