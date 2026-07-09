/**
 * 构建当前平台下书籍字节的 `pillow://` 访问地址。
 *
 * 书籍字节只经由此自定义协议流式传输，绝不通过 Tauri IPC（D-06）。
 *
 * 每个平台的 WebView 处理自定义协议的方式不同（Pitfall 1）：
 * - Windows：`http://pillow.localhost/<id>`
 * - Android：`https://pillow.localhost/<id>`
 * - macOS / Linux：`pillow://localhost/<id>`
 *
 * `id` 会被 URL 编码；原生协议处理器还会拒绝任何 `..` 穿越（threat T-01-01）。
 */
export function pillowUrl(id: string): string {
  const safeId = encodeURIComponent(id);
  const ua =
    typeof navigator !== "undefined" && navigator.userAgent
      ? navigator.userAgent
      : "";

  if (/Android/i.test(ua)) {
    return `https://pillow.localhost/${safeId}`;
  }
  if (/Windows/i.test(ua)) {
    return `http://pillow.localhost/${safeId}`;
  }
  return `pillow://localhost/${safeId}`;
}
