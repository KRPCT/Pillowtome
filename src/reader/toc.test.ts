import { describe, expect, it } from "vitest";
import { flattenToc, type TocItem } from "./toc";

describe("flattenToc", () => {
  it("returns empty for empty input", () => {
    expect(flattenToc([])).toEqual([]);
  });

  it("flattens nested items depth-first with indent depth", () => {
    const items: TocItem[] = [
      {
        label: "章一",
        href: "c1.xhtml",
        subitems: [
          {
            label: "1.1",
            href: "c1.xhtml#s1",
            subitems: [{ label: "1.1.1", href: "c1.xhtml#s1a" }],
          },
          { label: "1.2", href: "c1.xhtml#s2" },
        ],
      },
      { label: "章二", href: "c2.xhtml" },
    ];

    expect(flattenToc(items)).toEqual([
      { label: "章一", href: "c1.xhtml", depth: 0 },
      { label: "1.1", href: "c1.xhtml#s1", depth: 1 },
      { label: "1.1.1", href: "c1.xhtml#s1a", depth: 2 },
      { label: "1.2", href: "c1.xhtml#s2", depth: 1 },
      { label: "章二", href: "c2.xhtml", depth: 0 },
    ]);
  });
});
