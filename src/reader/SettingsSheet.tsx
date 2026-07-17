/**
 * 显示设置 (Aa) — Material Design 3 bottom sheet (MUI, declarative).
 * 简约淡雅: neutral surfaces, ink-teal accent, minimal elevation.
 * Live apply via onPrefsChange; no separate 应用 button (D-22).
 */

import { useState, type CSSProperties, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import ClickAwayListener from "@mui/material/ClickAwayListener";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import {
  PAGE_COLORS,
  SYSTEM_CJK_STACK,
  type ReadingPrefs,
  type ReadingTheme,
} from "./apply-reading-styles";
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
  { key: "sepia", label: "Sepia" },
  { key: "night", label: "夜间" },
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
    body: "收窄中文标点旁多余空白，让「你好。」这类句子更紧凑、更像印刷书。",
  },
  {
    key: "cjkAutospace",
    label: "盘古之白",
    body: "在汉字与英文、数字之间自动留出细小间距，例如「读取 PDF」更易扫读。",
  },
  {
    key: "cjkKinsoku",
    label: "禁则",
    body: "避免行首出现句号、逗号，或行尾出现左引号、左括号等不合适的断行。",
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
}

function formatLineHeight(v: number): string {
  return Number.isInteger(v)
    ? String(v)
    : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography
        variant="subtitle2"
        sx={{ color: "text.secondary", mb: 1.25, letterSpacing: "0.02em" }}
      >
        {title}
      </Typography>
      {children}
    </Box>
  );
}

/**
 * Tappable (?) that toggles its tooltip — hover/touch tooltips don't reliably
 * show on a tap inside the bottom sheet, so drive `open` from onClick.
 */
