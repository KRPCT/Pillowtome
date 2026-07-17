import { describe, expect, it } from "vitest";
import {
  relocateToLocatorRow,
  textContextFromRange,
  textExactFromRange,
} from "./locator-store";

// jsdom-free helper: build a minimal Range stand-in for textExactFromRange.
function fakeRange(text: string): Range {
  return { toString: () => text } as unknown as Range;
}

// Range spanning `exact` inside a single text node with `pre`/`post` neighbors.
function midRange(pre: string, exact: string, post: string): Range {
  const node = { nodeType: 3, nodeValue: pre + exact + post } as unknown as Text;
  return {
    startContainer: node,
    startOffset: pre.length,
    endContainer: node,
    endOffset: pre.length + exact.length,
    toString: () => exact,
  } as unknown as Range;
}

describe("textExactFromRange", () => {
  it("trims and collapses whitespace, caps length", () => {
    expect(textExactFromRange(fakeRange("  hello   world  "))).toBe(
      "hello world",
    );
  });

  it("caps to 120 chars", () => {
    const long = "x".repeat(200);
    expect(textExactFromRange(fakeRange(long))?.length).toBe(120);
  });

  it("returns null for null range", () => {
    expect(textExactFromRange(null)).toBeNull();
    expect(textExactFromRange(fakeRange("   "))).toBeNull();
  });
});

describe("relocateToLocatorRow", () => {
  it("maps fraction + cfi from a relocate detail", () => {
    const row = relocateToLocatorRow("work-1", {
      fraction: 0.42,
      cfi: "epubcfi(/6/4!/4/2/1:0)",
    });
    expect(row.work_id).toBe("work-1");
    expect(row.cfi).toBe("epubcfi(/6/4!/4/2/1:0)");
    expect(row.progress_fraction).toBeCloseTo(0.42, 5);
  });

  it("clamps fraction to 0..1", () => {
    expect(relocateToLocatorRow("w", { fraction: 5 }).progress_fraction).toBe(1);
    expect(relocateToLocatorRow("w", { fraction: -1 }).progress_fraction).toBe(
      0,
    );
  });

  it("nulls out cfi/fraction when both absent", () => {
    const row = relocateToLocatorRow("w", {
      fraction: undefined,
      cfi: undefined,
    });
    expect(row.cfi).toBeNull();
    expect(row.progress_fraction).toBeNull();
  });

  it("extracts text_exact from the range", () => {
    const row = relocateToLocatorRow("w", {
      fraction: 0.1,
      range: fakeRange("some visible text"),
    });
    expect(row.text_exact).toBe("some visible text");
  });

  it("populates non-null text_pre/text_post for a mid-paragraph range", () => {
    const row = relocateToLocatorRow("w", {
      fraction: 0.1,
      range: midRange("前面的文字", "选中内容", "后面的文字"),
    });
    expect(row.text_pre).toBe("前面的文字");
    expect(row.text_exact).toBe("选中内容");
    expect(row.text_post).toBe("后面的文字");
  });
});

describe("textContextFromRange", () => {
  it("returns null fields when there is no range", () => {
    expect(textContextFromRange(null)).toEqual({
      text_pre: null,
      text_exact: null,
      text_post: null,
    });
  });

  it("caps pre/post to 16 chars each", () => {
    const ctx = textContextFromRange(
      midRange("a".repeat(40), "middle", "b".repeat(40)),
    );
    expect(ctx.text_pre?.length).toBe(16);
    expect(ctx.text_post?.length).toBe(16);
    expect(ctx.text_exact).toBe("middle");
  });

  it("yields empty-string boundaries at the edges of the node", () => {
    const ctx = textContextFromRange(midRange("", "edge", ""));
    expect(ctx.text_pre).toBe("");
    expect(ctx.text_post).toBe("");
  });
});
