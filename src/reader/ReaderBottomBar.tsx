import { useCallback, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";

/**
 * Bottom reading navigation (P0 hero): a draggable whole-book scrubber with
 * chapter tick marks, a tap-to-cycle progress caption, and a "返回原位" undo pill
 * shown after a jump. The undo pill is the honest safety net over imperfect
 * position math — any jump is one tap to reverse.
 *
 * Clean-room from UI-SPEC; no Readest source.
 */
export interface ReaderBottomBarProps {
  visible: boolean;
  /** Whole-book fraction 0..1 (null → unknown). */
  fraction: number | null;
  /** Current chapter label (from foliate tocItem), if any. */
  chapterLabel?: string | null;
  /** Whole-book start fractions of chapters, for tick marks. */
  ticks?: number[];
  /** Commit a scrub jump to this whole-book fraction. */
  onScrub: (fraction: number) => void;
  /** Show the 返回原位 undo affordance. */
  undoVisible?: boolean;
  onUndo?: () => void;
}

function pct(f: number): number {
  return Math.round(Math.max(0, Math.min(1, f)) * 100);
}

export function ReaderBottomBar({
  visible,
  fraction,
  chapterLabel,
  ticks = [],
  onScrub,
  undoVisible = false,
  onUndo,
}: ReaderBottomBarProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [captionChapter, setCaptionChapter] = useState(true);

  const fracFromClientX = useCallback((clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button != null && e.button !== 0) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDrag(fracFromClientX(e.clientX));
    },
    [fracFromClientX],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (drag == null) return;
      setDrag(fracFromClientX(e.clientX));
    },
    [drag, fracFromClientX],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (drag == null) return;
      const target = fracFromClientX(e.clientX);
      setDrag(null);
      onScrub(target);
    },
    [drag, fracFromClientX, onScrub],
  );

  const shown = drag != null ? drag : (fraction ?? 0);
  const shownPct = pct(shown);
  const caption =
    captionChapter && chapterLabel
      ? chapterLabel
      : `全书 ${fraction != null ? pct(fraction) : 0}%`;

  // Always mounted so show/hide can fade+slide; data-visible toggles it.
  return (
    <div
      className="reader__bottom"
      data-visible={visible}
      role="group"
      aria-label="阅读进度导航"
    >
      {undoVisible ? (
        <button
          type="button"
          className="reader__undo-pill"
          onClick={onUndo}
          aria-label="返回原位"
        >
          <RotateCcw aria-hidden />
          返回原位
        </button>
      ) : null}

      <div className="reader__bottom-inner">
        <button
          type="button"
          className="reader__scrub-caption"
          onClick={() => setCaptionChapter((v) => !v)}
          title="切换进度显示"
        >
          {caption}
        </button>

        <div
          ref={trackRef}
          className="reader__scrub-track"
          role="slider"
          aria-label="阅读进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={shownPct}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.05 : 0.01;
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              onScrub(Math.max(0, (fraction ?? 0) - step));
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              onScrub(Math.min(1, (fraction ?? 0) + step));
            }
          }}
        >
          <div className="reader__scrub-fill" style={{ width: `${shownPct}%` }} />
          {ticks.map((t, i) => (
            <span
              key={i}
              className="reader__scrub-tick"
              style={{ left: `${pct(t)}%` }}
              aria-hidden
            />
          ))}
          <span
            className="reader__scrub-handle"
            style={{ left: `${shownPct}%` }}
            aria-hidden
          />
          {drag != null ? (
            <span
              className="reader__scrub-tooltip"
              style={{ left: `${shownPct}%` }}
              aria-hidden
            >
              {shownPct}%
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default ReaderBottomBar;
