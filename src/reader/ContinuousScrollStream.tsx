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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clamp01 } from "./reading-position";
import { resolveCfiScrollTop } from "./scroll-cfi";
import { installAutospaceShim } from "./cjk-autospace-shim";

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
  onPrimarySectionChange?: (spineIndex: number) => void;
  /**
   * Progress observation only. Parent must NOT treat this as a jump command.
   */
  onProgress?: (
    spineIndex: number,
    offsetFraction: number,
    cfi: string | null,
  ) => void;
  /** Imperative controller registered on mount (avoids jumpKey remount races). */
  onReady?: (api: ContinuousScrollApi | null) => void;
}

export interface ContinuousScrollApi {
  jumpTo: (
    spineIndex: number,
    offsetFraction?: number,
    cfi?: string | null,
  ) => void;
}

const PRELOAD_PX = 800;
const TAP_SLOP = 12;
const JUMP_STABLE_MS = 450;

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
  onPrimarySectionChange,
  onProgress,
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
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onProgressRef = useRef(onProgress);
  const onPrimaryRef = useRef(onPrimarySectionChange);
  const targetOffsetRef = useRef(targetOffsetFraction);
  const targetCfiRef = useRef(targetCfi);
  const targetSpineRef = useRef(targetSpineIndex);
  const pendingJumpRef = useRef<{
    linearIdx: number;
    offsetFraction: number;
    cfi: string | null;
  } | null>({
    linearIdx: startIdx,
    offsetFraction: clamp01(initialOffsetFraction),
    cfi: initialCfi,
  });
  const jumpStableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyingJumpRef = useRef(false);
  const lastJumpKeyRef = useRef(jumpKey);

  linearRef.current = linear;
  onProgressRef.current = onProgress;
  onPrimaryRef.current = onPrimarySectionChange;
  targetOffsetRef.current = targetOffsetFraction;
  targetCfiRef.current = targetCfi;
  targetSpineRef.current = targetSpineIndex;

  const jumpTo = useCallback(
    (spineIndex: number, offsetFraction = 0, cfi: string | null = null) => {
      const linearIdx = spineToLinear.get(spineIndex);
      if (linearIdx == null) {
        console.warn(
          "[ContinuousScrollStream] jumpTo: spine not linear",
          spineIndex,
        );
        return;
      }
      pendingJumpRef.current = {
        linearIdx,
        offsetFraction: clamp01(offsetFraction),
        cfi,
      };
      setLoaded((prev) => {
        const next = new Set(prev);
        const from = Math.max(0, linearIdx - 2);
        const to = Math.min(linearRef.current.length - 1, linearIdx + 1);
        for (let i = from; i <= to; i++) next.add(i);
        return [...next].sort((a, b) => a - b);
      });
      setUrlTick((t) => t + 1);
    },
    [spineToLinear],
  );

  useEffect(() => {
    onReady?.({ jumpTo });
    return () => onReady?.(null);
  }, [onReady, jumpTo]);

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
      style.textContent = readingCss;

      const key = iframe.dataset.linearIndex ?? "";
      clearAutospaceFor(key);
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

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    root.querySelectorAll("iframe[data-linear-index]").forEach((node) => {
      injectStyles(node as HTMLIFrameElement);
    });
  }, [readingCss, autospaceShimEnabled, injectStyles, urlTick, loaded]);

  useEffect(() => {
    return () => {
      for (const dispose of autospaceDisposersRef.current.values()) {
        try {
          dispose();
        } catch {
          /* soft-fail */
        }
      }
      autospaceDisposersRef.current.clear();
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
    }

    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    applyingJumpRef.current = true;
    el.scrollTop = Math.max(0, Math.min(maxScroll, target));
    requestAnimationFrame(() => {
      applyingJumpRef.current = false;
    });
    primaryRef.current = jump.linearIdx;

    if (jumpStableTimerRef.current) clearTimeout(jumpStableTimerRef.current);
    jumpStableTimerRef.current = setTimeout(() => {
      jumpStableTimerRef.current = null;
      pendingJumpRef.current = null;
    }, JUMP_STABLE_MS);
  }, [loaded, offsetOfLinear, iframeForLinear]);

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
      pendingJumpRef.current = {
        linearIdx,
        offsetFraction: clamp01(targetOffsetRef.current ?? 0),
        cfi: targetCfiRef.current ?? null,
      };
      ensureLoadedAround(linearIdx);
      setUrlTick((t) => t + 1);
      return;
    }

    // No jumpKey change: still try mount-time pending jump.
    if (pendingJumpRef.current) {
      ensureLoadedAround(pendingJumpRef.current.linearIdx);
      setUrlTick((t) => t + 1);
    }
  }, [jumpKey, spineToLinear, ensureLoadedAround]);

  const reportProgress = useCallback(() => {
    const el = scrollerRef.current;
    const lin = linearRef.current;
    if (!el || lin.length === 0) return;
    const { scrollTop, clientHeight } = el;
    const sorted = [...loaded].sort((a, b) => a - b);

    let acc = 0;
    let primary = primaryRef.current;
    let within = 0;
    let found = false;
    for (const i of sorted) {
      const h = Math.max(1, heightsRef.current.get(i) ?? clientHeight);
      if (!found && scrollTop < acc + h) {
        primary = i;
        within = clamp01((scrollTop - acc) / h);
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
    // Optional CFI: section base only (stable). Finer CFI is best-effort elsewhere.
    onProgressRef.current?.(spine, within, sec?.cfi ?? null);
  }, [loaded]);

  const maybeLoadNeighbors = useCallback(() => {
    const el = scrollerRef.current;
    const lin = linearRef.current;
    if (!el || lin.length === 0) return;
    const { scrollTop, clientHeight, scrollHeight } = el;
    const nearBottom = scrollTop + clientHeight >= scrollHeight - PRELOAD_PX;
    const nearTop = scrollTop <= PRELOAD_PX;

    setLoaded((prev) => {
      const next = new Set(prev);
      let changed = false;
      const maxLoaded = Math.max(...prev);
      const minLoaded = Math.min(...prev);
      if (nearBottom && maxLoaded < lin.length - 1) {
        next.add(maxLoaded + 1);
        if (maxLoaded + 2 < lin.length) next.add(maxLoaded + 2);
        changed = true;
      }
      if (nearTop && minLoaded > 0) {
        next.add(minLoaded - 1);
        changed = true;
      }
      if (!changed) return prev;
      return [...next].sort((a, b) => a - b);
    });

    if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
    progressTimerRef.current = setTimeout(() => {
      progressTimerRef.current = null;
      reportProgress();
    }, 250);
  }, [reportProgress]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (!applyingJumpRef.current && pendingJumpRef.current) {
        pendingJumpRef.current = null;
        if (jumpStableTimerRef.current) {
          clearTimeout(jumpStableTimerRef.current);
          jumpStableTimerRef.current = null;
        }
      }
      maybeLoadNeighbors();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    maybeLoadNeighbors();
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
      if (jumpStableTimerRef.current) {
        clearTimeout(jumpStableTimerRef.current);
        jumpStableTimerRef.current = null;
      }
    };
  }, [maybeLoadNeighbors]);

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
  }, []);

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
            style={{ width: "100%", position: "relative" }}
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
