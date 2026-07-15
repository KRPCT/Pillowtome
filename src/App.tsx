import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { onBackButtonPress } from "@tauri-apps/api/app";
import "./App.css";
import { FoliateView } from "./reader/FoliateView";
import { ImportButton, type ImportedBook } from "./library/ImportButton";

/**
 * Pillowtome 应用外壳（简体中文）。
 *
 * 「打开示例书籍」挂载 foliate-js 阅读视图，打开随应用捆绑的示例 EPUB。
 * 「导入书籍」经不透明存储句柄 `BookSource` 从设备存储导入（FND-03，D-05）；
 * Android 上导入的书籍通过持久化的 SAF 授权在重启后依旧可打开，无需重新授权。
 *
 * 注意（D-06）：书籍字节只经由 `pillow://` 自定义协议流式送达 WebView，
 * 绝不通过 Tauri IPC 传输。渲染前先经 `check_protection` 的 DRM 门（D-10）。
 *
 * Android 系统返回分层：
 * 1) 阅读器内 sheet/chrome（FoliateView 处理）
 * 2) 阅读器 → 书架（本组件）
 * 3) 书架再返回 → 交给系统（退出/后台）
 */
function App() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportedBook[]>([]);
  const openIdRef = useRef<string | null>(null);
  openIdRef.current = openId;

  // Reader registers a back consumer when mounted (sheets / chrome / close).
  const readerBackRef = useRef<(() => boolean) | null>(null);

  async function refreshImported() {
    try {
      setImported(await invoke<ImportedBook[]>("imported_books"));
    } catch (err) {
      console.error("[App] 获取已导入书籍失败", err);
    }
  }

  useEffect(() => {
    void refreshImported();
  }, []);

  const closeReader = useCallback(() => {
    setOpenId(null);
  }, []);

  const registerReaderBack = useCallback((handler: (() => boolean) | null) => {
    readerBackRef.current = handler;
  }, []);

  // Android hardware / gesture back.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onBackButtonPress(() => {
      // 1) Reader-level: close sheet / hide chrome / leave book
      if (readerBackRef.current) {
        const consumed = readerBackRef.current();
        if (consumed) return;
      }
      // 2) Still in reader without handler → library
      if (openIdRef.current != null) {
        setOpenId(null);
        return;
      }
      // 3) Library: do nothing — let OS handle (minimize/exit).
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
    <main className="container">
      <h1>枕籍</h1>
      <p className="subtitle">干净、舒适的中文电子书阅读器</p>
      <p className="hint">打开随应用捆绑的示例书籍，或从设备存储导入一本。</p>

      <div className="actions">
        <button type="button" className="open-sample" onClick={() => setOpenId("sample")}>
          打开示例书籍
        </button>
        <ImportButton
          onImported={(book) => {
            void refreshImported();
            setOpenId(book.id);
          }}
        />
      </div>

      {imported.length > 0 && (
        <section className="library">
          <h2 className="library__title">已导入</h2>
          <ul className="library__list">
            {imported.map((book) => (
              <li key={book.id}>
                <button type="button" className="library__item" onClick={() => setOpenId(book.id)}>
                  {book.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

export default App;
