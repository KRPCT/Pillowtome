/**
 * Pure library sort/filter (LIB-04, D-59..D-60).
 */

import type { LibraryItem } from "./types";

export type SortKey = "title" | "author" | "recent" | "progress";
export type FilterKey = "all" | "reading" | "unread" | "finished";

/** Finished threshold (D-60 discretion). */
export const FINISHED_MIN = 0.99;

export function readingStatus(
  progress: number | null | undefined,
): "unread" | "reading" | "finished" {
  if (progress == null || !Number.isFinite(progress) || progress <= 0) {
    return "unread";
  }
  if (progress >= FINISHED_MIN) return "finished";
  return "reading";
}

export function filterLibrary(
  items: LibraryItem[],
  filter: FilterKey,
): LibraryItem[] {
  if (filter === "all") return items.slice();
  return items.filter((it) => readingStatus(it.progressFraction) === filter);
}

export function sortLibrary(items: LibraryItem[], sort: SortKey): LibraryItem[] {
  const out = items.slice();
  const cmpStr = (a: string, b: string) =>
    a.localeCompare(b, "zh-CN", { sensitivity: "base" });

  out.sort((a, b) => {
    switch (sort) {
      case "title":
        return cmpStr(a.title, b.title);
      case "author":
        return cmpStr(a.author ?? "", b.author ?? "") || cmpStr(a.title, b.title);
      case "progress": {
        const pa = a.progressFraction ?? -1;
        const pb = b.progressFraction ?? -1;
        return pb - pa || cmpStr(a.title, b.title);
      }
      case "recent":
      default: {
        // last_read first, then last_opened, then imported
        const ta = a.lastReadAt ?? a.lastOpenedAt ?? a.importedAt;
        const tb = b.lastReadAt ?? b.lastOpenedAt ?? b.importedAt;
        return tb - ta || cmpStr(a.title, b.title);
      }
    }
  });
  return out;
}

export function applyLibraryView(
  items: LibraryItem[],
  filter: FilterKey,
  sort: SortKey,
): LibraryItem[] {
  return sortLibrary(filterLibrary(items, filter), sort);
}

/**
 * 顶栏搜索（mockup §02 lib-search）：对书名/作者做大小写不敏感的子串过滤。
 * 空白查询原样返回（拷贝）；匹配在过滤/排序之前应用。
 */
export function searchLibrary(items: LibraryItem[], query: string): LibraryItem[] {
  const q = query.trim().toLowerCase();
  if (q === "") return items.slice();
  return items.filter(
    (it) =>
      it.title.toLowerCase().includes(q) ||
      (it.author ?? "").toLowerCase().includes(q),
  );
}

/** 状态 chips 计数（全部/在读/未读/读毕），基于完整书架实时计算。 */
export function countByStatus(items: LibraryItem[]): Record<FilterKey, number> {
  const counts: Record<FilterKey, number> = {
    all: items.length,
    reading: 0,
    unread: 0,
    finished: 0,
  };
  for (const it of items) {
    counts[readingStatus(it.progressFraction)] += 1;
  }
  return counts;
}
