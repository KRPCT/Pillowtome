import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import MuiButton from "@mui/material/Button";
import { knownHashesFromItems, summarizeIngest } from "./import-pipeline";
import { ingestPathToLibrary } from "./import-actions";
import { listLibraryItems } from "./library-store";

/**
 * 「导入书籍」— catalog-aware (LIB-01).
 */

export interface ImportedBook {
  id: string;
  name: string;
}

export interface ImportButtonProps {
  onImported?: (book: ImportedBook) => void;
  onDone?: () => void;
  /** Toolbar variant reports status here (shown as a Snackbar) instead of inline. */
  onStatus?: (msg: string | null) => void;
  /** Compact toolbar style */
  variant?: "default" | "toolbar";
  className?: string;
}

export function ImportButton({
  onImported,
  onDone,
  onStatus,
  variant = "default",
  className,
}: ImportButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const report = (msg: string | null) => {
    setError(msg);
    onStatus?.(msg);
  };

  async function handleImport() {
    setBusy(true);
    report(null);
    try {
      const onAndroid = await invoke<boolean>("is_android");
      let path: string | null = null;
      if (!onAndroid) {
        const picked = await open({
          multiple: false,
          directory: false,
          filters: [
            {
              name: "书籍",
              extensions: ["epub", "mobi", "azw3", "azw", "fb2", "fbz", "cbz", "pdf", "txt"],
            },
          ],
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
        if (result.message) report(result.message);
      } else {
        report(caption);
      }
      onDone?.();
    } catch (err) {
      console.error("[ImportButton] 导入失败", err);
      const msg = String(err);
      if (!msg.includes("已取消")) {
        report(msg.replace(/^Error:\s*/i, "") || "导入失败，请重试。");
      }
    } finally {
      setBusy(false);
    }
  }

  if (variant === "toolbar") {
    return (
      <MuiButton
        className={className}
        variant="outlined"
        size="small"
        disabled={busy}
        onClick={() => void handleImport()}
      >
        {busy ? "导入中…" : "导入"}
      </MuiButton>
    );
  }

  return (
    <div className={className ?? "import"}>
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
