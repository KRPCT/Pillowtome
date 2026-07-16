import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PREFS,
  FOLIATE_MAX_BLOCK_SIZE_FLOOR_PX,
  NO_CJK_CAPS,
  PAGE_COLORS,
  SYSTEM_CJK_STACK,
  applyFoliateLayoutAttrs,
  buildReadingCss,
  flowAttr,
  foliateMarginBandPx,
  type ReadingTheme,
} from "./apply-reading-styles";
import type { CjkCssCaps } from "./cjk-feature-detect";

const ALL_CJK_CAPS: CjkCssCaps = {
  textSpacingTrim: true,
  textAutospace: true,
  lineBreakStrict: true,
};

describe("flowAttr", () => {
  it("maps paginate → paginated", () => {
    expect(flowAttr("paginate")).toBe("paginated");
  });

  it("maps scroll → scrolled", () => {
    expect(flowAttr("scroll")).toBe("scrolled");
  });
});

describe("DEFAULT_PREFS / constants", () => {
  it("matches UI-SPEC defaults", () => {
    expect(DEFAULT_PREFS).toEqual({
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
    });
  });

  it("exports system CJK stack", () => {
    expect(SYSTEM_CJK_STACK).toBe(
      'system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
    );
  });
});

describe("buildReadingCss", () => {
  const themes: ReadingTheme[] = ["day", "night", "sepia"];

  for (const theme of themes) {
    it(`includes font-size, line-height, horizontal padding, page colors for ${theme}`, () => {
      const prefs = {
        ...DEFAULT_PREFS,
        theme,
        fontSizePx: 20,
        lineHeight: 1.8,
        marginPx: 24,
      };
      const css = buildReadingCss(prefs, "/* face */", SYSTEM_CJK_STACK);
      const colors = PAGE_COLORS[theme];

      expect(css).toContain("/* face */");
      expect(css).toContain("font-size: 20px");
      expect(css).toContain("line-height: 1.8");
      // Sides from prefs; extra top air; bottom via foliate margin band.
      expect(css).toContain("padding: 28px 24px 0 24px");
      // Body must force author bg (e.g. MarkdownPad #fff) off.
      expect(css).toMatch(/body\s*\{[^}]*background-color:\s*[^;]+!important/s);
      expect(css).toContain(colors.background);
      expect(css).toContain(colors.foreground);
      expect(css).toContain(SYSTEM_CJK_STACK);
      expect(css).not.toContain("Geist");
    });
  }

  it("overrides author white body background (安达-style MarkdownPad CSS)", () => {
    const css = buildReadingCss(DEFAULT_PREFS, "", SYSTEM_CJK_STACK);
    // Day page bg from UI-SPEC
    expect(css).toContain("background-color: #FFFEF9 !important");
    // Both html and body get the paint
    expect(css.indexOf("html")).toBeLessThan(css.indexOf("body"));
  });

  it("always emits CJK-04 indent defaults", () => {
    const css = buildReadingCss(DEFAULT_PREFS, "", SYSTEM_CJK_STACK, NO_CJK_CAPS);
    expect(css).toContain("text-indent: 2em");
    expect(css).toMatch(/body h1[\s\S]*text-indent:\s*0/);
    expect(css).toContain("blockquote");
    expect(css).not.toContain("break-all");
    expect(css).not.toMatch(/content:\s*["']「/);
  });

  it("emits trim/autospace/line-break only when toggle+caps true", () => {
    const css = buildReadingCss(DEFAULT_PREFS, "", SYSTEM_CJK_STACK, ALL_CJK_CAPS);
    expect(css).toContain("text-spacing-trim: normal");
    expect(css).toContain("text-autospace: normal");
    expect(css).toContain("line-break: strict");
    expect(css).toContain("word-break: normal");
    expect(css).not.toContain("break-all");
  });

  it("OFF paths emit engine-safe tokens without break-all", () => {
    const prefs = {
      ...DEFAULT_PREFS,
      cjkPunctTrim: false,
      cjkAutospace: false,
      cjkKinsoku: false,
    };
    const css = buildReadingCss(prefs, "", SYSTEM_CJK_STACK, ALL_CJK_CAPS);
    expect(css).toContain("text-spacing-trim: space-all");
    expect(css).toContain("text-autospace: no-autospace");
    expect(css).toContain("line-break: auto");
    expect(css).not.toContain("text-spacing-trim: normal");
    expect(css).not.toContain("line-break: strict");
    expect(css).not.toContain("break-all");
  });

  it("silent-degrades when caps are false (no trim/autospace/strict)", () => {
    const css = buildReadingCss(DEFAULT_PREFS, "", SYSTEM_CJK_STACK, NO_CJK_CAPS);
    expect(css).not.toContain("text-spacing-trim");
    expect(css).not.toContain("text-autospace");
    expect(css).not.toContain("line-break: strict");
  });
});

describe("foliateMarginBandPx / applyFoliateLayoutAttrs", () => {
  it("clamps band between 40 and 80", () => {
    expect(foliateMarginBandPx(200)).toBe(40);
    expect(foliateMarginBandPx(800)).toBe(56); // 800 * 0.07 = 56
    expect(foliateMarginBandPx(3000)).toBe(80);
  });

  it("sets margin band px and max-block-size from host height", () => {
    const setAttribute = vi.fn();
    applyFoliateLayoutAttrs({ setAttribute }, 800);
    expect(setAttribute).toHaveBeenCalledWith("margin", "56px");
    expect(setAttribute).toHaveBeenCalledWith("max-block-size", "800px");
  });

  it("uses a tall floor when host height is missing", () => {
    const setAttribute = vi.fn();
    applyFoliateLayoutAttrs({ setAttribute }, null);
    expect(setAttribute).toHaveBeenCalledWith(
      "max-block-size",
      `${FOLIATE_MAX_BLOCK_SIZE_FLOOR_PX}px`,
    );
    // band falls back to ~800 → 56px
    expect(setAttribute).toHaveBeenCalledWith("margin", "56px");
  });
});
