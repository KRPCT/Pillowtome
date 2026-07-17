import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared spies so every openDb() shares one execute/select mock (hoisted for vi.mock).
const { execSpy, selectSpy } = vi.hoisted(() => ({
  execSpy: vi.fn(async () => ({ rowsAffected: 1, lastInsertId: 0 })),
  selectSpy: vi.fn(async () => [] as unknown[]),
}));

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: vi.fn(async () => ({ execute: execSpy, select: selectSpy })),
  },
}));

import {
  annotationContentHash,
  deleteAnnotation,
  listAnnotations,
  upsertAnnotation,
  type AnnotationRow,
} from "./annotation-store";

function sampleRow(overrides: Partial<AnnotationRow> = {}): AnnotationRow {
  return {
    annotation_id: "anno-1",
    work_id: "work-1",
    type: "highlight",
    cfi: "epubcfi(/6/4!/4/2/1:0)",
    color: "cinnabar",
    text_pre: "前文",
    text_exact: "被高亮的句子",
    text_post: "后文",
    progress_fraction: 0.42,
    note: null,
    created_at: 1000,
    updated_at: 1000,
    revision: 1,
    content_hash: null,
    deleted: 0,
    ...overrides,
  };
}

const sqlOf = (calls: unknown[][]) => calls.map((c) => String(c[0]));

beforeEach(() => {
  execSpy.mockClear();
  selectSpy.mockClear();
  execSpy.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 } as never);
  selectSpy.mockResolvedValue([] as never);
});

describe("annotationContentHash", () => {
  it("is stable for identical fields", async () => {
    const f = { type: "highlight", cfi: "c", color: "red", text_exact: "x", note: null, deleted: 0 };
    expect(await annotationContentHash(f)).toBe(await annotationContentHash({ ...f }));
  });

  it("changes when note / color / text_exact change", async () => {
    const base = { type: "highlight", cfi: "c", color: "red", text_exact: "x", note: null, deleted: 0 };
    const h = await annotationContentHash(base);
    expect(await annotationContentHash({ ...base, note: "hi" })).not.toBe(h);
    expect(await annotationContentHash({ ...base, color: "green" })).not.toBe(h);
    expect(await annotationContentHash({ ...base, text_exact: "y" })).not.toBe(h);
  });

  it("ignores updated_at / revision (fixed field set only)", async () => {
    const base = { type: "note", cfi: "c", color: null, text_exact: "x", note: "n", deleted: 0 };
    const withMeta = { ...base, updated_at: 999, revision: 7 } as never;
    expect(await annotationContentHash(withMeta)).toBe(await annotationContentHash(base));
  });

  it("returns lowercase hex sha256 (64 chars)", async () => {
    const hex = await annotationContentHash({ type: "highlight", cfi: "c", color: null, text_exact: "x", note: null, deleted: 0 });
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("upsertAnnotation", () => {
  it("writes the annotation row and appends a change_log upsert row", async () => {
    await upsertAnnotation(sampleRow());
    const sqls = sqlOf(execSpy.mock.calls);
    expect(sqls.some((s) => /INSERT INTO annotation/i.test(s))).toBe(true);
    expect(sqls.some((s) => /ON CONFLICT\(annotation_id\)/i.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO change_log/i.test(s))).toBe(true);
    // clock is computed inside the change_log INSERT (monotonic per device).
    const cl = execSpy.mock.calls.find((c) => /INSERT INTO change_log/i.test(String(c[0])))!;
    expect(String(cl[0])).toMatch(/COALESCE\(\(SELECT MAX\(logical_clock\)/i);
    expect(String(cl[0])).toMatch(/'annotation'/);
    expect((cl[1] as unknown[]).includes("upsert")).toBe(true);
  });

  it("writes annotation before the ledger row", async () => {
    await upsertAnnotation(sampleRow());
    const sqls = sqlOf(execSpy.mock.calls);
    const annoIdx = sqls.findIndex((s) => /INSERT INTO annotation/i.test(s));
    const logIdx = sqls.findIndex((s) => /INSERT INTO change_log/i.test(s));
    expect(annoIdx).toBeGreaterThanOrEqual(0);
    expect(annoIdx).toBeLessThan(logIdx);
  });

  it("soft-fails when SQL throws (no throw, warns)", async () => {
    execSpy.mockRejectedValue(new Error("db down") as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(upsertAnnotation(sampleRow())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("deleteAnnotation", () => {
  it("tombstones (deleted=1) and appends an op='delete' ledger row, never physical DELETE", async () => {
    selectSpy.mockResolvedValue([sampleRow({ deleted: 1 })] as never);
    await deleteAnnotation("anno-1");
    const sqls = sqlOf(execSpy.mock.calls);
    expect(sqls.some((s) => /UPDATE annotation SET[\s\S]*deleted\s*=\s*1/i.test(s))).toBe(true);
    expect(sqls.every((s) => !/DELETE FROM/i.test(s))).toBe(true);
    const cl = execSpy.mock.calls.find((c) => /INSERT INTO change_log/i.test(String(c[0])))!;
    expect((cl[1] as unknown[]).includes("delete")).toBe(true);
  });

  it("soft-fails when SQL throws", async () => {
    execSpy.mockRejectedValue(new Error("db down") as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(deleteAnnotation("anno-1")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("listAnnotations", () => {
  it("selects non-deleted rows for the work, ordered", async () => {
    selectSpy.mockResolvedValue([sampleRow()] as never);
    const rows = await listAnnotations("work-1");
    expect(rows).toHaveLength(1);
    const [sql, params] = selectSpy.mock.calls[0];
    expect(String(sql)).toMatch(/deleted\s*=\s*0/i);
    expect(String(sql)).toMatch(/ORDER BY created_at/i);
    expect((params as unknown[])[0]).toBe("work-1");
  });

  it("returns [] on SQL failure", async () => {
    selectSpy.mockRejectedValue(new Error("db down") as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await listAnnotations("work-1")).toEqual([]);
    warn.mockRestore();
  });
});
