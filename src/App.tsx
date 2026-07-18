import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { BookOpen, Settings2 } from "lucide-react";
import { ThemeProvider } from "@mui/material/styles";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import "./App.css";
import { getMuiTheme } from "./theme/mui";
import { FoliateView } from "./reader/FoliateView";
import { LibraryGrid, type SyncCardViewMaps } from "./library/LibraryGrid";
import { ImportButton } from "./library/ImportButton";
import { FolderScanButton } from "./library/FolderScanButton";
import {
  adoptSyncedFile,
  deleteLibraryItem,
  listLibraryItems,
  touchLastOpened,
} from "./library/library-store";
import { ingestPathToLibrary } from "./library/import-actions";
import { knownHashesFromItems } from "./library/import-pipeline";
import type { LibraryItem } from "./library/types";
import {
  LibrarySettingsSheet,
  useLibraryPrefs,
} from "./library/LibrarySettingsSheet";
import {
  syncDownloadBook,
  syncNow,
  syncSetFileSync,
  syncStatus,
  type SyncStatusEvent,
} from "./sync/sync-api";
import {
  createSyncStatusStore,
  shouldToastFailure,
  type SyncStatusStore,
} from "./sync/sync-status";
import { SyncStatusButton } from "./sync/SyncStatusButton";
import { SyncSettingsSheet } from "./sync/SyncSettingsSheet";

/**
 * 书库为主壳：纸感主题与阅读页对齐；直接进入网格 + 设置菜单。
 * Phase 7: AppBar 同步按钮（状态点 + D-90 手动兜底）、同步设置 sheet、
 * 云端占位卡下载流 — failures surface ONLY as dot + this Snackbar (D-93).
 */
