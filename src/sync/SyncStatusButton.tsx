/**
 * 顶栏同步药丸（mockup §02 .sync-pill）：状态点 + 一行文案常驻顶栏右侧。
 * 已配置显示「WebDAV · 已同步 HH:MM」（syncState.lastSyncAt）；未配置
 * 「WebDAV · 未配置」；同步中「同步中…」；失败红点 + 「同步失败」。
 * Failures never open a modal here — the dot + the Snackbar channel carry them
 * (D-93); 未配置点按打开同步设置、已配置点按手动兜底 sync_now (D-90)。
 */

import { ariaLabelFor, dotFor, type SyncViewState } from "./sync-status";

export interface SyncStatusButtonProps {
  state: SyncViewState;
  /** 未配置 → open SyncSettingsSheet; 已配置 → manual sync_now (D-90 兜底). */
  onPress: () => void;
}

/** 「已同步 HH:MM」— 24 小时制、零填充。 */
function formatSyncClock(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function pillText(state: SyncViewState): string {
  if (!state.configured) return "WebDAV · 未配置";
  if (state.syncing) return "同步中…";
  if (state.lastError != null) return "同步失败";
  if (state.lastSyncAt != null) {
    return `WebDAV · 已同步 ${formatSyncClock(state.lastSyncAt)}`;
  }
  return "WebDAV · 已连接";
}

export function SyncStatusButton({ state, onPress }: SyncStatusButtonProps) {
  const dot = dotFor(state);
  return (
    <button
      type="button"
      className="sync-pill"
      data-state={dot}
      data-configured={state.configured || undefined}
      aria-label={`${ariaLabelFor(state)}，${pillText(state)}`}
      aria-busy={state.syncing}
      onClick={() => {
        if (state.syncing) return; // 同步中 tap 忽略 (aria-busy)
        onPress();
      }}
    >
      <i className="sync-pill__dot" aria-hidden />
      <span className="sync-pill__label">{pillText(state)}</span>
    </button>
  );
}

export default SyncStatusButton;
