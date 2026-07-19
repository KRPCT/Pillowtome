import {
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  Highlighter,
  List,
  Search,
  Type,
} from "lucide-react";

/**
 * 阅读顶栏（mockup §03 .reader-chrome-top）：
 * 左「‹ 书库」· 中央绝对居中 serif 书名·作者 · 右侧幽灵 chrome 按钮组
 * （目录 / 搜索 / 书签 / 批注 / Aa 朱砂高亮）。底缘 1px 发丝线（无阴影）。
 * 沉浸机制不变：始终挂载，chromeVisible 只切 data-visible（不 reflow .reader__view）。
 */
export interface ReaderChromeProps {
  title?: string;
  /** 作者 — 与书名组成「书名 · 作者」中央标题。 */
  author?: string;
  chromeVisible?: boolean;
  /** True when a bookmark exists at/near the current reading position. */
  bookmarked?: boolean;
  onBack?: () => void;
  onOpenToc?: () => void;
  onOpenSearch?: () => void;
  onOpenSettings?: () => void;
  onOpenAnnotations?: () => void;
  onToggleBookmark?: () => void;
}

export function ReaderChrome({
  title = "",
  author = "",
  chromeVisible = true,
  bookmarked = false,
  onBack,
  onOpenToc,
  onOpenSearch,
  onOpenSettings,
  onOpenAnnotations,
  onToggleBookmark,
}: ReaderChromeProps) {
  const fullTitle = author ? `${title} · ${author}` : title;

  // Always mounted so show/hide can fade+slide (chromeVisible toggles a data attr).
  return (
    <div className="reader__chrome" data-visible={chromeVisible}>
      <header className="reader__toolbar">
        <div className="reader__toolbar-left">
          <button
            type="button"
            className="reader__chrome-btn reader__chrome-btn--back"
            aria-label="返回书库"
            title="返回书库"
            onClick={onBack}
          >
            <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
            <span className="reader__chrome-btn-label">书库</span>
          </button>
        </div>

        <span className="reader__chrome-title" title={fullTitle}>
          {fullTitle}
        </span>

        <div className="reader__toolbar-right">
          <button
            type="button"
            className="reader__chrome-btn"
            aria-label="目录"
            title="目录"
            onClick={onOpenToc}
          >
            <List size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="reader__chrome-btn"
            aria-label="搜索"
            title="搜索"
            onClick={onOpenSearch}
          >
            <Search size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="reader__chrome-btn"
            data-active={bookmarked || undefined}
            aria-label={bookmarked ? "移除书签" : "添加书签"}
            aria-pressed={bookmarked}
            title={bookmarked ? "移除书签" : "添加书签"}
            onClick={onToggleBookmark}
          >
            {bookmarked ? (
              <BookmarkCheck size={20} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Bookmark size={20} strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="reader__chrome-btn"
            aria-label="批注"
            title="批注"
            onClick={onOpenAnnotations}
          >
            <Highlighter size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="reader__chrome-btn reader__chrome-btn--aa"
            aria-label="排版设置"
            title="排版设置"
            onClick={onOpenSettings}
          >
            <Type size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </header>
    </div>
  );
}

export default ReaderChrome;
