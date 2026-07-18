import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared spies so every openDb() shares one execute/select mock (hoisted for vi.mock).
const { execSpy, selectSpy } = vi.hoisted(() => ({
  execSpy: vi.fn(async (_sql: string, _params?: unknown[]) => ({ rowsAffected: 1, lastInsertId: 0 })),
  selectSpy: vi.fn(async (_sql: string, _params?: unknown[]) => [] as unknown[]),
}));

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: vi.fn(async () => ({ execute: execSpy, select: selectSpy })),
  },
}));

import {
  relocateToLocatorRow,
  textContextFromRange,
  textExactFromRange,
  upsertLocator,
} from "./locator-store";

const sqlOf = (calls: unknown[][]) => calls.map((c) => String(c[0]));

beforeEach(() => {
  execSpy.mockClear();
  selectSpy.mockClear();
  execSpy.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 } as never);
  selectSpy.mockResolvedValue([] as never);
});

// jsdom-free helper: build a minimal Range stand-in for textExactFromRange.
function fakeRange(text: string): Range {
  return { toString: () => text } as unknown as Range;
}

// Range spanning `exact` inside a single text node with `pre`/`post` neighbors.
function midRange(pre: string, exact: string, post: string): Range {
  const node = { nodeType: 3, nodeValue: pre + exact + post } as unknown as Text;
  return {
    startContainer: node,
    startOffset: pre.length,
    endContainer: node,
    endOffset: pre.length + exact.length,
    toString: () => exact,
  } as unknown as Range;
}

describe("textExactFromRange", () => {
  it("trims and collapses whitespace, caps length", () => {
    expect(textExactFromRange(fakeRange("  hello   world  "))).toBe(
      "hello world",
    );
  });

  it("caps to 120 chars", () => {
    const long = "x".repeat(200);
    expect(textExactFromRange(fakeRange(long))?.length).toBe(120);
  });

  it("returns null for null range", () => {
    expect(textExactFromRange(null)).toBeNull();
    expect(textExactFromRange(fakeRange("   "))).toBeNull();
  });
});

describe("relocateToLocatorRow", () => {
  it("maps fraction + cfi from a relocate detail", () => {
    const row = relocateToLocatorRow("work-1", {
      fraction: 0.42,
      cfi: "epubcfi(/6/4!/4/2/1:0)",
    });
    expect(row.work_id).toBe("work-1");
    expect(row.cfi).toBe("epubcfi(/6/4!/4/2/1:0)");
    expect(row.progress_fraction).toBeCloseTo(0.42, 5);
  });

  it("clamps fraction to 0..1", () => {
    expect(relocateToLocatorRow("w", { fraction: 5 }).progress_fraction).toBe(1);
    expect(relocateToLocatorRow("w", { fraction: -1 }).progress_fraction).toBe(
      0,
    );
  });

  it("nulls out cfi/fraction when both absent", () => {
    const row = relocateToLocatorRow("w", {
      fraction: undefined,
      cfi: undefined,
    });
    expect(row.cfi).toBeNull();
    expect(row.progress_fraction).toBeNull();
  });

  it("extracts text_exact from the range", () => {
    const row = relocateToLocatorRow("w", {
      fraction: 0.1,
      range: fakeRange("some visible text"),
    });
    expect(row.text_exact).toBe("some visible text");
  });

  it("populates non-null text_pre/text_post for a mid-paragraph range", () => {
    const row = relocateToLocatorRow("w", {
      fraction: 0.1,
      range: midRange("前面的文字", "选中内容", "后面的文字"),
    });
    expect(row.text_pre).toBe("前面的文字");
    expect(row.text_exact).toBe("选中内容");
    expect(row.text_post).toBe("后面的文字");
  });
});

describe("textContextFromRange", () => {
  it("returns null fields when there is no range", () => {
    expect(textContextFromRange(null)).toEqual({
      text_pre: null,
      text_exact: null,
      text_post: null,
    });
  });

  it("caps pre/post to 16 chars each", () => {
    const ctx = textContextFromRange(
      midRange("a".repeat(40), "middle", "b".repeat(40)),
    );
    expect(ctx.text_pre?.length).toBe(16);
    expect(ctx.text_post?.length).toBe(16);
    expect(ctx.text_exact).toBe("middle");
  });

  it("yields empty-string boundaries at the edges of the node", () => {
    const ctx = textContextFromRange(midRange("", "edge", ""));
    expect(ctx.text_pre).toBe("");
    expect(ctx.text_post).toBe("");
  });
});

describe("upsertLocator change_log (SYNC-02)", () => {
  const row = {
    work_id: "w1",
    cfi: "epubcfi(/6/4)",
    progress_fraction: 0.5,
    text_pre: "前文",
    text_exact: "当前句",
    text_post: "后文",
  };

  it("upsert appends one change_log row with entity 'locator' and the atomic clock", async () => {
    await upsertLocator(row);
    const sqls = sqlOf(execSpy.mock.calls);
    expect(sqls.some((s) => /INSERT INTO locator/i.test(s))).toBe(true);
    // Never assert exact call counts — touchLastRead issues extra SQL on the
    // same mocked Database; always filter by SQL content.
    const cl = execSpy.mock.calls.find((c) =>
      /INSERT INTO change_log/i.test(String(c[0])),
    );
    expect(cl).toBeDefined();
    expect(String(cl![0])).toContain("'locator'");
    expect(String(cl![0])).toMatch(/COALESCE\(\(SELECT MAX\(logical_clock\)/i);
  });

  it("payload carries exactly the seven locator keys", async () => {
    await upsertLocator(row);
    const cl = execSpy.mock.calls.find((c) =>
      /INSERT INTO change_log/i.test(String(c[0])),
    )!;
    const binds = cl[1] as unknown[];
    expect(binds[2]).toBe("upsert");
    const payload = JSON.parse(String(binds[3]));
    expect(Object.keys(payload).sort()).toEqual([
      "cfi",
      "progress_fraction",
      "text_exact",
      "text_post",
      "text_pre",
      "updated_at",
      "work_id",
    ]);
    expect(payload.work_id).toBe("w1");
    expect(payload.progress_fraction).toBe(0.5);
  });

  it("empty upsert writes neither locator nor change_log", async () => {
    await upsertLocator({
      work_id: "w1",
      cfi: null,
      progress_fraction: null,
      text_pre: null,
      text_exact: null,
      text_post: null,
    });
    const sqls = sqlOf(execSpy.mock.calls);
    expect(sqls.some((s) => /INSERT INTO locator/i.test(s))).toBe(false);
    expect(sqls.some((s) => /INSERT INTO change_log/i.test(s))).toBe(false);
  });

  it("rethrows on SQL failure (existing contract preserved)", async () => {
    execSpy.mockRejectedValueOnce(new Error("db down") as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(upsertLocator(row)).rejects.toThrow("db down");
    warn.mockRestore();
  });

  it("skips the ledger append (warn, not fatal) when device_id is unavailable", async () => {
    // Fresh module registry so annotation-store's cachedDeviceId is cleared and
    // ensureDevice actually issues its sync_meta SQL.
    vi.resetModules();
    const fresh = await import("./locator-store");
    // First execute = locator INSERT (succeeds); second = ensureDevice's
    // INSERT OR IGNORE INTO sync_meta (rejects → device_id null).
    execSpy.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 } as never);
    execSpy.mockRejectedValueOnce(new Error("sync_meta down") as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(fresh.upsertLocator(row)).resolves.toBeUndefined();
    const sqls = sqlOf(execSpy.mock.calls);
    expect(sqls.some((s) => /INSERT INTO locator/i.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO change_log/i.test(s))).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
