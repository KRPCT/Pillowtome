/**
 * 显示设置 (Aa) — mockup §04 .aa-sheet：纸底、发丝线、朱砂选中态。
 * 桌面 ≥768px 为右侧栏（border-left 发丝线），手机为底部 sheet（MD3 圆角/拖手）。
 * Live apply via onPrefsChange; no separate 应用 button (D-22)。
 * 滚动容器保持 .reader-sheet__body 原生 overflow-y-auto（CLAUDE.md touch 门规 #3）。
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  PAGE_COLORS,
  type ReadingPrefs,
  type ReadingTheme,
} from "./apply-reading-styles";
import {
  FONT_KEY_NOTO_SANS,
  FONT_KEY_NOTO_SERIF,
  FONT_KEY_SYSTEM,
  fontFamilyCssFor,
} from "./fonts";
import { convertText } from "./cjk-convert-shim";

const PREVIEW_HAN = /[㐀-鿿豈-﫿]/;

/** Render preview text with each multi-char CJK word in a nowrap span so the
 *  live preview reflects 词不拆行 (words never split across the preview's lines). */
function wrapPreviewWords(text: string): ReactNode {
  const Seg = (
    Intl as unknown as {
      Segmenter?: new (
        l: string,
        o: { granularity: string },
      ) => { segment(s: string): Iterable<{ segment: string }> };
    }
  ).Segmenter;
  if (typeof Seg !== "function") return text;
  try {
    const seg = new Seg("zh", { granularity: "word" });
    return [...seg.segment(text)].map((s, i) =>
      s.segment.length >= 2 && PREVIEW_HAN.test(s.segment) ? (
        <span key={i} style={{ whiteSpace: "nowrap" }}>
          {s.segment}
        </span>
      ) : (
        <span key={i}>{s.segment}</span>
      ),
    );
  } catch {
    return text;
  }
}

const LAYOUT_PRESETS: Array<{
  key: string;
  label: string;
  lineHeight: number;
  marginPx: number;
}> = [
  { key: "compact", label: "紧凑", lineHeight: 1.5, marginPx: 16 },
  { key: "cozy", label: "适中", lineHeight: 1.75, marginPx: 24 },
  { key: "airy", label: "舒朗", lineHeight: 2.0, marginPx: 36 },
];

const THEME_SWATCHES: Array<{ key: ReadingTheme; label: string }> = [
  { key: "day", label: "日间" },
  { key: "sepia", label: "宣纸" },
  { key: "night", label: "夜间" },
];

/** 内置字体（本地 bundled 可变字重，不走网络/子集）。 */
const BUILTIN_FONTS: Array<{ key: string; label: string }> = [
  { key: FONT_KEY_NOTO_SERIF, label: "思源宋体" },
  { key: FONT_KEY_NOTO_SANS, label: "思源黑体" },
  { key: FONT_KEY_SYSTEM, label: "系统默认" },
];

const CJK_PREVIEW =
  "如果按照奥日埃的说法，货币「来到世间，在一边脸上带着天生的血斑」，那末 ，资本来到世间，从头到脚，每个毛孔都滴着血和肮脏的东西。";

const CJK_ROWS: Array<{
  key: "cjkPunctTrim" | "cjkAutospace" | "cjkKinsoku";
  label: string;
  body: string;
}> = [
  {
    key: "cjkPunctTrim",
    label: "标点挤压",
    body: "text-spacing-trim：收窄中文标点旁多余空白，让「你好。」这类句子更紧凑、更像印刷书。",
  },
  {
    key: "cjkAutospace",
    label: "中英自动空格",
    body: "盘古之白（text-autospace）：在汉字与英文、数字之间自动留出细小间距，例如「读取 PDF」更易扫读。",
  },
  {
    key: "cjkKinsoku",
    label: "标点禁则",
    body: "kinsoku：避免行首出现句号、逗号，或行尾出现左引号、左括号等不合适的断行。",
  },
];

export interface CustomFontListItem {
  id: string;
  familyName: string;
}

export interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefs: ReadingPrefs;
  onPrefsChange: (next: Partial<ReadingPrefs> | ReadingPrefs) => void;
  modeLocked?: boolean;
  fonts?: CustomFontListItem[];
  onImportFont?: () => void;
  onRemoveFont?: (id: string, familyName: string) => void;
  fontStatus?: string | null;
  /** Show library-only options (e.g. 书名清洗) — set from the library shell. */
  showLibraryPrefs?: boolean;
  /** Optional 同步 section (Phase 7) — rendered after the 书库 block. */
  syncSection?: ReactNode;
  /** Reader theme — flips the sheet to 墨壳 at night (library 恒为纸面 day)。 */
  theme?: ReadingTheme;
}

