/**
 * Annotations manager (批注) — mockup §05 .anno-sheet：计数 tabs（高亮/笔记/
 * 书签）、serif 引文 + 左侧 3px 批注色条、--paper-2 笔记小卡、meta 行
 * （章节 · 进度% + 时间）。Reuses the shared sheet shell (left drawer ≥768px,
 * bottom sheet on phone) and its touch/scroll-gate-safe body (CLAUDE.md gate #3).
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
import { capturePosition, positionForTocSpine } from "./position-bus";
import type { ReadingPosition } from "./reading-position";
import { spineFromCfi } from "./scroll-cfi";
import type { AnnotationRow } from "./annotation-store";
import type { ReadingTheme } from "./apply-reading-styles";

type Filter = "highlight" | "note" | "bookmark";

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
  /** Reader theme — flips the sheet to 墨壳 at night. */
  theme?: ReadingTheme;
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
  }
}

const EMPTY_COPY: Record<Filter, { title: string; body: string }> = {
  highlight: { title: "还没有高亮", body: "划选正文即可添加高亮或下划线" },
  note: { title: "还没有笔记", body: "在高亮上点「笔记」即可写下想法" },
  bookmark: { title: "还没有书签", body: "点工具栏的书签按钮即可标记当前位置" },
};

/** 「今天 12:20 / 昨天 23:04 / 3月5日」(mockup §05 anno-meta)。 */
function formatAnnoTime(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const now = new Date();
  if (sameDay(d, now)) return `今天 ${hh}:${mm}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `昨天 ${hh}:${mm}`;
  if (d.getFullYear() === now.getFullYear())
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function AnnotationsSheet({
  open,
  onOpenChange,
  annotations,
  chapterLabel,
  onJump,
  onDelete,
  theme = "day",
}: AnnotationsSheetProps) {
  const isDesktop = useIsDesktop();
  const [filter, setFilter] = useState<Filter>("highlight");
  /** Note rows require a two-step confirm; tracks the row awaiting 确认删除. */
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      highlight: annotations.filter((a) => matchesFilter(a, "highlight"))
        .length,
      note: annotations.filter((a) => matchesFilter(a, "note")).length,
      bookmark: annotations.filter((a) => matchesFilter(a, "bookmark")).length,
    }),
    [annotations],
  );

  /** Flat, reading-ordered list (spine asc, then creation order inside a spine). */
  const rows = useMemo(() => {
    const filtered = annotations.filter((a) => matchesFilter(a, filter));
    return filtered
      .map((a, i) => ({ a, i, spine: spineFromCfi(a.cfi) ?? 0 }))
      .sort((x, y) => x.spine - y.spine || x.i - y.i);
  }, [annotations, filter]);

  const empty = rows.length === 0;

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

  const tabs: Array<{ key: Filter; label: string }> = [
    { key: "highlight", label: "高亮" },
    { key: "note", label: "笔记" },
    { key: "bookmark", label: "书签" },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isDesktop ? "left" : "bottom"}
        data-theme={theme}
        className={
          isDesktop
            ? "reader-anno-sheet reader-sheet flex h-full w-[min(360px,85vw)] flex-col gap-0 p-0 sm:max-w-sm"
            : "reader-anno-sheet reader-sheet flex max-h-[min(90vh,720px)] flex-col gap-0 p-0"
        }
        showCloseButton
      >
        <SheetHeader className="reader-sheet__header shrink-0 px-4 pt-4 pb-0">
          <SheetTitle className="reader-toc-sheet__title">批注</SheetTitle>
          <SheetDescription className="sr-only">
            管理高亮、笔记与书签，点按跳转到对应位置
          </SheetDescription>
        </SheetHeader>

        <div
          className="reader-anno-tabs shrink-0"
          role="tablist"
          aria-label="批注筛选"
        >
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={filter === t.key}
              className={
                filter === t.key
                  ? "reader-anno-tab reader-anno-tab--on"
                  : "reader-anno-tab"
              }
              onClick={() => {
                setFilter(t.key);
                setConfirmId(null);
              }}
            >
              {t.label} {counts[t.key]}
            </button>
          ))}
        </div>

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
          <div className="reader-sheet__body min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch] [touch-action:pan-y]">
            <ul className="reader-anno-list" role="list">
              {rows.map(({ a, spine }) => {
                const chapter =
                  chapterLabel?.(spine) ?? `第 ${spine + 1} 章`;
                const frac = a.progress_fraction;
                const loc =
                  frac != null && Number.isFinite(frac)
                    ? `${chapter} · ${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)}%`
                    : chapter;
                const confirming = confirmId === a.annotation_id;
                return (
                  <li key={a.annotation_id} className="reader-anno-item">
                    <button
                      type="button"
                      className="reader-anno-item__main"
                      onClick={() => jump(a)}
                    >
                      <span
                        className="reader-anno-quote"
                        style={{
                          ["--bar" as string]:
                            a.type === "bookmark"
                              ? "var(--cinnabar)"
                              : `var(--anno-${a.color ?? "cinnabar"}, var(--cinnabar))`,
                        }}
                      >
                        {a.type === "bookmark"
                          ? "书签"
                          : a.text_exact || "（无摘录）"}
                      </span>
                      {a.note ? (
                        <span className="reader-anno-note">{a.note}</span>
                      ) : null}
                      <span className="reader-anno-meta">
                        <span>{loc}</span>
                        <span>{formatAnnoTime(a.created_at)}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className={
                        confirming
                          ? "reader-anno-item__delete reader-anno-item__delete--confirm"
                          : "reader-anno-item__delete"
                      }
                      aria-label={confirming ? "确认删除" : "删除"}
                      onClick={() => requestDelete(a)}
                    >
                      {confirming ? "确认" : "删除"}
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

export default AnnotationsSheet;
