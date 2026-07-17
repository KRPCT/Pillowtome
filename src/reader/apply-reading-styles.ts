/**
 * Pure helpers for foliate-js flow + injected reading CSS (READ-01/02/03).
 * No React / Tauri imports — unit-testable.
 */

import type { CjkCssCaps } from "./cjk-feature-detect";

export type ReadingMode = "paginate" | "scroll";
export type ReadingTheme = "day" | "night" | "sepia";

/** Safe default for unit tests / callers that omit capability probes. */
export const NO_CJK_CAPS: CjkCssCaps = {
  textSpacingTrim: false,
  textAutospace: false,
  lineBreakStrict: false,
};

export interface ReadingPrefs {
  mode: ReadingMode;
  theme: ReadingTheme;
  fontFamilyKey: string;
  fontSizePx: number;
  lineHeight: number;
  marginPx: number;
  activeFontId: string | null;
  /** 标点挤压 (CJK-01 / D-32). */
  cjkPunctTrim: boolean;
  /** 盘古之白 (CJK-02 / D-32). */
  cjkAutospace: boolean;
  /** 禁则 (CJK-03 / D-32). */
  cjkKinsoku: boolean;
  /** 书名清洗：书架显示时去掉来源站名尾巴（display-only；不改存储的原始书名）。 */
  cleanTitles: boolean;
  /** 词不拆行：用 Intl.Segmenter 保证 CJK 词不跨行/页被拆（display-only, PoC）。 */
  wordKeep: boolean;
  /** 简繁显示转换（display-only, OpenCC）：off 原文 / s2t 简→繁 / t2s 繁→简。 */
  cnConvert: "off" | "s2t" | "t2s";
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
  cjkPunctTrim: true,
  cjkAutospace: true,
  cjkKinsoku: true,
  cleanTitles: true,
  wordKeep: false,
  cnConvert: "off",
};

/** Default reading body stack — never Geist (chrome-only). Includes TC names (D-44/D-47). */
export const SYSTEM_CJK_STACK =
  'system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans CJK TC", sans-serif';

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
 * CJK typography CSS gated by prefs + runtime caps (CJK-01..04, D-35..D-42).
 * Pure property templates only — no free-form user strings (T-03-css).
 */
