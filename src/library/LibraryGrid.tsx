import { useMemo, useState } from "react";
import type { LibraryItem } from "./types";
import {
  applyLibraryView,
  countByStatus,
  searchLibrary,
  type FilterKey,
  type SortKey,
} from "./library-sort";
import { deriveCardState } from "./sync-card-state";
import { LibraryCard } from "./LibraryCard";
import { LibraryToolbar } from "./LibraryToolbar";
import { ImportButton } from "./ImportButton";
import { FolderScanButton } from "./FolderScanButton";

/** Per-workId transfer views from the sync-status store (Phase 7). */
export interface SyncCardViewMaps {
  /** workId → live download percent (entry present ⇒ 下载中). */
  downloads: ReadonlyMap<string, number>;
  /** workId → live upload percent (entry present ⇒ 正在上传…). */
  uploads: ReadonlyMap<string, number>;
  /** workIds whose last download attempt rejected (tap retries). */
  failedDownloads: ReadonlySet<string>;
}

export interface LibraryGridProps {
  items: LibraryItem[];
  onOpen: (item: LibraryItem) => void;
  onRefresh: () => void;
  onImportedOpen?: (sourceId: string) => void;
  /** Long-press / right-click → 删除 a book. */
  onDelete?: (item: LibraryItem) => void;
  /** Strip source-site tail from shelf titles (display-only). */
  cleanTitles?: boolean;
  /** When true, hide empty-state import buttons (chrome already has them). */
  chromeHasActions?: boolean;
  /** 顶栏搜索词（书名/作者子串过滤，大小写不敏感）。 */
  searchQuery?: string;
  /** Phase 7 sync views + handlers (optional — omit for sync-free surfaces). */
  syncView?: SyncCardViewMaps;
  onDownload?: (item: LibraryItem) => void;
  onToggleFileSync?: (item: LibraryItem, enabled: boolean) => void;
  onStatus?: (msg: string | null) => void;
}

export function LibraryGrid({
  items,
  onOpen,
  onRefresh,
  onImportedOpen,
  onDelete,
  cleanTitles,
  chromeHasActions = false,
  searchQuery = "",
  syncView,
  onDownload,
  onToggleFileSync,
  onStatus,
}: LibraryGridProps) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("recent");

  const counts = useMemo(() => countByStatus(items), [items]);
  const searched = useMemo(
    () => searchLibrary(items, searchQuery),
    [items, searchQuery],
  );
  const view = useMemo(
    () => applyLibraryView(searched, filter, sort),
    [searched, filter, sort],
  );

  if (items.length === 0) {
    return (
      <section className="library library--empty" aria-label="书库">
        <p className="library-empty__text">
          书库还是空的。导入一本 EPUB，或扫描文件夹批量添加。
        </p>
        {!chromeHasActions ? (
          <div className="library-empty__actions">
            <ImportButton
              onImported={(b) => onImportedOpen?.(b.id)}
              onDone={onRefresh}
            />
            <FolderScanButton onDone={onRefresh} />
          </div>
        ) : (
          <p className="library-empty__hint">使用上方「导入」或「扫描」添加书籍</p>
        )}
      </section>
    );
  }

  return (
    <section className="library" aria-label="书库">
      <LibraryToolbar
        filter={filter}
        sort={sort}
        counts={counts}
        onFilterChange={setFilter}
        onSortChange={setSort}
      />
      {view.length === 0 ? (
        <p className="library-empty__text library-empty__text--search">
          没有找到匹配「{searchQuery.trim()}」的书籍。
        </p>
      ) : (
        <div className="shelf">
          {view.map((item) => {
            const downloadPercent = syncView?.downloads.get(item.workId) ?? null;
            const cardState = syncView
              ? deriveCardState(
                  item,
                  syncView.failedDownloads.has(item.workId)
                    ? "failed"
                    : downloadPercent != null
                      ? { percent: downloadPercent }
                      : null,
                )
              : "local";
            return (
              <LibraryCard
                key={item.itemId}
                item={item}
                onOpen={onOpen}
                onDelete={onDelete}
                cleanTitles={cleanTitles}
                syncState={cardState}
                downloadPercent={downloadPercent}
                uploading={syncView?.uploads.has(item.workId) ?? false}
                onDownload={onDownload}
                onToggleFileSync={onToggleFileSync}
                onStatus={onStatus}
              />
            );
          })}
        </div>
      )}
      <div className="lib-statusbar">
        <span>
          <b>{items.length}</b> 本藏书
        </span>
        {searchQuery.trim() !== "" ? (
          <span>
            搜索匹配 <b>{searched.length}</b> 本
          </span>
        ) : null}
      </div>
    </section>
  );
}
