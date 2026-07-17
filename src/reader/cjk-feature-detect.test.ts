import { describe, expect, it, vi } from "vitest";
import { detectCjkCssCaps } from "./cjk-feature-detect";

describe("detectCjkCssCaps", () => {
  it("probes via injected CSS.supports", () => {
    const supports = vi.fn((q: string) => q.includes("line-break"));
    const caps = detectCjkCssCaps(supports);
    expect(caps.lineBreakStrict).toBe(true);
    expect(caps.textAutospace).toBe(false);
    expect(caps.textSpacingTrim).toBe(false);
    expect(supports).toHaveBeenCalledWith("text-spacing-trim: normal");
    expect(supports).toHaveBeenCalledWith("text-autospace: normal");
    expect(supports).toHaveBeenCalledWith("line-break: strict");
  });

  it("reports independent true/false per probe", () => {
    const supports = vi.fn((q: string) => {
      if (q.startsWith("text-spacing-trim")) return true;
      if (q.startsWith("text-autospace")) return false;
      if (q.startsWith("line-break")) return true;
      return false;
    });
    const caps = detectCjkCssCaps(supports);
    expect(caps).toEqual({
      textSpacingTrim: true,
      textAutospace: false,
      lineBreakStrict: true,
    });
  });

  it("soft-fails to all-false when supports always returns false", () => {
    expect(detectCjkCssCaps(() => false)).toEqual({
      textSpacingTrim: false,
      textAutospace: false,
      lineBreakStrict: false,
    });
  });
});