function App() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [shelf, setShelf] = useState<LibraryItem[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncSettingsOpen, setSyncSettingsOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LibraryItem | null>(null);
  /** workIds whose last download attempt rejected — the §3 failed card state. */
  const [failedDownloads, setFailedDownloads] = useState<ReadonlySet<string>>(new Set());
  const openIdRef = useRef<string | null>(null);
  openIdRef.current = openId;

  const readerBackRef = useRef<(() => boolean) | null>(null);
  const { prefs, onPrefsChange } = useLibraryPrefs();
  const theme = prefs.theme ?? "day";
  const muiTheme = getMuiTheme(theme);

  // The engine-driven sync status store: snapshot init + "sync-status" events.
  // No timers, no polling anywhere (D-91).
  const syncStoreRef = useRef<SyncStatusStore | null>(null);
  if (syncStoreRef.current === null) {
    syncStoreRef.current = createSyncStatusStore(syncStatus, (cb) =>
      listen<SyncStatusEvent>("sync-status", (e) => cb(e.payload)),
    );
  }
  const syncStore = syncStoreRef.current;
  const syncState = useSyncExternalStore(syncStore.subscribe, syncStore.getState);

  const refreshShelf = useCallback(async () => {
    try {
      setShelf(await listLibraryItems());
    } catch (err) {
      console.error("[App] 获取书库失败", err);
      setStatus("无法加载书库，请重启应用后再试。");
    }
  }, []);

  // The ONLY failure surface (D-93): toast once on a transition INTO error —
  // engine-classified Chinese copy rendered verbatim, never a modal.
  const prevSyncRef = useRef(syncState);
  useEffect(() => {
    const prev = prevSyncRef.current;
    prevSyncRef.current = syncState;
    if (shouldToastFailure(prev, syncState)) {
      setStatus(`同步失败：${syncState.lastError ?? ""}`);
    }
  }, [syncState]);

  const confirmDelete = useCallback(async () => {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    try {
      await deleteLibraryItem(target.workId);
      setStatus(`已删除《${target.title}》`);
    } catch (err) {
      console.error("[App] 删除失败", err);
      setStatus("删除失败，请重试。");
    }
    void refreshShelf();
  }, [pendingDelete, refreshShelf]);

  useEffect(() => {
    void refreshShelf();
  }, [refreshShelf]);

  const closeReader = useCallback(() => {
    setOpenId(null);
    void refreshShelf();
  }, [refreshShelf]);

  const registerReaderBack = useCallback((handler: (() => boolean) | null) => {
    readerBackRef.current = handler;
  }, []);

  const openItem = useCallback((item: LibraryItem) => {
    setOpenId(item.sourceId);
    void touchLastOpened(item.workId);
  }, []);

  // D-90 兜底: unconfigured tap converges on the sheet; configured tap syncs.
  const handleSyncPress = useCallback(() => {
    if (!syncState.configured) {
      setSyncSettingsOpen(true);
      return;
    }
    void syncNow()
      .then((snap) => {
        // The engine records failures itself (dot + toast carry them); only a
        // clean run earns the 同步完成 toast + shelf refresh (merged catalog).
        if (!snap.lastError) {
          setStatus("同步完成");
          void refreshShelf();
        }
      })
      .catch(() => {
        /* failure surfaces via the sync-status event → toast */
      });
  }, [syncState.configured, refreshShelf]);

  // 占位卡点击下载 (D-99/D-100): download → reparse (ingest) → ADOPT the
  // placeholder row (the explicit UPDATE ingest alone can never do) → refresh.
  const handleDownload = useCallback(
    async (item: LibraryItem) => {
      setFailedDownloads((prev) => {
        if (!prev.has(item.workId)) return prev;
        const next = new Set(prev);
        next.delete(item.workId);
        return next;
      });
      try {
        const res = await syncDownloadBook({ workId: item.workId });
        // Exclude THIS work or library_ingest dedup-refuses the reparse.
        const known = knownHashesFromItems(shelf).filter((h) => h !== item.workId);
        const ingest = await ingestPathToLibrary(res.localPath, known);
        await adoptSyncedFile(item.workId, res.sourceId, ingest.coverFile ?? null);
        void refreshShelf();
      } catch (err) {
        console.warn("[sync] download failed", err);
        setFailedDownloads((prev) => new Set(prev).add(item.workId));
        setStatus("下载失败，请检查网络后重试");
      }
    },
    [shelf, refreshShelf],
  );

  // 同步此书 (D-98): flip the flag, then let sync_now's upload pump push the
  // file (07-04 backend wiring) — the toast confirms the flag, not the upload.
  const handleToggleFileSync = useCallback(
    async (item: LibraryItem, enabled: boolean) => {
      try {
        await syncSetFileSync({ workId: item.workId, enabled });
        setStatus(enabled ? `已开启同步《${item.title}》` : `已关闭同步《${item.title}》`);
        if (enabled) {
          void syncNow().catch(() => {
            /* upload failure surfaces via the status store */
          });
        }
        void refreshShelf();
      } catch (err) {
        console.warn("[sync] toggle file sync failed", err);
        setStatus(String(err).replace(/^Error:\s*/i, "") || "同步失败，请稍后重试");
      }
    },
    [refreshShelf],
  );

  const syncView = useMemo<SyncCardViewMaps>(
    () => ({
      downloads: new Map(syncState.downloads.map((d) => [d.workId, d.percent])),
      uploads: new Map(syncState.uploads.map((u) => [u.workId, u.percent])),
      failedDownloads,
    }),
    [syncState.downloads, syncState.uploads, failedDownloads],
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onBackButtonPress(() => {
      if (syncSettingsOpen) {
        setSyncSettingsOpen(false);
        return;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
        return;
      }
      if (readerBackRef.current) {
        const consumed = readerBackRef.current();
        if (consumed) return;
      }
      if (openIdRef.current != null) {
        setOpenId(null);
        return;
      }
    })
      .then((listener) => {
        unlisten = () => {
          void listener.unregister();
        };
      })
      .catch(() => {
        /* desktop */
      });
    return () => {
      unlisten?.();
    };
  }, [settingsOpen, syncSettingsOpen]);

  if (openId) {
    return (
      <FoliateView
        key={openId}
        id={openId}
        onClose={closeReader}
        registerBackHandler={registerReaderBack}
      />
    );
  }

  return (
    <ThemeProvider theme={muiTheme}>
      <div className="library-shell reader" data-theme={theme}>
        <AppBar position="static" color="transparent" elevation={0}>
          <Toolbar sx={{ gap: 1, borderBottom: 1, borderColor: "divider" }}>
            <BookOpen className="library-chrome__icon" aria-hidden />
            <Box sx={{ minWidth: 0, mr: "auto" }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                枕籍
              </Typography>
              <Typography variant="caption" color="text.secondary">
                本地书库
              </Typography>
            </Box>
            <Button color="inherit" size="small" onClick={() => setOpenId("sample")}>
              示例
            </Button>
            <ImportButton
              variant="toolbar"
              onStatus={setStatus}
              onImported={(b) => {
                setOpenId(b.id);
                void refreshShelf();
              }}
              onDone={() => void refreshShelf()}
            />
            <FolderScanButton
              variant="toolbar"
              onStatus={setStatus}
              onDone={() => void refreshShelf()}
            />
            <SyncStatusButton state={syncState} onPress={handleSyncPress} />
            <IconButton
              color="inherit"
              aria-label="设置"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={20} />
            </IconButton>
          </Toolbar>
        </AppBar>

        <div className="library-shell__body">
          <Box sx={{ pt: 1 }}>
            <LibraryGrid
              items={shelf}
              onOpen={openItem}
              onRefresh={() => void refreshShelf()}
              onImportedOpen={(sourceId) => {
                setOpenId(sourceId);
                void refreshShelf();
              }}
              onDelete={setPendingDelete}
              cleanTitles={prefs.cleanTitles}
              chromeHasActions
              syncView={syncView}
              onDownload={(item) => void handleDownload(item)}
              onToggleFileSync={(item, enabled) => void handleToggleFileSync(item, enabled)}
              onStatus={setStatus}
            />
          </Box>
        </div>

        <Snackbar
          open={status !== null}
          autoHideDuration={4000}
          onClose={() => setStatus(null)}
          message={status ?? ""}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        />

        <Dialog open={pendingDelete !== null} onClose={() => setPendingDelete(null)}>
          <DialogTitle>删除书籍</DialogTitle>
          <DialogContent>
            <DialogContentText>
              确定从书库移除《{pendingDelete?.title}》吗？该书的阅读进度也会一并删除。
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button color="inherit" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button color="error" onClick={() => void confirmDelete()}>
              删除
            </Button>
          </DialogActions>
        </Dialog>

        <LibrarySettingsSheet
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          prefs={prefs}
          onPrefsChange={onPrefsChange}
          syncState={syncState}
          onOpenSyncSettings={() => {
            setSettingsOpen(false);
            setSyncSettingsOpen(true);
          }}
        />

        <SyncSettingsSheet
          open={syncSettingsOpen}
          onOpenChange={setSyncSettingsOpen}
          syncState={syncState}
          onConfigChanged={() => syncStore.refresh()}
        />
      </div>
    </ThemeProvider>
  );
}

export default App;
