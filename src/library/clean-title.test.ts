import { describe, expect, it } from "vitest";
import { cleanBookTitle } from "./clean-title";

describe("cleanBookTitle", () => {
  it("strips the source-site tail, keeps the volume marker", () => {
    expect(cleanBookTitle("败北女角太多了！-第一卷-迷糊轻小说")).toBe(
      "败北女角太多了！-第一卷",
    );
  });

  it("leaves a plain title untouched", () => {
    expect(cleanBookTitle("红楼梦")).toBe("红楼梦");
  });

  it("does not truncate a real title that merely contains 小说", () => {
    expect(cleanBookTitle("小说家的日常")).toBe("小说家的日常");
  });

  it("strips a bracketed site tag anywhere", () => {
    expect(cleanBookTitle("【轻之国度】某某物语")).toBe("某某物语");
  });

  it("strips a trailing domain in parens", () => {
    expect(cleanBookTitle("某本书（www.yidm.com）")).toBe("某本书");
  });

  it("never returns empty — falls back to raw", () => {
    expect(cleanBookTitle("迷糊轻小说")).toBe("迷糊轻小说");
    expect(cleanBookTitle("")).toBe("");
  });
});
