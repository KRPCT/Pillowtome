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
