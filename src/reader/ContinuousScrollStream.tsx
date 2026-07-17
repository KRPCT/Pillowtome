/**
 * Continuous multi-section scroll for EPUB (READ-01 scrolled).
 *
 * foliate-js only renders ONE spine section at a time and has no continuous
 * multi-section scroll. This stream stacks linear sections in one overflow
 * container so chapter boundaries feel seamless.
 *
 * Position model (deliberately simple):
 * - Primary: spineIndex + top-edge offsetFraction (0..1)
 * - Optional: real CFI for finer mid-section restore
 *
 * Jump is a one-shot command via jumpKey. Progress reporting never mutates
 * jump targets (parent SSOT owns position).
 *
 * Clean-room — no Readest source.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { clamp01 } from "./reading-position";
import {
  resolveCfiScrollTop,
  selectionCfi,
  spineFromCfi,
  visibleRangeCfi,
} from "./scroll-cfi";
import { installAutospaceShim } from "./cjk-autospace-shim";
import {
  clearHighlights,
  HIGHLIGHT_CSS,
  paletteColor,
  registerHighlight,
  supportsCssHighlight,
  type HighlightType,
  type HighlightWindow,
} from "./css-highlight";
import { resolveAnchor } from "./anchor-resolver";
import type { AnnotationRow } from "./annotation-store";
import { Overlayer } from "../vendor/foliate-js/overlayer.js";
import {
  capWindow,
  extendWindow,
  MAX_LOADED,
  sameWindow,
  seedWindow,
} from "./scroll-window";

/** Minimal shape of the vendored foliate `Overlayer` (WebView < 105 fallback). */
interface OverlayerLike {
  element: SVGElement;
  add(key: string, range: Range, draw: unknown, opts: unknown): void;
  remove(key: string): void;
  redraw(): void;
}

/** A settled scroll-mode text selection, surfaced for the 05-04 bubble/store. */
export interface ScrollSelection {
  /** Range-CFI (selectionCfi over the section base CFI). */
  cfi: string;
  /** Selection client rects in the iframe's own content viewport. */
  rects: DOMRect[];
  /** The section iframe (05-04 maps iframe→page coords). */
  iframe: HTMLIFrameElement;
  doc: Document;
  linearIndex: number;
}

export interface ContinuousSection {
  /** Spine index in book.sections */
  index: number;
  load: () => string | Promise<string>;
  unload?: () => void;
  linear?: string;
  cfi?: string;
  id?: string;
}

export interface ContinuousScrollStreamProps {
  sections: ContinuousSection[];
  /** Start linear index (0-based into linear sections). */
  initialLinearIndex?: number;
  /** Start offset within section 0..1 (top-edge). */
  initialOffsetFraction?: number;
  /** Optional real CFI refine on first mount. */
  initialCfi?: string | null;
  /** Increment to apply a jump (TOC / resume / mode-switch). */
  jumpKey?: number;
  /** Spine index target for jumpKey. */
  targetSpineIndex?: number | null;
  /** Offset 0..1 for jumpKey (TOC uses 0). */
  targetOffsetFraction?: number;
  /** Optional real CFI for jumpKey. */
  targetCfi?: string | null;
  readingCss: string;
  /**
   * When true, install reversible 盘古之白 shim after CSS inject (D-36/D-37).
   * Parent gates with shouldInstallAutospaceShim(prefs, caps).
   */
  autospaceShimEnabled?: boolean;
  className?: string;
  onTap?: () => void;
  /**
   * An `a[href]` was clicked inside a section. The parent resolves the href
   * (internal → jump, external → open) — foliate's own link handling only runs
   * on the paginated renderer, not these scroll-mode iframes.
   */
  onLinkClick?: (href: string, fromLinearIdx: number) => void;
  onPrimarySectionChange?: (spineIndex: number) => void;
  /**
   * Progress observation only. Parent must NOT treat this as a jump command.
   */
  onProgress?: (
    spineIndex: number,
    offsetFraction: number,
    cfi: string | null,
  ) => void;
  /**
   * The work's annotations (memoized list from annotation-store; small rows, no
   * book bytes). Drawn lazily per section as sections (re)load — never bulk on
   * open (Pitfall 9). Changing this redraws the loaded sections.
   */
  annotations?: AnnotationRow[];
  /**
   * A non-collapsed selection settled in a section (or null on dismiss). The
   * 05-04 shell opens the bubble + writes the store; this plan only emits.
   */
  onSelection?: (sel: ScrollSelection | null) => void;
  /** Imperative controller registered on mount (avoids jumpKey remount races). */
  onReady?: (api: ContinuousScrollApi | null) => void;
}

/** Resolves a DOM anchor within a target section's document (foliate link nav). */
export type ScrollAnchorResolver = (doc: Document) => Element | null;

export interface ContinuousScrollApi {
  jumpTo: (
    spineIndex: number,
    offsetFraction?: number,
    cfi?: string | null,
    anchor?: ScrollAnchorResolver | null,
  ) => void;
  /** Re-draw annotations for every loaded section (after a new highlight). */
  redrawAnnotations: () => void;
}

