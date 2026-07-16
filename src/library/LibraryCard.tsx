import type { LibraryItem } from "./types";
import { readingStatus } from "./library-sort";

export interface LibraryCardProps {
  item: LibraryItem;
  onOpen: (item: LibraryItem) => void;
}

export function LibraryCard({ item, onOpen }: LibraryCardProps) {
  const status = readingStatus(item.progressFraction);
  const progress = item.progressFraction;
  const showBar = status !== "unread" && progress != null;
  const initial = (item.title?.trim()?.[0] || "书").slice(0, 1);

  return (
    <button
      type="button"
      className="library-card"
      onClick={() => onOpen(item)}
      aria-label={`打开 ${item.title}`}
    >
      <div className="library-card__cover" aria-hidden>
        {item.coverFile ? (
          // Cover served later via protocol; placeholder until pillow cover URL exists
          <div className="library-card__placeholder library-card__placeholder--has-file">
            <span>{initial}</span>
          </div>
        ) : (
          <div className="library-card__placeholder">
            <span>{initial}</span>
          </div>
        )}
        {status === "finished" ? (
          <span className="library-card__badge">已读</span>
        ) : null}
        {showBar ? (
          <div className="library-card__progress" aria-hidden>
            <div
              className="library-card__progress-fill"
              style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }}
            />
          </div>
        ) : null}
      </div>
      <div className="library-card__meta">
        <div className="library-card__title">{item.title}</div>
        {item.author ? (
          <div className="library-card__author">{item.author}</div>
        ) : null}
      </div>
    </button>
  );
}