function formatLineHeight(v: number): string {
  return Number.isInteger(v)
    ? String(v)
    : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(min-width: 768px)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => setIsDesktop(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

/** 分组小标题（mockup §04 h5：10.5px 大写加宽字距 --ink-3；accent = 朱砂） */
function AaSection({
  title,
  accent = false,
  children,
}: {
  title: string;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="reader-aa-section">
      <h5
        className={
          accent
            ? "reader-aa-section__title reader-aa-section__title--accent"
            : "reader-aa-section__title"
        }
      >
        {title}
      </h5>
      {children}
    </section>
  );
}

/** 「?」信息圈（mockup .info）— 点击切换 popover（触摸上 hover 不可靠）。 */
function HelpDot({
  label,
  body,
  theme,
}: {
  label: string;
  body: string;
  theme: ReadingTheme;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="reader-aa-info" aria-label={`关于${label}`}>
        ?
      </PopoverTrigger>
      <PopoverContent
        className="reader-cjk-popover"
        data-theme={theme}
        side="left"
        align="center"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <p className="reader-cjk-popover__body">{body}</p>
      </PopoverContent>
    </Popover>
  );
}

/** 朱砂开关（mockup .sw 36×21）：原生 button role=switch，触摸/键盘可达。 */
function AaSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="reader-aa-sw"
      data-on={checked || undefined}
      onClick={() => onChange(!checked)}
    />
  );
}

