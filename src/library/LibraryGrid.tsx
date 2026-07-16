import { useMemo, useState } from "react";
import type { LibraryItem } from "./types";
import { applyLibraryView, type FilterKey, type SortKey } from "./library-sort";
import { LibraryCard } from "./LibraryCard";
import { LibraryToolbar } from "./LibraryToolbar";
import { ImportButton } from "./ImportButton";
import { FolderScanButton } from "./FolderScanButton";

export interface LibraryGridProps {
  items: LibraryItem[];
  onOpen: (item: LibraryItem) => void;
  onRefresh: () => void;
  onImportedOpen?: (sourceId: string) => void;
}

export function LibraryGrid({
  items,
  onOpen,
  onRefresh,
  onImportedOpen,
}: LibraryGridProps) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("recent");

  const view = useMemo(
    () => applyLibraryView(items, filter, sort),
    [items, filter, sort],
  );

  if (items.length === 0) {
    return (
      <section className="library library--empty" aria-label="书库">
        <p className="library-empty__text">
          书库还是空的。导入一本 EPUB，或扫描文件夹批量添加。
        </p>
        <div className="library-empty__actions">
          <ImportButton
            onImported={(b) => onImportedOpen?.(b.id)}
            onDone={onRefresh}
          />
          <FolderScanButton onDone={onRefresh} />
        </div>
      </section>
    );
  }

  return (
    <section className="library" aria-label="书库">
      <div className="library__header">
        <h2 className="library__title">书库</h2>
        <LibraryToolbar
          filter={filter}
          sort={sort}
          onFilterChange={setFilter}
          onSortChange={setSort}
        />
      </div>
      <div className="library-grid">
        {view.map((item) => (
          <LibraryCard key={item.itemId} item={item} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}
