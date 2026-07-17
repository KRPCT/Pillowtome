import { describe, expect, it } from "vitest";
import { relocateToLocatorRow, textExactFromRange } from "./locator-store";

// jsdom-free helper: build a minimal Range stand-in for textExactFromRange.
function fakeRange(text: string): Range {
  return { toString: () => text } as unknown as Range;
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
});
