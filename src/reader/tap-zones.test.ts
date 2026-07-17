import { describe, expect, it } from "vitest";
import { resolveTapZone, tapZoneAction } from "./tap-zones";

describe("resolveTapZone", () => {
  const width = 100;

  it("left zone below 33%", () => {
    expect(resolveTapZone(0, width)).toBe("left");
    expect(resolveTapZone(32.9, width)).toBe("left");
  });

  it("center zone [33%, 67%)", () => {
    expect(resolveTapZone(33, width)).toBe("center");
    expect(resolveTapZone(50, width)).toBe("center");
    expect(resolveTapZone(66.9, width)).toBe("center");
  });

  it("right zone from 67%", () => {
    expect(resolveTapZone(67, width)).toBe("right");
    expect(resolveTapZone(100, width)).toBe("right");
  });

  it("falls back to center when width is non-positive", () => {
    expect(resolveTapZone(10, 0)).toBe("center");
    expect(resolveTapZone(10, -1)).toBe("center");
  });
});

describe("tapZoneAction", () => {
  it("paginate: left prev, right next, center toggle", () => {
    expect(tapZoneAction("left", "paginate")).toBe("prev");
    expect(tapZoneAction("right", "paginate")).toBe("next");
    expect(tapZoneAction("center", "paginate")).toBe("toggle-chrome");
  });

  it("scroll: any zone toggles chrome", () => {
    expect(tapZoneAction("left", "scroll")).toBe("toggle-chrome");
    expect(tapZoneAction("center", "scroll")).toBe("toggle-chrome");
    expect(tapZoneAction("right", "scroll")).toBe("toggle-chrome");
  });
});
