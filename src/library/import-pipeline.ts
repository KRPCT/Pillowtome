/**
 * Catalog ingest orchestration (LIB-01, D-50..D-53).
 * Pure summary helpers are unit-tested; invoke side effects stay in UI.
 */

export type IngestStatus = "imported" | "skipped_duplicate" | "refused";

export interface IngestResult {
  status: IngestStatus;
  sourceId?: string;
  workId?: string;
  contentHash?: string;
  title?: string;
  author?: string | null;
  coverFile?: string | null;
  message?: string;
}

export interface ScanSummary {
  imported: number;
  skippedDuplicate: number;
  failed: number;
  messages: string[];
  /** Successfully ingested entries (for SQL insert). */
  items?: IngestResult[];
}

/** Build 简体中文 toast/caption for a single ingest. */
export function summarizeIngest(result: IngestResult): string {
  if (result.status === "imported") {
    return `已加入书库：${result.title ?? "未知书名"}`;
  }
  if (result.status === "skipped_duplicate") {
    return result.message ?? "书库中已有";
  }
  return result.message ?? "导入失败";
}

/** Build 简体中文 summary for a folder scan. */
export function summarizeScan(summary: ScanSummary): string {
  const parts: string[] = [];
  if (summary.imported > 0) parts.push(`新入库 ${summary.imported} 本`);
  if (summary.skippedDuplicate > 0) {
    parts.push(`已有 ${summary.skippedDuplicate} 本`);
  }
  if (summary.failed > 0) parts.push(`失败 ${summary.failed} 本`);
  if (parts.length === 0) return "未找到可导入的 EPUB";
  return parts.join("，");
}

/** Collect known content hashes / work ids for dedup (D-51). */
export function knownHashesFromItems(
  items: Array<{ workId: string; contentHash?: string | null }>,
): string[] {
  const set = new Set<string>();
  for (const it of items) {
    if (it.workId) set.add(it.workId);
    if (it.contentHash) set.add(it.contentHash);
  }
  return [...set];
}
