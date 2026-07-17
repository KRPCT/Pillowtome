import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import { Trash2 } from "lucide-react";
import type { LibraryItem } from "./types";
import { readingStatus } from "./library-sort";
import { cleanBookTitle } from "./clean-title";
import { pillowCoverUrl } from "../lib/pillow";

export interface LibraryCardProps {
  item: LibraryItem;
  onOpen: (item: LibraryItem) => void;
  /** Long-press / right-click → manage (删除). Menu is hidden when omitted. */
  onDelete?: (item: LibraryItem) => void;
  /** Strip the source-site tail from the displayed title (display-only). */
  cleanTitles?: boolean;
}

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 10;

export function LibraryCard({ item, onOpen, onDelete, cleanTitles }: LibraryCardProps) {
  const status = readingStatus(item.progressFraction);
  const progress = item.progressFraction;
  const showBar = status !== "unread" && progress != null;
  const title = cleanTitles ? cleanBookTitle(item.title) : item.title;
  const initial = (title?.trim()?.[0] || "书").slice(0, 1);

  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);

  const clearTimer = () => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const openMenu = (top: number, left: number) => {
    if (!onDelete) return;
    setMenuPos({ top, left });
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!onDelete) return;
    start.current = { x: e.clientX, y: e.clientY };
    suppressClick.current = false;
    clearTimer();
    timer.current = window.setTimeout(() => {
      suppressClick.current = true; // long-press fired — swallow the ensuing click
      openMenu(e.clientY, e.clientX);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!start.current) return;
    const dx = Math.abs(e.clientX - start.current.x);
    const dy = Math.abs(e.clientY - start.current.y);
    if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) clearTimer(); // became a scroll
  };

  return (
    <>
      <button
        type="button"
        className="library-card"
        style={{ userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          onOpen(item);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={clearTimer}
        onPointerLeave={clearTimer}
        onPointerCancel={clearTimer}
        onContextMenu={(e) => {
          if (!onDelete) return;
          e.preventDefault();
          openMenu(e.clientY, e.clientX);
        }}
        aria-label={`打开 ${title}`}
      >
        <div className="library-card__cover" aria-hidden>
          {/* Placeholder sits behind; the cover <img> covers it once loaded, and
              falls back to the placeholder if the cover file is missing/broken. */}
          <div className="library-card__placeholder">
            <span>{initial}</span>
          </div>
          {item.coverFile ? (
            <img
              className="library-card__cover-img"
              src={pillowCoverUrl(item.coverFile)}
              alt=""
              loading="lazy"
              decoding="async"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : null}
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
          <div className="library-card__title">{title}</div>
          {item.author ? (
            <div className="library-card__author">{item.author}</div>
          ) : null}
        </div>
      </button>

      {onDelete ? (
        <Menu
          open={menuPos !== null}
          onClose={() => setMenuPos(null)}
          anchorReference="anchorPosition"
          anchorPosition={menuPos ?? undefined}
        >
          <MenuItem
            onClick={() => {
              setMenuPos(null);
              onDelete(item);
            }}
          >
            <ListItemIcon>
              <Trash2 size={18} />
            </ListItemIcon>
            <ListItemText>删除</ListItemText>
          </MenuItem>
        </Menu>
      ) : null}
    </>
  );
}
