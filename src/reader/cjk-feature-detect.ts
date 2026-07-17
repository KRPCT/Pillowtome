/**
 * Runtime CSS capability probes for CJK features (DEC-002 / D-35).
 * Pure: inject cssSupports for unit tests. Session-cache at call site.
 * Never infer support from OS / API level (D-12).
 */

export interface CjkCssCaps {
  textSpacingTrim: boolean;
  textAutospace: boolean;
  lineBreakStrict: boolean;
}

function defaultCssSupports(query: string): boolean {
  return typeof CSS !== "undefined" && typeof CSS.supports === "function"
    ? CSS.supports(query)
    : false;
}

/**
 * Probe engine support for CJK CSS properties.
 * Default uses global CSS.supports; tests inject a mock.
 */
export function detectCjkCssCaps(
  cssSupports: (query: string) => boolean = defaultCssSupports,
): CjkCssCaps {
  return {
    textSpacingTrim: cssSupports("text-spacing-trim: normal"),
    textAutospace: cssSupports("text-autospace: normal"),
    lineBreakStrict: cssSupports("line-break: strict"),
  };
}
