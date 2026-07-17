import { beforeEach, describe, expect, it, vi } from "vitest";

// The CFI tier calls CFI.toRange, which needs a live DOM the node env lacks.
// Mock cfiToRange so the tier's decision logic is deterministic here; the real
// CFI→Range path is exercised via the device gate (same split as scroll-cfi.test).
const { cfiToRangeMock } = vi.hoisted(() => ({ cfiToRangeMock: vi.fn() }));
vi.mock("./scroll-cfi", () => ({ cfiToRange: cfiToRangeMock }));

import { resolveAnchor } from "./anchor-resolver";

// Minimal single-text-node Document that implements exactly the surface
// resolveAnchor touches (createTreeWalker over text nodes + createRange with
// offset capture). jsdom is deliberately NOT a dependency of this project.
function makeDoc(text: string): Document {
  const node = { nodeType: 3, nodeValue: text } as unknown as Text;
  const nodes: Text[] = [node];
  const doc = {
    body: { textContent: text },
    createTreeWalker(_root: unknown, _show: number) {
      let i = -1;
      return { nextNode: () => nodes[++i] ?? null };
    },
    createRange() {
      return {
        startContainer: null as unknown as Node,
        startOffset: 0,
        endContainer: null as unknown as Node,
        endOffset: 0,
        setStart(n: Node, o: number) {
          this.startContainer = n;
          this.startOffset = o;
        },
        setEnd(n: Node, o: number) {
          this.endContainer = n;
          this.endOffset = o;
        },
        getClientRects: () => [{ width: 1, height: 1 }],
        toString() {
          return (
            (this.startContainer as unknown as Text)?.nodeValue ?? ""
          ).slice(this.startOffset, this.endOffset);
        },
      };
    },
  };
  return doc as unknown as Document;
}

describe("resolveAnchor", () => {
  beforeEach(() => cfiToRangeMock.mockReset());

  it("CFI tier: a resolvable CFI returns { range } (no healing)", () => {
    const range = { getClientRects: () => [{ width: 5, height: 5 }] };
    cfiToRangeMock.mockReturnValue(range);
    const r = resolveAnchor(makeDoc("任意内容"), {
      cfi: "epubcfi(/6/4!/4/2:1)",
      text_exact: "内容",
      progress_fraction: 0.3,
    });
    expect(r).toEqual({ range });
  });

  it("healed tier: broken CFI + unique text_exact returns { range, healed:true }", () => {
    cfiToRangeMock.mockReturnValue(null);
    const r = resolveAnchor(makeDoc("序章内容独一无二的段落结尾"), {
      cfi: "epubcfi(/6/4!/999)",
      text_exact: "独一无二",
    });
    expect(r).toMatchObject({ healed: true });
    expect((r as { range: Range }).range.toString()).toBe("独一无二");
  });

  it("disambiguates a repeated excerpt via text_pre / text_post", () => {
    cfiToRangeMock.mockReturnValue(null);
    // 春天苹果好吃夏天苹果好吃 — want the SECOND 苹果 (offset 8).
    const r = resolveAnchor(makeDoc("春天苹果好吃夏天苹果好吃"), {
      text_exact: "苹果",
      text_pre: "夏天",
      text_post: "好吃",
    });
    expect((r as { range: Range }).range.startOffset).toBe(8);
  });

  it("survives a 简繁 toggle: a Traditional needle resolves against Simplified content", () => {
    cfiToRangeMock.mockReturnValue(null);
    const r = resolveAnchor(makeDoc("国际化测试内容"), { text_exact: "國際" });
    expect((r as { healed: true }).healed).toBe(true);
    // Healed range points at the ACTUAL (Simplified) DOM text.
    expect((r as { range: Range }).range.toString()).toBe("国际");
  });

  it("fraction tier: CFI + text both fail but progress_fraction present → { fractionTarget }", () => {
    cfiToRangeMock.mockReturnValue(null);
    const r = resolveAnchor(makeDoc("完全不相关的文本"), {
      cfi: null,
      text_exact: "找不到的词",
      progress_fraction: 0.42,
    });
    expect(r).toEqual({ fractionTarget: 0.42 });
  });

  it("returns null when nothing resolves and no fraction is available", () => {
    cfiToRangeMock.mockReturnValue(null);
    const r = resolveAnchor(makeDoc("文本"), {
      cfi: null,
      text_exact: "缺失",
      progress_fraction: null,
    });
    expect(r).toBeNull();
  });
});
