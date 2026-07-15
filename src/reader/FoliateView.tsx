import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "../vendor/foliate-js/view.js";
import { pillowUrl } from "../lib/pillow";
import { ErrorCard } from "./error-card";
import { ReaderChrome } from "./ReaderChrome";
import {
  DEFAULT_PREFS,
  flowAttr,
  type ReadingMode,
  type ReadingTheme,
} from "./apply-reading-styles";
import type {
  FoliateViewElement,
  RelocateDetail,
} from "./foliate-types";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/**
 * foliate-js 阅读视图 + UI-SPEC chrome foundation (READ-01).
 *
 * Constraints:
 * - Book bytes only via `fetch(pillow://...)` — never IPC (D-06).
 * - DRM gate via `check_protection` before `view.open` (D-10).
 * - Flow applied only via `renderer.setAttribute("flow", flowAttr(mode))`.
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

export function FoliateView({ id = "sample", onClose }: FoliateViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<FoliateViewElement | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState<string>("");
  const [location, setLocation] = useState<RelocateDetail | null>(null);
  const [mode, setMode] = useState<ReadingMode>(DEFAULT_PREFS.mode);
  const [theme] = useState<ReadingTheme>(DEFAULT_PREFS.theme);
  const [chromeVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fxlLocked, setFxlLocked] = useState(false);
  const [bookTitle, setBookTitle] = useState("示例书籍");

  const applyFlow = useCallback((next: ReadingMode) => {
    viewRef.current?.renderer?.setAttribute?.("flow", flowAttr(next));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let created: FoliateViewElement | null = null;

    async function load() {
      try {
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

        // relocate carries progress; full locator persistence is 02-02/03.
        view.addEventListener("relocate", (event) => {
          const detail = (event as CustomEvent<RelocateDetail>).detail ?? {};
          setLocation({ fraction: detail.fraction ?? 0, cfi: detail.cfi });
        });

        await view.open(new File([blob], `${id}.epub`));
        if (cancelled) return;

        const isFxl = view.book?.rendition?.layout === "pre-paginated";
        setFxlLocked(Boolean(isFxl));

        // Live flow from prefs; first open / no locator → text start (D-25).
        if (!isFxl) {
          view.renderer?.setAttribute?.("flow", flowAttr(DEFAULT_PREFS.mode));
        }
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
      created?.remove();
      viewRef.current = null;
    };
  }, [id]);

  function handleModeChange(value: string) {
    if (!value || fxlLocked) return;
    if (value !== "paginate" && value !== "scroll") return;
    const next = value as ReadingMode;
    setMode(next);
    // READ-01: apply live without reopening the book.
    applyFlow(next);
  }

  if (status === "error") {
    return <ErrorCard message={message} onDismiss={onClose} />;
  }

  return (
    <div className="reader" data-theme={theme}>
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

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent
          side="bottom"
          className="reader-settings-sheet max-h-[70vh]"
          showCloseButton
        >
          <SheetHeader>
            <SheetTitle className="text-lg font-semibold">显示设置</SheetTitle>
            <SheetDescription className="sr-only">
              调整阅读模式与显示选项
            </SheetDescription>
          </SheetHeader>

          <section className="reader-settings-section px-4 pb-6">
            <h3 className="reader-settings-section__title">阅读模式</h3>
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={handleModeChange}
              variant="outline"
              spacing={0}
              disabled={fxlLocked || status !== "reading"}
              aria-label="阅读模式"
              className="w-full"
            >
              <ToggleGroupItem value="paginate" aria-label="分页" className="flex-1">
                分页
              </ToggleGroupItem>
              <ToggleGroupItem value="scroll" aria-label="滚动" className="flex-1">
                滚动
              </ToggleGroupItem>
            </ToggleGroup>
            {fxlLocked ? (
              <p className="reader-settings-section__hint">
                固定版式书籍不支持切换阅读模式
              </p>
            ) : null}
          </section>

          {/* Placeholder sections for 02-02 — keep sheet extensible */}
          <div className="px-4 pb-4">
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setSettingsOpen(false)}
            >
              关闭
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default FoliateView;
