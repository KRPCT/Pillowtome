import { useState } from "react";
import { BookOpen, FolderSearch, MoreHorizontal, Settings2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { scanFolderToLibrary } from "./FolderScanButton";

/**
 * 顶栏「⋯」溢出菜单（≤1000px 显示）：示例书 / 扫描文件夹 / 设置。
 * 中窄屏时顶栏放不下全部操作，次要项收进这里；≤640px 时它也是移动端
 * 打开示例书的唯一入口（顶栏「示例」按钮在窄屏隐藏）。
 * 菜单 = 真浮层（popover 定位），顶栏本体仍是正常文档流 flex。
 */
export interface TopbarOverflowMenuProps {
  onOpenSample: () => void;
  onOpenSettings: () => void;
  onStatus?: (msg: string | null) => void;
  onDone?: () => void;
}

export function TopbarOverflowMenu({
  onOpenSample,
  onOpenSettings,
  onStatus,
  onDone,
}: TopbarOverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);

  const item = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    disabled = false,
  ) => (
    <button
      type="button"
      className="app-overflow-menu__item"
      disabled={disabled}
      onClick={() => {
        setOpen(false);
        onClick();
      }}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="app-topbar__icon-btn app-topbar__overflow"
        aria-label="更多操作"
      >
        <MoreHorizontal size={18} aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        className="app-overflow-menu"
        align="end"
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {item("打开示例书", <BookOpen size={14} aria-hidden />, onOpenSample)}
        {item(
          scanning ? "扫描中…" : "扫描文件夹…",
          <FolderSearch size={14} aria-hidden />,
          () => {
            setScanning(true);
            void scanFolderToLibrary({ onStatus, onDone }).finally(() =>
              setScanning(false),
            );
          },
          scanning,
        )}
        {item("设置", <Settings2 size={14} aria-hidden />, onOpenSettings)}
      </PopoverContent>
    </Popover>
  );
}

export default TopbarOverflowMenu;
