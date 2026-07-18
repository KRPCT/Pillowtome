/**
 * 同步设置 sheet (SYNC-01, UI-SPEC §2, D-95/D-96/D-97/D-104) — MUI Drawer
 * sibling of SettingsSheet with the touch-gate #3 structure (header shrink-0,
 * body flex-1 min-h-0 overflow-y-auto, touch-action pan-y) so 测试并保存 is
 * reachable by vertical finger swipe on the AVD.
 *
 * Password containment (RESEARCH Pattern 4 / T-07-04-01): the password lives
 * only in this field's local state — it flows IN to `sync_test_and_save` and
 * is never written into any other state, never logged, never toasted, never
 * echoed back. Backend test failures arrive as the classified D-97 string and
 * are rendered VERBATIM (never re-mapped here).
 */

import { useEffect, useState, type ReactNode } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import FormControlLabel from "@mui/material/FormControlLabel";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  syncDisconnect,
  syncGetConfig,
  syncNow,
  syncTestAndSave,
} from "./sync-api";
import { copyForTestClass, normalizeRemotePath, validateServerUrl } from "./sync-form";
import { formatRelativeSyncTime, type SyncViewState } from "./sync-status";

export interface SyncSettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Live engine view (status rows) from the app-level store. */
  syncState: SyncViewState;
  /** Re-initialize the app store after connect/save/disconnect. */
  onConfigChanged: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography
        variant="subtitle2"
        sx={{ color: "text.secondary", mb: 1.25, letterSpacing: "0.02em" }}
      >
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function cleanErr(err: unknown): string {
  return String(err ?? "")
    .replace(/^Error:\s*/i, "")
    .trim();
}

