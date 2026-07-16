import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  knownHashesFromItems,
  summarizeScan,
  type IngestResult,
  type ScanSummary,
} from "./import-pipeline";
import {
  insertLibraryItem,
  listLibraryItems,
  libraryHasWorkId,
} from "./library-store";
import { ensureWorkRow } from "../reader/locator-store";
import { Button } from "@/components/ui/button";

export interface FolderScanButtonProps {
  onDone?: () => void;
  variant?: "default" | "toolbar";
  className?: string;
}

function newItemId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `item-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * 「扫描文件夹」— desktop recursive EPUB scan (D-50, D-53).
 */
export function FolderScanButton({
  onDone,
  variant = "default",
  className,
}: FolderScanButtonProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleScan() {
    setBusy(true);
    setStatus(null);
    try {
      const onAndroid = await invoke<boolean>("is_android");
      if (onAndroid) {
        setStatus("Android 请使用「导入」选择 EPUB 文件。");
        return;
      }
      const picked = await open({
        multiple: false,
        directory: true,
      });
      if (picked === null) return;
      const dir = picked as string;
      const existing = await listLibraryItems();
      const known = knownHashesFromItems(
        existing.map((i) => ({ workId: i.workId })),
      );
      const summary = await invoke<ScanSummary>("library_scan_folder", {
        dir,
        knownHashes: known,
      });
      for (const item of summary.items ?? []) {
        await persistIngest(item);
      }
      setStatus(summarizeScan(summary));
      onDone?.();
    } catch (err) {
      const msg = String(err);
      if (!msg.includes("已取消") && !msg.includes("未选择")) {
        setStatus(msg.replace(/^Error:\s*/i, "") || "扫描失败，请重试。");
      }
    } finally {
      setBusy(false);
    }
  }

  const label = busy ? "扫描中…" : variant === "toolbar" ? "扫描" : "扫描文件夹";

  if (variant === "toolbar") {
    return (
      <div className={className}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void handleScan()}
        >
          {label}
        </Button>
        {status ? (
          <p className="library-status" role="status">
            {status}
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
        onClick={() => void handleScan()}
        disabled={busy}
      >
        {label}
      </button>
      {status ? (
        <p className="import__error" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}

async function persistIngest(result: IngestResult): Promise<void> {
  if (result.status !== "imported" || !result.workId || !result.sourceId) return;
  if (await libraryHasWorkId(result.workId)) return;
  await ensureWorkRow(result.workId, result.contentHash ?? result.workId, "epub");
  await insertLibraryItem({
    itemId: newItemId(),
    workId: result.workId,
    sourceId: result.sourceId,
    title: result.title ?? "未知书名",
    author: result.author ?? null,
    coverFile: result.coverFile ?? null,
    importedAt: Date.now(),
  });
}
