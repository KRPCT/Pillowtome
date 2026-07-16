import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { knownHashesFromItems, summarizeIngest } from "./import-pipeline";
import { ingestPathToLibrary } from "./import-actions";
import { listLibraryItems } from "./library-store";
import { Button } from "@/components/ui/button";

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
  /** Compact toolbar style */
  variant?: "default" | "toolbar";
  className?: string;
}

export function ImportButton({
  onImported,
  onDone,
  variant = "default",
  className,
}: ImportButtonProps) {
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
        if (result.message) setError(result.message);
      } else {
        setError(caption);
      }
      onDone?.();
    } catch (err) {
      console.error("[ImportButton] 导入失败", err);
      const msg = String(err);
      if (!msg.includes("已取消")) {
        setError(msg.replace(/^Error:\s*/i, "") || "导入失败，请重试。");
      }
    } finally {
      setBusy(false);
    }
  }

  if (variant === "toolbar") {
    return (
      <div className={className}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void handleImport()}
        >
          {busy ? "导入中…" : "导入"}
        </Button>
        {error ? (
          <p className="library-status" role="status">
            {error}
          </p>
        ) : null}
      </div>
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
