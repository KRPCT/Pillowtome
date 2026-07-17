/**
 * Mode-agnostic reading position (SSOT helpers).
 *
 * Primary resume key for continuous scroll:
 *   pillow-scroll:{spineIndex}:{offsetFraction}
 * Optional precision:
 *   real epubcfi(...)
 *
 * Progress bar may use whole-book fraction, but never as the sole resume key.
 */

export const SCROLL_POS_PREFIX = "pillow-scroll:";

export interface ReadingPosition {
  /** Spine index in book.sections (same as foliate section.current). */
  spineIndex: number;
  /** Top-edge offset within the section, 0..1. */
  offsetFraction: number;
  /** Real epubcfi(...) when available. */
  cfi?: string | null;
  /** Whole-book fraction for UI only. */
  fraction?: number | null;
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function encodeScrollPosition(
  spineIndex: number,
  offsetFraction: number,
): string {
  const spine = Math.max(0, Math.floor(spineIndex));
  const offset = clamp01(offsetFraction);
  return `${SCROLL_POS_PREFIX}${spine}:${offset.toFixed(4)}`;
}

export function parseScrollPosition(
  token: string | null | undefined,
): { spineIndex: number; offsetFraction: number } | null {
  if (!token || !token.startsWith(SCROLL_POS_PREFIX)) return null;
  const rest = token.slice(SCROLL_POS_PREFIX.length);
  const [a, b] = rest.split(":");
  const spineIndex = Number(a);
  const offsetFraction = Number(b);
  if (!Number.isFinite(spineIndex) || !Number.isFinite(offsetFraction)) {
    return null;
  }
  return {
    spineIndex: Math.max(0, Math.floor(spineIndex)),
    offsetFraction: clamp01(offsetFraction),
  };
}

export function isRealCfi(token: string | null | undefined): boolean {
  return typeof token === "string" && token.startsWith("epubcfi(");
}

/**
 * Prefer real CFI when present; otherwise encode reliable spine+offset token.
 */
export function positionToLocatorCfi(pos: ReadingPosition): string {
  if (isRealCfi(pos.cfi ?? null)) return pos.cfi as string;
  return encodeScrollPosition(pos.spineIndex, pos.offsetFraction);
}

/**
 * Extract a ReadingPosition from a saved locator cfi string + optional fraction.
 * Handles both real CFI and pillow-scroll tokens.
 */
export function positionFromLocatorCfi(
  cfi: string | null | undefined,
  fraction?: number | null,
  spineFallback?: number | null,
): ReadingPosition | null {
  if (!cfi) {
    if (spineFallback == null) return null;
    return {
      spineIndex: spineFallback,
      offsetFraction: 0,
      fraction: fraction ?? null,
    };
  }
  const scroll = parseScrollPosition(cfi);
  if (scroll) {
    return {
      spineIndex: scroll.spineIndex,
      offsetFraction: scroll.offsetFraction,
      cfi: null,
      fraction: fraction ?? null,
    };
  }
  if (isRealCfi(cfi)) {
    return {
      spineIndex: spineFallback ?? 0,
      offsetFraction: 0,
      cfi,
      fraction: fraction ?? null,
    };
  }
  if (spineFallback != null) {
    return {
      spineIndex: spineFallback,
      offsetFraction: 0,
      fraction: fraction ?? null,
    };
  }
  return null;
}

/**
 * Map spine index → linear list index (skip linear="no").
 * Returns -1 when not found.
 */
export function spineToLinearIndex(
  spineIndex: number,
  sections: Array<{ index: number; linear?: string }>,
): number {
  const linear = sections.filter((s) => s.linear !== "no");
  return linear.findIndex((s) => s.index === spineIndex);
}

/**
 * Coarse whole-book fraction from linear position + in-section offset.
 */
export function wholeBookFraction(
  spineIndex: number,
  offsetFraction: number,
  sections: Array<{ index: number; linear?: string }>,
): number {
  const linear = sections.filter((s) => s.linear !== "no");
  const n = linear.length || 1;
  const li = linear.findIndex((s) => s.index === spineIndex);
  const pos = li >= 0 ? li : Math.max(0, Math.min(n - 1, spineIndex));
  return Math.min(1, (pos + clamp01(offsetFraction)) / n);
}
