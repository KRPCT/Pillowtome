/**
 * 撤回弹窗 (D-92, UI-SPEC §5) — the ONE sync dialog, and it is user-initiated
 * (trace-pill tap), so D-93's "failures never modal" rule is untouched.
 * 撤回原位 replays the locator returned by `sync_revert_jump` (handled by the
 * caller); this dialog only presents the verbatim copy.
 */

import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import { syncUndoBody, type SyncTrace } from "./sync-jump";

export interface SyncUndoDialogProps {
  open: boolean;
  trace: SyncTrace | null;
  /** 撤回原位 — caller runs sync_revert_jump and jumps to its response. */
  onRevert: () => void;
  /** 保留进度 — keep the merged position. */
  onKeep: () => void;
  onClose: () => void;
}

export function SyncUndoDialog({ open, trace, onRevert, onKeep, onClose }: SyncUndoDialogProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>已从其他设备同步</DialogTitle>
      <DialogContent>
        <DialogContentText>{trace ? syncUndoBody(trace) : ""}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onKeep}>
          保留进度
        </Button>
        <Button variant="contained" onClick={onRevert}>
          撤回原位
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default SyncUndoDialog;
