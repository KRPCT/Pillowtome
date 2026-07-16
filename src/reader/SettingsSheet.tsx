/**
 * 显示设置 (Aa) bottom sheet — UI-SPEC sections for mode/theme/CJK/font/sliders.
 * Live apply via onPrefsChange; no separate 应用 button (D-22).
 * Clean-room from UI-SPEC (T-02-agpl / DEC-001).
 */

import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ReadingPrefs, ReadingTheme } from "./apply-reading-styles";

const CJK_ROWS: Array<{
  key: "cjkPunctTrim" | "cjkAutospace" | "cjkKinsoku";
  label: string;
  aboutLabel: string;
  body: string;
}> = [
  {
    key: "cjkPunctTrim",
    label: "标点挤压",
    aboutLabel: "关于标点挤压",
    body: "收窄中文标点旁多余空白，让「你好。」这类句子更紧凑、更像印刷书。",
  },
  {
    key: "cjkAutospace",
    label: "盘古之白",
    aboutLabel: "关于盘古之白",
    body: "在汉字与英文、数字之间自动留出细小间距，例如「读取 PDF」更易扫读。",
  },
  {
    key: "cjkKinsoku",
    label: "禁则",
    aboutLabel: "关于禁则",
    body: "避免行首出现句号、逗号，或行尾出现左引号、左括号等不合适的断行。",
  },
];

/** Minimal custom-font list item for 02-04 wiring. */
export interface CustomFontListItem {
  id: string;
  familyName: string;
}

export interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefs: ReadingPrefs;
  onPrefsChange: (next: Partial<ReadingPrefs> | ReadingPrefs) => void;
  /** When true, 阅读模式 toggle is disabled (FXL). */
  modeLocked?: boolean;
  fonts?: CustomFontListItem[];
  onImportFont?: () => void;
  onRemoveFont?: (id: string, familyName: string) => void;
  /** Inline caption under font list (import success / limit). */
  fontStatus?: string | null;
}

