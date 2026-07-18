import { describe, expect, it } from "vitest";
import { traceFromOpenResult, syncUndoBody, type SyncTrace } from "./sync-jump";
import type { SyncOpenResult } from "../sync/sync-api";

const quiet: SyncOpenResult = {
  jumped: false,
  deviceName: null,
  progressFraction: null,
  replacedLocal: null,
};

describe("traceFromOpenResult", () => {
  it("jumped: false → null (no pill, no toast — silent)", () => {
    expect(traceFromOpenResult(quiet)).toBeNull();
  });

  it("missing replacedLocal → null", () => {
    expect(
      traceFromOpenResult({ ...quiet, jumped: true, progressFraction: 0.5 }),
    ).toBeNull();
  });

  it("missing progressFraction → null", () => {
    expect(
      traceFromOpenResult({
        ...quiet,
        jumped: true,
        replacedLocal: { cfi: "epubcfi(/6/4)", progressFraction: 0.1 },
      }),
    ).toBeNull();
  });

  it("derives device name, rounded percent, and the replaced local row", () => {
    const trace = traceFromOpenResult({
      jumped: true,
      deviceName: "客厅平板",
      progressFraction: 0.626,
      replacedLocal: { cfi: "epubcfi(/6/8)", progressFraction: 0.12 },
    });
    expect(trace).toEqual({
      deviceName: "客厅平板",
      percent: 63,
      replacedLocal: { cfi: "epubcfi(/6/8)", progressFraction: 0.12 },
    });
  });

  it("clamps out-of-range fractions before rounding", () => {
    const over = traceFromOpenResult({
      jumped: true,
      deviceName: "dev",
      progressFraction: 1.4,
      replacedLocal: { cfi: "", progressFraction: 0 },
    });
    expect(over?.percent).toBe(100);
    const under = traceFromOpenResult({
      jumped: true,
      deviceName: "dev",
      progressFraction: -0.2,
      replacedLocal: { cfi: "", progressFraction: 0 },
    });
    expect(under?.percent).toBe(0);
  });

  it("falls back to 另一台设备 when the engine reports no device name", () => {
    const trace = traceFromOpenResult({
      jumped: true,
      deviceName: null,
      progressFraction: 0.5,
      replacedLocal: { cfi: "", progressFraction: 0 },
    });
    expect(trace?.deviceName).toBe("另一台设备");
  });

  it("normalizes an empty cfi to null (UI never jumps on a blank locator)", () => {
    const trace = traceFromOpenResult({
      jumped: true,
      deviceName: "dev",
      progressFraction: 0.5,
      replacedLocal: { cfi: "", progressFraction: 0.2 },
    });
    expect(trace?.replacedLocal.cfi).toBeNull();
  });
});

describe("syncUndoBody (verbatim UI-SPEC copy)", () => {
  it("renders the exact body template", () => {
    const trace: SyncTrace = {
      deviceName: "卧室手机",
      percent: 42,
      replacedLocal: { cfi: null, progressFraction: 0.1 },
    };
    expect(syncUndoBody(trace)).toBe("「卧室手机」上读到了 42%，已自动跳到最远位置。");
  });
});
