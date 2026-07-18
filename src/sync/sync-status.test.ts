import { describe, expect, it } from "vitest";
import {
  ariaLabelFor,
  createSyncStatusStore,
  dotFor,
  formatRelativeSyncTime,
  shouldToastFailure,
} from "./sync-status";
import type { SyncStatusEvent, SyncStatusSnapshot } from "./sync-api";

describe("dotFor (UI-SPEC §C four rows)", () => {
  it("未配置 → no dot", () => {
    expect(dotFor({ configured: false, syncing: false, lastError: null })).toBe("none");
  });

  it("空闲 / 上次成功 → no dot", () => {
    expect(dotFor({ configured: true, syncing: false, lastError: null })).toBe("none");
  });

  it("同步中 → syncing", () => {
    expect(dotFor({ configured: true, syncing: true, lastError: null })).toBe("syncing");
  });

  it("失败 → error (sticky until next success)", () => {
    expect(dotFor({ configured: true, syncing: false, lastError: "服务器限流，请稍后重试" })).toBe(
      "error",
    );
  });

  it("unconfigured with a stale error still shows no dot", () => {
    expect(dotFor({ configured: false, syncing: false, lastError: "x" })).toBe("none");
  });
});

describe("ariaLabelFor (verbatim copy)", () => {
  it("idle", () => {
    expect(ariaLabelFor({ lastError: null })).toBe("立即同步");
  });

  it("failure — never color-only", () => {
    expect(ariaLabelFor({ lastError: "连接超时" })).toBe("立即同步，上次同步失败");
  });
});

describe("shouldToastFailure (transition only — no sticky-error spam)", () => {
  it("null → error fires", () => {
    expect(shouldToastFailure({ lastError: null }, { lastError: "e" })).toBe(true);
  });

  it("error → same error does not fire", () => {
    expect(shouldToastFailure({ lastError: "e" }, { lastError: "e" })).toBe(false);
  });

  it("error → different error does not fire (sticky)", () => {
    expect(shouldToastFailure({ lastError: "a" }, { lastError: "b" })).toBe(false);
  });

  it("error → cleared does not fire", () => {
    expect(shouldToastFailure({ lastError: "e" }, { lastError: null })).toBe(false);
  });

  it("cleared → error fires again after success re-armed", () => {
    expect(shouldToastFailure({ lastError: null }, { lastError: "e2" })).toBe(true);
  });
});

describe("formatRelativeSyncTime", () => {
  const now = 1_000_000_000_000;

  it("刚刚 under a minute", () => {
    expect(formatRelativeSyncTime(now - 5_000, now)).toBe("刚刚");
    expect(formatRelativeSyncTime(now, now)).toBe("刚刚");
  });

  it("{n} 分钟前 under an hour", () => {
    expect(formatRelativeSyncTime(now - 60_000, now)).toBe("1 分钟前");
    expect(formatRelativeSyncTime(now - 3 * 60_000, now)).toBe("3 分钟前");
    expect(formatRelativeSyncTime(now - 59 * 60_000, now)).toBe("59 分钟前");
  });

  it("{n} 小时前 under a day", () => {
    expect(formatRelativeSyncTime(now - 60 * 60_000, now)).toBe("1 小时前");
    expect(formatRelativeSyncTime(now - 23 * 60 * 60_000, now)).toBe("23 小时前");
  });

  it("{n} 天前 beyond a day", () => {
    expect(formatRelativeSyncTime(now - 24 * 60 * 60_000, now)).toBe("1 天前");
    expect(formatRelativeSyncTime(now - 3 * 24 * 60 * 60_000, now)).toBe("3 天前");
  });

  it("future timestamps clamp to 刚刚", () => {
    expect(formatRelativeSyncTime(now + 60_000, now)).toBe("刚刚");
  });
});

describe("createSyncStatusStore", () => {
  const snapshot: SyncStatusSnapshot = {
    configured: true,
    serverUrl: "https://dav.example.com",
    username: "u",
    syncing: false,
    lastSyncAt: 1234,
    lastError: null,
  };

  it("initializes from the snapshot with EMPTY transfer arrays", async () => {
    const store = createSyncStatusStore(
      () => Promise.resolve(snapshot),
      () => () => {},
    );
    await Promise.resolve();
    const state = store.getState();
    expect(state.configured).toBe(true);
    expect(state.serverUrl).toBe("https://dav.example.com");
    expect(state.lastSyncAt).toBe(1234);
    expect(state.downloads).toEqual([]);
    expect(state.uploads).toEqual([]);
  });

  it("folds events in and notifies subscribers; serverUrl survives", async () => {
    const capturedBox: { cb?: (e: SyncStatusEvent) => void } = {};
    const store = createSyncStatusStore(
      () => Promise.resolve(snapshot),
      (cb) => {
        capturedBox.cb = cb;
        return () => {};
      },
    );
    await Promise.resolve();
    let notified = 0;
    const un = store.subscribe(() => {
      notified += 1;
    });
    capturedBox.cb?.({
      configured: true,
      syncing: true,
      lastError: null,
      downloads: [{ workId: "w1", percent: 42 }],
      uploads: [],
    });
    const state = store.getState();
    expect(state.syncing).toBe(true);
    expect(state.downloads).toEqual([{ workId: "w1", percent: 42 }]);
    expect(state.serverUrl).toBe("https://dav.example.com");
    expect(notified).toBe(1);
    un();
    capturedBox.cb?.({
      configured: true,
      syncing: false,
      lastError: "e",
      downloads: [],
      uploads: [],
    });
    expect(notified).toBe(1);
    expect(store.getState().lastError).toBe("e");
  });

  it("a failed snapshot load keeps the initial state", async () => {
    const store = createSyncStatusStore(
      () => Promise.reject(new Error("no pool")),
      () => () => {},
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getState().configured).toBe(false);
  });

  it("refresh() re-runs the snapshot load", async () => {
    let current = snapshot;
    const store = createSyncStatusStore(
      () => Promise.resolve(current),
      () => () => {},
    );
    await Promise.resolve();
    current = { ...snapshot, lastSyncAt: 9999 };
    store.refresh();
    await Promise.resolve();
    expect(store.getState().lastSyncAt).toBe(9999);
  });
});
