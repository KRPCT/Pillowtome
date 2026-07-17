/**
 * Per-iframe CSS Custom Highlight registry helpers for scroll-mode annotation
 * drawing (RESEARCH Priority Item A).
 *
 * Scroll mode stacks one iframe per spine section, and `CSS.highlights` is a
 * PER-WINDOW registry — so highlights must be registered on each section's
 * `iframe.contentWindow` and the `::highlight()` rules injected into each
 * section's `pillow-reading-css` block. A live `Range` in the registry is
 * redrawn by the browser at layout time, so there is zero manual per-reflow
 * redraw and no overlay element (touch/scroll gate safe, D-74).
 *
 * Registry names come ONLY from a fixed color allowlist (T-05-07): a name built
 * from arbitrary annotation input would be a `::highlight()` / registry
 * injection sink, so unknown colors are refused.
 *
 * Paginate mode does NOT use this module — its iframe is in a closed shadow root
 * reachable only through foliate's `draw-annotation` / `Overlayer`.
 */

export type HighlightType = "highlight" | "underline";
export type PaletteColor = "cinnabar" | "ochre" | "green" | "indigo";

/** Fixed 4-color palette (UI-SPEC D-70). The ::highlight() name allowlist. */
export const PALETTE: readonly PaletteColor[] = ["cinnabar", "ochre", "green", "indigo"];

interface HighlightLike {
  add(range: Range): void;
}
type HighlightCtor = new (...ranges: Range[]) => HighlightLike;
interface HighlightRegistry {
  set(name: string, hl: HighlightLike): void;
  get(name: string): HighlightLike | undefined;
  has(name: string): boolean;
  delete(name: string): boolean;
  keys(): Iterable<string>;
}
/** The subset of a section iframe's `contentWindow` this module touches. */
export interface HighlightWindow {
  Highlight?: HighlightCtor;
  CSS?: { highlights?: HighlightRegistry };
}

/** True only when the window exposes both the Highlight ctor and the registry. */
export function supportsCssHighlight(win: HighlightWindow | null | undefined): boolean {
  return !!win && typeof win.Highlight === "function" && !!win.CSS?.highlights;
}

/**
 * Stable registry name for a (type, color) pair, e.g. `pillow-hl-cinnabar` /
 * `pillow-ul-indigo`. Returns null for an unknown type or a color outside the
 * allowlist — the name is NEVER built from arbitrary input (T-05-07).
 */
export function highlightCssName(type: HighlightType, color: string): string | null {
  if (type !== "highlight" && type !== "underline") return null;
  if (!PALETTE.includes(color as PaletteColor)) return null;
  const prefix = type === "highlight" ? "pillow-hl" : "pillow-ul";
  return `${prefix}-${color}`;
}

/**
 * Register `range` under the named Highlight in this window's registry, creating
 * the Highlight on first use and reusing it after. Returns false (caller falls
 * back to a foliate Overlayer) when the API is unsupported, the color is not
 * allowlisted, or the range is missing.
 */
export function registerHighlight(
  win: HighlightWindow | null | undefined,
  type: HighlightType,
  color: string,
  range: Range | null | undefined,
): boolean {
  if (!supportsCssHighlight(win)) return false;
  const name = highlightCssName(type, color);
  if (!name || !range) return false;
  const reg = win!.CSS!.highlights!;
  let hl = reg.get(name);
  if (!hl) {
    hl = new win!.Highlight!();
    reg.set(name, hl);
  }
  hl.add(range);
  return true;
}

/** Remove this window's pillow-hl-/pillow-ul- entries before a clean redraw. */
export function clearHighlights(win: HighlightWindow | null | undefined): void {
  const reg = win?.CSS?.highlights;
  if (!reg) return;
  for (const name of Array.from(reg.keys())) {
    if (name.startsWith("pillow-hl-") || name.startsWith("pillow-ul-")) reg.delete(name);
  }
}

/**
 * `::highlight()` rules for all four palette keys, injected into each section's
 * `pillow-reading-css`. The `--anno-*` / `--anno-*-fill` vars are declared per
 * theme in index.css by plan 05-04; this module only references them.
 */
export const HIGHLIGHT_CSS: string = PALETTE.map(
  (c) =>
    `::highlight(pillow-hl-${c}){background-color:var(--anno-${c}-fill);}\n` +
    `::highlight(pillow-ul-${c}){text-decoration:underline;text-decoration-color:var(--anno-${c});}`,
).join("\n");
