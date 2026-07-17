import { useCallback, useEffect, useRef, useState } from "react";
import { onBackButtonPress } from "@tauri-apps/api/app";
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
import { LibraryGrid } from "./library/LibraryGrid";
import { ImportButton } from "./library/ImportButton";
import { FolderScanButton } from "./library/FolderScanButton";
import {
  deleteLibraryItem,
  listLibraryItems,
  touchLastOpened,
} from "./library/library-store";
import type { LibraryItem } from "./library/types";
import {
  LibrarySettingsSheet,
  useLibraryPrefs,
} from "./library/LibrarySettingsSheet";

/**
 * 书库为主壳：纸感主题与阅读页对齐；直接进入网格 + 设置菜单。
 */
function App() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [shelf, setShelf] = useState<LibraryItem[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LibraryItem | null>(null);
  const openIdRef = useRef<string | null>(null);
  openIdRef.current = openId;

  const readerBackRef = useRef<(() => boolean) | null>(null);
  const { prefs, onPrefsChange } = useLibraryPrefs();
  const theme = prefs.theme ?? "day";
  const muiTheme = getMuiTheme(theme);

  const refreshShelf = useCallback(async () => {
    try {
      setShelf(await listLibraryItems());
    } catch (err) {
      console.error("[App] 获取书库失败", err);
      setStatus("无法加载书库，请重启应用后再试。");
    }
  }, []);

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

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onBackButtonPress(() => {
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
  }, [settingsOpen]);

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
        />
      </div>
    </ThemeProvider>
  );
}

export default App;
