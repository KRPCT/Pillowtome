/**
 * AppBar 同步按钮 + 8px 状态点 (UI-SPEC §1/§C, D-90 manual trigger, D-93).
 * Failures never open a modal here — the dot + the Snackbar channel carry them.
 */

import IconButton from "@mui/material/IconButton";
import { RefreshCw } from "lucide-react";
import { ariaLabelFor, dotFor, type SyncViewState } from "./sync-status";

export interface SyncStatusButtonProps {
  state: SyncViewState;
  /** 未配置 → open SyncSettingsSheet; 已配置 → manual sync_now (D-90 兜底). */
  onPress: () => void;
}

export function SyncStatusButton({ state, onPress }: SyncStatusButtonProps) {
  const dot = dotFor(state);
  return (
    <IconButton
      color="inherit"
      className="sync-status-button"
      aria-label={ariaLabelFor(state)}
      aria-busy={state.syncing}
      sx={state.configured ? undefined : { color: "text.secondary" }}
      onClick={() => {
        if (state.syncing) return; // 同步中 tap 忽略 (aria-busy)
        onPress();
      }}
    >
      <RefreshCw
        size={20}
        className={state.syncing ? "sync-status-button__spin" : undefined}
        aria-hidden
      />
      {dot !== "none" ? (
        <span className="sync-status-button__dot" data-state={dot} aria-hidden />
      ) : null}
    </IconButton>
  );
}

export default SyncStatusButton;
