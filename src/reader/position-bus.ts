/**
 * Single jump-command helpers for dual-surface reader (READER-POS / D-64).
 *
 * Do NOT invent a second progress store. Persist via locator-store only.
 * Apply via view.goTo (paginate) or ContinuousScrollApi.jumpTo (scroll).
 *
 * Progress *reporting* must never mutate jump targets (parent SSOT owns them).
 */

import {
  isRealCfi,
  parseScrollPosition,
  positionFromLocatorCfi,
  positionToLocatorCfi,
  type ReadingPosition,
} from "./reading-position";

export type ReaderSurface = "paginate" | "scroll";

export interface JumpPlan {
  surface: ReaderSurface;
  /** For scroll surface. */
  spineIndex: number;
  offsetFraction: number;
  /** Prefer real CFI for paginate goTo when present. */
  goToTarget: string;
}

/** Build a jump plan from SSOT position. Never uses whole-book % alone. */
export function planJump(
  pos: ReadingPosition,
  surface: ReaderSurface,
): JumpPlan {
  const goToTarget = positionToLocatorCfi(pos);
  return {
    surface,
    spineIndex: Math.max(0, Math.floor(pos.spineIndex)),
    offsetFraction: pos.offsetFraction,
    goToTarget,
  };
}

/** Capture position from mixed relocate + optional scroll snapshot. */
export function capturePosition(input: {
  cfi?: string | null;
  spineIndex?: number | null;
  offsetFraction?: number | null;
  fraction?: number | null;
}): ReadingPosition | null {
  const scroll = parseScrollPosition(input.cfi ?? null);
  if (scroll) {
    return {
      spineIndex: scroll.spineIndex,
      offsetFraction: scroll.offsetFraction,
      cfi: null,
      fraction: input.fraction ?? null,
    };
  }
  if (typeof input.spineIndex === "number" && Number.isFinite(input.spineIndex)) {
    return {
      spineIndex: input.spineIndex,
      offsetFraction: input.offsetFraction ?? 0,
      cfi: isRealCfi(input.cfi) ? input.cfi : null,
      fraction: input.fraction ?? null,
    };
  }
  return positionFromLocatorCfi(input.cfi, input.fraction, input.spineIndex);
}

/**
 * Resolve TOC href using optional resolvers (foliate view.resolveNavigation / goTo result).
 * Returns spine index or null.
 */
export function spineFromResolvedNav(
  resolved: { index?: number } | null | undefined,
): number | null {
  if (resolved && typeof resolved.index === "number" && Number.isFinite(resolved.index)) {
    return Math.max(0, Math.floor(resolved.index));
  }
  return null;
}

export function positionForTocSpine(spineIndex: number): ReadingPosition {
  return {
    spineIndex,
    offsetFraction: 0,
    cfi: null,
    fraction: null,
  };
}
