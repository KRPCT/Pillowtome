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
 * Build CSS for `renderer.setStyles(...)`.
 *
 * Page margins are **not** body padding here — apply via
 * `renderer.setAttribute("margin", String(prefs.marginPx))` (Pattern 1).
 */
export function buildReadingCss(
  prefs: ReadingPrefs,
  fontFaceCss: string,
  fontFamilyCss: string,
): string {
  const colors = PAGE_COLORS[prefs.theme];
  return `
    ${fontFaceCss}
    html {
      background: ${colors.background} !important;
      color: ${colors.foreground} !important;
    }
    body {
      font-family: ${fontFamilyCss};
      font-size: ${prefs.fontSizePx}px;
      line-height: ${prefs.lineHeight};
    }
    p, li, blockquote, dd {
      line-height: ${prefs.lineHeight};
    }
  `;
}
