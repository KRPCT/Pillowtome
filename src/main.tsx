// 必须最先执行：老旧 WebView（Chromium ≤103 前）缺运行时 API，
// foliate-js 解 EPUB 会抛 TypeError，被兜成「文件已损坏或无法读取。」。
import "./lib/webview-shims";
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { injectBundledShellFonts } from "./lib/shell-fonts";

// 首屏渲染前声明 bundled CJK @font-face（pillow:// 本地协议，加载极快）。
injectBundledShellFonts();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
