/**
 * Immersive tap-zone resolution (READ-04, UI-SPEC 33/34/33).
 * Pure helpers — no React / DOM.
 */

import type { ReadingMode } from "./apply-reading-styles";

export type TapZone = "left" | "center" | "right";

/**
 * Resolve horizontal tap into left 33% / center 34% / right 33% zones.
 * Boundaries: left [0, 0.33), center [0.33, 0.67), right [0.67, 1].
 */
export function resolveTapZone(clientX: number, width: number): TapZone {
  if (width <= 0) return "center";
  const ratio = clientX / width;
  if (ratio < 0.33) return "left";
  if (ratio < 0.67) return "center";
  return "right";
}

/**
 * Map zone + mode to action.
 * - paginate: left→prev, right→next, center→toggle-chrome
 * - scroll: any zone → toggle-chrome (native scroll is primary nav)
 */
export function tapZoneAction(
  zone: TapZone,
  mode: ReadingMode,
): "prev" | "next" | "toggle-chrome" {
  if (mode === "scroll") return "toggle-chrome";
  if (zone === "left") return "prev";
  if (zone === "right") return "next";
  return "toggle-chrome";
}