export function buildCjkCss(prefs: ReadingPrefs, caps: CjkCssCaps): string {
  const parts: string[] = [];

  // CJK-04 defaults (always on; not toggles). D-40 indent / D-41 line-height stays on body/p.
  parts.push(`
    body p {
      text-indent: 2em !important;
    }
    body h1, body h2, body h3, body h4, body h5, body h6,
    body blockquote, body pre, body li, body td, body th {
      text-indent: 0 !important;
    }
  `);

  // CJK-01 标点挤压 — CSS-only; silent degrade when unsupported (D-38). No JS rewriter.
  if (prefs.cjkPunctTrim && caps.textSpacingTrim) {
    parts.push(`html, body { text-spacing-trim: normal !important; }`);
  } else if (!prefs.cjkPunctTrim && caps.textSpacingTrim) {
    // OFF path: space-all restores full-width spacing when engine supports the property.
    parts.push(`html, body { text-spacing-trim: space-all !important; }`);
  }

  // CJK-02 盘古之白 — native CSS when caps allow; else caller may install shim.
  if (prefs.cjkAutospace && caps.textAutospace) {
    parts.push(`html, body { text-autospace: normal !important; }`);
  } else if (!prefs.cjkAutospace && caps.textAutospace) {
    parts.push(`html, body { text-autospace: no-autospace !important; }`);
  }

  // CJK-03 禁则 — never word-break: break-all.
  if (prefs.cjkKinsoku && caps.lineBreakStrict) {
    parts.push(`
      html, body {
        line-break: strict !important;
        word-break: normal !important;
        overflow-wrap: break-word !important;
      }
    `);
  } else if (!prefs.cjkKinsoku) {
    parts.push(`html, body { line-break: auto !important; }`);
  }

  return parts.join("\n");
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
 *
 * Optional `caps` gates CJK property emission (D-35). Defaults to no caps so
 * unit tests without probes stay silent on engine-specific properties.
 */
/**
 * Annotation palette per theme (D-70). The `::highlight()` rules injected per
 * section iframe (css-highlight.ts) and `paletteColor()` both read `--anno-*`
 * from the iframe's own documentElement, so the vars must live in the injected
 * reading CSS — CSS custom properties do NOT cascade in from the parent document.
 * index.css declares the same tokens for the outer chrome (bubble swatches).
 */
const ANNO_PALETTE: Record<
  ReadingPrefs["theme"],
  Record<"cinnabar" | "ochre" | "green" | "indigo", { seed: string; alpha: number }>
> = {
  day: {
    cinnabar: { seed: "#d24a32", alpha: 28 },
    ochre: { seed: "#c08a2e", alpha: 28 },
    green: { seed: "#4f855f", alpha: 28 },
    indigo: { seed: "#3e5c99", alpha: 28 },
  },
  sepia: {
    cinnabar: { seed: "#d24a32", alpha: 28 },
    ochre: { seed: "#c08a2e", alpha: 28 },
    green: { seed: "#4f855f", alpha: 28 },
    indigo: { seed: "#3e5c99", alpha: 28 },
  },
  night: {
    cinnabar: { seed: "#e8846f", alpha: 30 },
    ochre: { seed: "#d9b061", alpha: 30 },
    green: { seed: "#7fb48c", alpha: 30 },
    indigo: { seed: "#8aa4d6", alpha: 30 },
  },
};

/** Build the `--anno-*` / `--anno-*-fill` declarations for a theme (iframe scope). */
export function annoPaletteCss(theme: ReadingPrefs["theme"]): string {
  return (Object.entries(ANNO_PALETTE[theme]) as Array<
    [string, { seed: string; alpha: number }]
  >)
    .map(
      ([key, { seed, alpha }]) =>
        `--anno-${key}: ${seed}; --anno-${key}-fill: color-mix(in srgb, ${seed} ${alpha}%, transparent);`,
    )
    .join(" ");
}

export function buildReadingCss(
  prefs: ReadingPrefs,
  fontFaceCss: string,
  fontFamilyCss: string,
  caps: CjkCssCaps = NO_CJK_CAPS,
): string {
  const colors = PAGE_COLORS[prefs.theme];
  const m = prefs.marginPx;
  const top = PAGE_TOP_EXTRA_PX;
  const bg = colors.background;
  const fg = colors.foreground;
  const cjk = buildCjkCss(prefs, caps);
  return `
    ${fontFaceCss}
    html {
      background: ${bg} !important;
      background-color: ${bg} !important;
      color: ${fg} !important;
      ${annoPaletteCss(prefs.theme)}
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
    /*
     * Image / media auto-fit (READER images). Book content lives in separate
     * blob-URL iframes, so ONLY this injected CSS reaches it. Cap width to the
     * column and height to one screen, keeping aspect ratio.
     * - width/height stay plain 'auto' (NOT !important) so the browser derives
     *   aspect-ratio from an img's width/height attributes → box reserved before
     *   the bitmap loads → no layout shift that would corrupt scroll-offset math.
     * - max-height uses --pillow-vh (real viewport px, injected per scroll iframe)
     *   because vh/svh mean the whole content height inside a height-expanded
     *   iframe, not one screen. Fallback 100vh only bites transiently / in
     *   paginate (where foliate's setImageSize overrides with inline !important).
     */
    img, svg, video, image {
      max-width: 100% !important;
      max-height: var(--pillow-vh, 100vh) !important;
      width: auto;
      height: auto;
      object-fit: contain;
      object-position: center;
      box-sizing: border-box;
      break-inside: avoid;
      page-break-inside: avoid;
      -webkit-column-break-inside: avoid;
    }
    /* SVG covers often wrap a raster: <svg><image/></svg> — fit both. */
    svg image { max-width: 100% !important; max-height: 100% !important; }
    /* Center standalone / figure images; keep inline images inline. */
    figure { margin: 1em 0; text-align: center; }
    figure img, figure svg,
    p > img:only-child, div > img:only-child,
    body > img, body > svg {
      display: block;
      margin-inline: auto;
    }
    /* Stop wide tables / pre forcing horizontal overflow in scroll mode. */
    table { max-width: 100% !important; box-sizing: border-box; }
    pre { max-width: 100% !important; overflow-x: auto; }
    ${cjk}
  `;
}
