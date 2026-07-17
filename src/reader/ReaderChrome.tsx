import { ChevronLeft, List, Search, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "./ProgressBar";

/**
 * 48px reader toolbar + 2px progress bar (UI-SPEC shell).
 * Immersive prep: when chromeVisible is false, toolbar+bar are not rendered.
 */
export interface ReaderChromeProps {
  title?: string;
  /** Reading fraction 0..1; when null/undefined, percent caption is omitted. */
  fraction?: number | null;
  chromeVisible?: boolean;
  onBack?: () => void;
  onOpenToc?: () => void;
  onOpenSearch?: () => void;
  onOpenSettings?: () => void;
}

export function ReaderChrome({
  title = "",
  fraction = null,
  chromeVisible = true,
  onBack,
  onOpenToc,
  onOpenSearch,
  onOpenSettings,
}: ReaderChromeProps) {
  // Always mounted so show/hide can fade+slide (chromeVisible toggles a data attr).
  return (
    <div className="reader__chrome" data-visible={chromeVisible}>
      <header className="reader__toolbar">
        <div className="reader__toolbar-left">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="reader__icon-btn"
            aria-label="返回"
            title="返回"
            onClick={onBack}
          >
            <ChevronLeft />
          </Button>
          <span className="reader__title" title={title}>
            {title}
          </span>
        </div>

        <div className="reader__toolbar-right">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="reader__icon-btn"
            aria-label="目录"
            title="目录"
            onClick={onOpenToc}
          >
            <List />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="reader__icon-btn"
            aria-label="搜索"
            title="搜索"
            onClick={onOpenSearch}
          >
            <Search />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="reader__icon-btn"
            aria-label="显示设置"
            title="显示设置"
            onClick={onOpenSettings}
          >
            <Type />
          </Button>
        </div>
      </header>
      <ProgressBar fraction={fraction ?? 0} />
    </div>
  );
}

export default ReaderChrome;
