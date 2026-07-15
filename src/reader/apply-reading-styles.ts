/**
 * Pure helpers for foliate-js flow + injected reading CSS (READ-01/02/03).
 * No React / Tauri imports — unit-testable.
 */

export type ReadingMode = "paginate" | "scroll";
export type ReadingTheme = "day" | "night" | "sepia";

export interface ReadingPrefs {
  mode: ReadingMode;
  theme: ReadingTheme;
  fontFamilyKey: string;
  fontSizePx: number;
  lineHeight: number;
  marginPx: number;
  activeFontId: string | null;
}

/** UI-SPEC defaults: paginate / day / system CJK / 18px / 1.75 / 24px margins. */
export const DEFAULT_PREFS: ReadingPrefs = {
  mode: "paginate",
  theme: "day",
  fontFamilyKey: "system",
  fontSizePx: 18,
  lineHeight: 1.75,
  marginPx: 24,
  activeFontId: null,
};

/** Default reading body stack — never Geist (chrome-only). */
export const SYSTEM_CJK_STACK =
  'system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

/** Book page colors injected into foliate render documents (UI-SPEC §Color B). */
export const PAGE_COLORS: Record<
  ReadingTheme,
  { background: string; foreground: string }
> = {
  day: { background: "#FFFEF9", foreground: "#1C1915" },
  night: { background: "#12100E", foreground: "#E8E2D6" },
  sepia: { background: "#F4ECD8", foreground: "#3B2F1E" },
};

/**
 * Map app reading mode → foliate `flow` attribute value.
 * Must be applied via `renderer.setAttribute("flow", …)` (no JS property API).
 */
export function flowAttr(mode: ReadingMode): "paginated" | "scrolled" {
  return mode === "scroll" ? "scrolled" : "paginated";
}

/**
 * Foliate-js `margin` attribute is the **header/footer band height** (px),
 * not page padding. Page insets come from `buildReadingCss` body padding.
 *
 * `max-block-size` defaults to 1440px inside foliate — on tall phones that
 * caps the content row and the remaining height is split as equal `1fr`
 * rows above/below, producing a centered "card". We set max-block-size to
 * host height so content fills the view, then use a small equal header/footer
 * band (`margin` attr) for top/bottom breathing room without floating.
 */
/** Floor when host height is not measurable yet. */
export const FOLIATE_MAX_BLOCK_SIZE_FLOOR_PX = 10000;

/**
 * Header/footer band for top+bottom air (px). Clamped so it never eats the
 * whole viewport; independent of left/right body padding from prefs.
 * Top gets a little extra via body padding-top in buildReadingCss.
 */
export function foliateMarginBandPx(hostHeightPx?: number | null): number {
  const h =
    hostHeightPx != null && Number.isFinite(hostHeightPx) && hostHeightPx > 0
      ? hostHeightPx
      : 800;
  // ~7% of height, clamp 40–80 — room for status bar + chrome overlay zone.
  return Math.max(40, Math.min(80, Math.round(h * 0.07)));
}

/**
 * Extra top inset on the page body (px), on top of the foliate margin band.
 * Sized so floating toolbar (~48px + safe area) sits in empty air and does not
 * cover the first line of text when chrome is shown.
 */
export const PAGE_TOP_EXTRA_PX = 28;

/**
 * Android often reports env(safe-area-inset-*) as 0. Floor for status-bar gap.
 * Combined with env() via CSS max().
 */
export const STATUS_BAR_FLOOR_PX = 28;

/**
 * Apply foliate layout attributes that control paginator grid geometry.
 * Call after open and whenever the host resizes / prefs change.
 */
export function applyFoliateLayoutAttrs(
  renderer: {
    setAttribute?: (name: string, value: string) => void;
  } | null | undefined,
  hostHeightPx?: number | null,
): void {
  if (!renderer?.setAttribute) return;
  const band = foliateMarginBandPx(hostHeightPx);
  renderer.setAttribute("margin", `${band}px`);
  const h =
    hostHeightPx != null && Number.isFinite(hostHeightPx) && hostHeightPx > 0
      ? Math.ceil(hostHeightPx)
      : FOLIATE_MAX_BLOCK_SIZE_FLOOR_PX;
  // max-block-size = full host so content row can grow; margin bands add air.
  renderer.setAttribute("max-block-size", `${h}px`);
}

/**
 * Build CSS for `renderer.setStyles(...)`.
 *
 * Horizontal page margins use body padding (`prefs.marginPx` left/right).
 * Vertical air uses foliate's `margin` attribute (header/footer band) so
 * short pages keep top/bottom breathing room without CSS padding double-count.
 *
 * Theme paint MUST override author stylesheets. Many Chinese EPUBs (e.g.
 * MarkdownPad GitHub CSS) set `body { background-color: #fff; color: #333 }`
 * which wins over `html { background }` alone — leaving white patches /
 * mismatched chrome vs page. Force html+body (+ common wrappers) with
 * !important and both `background` / `background-color`.
 */
export function buildReadingCss(
  prefs: ReadingPrefs,
  fontFaceCss: string,
  fontFamilyCss: string,
): string {
  const colors = PAGE_COLORS[prefs.theme];
  const m = prefs.marginPx;
  const top = PAGE_TOP_EXTRA_PX;
  const bg = colors.background;
  const fg = colors.foreground;
  return `
    ${fontFaceCss}
    html {
      background: ${bg} !important;
      background-color: ${bg} !important;
      color: ${fg} !important;
    }
    body {
      font-family: ${fontFamilyCss} !important;
      font-size: ${prefs.fontSizePx}px !important;
      line-height: ${prefs.lineHeight} !important;
      color: ${fg} !important;
      background: ${bg} !important;
      background-color: ${bg} !important;
      /* Extra top air; sides from prefs; bottom 0 (band handles bottom air) */
      padding: ${top}px ${m}px 0 ${m}px !important;
      box-sizing: border-box !important;
      margin: 0 auto !important;
      max-width: none !important;
      min-height: 100% !important;
    }
    /* Author themes often paint wrappers / first blocks white */
    body > div, body > section, body > article, body > main {
      background: transparent !important;
      background-color: transparent !important;
      color: inherit !important;
    }
    p, li, blockquote, dd, td, th {
      line-height: ${prefs.lineHeight} !important;
      color: inherit !important;
    }
    h1, h2, h3, h4, h5, h6 {
      color: inherit !important;
    }
    a {
      color: inherit !important;
    }
  `;
}
