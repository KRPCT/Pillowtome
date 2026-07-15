import { describe, expect, it } from "vitest";
import {
  encodeScrollLocator,
  parseScrollLocator,
  continuousProgressToLocatorRow,
} from "./locator-store";

describe("scroll locator token", () => {
  it("round-trips spine + fraction", () => {
    const cfi = encodeScrollLocator(3, 0.42);
    expect(cfi.startsWith("pillow-scroll:")).toBe(true);
    const parsed = parseScrollLocator(cfi);
    expect(parsed).toEqual({ spineIndex: 3, offsetFraction: 0.42 });
  });

  it("rejects real CFI strings", () => {
    expect(parseScrollLocator("epubcfi(/6/4!/4/2/1:0)")).toBeNull();
    expect(parseScrollLocator(null)).toBeNull();
  });

  it("builds upsert row", () => {
    const row = continuousProgressToLocatorRow("work-1", 2, 0.5);
    expect(row.work_id).toBe("work-1");
    expect(parseScrollLocator(row.cfi)).toEqual({
      spineIndex: 2,
      offsetFraction: 0.5,
    });
  });
});
