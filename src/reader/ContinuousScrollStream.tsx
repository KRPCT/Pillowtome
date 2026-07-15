/**
 * Continuous multi-section scroll for EPUB (READ-01 scrolled).
 *
 * foliate-js paginator only renders ONE spine section at a time and has no
 * continuous-scroll support (see foliate README). This stream stacks linear
 * sections in a single overflow container so chapter boundaries feel seamless.
 *
 * Clean-room — no Readest source.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface ContinuousSection {
  /** Spine index in book.sections */
  index: number;
  /** Async URL loader (foliate section.load) */
  load: () => string | Promise<string>;
  unload?: () => void;
  linear?: string;
}

export interface ContinuousScrollStreamProps {
  sections: ContinuousSection[];
  /** Start at this linear-list index (0-based into linear sections). */
  initialLinearIndex?: number;
  /** Progress within the start section 0..1. */
  initialOffsetFraction?: number;
  /**
   * Bump to force jump to targetSpineIndex (TOC / resume).
   * Parent should increment when user picks a chapter.
   */
  jumpKey?: number;
  /** Spine index to jump to when jumpKey changes. */
  targetSpineIndex?: number | null;
  readingCss: string;
  className?: string;
  onTap?: () => void;
  onPrimarySectionChange?: (spineIndex: number) => void;
  onProgress?: (spineIndex: number, offsetFraction: number) => void;
}

const PRELOAD_PX = 800;
const TAP_SLOP = 12;

export function ContinuousScrollStream({
  sections: allSections,
  initialLinearIndex = 0,
  initialOffsetFraction = 0,
  jumpKey = 0,
  targetSpineIndex = null,
  readingCss,
  className,
  onTap,
  onPrimarySectionChange,
  onProgress,
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
  const pendingJumpRef = useRef<{
    linearIdx: number;
    offsetFraction: number;
  } | null>({ linearIdx: startIdx, offsetFraction: initialOffsetFraction });
  const lastJumpKeyRef = useRef(jumpKey);

  linearRef.current = linear;
  onProgressRef.current = onProgress;
  onPrimaryRef.current = onPrimarySectionChange;

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

  // Ensure target range is in loaded set (for TOC jumps).
  const ensureLoadedAround = useCallback((linearIdx: number) => {
    setLoaded((prev) => {
      const next = new Set(prev);
      next.add(linearIdx);
      if (linearIdx > 0) next.add(linearIdx - 1);
      if (linearIdx < linearRef.current.length - 1) next.add(linearIdx + 1);
      // Also load all indices from 0..target so offsets can be measured.
      // Cap to avoid loading entire book at once for huge spines.
      const from = Math.max(0, linearIdx - 2);
      for (let i = from; i <= linearIdx; i++) next.add(i);
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
      const h = Math.max(
        doc.documentElement?.scrollHeight ?? 0,
        doc.body?.scrollHeight ?? 0,
        1,
      );
      iframe.style.height = `${h}px`;
      const idx = Number(iframe.dataset.linearIndex);
      if (Number.isFinite(idx)) heightsRef.current.set(idx, h);
    },
    [readingCss],
  );

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    root.querySelectorAll("iframe[data-linear-index]").forEach((node) => {
      injectStyles(node as HTMLIFrameElement);
    });
  }, [readingCss, injectStyles, urlTick, loaded]);

  const offsetOfLinear = useCallback((linearIdx: number, sorted: number[]) => {
    let acc = 0;
    for (const i of sorted) {
      if (i >= linearIdx) break;
      acc += heightsRef.current.get(i) ?? 0;
    }
    return acc;
  }, []);

  /** Apply pending jump when heights for target (and predecessors) exist. */
  const tryApplyJump = useCallback(() => {
    const jump = pendingJumpRef.current;
    if (!jump) return;
    const el = scrollerRef.current;
    if (!el) return;
    const sorted = [...loaded].sort((a, b) => a - b);
    // Need target loaded and all lower indices measured (or at least target height).
    if (!heightsRef.current.has(jump.linearIdx)) return;
    for (const i of sorted) {
      if (i >= jump.linearIdx) break;
      if (!heightsRef.current.has(i)) return;
    }
    const base = offsetOfLinear(jump.linearIdx, sorted);
    const h = heightsRef.current.get(jump.linearIdx) ?? 0;
    const frac = Math.max(0, Math.min(1, jump.offsetFraction));
    el.scrollTop = base + frac * Math.max(0, h - el.clientHeight * 0.05);
    primaryRef.current = jump.linearIdx;
    pendingJumpRef.current = null;
  }, [loaded, offsetOfLinear]);

  useEffect(() => {
    tryApplyJump();
  }, [tryApplyJump, urlTick, loaded]);

  // External TOC / resume jump
  useEffect(() => {
    if (jumpKey === lastJumpKeyRef.current && targetSpineIndex == null) return;
    lastJumpKeyRef.current = jumpKey;
    if (targetSpineIndex == null) return;
    const linearIdx = spineToLinear.get(targetSpineIndex);
    if (linearIdx == null) return;
    pendingJumpRef.current = { linearIdx, offsetFraction: 0 };
    ensureLoadedAround(linearIdx);
  }, [jumpKey, targetSpineIndex, spineToLinear, ensureLoadedAround]);

  const reportProgress = useCallback(() => {
    const el = scrollerRef.current;
    const lin = linearRef.current;
    if (!el || lin.length === 0) return;
    const { scrollTop, clientHeight } = el;
    const sorted = [...loaded].sort((a, b) => a - b);
    let acc = 0;
    let primary = primaryRef.current;
    let within = 0;
    const mid = scrollTop + clientHeight / 2;
    for (const i of sorted) {
      const h = Math.max(1, heightsRef.current.get(i) ?? clientHeight);
      if (acc + h > mid) {
        primary = i;
        within = Math.max(0, Math.min(1, (mid - acc) / h));
        break;
      }
      acc += h;
      primary = i;
      within = 1;
    }
    if (primary !== primaryRef.current) {
      primaryRef.current = primary;
      const spine = lin[primary]?.index;
      if (spine != null) onPrimaryRef.current?.(spine);
    }
    const spine = lin[primary]?.index;
    if (spine != null) onProgressRef.current?.(spine, within);
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
    const onScroll = () => maybeLoadNeighbors();
    el.addEventListener("scroll", onScroll, { passive: true });
    maybeLoadNeighbors();
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
    };
  }, [maybeLoadNeighbors]);

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
                      injectStyles(iframe);
                      tryApplyJump();
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
