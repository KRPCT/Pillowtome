import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "../vendor/foliate-js/view.js";
import { pillowUrl } from "../lib/pillow";
import { ErrorCard } from "./error-card";
import { ReaderChrome } from "./ReaderChrome";
import { ReaderTapZones, type TapZoneAction } from "./ReaderTapZones";
import { SettingsSheet } from "./SettingsSheet";
import { SearchSheet } from "./SearchSheet";
import { TocSheet, normalizeToc } from "./TocSheet";
import {
  DEFAULT_PREFS,
  applyFoliateLayoutAttrs,
  buildReadingCss,
  flowAttr,
  type ReadingPrefs,
} from "./apply-reading-styles";
import {
  PREFS_SAVE_DEBOUNCE_MS,
  loadReadingPrefs,
  saveReadingPrefs,
} from "./reading-prefs";
import {
  LOCATOR_DEBOUNCE_MS,
  ensureWorkRow,
  loadLocator,
  relocateToLocatorRow,
  upsertLocator,
} from "./locator-store";
import {
  buildBundledCjkFontFaceCss,
  buildFontFaceCss,
  fontFamilyCssFor,
  importCustomFont,
  listCustomFonts,
  removeCustomFont,
  type CustomFont,
} from "./fonts";
import {
  detectCjkCssCaps,
  type CjkCssCaps,
} from "./cjk-feature-detect";
import {
  installAutospaceShim,
  shouldInstallAutospaceShim,
} from "./cjk-autospace-shim";
import type {
  FoliateBookSection,
  FoliateViewElement,
  RelocateDetail,
} from "./foliate-types";
import type { TocItem } from "./toc";
import {
  encodeScrollPosition,
  isRealCfi,
  parseScrollPosition,
  positionFromLocatorCfi,
  spineToLinearIndex,
  wholeBookFraction,
  type ReadingPosition,
} from "./reading-position";
import {
  ContinuousScrollStream,
  type ContinuousScrollApi,
  type ContinuousSection,
} from "./ContinuousScrollStream";

/**
 * foliate-js 阅读视图 + immersive chrome + TOC + locator progress (READ-01..05).
 *
 * Constraints:
 * - Book bytes only via `fetch(pillow://...)` — never IPC (D-06).
 * - DRM gate via `check_protection` before `view.open` (D-10).
 * - Flow via `renderer.setAttribute("flow", flowAttr(mode))`.
 * - Typography/theme via `setStyles` + `margin` attribute + `data-theme` (D-22).
 * - Prefs: SQLite global only — never localStorage (D-20).
 * - Locator: CFI + fraction + text; debounced relocate + unmount flush (D-23..25).
 * - work_id via ensure_work (hash only over IPC, D-26).
 * - Immersive default + tap zones + desktop keys (READ-04, D-33).
 * - Clean-room chrome from UI-SPEC; no Readest AGPL (T-02-agpl / DEC-001).
 */

/** `check_protection` gate decision (small struct over IPC only). */
interface ProtectionDecision {
  canRender: boolean;
  message?: string;
}

/** `ensure_work` result — workId + contentHash only, never bytes (D-06). */
interface EnsureWorkResult {
  workId: string;
  contentHash: string;
}

export interface FoliateViewProps {
  /** Registered book id (SourceRegistry). */
  id?: string;
  /** Close reader → home shell. */
  onClose?: () => void;
  /**
   * Register a back handler with the shell (Android system back).
   * Handler returns true if the event was consumed (sheet/chrome/close).
   */
  registerBackHandler?: (handler: (() => boolean) | null) => void;
}

type Status = "loading" | "reading" | "error";

