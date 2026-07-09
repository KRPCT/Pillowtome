import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

/**
 * 「导入书籍」按钮（简体中文）。
 *
 * 通过不透明的存储句柄 `BookSource` 从设备存储导入一本书（FND-03，D-05）：
 * - 桌面：`dialog.open` 选择文件，把路径交给 `import` 命令 → `BookSource::Path`。
 * - Android：`import` 命令在 Rust 侧弹出 SAF 选择器，并持久化 URI 授权
 *   （`takePersistableUriPermission`），返回 `content://` → `BookSource::ContentUri`，
 *   重启后仍可打开，无需重新授权。
 *
 * 无论哪个平台，命令只返回书籍 id 与显示名，绝不返回书籍字节（D-06）。
 */

/** `import` 命令返回的结构（只有小结构体跨 IPC，D-06）。 */
export interface ImportedBook {
  id: string;
  name: string;
}

export interface ImportButtonProps {
  /** 导入成功后打开该 id 对应的阅读视图。 */
  onImported: (book: ImportedBook) => void;
}

export function ImportButton({ onImported }: ImportButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    setBusy(true);
    setError(null);
    try {
      const onAndroid = await invoke<boolean>("is_android");

      // Android 走 Rust 侧的 SAF 选择器（可持久化授权）；桌面用系统文件对话框。
      let path: string | null = null;
      if (!onAndroid) {
        const picked = await open({
          multiple: false,
          directory: false,
          filters: [{ name: "EPUB", extensions: ["epub"] }],
        });
        if (picked === null) {
          setBusy(false);
          return; // 用户取消。
        }
        path = picked as string;
      }

      const book = await invoke<ImportedBook>("import", { path });
      onImported(book);
    } catch (err) {
      console.error("[ImportButton] 导入失败", err);
      // 用户主动取消不算错误。
      const msg = String(err);
      if (!msg.includes("已取消")) {
        setError("导入失败，请重试。");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="import">
      <button type="button" className="import-book" onClick={handleImport} disabled={busy}>
        {busy ? "导入中…" : "导入书籍"}
      </button>
      {error && <p className="import__error">{error}</p>}
    </div>
  );
}

export default ImportButton;
