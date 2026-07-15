import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PREFS,
  FOLIATE_MAX_BLOCK_SIZE_FLOOR_PX,
  PAGE_COLORS,
  SYSTEM_CJK_STACK,
  applyFoliateLayoutAttrs,
  buildReadingCss,
  flowAttr,
  foliateMarginBandPx,
  type ReadingTheme,
} from "./apply-reading-styles";

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
      // Horizontal page inset only (vertical air via foliate margin band).
      expect(css).toContain("padding: 0 24px");
      expect(css).toContain(colors.background);
      expect(css).toContain(colors.foreground);
      expect(css).toContain(SYSTEM_CJK_STACK);
      expect(css).not.toContain("Geist");
    });
  }
});

describe("foliateMarginBandPx / applyFoliateLayoutAttrs", () => {
  it("clamps band between 16 and 48", () => {
    expect(foliateMarginBandPx(200)).toBe(16);
    expect(foliateMarginBandPx(800)).toBe(24);
    expect(foliateMarginBandPx(3000)).toBe(48);
  });

  it("sets margin band px and max-block-size from host height", () => {
    const setAttribute = vi.fn();
    applyFoliateLayoutAttrs({ setAttribute }, 800);
    expect(setAttribute).toHaveBeenCalledWith("margin", "24px");
    expect(setAttribute).toHaveBeenCalledWith("max-block-size", "800px");
  });

  it("uses a tall floor when host height is missing", () => {
    const setAttribute = vi.fn();
    applyFoliateLayoutAttrs({ setAttribute }, null);
    expect(setAttribute).toHaveBeenCalledWith(
      "max-block-size",
      `${FOLIATE_MAX_BLOCK_SIZE_FLOOR_PX}px`,
    );
    // band falls back to ~800 → 24px
    expect(setAttribute).toHaveBeenCalledWith("margin", "24px");
  });
});
