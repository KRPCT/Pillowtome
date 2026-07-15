/**
 * Invisible L/C/R hit regions for immersive reading (READ-04).
 * Uses pure tap-zones helpers; paginate pages L/R, scroll only toggles chrome.
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

/**
 * Absolute full-size transparent overlay. Pointer-up (not multi-touch) resolves
 * zone → action. Does not call preventDefault on touchmove (scroll stays primary).
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
      // Ignore multi-touch / secondary pointers (pinch left to engine).
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

      // Treat small movement as tap; large drag is scroll/pan — ignore.
      const dx = Math.abs(e.clientX - start.x);
      const dy = Math.abs(e.clientY - start.y);
      if (dx > 12 || dy > 12) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const zone = resolveTapZone(x, rect.width);
      const action = tapZoneAction(zone, mode);
      onAction(action);
    },
    [enabled, mode, onAction],
  );

  const handlePointerCancel = useCallback(() => {
    pointerIdRef.current = null;
    startRef.current = null;
  }, []);

  return (
    <div
      className="reader__tap-zones"
      aria-hidden="true"
      data-enabled={enabled ? "true" : "false"}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 4,
        // Transparent hit layer; disabled when sheets open.
        pointerEvents: enabled ? "auto" : "none",
        // Allow vertical scroll gestures to pass through on scroll mode —
        // we only act on pointerup taps, never preventDefault on touchmove.
        touchAction: mode === "scroll" ? "pan-y" : "manipulation",
        background: "transparent",
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    />
  );
}

export default ReaderTapZones;