function formatLineHeight(v: number): string {
  // Avoid float noise: 1.75 stays "1.75", 1.2 stays "1.2"
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function SettingsSheet({
  open,
  onOpenChange,
  prefs,
  onPrefsChange,
  modeLocked = false,
  fonts = [],
  onImportFont,
  onRemoveFont,
  fontStatus = null,
}: SettingsSheetProps) {
  const selectedFont =
    prefs.fontFamilyKey === "system" || !prefs.activeFontId
      ? "system"
      : prefs.activeFontId;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="reader-settings-sheet reader-sheet flex max-h-[min(85vh,720px)] flex-col gap-0 p-0"
        showCloseButton
      >
        <SheetHeader className="reader-sheet__header shrink-0 px-4 pt-4 pb-2">
          <SheetTitle className="text-lg font-semibold">显示设置</SheetTitle>
          <SheetDescription className="sr-only">
            调整阅读模式、主题、中文排版与字体选项
          </SheetDescription>
        </SheetHeader>

        {/*
          Native overflow body (not only max-h on ScrollArea root).
          Radix ScrollArea viewport is height:100% — without a flex-constrained
          parent it grows with content and never scrolls on Android WebView.
        */}
        <div className="reader-sheet__body min-h-0 flex-1 overflow-y-auto overscroll-contain px-0 [-webkit-overflow-scrolling:touch] [touch-action:pan-y]">
          <div className="flex flex-col gap-8 px-4 pb-8">
            {/* 1. 阅读模式 */}
            <section className="reader-settings-section">
              <h3 className="reader-settings-section__title">阅读模式</h3>
              <ToggleGroup
                type="single"
                value={prefs.mode}
                onValueChange={(value) => {
                  if (!value || modeLocked) return;
                  if (value !== "paginate" && value !== "scroll") return;
                  onPrefsChange({ mode: value });
                }}
                variant="outline"
                spacing={0}
                disabled={modeLocked}
                aria-label="阅读模式"
                className="w-full"
              >
                <ToggleGroupItem value="paginate" aria-label="分页" className="flex-1">
                  分页
                </ToggleGroupItem>
                <ToggleGroupItem value="scroll" aria-label="滚动" className="flex-1">
                  滚动
                </ToggleGroupItem>
              </ToggleGroup>
              {modeLocked ? (
                <p className="reader-settings-section__hint">
                  固定版式书籍不支持切换阅读模式
                </p>
              ) : null}
            </section>

            {/* 2. 主题 */}
            <section className="reader-settings-section">
              <h3 className="reader-settings-section__title">主题</h3>
              <ToggleGroup
                type="single"
                value={prefs.theme}
                onValueChange={(value) => {
                  if (!value) return;
                  if (value !== "day" && value !== "night" && value !== "sepia") return;
                  onPrefsChange({ theme: value as ReadingTheme });
                }}
                variant="outline"
                spacing={0}
                aria-label="主题"
                className="w-full"
              >
                <ToggleGroupItem value="day" aria-label="日间" className="flex-1">
                  日间
                </ToggleGroupItem>
                <ToggleGroupItem value="night" aria-label="夜间" className="flex-1">
                  夜间
                </ToggleGroupItem>
                <ToggleGroupItem value="sepia" aria-label="Sepia" className="flex-1">
                  Sepia
                </ToggleGroupItem>
              </ToggleGroup>
            </section>

            {/* 3. 中文排版 (D-31..D-33) — after 主题, before 字体 */}
            <section className="reader-settings-section">
              <h3 className="reader-settings-section__title">中文排版</h3>
              <div className="flex flex-col gap-1">
                {CJK_ROWS.map((row) => (
                  <div key={row.key} className="reader-cjk-row">
                    <span className="reader-cjk-row__label">{row.label}</span>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="reader-cjk-row__info"
                          aria-label={row.aboutLabel}
                        >
                          <CircleHelp aria-hidden className="size-4" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        side="top"
                        className="reader-cjk-popover"
                      >
                        <PopoverHeader>
                          <PopoverTitle>{row.label}</PopoverTitle>
                        </PopoverHeader>
                        <p className="reader-cjk-popover__body">{row.body}</p>
                      </PopoverContent>
                    </Popover>
                    <div className="reader-cjk-row__switch">
                      <Switch
                        checked={prefs[row.key]}
                        onCheckedChange={(checked) =>
                          onPrefsChange({ [row.key]: checked })
                        }
                        aria-label={row.label}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 4. 字体 */}
            <section className="reader-settings-section">
              <h3 className="reader-settings-section__title">字体</h3>
              <ul className="reader-font-list" role="listbox" aria-label="字体">
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedFont === "system"}
                    className={
                      selectedFont === "system"
                        ? "reader-font-list__item reader-font-list__item--selected"
                        : "reader-font-list__item"
                    }
                    onClick={() =>
                      onPrefsChange({
                        fontFamilyKey: "system",
                        activeFontId: null,
                      })
                    }
                  >
                    系统默认
                  </button>
                </li>
                {fonts.map((f) => (
                  <li key={f.id} className="reader-font-list__row">
                    <button
                      type="button"
                      role="option"
                      aria-selected={selectedFont === f.id}
                      className={
                        selectedFont === f.id
                          ? "reader-font-list__item reader-font-list__item--selected"
                          : "reader-font-list__item"
                      }
                      onClick={() =>
                        onPrefsChange({
                          fontFamilyKey: f.id,
                          activeFontId: f.id,
                        })
                      }
                    >
                      {f.familyName}
                    </button>
                    {onRemoveFont ? (
                      <button
                        type="button"
                        className="reader-font-list__remove"
                        aria-label={`移除字体 ${f.familyName}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveFont(f.id, f.familyName);
                        }}
                      >
                        移除
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant="outline"
                className="mt-3 w-full"
                disabled={!onImportFont}
                onClick={() => onImportFont?.()}
              >
                导入字体
              </Button>
              <p className="reader-settings-section__hint">仅支持 TTF、OTF、WOFF</p>
              {fontStatus ? (
                <p className="reader-settings-section__hint" role="status">
                  {fontStatus}
                </p>
              ) : null}
            </section>

            <Separator />

            {/* 4. 字号 */}
            <section className="reader-settings-section">
              <div className="reader-settings-section__row">
                <h3 className="reader-settings-section__title reader-settings-section__title--inline">
                  字号
                </h3>
                <span className="reader-settings-section__value" aria-live="polite">
                  {Math.round(prefs.fontSizePx)}
                </span>
              </div>
              <Slider
                min={12}
                max={32}
                step={1}
                value={[prefs.fontSizePx]}
                onValueChange={(vals) => {
                  const v = vals[0];
                  if (typeof v === "number") onPrefsChange({ fontSizePx: v });
                }}
                aria-label="字号"
              />
            </section>

            {/* 5. 行距 */}
            <section className="reader-settings-section">
              <div className="reader-settings-section__row">
                <h3 className="reader-settings-section__title reader-settings-section__title--inline">
                  行距
                </h3>
                <span className="reader-settings-section__value" aria-live="polite">
                  {formatLineHeight(prefs.lineHeight)}
                </span>
              </div>
              <Slider
                min={1.2}
                max={2.4}
                step={0.05}
                value={[prefs.lineHeight]}
                onValueChange={(vals) => {
                  const v = vals[0];
                  if (typeof v === "number") onPrefsChange({ lineHeight: v });
                }}
                aria-label="行距"
              />
            </section>

            {/* 6. 边距 */}
            <section className="reader-settings-section">
              <div className="reader-settings-section__row">
                <h3 className="reader-settings-section__title reader-settings-section__title--inline">
                  边距
                </h3>
                <span className="reader-settings-section__value" aria-live="polite">
                  {Math.round(prefs.marginPx)}
                </span>
              </div>
              <Slider
                min={8}
                max={48}
                step={4}
                value={[prefs.marginPx]}
                onValueChange={(vals) => {
                  const v = vals[0];
                  if (typeof v === "number") onPrefsChange({ marginPx: v });
                }}
                aria-label="边距"
              />
            </section>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default SettingsSheet;
