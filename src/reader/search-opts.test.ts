import { describe, expect, it } from "vitest";
import { SEARCH_DEBOUNCE_MS, buildSearchOpts } from "./search-opts";

describe("SEARCH_DEBOUNCE_MS", () => {
  it("is within 200–300ms (D-34)", () => {
    expect(SEARCH_DEBOUNCE_MS).toBeGreaterThanOrEqual(200);
    expect(SEARCH_DEBOUNCE_MS).toBeLessThanOrEqual(300);
    expect(SEARCH_DEBOUNCE_MS).toBe(250);
  });
});

describe("buildSearchOpts", () => {
  it("trims query and only returns { query }", () => {
    expect(buildSearchOpts("  中文  ")).toEqual({ query: "中文" });
  });

  it("allows empty string for callers to skip", () => {
    expect(buildSearchOpts("   ")).toEqual({ query: "" });
  });

  it("does not include matchWholeWords (CJK grapheme path)", () => {
    const opts = buildSearchOpts("测试");
    expect(opts).toEqual({ query: "测试" });
    expect("matchWholeWords" in opts).toBe(false);
  });
});
