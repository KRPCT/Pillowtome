/**
 * 显示设置 (Aa) bottom sheet — UI-SPEC sections for mode/theme/font/sliders.
 * Live apply via onPrefsChange; no separate 应用 button (D-22).
 * Clean-room from UI-SPEC (T-02-agpl).
 */

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ReadingPrefs, ReadingTheme } from "./apply-reading-styles";

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
}: SettingsSheetProps) {
  const selectedFont =
    prefs.fontFamilyKey === "system" || !prefs.activeFontId
      ? "system"
      : prefs.activeFontId;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="reader-settings-sheet max-h-[70vh] gap-0 p-0"
        showCloseButton
      >
        <SheetHeader className="px-4 pt-4 pb-2">
          <SheetTitle className="text-lg font-semibold">显示设置</SheetTitle>
          <SheetDescription className="sr-only">
            调整阅读模式、主题与排版选项
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="max-h-[calc(70vh-4rem)] px-0">
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

            {/* 3. 字体 */}
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
                  <li key={f.id}>
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
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

export default SettingsSheet;
