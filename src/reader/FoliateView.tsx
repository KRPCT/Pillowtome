import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "../vendor/foliate-js/view.js";
import { pillowUrl } from "../lib/pillow";
import { ErrorCard } from "./error-card";
import { ReaderChrome } from "./ReaderChrome";
import { SettingsSheet } from "./SettingsSheet";
import {
  DEFAULT_PREFS,
  SYSTEM_CJK_STACK,
  buildReadingCss,
  flowAttr,
  type ReadingPrefs,
} from "./apply-reading-styles";
import {
  PREFS_SAVE_DEBOUNCE_MS,
  loadReadingPrefs,
  saveReadingPrefs,
} from "./reading-prefs";
import type {
  FoliateViewElement,
  RelocateDetail,
} from "./foliate-types";

/**
 * foliate-js 阅读视图 + UI-SPEC chrome + typography/theme prefs (READ-01/02/03).
 *
 * Constraints:
 * - Book bytes only via `fetch(pillow://...)` — never IPC (D-06).
 * - DRM gate via `check_protection` before `view.open` (D-10).
 * - Flow via `renderer.setAttribute("flow", flowAttr(mode))`.
 * - Typography/theme via `setStyles` + `margin` attribute + `data-theme` (D-22).
 * - Prefs: SQLite global only — never localStorage (D-20).
 * - Clean-room chrome from UI-SPEC; no Readest AGPL (T-02-agpl / DEC-001).
 */

/** `check_protection` gate decision (small struct over IPC only). */
interface ProtectionDecision {
  canRender: boolean;
  message?: string;
}

export interface FoliateViewProps {
  /** Registered book id (SourceRegistry). */
  id?: string;
  /** Close reader → home shell. */
  onClose?: () => void;
}

type Status = "loading" | "reading" | "error";

/** Resolve body font CSS for setStyles (custom faces land in 02-04). */
function fontFamilyCssFor(prefs: ReadingPrefs): string {
  // Until 02-04, only system CJK stack is available.
  if (prefs.fontFamilyKey === "system" || !prefs.activeFontId) {
    return SYSTEM_CJK_STACK;
  }
  return SYSTEM_CJK_STACK;
}

export function FoliateView({ id = "sample", onClose }: FoliateViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<FoliateViewElement | null>(null);
  const fxlRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefsRef = useRef<ReadingPrefs>(DEFAULT_PREFS);

  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState<string>("");
  const [location, setLocation] = useState<RelocateDetail | null>(null);
  const [prefs, setPrefs] = useState<ReadingPrefs>(DEFAULT_PREFS);
  const [chromeVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fxlLocked, setFxlLocked] = useState(false);
  const [bookTitle, setBookTitle] = useState("示例书籍");

  prefsRef.current = prefs;

  /** Apply flow + margin + setStyles to the live renderer (READ-01/02/03). */
  const applyPrefsToRenderer = useCallback((next: ReadingPrefs) => {
    const renderer = viewRef.current?.renderer;
    if (!renderer) return;

    // FXL has no flow/setStyles — chrome theme still via data-theme on root.
    if (fxlRef.current) return;

    renderer.setAttribute?.("flow", flowAttr(next.mode));
    renderer.setAttribute?.("margin", String(next.marginPx));
    const fontFaceCss = ""; // 02-04
    renderer.setStyles?.(
      buildReadingCss(next, fontFaceCss, fontFamilyCssFor(next)),
    );
  }, []);

  const scheduleSave = useCallback((next: ReadingPrefs) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveReadingPrefs(next).catch((err) => {
        console.warn("[FoliateView] prefs save failed", err);
      });
    }, PREFS_SAVE_DEBOUNCE_MS);
  }, []);

  const handlePrefsChange = useCallback(
    (partial: Partial<ReadingPrefs> | ReadingPrefs) => {
      const next: ReadingPrefs = { ...prefsRef.current, ...partial };
      setPrefs(next);
      applyPrefsToRenderer(next);
      scheduleSave(next);
    },
    [applyPrefsToRenderer, scheduleSave],
  );

  useEffect(() => {
    let cancelled = false;
    let created: FoliateViewElement | null = null;

    async function load() {
      try {
        // Prefs load in parallel with DRM/open (D-20). Fail-soft → defaults.
        const prefsPromise = loadReadingPrefs();

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

        // relocate carries progress; full locator persistence is 02-03.
        view.addEventListener("relocate", (event) => {
          const detail = (event as CustomEvent<RelocateDetail>).detail ?? {};
          setLocation({ fraction: detail.fraction ?? 0, cfi: detail.cfi });
        });

        await view.open(new File([blob], `${id}.epub`));
        if (cancelled) return;

        const isFxl = view.book?.rendition?.layout === "pre-paginated";
        fxlRef.current = Boolean(isFxl);
        setFxlLocked(Boolean(isFxl));

        const loaded = await prefsPromise;
        if (cancelled) return;
        setPrefs(loaded);
        prefsRef.current = loaded;

        // Live flow + typography + theme from prefs (READ-01/02/03).
        if (!isFxl) {
          view.renderer?.setAttribute?.("flow", flowAttr(loaded.mode));
          view.renderer?.setAttribute?.(
            "margin",
            String(loaded.marginPx),
          );
          view.renderer?.setStyles?.(
            buildReadingCss(loaded, "", fontFamilyCssFor(loaded)),
          );
        }

        // First open / no locator → text start (D-25); full restore in 02-03.
        await view.goToTextStart();

        // Best-effort title from engine metadata when present.
        const metaTitle = (
          view.book as { metadata?: { title?: string } } | undefined
        )?.metadata?.title;
        if (typeof metaTitle === "string" && metaTitle.trim()) {
          setBookTitle(metaTitle.trim());
        }

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
      created?.remove();
      viewRef.current = null;
    };
  }, [id]);

  if (status === "error") {
    return <ErrorCard message={message} onDismiss={onClose} />;
  }

  return (
    <div className="reader" data-theme={prefs.theme}>
      <ReaderChrome
        title={bookTitle}
        fraction={location?.fraction ?? null}
        chromeVisible={chromeVisible}
        onBack={onClose}
        onOpenToc={() => {
          /* TOC sheet — plan 02-03 */
        }}
        onOpenSearch={() => {
          /* Search sheet — plan 02-03 */
        }}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {status === "loading" ? (
        <div className="reader__loading" aria-live="polite">
          加载中…
        </div>
      ) : null}

      <div ref={hostRef} className="reader__view" />

      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        prefs={prefs}
        onPrefsChange={handlePrefsChange}
        modeLocked={fxlLocked || status !== "reading"}
        fonts={[]}
        /* onImportFont omitted → disabled stub until 02-04 */
      />
    </div>
  );
}

export default FoliateView;