export function SyncSettingsSheet({
  open,
  onOpenChange,
  syncState,
  onConfigChanged,
}: SyncSettingsSheetProps) {
  const [serverUrl, setServerUrl] = useState("");
  const [username, setUsername] = useState("");
  // INBOUND-ONLY: never copied elsewhere, never logged, never toasted.
  const [password, setPassword] = useState("");
  const [remotePath, setRemotePath] = useState("pillowtome/");
  const [allowHttp, setAllowHttp] = useState(false);
  const [trustSelfSigned, setTrustSelfSigned] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [configured, setConfigured] = useState(false);
  const [keyringAvailable, setKeyringAvailable] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);

  // Prefill on open. The password field is ALWAYS empty on reopen (keychain
  // is the only store); the 凭据已保存在系统密钥环 caption tells the user why.
  useEffect(() => {
    if (!open) return;
    setTestResult(null);
    setPassword("");
    let cancelled = false;
    void syncGetConfig()
      .then((cfg) => {
        if (cancelled) return;
        setConfigured(cfg.configured);
        setKeyringAvailable(cfg.keyringAvailable);
        setServerUrl(cfg.serverUrl ?? "");
        setUsername(cfg.username ?? "");
        setRemotePath(cfg.remotePath || "pillowtome/");
        setAllowHttp(cfg.allowHttp);
        setTrustSelfSigned(cfg.trustSelfSigned);
        setDeviceName(cfg.deviceName ?? "");
      })
      .catch(() => {
        if (!cancelled) {
          setConfigured(false);
          setKeyringAvailable(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleTestAndSave = async () => {
    setTestResult(null);
    const cls = validateServerUrl(serverUrl);
    if (cls) {
      // Client-side validation copy — the only class the frontend owns.
      setTestResult({ ok: false, message: copyForTestClass(cls) });
      return;
    }
    setTesting(true);
    try {
      await syncTestAndSave({
        serverUrl: serverUrl.trim(),
        username: username.trim(),
        password,
        remotePath: normalizeRemotePath(remotePath),
        allowHttp,
        trustSelfSigned,
        deviceName: deviceName.trim() || undefined,
      });
      setTestResult({ ok: true, message: "连接成功，已保存" });
      setConfigured(true);
      setPassword("");
      onConfigChanged();
    } catch (err) {
      // The engine's Err(String) IS the classified D-97 copy — render verbatim.
      setTestResult({ ok: false, message: cleanErr(err) });
    } finally {
      setTesting(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncingNow(true);
    try {
      await syncNow();
    } catch {
      /* failure surfaces via the status store → dot + toast */
    } finally {
      setSyncingNow(false);
      onConfigChanged();
    }
  };

  const handleDisconnect = async () => {
    setDisconnectOpen(false);
    try {
      await syncDisconnect();
    } catch {
      /* best-effort — the sheet closes and the store re-reads the truth */
    }
    onConfigChanged();
    onOpenChange(false);
  };

  const statusRows: Array<{ primary: string; secondary?: string }> = [];
  if (syncState.serverUrl) {
    statusRows.push({ primary: `服务器 ${syncState.serverUrl}` });
  }
  if (syncState.lastSyncAt != null) {
    statusRows.push({
      primary: `上次同步 ${formatRelativeSyncTime(syncState.lastSyncAt, Date.now())}`,
    });
  }
  statusRows.push({
    primary: syncState.lastError ? `同步失败：${syncState.lastError}` : "正常",
  });

  return (
    <>
      <Drawer
        anchor="bottom"
        open={open}
        onClose={() => onOpenChange(false)}
        slotProps={{
          paper: {
            sx: {
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              maxHeight: "min(85vh, 720px)",
              display: "flex",
              flexDirection: "column",
            },
          },
        }}
      >
        {/* Touch gate #3: header never scrolls away… */}
        <Box sx={{ flexShrink: 0, px: 3, pt: 2 }}>
          {/* MD3 drag handle */}
          <Box
            sx={{
              width: 32,
              height: 4,
              borderRadius: 999,
              bgcolor: "text.secondary",
              opacity: 0.35,
              mx: "auto",
              mb: 2,
            }}
          />
          <Typography variant="h6" sx={{ mb: 2 }}>
            同步设置
          </Typography>
        </Box>
        {/* …the body scrolls by finger (pan-y) to reach 测试并保存. */}
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            touchAction: "pan-y",
            WebkitOverflowScrolling: "touch",
            px: 3,
            pb: 4,
          }}
        >
          <Section title="服务器">
            <Stack spacing={2}>
              <TextField
                label="服务器地址"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://dav.jianguoyun.com/dav"
                fullWidth
                size="small"
              />
              <TextField
                label="用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                fullWidth
                size="small"
              />
              <TextField
                label="应用密码"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                helperText="建议使用应用密码，不要使用账户主密码"
                fullWidth
                size="small"
                autoComplete="off"
              />
              {configured ? (
                <Typography variant="caption" color="text.secondary">
                  凭据已保存在系统密钥环
                </Typography>
              ) : null}
            </Stack>
          </Section>

          <Divider sx={{ mb: 3 }} />

          <Section title="安全">
            <Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={allowHttp}
                    onChange={(_, checked) => setAllowHttp(checked)}
                  />
                }
                label="允许 HTTP（明文，仅局域网）"
              />
              {allowHttp ? (
                <Typography variant="caption" color="error" role="note" sx={{ display: "block" }}>
                  明文 HTTP 会暴露你的凭据，请仅在可信局域网内使用
                </Typography>
              ) : null}
            </Box>
            <Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={trustSelfSigned}
                    onChange={(_, checked) => setTrustSelfSigned(checked)}
                  />
                }
                label="信任自签名证书"
              />
              {trustSelfSigned ? (
                <Typography variant="caption" color="error" role="note" sx={{ display: "block" }}>
                  仅在确认证书来自你自己的服务器时开启
                </Typography>
              ) : null}
            </Box>
          </Section>

          <Divider sx={{ mb: 3 }} />

          <Section title="远端路径">
            <TextField
              label="远端路径"
              value={remotePath}
              onChange={(e) => setRemotePath(e.target.value)}
              helperText="多台设备必须填写相同路径"
              fullWidth
              size="small"
            />
          </Section>

          <Section title="设备名称">
            <TextField
              label="设备名称"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              helperText="同步提示里显示的本机名字"
              fullWidth
              size="small"
            />
          </Section>

          <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", mb: 1 }}>
            <Button
              variant="contained"
              disabled={testing || !keyringAvailable}
              onClick={() => void handleTestAndSave()}
            >
              {testing ? "正在测试连接…" : "测试并保存"}
            </Button>
            <Button color="inherit" onClick={() => onOpenChange(false)}>
              取消
            </Button>
          </Box>
          {!keyringAvailable ? (
            <Typography variant="caption" color="error" sx={{ display: "block", mb: 2 }}>
              系统密钥环不可用，无法保存凭据
            </Typography>
          ) : null}
          {testResult ? (
            <Typography
              variant="caption"
              color={testResult.ok ? "text.secondary" : "error"}
              role="status"
              sx={{ display: "block", mb: 2 }}
            >
              {testResult.message}
            </Typography>
          ) : null}

          {configured ? (
            <>
              <Divider sx={{ mb: 3 }} />
              <Section title="同步状态">
                <List disablePadding>
                  {statusRows.map((row) => (
                    <ListItemText
                      key={row.primary}
                      primary={row.primary}
                      slotProps={{
                        primary: {
                          variant: "body2",
                          noWrap: true,
                          color: row.primary.startsWith("同步失败") ? "error" : "text.primary",
                        },
                      }}
                      sx={{ mb: 0.5 }}
                    />
                  ))}
                </List>
                <Button
                  size="small"
                  disabled={syncingNow || syncState.syncing}
                  onClick={() => void handleSyncNow()}
                  sx={{ mt: 1 }}
                >
                  立即同步
                </Button>
              </Section>

              <Divider sx={{ mb: 3 }} />
              <List disablePadding>
                <ListItemButton
                  onClick={() => setDisconnectOpen(true)}
                  sx={{ borderRadius: 2, minHeight: 44 }}
                >
                  <ListItemText
                    primary="断开连接"
                    slotProps={{ primary: { color: "error" } }}
                  />
                </ListItemButton>
              </List>
            </>
          ) : null}
        </Box>
      </Drawer>

      {/* User-initiated confirm — the only other sync dialog (D-93 untouched). */}
      <Dialog open={disconnectOpen} onClose={() => setDisconnectOpen(false)}>
        <DialogTitle>断开同步连接</DialogTitle>
        <DialogContent>
          <DialogContentText>
            仅移除本机的服务器配置与凭据。服务器上的数据保留，其他设备不受影响。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setDisconnectOpen(false)}>
            取消
          </Button>
          <Button color="error" onClick={() => void handleDisconnect()}>
            断开
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default SyncSettingsSheet;