function HelpDot({ label, title }: { label: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <Tooltip
        title={title}
        open={open}
        arrow
        disableFocusListener
        disableHoverListener
        disableTouchListener
        slotProps={{ tooltip: { sx: { maxWidth: 260, fontSize: 12, lineHeight: 1.6 } } }}
      >
        <IconButton
          size="small"
          aria-label={`关于${label}`}
          onClick={() => setOpen((o) => !o)}
          sx={{ color: "text.secondary" }}
        >
          <CircleHelp size={16} />
        </IconButton>
      </Tooltip>
    </ClickAwayListener>
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
}: SettingsSheetProps) {
  const selectedFont =
    prefs.fontFamilyKey === "system" || !prefs.activeFontId
      ? "system"
      : prefs.activeFontId;

  const pageColors = PAGE_COLORS[prefs.theme];
  const previewStyle = {
    fontFamily: SYSTEM_CJK_STACK,
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
  const previewContent = prefs.wordKeep ? wrapPreviewWords(previewText) : previewText;

  const activePreset = LAYOUT_PRESETS.find(
    (p) => p.lineHeight === prefs.lineHeight && p.marginPx === prefs.marginPx,
  )?.key;

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={() => onOpenChange(false)}
      slotProps={{
        paper: {
          sx: {
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            maxHeight: "min(88vh, 760px)",
          },
        },
      }}
    >
      <Box sx={{ px: 3, pt: 2, pb: 4, overflowY: "auto" }}>
        {/* MD3 drag handle */}
        <Box
          sx={{
            width: 32,
            height: 4,
            borderRadius: 999,
            bgcolor: "text.secondary",
            opacity: 0.35,
            mx: "auto",
            mb: 2,
          }}
        />
        <Typography variant="h6" sx={{ mb: 2 }}>
          显示设置
        </Typography>

        {/* Live CJK preview */}
        <Paper
          variant="outlined"
          sx={{
            p: 2,
            mb: 3,
            borderRadius: 3,
            bgcolor: pageColors.background,
            color: pageColors.foreground,
            overflowWrap: "break-word",
          }}
        >
          <div style={previewStyle} aria-hidden>
            {previewContent}
          </div>
        </Paper>

        <Section title="阅读模式">
          <ToggleButtonGroup
            exclusive
            fullWidth
            color="primary"
            size="small"
            value={prefs.mode}
            disabled={modeLocked}
            onChange={(_, v) => {
              if (v && (v === "paginate" || v === "scroll")) {
                onPrefsChange({ mode: v });
              }
            }}
            sx={{ borderRadius: 999, "& .MuiToggleButton-root": { borderRadius: 999 } }}
          >
            <ToggleButton value="paginate">分页</ToggleButton>
            <ToggleButton value="scroll">滚动</ToggleButton>
          </ToggleButtonGroup>
          {modeLocked ? (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
              固定版式书籍不支持切换阅读模式
            </Typography>
          ) : null}
        </Section>

        <Section title="主题">
          <Stack direction="row" spacing={1.5}>
            {THEME_SWATCHES.map((t) => {
              const c = PAGE_COLORS[t.key];
              const selected = prefs.theme === t.key;
              return (
                <Box
                  key={t.key}
                  component="button"
                  onClick={() => onPrefsChange({ theme: t.key })}
                  aria-label={t.label}
                  sx={{
                    flex: 1,
                    p: 0,
                    border: 0,
                    background: "transparent",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0.75,
                  }}
                >
                  <Box
                    sx={{
                      width: "100%",
                      height: 48,
                      borderRadius: 2.5,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 18,
                      bgcolor: c.background,
                      color: c.foreground,
                      border: "2px solid",
                      borderColor: selected ? "primary.main" : "divider",
                      boxShadow: (theme) =>
                        selected ? `0 0 0 2px ${theme.palette.primary.main}` : "none",
                      transition: "border-color 120ms ease",
                    }}
                  >
                    文
                  </Box>
                  <Typography
                    variant="caption"
                    sx={{
                      color: selected ? "primary.main" : "text.secondary",
                      fontWeight: selected ? 600 : 400,
                    }}
                  >
                    {t.label}
                  </Typography>
                </Box>
              );
            })}
          </Stack>
        </Section>

        <Section title="中文排版">
          {CJK_ROWS.map((row) => (
            <Box
              key={row.key}
              sx={{ display: "flex", alignItems: "center", minHeight: 48 }}
            >
              <Typography sx={{ flex: 1 }}>{row.label}</Typography>
              <HelpDot label={row.label} title={row.body} />
              <Switch
                checked={prefs[row.key]}
                onChange={(_, checked) => onPrefsChange({ [row.key]: checked })}
                slotProps={{ input: { "aria-label": row.label } }}
              />
            </Box>
          ))}
        </Section>

        <Section title="中文处理">
          <Box sx={{ display: "flex", alignItems: "center", minHeight: 48 }}>
            <Typography sx={{ flex: 1 }}>词不拆行</Typography>
            <HelpDot
              label="词不拆行"
              title="用分词让词汇/成语不被断到两行或跨页拆开（如「朋友」「格格不入」不再从中间断开）。"
            />
            <Switch
              checked={prefs.wordKeep}
              onChange={(_, checked) => onPrefsChange({ wordKeep: checked })}
              slotProps={{ input: { "aria-label": "词不拆行" } }}
            />
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", minHeight: 48, gap: 1 }}>
            <Typography sx={{ flex: 1 }}>简繁显示</Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              color="primary"
              value={prefs.cnConvert}
              onChange={(_, v) => {
                if (v === "off" || v === "s2t" || v === "t2s") {
                  onPrefsChange({ cnConvert: v });
                }
              }}
              sx={{
                gap: 1,
                // Default grouped buttons overlap borders (negative margins) —
                // reset to render three separate pills with a clear gap.
                "& .MuiToggleButtonGroup-grouped": {
                  px: 1.75,
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: "999px !important",
                  marginLeft: 0,
                },
              }}
            >
              <ToggleButton value="off">原文</ToggleButton>
              <ToggleButton value="t2s">简</ToggleButton>
              <ToggleButton value="s2t">繁</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </Section>

        {showLibraryPrefs ? (
          <Section title="书库">
            <Box sx={{ display: "flex", alignItems: "center", minHeight: 48 }}>
              <Typography sx={{ flex: 1 }}>书名清洗</Typography>
              <HelpDot
                label="书名清洗"
                title="书架显示时自动去掉「-XX轻小说」这类来源站名尾巴；不改动原始书名，可随时关闭。"
              />
              <Switch
                checked={prefs.cleanTitles}
                onChange={(_, checked) => onPrefsChange({ cleanTitles: checked })}
                slotProps={{ input: { "aria-label": "书名清洗" } }}
              />
            </Box>
          </Section>
        ) : null}

        <Section title="字体">
          <List disablePadding>
            <ListItemButton
              selected={selectedFont === "system"}
              onClick={() => onPrefsChange({ fontFamilyKey: "system", activeFontId: null })}
              sx={{ borderRadius: 2, minHeight: 44 }}
            >
              <ListItemText primary="系统默认" />
            </ListItemButton>
            {fonts.map((f) => (
              <Box key={f.id} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <ListItemButton
                  selected={selectedFont === f.id}
                  onClick={() => onPrefsChange({ fontFamilyKey: f.id, activeFontId: f.id })}
                  sx={{ flex: 1, borderRadius: 2, minHeight: 44 }}
                >
                  <ListItemText primary={f.familyName} />
                </ListItemButton>
                {onRemoveFont ? (
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => onRemoveFont(f.id, f.familyName)}
                    aria-label={`移除字体 ${f.familyName}`}
                  >
                    移除
                  </Button>
                ) : null}
              </Box>
            ))}
          </List>
          <Button
            variant="outlined"
            fullWidth
            sx={{ mt: 1.5 }}
            disabled={!onImportFont}
            onClick={() => onImportFont?.()}
          >
            导入字体
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
            仅支持 TTF、OTF、WOFF
          </Typography>
          {fontStatus ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }} role="status">
              {fontStatus}
            </Typography>
          ) : null}
        </Section>

        <Divider sx={{ mb: 3 }} />

        <Section title="版式">
          <Stack direction="row" spacing={1}>
            {LAYOUT_PRESETS.map((p) => (
              <Chip
                key={p.key}
                label={p.label}
                clickable
                onClick={() => onPrefsChange({ lineHeight: p.lineHeight, marginPx: p.marginPx })}
                color={activePreset === p.key ? "primary" : "default"}
                variant={activePreset === p.key ? "filled" : "outlined"}
                sx={{ flex: 1 }}
              />
            ))}
          </Stack>
        </Section>

        <SliderRow
          title="字号"
          value={prefs.fontSizePx}
          min={12}
          max={32}
          step={1}
          display={String(Math.round(prefs.fontSizePx))}
          onChange={(v) => onPrefsChange({ fontSizePx: v })}
        />
        <SliderRow
          title="行距"
          value={prefs.lineHeight}
          min={1.2}
          max={2.4}
          step={0.05}
          display={formatLineHeight(prefs.lineHeight)}
          onChange={(v) => onPrefsChange({ lineHeight: v })}
        />
        <SliderRow
          title="边距"
          value={prefs.marginPx}
          min={8}
          max={48}
          step={4}
          display={String(Math.round(prefs.marginPx))}
          onChange={(v) => onPrefsChange({ marginPx: v })}
        />
      </Box>
    </Drawer>
  );
}

function SliderRow({
  title,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  title: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <Typography variant="subtitle2" sx={{ color: "text.secondary" }}>
          {title}
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
          {display}
        </Typography>
      </Box>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(_, v) => {
          if (typeof v === "number") onChange(v);
        }}
        aria-label={title}
        size="small"
      />
    </Box>
  );
}

export default SettingsSheet;
