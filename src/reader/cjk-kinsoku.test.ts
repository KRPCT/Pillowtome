import { describe, expect, it } from "vitest";
import {
  ZH_PROHIBITED_LINE_END,
  ZH_PROHIBITED_LINE_START,
} from "./cjk-kinsoku";

describe("ZH kinsoku tables", () => {
  it("exports non-empty shared zh start/end sets", () => {
    expect(ZH_PROHIBITED_LINE_START.length).toBeGreaterThan(0);
    expect(ZH_PROHIBITED_LINE_END.length).toBeGreaterThan(0);
  });

  it("includes known start-prohibited punctuation", () => {
    expect(ZH_PROHIBITED_LINE_START).toContain("。");
    expect(ZH_PROHIBITED_LINE_START).toContain("，");
    expect(ZH_PROHIBITED_LINE_START).toContain("、");
    expect(ZH_PROHIBITED_LINE_START).toContain("；");
    expect(ZH_PROHIBITED_LINE_START).toContain("：");
    expect(ZH_PROHIBITED_LINE_START).toContain("？");
    expect(ZH_PROHIBITED_LINE_START).toContain("！");
    expect(ZH_PROHIBITED_LINE_START).toContain("」");
  });

  it("includes known end-prohibited opening marks", () => {
    expect(ZH_PROHIBITED_LINE_END).toContain("「");
    expect(ZH_PROHIBITED_LINE_END).toContain("《");
    expect(ZH_PROHIBITED_LINE_END).toContain("【");
    expect(ZH_PROHIBITED_LINE_END).toContain("（");
  });

  it("has no overlapping start/end core marks", () => {
    const start = new Set<string>(ZH_PROHIBITED_LINE_START);
    for (const ch of ZH_PROHIBITED_LINE_END) {
      expect(start.has(ch)).toBe(false);
    }
  });
});
