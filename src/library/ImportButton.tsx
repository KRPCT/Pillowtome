import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { knownHashesFromItems, summarizeIngest } from "./import-pipeline";
import { ingestPathToLibrary } from "./import-actions";
import { listLibraryItems } from "./library-store";

/**
 * 「导入书籍」按钮（简体中文）— catalog-aware (LIB-01).
 *
 * - 桌面：`dialog.open` → `library_ingest`
 * - Android：Rust SAF picker via `library_ingest` (path null)
 * Never returns book bytes (D-06).
 */

export interface ImportedBook {
  id: string;
  name: string;
}

export interface ImportButtonProps {
  /** After successful catalog insert; id is source_id for pillow open. */
  onImported?: (book: ImportedBook) => void;
  /** Always called after a completed attempt (refresh shelf). */
  onDone?: () => void;
}

export function ImportButton({ onImported, onDone }: ImportButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    setBusy(true);
    setError(null);
    try {
      const onAndroid = await invoke<boolean>("is_android");
      let path: string | null = null;
      if (!onAndroid) {
        const picked = await open({
          multiple: false,
          directory: false,
          filters: [{ name: "EPUB", extensions: ["epub"] }],
        });
        if (picked === null) {
          setBusy(false);
          return;
        }
        path = picked as string;
      }
      const existing = await listLibraryItems();
      const known = knownHashesFromItems(
        existing.map((i) => ({ workId: i.workId })),
      );
      const result = await ingestPathToLibrary(path, known);
      const caption = summarizeIngest(result);
      if (result.status === "imported" && result.sourceId) {
        onImported?.({
          id: result.sourceId,
          name: result.title ?? "未知书名",
        });
      } else if (result.status === "skipped_duplicate") {
        setError(caption);
      } else {
        setError(caption);
      }
      onDone?.();
    } catch (err) {
      console.error("[ImportButton] 导入失败", err);
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
      <button
        type="button"
        className="import-book"
        onClick={() => void handleImport()}
        disabled={busy}
      >
        {busy ? "导入中…" : "导入书籍"}
      </button>
      {error ? <p className="import__error">{error}</p> : null}
    </div>
  );
}

export default ImportButton;
