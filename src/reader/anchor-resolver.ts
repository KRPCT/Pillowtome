/**
 * Composite self-healing anchor resolver (D-77) — ONE implementation shared by
 * reading-position restore and annotation restore.
 *
 * Fallback chain (silent stepwise degradation, never a bare percentage jump / D-78):
 *   1. CFI tier      — the stored CFI resolves to a live Range → { range }.
 *   2. text_context  — CFI broke; find text_exact (disambiguated by pre/post),
 *                      normalized to Simplified so a 简繁 toggle can't lose it
 *                      (Challenge E) → { range, healed:true } (caller writes a fresh CFI).
 *   3. fraction      — both failed; hand the caller a progress fraction to land on
 *                      the nearest paragraph boundary → { fractionTarget }.
 *   4. nothing       → null (caller soft-lands at chapter start; no "找不到" surfaced).
 *
 * CFI parsing and 简繁 conversion are NOT re-implemented here — they are imported
 * from ./scroll-cfi (cfiToRange) and ./cjk-convert-shim (convertText).
 */

import { cfiToRange } from "./scroll-cfi";
import { convertText } from "./cjk-convert-shim";
import { isRealCfi } from "./reading-position";

// NodeFilter.SHOW_TEXT — inlined so this module stays importable in a non-DOM
// (node) test env, same rationale as scroll-cfi.ts.
const SHOW_TEXT = 0x4;

export interface Anchor {
  cfi?: string | null;
  text_pre?: string | null;
  text_exact?: string | null;
  text_post?: string | null;
  progress_fraction?: number | null;
}

export type AnchorResult =
  | { range: Range }
  | { range: Range; healed: true }
  | { fractionTarget: number }
  | null;

const collapse = (s: string | null | undefined): string =>
  (s ?? "").replace(/\s+/g, " ").trim();

/** A live Range must have at least one non-empty client rect to count as resolved. */
function hasRects(range: Range): boolean {
  const rects = range.getClientRects?.();
  return !!rects && rects.length > 0;
}

interface CharMap {
  /** Whitespace-collapsed text of the whole doc (pre-normalization). */
  raw: string;
  /** Per output char: the source text node and offset within it. */
  node: Node[];
  offset: number[];
}

/** Walk the doc's text nodes into a whitespace-collapsed string + offset map. */
function collectChars(doc: Document): CharMap {
  const walker = doc.createTreeWalker(doc.body, SHOW_TEXT);
  const node: Node[] = [];
  const offset: number[] = [];
  let raw = "";
  let prevSpace = false;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const v = n.nodeValue ?? "";
    for (let i = 0; i < v.length; i++) {
      const ws = /\s/.test(v[i]);
      if (ws && prevSpace) continue;
      raw += ws ? " " : v[i];
      node.push(n);
      offset.push(i);
      prevSpace = ws;
    }
  }
  return { raw, node, offset };
}

/** Score how much of `pre` matches as a suffix ending at `at`, plus `post` as a prefix after `end`. */
function contextScore(hay: string, pre: string, post: string, at: number, end: number): number {
  let score = 0;
  for (let k = 1; k <= pre.length && at - k >= 0; k++) {
    if (hay[at - k] === pre[pre.length - k]) score++;
    else break;
  }
  for (let k = 0; k < post.length && end + k < hay.length; k++) {
    if (hay[end + k] === post[k]) score++;
    else break;
  }
  return score;
}

/** Locate a needle in the normalized haystack; returns [start, end) char span or null. */
function locate(
  hay: string,
  needle: string,
  pre: string,
  post: string,
): [number, number] | null {
  if (needle) {
    const hits: number[] = [];
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) hits.push(i);
    if (hits.length === 1) return [hits[0], hits[0] + needle.length];
    if (hits.length > 1) {
      let best = hits[0];
      let bestScore = -1;
      for (const h of hits) {
        const s = contextScore(hay, pre, post, h, h + needle.length);
        if (s > bestScore) {
          bestScore = s;
          best = h;
        }
      }
      return [best, best + needle.length];
    }
    // Degraded window: last-ditch partial match on pre.slice(-8)+needle.slice(0,8).
    const probe = pre.slice(-8) + needle.slice(0, 8);
    if (probe) {
      const pi = hay.indexOf(probe);
      if (pi >= 0) {
        const start = pi + pre.slice(-8).length;
        return [start, start + needle.slice(0, 8).length];
      }
    }
    return null;
  }
  // Zero-length exact (e.g. a reading-position anchor): locate by the pre+post seam.
  if (pre || post) {
    const seam = pre + post;
    const si = hay.indexOf(seam);
    if (si >= 0) {
      const at = si + pre.length;
      return [at, at];
    }
  }
  return null;
}

/** Build a DOM Range from a [start, end) span in the collected char map. */
function spanToRange(doc: Document, map: CharMap, start: number, end: number): Range | null {
  const len = map.raw.length;
  if (start < 0 || start > len) return null;
  const range = doc.createRange();
  const startNode = start < len ? map.node[start] : map.node[len - 1];
  const startOff = start < len ? map.offset[start] : map.offset[len - 1] + 1;
  range.setStart(startNode, startOff);
  if (end === start) {
    range.setEnd(startNode, startOff);
  } else {
    const endNode = end < len ? map.node[end] : map.node[len - 1];
    const endOff = end < len ? map.offset[end] : map.offset[len - 1] + 1;
    range.setEnd(endNode, endOff);
  }
  return range;
}

export function resolveAnchor(doc: Document, anchor: Anchor): AnchorResult {
  if (!doc) return null;

  // Tier 1 — CFI.
  if (isRealCfi(anchor.cfi)) {
    try {
      const range = cfiToRange(doc, anchor.cfi as string);
      if (range && hasRects(range)) return { range };
    } catch {
      /* fall through to text search */
    }
  }

  // Tier 2 — text_context (normalize to Simplified so 简繁 toggles can't lose it).
  try {
    const map = collectChars(doc);
    // t2s the whole haystack; keep it only if length is preserved so the
    // char→DOM-offset map still aligns (opencc char-form t2s is length-preserving).
    let hay = convertText(map.raw, "t2s");
    let normalized = hay.length === map.raw.length;
    if (!normalized) hay = map.raw;
    const norm = (s: string) => (normalized ? convertText(collapse(s), "t2s") : collapse(s));
    const needle = norm(anchor.text_exact ?? "");
    const pre = norm(anchor.text_pre ?? "");
    const post = norm(anchor.text_post ?? "");
    if (needle || pre || post) {
      const span = locate(hay, needle, pre, post);
      if (span) {
        const range = spanToRange(doc, map, span[0], span[1]);
        if (range) return { range, healed: true };
      }
    }
  } catch {
    /* fall through to fraction */
  }

  // Tier 3 — fraction (caller lands it on the nearest paragraph boundary; never scrolls here).
  if (anchor.progress_fraction != null && Number.isFinite(anchor.progress_fraction)) {
    return { fractionTarget: anchor.progress_fraction };
  }

  return null;
}
