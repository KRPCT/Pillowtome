import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { dismissUpdate, type UpdateInfo } from "../lib/update";

export interface UpdateDialogProps {
  /** 检出的更新；`null` 时不渲染。 */
  info: UpdateInfo | null;
  open: boolean;
  onClose: () => void;
}

/**
 * 更新内容弹窗（UPD-01）：版本对照 + Release 更新内容 + 三键。
 * - 「立即更新」：系统浏览器打开 Release 页（下载/安装交给系统，APK 与桌面
 *   安装包同页列出）；
 * - 「以后再说」：本次关闭，下次启动仍提醒；
 * - 「忽略此版本」：记住该版本，之后不再自动弹（手动检查更新仍会显示）。
 */
export function UpdateDialog({ info, open, onClose }: UpdateDialogProps) {
  const [opening, setOpening] = useState(false);
  if (!info) return null;

  const handleOpenRelease = async () => {
    setOpening(true);
    try {
      await openUrl(info.url);
      onClose();
    } catch (err) {
      console.warn("[update] 打开下载页失败", err);
    } finally {
      setOpening(false);
    }
  };

  const handleDismiss = () => {
    dismissUpdate(info.version);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>发现新版本 v{info.version}</DialogTitle>
      <DialogContent dividers>
        <DialogContentText sx={{ mb: 1.5 }}>
          当前版本 v{info.current}
          {info.publishedAt
            ? ` · 发布于 ${info.publishedAt.slice(0, 10)}`
            : ""}
        </DialogContentText>
        {info.notes ? (
          <Box
            sx={{
              maxHeight: 320,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              touchAction: "pan-y",
              WebkitOverflowScrolling: "touch",
              bgcolor: "action.hover",
              borderRadius: 1,
              p: 1.5,
            }}
          >
            <Typography variant="body2" component="div" sx={{ whiteSpace: "pre-wrap" }}>
              {info.notes}
            </Typography>
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={handleDismiss}>
          忽略此版本
        </Button>
        <Button color="inherit" onClick={onClose}>
          以后再说
        </Button>
        <Button variant="contained" onClick={() => void handleOpenRelease()} disabled={opening}>
          {opening ? "正在打开…" : "立即更新"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
