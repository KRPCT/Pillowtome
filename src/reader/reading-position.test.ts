import { describe, expect, it } from "vitest";
import {
  encodeScrollPosition,
  isRealCfi,
  matchSectionByHref,
  parseScrollPosition,
  positionFromLocatorCfi,
  positionToLocatorCfi,
  spineToLinearIndex,
  wholeBookFraction,
} from "./reading-position";

describe("scroll position token", () => {
  it("round-trips spine + offset", () => {
    const token = encodeScrollPosition(3, 0.42);
    expect(token).toBe("pillow-scroll:3:0.4200");
    expect(parseScrollPosition(token)).toEqual({
      spineIndex: 3,
      offsetFraction: 0.42,
    });
  });

  it("rejects real CFI", () => {
    expect(parseScrollPosition("epubcfi(/6/4!/4)")).toBeNull();
    expect(isRealCfi("epubcfi(/6/4!/4)")).toBe(true);
    expect(isRealCfi("pillow-scroll:1:0.1")).toBe(false);
  });
});

describe("positionFromLocatorCfi / positionToLocatorCfi", () => {
  it("parses pillow-scroll tokens", () => {
    const pos = positionFromLocatorCfi("pillow-scroll:2:0.5000", 0.2);
    expect(pos).toEqual({
      spineIndex: 2,
      offsetFraction: 0.5,
      cfi: null,
      fraction: 0.2,
    });
  });

  it("keeps real CFI and uses spine fallback", () => {
    const pos = positionFromLocatorCfi("epubcfi(/6/8!/4/2:1)", 0.3, 5);
    expect(pos?.spineIndex).toBe(5);
    expect(pos?.cfi).toBe("epubcfi(/6/8!/4/2:1)");
    expect(positionToLocatorCfi(pos!)).toBe("epubcfi(/6/8!/4/2:1)");
  });

  it("encodes spine+offset when no real CFI", () => {
    expect(
      positionToLocatorCfi({ spineIndex: 1, offsetFraction: 0.25 }),
    ).toBe("pillow-scroll:1:0.2500");
  });
});

describe("matchSectionByHref", () => {
  it("skips numeric PDF ref ids without throwing", () => {
    expect(() =>
      matchSectionByHref({ num: 1439, gen: 0 }, "chapter1.html"),
    ).not.toThrow();
    expect(matchSectionByHref({ num: 1439, gen: 0 }, "chapter1.html")).toBe(
      false,
    );
  });

  it("returns false for undefined section id", () => {
    expect(matchSectionByHref(undefined, "chapter1.html")).toBe(false);
  });

  it("matches via prefix, suffix, and equality", () => {
    expect(matchSectionByHref("OEBPS/chapter1.html", "chapter1.html")).toBe(
      true,
    );
    expect(matchSectionByHref("chapter1.html", "OEBPS/chapter1.html")).toBe(
      true,
    );
    expect(matchSectionByHref("chapter1.html", "chapter1.html")).toBe(true);
  });

  it("returns false for non-matching hrefs", () => {
    expect(matchSectionByHref("chapter2.html", "chapter1.html")).toBe(false);
  });
});

describe("spineToLinearIndex / wholeBookFraction", () => {
  const sections = [
    { index: 0, linear: "yes" },
    { index: 1, linear: "no" },
    { index: 2, linear: "yes" },
    { index: 3, linear: "yes" },
  ];

  it("maps spine to linear skipping linear=no", () => {
    expect(spineToLinearIndex(0, sections)).toBe(0);
    expect(spineToLinearIndex(2, sections)).toBe(1);
    expect(spineToLinearIndex(3, sections)).toBe(2);
    expect(spineToLinearIndex(1, sections)).toBe(-1);
  });

  it("computes coarse whole-book fraction", () => {
    // linear list length 3; spine 2 is linear index 1; +0.5 => (1.5)/3 = 0.5
    expect(wholeBookFraction(2, 0.5, sections)).toBeCloseTo(0.5, 5);
  });
});
