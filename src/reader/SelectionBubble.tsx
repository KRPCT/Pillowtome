/**
 * Selection action bubble (D-72/D-73/D-74/D-75) — clean-room from UI-SPEC.
 *
 * ONE component for both create and edit contexts, both reading modes. It is a
 * single absolutely-positioned element on the reader root; `pointer-events:auto`
 * lives ONLY here — never a full-screen capture layer (CLAUDE.md touch gate #1,
 * D-74). The host (FoliateView) maps the section-iframe selection rect into
 * reader-root coordinates and hands it in via `selection.rect`; this component
 * only flips above/below the anchor and renders the action bar.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { Trash2, Underline } from "lucide-react";
import type { PaletteColor } from "./css-highlight";

export type BubbleContext = "create" | "edit";

export interface BubbleSelection {
  /** Anchor rect in reader-root (`.reader__view`) coordinates. */
  rect: { top: number; left: number; width: number; height: number };
  context: BubbleContext;
  /** Current color when editing an existing highlight (pre-selects the swatch). */
  color?: PaletteColor;
}

export interface SelectionBubbleProps {
  selection: BubbleSelection | null;
  onCreate: (type: "highlight" | "underline", color: PaletteColor) => void;
  onOpenNote: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

/** 5-color palette, cinnabar first/default (mockup §05 朱砂谱系). */
const SWATCHES: ReadonlyArray<{ key: PaletteColor; label: string }> = [
  { key: "cinnabar", label: "朱砂" },
  { key: "ochre", label: "赭石" },
  { key: "green", label: "黛绿" },
  { key: "indigo", label: "靛蓝" },
  { key: "lotus", label: "藕荷" },
];

const BUBBLE_GAP = 8;

export function SelectionBubble({
  selection,
  onCreate,
  onOpenNote,
  onCopy,
  onDelete,
}: SelectionBubbleProps) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<"above" | "below">("above");
  const [clampedLeft, setClampedLeft] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  // Flip below the anchor when there is no room above (D-75); clamp horizontally
  // into the reader view so small screens never push the bar off-viewport.
  useLayoutEffect(() => {
    if (!selection) return;
    setCopied(false);
    const el = barRef.current;
    const h = el?.offsetHeight ?? 44;
    setPlacement(selection.rect.top - h - BUBBLE_GAP < 0 ? "below" : "above");
    const center = selection.rect.left + selection.rect.width / 2;
    const parent = el?.offsetParent as HTMLElement | null;
    const bw = el?.offsetWidth ?? 0;
    if (parent && bw > 0) {
      const pw = parent.clientWidth;
      const min = bw / 2 + 8;
      const max = Math.max(min, pw - bw / 2 - 8);
      setClampedLeft(Math.min(Math.max(center, min), max));
    } else {
      setClampedLeft(center);
    }
  }, [selection]);

  if (!selection) return null;

  const { rect, context, color: current } = selection;
  const top =
    placement === "above"
      ? rect.top - (barRef.current?.offsetHeight ?? 44) - BUBBLE_GAP
      : rect.top + rect.height + BUBBLE_GAP;
  const left = clampedLeft ?? rect.left + rect.width / 2;

  return (
    <div
      ref={barRef}
      className="reader-anno-bubble"
      data-placement={placement}
      role="toolbar"
      aria-label="批注操作"
      style={{
        position: "absolute",
        top,
        left,
        transform: "translateX(-50%)",
        zIndex: 20,
        pointerEvents: "auto",
      }}
    >
      <div className="reader-anno-bubble__swatches">
        {SWATCHES.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className="reader-anno-bubble__swatch"
            data-selected={current === key}
            aria-label={`高亮·${label}`}
            aria-pressed={current === key}
            style={{ ["--swatch" as string]: `var(--anno-${key})` }}
            onClick={() => onCreate("highlight", key)}
          />
        ))}
      </div>

      <span className="reader-anno-bubble__divider" aria-hidden="true" />

      <button
        type="button"
        className="reader-anno-bubble__action"
        aria-label="下划线"
        onClick={() => onCreate("underline", current ?? "cinnabar")}
      >
        <Underline size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="reader-anno-bubble__action"
        aria-label="笔记"
        onClick={onOpenNote}
      >
        <span aria-hidden="true">✎</span> 笔记
      </button>
      <button
        type="button"
        className="reader-anno-bubble__action"
        aria-label="复制"
        onClick={() => {
          onCopy();
          setCopied(true);
        }}
      >
        {copied ? (
          "已复制"
        ) : (
          <>
            <span aria-hidden="true">⧉</span> 复制
          </>
        )}
      </button>

      {context === "edit" ? (
        <button
          type="button"
          className="reader-anno-bubble__action reader-anno-bubble__action--danger"
          aria-label="删除"
          onClick={onDelete}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export default SelectionBubble;
