import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/pillow", () => ({
  pillowFontUrl: (id: string) => `pillow://localhost/fonts/${id}`,
}));

import {
  BUNDLED_CJK_FAMILY,
  BUNDLED_NOTO_SC_ID,
  BUNDLED_NOTO_SERIF_SC_400_ID,
  BUNDLED_NOTO_SERIF_SC_700_ID,
  BUNDLED_NOTO_TC_ID,
  BUNDLED_SERIF_CJK_FAMILY,
  FONT_KEY_NOTO_SANS,
  FONT_KEY_NOTO_SERIF,
  buildAllBundledFontFaceCss,
  buildBundledCjkFontFaceCss,
  buildBundledSerifCjkFontFaceCss,
  fontFamilyCssFor,
  pillowCustomFamily,
} from "./fonts";
import { SYSTEM_CJK_STACK } from "./apply-reading-styles";

describe("buildBundledCjkFontFaceCss", () => {
  it("emits two @font-face blocks for SC+TC under PillowBundledCJK", () => {
    const css = buildBundledCjkFontFaceCss();
    expect(css).toContain("@font-face");
    expect(css).toContain(`font-family: "${BUNDLED_CJK_FAMILY}"`);
    expect(css).toContain(BUNDLED_NOTO_SC_ID);
    expect(css).toContain(BUNDLED_NOTO_TC_ID);
    // block, not swap: local pillow protocol decodes fast — swap caused a
    // guaranteed fallback→bundled flicker on every book open.
    expect(css).toContain("font-display: block");
    expect(css).not.toContain("font-display: swap");
  });
});

describe("buildBundledSerifCjkFontFaceCss", () => {
  it("emits static 400/700 serif faces with full coverage (no unicode-range subsets)", () => {
    const css = buildBundledSerifCjkFontFaceCss();
    expect(css).toContain(`font-family: "${BUNDLED_SERIF_CJK_FAMILY}"`);
    expect(css).toContain(BUNDLED_NOTO_SERIF_SC_400_ID);
    expect(css).toContain(BUNDLED_NOTO_SERIF_SC_700_ID);
    expect(css).toContain("font-weight: 400");
    expect(css).toContain("font-weight: 700");
    expect(css).not.toContain("unicode-range");
  });

  it("buildAllBundledFontFaceCss includes sans + serif families", () => {
    const css = buildAllBundledFontFaceCss();
    expect(css).toContain(BUNDLED_CJK_FAMILY);
    expect(css).toContain(BUNDLED_SERIF_CJK_FAMILY);
  });
});

describe("fontFamilyCssFor stack order (D-47)", () => {
  it("system path is the system CJK stack with bundled as last-resort CJK fallback", () => {
    const stack = fontFamilyCssFor("system", null);
    expect(stack.startsWith("system-ui")).toBe(true);
    expect(stack).toContain("Noto Sans CJK TC");
    // bundled sans sits right before the generic sans-serif (never before system fonts)
    const bundledIdx = stack.indexOf(`"${BUNDLED_CJK_FAMILY}"`);
    expect(bundledIdx).toBeGreaterThan(0);
    expect(stack.slice(bundledIdx)).toBe(`"${BUNDLED_CJK_FAMILY}", sans-serif`);
  });

  it("noto-serif starts with the bundled serif VF, serif fallbacks after", () => {
    const stack = fontFamilyCssFor(FONT_KEY_NOTO_SERIF, null);
    expect(stack.startsWith(`"${BUNDLED_SERIF_CJK_FAMILY}"`)).toBe(true);
    expect(stack).toContain("Songti SC");
    expect(stack).toContain(`"${BUNDLED_CJK_FAMILY}"`);
    expect(stack.endsWith("serif")).toBe(true);
  });

  it("noto-sans starts with the bundled sans VF then system stack", () => {
    const stack = fontFamilyCssFor(FONT_KEY_NOTO_SANS, null);
    expect(stack.startsWith(`"${BUNDLED_CJK_FAMILY}"`)).toBe(true);
    expect(stack).toContain(SYSTEM_CJK_STACK);
  });

  it("custom active: custom → bundled → system", () => {
    const id = "fabc123";
    const stack = fontFamilyCssFor(id, id);
    const custom = `"${pillowCustomFamily(id)}"`;
    const bundled = `"${BUNDLED_CJK_FAMILY}"`;
    expect(stack.indexOf(custom)).toBe(0);
    expect(stack.indexOf(bundled)).toBeGreaterThan(0);
    expect(stack.indexOf(custom)).toBeLessThan(stack.indexOf(bundled));
    expect(stack.indexOf(bundled)).toBeLessThan(stack.indexOf("system-ui"));
  });
});
