import type { FilterKey, SortKey } from "./library-sort";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "reading", label: "在读" },
  { key: "unread", label: "未读" },
  { key: "finished", label: "已读完" },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "最近阅读" },
  { key: "title", label: "标题" },
  { key: "author", label: "作者" },
  { key: "progress", label: "进度" },
];

export interface LibraryToolbarProps {
  filter: FilterKey;
  sort: SortKey;
  onFilterChange: (f: FilterKey) => void;
  onSortChange: (s: SortKey) => void;
}

export function LibraryToolbar({
  filter,
  sort,
  onFilterChange,
  onSortChange,
}: LibraryToolbarProps) {
  return (
    <div className="library-toolbar">
      <div className="library-toolbar__chips" role="toolbar" aria-label="筛选">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={
              filter === f.key
                ? "library-chip library-chip--active"
                : "library-chip"
            }
            aria-pressed={filter === f.key}
            onClick={() => onFilterChange(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <label className="library-toolbar__sort">
        <span className="sr-only">排序</span>
        <select
          value={sort}
          aria-label="排序"
          onChange={(e) => onSortChange(e.target.value as SortKey)}
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
