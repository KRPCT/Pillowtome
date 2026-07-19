import { describe, expect, it } from "vitest";
import {
  applyLibraryView,
  countByStatus,
  filterLibrary,
  readingStatus,
  searchLibrary,
  sortLibrary,
} from "./library-sort";
import type { LibraryItem } from "./types";

function item(
  partial: Partial<LibraryItem> & Pick<LibraryItem, "itemId" | "title">,
): LibraryItem {
  return {
    workId: partial.workId ?? partial.itemId,
    sourceId: partial.sourceId ?? partial.itemId,
    author: partial.author ?? null,
    coverFile: null,
    importedAt: partial.importedAt ?? 0,
    lastOpenedAt: partial.lastOpenedAt ?? null,
    lastReadAt: partial.lastReadAt ?? null,
    progressFraction: partial.progressFraction ?? null,
    ...partial,
  };
}

describe("readingStatus", () => {
  it("classifies unread/reading/finished", () => {
    expect(readingStatus(null)).toBe("unread");
    expect(readingStatus(0)).toBe("unread");
    expect(readingStatus(0.5)).toBe("reading");
    expect(readingStatus(0.99)).toBe("finished");
  });
});

describe("filterLibrary", () => {
  const items = [
    item({ itemId: "a", title: "A", progressFraction: null }),
    item({ itemId: "b", title: "B", progressFraction: 0.2 }),
    item({ itemId: "c", title: "C", progressFraction: 1 }),
  ];

  it("filters buckets", () => {
    expect(filterLibrary(items, "unread").map((i) => i.itemId)).toEqual(["a"]);
    expect(filterLibrary(items, "reading").map((i) => i.itemId)).toEqual(["b"]);
    expect(filterLibrary(items, "finished").map((i) => i.itemId)).toEqual(["c"]);
    expect(filterLibrary(items, "all")).toHaveLength(3);
  });
});

describe("sortLibrary", () => {
  it("sorts by recent lastReadAt", () => {
    const items = [
      item({ itemId: "old", title: "Old", lastReadAt: 1 }),
      item({ itemId: "new", title: "New", lastReadAt: 9 }),
    ];
    expect(sortLibrary(items, "recent").map((i) => i.itemId)).toEqual([
      "new",
      "old",
    ]);
  });

  it("sorts by title ascii", () => {
    const items = [
      item({ itemId: "2", title: "Zoo" }),
      item({ itemId: "1", title: "Apple" }),
    ];
    expect(sortLibrary(items, "title").map((i) => i.title)).toEqual([
      "Apple",
      "Zoo",
    ]);
  });
});

describe("applyLibraryView", () => {
  it("filters then sorts", () => {
    const items = [
      item({ itemId: "a", title: "A", progressFraction: 0.1, lastReadAt: 1 }),
      item({ itemId: "b", title: "B", progressFraction: 0.2, lastReadAt: 5 }),
      item({ itemId: "c", title: "C", progressFraction: null }),
    ];
    const view = applyLibraryView(items, "reading", "recent");
    expect(view.map((i) => i.itemId)).toEqual(["b", "a"]);
  });
});

describe("searchLibrary", () => {
  const items = [
    item({ itemId: "a", title: "红楼梦", author: "曹雪芹" }),
    item({ itemId: "b", title: "呐喊", author: "鲁迅" }),
    item({ itemId: "c", title: "Dream of Red Mansions", author: "Cao Xueqin" }),
  ];

  it("blank query returns a copy of the full shelf", () => {
    const out = searchLibrary(items, "   ");
    expect(out).toHaveLength(3);
    expect(out).not.toBe(items);
  });

  it("matches title substring case-insensitively", () => {
    expect(searchLibrary(items, "红楼").map((i) => i.itemId)).toEqual(["a"]);
    expect(searchLibrary(items, "dream").map((i) => i.itemId)).toEqual(["c"]);
    expect(searchLibrary(items, "MANSIONS").map((i) => i.itemId)).toEqual(["c"]);
  });

  it("matches author substring and tolerates null authors", () => {
    expect(searchLibrary(items, "鲁迅").map((i) => i.itemId)).toEqual(["b"]);
    expect(searchLibrary(items, "cao").map((i) => i.itemId)).toEqual(["c"]);
    const noAuthor = [item({ itemId: "d", title: "无名氏", author: null })];
    expect(searchLibrary(noAuthor, "鲁")).toHaveLength(0);
  });
});

describe("countByStatus", () => {
  it("counts every bucket over the full shelf", () => {
    const items = [
      item({ itemId: "a", title: "A", progressFraction: null }),
      item({ itemId: "b", title: "B", progressFraction: 0.2 }),
      item({ itemId: "c", title: "C", progressFraction: 1 }),
      item({ itemId: "d", title: "D", progressFraction: 0 }),
    ];
    expect(countByStatus(items)).toEqual({
      all: 4,
      reading: 1,
      unread: 2,
      finished: 1,
    });
  });
});
