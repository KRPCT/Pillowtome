/**
 * Framework-free sync-status store + pure UI mappers (D-93, UI-SPEC §C).
 *
 * State flows from two engine channels: the `sync_status()` snapshot (store
 * init — carries NO transfer arrays, so downloads/uploads start EMPTY) and the
 * unified `"sync-status"` event (the sole progress channel thereafter). The
 * store is dependency-injected so vitest drives it without Tauri; App.tsx
 * injects `syncStatus` from sync-api and `listen` from @tauri-apps/api/event.
 */

import type { SyncStatusEvent, SyncStatusSnapshot } from "./sync-api";

export type { SyncStatusEvent, SyncStatusSnapshot };

/** Unified view state consumed by the button / sheets / cards. */
export interface SyncViewState {
  configured: boolean;
  serverUrl: string | null;
  syncing: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  downloads: Array<{ workId: string; percent: number }>;
  uploads: Array<{ workId: string; percent: number }>;
}

/** §C dot semantics: 未配置/空闲 → none; 同步中 → syncing; 失败 → error (sticky). */
export type SyncDotState = "none" | "syncing" | "error";

export function dotFor(
  state: Pick<SyncViewState, "configured" | "syncing" | "lastError">,
): SyncDotState {
  if (!state.configured) return "none";
  if (state.syncing) return "syncing";
  if (state.lastError != null) return "error";
  return "none";
}

/** Verbatim aria copy — the failure state is never color-only (a11y). */
export function ariaLabelFor(state: Pick<SyncViewState, "lastError">): string {
  return state.lastError != null ? "立即同步，上次同步失败" : "立即同步";
}

/**
 * Toast gate (T-07-04-06): fire only on a TRANSITION into `lastError != null`
 * — a sticky error never re-toasts; success (error cleared) re-arms it.
 */
export function shouldToastFailure(
  prev: Pick<SyncViewState, "lastError">,
  next: Pick<SyncViewState, "lastError">,
): boolean {
  return prev.lastError == null && next.lastError != null;
}

/** 相对时间 buckets: 刚刚 / {n} 分钟前 / {n} 小时前 / {n} 天前. */
export function formatRelativeSyncTime(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

export interface SyncStatusStore {
  getState(): SyncViewState;
  subscribe(cb: () => void): () => void;
  /** Re-run the snapshot load (after connect/disconnect/save). */
  refresh(): void;
}

const INITIAL_STATE: SyncViewState = {
  configured: false,
  serverUrl: null,
  syncing: false,
  lastSyncAt: null,
  lastError: null,
  downloads: [],
  uploads: [],
};

/**
 * Tiny external store: init from the `sync_status()` snapshot (transfer arrays
 * stay EMPTY — the command result has none), then fold every `"sync-status"`
 * event in. Event payloads carry no serverUrl/lastSyncAt — those persist from
 * the snapshot. Errors from either channel leave the previous state intact.
 */
export function createSyncStatusStore(
  load: () => Promise<SyncStatusSnapshot>,
  listen: (cb: (event: SyncStatusEvent) => void) => Promise<unknown> | unknown,
): SyncStatusStore {
  let state: SyncViewState = INITIAL_STATE;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const cb of listeners) cb();
  };

  const reload = () => {
    void load()
      .then((snap) => {
        state = {
          configured: snap.configured,
          serverUrl: snap.serverUrl,
          syncing: snap.syncing,
          lastSyncAt: snap.lastSyncAt,
          lastError: snap.lastError,
          downloads: [],
          uploads: [],
        };
        emit();
      })
      .catch(() => {
        /* store keeps its previous state */
      });
  };
  reload();

  void Promise.resolve(
    listen((event) => {
      state = {
        ...state,
        configured: event.configured,
        syncing: event.syncing,
        lastError: event.lastError,
        downloads: event.downloads,
        uploads: event.uploads,
      };
      emit();
    }),
  ).catch(() => {
    /* listener registration failed — snapshot-only mode */
  });

  return {
    getState: () => state,
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    refresh: reload,
  };
}
