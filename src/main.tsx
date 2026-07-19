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
