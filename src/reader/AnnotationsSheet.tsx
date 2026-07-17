/**
 * Annotations manager (批注) — chapter-grouped list + jump + delete. Reuses the
 * TocSheet shell (left drawer ≥768px, bottom sheet on phone) and its
 * touch/scroll-gate-safe body (CLAUDE.md gate #3). Bookmarks are folded in — no
 * separate surface.
 *
 * Row tap builds a ReadingPosition via the single jump bus (position-bus) and
 * hands it up; this sheet never invents a second navigation path (D-82).
 * Excerpt/note render as React text nodes — no raw HTML injection sink (T-05-10).
 */

import { useEffect, useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { capturePosition, positionForTocSpine } from "./position-bus";
import type { ReadingPosition } from "./reading-position";
import { spineFromCfi } from "./scroll-cfi";
import type { AnnotationRow } from "./annotation-store";

type Filter = "all" | "highlight" | "note" | "bookmark";

export interface AnnotationsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  annotations: AnnotationRow[];
  /** Best-effort chapter label for a spine index (falls back to a generic label). */
  chapterLabel?: (spineIndex: number) => string;
  /** Jump to the annotation's position (applied by the host via position-bus). */
  onJump: (pos: ReadingPosition) => void;
  /** Soft-delete the annotation (host calls annotation-store tombstone). */
  onDelete: (annotation: AnnotationRow) => void;
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

function matchesFilter(a: AnnotationRow, filter: Filter): boolean {
  switch (filter) {
    case "highlight":
      return a.type === "highlight" || a.type === "underline";
    case "note":
      return !!a.note;
    case "bookmark":
      return a.type === "bookmark";
    default:
      return true;
  }
}

const EMPTY_COPY: Record<Filter, { title: string; body: string }> = {
  all: {
    title: "还没有批注",
    body: "阅读时长按或划选正文，即可高亮、写笔记或添加书签",
  },
  highlight: { title: "还没有高亮", body: "划选正文即可添加高亮或下划线" },
  note: { title: "还没有笔记", body: "在高亮上点「笔记」即可写下想法" },
  bookmark: { title: "还没有书签", body: "点工具栏的书签按钮即可标记当前位置" },
};

export function AnnotationsSheet({
  open,
  onOpenChange,
  annotations,
  chapterLabel,
  onJump,
  onDelete,
}: AnnotationsSheetProps) {
  const isDesktop = useIsDesktop();
  const [filter, setFilter] = useState<Filter>("all");
  /** Note rows require a two-step confirm; tracks the row awaiting 确认删除. */
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const groups = useMemo(() => {
    const bySpine = new Map<number, AnnotationRow[]>();
    for (const a of annotations) {
      if (!matchesFilter(a, filter)) continue;
      const spine = spineFromCfi(a.cfi) ?? 0;
      const list = bySpine.get(spine) ?? [];
      list.push(a);
      bySpine.set(spine, list);
    }
    return Array.from(bySpine.entries()).sort((x, y) => x[0] - y[0]);
  }, [annotations, filter]);

  const empty = groups.length === 0;

  const jump = (a: AnnotationRow) => {
    const spine = spineFromCfi(a.cfi) ?? 0;
    const pos =
      capturePosition({
        cfi: a.cfi,
        spineIndex: spine,
        offsetFraction: 0,
        fraction: a.progress_fraction,
      }) ?? positionForTocSpine(spine);
    onJump(pos);
    onOpenChange(false);
  };

  const requestDelete = (a: AnnotationRow) => {
    // A note holds typed content → two-step confirm; marks/bookmarks are immediate.
    if (a.note && confirmId !== a.annotation_id) {
      setConfirmId(a.annotation_id);
      return;
    }
    setConfirmId(null);
    onDelete(a);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isDesktop ? "left" : "bottom"}
        className={
          isDesktop
            ? "reader-anno-sheet reader-sheet flex h-full w-[min(360px,85vw)] flex-col gap-0 p-0 sm:max-w-sm"
            : "reader-anno-sheet reader-sheet flex max-h-[min(90vh,720px)] flex-col gap-0 p-0"
        }
        showCloseButton
      >
        <SheetHeader className="reader-sheet__header shrink-0 px-4 pt-4 pb-2">
          <SheetTitle className="reader-toc-sheet__title">批注</SheetTitle>
          <SheetDescription className="sr-only">
            管理高亮、笔记与书签，点按跳转到对应位置
          </SheetDescription>
        </SheetHeader>

        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(v) => v && setFilter(v as Filter)}
          className="reader-anno-sheet__filter shrink-0"
        >
          <ToggleGroupItem value="all" aria-label="全部">
            全部
          </ToggleGroupItem>
          <ToggleGroupItem value="highlight" aria-label="高亮">
            高亮
          </ToggleGroupItem>
          <ToggleGroupItem value="note" aria-label="笔记">
            笔记
          </ToggleGroupItem>
          <ToggleGroupItem value="bookmark" aria-label="书签">
            书签
          </ToggleGroupItem>
        </ToggleGroup>

        {empty ? (
          <div className="reader-toc-sheet__empty" role="status">
            <p className="reader-toc-sheet__empty-title">
              {EMPTY_COPY[filter].title}
            </p>
            <p className="reader-toc-sheet__empty-hint">
              {EMPTY_COPY[filter].body}
            </p>
          </div>
        ) : (
          <div className="reader-sheet__body min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4 [-webkit-overflow-scrolling:touch] [touch-action:pan-y]">
            {groups.map(([spine, rows]) => (
              <section key={spine}>
                <h3 className="reader-anno-group__header">
                  {chapterLabel?.(spine) ?? `第 ${spine + 1} 章`}
                </h3>
                <ul className="reader-toc-sheet__ul" role="list">
                  {rows.map((a) => (
                    <li key={a.annotation_id} className="reader-anno-row-wrap">
                      <button
                        type="button"
                        className="reader-anno-row"
                        onClick={() => jump(a)}
                      >
                        <span
                          className="reader-anno-row__dot"
                          aria-hidden="true"
                          style={{
                            ["--dot" as string]:
                              a.type === "bookmark"
                                ? "var(--reader-accent)"
                                : `var(--anno-${a.color ?? "cinnabar"})`,
                          }}
                        />
                        <span className="reader-anno-row__body">
                          <span className="reader-anno-row__excerpt">
                            {a.type === "bookmark"
                              ? "书签"
                              : a.text_exact || "（无摘录）"}
                          </span>
                          {a.note ? (
                            <span className="reader-anno-row__note">{a.note}</span>
                          ) : null}
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          className="reader-anno-row__delete"
                          aria-label={
                            confirmId === a.annotation_id ? "确认删除" : "删除"
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            requestDelete(a);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              requestDelete(a);
                            }
                          }}
                        >
                          {confirmId === a.annotation_id ? "确认删除" : "删除"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default AnnotationsSheet;
