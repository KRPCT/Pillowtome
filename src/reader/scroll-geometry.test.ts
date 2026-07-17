import { describe, expect, it } from "vitest";
import { iframeLocalVisibleWindow } from "./scroll-geometry";

describe("iframeLocalVisibleWindow", () => {
  it("projects outer scroller geometry into iframe-local coordinates", () => {
    // Section starts at 1000px in the outer scroller; viewport top is 1300.
    // Local start inside the iframe should be 300.
    expect(iframeLocalVisibleWindow(1300, 1000, 800)).toEqual({
      localStart: 300,
      localEnd: 1100,
    });
  });

  it("clamps negative local start to 0", () => {
    // Outer scroller is above the section top (section not yet reached).
    expect(iframeLocalVisibleWindow(200, 1000, 800)).toEqual({
      localStart: 0,
      localEnd: 800,
    });
  });
});
