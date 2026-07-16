import { describe, expect, it } from "vitest";
import {
  knownHashesFromItems,
  summarizeIngest,
  summarizeScan,
} from "./import-pipeline";

describe("summarizeIngest", () => {
  it("imported message includes title", () => {
    expect(
      summarizeIngest({ status: "imported", title: "凉州词" }),
    ).toContain("凉州词");
  });

  it("duplicate uses 书库中已有", () => {
    expect(
      summarizeIngest({
        status: "skipped_duplicate",
        message: "书库中已有",
      }),
    ).toBe("书库中已有");
  });
});

describe("summarizeScan", () => {
  it("aggregates counts", () => {
    const s = summarizeScan({
      imported: 2,
      skippedDuplicate: 1,
      failed: 1,
      messages: [],
    });
    expect(s).toContain("新入库 2");
    expect(s).toContain("已有 1");
    expect(s).toContain("失败 1");
  });

  it("empty scan message", () => {
    expect(
      summarizeScan({
        imported: 0,
        skippedDuplicate: 0,
        failed: 0,
        messages: [],
      }),
    ).toContain("未找到");
  });
});

describe("knownHashesFromItems", () => {
  it("collects work ids", () => {
    const h = knownHashesFromItems([
      { workId: "abc" },
      { workId: "def", contentHash: "def" },
    ]);
    expect(h).toContain("abc");
    expect(h).toContain("def");
  });
});
