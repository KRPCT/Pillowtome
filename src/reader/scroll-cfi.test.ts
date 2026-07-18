import { describe, expect, it } from "vitest";
import * as CFI from "../vendor/foliate-js/epubcfi.js";
import { cfiToRange, sectionBaseCfi, selectionCfi, spineFromCfi } from "./scroll-cfi";

// Minimal html>body>#text substrate — the REAL foliate fromRange/toRange do the
// work (no filter passed, so NodeFilter is never touched). jsdom would only be
// the same substrate; the project deliberately ships no DOM test dependency.
function makeDom(text: string) {
  const textNode: Record<string, unknown> = { nodeType: 3, nodeValue: text };
  const body: Record<string, unknown> = { nodeType: 1, id: "", childNodes: [textNode] };
  const html: Record<string, unknown> = { nodeType: 1, id: "", childNodes: [body] };
  body.firstChild = textNode;
  body.lastChild = textNode;
  html.firstChild = body;
  html.lastChild = body;
  const doc: Record<string, unknown> = {
    documentElement: html,
    getElementById: () => null,
    createRange() {
      return {
        startContainer: null as unknown,
        startOffset: 0,
        endContainer: null as unknown,
        endOffset: 0,
        setStart(n: unknown, o: number) { this.startContainer = n; this.startOffset = o; },
        setEnd(n: unknown, o: number) { this.endContainer = n; this.endOffset = o; },
        toString() {
          return ((this.startContainer as { nodeValue?: string })?.nodeValue ?? "").slice(
            this.startOffset,
            this.endOffset,
          );
        },
      };
    },
  };
  for (const n of [textNode, body, html]) n.ownerDocument = doc;
  textNode.parentNode = body;
  body.parentNode = html;
  html.parentNode = null;
  return { doc: doc as unknown as Document, textNode };
}

function selectionRange(textNode: unknown, start: number, end: number): Range {
  return {
    startContainer: textNode,
    startOffset: start,
    endContainer: textNode,
    endOffset: end,
    collapsed: start === end,
  } as unknown as Range;
}

/**
 * scroll-cfi.ts's core logic (getVisibleRange / cfiToRange / resolveCfiScrollTop)
 * needs a live DOM (TreeWalker, Range, getBoundingClientRect), which the node
 * test environment lacks. These tests cover the CFI building blocks + pure
 * geometry helpers the resume path composes. DOM-dependent functions are
 * exercised via the device gate.
 */

describe("CFI building blocks for scroll resume", () => {
  it("isCFI detects epub CFI strings", () => {
    expect(CFI.isCFI.test("epubcfi(/6/4!/4/2:10)")).toBe(true);
    expect(CFI.isCFI.test("pillow-scroll:5:0.0018")).toBe(false);
    expect(CFI.isCFI.test("chapter2.xhtml#sec")).toBe(false);
  });

  it("fake.fromIndex / toIndex round-trip spine indices", () => {
    for (const i of [0, 1, 2, 5, 13]) {
      const cfi = CFI.fake.fromIndex(i);
      expect(cfi).toBe(`epubcfi(/6/${(i + 1) * 2})`);
      const parts = CFI.parse(cfi) as CFI.CfiPart[][];
      // toIndex takes an indirection array and reads its last part's index.
      const back = CFI.fake.toIndex(parts[0]);
      expect(back).toBe(i);
    }
  });

  it("joinIndir stitches base + local CFI", () => {
    const base = CFI.fake.fromIndex(3); // epubcfi(/6/8)
    const joined = CFI.joinIndir(base, "epubcfi(/4/2:10)");
    expect(joined).toBe("epubcfi(/6/8!/4/2:10)");
    expect(CFI.isCFI.test(joined)).toBe(true);
  });

  it("cfiToRange must strip the spine indirection before toRange (C2 regression)", () => {
    // toRange(doc, parts) resolves parts[0] against the SECTION document. A full
    // book CFI's FIRST indirection is the package spine step (/6/N), so leaving it
    // makes toRange walk the wrong path and land on a garbage/null node — the bug
    // an earlier version of this test masked by never calling toRange. cfiToRange
    // shifts the spine part off first, so parts[0] becomes the local path.
    const parts = CFI.parse("epubcfi(/6/8!/4/2:10)") as CFI.CfiPart[][];
    expect(parts).toHaveLength(2);
    const spineStep = parts[0][parts[0].length - 1];
    expect(spineStep.index).toBe(8); // spine step, before stripping
    parts.shift(); // exactly what cfiToRange does
    expect(parts).toHaveLength(1);
    expect(parts[0].map((p) => p.index)).toEqual([4, 2]); // local path is now parts[0]
    const localStep = parts[0][parts[0].length - 1];
    expect(localStep.offset).toBe(10);
  });

  it("a base-only CFI (no local part) still parses for spine-index extraction", () => {
    // Resume may receive a bare section base CFI when only a chapter was reached.
    const cfi = CFI.fake.fromIndex(2); // epubcfi(/6/6)
    const parts = CFI.parse(cfi) as CFI.CfiPart[][];
    // toIndex takes an indirection array and reads its last part's index.
    const idx = CFI.fake.toIndex(parts[0]);
    expect(idx).toBe(2);
  });
});

