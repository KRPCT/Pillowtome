import { describe, expect, it } from "vitest";
import { rowToLibraryItem } from "./library-store";

describe("rowToLibraryItem", () => {
  it("maps SQL row to LibraryItem with fallback title", () => {
    const item = rowToLibraryItem({
      item_id: "i1",
      work_id: "w1",
      source_id: "import-abc",
      title: "",
      author: "作者",
      cover_file: "w1.jpg",
      imported_at: 10,
      last_opened_at: 20,
      last_read_at: null,
      progress_fraction: 0.25,
    });
    expect(item.title).toBe("未知书名");
    expect(item.author).toBe("作者");
    expect(item.sourceId).toBe("import-abc");
    expect(item.progressFraction).toBe(0.25);
    expect(item.coverFile).toBe("w1.jpg");
  });

  it("null progress when missing", () => {
    const item = rowToLibraryItem({
      item_id: "i1",
      work_id: "w1",
      source_id: "import-abc",
      title: "书",
      author: null,
      cover_file: null,
      imported_at: 1,
      last_opened_at: null,
      last_read_at: null,
    });
    expect(item.progressFraction).toBeNull();
    expect(item.author).toBeNull();
  });
});
