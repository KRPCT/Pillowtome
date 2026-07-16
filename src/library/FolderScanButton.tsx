import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  knownHashesFromItems,
  summarizeScan,
  type IngestResult,
  type ScanSummary,
} from "./import-pipeline";
import { insertLibraryItem, listLibraryItems, libraryHasWorkId } from "./library-store";
import { ensureWorkRow } from "../reader/locator-store";

export interface FolderScanButtonProps {
  onDone?: () => void;
}

/**
 * 「扫描文件夹」— desktop recursive EPUB scan (D-50, D-53).
 * Android shows guidance to use 导入书籍 until SAF tree walk lands.
 */
export function FolderScanButton({ onDone }: FolderScanButtonProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleScan() {
    setBusy(true);
    setStatus(null);
    try {
      const onAndroid = await invoke<boolean>("is_android");
      if (onAndroid) {
        setStatus("Android 请使用「导入书籍」选择文件（目录扫描后续完善）。");
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

  return (
    <div className="import">
      <button
        type="button"
        className="import-book"
        onClick={() => void handleScan()}
        disabled={busy}
      >
        {busy ? "扫描中…" : "扫描文件夹"}
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
    itemId: crypto.randomUUID(),
    workId: result.workId,
    sourceId: result.sourceId,
    title: result.title ?? "未知书名",
    author: result.author ?? null,
    coverFile: result.coverFile ?? null,
    importedAt: Date.now(),
  });
}
