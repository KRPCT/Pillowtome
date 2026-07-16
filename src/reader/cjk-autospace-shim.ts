/**
 * Reversible 盘古之白 (CJK autospace) shim (D-36 / D-37).
 *
 * Priority (caller gates native CSS first via shouldInstallAutospaceShim):
 * 1. CSS Custom Highlight API — Range only, no DOM mutation
 * 2. Reversible wrapper spans with padding-inline — no space characters
 * 3. Silent no-op disposer (D-38)
 *
 * HARD BANS:
 * - Never insert U+0020 / U+2009 into book text
 * - Never leave permanent DOM mutations after disposer
 * - Concatenated body textContent must equal pre-install snapshot
 */

import type { CjkCssCaps } from "./cjk-feature-detect";
import type { ReadingPrefs } from "./apply-reading-styles";

/** CJK Unified Ideographs (core) adjacent to ASCII letter/digit. */
const BOUNDARY_RE =
  /([\u3400-\u9FFF\uF900-\uFAFF])([A-Za-z0-9])|([A-Za-z0-9])([\u3400-\u9FFF\uF900-\uFAFF])/g;

const HIGHLIGHT_NAME = "pillow-autospace";
const SHIM_ATTR = "data-pillow-shim";
const SHIM_VALUE = "autospace";

export function shouldInstallAutospaceShim(
  prefs: Pick<ReadingPrefs, "cjkAutospace">,
  caps: Pick<CjkCssCaps, "textAutospace">,
): boolean {
  return Boolean(prefs.cjkAutospace && !caps.textAutospace);
}

type CssWithHighlights = typeof CSS & {
  highlights?: {
    set: (name: string, highlight: unknown) => void;
    delete: (name: string) => void;
  };
};

type HighlightCtor = new (...ranges: Range[]) => { add?: (r: Range) => void };

const SHOW_TEXT = 4; // NodeFilter.SHOW_TEXT

function collectTextNodes(root: Node): Text[] {
  const out: Text[] = [];
  const doc = root.ownerDocument ?? (root as Document);
  if (typeof doc.createTreeWalker !== "function") return out;

  const filter =
    typeof NodeFilter !== "undefined" ? NodeFilter.SHOW_TEXT : SHOW_TEXT;
  const walker = doc.createTreeWalker(root, filter);
  let n = walker.nextNode();
  while (n) {
    if (n.nodeType === 3 /* TEXT_NODE */) {
      const parent = (n as Text).parentElement;
      const tag = parent?.tagName?.toLowerCase();
      if (tag !== "script" && tag !== "style") {
        out.push(n as Text);
      }
    }
    n = walker.nextNode();
  }
  return out;
}

function boundaryRanges(doc: Document, root: Node): Range[] {
  const ranges: Range[] = [];
  for (const text of collectTextNodes(root)) {
    const value = text.data;
    if (!value) continue;
    BOUNDARY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BOUNDARY_RE.exec(value))) {
      // Boundary sits between the two captured chars.
      const between = m.index + 1;
      try {
        const range = doc.createRange();
        range.setStart(text, between);
        range.setEnd(text, between);
        ranges.push(range);
      } catch {
        /* skip invalid range */
      }
    }
  }
  return ranges;
}

function tryCustomHighlight(doc: Document): (() => void) | null {
  const win = doc.defaultView;
  const CSSRef = (win?.CSS ?? (typeof CSS !== "undefined" ? CSS : undefined)) as
    | CssWithHighlights
    | undefined;
  const HighlightRef = (win as unknown as { Highlight?: HighlightCtor } | undefined)
    ?.Highlight;
  if (!CSSRef?.highlights || typeof HighlightRef !== "function") {
    return null;
  }

  const root = doc.body ?? doc.documentElement;
  if (!root) return null;

  const ranges = boundaryRanges(doc, root);
  if (!ranges.length) {
    return () => {
      try {
        CSSRef.highlights?.delete(HIGHLIGHT_NAME);
      } catch {
        /* ignore */
      }
    };
  }

  try {
    const highlight = new HighlightRef(...ranges);
    CSSRef.highlights.set(HIGHLIGHT_NAME, highlight);
  } catch {
    return null;
  }

  // Visual rule for highlight (no text mutation).
  let style = doc.getElementById("pillow-autospace-hl") as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = "pillow-autospace-hl";
    style.textContent = `::highlight(${HIGHLIGHT_NAME}) { /* marker only */ }`;
    // Padding via adjacent pseudo is unavailable on highlight; use zero-width
    // visual via letter-spacing on a tiny range is unreliable — span path is better.
    // Keep style for API completeness; highlight still marks boundaries.
    (doc.head ?? doc.documentElement).appendChild(style);
  }

  return () => {
    try {
      CSSRef.highlights?.delete(HIGHLIGHT_NAME);
    } catch {
      /* ignore */
    }
    style?.remove();
  };
}

function wrapBoundaryInSpan(text: Text, offset: number, doc: Document): void {
  if (offset <= 0 || offset >= text.data.length) return;
  const second = text.splitText(offset);
  const span = doc.createElement("span");
  span.setAttribute(SHIM_ATTR, SHIM_VALUE);
  span.style.paddingInline = "0.125em";
  // Zero-width content placeholder so the span occupies spacing without chars.
  // We insert the span BETWEEN the two halves — empty span with padding.
  text.parentNode?.insertBefore(span, second);
}

function tryReversibleSpans(doc: Document): (() => void) | null {
  const root = doc.body;
  if (!root) return null;

  // Collect matches first (offsets change as we split).
  type Match = { node: Text; offset: number };
  const matches: Match[] = [];
  for (const text of collectTextNodes(root)) {
    const value = text.data;
    if (!value) continue;
    BOUNDARY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BOUNDARY_RE.exec(value))) {
      matches.push({ node: text, offset: m.index + 1 });
    }
  }
  if (!matches.length) {
    return () => undefined;
  }

  // Apply from end so earlier offsets stay valid within the same node.
  matches.sort((a, b) => {
    if (a.node !== b.node) return 0;
    return b.offset - a.offset;
  });

  for (const { node, offset } of matches) {
    // Node may have been split; only apply if offset still in this node data.
    if (offset > 0 && offset < node.data.length) {
      wrapBoundaryInSpan(node, offset, doc);
    }
  }

  return () => {
    const spans = root.querySelectorAll(`span[${SHIM_ATTR}="${SHIM_VALUE}"]`);
    spans.forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      parent.removeChild(span);
      parent.normalize();
    });
  };
}

/**
 * Install autospace visual spacing for CJK↔Latin/digit boundaries.
 * Returns a disposer that restores the document.
 */
export function installAutospaceShim(doc: Document): () => void {
  let disposed = false;

  const highlightDispose = tryCustomHighlight(doc);
  if (highlightDispose) {
    // Highlight marks only — also try spans for visible padding when highlight
    // cannot add spacing. Prefer highlight alone if spans would mutate heavily.
    // For measurable spacing without chars, fall through to spans when highlight
    // cannot paint padding. Use spans as primary visual path when Highlight exists
    // but is paint-only; still keep highlight dispose for cleanup.
    // Simpler policy: if Highlight API works, still use reversible spans for
    // actual gap (Highlight alone does not create spacing). Dispose both.
  }

  const spanDispose = tryReversibleSpans(doc);

  return () => {
    if (disposed) return;
    disposed = true;
    try {
      spanDispose?.();
    } catch {
      /* ignore */
    }
    try {
      highlightDispose?.();
    } catch {
      /* ignore */
    }
  };
}