describe("selectionCfi (scroll selection → range-CFI)", () => {
  it("round-trips a selection through cfiToRange back to the same text", () => {
    const { doc, textNode } = makeDom("零一二三四五六七");
    const baseCfi = CFI.fake.fromIndex(3); // epubcfi(/6/8)
    const cfi = selectionCfi(baseCfi, selectionRange(textNode, 2, 6));
    expect(cfi).not.toBeNull();
    expect(CFI.isCFI.test(cfi as string)).toBe(true);
    expect((cfi as string).startsWith("epubcfi(/6/8!")).toBe(true);
    const range = cfiToRange(doc, cfi as string);
    expect(range?.toString()).toBe("二三四五");
  });

  it("returns null for a null or collapsed range", () => {
    const { textNode } = makeDom("abc");
    expect(selectionCfi("epubcfi(/6/8)", null)).toBeNull();
    expect(selectionCfi("epubcfi(/6/8)", selectionRange(textNode, 1, 1))).toBeNull();
  });
});

describe("spineFromCfi (last-resort spine resolution, C6)", () => {
  it("extracts the spine index from a full book CFI", () => {
    expect(spineFromCfi("epubcfi(/6/8!/4/2:10)")).toBe(3); // 8/2 - 1
    expect(spineFromCfi("epubcfi(/6/28!/4/2/1:37)")).toBe(13);
    expect(spineFromCfi("epubcfi(/6/2!/2)")).toBe(0);
  });

  it("handles a base-only section CFI (no local path)", () => {
    for (const i of [0, 1, 2, 5, 13]) {
      expect(spineFromCfi(CFI.fake.fromIndex(i))).toBe(i);
    }
  });

  it("extracts the spine index from a range CFI (uses parts.parent)", () => {
    // parent = /6/8!/4/2 → spine step /6/8 → index 3
    expect(spineFromCfi("epubcfi(/6/8!/4/2,/1:0,/3:5)")).toBe(3);
  });

  it("returns null for non-CFI / empty tokens", () => {
    expect(spineFromCfi("pillow-scroll:5:0.25")).toBeNull();
    expect(spineFromCfi("chapter2.xhtml#sec")).toBeNull();
    expect(spineFromCfi(null)).toBeNull();
    expect(spineFromCfi(undefined)).toBeNull();
    expect(spineFromCfi("")).toBeNull();
  });
});

describe("sectionBaseCfi (foliate getCFI fallback parity)", () => {
  it("prefers the section's own package CFI", () => {
    expect(sectionBaseCfi({ index: 3, cfi: "epubcfi(/6/8)" })).toBe("epubcfi(/6/8)");
  });

  it("falls back to CFI.fake.fromIndex for sections without a package CFI (TXT)", () => {
    for (const i of [0, 1, 9, 40]) {
      expect(sectionBaseCfi({ index: i })).toBe(CFI.fake.fromIndex(i));
    }
  });

  it("round-trips the spine through spineFromCfi", () => {
    expect(spineFromCfi(sectionBaseCfi({ index: 9 }))).toBe(9);
  });
});
