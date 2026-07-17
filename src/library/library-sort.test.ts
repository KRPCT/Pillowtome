import { describe, expect, it } from "vitest";
import {
  applyLibraryView,
  filterLibrary,
  readingStatus,
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
