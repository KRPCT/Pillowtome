/**
 * Note editor (D-72 笔记) — bottom sheet over the shared `.reader-sheet` shell
 * (CLAUDE.md touch/scroll gate). A note always hangs off a highlight: saving
 * writes the note text and KEEPS the mark; clearing the text on 完成 removes the
 * note but keeps the highlight (the host never deletes the annotation here).
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
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AnnotationRow } from "./annotation-store";

export interface NoteEditorSheetProps {
  /** The annotation whose note is being edited; null closes the sheet. */
  annotation: AnnotationRow | null;
  /** Called with the final note text on 完成 / dismiss (auto-save). */
  onClose: (note: string) => void;
}

export function NoteEditorSheet({ annotation, onClose }: NoteEditorSheetProps) {
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
        className="reader-note-sheet reader-sheet flex max-h-[min(70vh,640px)] flex-col gap-0 p-0"
        showCloseButton={false}
      >
        <SheetHeader className="reader-sheet__header shrink-0 flex-row items-center justify-between px-4 pt-4 pb-2">
          <SheetTitle className="reader-toc-sheet__title">笔记</SheetTitle>
          <SheetDescription className="sr-only">
            为选中的高亮添加或修改笔记
          </SheetDescription>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="reader-note-sheet__done"
            onClick={() => onClose(text)}
          >
            完成
          </Button>
        </SheetHeader>

        <div className="reader-sheet__body min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 [-webkit-overflow-scrolling:touch] [touch-action:pan-y]">
          {annotation?.text_exact ? (
            <p className="reader-anno-editor__excerpt">
              <span className="sr-only">摘录：</span>
              {annotation.text_exact}
            </p>
          ) : null}
          <Textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="写点想法…"
            className="min-h-[120px] resize-none"
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default NoteEditorSheet;
