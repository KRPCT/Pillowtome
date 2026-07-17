import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/pillow", () => ({
  pillowFontUrl: (id: string) => `pillow://localhost/fonts/${id}`,
}));

import {
  BUNDLED_CJK_FAMILY,
  BUNDLED_NOTO_SC_ID,
  BUNDLED_NOTO_TC_ID,
  buildBundledCjkFontFaceCss,
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
    expect(css).toContain("font-display: swap");
  });
});

describe("fontFamilyCssFor stack order (D-47)", () => {
  it("system path starts with PillowBundledCJK then system stack", () => {
    const stack = fontFamilyCssFor("system", null);
    expect(stack.startsWith(`"${BUNDLED_CJK_FAMILY}"`)).toBe(true);
    expect(stack).toContain(SYSTEM_CJK_STACK);
    expect(stack).toContain("Noto Sans CJK TC");
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
