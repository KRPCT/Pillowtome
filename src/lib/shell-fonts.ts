/**
 * 壳层内置 CJK 字体注入（启动最早时机）。
 *
 * 两个 bundled 家族（PillowBundledCJK 黑体 SC+TC / PillowBundledSerifCJK 宋体 SC）
 * 由 Rust 物化到 app_data/fonts，经 pillow:// 协议本地加载——单文件全字符覆盖，
 * 没有 unicode-range 子集，壳层 UI 文本绝不出现逐字回退-替换。
 *
 * 在 main.tsx 渲染前同步调用：本地协议极快，首屏绘制时 face 已声明。
 * 非 Tauri 环境（vite dev 浏览器审计）URL 不可达时静默回退系统栈。
 */

import {
  BUNDLED_CJK_FAMILY,
  BUNDLED_SERIF_CJK_FAMILY,
  buildAllBundledFontFaceCss,
} from "../reader/fonts";

const STYLE_ID = "pillow-bundled-fonts";

export function injectBundledShellFonts(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = buildAllBundledFontFaceCss();
  document.head.appendChild(style);

  // 就绪日志（一次性）：确认两个家族真的加载成功，否则提示回退。
  if (typeof document !== "undefined" && "fonts" in document) {
    void Promise.all([
      document.fonts.load(`13px "${BUNDLED_CJK_FAMILY}"`, "枕"),
      document.fonts.load(`13px "${BUNDLED_SERIF_CJK_FAMILY}"`, "籍"),
    ]).then((results) => {
      if (results.some((r) => r.length === 0)) {
        console.warn("[fonts] bundled CJK faces not ready; system fallback in use");
      }
    });
  }
}
