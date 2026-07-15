import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * 构建当前平台下书籍字节的 `pillow://` 访问地址。
 *
 * 书籍字节只经由此自定义协议流式传输，绝不通过 Tauri IPC（D-06）。
 *
 * 每个平台的 WebView 处理自定义协议的方式不同（Pitfall 1）：
 * - Windows / Android：`http://pillow.localhost/<id>`
 * - macOS / Linux：`pillow://localhost/<id>`
 *
 * **不要手写这个映射。** 这里原先靠嗅探 `navigator.userAgent` 拼 URL，把 Android
 * 猜成了 `https://`，于是 `fetch` 直接 `TypeError: Failed to fetch`。而且正确的
 * 形式还取决于 `app.security.dangerousUseHttpScheme`（http 还是 https）——这是
 * 前端无从得知的配置。`convertFileSrc` 由 Tauri 注入到每个 WebView 页面，按平台
 * 与配置生成正确的 URL 并对 id 做 URL 编码；原生协议处理器还会拒绝任何 `..`
 * 穿越（threat T-01-01）。
 */
export function pillowUrl(id: string): string {
  return convertFileSrc(id, "pillow");
}

/**
 * Build the `pillow://` URL for a custom font face under `fonts/{id}` (D-30).
 *
 * Served by the same pillow protocol handler, confined to app_data/fonts.
 * Use `convertFileSrc` — do not hand-roll platform hosts (Phase 1 lesson).
 */
export function pillowFontUrl(fontId: string): string {
  return convertFileSrc(`fonts/${fontId}`, "pillow");
}
