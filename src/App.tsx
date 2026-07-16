import { useCallback, useEffect, useRef, useState } from "react";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { BookOpen, Settings2 } from "lucide-react";
import "./App.css";
import { FoliateView } from "./reader/FoliateView";
import { LibraryGrid } from "./library/LibraryGrid";
import { ImportButton } from "./library/ImportButton";
import { FolderScanButton } from "./library/FolderScanButton";
import { listLibraryItems, touchLastOpened } from "./library/library-store";
import type { LibraryItem } from "./library/types";
import {
  LibrarySettingsSheet,
  useLibraryPrefs,
} from "./library/LibrarySettingsSheet";
import { Button } from "@/components/ui/button";

/**
 * 书库为主壳：纸感主题与阅读页对齐；直接进入网格 + 设置菜单。
 */
function App() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [shelf, setShelf] = useState<LibraryItem[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const openIdRef = useRef<string | null>(null);
  openIdRef.current = openId;

  const readerBackRef = useRef<(() => boolean) | null>(null);
  const { prefs, onPrefsChange } = useLibraryPrefs();
  const theme = prefs.theme ?? "day";

  const refreshShelf = useCallback(async () => {
    try {
      setShelf(await listLibraryItems());
    } catch (err) {
      console.error("[App] 获取书库失败", err);
      setStatus("无法加载书库，请重启应用后再试。");
    }
  }, []);

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
        id={openId}
        onClose={closeReader}
        registerBackHandler={registerReaderBack}
      />
    );
  }

  return (
    <div className="library-shell reader" data-theme={theme}>
      <header className="library-chrome">
        <div className="library-chrome__brand">
          <BookOpen className="library-chrome__icon" aria-hidden />
          <div>
            <h1 className="library-chrome__title">枕籍</h1>
            <p className="library-chrome__sub">本地书库</p>
          </div>
        </div>
        <div className="library-chrome__actions">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="library-chrome__sample"
            onClick={() => setOpenId("sample")}
          >
            示例
          </Button>
          <ImportButton
            variant="toolbar"
            onImported={(b) => {
              setStatus(null);
              setOpenId(b.id);
              void refreshShelf();
            }}
            onDone={() => void refreshShelf()}
          />
          <FolderScanButton
            variant="toolbar"
            onDone={() => {
              setStatus(null);
              void refreshShelf();
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="设置"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 className="size-5" />
          </Button>
        </div>
      </header>

      {status ? (
        <p className="library-banner" role="status">
          {status}
        </p>
      ) : null}

      <div className="library-shell__body">
        <LibraryGrid
          items={shelf}
          onOpen={openItem}
          onRefresh={() => void refreshShelf()}
          onImportedOpen={(sourceId) => {
            setOpenId(sourceId);
            void refreshShelf();
          }}
          chromeHasActions
        />
      </div>

      <LibrarySettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        prefs={prefs}
        onPrefsChange={onPrefsChange}
      />
    </div>
  );
}

export default App;
