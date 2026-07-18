import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import { Check, CloudDownload, CloudOff, CloudUpload, Trash2 } from "lucide-react";
import type { LibraryItem } from "./types";
import type { SyncCardState } from "./sync-card-state";
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
  /** Phase 7 placeholder state (default "local" — the existing card). */
  syncState?: SyncCardState;
  /** Live download percent while syncState === "downloading". */
  downloadPercent?: number | null;
  /** An upload for this book is in flight (menu caption 正在上传…). */
  uploading?: boolean;
  /** 可下载/失败 tap → start (or retry) the download — never opens immediately. */
  onDownload?: (item: LibraryItem) => void;
  /** 同步此书 toggle — the per-book file-sync opt-in (D-98). */
  onToggleFileSync?: (item: LibraryItem, enabled: boolean) => void;
  /** Status/toast channel (ImportButton pattern), threaded from App. */
  onStatus?: (msg: string | null) => void;
}

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 10;

export function LibraryCard({
  item,
  onOpen,
  onDelete,
  cleanTitles,
  syncState = "local",
  downloadPercent = null,
  uploading = false,
  onDownload,
  onToggleFileSync,
  onStatus,
}: LibraryCardProps) {
  const status = readingStatus(item.progressFraction);
  const progress = item.progressFraction;
  const showBar = status !== "unread" && progress != null;
  const title = cleanTitles ? cleanBookTitle(item.title) : item.title;
  const initial = (title?.trim()?.[0] || "书").slice(0, 1);

  const isPlaceholder = syncState !== "local";
  const tapDisabled = syncState === "downloading" || syncState === "unsynced";
  const syncMenuItem = item.fileLocal !== false && onToggleFileSync ? true : false;
  const hasMenu = Boolean(onDelete) || syncMenuItem;

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
    if (!hasMenu) return;
    setMenuPos({ top, left });
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!hasMenu) return;
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

  const handleTap = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (syncState === "downloading") return; // research Q3: 禁用打开
    if (syncState === "unsynced") {
      onStatus?.("该书未开启文件同步，进度与批注仍会同步");
      return;
    }
    if (syncState === "downloadable" || syncState === "failed") {
      onDownload?.(item); // 后台下载，不立即开书
      return;
    }
    onOpen(item);
  };

  const ariaLabel =
    syncState === "unsynced"
      ? `${title}，未同步`
      : syncState === "downloadable" || syncState === "failed"
        ? "下载此书"
        : `打开 ${title}`;

  const shownDownloadPercent =
    downloadPercent != null ? Math.round(Math.min(100, Math.max(0, downloadPercent))) : 0;

  return (
    <>
      <button
        type="button"
        className={`library-card${syncState === "unsynced" ? " library-card--unsynced" : ""}`}
        style={{ userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
        onClick={handleTap}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={clearTimer}
        onPointerLeave={clearTimer}
        onPointerCancel={clearTimer}
        onContextMenu={(e) => {
          if (!hasMenu) return;
          e.preventDefault();
          openMenu(e.clientY, e.clientX);
        }}
        aria-label={ariaLabel}
        aria-disabled={tapDisabled || undefined}
      >
        <div className="library-card__cover" aria-hidden>
          {/* Placeholder sits behind; the cover <img> covers it once loaded, and
              falls back to the placeholder if the cover file is missing/broken.
              Cover bytes never travel the state plane (D-100) — a placeholder
              card always shows the initial until downloaded + re-parsed. */}
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
          {/* One badge slot, never both: the cloud badge replaces 已读 on
              placeholder cards (UI-SPEC §3). */}
          {isPlaceholder ? (
            <span className="library-card__badge library-card__badge--cloud">
              {syncState === "unsynced" ? (
                <>
                  <CloudOff size={12} aria-hidden /> 未同步
                </>
              ) : (
                <CloudDownload size={12} aria-hidden />
              )}
            </span>
          ) : status === "finished" ? (
            <span className="library-card__badge">已读</span>
          ) : null}
          {syncState === "downloading" ? (
            <div className="library-card__progress" aria-hidden>
              <div
                className="library-card__progress-fill"
                style={{ width: `${shownDownloadPercent}%` }}
              />
            </div>
          ) : showBar ? (
            // 进度/批注对所有书生效、不受文件平面限制 (D-102).
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
          {syncState === "downloading" ? (
            <div className="library-card__sync-caption">下载中 {shownDownloadPercent}%</div>
          ) : null}
        </div>
      </button>

      {hasMenu ? (
        <Menu
          open={menuPos !== null}
          onClose={() => setMenuPos(null)}
          anchorReference="anchorPosition"
          anchorPosition={menuPos ?? undefined}
        >
          {/* 同步此书 (D-98): hidden on placeholder cards — 开关属于持有文件的一端. */}
          {syncMenuItem ? (
            <MenuItem
              disabled={uploading}
              onClick={() => {
                setMenuPos(null);
                if (uploading) return;
                onToggleFileSync?.(item, !item.fileSyncEnabled);
              }}
            >
              <ListItemIcon>
                {item.fileSyncEnabled ? (
                  <Check size={18} />
                ) : (
                  <CloudUpload size={18} />
                )}
              </ListItemIcon>
              <ListItemText>{uploading ? "正在上传…" : "同步此书"}</ListItemText>
            </MenuItem>
          ) : null}
          {onDelete ? (
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
          ) : null}
        </Menu>
      ) : null}
    </>
  );
}