function SwitchRow({
  label,
  body,
  checked,
  onChange,
  theme,
}: {
  label: string;
  body?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  theme: ReadingTheme;
}) {
  return (
    <div className="reader-aa-switch-row">
      <span className="reader-aa-switch-row__label">
        {label}
        {body ? <HelpDot label={label} body={body} theme={theme} /> : null}
      </span>
      <AaSwitch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

/** 分段控件（mockup .seg：9px 圆角、选中墨底纸字） */
function Seg<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="reader-seg" role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={
            opt.value === value
              ? "reader-seg__btn reader-seg__btn--on"
              : "reader-seg__btn"
          }
          aria-pressed={opt.value === value}
          disabled={disabled}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/**
 * 滑条（mockup .aa-slider）：3px --line 轨道 + 朱砂填充 + 13px 纸心朱砂描边
 * thumb；原生 input[type=range] 透明覆盖，键盘/触摸/a11y 全保留。
 */
function AaSlider({
  label,
  value,
  min,
  max,
  step,
  capLeft,
  capRight,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  capLeft?: ReactNode;
  capRight?: ReactNode;
  onChange: (next: number) => void;
}) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div className="reader-aa-slider">
      {capLeft != null ? (
        <span className="reader-aa-slider__cap" aria-hidden="true">
          {capLeft}
        </span>
      ) : null}
      <div className="reader-aa-slider__wrap">
        <div className="reader-aa-slider__track" aria-hidden="true" />
        <div
          className="reader-aa-slider__fill"
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        />
        <div
          className="reader-aa-slider__thumb"
          style={{ left: `${pct}%` }}
          aria-hidden="true"
        />
        <input
          type="range"
          className="reader-aa-slider__input"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
      {capRight != null ? (
        <span className="reader-aa-slider__cap" aria-hidden="true">
          {capRight}
        </span>
      ) : null}
    </div>
  );
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
  showLibraryPrefs = false,
  syncSection = null,
  theme = "day",
}: SettingsSheetProps) {
  const isDesktop = useIsDesktop();
  // 内置键直接命中；自定义字体以 activeFontId 命中。
  const builtinHit = BUILTIN_FONTS.some((f) => f.key === prefs.fontFamilyKey);
  const selectedFont = builtinHit
    ? prefs.fontFamilyKey
    : prefs.activeFontId || FONT_KEY_SYSTEM;

  const pageColors = PAGE_COLORS[prefs.theme];
  const previewStyle = {
    fontFamily: fontFamilyCssFor(prefs.fontFamilyKey, prefs.activeFontId),
    fontSize: `${prefs.fontSizePx}px`,
    lineHeight: prefs.lineHeight,
    textIndent: "2em",
    margin: 0,
    lineBreak: prefs.cjkKinsoku ? "strict" : "auto",
    textSpacingTrim: prefs.cjkPunctTrim ? "normal" : "space-all",
    textAutospace: prefs.cjkAutospace ? "normal" : "no-autospace",
  } as unknown as CSSProperties;

  // Preview reflects every setting below it: 简繁转换 (text), 词不拆行 (nowrap
  // word spans), plus 标点挤压/盘古之白/禁则/字号/行距 via previewStyle.
  const previewText = convertText(CJK_PREVIEW, prefs.cnConvert);
  const previewContent = prefs.wordKeep
    ? wrapPreviewWords(previewText)
    : previewText;

  const activePreset = LAYOUT_PRESETS.find(
    (p) => p.lineHeight === prefs.lineHeight && p.marginPx === prefs.marginPx,
  )?.key;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        data-theme={theme}
        className={
          isDesktop
            ? "reader-settings-sheet reader-settings-sheet--side reader-sheet flex h-full w-[min(340px,90vw)] flex-col gap-0 p-0 sm:max-w-sm"
            : "reader-settings-sheet reader-settings-sheet--bottom reader-sheet flex max-h-[min(88vh,760px)] flex-col gap-0 p-0"
        }
        showCloseButton
      >
        <SheetHeader className="reader-sheet__header shrink-0 px-5 pt-5 pb-1">
          <SheetTitle className="reader-toc-sheet__title">显示设置</SheetTitle>
          <SheetDescription className="sr-only">
            调整主题、字体、字号行距与中文排版选项
          </SheetDescription>
        </SheetHeader>

        <div className="reader-sheet__body reader-aa-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8 [-webkit-overflow-scrolling:touch] [touch-action:pan-y]">
          {/* Live CJK preview */}
          <div className="reader-aa-preview" aria-hidden>
            <div
              style={{
                ...previewStyle,
                background: pageColors.background,
                color: pageColors.foreground,
              }}
              className="reader-aa-preview__page"
            >
              {previewContent}
            </div>
          </div>

          <AaSection title="主题">
            <div className="reader-theme-pick">
              {THEME_SWATCHES.map((t) => {
                const c = PAGE_COLORS[t.key];
                const selected = prefs.theme === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    className={
                      selected
                        ? "reader-theme-pick__item reader-theme-pick__item--on"
                        : "reader-theme-pick__item"
                    }
                    style={{ background: c.background, color: c.foreground }}
                    aria-pressed={selected}
                    aria-label={`主题：${t.label}`}
                    onClick={() => onPrefsChange({ theme: t.key })}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </AaSection>

          <AaSection title="字体">
            <div className="reader-font-list">
              {BUILTIN_FONTS.map((f) => {
                const selected = selectedFont === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    className={
                      selected
                        ? "reader-font-list__item reader-font-list__item--on"
                        : "reader-font-list__item"
                    }
                    onClick={() =>
                      onPrefsChange({ fontFamilyKey: f.key, activeFontId: null })
                    }
                  >
                    <span>{f.label}</span>
                    <span className="reader-font-list__check" aria-hidden="true">
                      ✓
                    </span>
                  </button>
                );
              })}
              {fonts.map((f) => {
                const selected = selectedFont === f.id;
                return (
                  <div key={f.id} className="reader-font-list__row">
                    <button
                      type="button"
                      className={
                        selected
                          ? "reader-font-list__item reader-font-list__item--on"
                          : "reader-font-list__item"
                      }
                      onClick={() =>
                        onPrefsChange({
                          fontFamilyKey: f.id,
                          activeFontId: f.id,
                        })
                      }
                    >
                      <span>{f.familyName}</span>
                      <span
                        className="reader-font-list__check"
                        aria-hidden="true"
                      >
                        ✓
                      </span>
                    </button>
                    {onRemoveFont ? (
                      <button
                        type="button"
                        className="reader-font-list__remove"
                        aria-label={`移除字体 ${f.familyName}`}
                        onClick={() => onRemoveFont(f.id, f.familyName)}
                      >
                        移除
                      </button>
                    ) : null}
                  </div>
                );
              })}
              <button
                type="button"
                className="reader-font-list__item reader-font-list__item--import"
                disabled={!onImportFont}
                onClick={() => onImportFont?.()}
              >
                ＋ 导入自定义字体…
              </button>
            </div>
            <p className="reader-aa-hint">仅支持 TTF、OTF、WOFF</p>
            {fontStatus ? (
              <p className="reader-aa-hint" role="status">
                {fontStatus}
              </p>
            ) : null}
          </AaSection>

          <AaSection title="字号">
            <AaSlider
              label="字号"
              value={prefs.fontSizePx}
              min={12}
              max={32}
              step={1}
              capLeft={<span style={{ fontSize: 13 }}>A</span>}
              capRight={<span style={{ fontSize: 18 }}>A</span>}
              onChange={(v) => onPrefsChange({ fontSizePx: v })}
            />
          </AaSection>

          <AaSection title="行距">
            <AaSlider
              label="行距"
              value={prefs.lineHeight}
              min={1.2}
              max={2.4}
              step={0.05}
              capRight={
                <span className="reader-aa-slider__cap--num">
                  {formatLineHeight(prefs.lineHeight)}
                </span>
              }
              onChange={(v) => onPrefsChange({ lineHeight: v })}
            />
          </AaSection>

          <AaSection title="边距">
            <AaSlider
              label="边距"
              value={prefs.marginPx}
              min={8}
              max={48}
              step={4}
              capRight={
                <span className="reader-aa-slider__cap--num">
                  {Math.round(prefs.marginPx)}
                </span>
              }
              onChange={(v) => onPrefsChange({ marginPx: v })}
            />
          </AaSection>

          <AaSection title="版式">
            <Seg
              value={prefs.mode}
              ariaLabel="阅读模式"
              disabled={modeLocked}
              options={[
                { value: "paginate", label: "分页" },
                { value: "scroll", label: "滚动" },
              ]}
              onChange={(v) => onPrefsChange({ mode: v })}
            />
            {modeLocked ? (
              <p className="reader-aa-hint">固定版式书籍不支持切换阅读模式</p>
            ) : null}
            <div className="reader-aa-presets">
              <Seg
                value={activePreset ?? ""}
                ariaLabel="版式预设"
                options={LAYOUT_PRESETS.map((p) => ({
                  value: p.key,
                  label: p.label,
                }))}
                onChange={(key) => {
                  const p = LAYOUT_PRESETS.find((x) => x.key === key);
                  if (p) {
                    onPrefsChange({
                      lineHeight: p.lineHeight,
                      marginPx: p.marginPx,
                    });
                  }
                }}
              />
            </div>
          </AaSection>

          <AaSection title="中文排版 · 默认开启" accent>
            {CJK_ROWS.map((row) => (
              <SwitchRow
                key={row.key}
                label={row.label}
                body={row.body}
                checked={prefs[row.key]}
                onChange={(next) => onPrefsChange({ [row.key]: next })}
                theme={theme}
              />
            ))}
            <div className="reader-aa-cjk-note">
              三项核心排版开关默认 ON；旧版 WebView 由 JS
              垫片优雅降级，绝不让标点孤悬行首、中英挤作一团。
            </div>
          </AaSection>

          <AaSection title="中文处理">
            <SwitchRow
              label="词不拆行"
              body="用分词让词汇/成语不被断到两行或跨页拆开（如「朋友」「格格不入」不再从中间断开）。"
              checked={prefs.wordKeep}
              onChange={(next) => onPrefsChange({ wordKeep: next })}
              theme={theme}
            />
            <div className="reader-aa-switch-row">
              <span className="reader-aa-switch-row__label">简繁显示</span>
              <div className="reader-aa-cn-seg">
                <Seg
                  value={prefs.cnConvert}
                  ariaLabel="简繁显示"
                  options={[
                    { value: "off", label: "原文" },
                    { value: "t2s", label: "简" },
                    { value: "s2t", label: "繁" },
                  ]}
                  onChange={(v) => onPrefsChange({ cnConvert: v })}
                />
              </div>
            </div>
          </AaSection>

          {showLibraryPrefs ? (
            <AaSection title="书库">
              <SwitchRow
                label="书名清洗"
                body="书架显示时自动去掉「-XX轻小说」这类来源站名尾巴；不改动原始书名，可随时关闭。"
                checked={prefs.cleanTitles}
                onChange={(next) => onPrefsChange({ cleanTitles: next })}
                theme={theme}
              />
            </AaSection>
          ) : null}

          {syncSection ? (
            <div className="reader-aa-sync">{syncSection}</div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default SettingsSheet;
