/**
 * 同步设置 sheet（mockup §07 .sync-layout）— 宽屏左右两栏：左栏表单
 * （服务器/凭据/同步内容/冲突策略/立即同步），右栏「同步状态机」
 * （IDLE→PULL→MERGE→PUSH 节点条）+ 最近同步日志；窄屏回退单栏。
 * MUI Drawer 容器保留 touch-gate #3 结构（header shrink-0，body
 * flex-1 min-h-0 overflow-y-auto + touch-action pan-y）。
 *
 * Password containment (RESEARCH Pattern 4 / T-07-04-01): the password lives
 * only in this field's local state — it flows IN to `sync_test_and_save` and
 * is never written into any other state, never logged, never toasted, never
 * echoed back. Backend test failures arrive as the classified D-97 string and
 * are rendered VERBATIM (never re-mapped here).
 *
 * 诚实性约束：同步内容/冲突策略为引擎内置行为的静态说明（不可开关）；
 * 状态机仅有引擎暴露的 syncing 二值 —— 空闲时 IDLE 墨底，同步中
 * PULL/MERGE/PUSH 三段同时点亮表示管线在飞；日志只渲染 syncState 真实
 * 字段（lastSyncAt / lastError / 实时传输计数），不编造持久假数据。
 */

import { useEffect, useState } from "react";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Drawer from "@mui/material/Drawer";
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

function cleanErr(err: unknown): string {
  return String(err ?? "")
    .replace(/^Error:\s*/i, "")
    .trim();
}

/** 「HH:MM:SS」— 同步日志时间戳（等宽）。 */
function formatLogClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** mockup §07 .sw — 36×21 全圆角开关（开启朱砂底）。 */
function Sw({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={checked ? "sw on" : "sw"}
      onClick={() => onChange(!checked)}
    />
  );
}

interface LogRow {
  tm: string;
  cls: "ok" | "mr" | "wr";
  tag: string;
  text: string;
}

