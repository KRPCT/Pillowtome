/**
 * Note editor (D-72 笔记) — bottom sheet over the shared `.reader-sheet` shell
 * (CLAUDE.md touch/scroll gate), styled per mockup §05 .anno-editor：serif 引文
 * 带 3px 批注色条、1px 发丝线 textarea（聚焦朱砂边）、「锚点 · 自动保存」小字
 * + 朱砂完成钮。A note always hangs off a highlight: saving writes the note text
 * and KEEPS the mark; clearing the text on 完成 removes the note but keeps the
 * highlight (the host never deletes the annotation here).
 *
 * Excerpt + note render as React text nodes (default escaping) — no raw HTML
 * injection sink (stored-XSS mitigation T-05-10).
 */

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { AnnotationRow } from "./annotation-store";
import type { ReadingTheme } from "./apply-reading-styles";

export interface NoteEditorSheetProps {
  /** The annotation whose note is being edited; null closes the sheet. */
  annotation: AnnotationRow | null;
  /** Called with the final note text on 完成 / dismiss (auto-save). */
  onClose: (note: string) => void;
  /** Reader theme — flips the sheet to 墨壳 at night. */
  theme?: ReadingTheme;
}

export function NoteEditorSheet({
  annotation,
  onClose,
  theme = "day",
}: NoteEditorSheetProps) {
  const [text, setText] = useState("");

  useEffect(() => {
    setText(annotation?.note ?? "");
  }, [annotation]);

  const open = annotation != null;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose(text);
      }}
    >
      <SheetContent
        side="bottom"
        data-theme={theme}
        className="reader-note-sheet reader-sheet flex max-h-[min(70vh,640px)] flex-col gap-0 p-0"
        showCloseButton={false}
      >
        <SheetHeader className="reader-sheet__header shrink-0 flex-row items-center justify-between px-5 pt-4 pb-2">
          <SheetTitle className="reader-toc-sheet__title">笔记</SheetTitle>
          <SheetDescription className="sr-only">
            为选中的高亮添加或修改笔记
          </SheetDescription>
          <button
            type="button"
            className="reader-note-sheet__done"
            onClick={() => onClose(text)}
          >
            完成
          </button>
        </SheetHeader>

        <div className="reader-sheet__body min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 [-webkit-overflow-scrolling:touch] [touch-action:pan-y]">
          {annotation?.text_exact ? (
            <p
              className="reader-anno-editor__excerpt"
              style={{
                ["--bar" as string]: `var(--anno-${annotation.color ?? "cinnabar"}, var(--cinnabar))`,
              }}
            >
              <span className="sr-only">摘录：</span>
              {annotation.text_exact}
            </p>
          ) : null}
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="写下这条笔记…"
            aria-label="笔记内容"
            className="reader-anno-editor__ta"
          />
          <div className="reader-anno-editor__row">
            <span className="reader-anno-editor__loc">
              锚点：CFI + 上下文 · 自动保存
            </span>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default NoteEditorSheet;
