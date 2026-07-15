/**
 * Immersive hit regions (READ-04).
 *
 * Paginate: full-area overlay — tap L/R page, center toggles chrome;
 *           horizontal swipe pages (finger left → next).
 * Scroll:   no capture layer — vertical pan goes entirely to foliate.
 *           Top edge strip only toggles chrome (does not cover body text).
 *
 * Clean-room from UI-SPEC (T-02-agpl).
 */

import { useCallback, useRef } from "react";
import type { ReadingMode } from "./apply-reading-styles";
import { resolveTapZone, tapZoneAction } from "./tap-zones";

export type TapZoneAction = "prev" | "next" | "toggle-chrome";

export interface ReaderTapZonesProps {
  /** When false, overlay does not receive pointer events (e.g. sheet open). */
  enabled?: boolean;
  mode: ReadingMode;
  onAction: (action: TapZoneAction) => void;
}

/** Min horizontal distance (px) to treat as swipe page-turn. */
const SWIPE_MIN_DX = 48;
/** Max vertical drift so diagonal moves don't page. */
const SWIPE_MAX_DY = 80;
/** Max movement still counted as a tap. */
const TAP_SLOP = 12;
/** Top strip height for scroll-mode chrome toggle (below safe area already). */
const SCROLL_CHROME_STRIP_PX = 40;

/**
 * Absolute overlay for immersive gestures.
 */
export function ReaderTapZones({
  enabled = true,
  mode,
  onAction,
}: ReaderTapZonesProps) {
  const pointerIdRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!enabled) return;
      if (e.isPrimary === false) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pointerIdRef.current = e.pointerId;
      startRef.current = { x: e.clientX, y: e.clientY };
    },
    [enabled],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!enabled) return;
      if (pointerIdRef.current !== e.pointerId) return;
      pointerIdRef.current = null;

      const start = startRef.current;
      startRef.current = null;
      if (!start) return;

      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);

      // Paginate: horizontal swipe → page (finger left = next).
      if (
        mode === "paginate" &&
        adx >= SWIPE_MIN_DX &&
        adx > ady &&
        ady <= SWIPE_MAX_DY
      ) {
        onAction(dx < 0 ? "next" : "prev");
        return;
      }

      // Small movement = tap.
      if (adx > TAP_SLOP || ady > TAP_SLOP) return;

      if (mode === "scroll") {
        onAction("toggle-chrome");
        return;
      }

      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const zone = resolveTapZone(x, rect.width);
      onAction(tapZoneAction(zone, mode));
    },
    [enabled, mode, onAction],
  );

  const handlePointerCancel = useCallback(() => {
    pointerIdRef.current = null;
    startRef.current = null;
  }, []);

  if (!enabled) return null;

  // Scroll: only a thin top strip — body stays free for native pan-y into foliate.
  if (mode === "scroll") {
    return (
      <div
        className="reader__tap-zones reader__tap-zones--scroll-top"
        aria-hidden="true"
        data-enabled="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: SCROLL_CHROME_STRIP_PX,
          zIndex: 4,
          pointerEvents: "auto",
          touchAction: "manipulation",
          background: "transparent",
        }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      />
    );
  }

  return (
    <div
      className="reader__tap-zones"
      aria-hidden="true"
      data-enabled="true"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 4,
        pointerEvents: "auto",
        touchAction: "pan-y",
        background: "transparent",
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    />
  );
}

export default ReaderTapZones;
