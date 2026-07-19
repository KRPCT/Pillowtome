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

/**
 * 无封面书籍的代码绘制底色（mockup §02 雅色数组）：按 workId 哈希取色，
 * 前景色随底色深浅配对 —— 保证无封面书籍也不出现「灰砖」。
 */
const COVER_PALETTE: ReadonlyArray<readonly [bg: string, fg: string]> = [
  ["#8e3b32", "#f4e6d4"],
  ["#2e2a24", "#e8ddc6"],
  ["#b0a488", "#2a251c"],
  ["#4f7a63", "#eef0e4"],
  ["#3e5c8a", "#e9e4d6"],
  ["#d9a441", "#3a2c14"],
  ["#ece4d2", "#33301f"],
  ["#6a4a3a", "#efe2cc"],
];

export function coverColorFor(workId: string): readonly [string, string] {
  let hash = 0;
  for (let i = 0; i < workId.length; i += 1) {
    // djb2 — stable across sessions for the same workId.
    hash = (hash * 33 + workId.charCodeAt(i)) >>> 0;
  }
  return COVER_PALETTE[hash % COVER_PALETTE.length];
}

/** 书架时间标签（mockup §02 prog-lbl 右列：3 小时前 / 昨天 / 上周…）。 */
function formatShelfTime(ts: number | null, now: number): string {
  if (ts == null) return "—";
  const diff = Math.max(0, now - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  if (hours < 48) return "昨天";
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  if (days < 14) return "上周";
  return `${Math.floor(days / 7)} 周前`;
}

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
  const title = cleanTitles ? cleanBookTitle(item.title) : item.title;

  const isPlaceholder = syncState !== "local";
  const tapDisabled = syncState === "downloading" || syncState === "unsynced";
  const syncMenuItem = item.fileLocal !== false && onToggleFileSync ? true : false;
  const hasMenu = Boolean(onDelete) || syncMenuItem;

  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  /** 真实封面加载失败 → 回退到代码绘制封面（雅色哈希 + 竖排书名）。 */
  const [coverBroken, setCoverBroken] = useState(false);
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

  const progressPercent =
    progress != null ? Math.round(Math.min(1, Math.max(0, progress)) * 100) : 0;

  // prog-lbl 左列（mockup §02）：下载中 % / 读毕 / 未读 / 阅读百分比。
  const progressLabel =
    syncState === "downloading"
      ? `下载中 ${shownDownloadPercent}%`
      : status === "finished"
        ? "读毕"
        : status === "unread"
          ? "未读"
          : `${progressPercent}%`;
  const barPercent =
    syncState === "downloading"
      ? shownDownloadPercent
      : status === "unread"
        ? 0
        : progressPercent;
  const timeLabel =
    status === "unread" && syncState === "local"
      ? "—"
      : formatShelfTime(item.lastReadAt ?? item.lastOpenedAt ?? item.importedAt, Date.now());

  const [coverBg, coverFg] = coverColorFor(item.workId);
  const drawn = !item.coverFile || coverBroken;

  return (
    <>
      <button
        type="button"
        className={`book${syncState === "unsynced" ? " book--unsynced" : ""}`}
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
        <div
          className="cover"
          aria-hidden
          style={drawn ? { background: coverBg, color: coverFg } : undefined}
        >
          {/* 有真实封面则显示；无封面代码绘制 —— 左竖排作者、右竖排书名、
              右下角朱砂印章「枕」。Cover bytes never travel the state plane
              (D-100) — a placeholder card shows the drawn cover until
              downloaded + re-parsed. */}
          {!drawn && item.coverFile ? (
            <img
              className="cover__img"
              src={pillowCoverUrl(item.coverFile)}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setCoverBroken(true)}
            />
          ) : null}
          {drawn ? (
            <>
              <span className="v-author">
                {item.author ? `${item.author} 著` : ""}
              </span>
              <span className="v-title">{title}</span>
              <span className="seal">枕</span>
            </>
          ) : null}
          {/* One badge slot, never both: the cloud badge replaces 已读 on
              placeholder cards (UI-SPEC §3). */}
          {isPlaceholder ? (
            <span className="book__badge book__badge--cloud">
              {syncState === "unsynced" ? (
                <>
                  <CloudOff size={12} aria-hidden /> 未同步
                </>
              ) : (
                <CloudDownload size={12} aria-hidden />
              )}
            </span>
          ) : status === "finished" ? (
            <span className="book__badge">已读</span>
          ) : null}
        </div>
        <div className="book-name">{title}</div>
        {item.author ? <div className="book-author">{item.author}</div> : null}
        {/* 进度/批注对所有书生效、不受文件平面限制 (D-102)；下载中显示下载进度。 */}
        <div className="prog" aria-hidden>
          <i style={{ width: `${barPercent}%` }} />
        </div>
        <div className="prog-lbl">
          <span>{progressLabel}</span>
          <span>{timeLabel}</span>
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
