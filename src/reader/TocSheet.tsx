/**
 * 目录 sheet/drawer — nested TOC jump via view.goTo (READ-05).
 * Prefer left drawer ≥768px, bottom sheet on phone (UI-SPEC).
 * Clean-room from UI-SPEC (T-02-agpl).
 */

import { useEffect, useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { flattenToc, type TocItem } from "./toc";

export interface TocSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Raw nested TOC from view.book?.toc (normalized). */
  items: TocItem[];
  /** Optional active label for accent highlight. */
  activeLabel?: string | null;
  /** Navigate to href then close. */
  onNavigate: (href: string) => void | Promise<void>;
}

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(min-width: 768px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => setIsDesktop(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}

/** Normalize foliate toc nodes (optional label/href) into TocItem[]. */
export function normalizeToc(
  raw: Array<{ label?: string; href?: string; subitems?: unknown[] }> | undefined | null,
): TocItem[] {
  if (!raw?.length) return [];
  const walk = (
    nodes: Array<{ label?: string; href?: string; subitems?: unknown[] }>,
  ): TocItem[] =>
    nodes.map((n) => ({
      label: typeof n.label === "string" ? n.label : "",
      href: typeof n.href === "string" ? n.href : "",
      subitems: Array.isArray(n.subitems)
        ? walk(n.subitems as Array<{ label?: string; href?: string; subitems?: unknown[] }>)
        : undefined,
    }));
  return walk(raw);
}

export function TocSheet({
  open,
  onOpenChange,
  items,
  activeLabel = null,
  onNavigate,
}: TocSheetProps) {
  const isDesktop = useIsDesktop();
  const flat = useMemo(() => flattenToc(items), [items]);
  const empty = flat.length === 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isDesktop ? "left" : "bottom"}
        className={
          isDesktop
            ? "reader-toc-sheet reader-toc-sheet--drawer reader-sheet flex h-full w-[min(360px,85vw)] flex-col gap-0 p-0 sm:max-w-sm"
            : "reader-toc-sheet reader-toc-sheet--bottom reader-sheet flex max-h-[min(90vh,720px)] flex-col gap-0 p-0"
        }
        showCloseButton
      >
        <SheetHeader className="reader-sheet__header shrink-0 px-4 pt-4 pb-2">
          <SheetTitle className="reader-toc-sheet__title">目录</SheetTitle>
          <SheetDescription className="sr-only">
            选择章节跳转到对应位置
          </SheetDescription>
        </SheetHeader>

        {empty ? (
          <div className="reader-toc-sheet__empty" role="status">
            <p className="reader-toc-sheet__empty-title">暂无目录</p>
            <p className="reader-toc-sheet__empty-hint">
              这本书没有提供目录信息
            </p>
          </div>
        ) : (
          <div className="reader-sheet__body reader-toc-sheet__list min-h-0 flex-1 overflow-y-auto overscroll-contain px-0 pb-4 [-webkit-overflow-scrolling:touch] [touch-action:pan-y]">
            <ul className="reader-toc-sheet__ul" role="list">
              {flat.map((item, idx) => {
                const isActive =
                  activeLabel != null &&
                  item.label.trim() !== "" &&
                  item.label === activeLabel;
                const disabled = !item.href;
                return (
                  <li key={`${item.href}-${idx}-${item.depth}`}>
                    <button
                      type="button"
                      className={
                        isActive
                          ? "reader-toc-item reader-toc-item--active"
                          : "reader-toc-item"
                      }
                      style={{ paddingLeft: 16 + item.depth * 16 }}
                      disabled={disabled}
                      onClick={() => {
                        if (!item.href) return;
                        void Promise.resolve(onNavigate(item.href));
                      }}
                    >
                      <span className="reader-toc-item__label">
                        {item.label || "未命名章节"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default TocSheet;
