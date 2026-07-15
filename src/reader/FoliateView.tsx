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
  isScrolledAtSectionEnd,
  isScrolledAtSectionStart,
  isShortScrolledSection,
  isTapGesture,
} from "./scroll-mode";
import {
  buildFontFaceCss,
  fontFamilyCssFor,
  importCustomFont,
  listCustomFonts,
  removeCustomFont,
  type CustomFont,
} from "./fonts";
import type {
  FoliateViewElement,
  RelocateDetail,
} from "./foliate-types";
import type { TocItem } from "./toc";

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
}

type Status = "loading" | "reading" | "error";

export function FoliateView({ id = "sample", onClose }: FoliateViewProps) {
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

  prefsRef.current = prefs;
  locationRef.current = location;

  const anySheetOpen = settingsOpen || tocOpen || searchOpen;

  /** Apply flow + layout attrs + setStyles to the live renderer (READ-01/02/03/06). */
  const applyPrefsToRenderer = useCallback((next: ReadingPrefs) => {
    const view = viewRef.current;
    const renderer = view?.renderer;
    if (!renderer) return;

    // FXL has no flow/setStyles — chrome theme still via data-theme on root.
    if (fxlRef.current) return;

    const prevFlow = renderer.getAttribute?.("flow");
    const nextFlow = flowAttr(next.mode);
    renderer.setAttribute?.("flow", nextFlow);
    // margin attr = header/footer band (not page padding); max-block-size fills tall screens.
    applyFoliateLayoutAttrs(renderer, hostRef.current?.clientHeight);
    const fontFaceCss = buildFontFaceCss(next.activeFontId);
    const familyCss = fontFamilyCssFor(next.fontFamilyKey, next.activeFontId);
    const css = buildReadingCss(next, fontFaceCss, familyCss);
    renderer.setStyles?.(css);

    // After paginate↔scroll, foliate re-renders the section. Re-apply styles and
    // re-anchor to the current CFI so mid-book mode switches actually take effect
    // (otherwise users can only switch near the initial position).
    if (prevFlow !== nextFlow) {
      const cfi = locationRef.current?.cfi;
      requestAnimationFrame(() => {
        applyFoliateLayoutAttrs(renderer, hostRef.current?.clientHeight);
        renderer.setStyles?.(css);
        if (cfi && view) {
          void view.goTo(cfi).catch(() => {
            /* soft-fail: stay where engine landed */
          });
        }
      });
    }
  }, []);

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
      if (!workId) return;
      const row = relocateToLocatorRow(workId, detail);
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

  const handleTocNavigate = useCallback(async (href: string) => {
    const view = viewRef.current;
    setTocOpen(false);
    if (!view || !href) return;
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
  }, []);

  const openSearch = useCallback(() => {
    setChromeVisible(true);
    setSearchOpen(true);
  }, []);

  const handleSearchJump = useCallback(async (cfi: string) => {
    const view = viewRef.current;
    setSearchOpen(false);
    if (!view || !cfi) return;
    try {
      await view.goTo(cfi);
    } catch (err) {
      console.warn("[FoliateView] search goTo(cfi) failed", err);
    }
  }, []);

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

  /**
   * Scroll mode: tap inside the book document toggles chrome (no overlay —
   * overlays block pan-y). Also chain sections when the user reaches the
   * end/start of the current spine item (foliate does not auto-advance on
   * native scroll alone).
   */
  useEffect(() => {
    if (status !== "reading" || fxlRef.current) return;
    if (prefs.mode !== "scroll") return;
    const view = viewRef.current;
    const renderer = view?.renderer as
      | (NonNullable<typeof viewRef.current>["renderer"] & EventTarget)
      | undefined;
    if (!view || !renderer) return;

    const cleanups: Array<() => void> = [];
    let sectionNavLock = false;

    const attachDocTap = (doc: Document) => {
      let start: { x: number; y: number } | null = null;
      const onDown = (e: PointerEvent) => {
        if (!e.isPrimary) return;
        start = { x: e.clientX, y: e.clientY };
      };
      const onUp = (e: PointerEvent) => {
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        start = null;
        if (!isTapGesture(dx, dy)) return;
        // Don't steal link clicks.
        const t = e.target as Element | null;
        if (t?.closest?.("a[href]")) return;
        if (anySheetOpen) return;

        const win = doc.defaultView;
        const h = win?.innerHeight ?? 0;
        const y = e.clientY;
        const rStart = Number(renderer.start ?? 0);
        const rEnd = Number(renderer.end ?? 0);
        const rView = Number(renderer.viewSize ?? 0);
        const short = isShortScrolledSection(rStart, rEnd, rView);

        // Short chapter (can't scroll): top/bottom thirds chain sections.
        // Long chapter: any tap toggles chrome (scroll is primary nav).
        if (short && h > 0) {
          if (y > h * 0.72) {
            void renderer.next?.();
            return;
          }
          if (y < h * 0.28) {
            void renderer.prev?.();
            return;
          }
        }
        setChromeVisible((v) => !v);
      };
      const onCancel = () => {
        start = null;
      };
      doc.addEventListener("pointerdown", onDown, { passive: true });
      doc.addEventListener("pointerup", onUp, { passive: true });
      doc.addEventListener("pointercancel", onCancel, { passive: true });
      cleanups.push(() => {
        doc.removeEventListener("pointerdown", onDown);
        doc.removeEventListener("pointerup", onUp);
        doc.removeEventListener("pointercancel", onCancel);
      });
    };

    // Current open document(s)
    try {
      const contents = (
        renderer as { getContents?: () => Array<{ doc?: Document }> }
      ).getContents?.();
      for (const c of contents ?? []) {
        if (c?.doc) attachDocTap(c.doc);
      }
    } catch {
      /* ignore */
    }

    const onLoad = (event: Event) => {
      const detail = (event as CustomEvent<{ doc?: Document }>).detail;
      if (detail?.doc) attachDocTap(detail.doc);
    };
    view.addEventListener("load", onLoad);
    cleanups.push(() => view.removeEventListener("load", onLoad));

    // Section chaining at scroll edges (debounce to avoid double next()).
    let edgeTimer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (edgeTimer) clearTimeout(edgeTimer);
      edgeTimer = setTimeout(() => {
        edgeTimer = null;
        if (sectionNavLock) return;
        const start = Number(renderer.start ?? 0);
        const end = Number(renderer.end ?? 0);
        const viewSize = Number(renderer.viewSize ?? 0);
        if (isScrolledAtSectionEnd(start, end, viewSize)) {
          sectionNavLock = true;
          void Promise.resolve(renderer.next?.())
            .catch(() => {
              /* soft-fail */
            })
            .finally(() => {
              // Unlock after layout settles so we don't skip chapters.
              setTimeout(() => {
                sectionNavLock = false;
              }, 400);
            });
          return;
        }
        if (isScrolledAtSectionStart(start) && start === 0) {
          // Only go prev when user is at absolute top (avoid bounce loops).
          // Require a second scroll signal via wheel/touch overscroll — handled below.
        }
      }, 120);
    };

    // Wheel overscroll at edges → prev/next section (desktop + some Android pads).
    const onWheel = (e: WheelEvent) => {
      if (sectionNavLock) return;
      const start = Number(renderer.start ?? 0);
      const end = Number(renderer.end ?? 0);
      const viewSize = Number(renderer.viewSize ?? 0);
      if (e.deltaY > 0 && isScrolledAtSectionEnd(start, end, viewSize)) {
        sectionNavLock = true;
        void Promise.resolve(renderer.next?.()).finally(() => {
          setTimeout(() => {
            sectionNavLock = false;
          }, 400);
        });
      } else if (e.deltaY < 0 && isScrolledAtSectionStart(start)) {
        sectionNavLock = true;
        void Promise.resolve(renderer.prev?.()).finally(() => {
          setTimeout(() => {
            sectionNavLock = false;
          }, 400);
        });
      }
    };

    renderer.addEventListener("scroll", onScroll);
    // Host wheel — foliate container may not bubble; also listen on host.
    const host = hostRef.current;
    host?.addEventListener("wheel", onWheel, { passive: true });
    cleanups.push(() => {
      renderer.removeEventListener("scroll", onScroll);
      host?.removeEventListener("wheel", onWheel);
      if (edgeTimer) clearTimeout(edgeTimer);
    });

    return () => {
      for (const c of cleanups) c();
    };
  }, [status, prefs.mode, anySheetOpen]);

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

        // Live flow + layout + typography + theme + custom face (READ-01/02/03/06).
        // Page margins via setStyles body padding; foliate margin attr is header band only.
        if (!isFxl) {
          view.renderer?.setAttribute?.("flow", flowAttr(loaded.mode));
          applyFoliateLayoutAttrs(view.renderer, host.clientHeight);
          view.renderer?.setStyles?.(
            buildReadingCss(
              loaded,
              buildFontFaceCss(loaded.activeFontId),
              fontFamilyCssFor(loaded.fontFamilyKey, loaded.activeFontId),
            ),
          );
        }

        // TOC for sheet (READ-05)
        setTocItems(normalizeToc(view.book?.toc));

        // Map registry id → work_id without blocking open (D-26).
        try {
          const ensured = await invoke<EnsureWorkResult>("ensure_work", { id });
          if (!cancelled && ensured?.workId) {
            workIdRef.current = ensured.workId;
            await ensureWorkRow(ensured.workId, ensured.contentHash, "epub");
          }
        } catch (err) {
          console.warn("[FoliateView] ensure_work failed; progress disabled", err);
        }

        // Restore locator or goToTextStart (D-25). Soft-fail invalid CFI.
        const workId = workIdRef.current;
        let restored = false;
        if (workId) {
          try {
            const loc = await loadLocator(workId);
            if (loc?.cfi) {
              try {
                await view.goTo(loc.cfi);
                restored = true;
              } catch (err) {
                console.warn("[FoliateView] goTo(cfi) failed; text start", err);
              }
            }
          } catch (err) {
            console.warn("[FoliateView] loadLocator failed", err);
          }
        }
        if (!restored) {
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
  }, [id, scheduleLocatorUpsert]);

  // Also flush locator when parent closes via onClose path — onClose may unmount us;
  // wrap onBack to flush first.
  const handleBack = useCallback(() => {
    void flushLocator().finally(() => {
      onClose?.();
    });
  }, [flushLocator, onClose]);

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
        {status === "reading" ? (
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
