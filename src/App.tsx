import { useCallback, useEffect, useRef, useState } from "react";
import { onBackButtonPress } from "@tauri-apps/api/app";
import "./App.css";
import { FoliateView } from "./reader/FoliateView";
import { LibraryGrid } from "./library/LibraryGrid";
import { listLibraryItems } from "./library/library-store";
import type { LibraryItem } from "./library/types";
import { touchLastOpened } from "./library/library-store";

/**
 * Pillowtome 应用外壳（简体中文）— Phase 4 library home.
 *
 * 书库封面网格为主；示例书仍可打开。阅读器经 sourceId / sample 打开。
 * 书籍字节仅经 pillow://（D-06）。
 */
function App() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [openWorkId, setOpenWorkId] = useState<string | null>(null);
  const [shelf, setShelf] = useState<LibraryItem[]>([]);
  const openIdRef = useRef<string | null>(null);
  openIdRef.current = openId;

  const readerBackRef = useRef<(() => boolean) | null>(null);

  async function refreshShelf() {
    try {
      setShelf(await listLibraryItems());
    } catch (err) {
      console.error("[App] 获取书库失败", err);
    }
  }

  useEffect(() => {
    void refreshShelf();
  }, []);

  const closeReader = useCallback(() => {
    setOpenId(null);
    setOpenWorkId(null);
    void refreshShelf();
  }, []);

  const registerReaderBack = useCallback((handler: (() => boolean) | null) => {
    readerBackRef.current = handler;
  }, []);

  const openItem = useCallback((item: LibraryItem) => {
    setOpenWorkId(item.workId);
    setOpenId(item.sourceId);
    void touchLastOpened(item.workId);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onBackButtonPress(() => {
      if (readerBackRef.current) {
        const consumed = readerBackRef.current();
        if (consumed) return;
      }
      if (openIdRef.current != null) {
        setOpenId(null);
        setOpenWorkId(null);
        return;
      }
    })
      .then((listener) => {
        unlisten = () => {
          void listener.unregister();
        };
      })
      .catch((err) => {
        console.debug("[App] onBackButtonPress unavailable", err);
      });
    return () => {
      unlisten?.();
    };
  }, []);

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
    <main className="container container--library">
      <header className="home-header">
        <h1>枕籍</h1>
        <p className="subtitle">干净、舒适的中文电子书阅读器</p>
      </header>

      <div className="actions actions--row">
        <button
          type="button"
          className="open-sample"
          onClick={() => {
            setOpenWorkId(null);
            setOpenId("sample");
          }}
        >
          打开示例书籍
        </button>
      </div>

      <LibraryGrid
        items={shelf}
        onOpen={openItem}
        onRefresh={() => void refreshShelf()}
        onImportedOpen={(sourceId) => {
          setOpenId(sourceId);
          void refreshShelf();
        }}
      />
      {/* openWorkId reserved for 04-03 resume wiring */}
      <span className="sr-only" aria-hidden>
        {openWorkId}
      </span>
    </main>
  );
}

export default App;
