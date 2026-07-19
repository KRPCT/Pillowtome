import type { FilterKey, SortKey } from "./library-sort";

/**
 * 过滤/排序工具栏（mockup §02 .lib-toolbar）：
 * 状态 chips（全部/在读/未读/读毕 + 实时计数）→ 1px 竖分隔 → 排序 chips
 * （accent 款，选中朱砂底）。chip 规格：圆角 999px、1px --line 边、12px 字。
 */

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "reading", label: "在读" },
  { key: "unread", label: "未读" },
  { key: "finished", label: "读毕" },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "最近阅读" },
  { key: "title", label: "书名" },
  { key: "author", label: "作者" },
  { key: "progress", label: "阅读进度" },
];

export interface LibraryToolbarProps {
  filter: FilterKey;
  sort: SortKey;
  /** 各状态实时计数（基于完整书架）。 */
  counts: Record<FilterKey, number>;
  onFilterChange: (f: FilterKey) => void;
  onSortChange: (s: SortKey) => void;
}

export function LibraryToolbar({
  filter,
  sort,
  counts,
  onFilterChange,
  onSortChange,
}: LibraryToolbarProps) {
  return (
    <div className="lib-toolbar">
      <div className="lib-toolbar__group" role="toolbar" aria-label="筛选">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={filter === f.key ? "chip on" : "chip"}
            aria-pressed={filter === f.key}
            onClick={() => onFilterChange(f.key)}
          >
            {f.label} {counts[f.key]}
          </button>
        ))}
      </div>
      <span className="lib-toolbar__divider" aria-hidden />
      <div className="lib-toolbar__group" role="toolbar" aria-label="排序">
        {SORTS.map((s) => (
          <button
            key={s.key}
            type="button"
            className={
              sort === s.key ? "chip chip-accent on" : "chip chip-accent"
            }
            aria-pressed={sort === s.key}
            onClick={() => onSortChange(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
