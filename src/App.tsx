import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { BookMarked, RefreshCw, Search, Settings2, X } from "lucide-react";
import { ThemeProvider } from "@mui/material/styles";
import Button from "@mui/material/Button";
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
import { TopbarOverflowMenu } from "./library/TopbarOverflowMenu";
import {
  adoptSyncedFile,
  deleteLibraryItem,
  listLibraryItems,
  touchLastOpened,
} from "./library/library-store";
import { ingestPathToLibrary, catalogIngestResult } from "./library/import-actions";
import { knownHashesFromItems, summarizeIngest } from "./library/import-pipeline";
import type { IngestResult } from "./library/import-pipeline";
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

/** 窄屏底部 tab（mockup §06 .tabbar）：React 状态驱动，不引路由。 */
type MobileTab = "library" | "sync" | "settings";

/**
 * 书库为主壳（mockup §02 纸墨语汇）：词标 + 搜索 + 同步药丸 + 朱砂导入。
 * 窄屏（≤640px）压缩为词标 + 搜索图标 + 同步点 + 「⋯」溢出菜单，右下朱砂
 * FAB 触发导入，底部 tab bar（书库/同步/设置）；≤1000px 搜索收成图标、
 * 示例/扫描/设置并入「⋯」菜单。
 * Phase 7: 同步状态 D-90 手动兜底、同步设置 sheet、云端占位卡下载流 —
 * failures surface ONLY as dot + this Snackbar (D-93).
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
  /** 顶栏搜索词（客户端子串过滤，LibraryGrid 内应用）。 */
  const [query, setQuery] = useState("");
  /** 窄屏顶栏搜索展开态（>640px 搜索 pill 常驻）。 */
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("library");
  const openIdRef = useRef<string | null>(null);
  openIdRef.current = openId;
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

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

  // Android「打开方式」导入：MainActivity 已把 VIEW 文件复制进私有目录
  // （pending_open.epub），这里每 3 秒 + 窗口聚焦时取走入库。桌面端恒为 null。
  useEffect(() => {
    let disposed = false;
    let active = false;
    const poll = async () => {
      if (disposed) return;
      try {
        if (!active) {
          active = await invoke<boolean>("is_android");
          if (!active) return;
        }
        const existing = await listLibraryItems();
        const known = knownHashesFromItems(existing.map((i) => ({ workId: i.workId })));
        const staged = await invoke<IngestResult | null>("take_pending_open", {
          knownHashes: known,
        });
        if (!staged || disposed) return;
        const result = await catalogIngestResult(staged);
        setStatus(summarizeIngest(result));
        void refreshShelf();
      } catch (err) {
        console.warn("[App] take_pending_open 轮询失败", err);
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 3000);
    window.addEventListener("focus", poll);
    return () => {
      disposed = true;
      window.clearInterval(id);
      window.removeEventListener("focus", poll);
    };
  }, [refreshShelf]);

  // 窄屏搜索展开后聚焦输入框。
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

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

  // 窄屏 tab bar（§06）：书库回到网格；同步/设置打开对应 sheet
  //（关闭后 tab 回到书库）。
  const handleMobileTab = useCallback((tab: MobileTab) => {
    setMobileTab(tab);
    if (tab === "library") {
      bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    } else if (tab === "sync") {
      setSyncSettingsOpen(true);
    } else if (tab === "settings") {
      setSettingsOpen(true);
    }
  }, []);

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
      if (searchOpen) {
        setSearchOpen(false);
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
  }, [settingsOpen, syncSettingsOpen, searchOpen]);

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

  const sheetClosed = (tab: MobileTab) => (open: boolean) => {
    if (tab === "sync") setSyncSettingsOpen(open);
    else setSettingsOpen(open);
    if (!open) setMobileTab("library");
  };

  return (
    <ThemeProvider theme={muiTheme}>
      <div className="library-shell reader" data-theme={theme}>
        {/* §02 书库顶栏：词标 + 搜索 pill + 同步药丸 + 朱砂导入 + ghost 操作。
            桌面 52px、1px 发丝线下边框、纸底；≤640px 压缩为词标 + 图标。 */}
        <header className={searchOpen ? "app-topbar app-topbar--search" : "app-topbar"}>
          <div className="app-wordmark">
            枕籍<small>PILLOWTOME</small>
          </div>
          <button
            type="button"
            className="app-topbar__icon-btn app-topbar__search-toggle"
            aria-label={searchOpen ? "收起搜索" : "搜索"}
            onClick={() => {
              if (searchOpen) setQuery("");
              setSearchOpen(!searchOpen);
            }}
          >
            {searchOpen ? <X size={18} /> : <Search size={18} />}
          </button>
          <div className="lib-search">
            <Search size={13} aria-hidden className="lib-search__icon" />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索书名或作者…"
              aria-label="搜索书库"
            />
            {query !== "" ? (
              <button
                type="button"
                className="lib-search__clear"
                aria-label="清空搜索"
                onClick={() => setQuery("")}
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
          <span className="app-topbar__tail">
            <SyncStatusButton state={syncState} onPress={handleSyncPress} />
            <button
              type="button"
              className="btn-ghost app-topbar__sample"
              onClick={() => setOpenId("sample")}
            >
              示例
            </button>
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
            <button
              type="button"
              className="app-topbar__icon-btn app-topbar__settings"
              aria-label="设置"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={18} />
            </button>
            <TopbarOverflowMenu
              onOpenSample={() => setOpenId("sample")}
              onOpenSettings={() => setSettingsOpen(true)}
              onStatus={setStatus}
              onDone={() => void refreshShelf()}
            />
          </span>
        </header>

        <div className="library-shell__body" ref={bodyRef}>
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
            searchQuery={query}
            syncView={syncView}
            onDownload={(item) => void handleDownload(item)}
            onToggleFileSync={(item, enabled) => void handleToggleFileSync(item, enabled)}
            onStatus={setStatus}
          />
        </div>

        {/* §06 窄屏：右下朱砂 FAB（＋ 触发导入）+ 底部 tab bar（仅 ≤640px 显示）。 */}
        <ImportButton
          variant="fab"
          onStatus={setStatus}
          onImported={(b) => {
            setOpenId(b.id);
            void refreshShelf();
          }}
          onDone={() => void refreshShelf()}
        />
        <nav className="tabbar" aria-label="主导航">
          <button
            type="button"
            className={mobileTab === "library" ? "on" : undefined}
            onClick={() => handleMobileTab("library")}
          >
            <b>
              <BookMarked size={17} aria-hidden />
            </b>
            书库
          </button>
          <button
            type="button"
            className={mobileTab === "sync" ? "on" : undefined}
            onClick={() => handleMobileTab("sync")}
          >
            <b>
              <RefreshCw size={17} aria-hidden />
            </b>
            同步
          </button>
          <button
            type="button"
            className={mobileTab === "settings" ? "on" : undefined}
            onClick={() => handleMobileTab("settings")}
          >
            <b>⚙</b>
            设置
          </button>
        </nav>

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
          onOpenChange={sheetClosed("settings")}
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
          onOpenChange={sheetClosed("sync")}
          syncState={syncState}
          onConfigChanged={() => syncStore.refresh()}
        />
      </div>
    </ThemeProvider>
  );
}

export default App;
