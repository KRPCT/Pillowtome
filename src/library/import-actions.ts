/**
 * Shared catalog insert after Rust library_ingest (LIB-01).
 */

import { invoke } from "@tauri-apps/api/core";
import type { IngestResult } from "./import-pipeline";
import { insertLibraryItem, libraryHasWorkId } from "./library-store";
import { ensureWorkRow } from "../reader/locator-store";

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

function cleanErr(err: unknown): string {
  const msg = String(err ?? "");
  return msg
    .replace(/^Error:\s*/i, "")
    .replace(/^.*error:\s*/i, "")
    .trim();
}

/**
 * Write a successful Rust ingest into the library SQL catalog (LIB-01).
 * Shared by the picker flow and the Android「打开方式」pending-open flow.
 * Duplicate / refused results pass through untouched.
 */
export async function catalogIngestResult(
  result: IngestResult,
): Promise<IngestResult> {
  if (result.status === "imported" && result.workId && result.sourceId) {
    try {
      if (await libraryHasWorkId(result.workId)) {
        return {
          ...result,
          status: "skipped_duplicate",
          message: "书库中已有",
        };
      }
      await ensureWorkRow(
        result.workId,
        result.contentHash ?? result.workId,
        "epub",
      );
      await insertLibraryItem({
        itemId: newItemId(),
        workId: result.workId,
        sourceId: result.sourceId,
        title: result.title ?? "未知书名",
        author: result.author ?? null,
        coverFile: result.coverFile ?? null,
        importedAt: Date.now(),
      });
    } catch (err) {
      console.warn("[import-actions] catalog insert failed", err);
      // Still return imported so user can open via registry source_id
      return {
        ...result,
        message:
          cleanErr(err) ||
          "书籍已打开注册，但写入书库失败（请重启应用以完成数据库升级）",
      };
    }
  }
  return result;
}

export async function ingestPathToLibrary(
  path: string | null,
  knownHashes: string[],
): Promise<IngestResult> {
  let result: IngestResult;
  try {
    result = await invoke<IngestResult>("library_ingest", {
      path,
      knownHashes,
    });
  } catch (err) {
    // Fallback: legacy register-only import if catalog command missing/fails hard.
    try {
      const book = await invoke<{ id: string; name: string }>("import", { path });
      return {
        status: "imported",
        sourceId: book.id,
        title: book.name,
        message: "已注册书籍（书库表写入稍后重试）",
      };
    } catch (err2) {
      return {
        status: "refused",
        message: cleanErr(err2) || cleanErr(err) || "导入失败，请重试。",
      };
    }
  }

  return catalogIngestResult(result);
}
