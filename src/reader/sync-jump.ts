/**
 * Pure trace-state derivation for the open-book merge jump (D-92, UI-SPEC §5).
 *
 * The engine's `sync_book_opened` result carries the merge byproduct
 * (`replacedLocal` — the exact pre-jump local row); the UI NEVER guesses a
 * position: the trace pill is driven by that byproduct, and the revert jump
 * replays the locator returned by `sync_revert_jump`.
 */

import type { SyncOpenResult } from "../sync/sync-api";

/** A session-scoped "已从其他设备同步" trace. */
export interface SyncTrace {
  deviceName: string;
  percent: number;
  replacedLocal: {
    cfi: string | null;
    progressFraction: number | null;
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Derive the trace from an open result — null unless a real jump happened
 * (`jumped` + a replaced local row + the target fraction). The device name
 * falls back to `另一台设备` when the engine reports none.
 */
export function traceFromOpenResult(res: SyncOpenResult): SyncTrace | null {
  if (!res.jumped || !res.replacedLocal || res.progressFraction == null) {
    return null;
  }
  const deviceName = res.deviceName?.trim() ? res.deviceName.trim() : "另一台设备";
  return {
    deviceName,
    percent: Math.round(clamp01(res.progressFraction) * 100),
    replacedLocal: {
      cfi: res.replacedLocal.cfi ? res.replacedLocal.cfi : null,
      progressFraction: res.replacedLocal.progressFraction ?? null,
    },
  };
}

/** The 撤回弹窗 body — verbatim UI-SPEC copy. */
export function syncUndoBody(t: SyncTrace): string {
  return `「${t.deviceName}」上读到了 ${t.percent}%，已自动跳到最远位置。`;
}