const PRELOAD_PX = 800;
const TAP_SLOP = 12;
/** Keep re-pinning a jump on reflow for this long, then release. Late image/font
 *  loads commonly shift content well past the old 450ms window, so hold longer. */
const JUMP_SETTLE_MS = 2500;
/** A scroll within this window of a user gesture is treated as user-driven and
 *  abandons a pending jump; layout-induced scrolls outside it never cancel it. */
const USER_SCROLL_WINDOW_MS = 250;
/** Injected --pillow-vh = scroller clientHeight * this (a little breathing room). */
const PILLOW_VH_FACTOR = 0.94;

/** Run a non-urgent callback when the main thread is idle (falls back to a macrotask).
 *  The visible-range CFI walk is O(nodes) — deferring it keeps it off the frame
 *  that fires when the user stops scrolling (the post-scroll hitch). */
const onIdle: (cb: () => void) => void =
  typeof (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback ===
  "function"
    ? (cb) =>
        (globalThis as unknown as {
          requestIdleCallback: (cb: () => void, o?: { timeout: number }) => void;
        }).requestIdleCallback(cb, { timeout: 500 })
    : (cb) => setTimeout(cb, 0);

export function ContinuousScrollStream({
  sections: allSections,
  initialLinearIndex = 0,
  initialOffsetFraction = 0,
  initialCfi = null,
  jumpKey = 0,
  targetSpineIndex = null,
  targetOffsetFraction = 0,
  targetCfi = null,
  readingCss,
  autospaceShimEnabled = false,
  className,
  onTap,
  onLinkClick,
  onPrimarySectionChange,
  onProgress,
  annotations,
  onSelection,
  onReady,
}: ContinuousScrollStreamProps) {
  const linear = useMemo(
    () => allSections.filter((s) => s.linear !== "no"),
    [allSections],
  );

  const spineToLinear = useMemo(() => {
    const m = new Map<number, number>();
    linear.forEach((s, i) => m.set(s.index, i));
    return m;
  }, [linear]);

  const startIdx = Math.max(
    0,
    Math.min(initialLinearIndex, Math.max(0, linear.length - 1)),
  );

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [loaded, setLoaded] = useState<number[]>(() => {
    const set = new Set<number>([startIdx]);
    if (startIdx > 0) set.add(startIdx - 1);
    if (startIdx < linear.length - 1) set.add(startIdx + 1);
    return [...set].sort((a, b) => a - b);
  });
  const [urlTick, setUrlTick] = useState(0);
  const urlsRef = useRef<Map<number, string>>(new Map());
  const heightsRef = useRef<Map<number, number>>(new Map());
  const loadingRef = useRef<Set<number>>(new Set());
  const primaryRef = useRef<number>(startIdx);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const linearRef = useRef(linear);
  const loadedRef = useRef<number[]>([]);
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onProgressRef = useRef(onProgress);
  const onPrimaryRef = useRef(onPrimarySectionChange);
  const onLinkClickRef = useRef(onLinkClick);
  const onSelectionRef = useRef(onSelection);
  const annotationsRef = useRef<AnnotationRow[]>(annotations ?? []);
  /** Per-section foliate Overlayer (WebView < 105 fallback); keyed by linearIdx. */
  const overlayersRef = useRef<Map<number, OverlayerLike>>(new Map());
  const targetOffsetRef = useRef(targetOffsetFraction);
  const targetCfiRef = useRef(targetCfi);
  const targetSpineRef = useRef(targetSpineIndex);
  const pendingJumpRef = useRef<{
    linearIdx: number;
    offsetFraction: number;
    cfi: string | null;
    anchor?: ScrollAnchorResolver | null;
  } | null>({
    linearIdx: startIdx,
    offsetFraction: clamp01(initialOffsetFraction),
    cfi: initialCfi,
  });
  const jumpStableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyingJumpRef = useRef(false);
  const lastJumpKeyRef = useRef(jumpKey);
  /** Timestamp (performance.now) of the last user scroll gesture. */
  const userGestureAtRef = useRef(0);
  /** Safety timer that lifts the jump veil even if the target never lands. */
  const veilTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Pending scrollTop compensation (px) for sections evicted ABOVE the viewport
   *  when the window is capped — applied post-commit so the view never jumps. */
  const pendingTopEvictRef = useRef(0);

  linearRef.current = linear;
  loadedRef.current = loaded;
  onProgressRef.current = onProgress;
  onPrimaryRef.current = onPrimarySectionChange;
  onLinkClickRef.current = onLinkClick;
  onSelectionRef.current = onSelection;
  annotationsRef.current = annotations ?? [];
  targetOffsetRef.current = targetOffsetFraction;
  targetCfiRef.current = targetCfi;
  targetSpineRef.current = targetSpineIndex;

  /**
   * Guarantee `loaded` is a CONTIGUOUS band that includes the jump target.
   * Near jumps extend the current window; a FAR jump reseeds a fresh band at the
   * target (dropping the faraway old window) so cumulative-height jump math stays
   * correct without loading every section in between. Contiguity is the invariant
   * offsetOfLinear()/tryApplyJump depend on — a sparse `loaded` set was the cause
   * of far TOC jumps landing wrong / never applying.
   */
  const seedWindowForJump = useCallback((targetLinearIdx: number) => {
    const len = linearRef.current.length;
    setLoaded((prev) => {
      const next = seedWindow(prev, targetLinearIdx, len);
      return sameWindow(next, prev) ? prev : next;
    });
  }, []);

  // Jump/resume veil: hide the scroller while the window reseeds + the target
  // loads + scroll is applied, then reveal at the landing (no blank→pop flicker).
  const beginJumpVeil = useCallback(() => {
    scrollerRef.current?.classList.add("reader-continuous-scroll--jumping");
    if (veilTimerRef.current) clearTimeout(veilTimerRef.current);
    // Never leave the content hidden if the target section never loads.
    veilTimerRef.current = setTimeout(() => {
      veilTimerRef.current = null;
      scrollerRef.current?.classList.remove("reader-continuous-scroll--jumping");
    }, 1200);
  }, []);
  const endJumpVeil = useCallback(() => {
    if (veilTimerRef.current) {
      clearTimeout(veilTimerRef.current);
      veilTimerRef.current = null;
    }
    const el = scrollerRef.current;
    if (el) {
      requestAnimationFrame(() =>
        el.classList.remove("reader-continuous-scroll--jumping"),
      );
    }
  }, []);

  const jumpTo = useCallback(
    (
      spineIndex: number,
      offsetFraction = 0,
      cfi: string | null = null,
      anchor: ScrollAnchorResolver | null = null,
    ) => {
      const linearIdx = spineToLinear.get(spineIndex);
      if (linearIdx == null) {
        console.warn(
          "[ContinuousScrollStream] jumpTo: spine not linear",
          spineIndex,
        );
        return;
      }
      // Supersede any in-flight jump: a stale settle timer would otherwise fire
      // ~JUMP_SETTLE_MS later and null out THIS pending jump mid-flight (rapid
      // repeated TOC jumps cancelling each other).
      if (jumpStableTimerRef.current) {
        clearTimeout(jumpStableTimerRef.current);
        jumpStableTimerRef.current = null;
      }
      pendingJumpRef.current = {
        linearIdx,
        offsetFraction: clamp01(offsetFraction),
        cfi,
        anchor,
      };
      beginJumpVeil();
      seedWindowForJump(linearIdx);
      setUrlTick((t) => t + 1);
    },
    [spineToLinear, seedWindowForJump, beginJumpVeil],
  );


  const ensureUrl = useCallback(async (linearIdx: number) => {
    if (urlsRef.current.has(linearIdx)) return urlsRef.current.get(linearIdx)!;
    if (loadingRef.current.has(linearIdx)) return null;
    const sec = linearRef.current[linearIdx];
    if (!sec) return null;
    loadingRef.current.add(linearIdx);
    try {
      const url = await Promise.resolve(sec.load());
      urlsRef.current.set(linearIdx, url);
      setUrlTick((t) => t + 1);
      return url;
    } catch (err) {
      console.warn("[ContinuousScrollStream] load failed", linearIdx, err);
      return null;
    } finally {
      loadingRef.current.delete(linearIdx);
    }
  }, []);

  const ensureLoadedAround = useCallback((linearIdx: number) => {
    setLoaded((prev) => {
      const next = new Set(prev);
      const from = Math.max(0, linearIdx - 2);
      const to = Math.min(linearRef.current.length - 1, linearIdx + 1);
      for (let i = from; i <= to; i++) next.add(i);
      const sorted = [...next].sort((a, b) => a - b);
      if (
        sorted.length === prev.length &&
        sorted.every((v, i) => v === prev[i])
      ) {
        return prev;
      }
      return sorted;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const i of loaded) {
        if (cancelled) return;
        if (!urlsRef.current.has(i)) await ensureUrl(i);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded, ensureUrl]);

  // When `loaded` SHRINKS (a far jump reseeds a fresh band, dropping the old
  // window), free the dropped sections' docs/blobs — otherwise every jumped-away
  // section leaks a live iframe document for the session. Only removed sections
  // are touched, so this never fights the re-load effect above.
  const prevLoadedRef = useRef<number[]>([]);
  useEffect(() => {
    const prev = prevLoadedRef.current;
    prevLoadedRef.current = loaded;
    if (!prev.length) return;
    const keep = new Set(loaded);
    for (const i of prev) {
      if (keep.has(i)) continue;
      if (urlsRef.current.has(i)) {
        try {
          linearRef.current[i]?.unload?.();
        } catch {
          /* soft-fail */
        }
        urlsRef.current.delete(i);
      }
      loadingRef.current.delete(i);
      heightsRef.current.delete(i);
      // Dispose the dropped section's autospace observer too — else its shim
      // MutationObserver leaks for the session (only re-cleared if revisited).
      const dispose = autospaceDisposersRef.current.get(String(i));
      if (dispose) {
        try {
          dispose();
        } catch {
          /* soft-fail */
        }
        autospaceDisposersRef.current.delete(String(i));
      }
    }
  }, [loaded]);

  /** Per-iframe autospace disposers (key = linear index string). */
  const autospaceDisposersRef = useRef<Map<string, () => void>>(new Map());

  const clearAutospaceFor = useCallback((key: string) => {
    const dispose = autospaceDisposersRef.current.get(key);
    if (dispose) {
      try {
        dispose();
      } catch {
        /* soft-fail */
      }
      autospaceDisposersRef.current.delete(key);
    }
  }, []);

  const injectStyles = useCallback(
    (iframe: HTMLIFrameElement) => {
      const doc = iframe.contentDocument;
      if (!doc?.head) return;
      let style = doc.getElementById(
        "pillow-reading-css",
      ) as HTMLStyleElement | null;
      if (!style) {
        style = doc.createElement("style");
        style.id = "pillow-reading-css";
        doc.head.appendChild(style);
      }
      // Annotation ::highlight() rules ride the same per-iframe style block as the
      // reading CSS (the per-window CSS.highlights registry needs them here).
      style.textContent = `${readingCss}\n${HIGHLIGHT_CSS}`;

      // Real viewport height (px) for image max-height in scroll mode: vh/svh
      // inside a height-expanded iframe mean the WHOLE content height, not one
      // screen, so we feed the outer scroller's clientHeight explicitly.
      const vh = scrollerRef.current?.clientHeight ?? 0;
      if (vh > 0) {
        doc.documentElement.style.setProperty(
          "--pillow-vh",
          `${Math.round(vh * PILLOW_VH_FACTOR)}px`,
        );
      }

      const key = iframe.dataset.linearIndex ?? "";
      clearAutospaceFor(key);
      // 简繁转换 / 词不拆行 are applied to section content pre-render via foliate's
      // transformTarget (FoliateView) — so the stream only installs 盘古之白 here.
      if (autospaceShimEnabled && key) {
        try {
          autospaceDisposersRef.current.set(key, installAutospaceShim(doc));
        } catch {
          /* silent degrade D-38 */
        }
      }

      const h = Math.max(
        doc.documentElement?.scrollHeight ?? 0,
        doc.body?.scrollHeight ?? 0,
        1,
      );
      iframe.style.height = `${h}px`;
      const idx = Number(iframe.dataset.linearIndex);
      if (Number.isFinite(idx)) heightsRef.current.set(idx, h);
    },
    [readingCss, autospaceShimEnabled, clearAutospaceFor],
  );

  // Re-inject reading CSS to all live iframes ONLY when the CSS/shim actually
  // changes (user prefs) — NOT on every section load (urlTick/loaded), which was
  // an O(loaded) forced-reflow storm. New iframes get their CSS via onLoad.
  // A ResizeObserver re-injects on scroller resize to refresh --pillow-vh.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const injectAll = () =>
      root.querySelectorAll("iframe[data-linear-index]").forEach((node) => {
        injectStyles(node as HTMLIFrameElement);
      });
    injectAll();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => injectAll());
    ro.observe(root);
    return () => ro.disconnect();
  }, [readingCss, autospaceShimEnabled, injectStyles]);

  useEffect(() => {
    const urls = urlsRef.current;
    const secs = linearRef.current;
    return () => {
      for (const dispose of autospaceDisposersRef.current.values()) {
        try {
          dispose();
        } catch {
          /* soft-fail */
        }
      }
      autospaceDisposersRef.current.clear();
      // Free every loaded section's doc/blob on teardown (foliate revokes via
      // unload) — previously leaked one live document per visited section.
      for (const i of urls.keys()) {
        try {
          secs[i]?.unload?.();
        } catch {
          /* soft-fail */
        }
      }
      urls.clear();
    };
  }, []);

  const offsetOfLinear = useCallback((linearIdx: number, sorted: number[]) => {
    let acc = 0;
    for (const i of sorted) {
      if (i >= linearIdx) break;
      acc += heightsRef.current.get(i) ?? 0;
    }
    return acc;
  }, []);

  const iframeForLinear = useCallback((linearIdx: number) => {
    const root = scrollerRef.current;
    if (!root) return null;
    return root.querySelector<HTMLIFrameElement>(
      `iframe[data-linear-index="${linearIdx}"]`,
    );
  }, []);

  const tryApplyJump = useCallback(() => {
    const jump = pendingJumpRef.current;
    if (!jump) return;
    const el = scrollerRef.current;
    if (!el) return;
    if (!loaded.includes(jump.linearIdx)) return;
    if (!heightsRef.current.has(jump.linearIdx)) return;

    const sorted = [...loaded].sort((a, b) => a - b);
    for (const i of sorted) {
      if (i >= jump.linearIdx) break;
      if (!heightsRef.current.has(i)) return;
    }

    const base = offsetOfLinear(jump.linearIdx, sorted);
    const h = Math.max(1, heightsRef.current.get(jump.linearIdx) ?? 0);
    let target = base + clamp01(jump.offsetFraction) * h;

    if (jump.cfi) {
      const iframe = iframeForLinear(jump.linearIdx);
      const doc = iframe?.contentDocument;
      if (iframe && doc) {
        const cfiTarget = resolveCfiScrollTop(doc, jump.cfi, iframe, el);
        if (cfiTarget != null) target = cfiTarget;
      }
    } else if (jump.anchor) {
      // Internal link (filepos:/kindle:/#frag) → scroll to the resolved element
      // within the target section, not just the section top.
      const iframe = iframeForLinear(jump.linearIdx);
      const doc = iframe?.contentDocument;
      const el2 = doc ? jump.anchor(doc) : null;
      if (doc && el2) {
        const top =
          el2.getBoundingClientRect().top -
          doc.documentElement.getBoundingClientRect().top;
        if (Number.isFinite(top)) target = base + Math.max(0, top);
      }
    }

    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    applyingJumpRef.current = true;
    el.scrollTop = Math.max(0, Math.min(maxScroll, target));
    requestAnimationFrame(() => {
      applyingJumpRef.current = false;
    });
    primaryRef.current = jump.linearIdx;
    endJumpVeil();

    // Hold the jump open and re-pin it on every reflow (this effect re-runs on
    // urlTick/loaded and each iframe onLoad). The timer resets each re-pin, so it
    // only releases ~JUMP_SETTLE_MS after layout finally settles — surviving late
    // image/font loads that used to drift the landing after the old 450ms.
    if (jumpStableTimerRef.current) clearTimeout(jumpStableTimerRef.current);
    jumpStableTimerRef.current = setTimeout(() => {
      jumpStableTimerRef.current = null;
      pendingJumpRef.current = null;
      endJumpVeil();
    }, JUMP_SETTLE_MS);
  }, [loaded, offsetOfLinear, iframeForLinear, endJumpVeil]);

  useEffect(() => {
    tryApplyJump();
  }, [tryApplyJump, urlTick, loaded]);

  // One-shot jump command.
  // IMPORTANT: do not rely on jumpKey edge detection alone across remounts.
  // When the parent remounts us with a new key AND a new jumpKey in the same
  // render, lastJumpKeyRef is initialized to that jumpKey and the edge is lost.
  // So: always (re)seed pendingJump from target* whenever jumpKey changes OR
  // when we mount with a non-zero initialLinearIndex/offset/cfi.
  useEffect(() => {
    const spine = targetSpineRef.current;
    const jumpChanged = jumpKey !== lastJumpKeyRef.current;
    lastJumpKeyRef.current = jumpKey;

    // Mount-time seed is already in pendingJumpRef from useRef initializer.
    // For subsequent jumpKey changes, reseed from target props.
    if (jumpChanged && jumpKey > 0) {
      if (spine == null) {
        console.warn("[ContinuousScrollStream] jumpKey changed but spine is null");
        return;
      }
      const linearIdx = spineToLinear.get(spine);
      if (linearIdx == null) {
        console.warn(
          "[ContinuousScrollStream] jump spine not in linear list",
          spine,
          "linear size",
          spineToLinear.size,
        );
        return;
      }
      if (jumpStableTimerRef.current) {
        clearTimeout(jumpStableTimerRef.current);
        jumpStableTimerRef.current = null;
      }
      pendingJumpRef.current = {
        linearIdx,
        offsetFraction: clamp01(targetOffsetRef.current ?? 0),
        cfi: targetCfiRef.current ?? null,
      };
      beginJumpVeil();
      seedWindowForJump(linearIdx);
      setUrlTick((t) => t + 1);
      return;
    }

    // No jumpKey change: still try mount-time pending jump (resume/mode-switch).
    if (pendingJumpRef.current) {
      if (pendingJumpRef.current.linearIdx > 0 || pendingJumpRef.current.cfi) {
        beginJumpVeil();
      }
      ensureLoadedAround(pendingJumpRef.current.linearIdx);
      setUrlTick((t) => t + 1);
    }
  }, [
    jumpKey,
    spineToLinear,
    ensureLoadedAround,
    seedWindowForJump,
    beginJumpVeil,
  ]);

  const reportProgress = useCallback(() => {
    const el = scrollerRef.current;
    const lin = linearRef.current;
    if (!el || lin.length === 0) return;
    const { scrollTop, clientHeight } = el;
    const sorted = [...loadedRef.current].sort((a, b) => a - b);

    let acc = 0;
    let primary = primaryRef.current;
    let within = 0;
    let primaryTop = 0;
    let found = false;
    for (const i of sorted) {
      const h = Math.max(1, heightsRef.current.get(i) ?? clientHeight);
      if (!found && scrollTop < acc + h) {
        primary = i;
        within = clamp01((scrollTop - acc) / h);
        primaryTop = acc;
        found = true;
      }
      acc += h;
    }
    if (!found && sorted.length) {
      primary = sorted[sorted.length - 1];
      within = 1;
    }

    if (primary !== primaryRef.current) {
      primaryRef.current = primary;
      const spine = lin[primary]?.index;
      if (spine != null) onPrimaryRef.current?.(spine);
    }

    const sec = lin[primary];
    const spine = sec?.index;
    if (spine == null) return;

    // Real in-section CFI = exact resume anchor: character-precise, CJK-safe,
    // reflow-invariant. Runs on scroll-idle only (250ms debounce) so the
    // getVisibleRange tree-walk stays off the scroll path. Falls back to null →
    // parent encodes the spine+offset token. NEVER the section BASE cfi, which
    // always resolves to the section top → resume would land at chapter start.
    let fineCfi: string | null = null;
    if (sec.cfi) {
      const iframe = iframeForLinear(primary);
      const doc = iframe?.contentDocument;
      if (iframe && doc) {
        const localStart = Math.max(0, scrollTop - primaryTop);
        fineCfi = visibleRangeCfi(doc, sec.cfi, localStart, clientHeight, iframe);
      }
    }
    onProgressRef.current?.(spine, within, fineCfi);
  }, [iframeForLinear]);

  const maybeLoadNeighbors = useCallback(() => {
    const el = scrollerRef.current;
    const lin = linearRef.current;
    if (!el || lin.length === 0) return;

    // During an active jump, tryApplyJump owns scrollTop absolutely and the
    // window is a fresh bounded seed — growing/trimming here would fight the
    // jump's scroll set (trimming above shifts content). Resume once it settles.
    if (!pendingJumpRef.current) {
      const { scrollTop, clientHeight, scrollHeight } = el;
      const nearBottom = scrollTop + clientHeight >= scrollHeight - PRELOAD_PX;
      const nearTop = scrollTop <= PRELOAD_PX;

      const prev = loadedRef.current;
      const extended = extendWindow(prev, { nearTop, nearBottom }, lin.length);
      // Cap the band so scrolling/jumping a long book never accumulates every
      // section (one live iframe/doc each) — the repeated-jump freeze. Sections
      // evicted ABOVE the viewport shift content up, so record their heights and
      // compensate scrollTop post-commit (layout effect) to keep the view stable.
      const { window: capped, removedTop } = capWindow(
        extended,
        primaryRef.current,
        MAX_LOADED,
      );
      if (!sameWindow(capped, prev)) {
        let evicted = 0;
        for (const i of removedTop) evicted += heightsRef.current.get(i) ?? 0;
        pendingTopEvictRef.current += evicted;
        loadedRef.current = capped; // optimistic: avoid double-count on burst scroll
        setLoaded(capped);
      }
    }

    if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
    progressTimerRef.current = setTimeout(() => {
      progressTimerRef.current = null;
      onIdle(reportProgress); // defer the O(nodes) CFI walk off the frame
    }, 250);
  }, [reportProgress]);

  // Keep the view visually stable when the window cap evicts sections above the
  // viewport: their removed heights would shift content up, so subtract them from
  // scrollTop synchronously after commit (before paint → no flicker).
  useLayoutEffect(() => {
    const adj = pendingTopEvictRef.current;
    if (adj <= 0) return;
    pendingTopEvictRef.current = 0;
    const el = scrollerRef.current;
    if (el) el.scrollTop = Math.max(0, el.scrollTop - adj);
  }, [loaded]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let rafId = 0;
    const markGesture = () => {
      userGestureAtRef.current = performance.now();
      // A scroll gesture dismisses a pending selection bubble (D-74 seam).
      onSelectionRef.current?.(null);
    };
    const runNeighbors = () => {
      rafId = 0;
      maybeLoadNeighbors();
    };
    const onScroll = () => {
      const pending = pendingJumpRef.current;
      if (pending && !applyingJumpRef.current) {
        // Only a USER-driven scroll abandons a pending jump. Layout-induced
        // scrolls (late image/font loads shifting content) must NOT cancel it —
        // that was the TOC-jump no-op bug. tryApplyJump re-pins on each reflow.
        const userDriven =
          performance.now() - userGestureAtRef.current < USER_SCROLL_WINDOW_MS;
        if (userDriven) {
          pendingJumpRef.current = null;
          if (jumpStableTimerRef.current) {
            clearTimeout(jumpStableTimerRef.current);
            jumpStableTimerRef.current = null;
          }
          endJumpVeil();
        }
      }
      // Coalesce neighbor-loading to once per frame — scroll fires far faster
      // than paint, and each run reads layout (scrollHeight/clientHeight). One
      // read per frame instead of per-event removes the scroll-path thrash.
      if (!rafId) rafId = requestAnimationFrame(runNeighbors);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", markGesture, { passive: true });
    el.addEventListener("pointerdown", markGesture, { passive: true });
    maybeLoadNeighbors();
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", markGesture);
      el.removeEventListener("pointerdown", markGesture);
      if (rafId) cancelAnimationFrame(rafId);
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
      if (jumpStableTimerRef.current) {
        clearTimeout(jumpStableTimerRef.current);
        jumpStableTimerRef.current = null;
      }
    };
  }, [maybeLoadNeighbors, endJumpVeil]);

  const remeasure = useCallback((iframe: HTMLIFrameElement) => {
    const doc = iframe.contentDocument;
    if (!doc) return;
    const idx = Number(iframe.dataset.linearIndex);
    if (!Number.isFinite(idx)) return;
    const h = Math.max(
      doc.documentElement?.scrollHeight ?? 0,
      doc.body?.scrollHeight ?? 0,
      1,
    );
    const prev = heightsRef.current.get(idx);
    heightsRef.current.set(idx, h);
    iframe.style.height = `${h}px`;
    if (prev != null && prev !== h && pendingJumpRef.current) {
      setUrlTick((t) => t + 1);
    }
    // Fallback Overlayer holds live ranges but paints an SVG that must be
    // re-laid-out on reflow (CSS Custom Highlight redraws itself, so no-op there).
    overlayersRef.current.get(idx)?.redraw();
  }, []);

  /**
   * Draw this section's annotations, lazily (only the ones whose CFI resolves
   * into THIS spine section — Pitfall 9, never a bulk open-time loop). Primary
   * path is the per-iframe CSS Custom Highlight registry (live Range, zero manual
   * reflow redraw); WebView < 105 falls back to a per-iframe foliate Overlayer.
   * Idempotent per section: it clears the section's prior drawings first.
   */
  const drawSectionAnnotations = useCallback(
    (iframe: HTMLIFrameElement, spineIndex: number, linearIdx: number) => {
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow as (HighlightWindow & Window) | null;
      if (!doc?.body || !win) return;

      const useCss = supportsCssHighlight(win);
      // Reset this section's prior drawings before re-registering.
      if (useCss) clearHighlights(win);
      const prevOverlayer = overlayersRef.current.get(linearIdx);
      if (prevOverlayer) {
        try {
          prevOverlayer.element.remove();
        } catch {
          /* ignore */
        }
        overlayersRef.current.delete(linearIdx);
      }

      const annos = annotationsRef.current.filter(
        (a) =>
          (a.type === "highlight" || a.type === "underline") &&
          !!a.color &&
          spineFromCfi(a.cfi) === spineIndex,
      );
      if (annos.length === 0) return;

      let overlayer: OverlayerLike | null = null;
      for (const a of annos) {
        const res = resolveAnchor(doc, a);
        const range = res && "range" in res ? res.range : null;
        if (!range) continue; // fraction/null anchor can't be drawn as a highlight
        const type = a.type as HighlightType;
        if (useCss) {
          registerHighlight(win, type, a.color as string, range);
        } else {
          if (!overlayer) {
            overlayer = new Overlayer() as OverlayerLike;
            doc.body.style.position ||= "relative";
            doc.body.appendChild(overlayer.element);
            overlayersRef.current.set(linearIdx, overlayer);
          }
          const draw = type === "underline" ? Overlayer.underline : Overlayer.highlight;
          overlayer.add(a.annotation_id, range, draw, {
            color: paletteColor(doc, a.color as string),
          });
        }
      }
    },
    [],
  );

  /** Re-draw annotations for every currently loaded section iframe. */
  const redrawAllLoaded = useCallback(() => {
    const root = scrollerRef.current;
    if (!root) return;
    root.querySelectorAll("iframe[data-linear-index]").forEach((node) => {
      const iframe = node as HTMLIFrameElement;
      const li = Number(iframe.dataset.linearIndex);
      const spine = Number.isFinite(li) ? linearRef.current[li]?.index : undefined;
      if (spine != null) drawSectionAnnotations(iframe, spine, li);
    });
  }, [drawSectionAnnotations]);

  // Redraw loaded sections when the annotation list changes (new highlight, edit,
  // delete) without waiting for a section reload.
  useEffect(() => {
    redrawAllLoaded();
  }, [annotations, redrawAllLoaded]);

  useEffect(() => {
    onReady?.({ jumpTo, redrawAnnotations: redrawAllLoaded });
    return () => onReady?.(null);
  }, [onReady, jumpTo, redrawAllLoaded]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.isPrimary === false) return;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!s) return;
    if (
      Math.abs(e.clientX - s.x) > TAP_SLOP ||
      Math.abs(e.clientY - s.y) > TAP_SLOP
    ) {
      return;
    }
    if (e.target === scrollerRef.current) onTap?.();
  };

  return (
    <div
      ref={scrollerRef}
      className={className ?? "reader-continuous-scroll"}
      data-continuous-scroll="true"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      style={{
        position: "absolute",
        inset: 0,
        overflowX: "hidden",
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        touchAction: "pan-y",
        overscrollBehavior: "contain",
        background: "var(--page-bg, #fffef9)",
      }}
    >
      {loaded.map((linearIdx) => {
        const url = urlsRef.current.get(linearIdx);
        const sec = linear[linearIdx];
        if (!sec) return null;
        return (
          <div
            key={sec.index}
            className="reader-continuous-scroll__section"
            data-spine-index={sec.index}
            data-linear-index={linearIdx}
            style={{
              width: "100%",
              position: "relative",
              // Isolate each section's layout/paint so one iframe reflowing or
              // repainting never invalidates the whole stack. (content-visibility
              // was tried too but left the target blank-until-nudge after a jump —
              // it defers paint past the programmatic scroll, so contain only.)
              contain: "content",
            }}
          >
            {url ? (
              <iframe
                title={`section-${sec.index}`}
                src={url}
                data-linear-index={linearIdx}
                sandbox="allow-same-origin allow-popups"
                referrerPolicy="no-referrer"
                style={{
                  display: "block",
                  width: "100%",
                  border: 0,
                  height: heightsRef.current.get(linearIdx) ?? "80vh",
                  background: "transparent",
                }}
                onLoad={(e) => {
                  const iframe = e.currentTarget;
                  injectStyles(iframe);
                  try {
                    const doc = iframe.contentDocument;
                    if (!doc) return;
                    let ps: { x: number; y: number } | null = null;
                    const down = (ev: PointerEvent) => {
                      if (!ev.isPrimary) return;
                      userGestureAtRef.current = performance.now();
                      ps = { x: ev.clientX, y: ev.clientY };
                    };
                    const up = (ev: PointerEvent) => {
                      if (!ps) return;
                      const dx = ev.clientX - ps.x;
                      const dy = ev.clientY - ps.y;
                      ps = null;
                      if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP) {
                        return;
                      }
                      const t = ev.target as Element | null;
                      if (t?.closest?.("a[href]")) return;
                      onTap?.();
                    };
                    doc.addEventListener("pointerdown", down, { passive: true });
                    doc.addEventListener("pointerup", up, { passive: true });

                    // Selection → range-CFI (same section-doc seam as link-click /
                    // autospace, D-74 — no new full-screen pointer-capture layer).
                    const win = iframe.contentWindow;
                    const emitSelection = () => {
                      const selo = win?.getSelection?.();
                      if (!selo || selo.isCollapsed || selo.rangeCount === 0) {
                        onSelectionRef.current?.(null);
                        return;
                      }
                      const range = selo.getRangeAt(0);
                      if (range.collapsed) {
                        onSelectionRef.current?.(null);
                        return;
                      }
                      const baseCfi = linearRef.current[linearIdx]?.cfi;
                      if (!baseCfi) return;
                      const cfi = selectionCfi(baseCfi, range);
                      if (!cfi) return;
                      onSelectionRef.current?.({
                        cfi,
                        rects: Array.from(range.getClientRects()),
                        iframe,
                        doc,
                        linearIndex: linearIdx,
                      });
                    };
                    // Emit only on settle (pointerup/mouseup); selectionchange only
                    // clears the bubble when the selection collapses.
                    const settle = () => win?.setTimeout?.(emitSelection, 0);
                    doc.addEventListener("pointerup", settle, { passive: true });
                    doc.addEventListener("mouseup", settle, { passive: true });
                    doc.addEventListener("selectionchange", () => {
                      const s = win?.getSelection?.();
                      if (!s || s.isCollapsed) onSelectionRef.current?.(null);
                    });

                    // Lazy per-section annotation draw (this section only).
                    drawSectionAnnotations(iframe, sec.index, linearIdx);
                    // Intercept in-book links: the WebView would otherwise try to
                    // navigate the iframe to filepos:/kindle:/relative URLs
                    // (net::ERR_UNKNOWN_URL_SCHEME). Parent resolves + jumps.
                    doc.addEventListener("click", (ev) => {
                      const a = (ev.target as Element | null)?.closest?.(
                        "a[href]",
                      );
                      const href = a?.getAttribute("href");
                      if (!href) return;
                      ev.preventDefault();
                      onLinkClickRef.current?.(href, linearIdx);
                    });
                    void doc.fonts?.ready?.then(() => {
                      remeasure(iframe);
                      tryApplyJump();
                    });
                    doc.querySelectorAll("img").forEach((img) => {
                      if (!(img as HTMLImageElement).complete) {
                        const onMedia = () => remeasure(iframe);
                        img.addEventListener("load", onMedia, { once: true });
                        img.addEventListener("error", onMedia, { once: true });
                      }
                    });
                  } catch {
                    /* ignore */
                  }
                  tryApplyJump();
                  maybeLoadNeighbors();
                }}
              />
            ) : (
              <div
                style={{
                  minHeight: "40vh",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: 0.5,
                  fontSize: 14,
                }}
              >
                加载中…
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default ContinuousScrollStream;
