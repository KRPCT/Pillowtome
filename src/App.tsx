import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
 */
function App() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportedBook[]>([]);

  // 启动时拉取已导入书籍：Android 上包含从持久化 SAF 授权重建的条目，
  // 因此强制停止并重启后，之前导入的书仍会出现在列表中（FND-03）。
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

  if (openId) {
    return <FoliateView id={openId} onClose={() => setOpenId(null)} />;
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