/** 由 syncState 真实字段推导 1–3 行日志（不编造持久记录）。 */
function deriveLogRows(state: SyncViewState): LogRow[] {
  const rows: LogRow[] = [];
  if (state.syncing) {
    const dl = state.downloads.length;
    const ul = state.uploads.length;
    rows.push({
      tm: "实时",
      cls: "mr",
      tag: "进行",
      text:
        dl + ul > 0
          ? `传输进行中 · 下载 ${dl} 项 · 上传 ${ul} 项`
          : "同步进行中…",
    });
  }
  if (state.lastError != null) {
    rows.push({ tm: "—", cls: "wr", tag: "失败", text: state.lastError });
  }
  if (state.lastSyncAt != null) {
    rows.push({
      tm: formatLogClock(state.lastSyncAt),
      cls: "ok",
      tag: "完成",
      text: `上次同步完成（${formatRelativeSyncTime(state.lastSyncAt, Date.now())}）`,
    });
  }
  if (rows.length === 0) {
    rows.push({
      tm: "—",
      cls: "wr",
      tag: "提示",
      text: state.configured ? "尚未同步，点按「立即同步」发起首次同步" : "未配置同步",
    });
  }
  return rows.slice(0, 3);
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

  const syncing = syncingNow || syncState.syncing;
  const logRows = deriveLogRows(syncState);

  return (
    <>
      <Drawer
        anchor="bottom"
        open={open}
        onClose={() => onOpenChange(false)}
        slotProps={{
          paper: {
            className: "sync-sheet__paper",
          },
        }}
      >
        {/* Touch gate #3: header never scrolls away… */}
        <div className="sync-sheet__header">
          <span className="sync-sheet__grip" aria-hidden />
          <h3 className="sync-sheet__title">同步设置</h3>
        </div>
        {/* …the body scrolls by finger (pan-y) to reach 测试并保存. */}
        <div className="sync-sheet__body">
          <div className="sync-layout">
            {/* ============ 左栏：连接表单 ============ */}
            <div className="sync-form">
              <h4>连接自托管书库</h4>
              <p className="sub">你的书与批注只去你想让它们去的地方。</p>

              <div className="field">
                <label htmlFor="sync-server-url">WEBDAV 服务器地址</label>
                <input
                  id="sync-server-url"
                  className="in"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="https://dav.jianguoyun.com/dav"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                />
              </div>

              <div className="field">
                <label htmlFor="sync-username">用户名</label>
                <input
                  id="sync-username"
                  className="in"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoCapitalize="off"
                  autoCorrect="off"
                />
              </div>

              <div className="field">
                <label htmlFor="sync-password">应用密码</label>
                <input
                  id="sync-password"
                  className="in"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                />
                <div className="hint">
                  {configured
                    ? "凭据已保存在系统密钥环，永不同步"
                    : "建议使用应用密码，不要使用账户主密码"}
                </div>
              </div>

              <div className="field">
                <label htmlFor="sync-remote-path">远端路径</label>
                <input
                  id="sync-remote-path"
                  className="in"
                  value={remotePath}
                  onChange={(e) => setRemotePath(e.target.value)}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                />
                <div className="hint">多台设备必须填写相同路径</div>
              </div>

              <div className="field">
                <label htmlFor="sync-device-name">设备名称</label>
                <input
                  id="sync-device-name"
                  className="in"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                />
                <div className="hint">同步提示里显示的本机名字</div>
              </div>

              <div className="field">
                <label>安全</label>
                <div className="switch-row">
                  <span className="lbl">允许 HTTP（明文，仅局域网）</span>
                  <Sw checked={allowHttp} onChange={setAllowHttp} label="允许 HTTP" />
                </div>
                {allowHttp ? (
                  <div className="hint hint--warn" role="note">
                    明文 HTTP 会暴露你的凭据，请仅在可信局域网内使用
                  </div>
                ) : null}
                <div className="switch-row">
                  <span className="lbl">信任自签名证书</span>
                  <Sw
                    checked={trustSelfSigned}
                    onChange={setTrustSelfSigned}
                    label="信任自签名证书"
                  />
                </div>
                {trustSelfSigned ? (
                  <div className="hint hint--warn" role="note">
                    仅在确认证书来自你自己的服务器时开启
                  </div>
                ) : null}
              </div>

              {/* 引擎内置行为（SYNC-01..05）：进度/批注始终同步，书库文件按书
                  opt-in —— 静态说明行，不可开关，不伪造交互。 */}
              <div className="field">
                <label>同步内容</label>
                <div className="check-row">
                  <span className="cb on" aria-hidden>✓</span>阅读进度
                  <span className="sz">始终同步 · 极小</span>
                </div>
                <div className="check-row">
                  <span className="cb on" aria-hidden>✓</span>高亮 / 笔记 / 书签
                  <span className="sz">始终同步</span>
                </div>
                <div className="check-row">
                  <span className="cb on" aria-hidden>✓</span>书库文件
                  <span className="sz">按书选择 · 长按书卡开启</span>
                </div>
              </div>

              <div className="field">
                <label>冲突策略（引擎内置，极少触发）</label>
                <div className="radio-row">
                  <span className="radio-pill on">进度取最远</span>
                  <span className="radio-pill on">批注全保留（OR-Set）</span>
                  <span className="radio-pill on">文件冲突保留双份</span>
                </div>
              </div>

              <div className="sync-form__actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={testing || !keyringAvailable}
                  onClick={() => void handleTestAndSave()}
                >
                  {testing ? "正在测试连接…" : "测试并保存"}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => onOpenChange(false)}
                >
                  取消
                </button>
              </div>
              {!keyringAvailable ? (
                <p className="sync-form__notice sync-form__notice--error">
                  系统密钥环不可用，无法保存凭据
                </p>
              ) : null}
              {testResult ? (
                <p
                  className={
                    testResult.ok
                      ? "sync-form__notice"
                      : "sync-form__notice sync-form__notice--error"
                  }
                  role="status"
                >
                  {testResult.message}
                </p>
              ) : null}

              {configured ? (
                <div className="sync-form__actions">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={syncing}
                    onClick={() => void handleSyncNow()}
                  >
                    {syncing ? "同步中…" : "立即同步"}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-ghost--danger"
                    onClick={() => setDisconnectOpen(true)}
                  >
                    断开连接
                  </button>
                </div>
              ) : null}
            </div>

            {/* ============ 右栏：状态机 + 日志 ============ */}
            <div className="sync-state">
              <h4>同步状态机</h4>
              {/* 引擎仅暴露 syncing 二值：空闲 → IDLE 墨底；同步中 →
                  PULL/MERGE/PUSH 三段同亮表示管线在飞（不定相伪造）。 */}
              <div className="state-flow" data-syncing={syncState.syncing || undefined}>
                <div className={!syncState.syncing && syncState.configured ? "state-node on" : "state-node"}>
                  空闲<span className="d">IDLE</span>
                </div>
                <div className={syncState.syncing ? "state-node on" : "state-node"}>
                  拉取变更<span className="d">PULL</span>
                </div>
                <div className={syncState.syncing ? "state-node on" : "state-node"}>
                  合并<span className="d">MERGE</span>
                </div>
                <div className={syncState.syncing ? "state-node on" : "state-node"}>
                  推送<span className="d">PUSH</span>
                </div>
              </div>

              <div className="sync-state__meta">
                {syncState.serverUrl ? <span>服务器 {syncState.serverUrl}</span> : null}
                {syncState.lastSyncAt != null ? (
                  <span>
                    上次同步 {formatRelativeSyncTime(syncState.lastSyncAt, Date.now())}
                  </span>
                ) : null}
              </div>

              <div className="sync-log">
                <div className="lh">最近同步日志</div>
                {logRows.map((row, i) => (
                  <div className="li" key={`${row.tm}-${i}`}>
                    <span className="tm">{row.tm}</span>
                    <span className={row.cls}>{row.tag}</span>
                    <span>{row.text}</span>
                  </div>
                ))}
              </div>

              <p className="sync-state__note">
                Android 端遵循 Doze 调度：后台与关闭时各同步一次；任何合并都不静默丢数据——冲突永远非破坏式解决。
              </p>
            </div>
          </div>
        </div>
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
