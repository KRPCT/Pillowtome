import { describe, expect, it } from "vitest";
import {
  capturePosition,
  planJump,
  positionForTocSpine,
  spineFromResolvedNav,
} from "./position-bus";
import { encodeScrollPosition, isRealCfi } from "./reading-position";

describe("planJump", () => {
  it("uses pillow-scroll token when no real cfi", () => {
    const plan = planJump(
      { spineIndex: 3, offsetFraction: 0.25, cfi: null },
      "scroll",
    );
    expect(plan.spineIndex).toBe(3);
    expect(plan.offsetFraction).toBe(0.25);
    expect(plan.goToTarget.startsWith("pillow-scroll:")).toBe(true);
  });

  it("prefers real cfi for goToTarget", () => {
    const cfi = "epubcfi(/6/4!/4/2/2/1:0)";
    const plan = planJump(
      { spineIndex: 1, offsetFraction: 0, cfi },
      "paginate",
    );
    expect(isRealCfi(plan.goToTarget)).toBe(true);
  });
});

describe("capturePosition", () => {
  it("parses pillow-scroll cfi", () => {
    const tok = encodeScrollPosition(2, 0.5);
    const pos = capturePosition({ cfi: tok, fraction: 0.1 });
    expect(pos?.spineIndex).toBe(2);
    expect(pos?.offsetFraction).toBeCloseTo(0.5);
  });

  it("uses spine when present", () => {
    const pos = capturePosition({ spineIndex: 4, offsetFraction: 0.1 });
    expect(pos?.spineIndex).toBe(4);
  });
});

describe("spineFromResolvedNav / toc", () => {
  it("reads index", () => {
    expect(spineFromResolvedNav({ index: 7 })).toBe(7);
    expect(spineFromResolvedNav(null)).toBeNull();
  });

  it("toc position starts at section top", () => {
    expect(positionForTocSpine(5).offsetFraction).toBe(0);
  });
});
