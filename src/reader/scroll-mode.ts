/**
 * Scroll-mode helpers (READ-01 scrolled + READ-04 chrome).
 * Pure logic for section-edge detection — unit-testable.
 */

/** Pixels from section end/start that count as "at edge". */
export const SCROLL_EDGE_PX = 8;

/**
 * Whether the scrolled paginator is at (or past) the bottom of the current section.
 * Mirrors foliate `#scrollNext` scrolled branch: `viewSize - end <= 2`.
 *
 * `requireScrolled` (default true): ignore the edge if `start` is still ~0 so
 * short chapters that fully fit the viewport are not auto-skipped on open.
 */
export function isScrolledAtSectionEnd(
  start: number,
  end: number,
  viewSize: number,
  edgePx: number = SCROLL_EDGE_PX,
  requireScrolled: boolean = true,
): boolean {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(viewSize)) {
    return false;
  }
  if (viewSize <= 0) return false;
  if (requireScrolled && start <= edgePx) return false;
  return viewSize - end <= edgePx;
}

/**
 * Short section fully visible (cannot scroll within section).
 * Used for tap zones: bottom/top third can still chain chapters.
 */
export function isShortScrolledSection(
  start: number,
  end: number,
  viewSize: number,
  edgePx: number = SCROLL_EDGE_PX,
): boolean {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(viewSize)) {
    return false;
  }
  return start <= edgePx && viewSize - end <= edgePx;
}

/**
 * Whether the scrolled paginator is at the top of the current section.
 */
export function isScrolledAtSectionStart(
  start: number,
  edgePx: number = SCROLL_EDGE_PX,
): boolean {
  if (!Number.isFinite(start)) return false;
  return start <= edgePx;
}

/**
 * Tap vs pan: true when movement is small enough to count as a tap.
 */
export function isTapGesture(
  dx: number,
  dy: number,
  slopPx: number = 12,
): boolean {
  return Math.abs(dx) <= slopPx && Math.abs(dy) <= slopPx;
}