export function FoliateView({
  id = "sample",
  onClose,
  registerBackHandler,
}: FoliateViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<FoliateViewElement | null>(null);
  const fxlRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefsRef = useRef<ReadingPrefs>(DEFAULT_PREFS);
  const workIdRef = useRef<string | null>(null);
  const pendingLocatorRef = useRef<ReturnType<typeof relocateToLocatorRow> | null>(
    null,
  );
  const locationRef = useRef<RelocateDetail | null>(null);

  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState<string>("");
  const [location, setLocation] = useState<RelocateDetail | null>(null);
  const [prefs, setPrefs] = useState<ReadingPrefs>(DEFAULT_PREFS);
  // Immersive default when reading (READ-04); starts true only during load chrome.
  const [chromeVisible, setChromeVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [fxlLocked, setFxlLocked] = useState(false);
  const [bookTitle, setBookTitle] = useState("示例书籍");
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);
  const [fontStatus, setFontStatus] = useState<string | null>(null);
  /** Linear spine for continuous scroll mode (foliate has no continuous scroll). */
  const [continuousSections, setContinuousSections] = useState<
    ContinuousSection[]
  >([]);
  const [continuousCss, setContinuousCss] = useState("");
  const continuousStartRef = useRef(0);
  const continuousOffsetRef = useRef(0);
  const streamApiRef = useRef<ContinuousScrollApi | null>(null);
  /** Increment to force ContinuousScrollStream jump (TOC / resume / mode switch). */
  const [scrollJumpKey, setScrollJumpKey] = useState(0);
  const [scrollJumpSpine, setScrollJumpSpine] = useState<number | null>(null);
  /** Top-edge offset 0..1 within the jump target section. */
  const [scrollJumpOffset, setScrollJumpOffset] = useState(0);
  /** Optional real CFI for finer mid-section resume. */
  const [scrollJumpCfi, setScrollJumpCfi] = useState<string | null>(null);
  /** Optional real CFI for first mount of the stream (open resume). */
  const [initialCfi, setInitialCfi] = useState<string | null>(null);
  /** Bump to remount ContinuousScrollStream with fresh initial* props. */
  const [streamMountKey, setStreamMountKey] = useState(0);
  /** Session-cached CJK CSS caps (D-35) — probe once per reader open. */
  const cjkCapsRef = useRef<CjkCssCaps | null>(null);
  /** Disposers for paginate render-doc autospace shims. */
  const autospaceDisposersRef = useRef<Array<() => void>>([]);
  const [autospaceShimEnabled, setAutospaceShimEnabled] = useState(false);

  prefsRef.current = prefs;
  locationRef.current = location;

  const anySheetOpen = settingsOpen || tocOpen || searchOpen;
  const useContinuousScroll =
    prefs.mode === "scroll" && !fxlLocked && continuousSections.length > 0;

  const ensureCjkCaps = useCallback((): CjkCssCaps => {
    if (!cjkCapsRef.current) {
      cjkCapsRef.current = detectCjkCssCaps();
    }
    return cjkCapsRef.current;
  }, []);

  const clearAutospaceShims = useCallback(() => {
    for (const dispose of autospaceDisposersRef.current) {
      try {
        dispose();
      } catch {
        /* soft-fail */
      }
    }
    autospaceDisposersRef.current = [];
  }, []);

  const buildCss = useCallback(
    (next: ReadingPrefs) => {
      const caps = ensureCjkCaps();
      const faces =
        buildFontFaceCss(next.activeFontId) + buildBundledCjkFontFaceCss();
      return buildReadingCss(
        next,
        faces,
        fontFamilyCssFor(next.fontFamilyKey, next.activeFontId),
        caps,
      );
    },
    [ensureCjkCaps],
  );

  /** Apply flow + layout attrs + setStyles to the live renderer (READ-01/02/03/06). */
  const applyPrefsToRenderer = useCallback(
    (next: ReadingPrefs) => {
      const caps = ensureCjkCaps();
      const css = buildCss(next);
      setContinuousCss(css);
      const wantShim = shouldInstallAutospaceShim(next, caps);
      setAutospaceShimEnabled(wantShim);

      // Continuous scroll owns the surface — skip foliate flow while scrolled.
      if (next.mode === "scroll" && !fxlRef.current) {
        clearAutospaceShims();
        return;
      }

      const view = viewRef.current;
      const renderer = view?.renderer;
      if (!renderer) return;
      if (fxlRef.current) return;

      const prevFlow = renderer.getAttribute?.("flow");
      const nextFlow = flowAttr(next.mode);
      renderer.setAttribute?.("flow", nextFlow);
      applyFoliateLayoutAttrs(renderer, hostRef.current?.clientHeight);
      renderer.setStyles?.(css);

      // Re-install autospace shim on paginate docs when needed (D-36/D-37).
      clearAutospaceShims();
      if (wantShim) {
        try {
          const root = view as unknown as {
            shadowRoot?: ShadowRoot | null;
            querySelectorAll?: (s: string) => NodeListOf<Element>;
          };
          const docs: Document[] = [];
          const collect = (node: ParentNode | null | undefined) => {
            if (!node?.querySelectorAll) return;
            node.querySelectorAll("iframe").forEach((frame) => {
              const d = (frame as HTMLIFrameElement).contentDocument;
              if (d) docs.push(d);
            });
          };
          collect(root?.shadowRoot ?? null);
          collect(hostRef.current);
          for (const d of docs) {
            autospaceDisposersRef.current.push(installAutospaceShim(d));
          }
        } catch {
          /* silent degrade D-38 */
        }
      }

      if (prevFlow !== nextFlow) {
        const cfi = locationRef.current?.cfi;
        requestAnimationFrame(() => {
          applyFoliateLayoutAttrs(renderer, hostRef.current?.clientHeight);
          renderer.setStyles?.(css);
          if (cfi && view) {
            void view.goTo(cfi).catch(() => {
              /* soft-fail */
            });
          }
        });
      }
    },
    [buildCss, clearAutospaceShims, ensureCjkCaps],
  );

  const scheduleSave = useCallback((next: ReadingPrefs) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveReadingPrefs(next).catch((err) => {
        console.warn("[FoliateView] prefs save failed", err);
      });
    }, PREFS_SAVE_DEBOUNCE_MS);
  }, []);

  const flushLocator = useCallback(async () => {
    if (locatorTimerRef.current) {
      clearTimeout(locatorTimerRef.current);
      locatorTimerRef.current = null;
    }
    const pending = pendingLocatorRef.current;
    if (!pending) return;
    pendingLocatorRef.current = null;
    try {
      await upsertLocator(pending);
    } catch (err) {
      console.warn("[FoliateView] locator flush failed", err);
    }
  }, []);

  const scheduleLocatorUpsert = useCallback(
    (detail: RelocateDetail) => {
      const workId = workIdRef.current;
      if (!workId) {
        console.warn("[FoliateView] relocate ignored — no workId yet");
        return;
      }
      const row = relocateToLocatorRow(workId, detail);
      // Keep the best pending row even if CFI is momentarily missing.
      if (!row.cfi && row.progress_fraction == null) return;
      pendingLocatorRef.current = row;
      if (locatorTimerRef.current) clearTimeout(locatorTimerRef.current);
      locatorTimerRef.current = setTimeout(() => {
        locatorTimerRef.current = null;
        void flushLocator();
      }, LOCATOR_DEBOUNCE_MS);
    },
    [flushLocator],
  );

  const handlePrefsChange = useCallback(
    (partial: Partial<ReadingPrefs> | ReadingPrefs) => {
      const next: ReadingPrefs = { ...prefsRef.current, ...partial };
      setPrefs(next);
      applyPrefsToRenderer(next);
      scheduleSave(next);
    },
    [applyPrefsToRenderer, scheduleSave],
  );

  const refreshFonts = useCallback(async () => {
    try {
      setCustomFonts(await listCustomFonts());
    } catch (err) {
      console.warn("[FoliateView] list fonts failed", err);
    }
  }, []);

  const handleImportFont = useCallback(async () => {
    setFontStatus(null);
    try {
      const font = await importCustomFont();
      await refreshFonts();
      setFontStatus(`已导入「${font.familyName}」`);
    } catch (err) {
      const msg = String(err);
      if (msg.includes("已取消")) return;
      // Surface server-side limit / validation messages when present.
      const clean = msg
        .replace(/^Error:\s*/i, "")
        .replace(/^.*error:\s*/i, "")
        .trim();
      setFontStatus(
        clean && clean.length < 80
          ? clean
          : "导入失败，请确认格式为 TTF / OTF / WOFF 且未超限。",
      );
    }
  }, [refreshFonts]);

  const handleRemoveFont = useCallback(
    async (fontId: string, familyName: string) => {
      const ok = window.confirm(
        `确认移除「${familyName}」？此操作不会删除设备上的原文件。`,
      );
      if (!ok) return;
      try {
        await removeCustomFont(fontId);
        await refreshFonts();
        setFontStatus(null);
        // If removed font was active → fall back to system (D-29).
        if (prefsRef.current.activeFontId === fontId) {
          handlePrefsChange({
            fontFamilyKey: "system",
            activeFontId: null,
          });
        }
      } catch (err) {
        console.warn("[FoliateView] remove font failed", err);
        setFontStatus("移除字体失败，请重试。");
      }
    },
    [handlePrefsChange, refreshFonts],
  );

  const handleTapAction = useCallback((action: TapZoneAction) => {
    const view = viewRef.current;
    if (action === "toggle-chrome") {
      setChromeVisible((v) => !v);
      return;
    }
    if (!view) return;
    if (action === "prev") {
      void view.goLeft?.().catch(() => {
        void view.renderer?.prev?.();
      });
    } else if (action === "next") {
      void view.goRight?.().catch(() => {
        void view.renderer?.next?.();
      });
    }
  }, []);

  /** Resolve TOC/search/CFI target to spine index for continuous scroll. */
  const resolveSpineIndex = useCallback((target: string): number | null => {
    const view = viewRef.current;
    if (!view || !target) return null;
    try {
      const candidates: Array<{ index?: number } | null | undefined> = [
        view.resolveNavigation?.(target) as { index?: number } | null | undefined,
        view.book?.resolveHref?.(target) as { index?: number } | null | undefined,
        view.book?.resolveCFI?.(target) as { index?: number } | null | undefined,
      ];
      for (const resolved of candidates) {
        if (resolved && typeof resolved.index === "number" && resolved.index >= 0) {
          return resolved.index;
        }
      }
      // Path match against section.id (absolute book href).
      const hrefPath = decodeURI(target.split("#")[0] ?? "");
      if (hrefPath) {
        const hit = continuousSections.find((s) => {
          if (!s.id) return false;
          return (
            s.id === hrefPath ||
            s.id.endsWith(hrefPath) ||
            hrefPath.endsWith(s.id)
          );
        });
        if (hit) return hit.index;
      }
    } catch (err) {
      console.warn("[FoliateView] resolve spine failed", target, err);
    }
    return null;
  }, [continuousSections]);

  const jumpContinuousToSpine = useCallback(
    (spineIndex: number, offsetFraction = 0, cfi: string | null = null) => {
      const li = spineToLinearIndex(spineIndex, continuousSections);
      if (li < 0) {
        console.warn(
          "[FoliateView] jumpContinuousToSpine: spine not linear",
          spineIndex,
        );
        return;
      }
      continuousStartRef.current = li;
      continuousOffsetRef.current = offsetFraction;
      const linear = continuousSections.filter((s) => s.linear !== "no");
      const sec = linear[li];
      const resolvedCfi = cfi ?? sec?.cfi ?? null;

      // Prefer imperative API (no remount/jumpKey race).
      if (streamApiRef.current) {
        streamApiRef.current.jumpTo(spineIndex, offsetFraction, resolvedCfi);
        return;
      }

      // Stream not mounted yet: seed props so mount/pendingJump picks them up.
      setScrollJumpOffset(offsetFraction);
      setScrollJumpCfi(resolvedCfi);
      setScrollJumpSpine(spineIndex);
      setInitialCfi(resolvedCfi);
      setStreamMountKey((k) => k + 1);
      setScrollJumpKey((k) => k + 1);
    },
    [continuousSections],
  );

  const handleTocNavigate = useCallback(
    async (href: string) => {
      const view = viewRef.current;
      setTocOpen(false);
      if (!view || !href) return;

      if (useContinuousScroll) {
        let spine = resolveSpineIndex(href);
        if (spine == null) {
          // Engine resolveNavigation is the authoritative href→index path.
          try {
            const r = view.resolveNavigation?.(href) as
              | { index?: number }
              | null
              | undefined;
            if (typeof r?.index === "number") spine = r.index;
          } catch (err) {
            console.warn("[FoliateView] TOC resolveNavigation threw", href, err);
          }
        }
        if (spine == null) {
          // Last resort: ask engine to navigate (even if hidden), then read index.
          try {
            const r = (await view.goTo(href)) as { index?: number } | undefined;
            if (typeof r?.index === "number") spine = r.index;
            else if (typeof locationRef.current?.section?.current === "number") {
              spine = locationRef.current.section.current;
            }
          } catch (err) {
            console.warn("[FoliateView] TOC goTo fallback failed", href, err);
          }
        }
        if (spine != null) {
          jumpContinuousToSpine(spine, 0, null);
          return;
        }
        console.warn("[FoliateView] TOC resolve failed in scroll mode", href);
        return;
      }

      try {
        await view.goTo(href);
      } catch (err) {
        console.warn("[FoliateView] TOC goTo failed", err);
        try {
          await view.goToTextStart();
        } catch {
          /* soft-fail */
        }
      }
    },
    [useContinuousScroll, resolveSpineIndex, jumpContinuousToSpine],
  );

  const openSearch = useCallback(() => {
    setChromeVisible(true);
    setSearchOpen(true);
  }, []);

  const handleSearchJump = useCallback(
    async (cfi: string) => {
      const view = viewRef.current;
      setSearchOpen(false);
      if (!view || !cfi) return;

      if (useContinuousScroll) {
        const spine = resolveSpineIndex(cfi);
        if (spine != null) {
          jumpContinuousToSpine(spine);
          return;
        }
      }

      try {
        await view.goTo(cfi);
      } catch (err) {
        console.warn("[FoliateView] search goTo(cfi) failed", err);
      }
    },
    [useContinuousScroll, resolveSpineIndex, jumpContinuousToSpine],
  );

  // Keep max-block-size in sync with host height so short pages don't float on tall screens.
  useEffect(() => {
    if (status !== "reading" || fxlRef.current) return;
    const host = hostRef.current;
    const renderer = viewRef.current?.renderer;
    if (!host || !renderer) return;

    const sync = () => {
      applyFoliateLayoutAttrs(renderer, host.clientHeight);
    };
    sync();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", sync);
      return () => window.removeEventListener("resize", sync);
    }
    const ro = new ResizeObserver(() => sync());
    ro.observe(host);
    return () => ro.disconnect();
  }, [status, prefs.mode]);

  // Mode switch: continuous stream is a SECOND surface. Snapshot SSOT position,
  // remount stream (paginate->scroll) or re-anchor engine (scroll->paginate).
  const prevContinuousRef = useRef(false);
  useEffect(() => {
    if (status !== "reading" || fxlRef.current) {
      prevContinuousRef.current = useContinuousScroll;
      return;
    }
    const view = viewRef.current;
    const host = hostRef.current;
    if (!view || !host) return;
    if (continuousSections.length === 0) return;

    const switchedToScroll = useContinuousScroll && !prevContinuousRef.current;
    const switchedFromScroll = !useContinuousScroll && prevContinuousRef.current;

    const readSsot = (): ReadingPosition | null => {
      const loc = locationRef.current;
      const last = (view as unknown as { lastLocation?: RelocateDetail }).lastLocation;
      const cfi =
        (typeof loc?.cfi === "string" ? loc.cfi : null) ??
        (typeof last?.cfi === "string" ? last.cfi : null);
      let spine: number | null =
        typeof loc?.section?.current === "number"
          ? loc.section.current
          : typeof last?.section?.current === "number"
            ? last.section.current
            : null;
      let offset = continuousOffsetRef.current || 0;

      const scrollTok = parseScrollPosition(cfi);
      if (scrollTok) {
        spine = scrollTok.spineIndex;
        offset = scrollTok.offsetFraction;
      } else if (spine == null && isRealCfi(cfi)) {
        try {
          const resolved = view.resolveCFI?.(cfi!);
          if (typeof resolved?.index === "number") spine = resolved.index;
        } catch {
          /* soft-fail */
        }
      }
      if (spine == null) {
        const linear = continuousSections.filter((s) => s.linear !== "no");
        const sec = linear[continuousStartRef.current];
        if (sec) spine = sec.index;
      }
      if (spine == null) return null;
      return {
        spineIndex: spine,
        offsetFraction: offset,
        cfi: isRealCfi(cfi) ? cfi : null,
        fraction: loc?.fraction ?? null,
      };
    };

    if (useContinuousScroll) {
      if (switchedToScroll) {
        const pos = readSsot();
        if (pos) {
          const li = spineToLinearIndex(pos.spineIndex, continuousSections);
          if (li < 0) {
            console.warn(
              "[FoliateView] paginate->scroll: spine not in linear list",
              pos.spineIndex,
            );
          }
          continuousStartRef.current = li >= 0 ? li : 0;
          continuousOffsetRef.current = pos.offsetFraction;
          setInitialCfi(pos.cfi ?? null);
          setScrollJumpCfi(pos.cfi ?? null);
          setScrollJumpOffset(pos.offsetFraction);
          setScrollJumpSpine(pos.spineIndex);
          // Remount with correct initialLinearIndex/offset.
          setStreamMountKey((k) => k + 1);
          setScrollJumpKey((k) => k + 1);
          // If stream is already mounted (unlikely on first switch), jump imperatively next frame.
          requestAnimationFrame(() => {
            streamApiRef.current?.jumpTo(
              pos.spineIndex,
              pos.offsetFraction,
              pos.cfi ?? null,
            );
          });
        } else {
          console.warn("[FoliateView] paginate->scroll: no SSOT spine; stream starts at 0");
        }
      }
      view.style.visibility = "hidden";
      view.style.pointerEvents = "none";
      setContinuousCss(buildCss(prefsRef.current));
      prevContinuousRef.current = true;
      return;
    }

    view.style.visibility = "";
    view.style.pointerEvents = "";
    const renderer = view.renderer;
    if (!renderer) return;
    renderer.setAttribute?.("flow", "paginated");
    applyFoliateLayoutAttrs(renderer, host.clientHeight);
    renderer.setStyles?.(buildCss(prefsRef.current));

    if (switchedFromScroll) {
      const pos = readSsot();
      void (async () => {
        let ok = false;
        if (pos?.cfi && isRealCfi(pos.cfi)) {
          try {
            ok = Boolean(await view.goTo(pos.cfi));
          } catch {
            /* soft-fail */
          }
        }
        if (!ok && pos) {
          try {
            await renderer.goTo?.({
              index: pos.spineIndex,
              anchor: pos.offsetFraction,
            });
            ok = true;
          } catch {
            /* soft-fail */
          }
        }
        if (!ok && pos) {
          try {
            await renderer.goTo?.({ index: pos.spineIndex });
          } catch {
            /* soft-fail */
          }
        }
      })();
    }
    prevContinuousRef.current = false;
  }, [status, useContinuousScroll, buildCss, continuousSections]);

  // Desktop keyboard: arrows/PageUp/Down page; Esc closes sheet; / Ctrl+F search (D-33).
  useEffect(() => {
    if (status !== "reading") return;

    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable);

      // Esc always closes topmost sheet first (even from search input).
      if (e.key === "Escape") {
        e.preventDefault();
        if (searchOpen) {
          setSearchOpen(false);
          return;
        }
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }
        if (tocOpen) {
          setTocOpen(false);
          return;
        }
        if (!chromeVisible) setChromeVisible(true);
        return;
      }

      // Ctrl+F / Cmd+F opens search even from inputs (standard browser chord).
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        openSearch();
        return;
      }

      if (typing) return;

      // `/` opens search when not typing (D-33).
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        openSearch();
        return;
      }

      // Page keys only when no sheet is open
      if (settingsOpen || tocOpen || searchOpen) return;

      const view = viewRef.current;
      if (!view) return;

      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        void view.goLeft?.().catch(() => {
          void view.renderer?.prev?.();
        });
      } else if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        void view.goRight?.().catch(() => {
          void view.renderer?.next?.();
        });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [status, settingsOpen, tocOpen, searchOpen, chromeVisible, openSearch]);

  useEffect(() => {
    let cancelled = false;
    let created: FoliateViewElement | null = null;

    async function load() {
      try {
        // Prefs + fonts load in parallel with DRM/open (D-20). Fail-soft → defaults.
        const prefsPromise = loadReadingPrefs();
        const fontsPromise = listCustomFonts();

        // DRM/damage gate — classify before any book bytes (D-10).
        const decision = await invoke<ProtectionDecision>("check_protection", {
          id,
        });
        if (cancelled) return;
        if (!decision.canRender) {
          setMessage(decision.message ?? "无法打开这本书。");
          setStatus("error");
          return; // hard: do not call view.open
        }

        // Identity + saved locator BEFORE open so early relocate events can save,
        // and so we can restore after open (D-23..D-26).
        try {
          const ensured = await invoke<EnsureWorkResult>("ensure_work", { id });
          if (!cancelled && ensured?.workId) {
            workIdRef.current = ensured.workId;
            await ensureWorkRow(ensured.workId, ensured.contentHash, "epub");
          }
        } catch (err) {
          console.warn("[FoliateView] ensure_work failed; progress disabled", err);
          // Last-resort stable id so progress still works for sample/import.
          workIdRef.current = `work-${id}`;
          try {
            await ensureWorkRow(workIdRef.current, workIdRef.current, "epub");
          } catch {
            /* ignore */
          }
        }

        let savedLoc: Awaited<ReturnType<typeof loadLocator>> = null;
        if (workIdRef.current) {
          try {
            savedLoc = await loadLocator(workIdRef.current);
          } catch (err) {
            console.warn("[FoliateView] loadLocator failed", err);
          }
        }

        const host = hostRef.current;
        if (!host) return;

        // Book bytes stream only via custom protocol — never IPC (D-06).
        const res = await fetch(pillowUrl(id));
        if (!res.ok) throw new Error(`pillow fetch failed: ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;

        const view = document.createElement("foliate-view") as FoliateViewElement;
        created = view;
        viewRef.current = view;
        host.append(view);

        // relocate → progress UI + debounced locator upsert (D-23/D-24).
        // workIdRef is already set so the first relocate is not dropped.
        view.addEventListener("relocate", (event) => {
          const detail = (event as CustomEvent<RelocateDetail>).detail ?? {};
          const next: RelocateDetail = {
            fraction: detail.fraction ?? 0,
            cfi: detail.cfi,
            range: detail.range,
            tocItem: detail.tocItem,
            section: detail.section,
            location: detail.location,
          };
          setLocation(next);
          scheduleLocatorUpsert(next);
        });

        await view.open(new File([blob], `${id}.epub`));
        if (cancelled) return;

        const isFxl = view.book?.rendition?.layout === "pre-paginated";
        fxlRef.current = Boolean(isFxl);
        setFxlLocked(Boolean(isFxl));

        const loaded = await prefsPromise;
        const fonts = await fontsPromise;
        if (cancelled) return;
        setPrefs(loaded);
        prefsRef.current = loaded;
        setCustomFonts(fonts);

        // Live flow + layout + typography + theme + custom face + CJK (READ-01/02/03/06).
        if (!isFxl) {
          // Prefer paginated for engine path; continuous scroll uses stream UI.
          const engineMode =
            loaded.mode === "scroll" ? "paginate" : loaded.mode;
          view.renderer?.setAttribute?.("flow", flowAttr(engineMode));
          applyFoliateLayoutAttrs(view.renderer, host.clientHeight);
          const caps = ensureCjkCaps();
          const openCss = buildCss(loaded);
          view.renderer?.setStyles?.(openCss);
          setContinuousCss(openCss);
          const wantShim = shouldInstallAutospaceShim(loaded, caps);
          setAutospaceShimEnabled(wantShim);
        }

        // TOC for sheet (READ-05)
        setTocItems(normalizeToc(view.book?.toc));

        // Continuous scroll stream sections (linear spine only).
        const rawSections = view.book?.sections ?? [];
        const continuous: ContinuousSection[] = rawSections.map(
          (s: FoliateBookSection, index: number) => ({
            index,
            load: () => s.load(),
            unload: s.unload ? () => s.unload?.() : undefined,
            linear: s.linear,
            cfi: s.cfi,
            id: s.id,
          }),
        );
        setContinuousSections(continuous);
        setContinuousCss(buildCss(loaded));

        // Restore locator (D-25) via ReadingPosition SSOT helpers.
        let restored = false;
        if (savedLoc?.cfi) {
          // Try resolve spine for real CFI up front.
          let spineHint: number | null = null;
          if (isRealCfi(savedLoc.cfi)) {
            try {
              const resolved = view.resolveCFI?.(savedLoc.cfi);
              if (typeof resolved?.index === "number") spineHint = resolved.index;
            } catch {
              /* soft-fail */
            }
          }
          const pos = positionFromLocatorCfi(
            savedLoc.cfi,
            savedLoc.progress_fraction,
            spineHint,
          );

          if (loaded.mode === "scroll" && pos) {
            const li = spineToLinearIndex(pos.spineIndex, continuous);
            continuousStartRef.current = li >= 0 ? li : 0;
            continuousOffsetRef.current = pos.offsetFraction;
            setInitialCfi(pos.cfi ?? null);
            setScrollJumpCfi(pos.cfi ?? null);
            setScrollJumpOffset(pos.offsetFraction);
            setScrollJumpSpine(pos.spineIndex);
            setStreamMountKey((k) => k + 1);
            setScrollJumpKey((k) => k + 1);
            restored = true;
          } else if (loaded.mode !== "scroll" && pos) {
            if (isRealCfi(savedLoc.cfi)) {
              try {
                restored = Boolean(await view.goTo(savedLoc.cfi));
              } catch (err) {
                console.warn("[FoliateView] goTo(cfi) failed", err);
              }
            }
            if (!restored) {
              try {
                await view.renderer?.goTo?.({
                  index: pos.spineIndex,
                  anchor: pos.offsetFraction,
                });
                restored = true;
              } catch (err) {
                console.warn("[FoliateView] resume spine goTo failed", err);
              }
            }
          }
          setLocation({
            fraction: savedLoc.progress_fraction ?? undefined,
            cfi: savedLoc.cfi ?? undefined,
            section: pos ? { current: pos.spineIndex } : undefined,
          });
        }
        if (!restored && loaded.mode !== "scroll") {
          try {
            await view.goToTextStart();
          } catch (err) {
            console.warn("[FoliateView] goToTextStart failed", err);
          }
        }

        // Best-effort title from engine metadata when present.
        const metaTitle = (
          view.book as { metadata?: { title?: string } } | undefined
        )?.metadata?.title;
        if (typeof metaTitle === "string" && metaTitle.trim()) {
          setBookTitle(metaTitle.trim());
        }

        // Immersive default when status becomes reading (READ-04).
        setChromeVisible(false);
        setStatus("reading");
      } catch (err) {
        if (cancelled) return;
        console.error("[FoliateView] 打开书籍失败", err);
        setMessage("文件已损坏或无法读取。");
        setStatus("error");
      }
    }

    void load();
    return () => {
      cancelled = true;
      clearAutospaceShims();
      cjkCapsRef.current = null;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        // Force flush pending prefs on unmount (D-22 companion to D-24).
        void saveReadingPrefs(prefsRef.current).catch(() => {
          /* ignore on teardown */
        });
        saveTimerRef.current = null;
      }
      // Force flush pending locator write (D-24).
      if (locatorTimerRef.current) {
        clearTimeout(locatorTimerRef.current);
        locatorTimerRef.current = null;
      }
      const pending = pendingLocatorRef.current;
      if (pending) {
        pendingLocatorRef.current = null;
        void upsertLocator(pending).catch(() => {
          /* ignore on teardown */
        });
      }
      created?.remove();
      viewRef.current = null;
    };
  }, [id, scheduleLocatorUpsert, buildCss, clearAutospaceShims, ensureCjkCaps]);

  // Also flush locator when parent closes via onClose path — onClose may unmount us;
  // wrap onBack to flush first.
  const handleBack = useCallback(() => {
    // Always try to persist current engine location before leaving.
    const view = viewRef.current;
    const workId = workIdRef.current;
    if (workId && view && !useContinuousScroll) {
      const loc = locationRef.current;
      if (loc?.cfi || loc?.fraction != null) {
        pendingLocatorRef.current = relocateToLocatorRow(workId, loc);
      }
    }
    void flushLocator()
      .catch(() => {
        /* still leave */
      })
      .finally(() => {
        onClose?.();
      });
  }, [flushLocator, onClose, useContinuousScroll]);

  /**
   * Android system back stack inside reader:
   * sheet → hide chrome → leave book (return true = consumed).
   */
  const handleSystemBack = useCallback((): boolean => {
    if (searchOpen) {
      setSearchOpen(false);
      return true;
    }
    if (settingsOpen) {
      setSettingsOpen(false);
      return true;
    }
    if (tocOpen) {
      setTocOpen(false);
      return true;
    }
    if (chromeVisible) {
      setChromeVisible(false);
      return true;
    }
    // Leave reader → library
    handleBack();
    return true;
  }, [
    searchOpen,
    settingsOpen,
    tocOpen,
    chromeVisible,
    handleBack,
  ]);

  useEffect(() => {
    if (!registerBackHandler) return;
    registerBackHandler(handleSystemBack);
    return () => registerBackHandler(null);
  }, [registerBackHandler, handleSystemBack]);

  /** Continuous-scroll progress → locator upsert via real CFI (same path as paginate). */
  /** Continuous-scroll progress -> locator upsert via real CFI (same path as paginate). */
  /**
   * Continuous-scroll progress.
   * Primary resume token: pillow-scroll:{spine}:{offset} (reliable).
   * Optional real CFI stored in the same cfi column when available; on restore
   * we detect epubcfi(...) vs pillow-scroll: and choose the right path.
   * Also keep a coarse progress_fraction for the UI bar.
   */
  /**
   * Continuous-scroll progress observation.
   * Writes SSOT location only — never mutates scrollJump* command state.
   */
  const handleContinuousProgress = useCallback(
    (spineIndex: number, offsetFraction: number, cfi: string | null) => {
      const workId = workIdRef.current;
      if (!workId) return;

      const li = spineToLinearIndex(spineIndex, continuousSections);
      continuousStartRef.current = li >= 0 ? li : continuousStartRef.current;
      continuousOffsetRef.current = offsetFraction;

      const token =
        isRealCfi(cfi) ? (cfi as string) : encodeScrollPosition(spineIndex, offsetFraction);
      const frac = wholeBookFraction(
        spineIndex,
        offsetFraction,
        continuousSections,
      );
      const row = relocateToLocatorRow(workId, { cfi: token, fraction: frac });
      pendingLocatorRef.current = row;
      setLocation({
        fraction: frac,
        cfi: token,
        section: { current: spineIndex },
      });
      if (locatorTimerRef.current) clearTimeout(locatorTimerRef.current);
      locatorTimerRef.current = setTimeout(() => {
        locatorTimerRef.current = null;
        void flushLocator().catch((err) => {
          console.warn("[FoliateView] continuous locator flush failed", err);
        });
      }, LOCATOR_DEBOUNCE_MS);
    },
    [continuousSections, flushLocator],
  );

  if (status === "error") {
    return <ErrorCard message={message} onDismiss={onClose} />;
  }

  const activeTocLabel =
    typeof location?.tocItem?.label === "string"
      ? location.tocItem.label
      : null;

  return (
    <div className="reader" data-theme={prefs.theme}>
      <ReaderChrome
        title={bookTitle}
        fraction={location?.fraction ?? null}
        chromeVisible={chromeVisible}
        onBack={handleBack}
        onOpenToc={() => {
          setChromeVisible(true);
          setTocOpen(true);
        }}
        onOpenSearch={openSearch}
        onOpenSettings={() => {
          setChromeVisible(true);
          setSettingsOpen(true);
        }}
      />

      {status === "loading" ? (
        <div className="reader__loading" aria-live="polite">
          加载中…
        </div>
      ) : null}

      <div ref={hostRef} className="reader__view">
        {status === "reading" && useContinuousScroll ? (
          <ContinuousScrollStream
            key={`stream-${id}-${streamMountKey}`}
            sections={continuousSections}
            initialLinearIndex={continuousStartRef.current}
            initialOffsetFraction={continuousOffsetRef.current}
            initialCfi={initialCfi}
            jumpKey={scrollJumpKey}
            targetSpineIndex={scrollJumpSpine}
            targetOffsetFraction={scrollJumpOffset}
            targetCfi={scrollJumpCfi}
            readingCss={continuousCss}
            autospaceShimEnabled={autospaceShimEnabled}
            onTap={() => {
              if (!anySheetOpen) setChromeVisible((v) => !v);
            }}
            onProgress={handleContinuousProgress}
            onReady={(api) => {
              streamApiRef.current = api;
            }}
          />
        ) : null}
        {status === "reading" && !useContinuousScroll ? (
          <ReaderTapZones
            enabled={!anySheetOpen}
            mode={prefs.mode}
            onAction={handleTapAction}
          />
        ) : null}
      </div>

      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        prefs={prefs}
        onPrefsChange={handlePrefsChange}
        modeLocked={fxlLocked}
        fonts={customFonts.map((f) => ({
          id: f.id,
          familyName: f.familyName,
        }))}
        onImportFont={() => {
          void handleImportFont();
        }}
        onRemoveFont={(fontId, familyName) => {
          void handleRemoveFont(fontId, familyName);
        }}
        fontStatus={fontStatus}
      />

      <TocSheet
        open={tocOpen}
        onOpenChange={setTocOpen}
        items={tocItems}
        activeLabel={activeTocLabel}
        onNavigate={handleTocNavigate}
      />

      <SearchSheet
        open={searchOpen}
        onOpenChange={setSearchOpen}
        view={viewRef.current}
        onJump={handleSearchJump}
      />
    </div>
  );
}

export default FoliateView;
