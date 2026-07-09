import { useState } from "react";
import "./App.css";
import { FoliateView } from "./reader/FoliateView";

/**
 * Pillowtome 应用外壳（简体中文）。
 *
 * 「打开示例书籍」挂载 foliate-js 阅读视图，打开随应用捆绑的示例 EPUB。
 *
 * 注意（D-06）：书籍字节只经由 `pillow://` 自定义协议流式送达 WebView，
 * 绝不通过 Tauri IPC 传输。渲染前先经 `check_protection` 的 DRM 门（D-10）。
 */
function App() {
  const [reading, setReading] = useState(false);

  if (reading) {
    return <FoliateView id="sample" onClose={() => setReading(false)} />;
  }

  return (
    <main className="container">
      <h1>枕籍</h1>
      <p className="subtitle">干净、舒适的中文电子书阅读器</p>
      <p className="hint">点击下方按钮，打开随应用捆绑的示例书籍。</p>
      <button type="button" className="open-sample" onClick={() => setReading(true)}>
        打开示例书籍
      </button>
    </main>
  );
}

export default App;
