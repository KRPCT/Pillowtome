/**
 * Pure sliding-window math for ContinuousScrollStream (READ-01 scrolled).
 *
 * The continuous scroller keeps a CONTIGUOUS band of linear section indices
 * loaded. Left unbounded it only ever grows — scrolling through or TOC-jumping
 * around a long book eventually loads every section (one live iframe/doc each),
 * which is what froze the reader after repeated jumps. These helpers keep the
 * band contiguous AND capped, so memory/DOM stay bounded no matter the pattern.
 *
 * No React / DOM — unit- and stress-testable off-device.
 */

/** Hard cap on simultaneously-loaded sections (a few screens each way). */
export const MAX_LOADED = 7;
/** Sections to (re)seed around a jump target: [t-1 .. t+2]. */
export const SEED_BEHIND = 1;
export const SEED_AHEAD = 2;

const clampIdx = (i: number, len: number) => Math.max(0, Math.min(i, Math.max(0, len - 1)));

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

/** True if `a` is already the same contiguous window as `b` (cheap identity guard). */
export function sameWindow(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Contiguous seed band around a jump target. When the target is within one
 * section of the current band it EXTENDS it (avoids reload flicker); a far jump
 * drops the old band entirely and returns a fresh one at the target.
 */
export function seedWindow(prev: number[], target: number, len: number): number[] {
  const t = clampIdx(target, len);
  const from = Math.max(0, t - SEED_BEHIND);
  const to = Math.min(len - 1, t + SEED_AHEAD);
  if (!prev.length) return range(from, to);
  const min = prev[0];
  const max = prev[prev.length - 1];
  const contiguous = t >= min - 1 && t <= max + 1;
  if (!contiguous) return range(from, to);
  const s = new Set(prev);
  for (let i = from; i <= to; i++) s.add(i);
  return [...s].sort((a, b) => a - b);
}

/** Extend a contiguous band toward whichever edge the viewport approached. */
export function extendWindow(
  prev: number[],
  opts: { nearTop: boolean; nearBottom: boolean },
  len: number,
): number[] {
  if (!prev.length) return prev;
  const s = new Set(prev);
  const max = prev[prev.length - 1];
  const min = prev[0];
  if (opts.nearBottom && max < len - 1) {
    s.add(max + 1);
    if (max + 2 < len) s.add(max + 2);
  }
  if (opts.nearTop && min > 0) s.add(min - 1);
  return [...s].sort((a, b) => a - b);
}

export interface CappedWindow {
  window: number[];
  /** Sections dropped from ABOVE the anchor (caller compensates scrollTop by their heights). */
  removedTop: number[];
  /** Sections dropped from BELOW the anchor (no scroll compensation needed). */
  removedBottom: number[];
}

/**
 * Trim a contiguous band to `cap`, evicting from whichever end is farther from
 * `anchor` (the section at the viewport top) so the reader keeps buffer on both
 * sides. `anchor` always stays inside the result. Sections removed from the top
 * are above the viewport, so the caller must subtract their rendered heights
 * from scrollTop to keep the view visually stable.
 */
export function capWindow(prev: number[], anchor: number, cap = MAX_LOADED): CappedWindow {
  if (prev.length <= cap) return { window: prev, removedTop: [], removedBottom: [] };
  const win = [...prev];
  const removedTop: number[] = [];
  const removedBottom: number[] = [];
  while (win.length > cap) {
    const first = win[0];
    const last = win[win.length - 1];
    // Keep the anchor centered-ish: drop the end farther from it. Never drop the
    // anchor itself — if it sits at an edge, drop from the opposite end.
    const dropTop =
      first !== anchor && (anchor - first >= last - anchor || last === anchor);
    if (dropTop) {
      removedTop.push(win.shift() as number);
    } else {
      removedBottom.push(win.pop() as number);
    }
  }
  return { window: win, removedTop, removedBottom };
}
