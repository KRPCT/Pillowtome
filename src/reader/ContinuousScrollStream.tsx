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
  /** Injected CSS for each section document (typography/theme). */
  readingCss: string;
  className?: string;
  onTap?: () => void;
  /** Fired when the primary (most visible) section changes. */
  onPrimarySectionChange?: (spineIndex: number) => void;
}

const PRELOAD_PX = 600;
const TAP_SLOP = 12;

/**
 * Vertical stack of section iframes. Loads neighbors as the user scrolls.
 */
export function ContinuousScrollStream({
  sections: allSections,
  initialLinearIndex = 0,
  readingCss,
  className,
  onTap,
  onPrimarySectionChange,
}: ContinuousScrollStreamProps) {
  const linear = useMemo(
    () => allSections.filter((s) => s.linear !== "no"),
    [allSections],
  );

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
  // Bump when a URL becomes available so iframes remount with src.
  const [urlTick, setUrlTick] = useState(0);
  const urlsRef = useRef<Map<number, string>>(new Map());
  const heightsRef = useRef<Map<number, number>>(new Map());
  const loadingRef = useRef<Set<number>>(new Set());
  const primaryRef = useRef<number>(startIdx);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const linearRef = useRef(linear);
  linearRef.current = linear;

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

  // Load URLs for currently loaded indices (once per new index).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const i of loaded) {
        if (cancelled) return;
        if (!urlsRef.current.has(i)) {
          await ensureUrl(i);
        }
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
        changed = true;
      }
      if (nearTop && minLoaded > 0) {
        next.add(minLoaded - 1);
        changed = true;
      }

      // Primary section by midpoint — do not setState for this.
      let acc = 0;
      const mid = scrollTop + clientHeight / 2;
      let primary = primaryRef.current;
      const sorted = [...next].sort((a, b) => a - b);
      for (const i of sorted) {
        const h = heightsRef.current.get(i) ?? clientHeight;
        if (acc + h > mid) {
          primary = i;
          break;
        }
        acc += h;
        primary = i;
      }
      if (primary !== primaryRef.current) {
        primaryRef.current = primary;
        const spine = lin[primary]?.index;
        if (spine != null) onPrimarySectionChange?.(spine);
      }

      if (!changed) return prev;
      return sorted;
    });
  }, [onPrimarySectionChange]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => maybeLoadNeighbors();
    el.addEventListener("scroll", onScroll, { passive: true });
    // Initial neighbor check once
    maybeLoadNeighbors();
    return () => el.removeEventListener("scroll", onScroll);
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
                    void doc.fonts?.ready?.then(() => injectStyles(iframe));
                  } catch {
                    /* ignore */
                  }
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
