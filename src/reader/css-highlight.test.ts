import { describe, it, expect } from "vitest";
import {
  supportsCssHighlight,
  highlightCssName,
  registerHighlight,
  clearHighlights,
  HIGHLIGHT_CSS,
} from "./css-highlight";

class FakeHighlight {
  ranges: unknown[] = [];
  add(r: unknown) {
    this.ranges.push(r);
  }
}

function makeWin() {
  return {
    Highlight: FakeHighlight as unknown as new (...r: Range[]) => { add(r: Range): void },
    CSS: { highlights: new Map<string, { add(r: Range): void }>() },
  };
}

const range = {} as unknown as Range;

describe("supportsCssHighlight", () => {
  it("is true only when both Highlight and CSS.highlights exist", () => {
    expect(supportsCssHighlight(makeWin())).toBe(true);
    expect(supportsCssHighlight({ CSS: { highlights: new Map() } })).toBe(false);
    expect(supportsCssHighlight({ Highlight: FakeHighlight as never })).toBe(false);
    expect(supportsCssHighlight(undefined)).toBe(false);
    expect(supportsCssHighlight(null)).toBe(false);
  });
});

describe("highlightCssName", () => {
  it("maps type+allowlisted color to a stable pillow-* name", () => {
    expect(highlightCssName("highlight", "cinnabar")).toBe("pillow-hl-cinnabar");
    expect(highlightCssName("underline", "indigo")).toBe("pillow-ul-indigo");
  });

  it("gives distinct names for distinct type/color combos", () => {
    const names = new Set([
      highlightCssName("highlight", "cinnabar"),
      highlightCssName("underline", "cinnabar"),
      highlightCssName("highlight", "green"),
    ]);
    expect(names.size).toBe(3);
  });

  it("refuses colors outside the allowlist and bad types", () => {
    expect(highlightCssName("highlight", "red")).toBeNull();
    expect(highlightCssName("highlight", "url(evil)")).toBeNull();
    expect(highlightCssName("bogus" as never, "cinnabar")).toBeNull();
  });
});

describe("registerHighlight", () => {
  it("creates then reuses the same named Highlight, adding each range", () => {
    const win = makeWin();
    expect(registerHighlight(win, "highlight", "cinnabar", range)).toBe(true);
    const first = win.CSS.highlights.get("pillow-hl-cinnabar");
    expect(registerHighlight(win, "highlight", "cinnabar", range)).toBe(true);
    const second = win.CSS.highlights.get("pillow-hl-cinnabar");
    expect(second).toBe(first); // reused, not replaced
    expect((first as unknown as FakeHighlight).ranges.length).toBe(2);
    expect(win.CSS.highlights.size).toBe(1);
  });

  it("maps distinct type/color to distinct registry entries", () => {
    const win = makeWin();
    registerHighlight(win, "highlight", "cinnabar", range);
    registerHighlight(win, "underline", "cinnabar", range);
    expect(win.CSS.highlights.size).toBe(2);
    expect(win.CSS.highlights.has("pillow-hl-cinnabar")).toBe(true);
    expect(win.CSS.highlights.has("pillow-ul-cinnabar")).toBe(true);
  });

  it("refuses an out-of-allowlist color (no registration)", () => {
    const win = makeWin();
    expect(registerHighlight(win, "highlight", "hotpink", range)).toBe(false);
    expect(win.CSS.highlights.size).toBe(0);
  });

  it("returns false when the window lacks the API", () => {
    expect(registerHighlight({ CSS: { highlights: new Map() } }, "highlight", "cinnabar", range)).toBe(false);
  });
});

describe("clearHighlights", () => {
  it("empties only pillow-hl-/pillow-ul- entries, leaving other highlights", () => {
    const win = makeWin();
    registerHighlight(win, "highlight", "cinnabar", range);
    registerHighlight(win, "underline", "green", range);
    win.CSS.highlights.set("pillow-autospace", new FakeHighlight());
    clearHighlights(win);
    expect(win.CSS.highlights.has("pillow-hl-cinnabar")).toBe(false);
    expect(win.CSS.highlights.has("pillow-ul-green")).toBe(false);
    expect(win.CSS.highlights.has("pillow-autospace")).toBe(true);
  });
});

describe("HIGHLIGHT_CSS", () => {
  it("declares highlight + underline rules for every palette key", () => {
    for (const c of ["cinnabar", "ochre", "green", "indigo"]) {
      expect(HIGHLIGHT_CSS).toContain(`::highlight(pillow-hl-${c})`);
      expect(HIGHLIGHT_CSS).toContain(`::highlight(pillow-ul-${c})`);
      expect(HIGHLIGHT_CSS).toContain(`var(--anno-${c}-fill)`);
    }
  });
});
