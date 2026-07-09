import "./App.css";

/**
 * Pillowtome 应用外壳（简体中文）。
 *
 * 本阶段（Plan 01-01）只验证 WebView 能挂载并渲染 React 外壳。
 * 「打开示例书籍」按钮与 foliate-js 阅读视图由 Plan 04 接入。
 *
 * 注意（D-06）：书籍字节只经由 `pillow://` 自定义协议流式送达 WebView，
 * 绝不通过 Tauri IPC 传输。此处不注册任何返回书籍字节的命令。
 */
function App() {
  return (
    <main className="container">
      <h1>枕籍</h1>
      <p className="subtitle">干净、舒适的中文电子书阅读器</p>
      <p className="hint">跨平台外壳已就绪，阅读功能即将上线。</p>
    </main>
  );
}

export default App;
