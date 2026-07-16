/**
 * Shared catalog insert after Rust library_ingest (LIB-01).
 */

import { invoke } from "@tauri-apps/api/core";
import type { IngestResult } from "./import-pipeline";
import { insertLibraryItem, libraryHasWorkId } from "./library-store";
import { ensureWorkRow } from "../reader/locator-store";

export async function ingestPathToLibrary(
  path: string | null,
  knownHashes: string[],
): Promise<IngestResult> {
  const result = await invoke<IngestResult>("library_ingest", {
    path,
    knownHashes,
  });
  if (result.status === "imported" && result.workId && result.sourceId) {
    // Double-check SQL dedup (D-51)
    if (await libraryHasWorkId(result.workId)) {
      return {
        ...result,
        status: "skipped_duplicate",
        message: "书库中已有",
      };
    }
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
  return result;
}
