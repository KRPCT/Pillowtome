import { createTheme, type Theme } from "@mui/material/styles";
import type { ReadingTheme } from "../reader/apply-reading-styles";

/**
 * 纸墨 (paper / ink / hairline / cinnabar) Material Design 3 theme — the MUI
 * residue (Snackbar, Dialogs, switches, menus) adopts the mockup §01 token
 * language: paper surfaces, ink text, 朱砂 primary, hairline dividers.
 *
 * 主题仅作用于阅读画布（mockup §01）：界面壳层保持纸墨体系，因此 day /
 * sepia / night 三个主题共用同一套纸墨壳层色板；夜间仅翻转阅读画布
 * （--page-* 与 reader[data-theme="night"]），不翻转 chrome。
 *
 * The themes are built ONCE at module load and cached — switching theme is a
 * map lookup, never a `createTheme` call (per-switch rebuild was the source of
 * the theme-switch lag).
 */

const UI_STACK =
  '"Inter", "Noto Sans SC", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
const SERIF_STACK =
  '"Noto Serif SC", "Songti SC", "STSong", "SimSun", serif';

interface Palette {
  mode: "light" | "dark";
  primary: string;
  onPrimary: string;
  secondary: string;
  bgDefault: string;
  bgPaper: string;
  textPrimary: string;
  textSecondary: string;
  divider: string;
}

const PALETTES: Record<ReadingTheme, Palette> = {
  day: {
    mode: "light",
    primary: "#bf3a2b", // 朱砂 cinnabar
    onPrimary: "#fdf6ee",
    secondary: "#6b5d52",
    bgDefault: "#faf7f1", // 纸 paper
    bgPaper: "#faf7f1",
    textPrimary: "#17140f", // 墨 ink
    textSecondary: "#4a453b", // 墨二 ink-2
    divider: "#e3ddcf", // 发丝线 line
  },
  sepia: {
    // 壳层保持纸墨体系（mockup §01「主题仅作用于阅读画布」）— same as day.
    mode: "light",
    primary: "#bf3a2b",
    onPrimary: "#fdf6ee",
    secondary: "#6b5d52",
    bgDefault: "#faf7f1",
    bgPaper: "#faf7f1",
    textPrimary: "#17140f",
    textSecondary: "#4a453b",
    divider: "#e3ddcf",
  },
  night: {
    // 壳层保持纸墨体系（mockup §01「主题仅作用于阅读画布」）— same as day。
    // 夜间仅翻转阅读画布（--page-* / reader[data-theme="night"]），不翻转 chrome。
    mode: "light",
    primary: "#bf3a2b",
    onPrimary: "#fdf6ee",
    secondary: "#6b5d52",
    bgDefault: "#faf7f1",
    bgPaper: "#faf7f1",
    textPrimary: "#17140f",
    textSecondary: "#4a453b",
    divider: "#e3ddcf",
  },
};

function buildTheme(p: Palette): Theme {
  const light = p.mode === "light";
  return createTheme({
    palette: {
      mode: p.mode,
      primary: { main: p.primary, contrastText: p.onPrimary },
      secondary: { main: p.secondary },
      background: { default: p.bgDefault, paper: p.bgPaper },
      text: { primary: p.textPrimary, secondary: p.textSecondary },
      divider: p.divider,
      action: {
        hover: light ? "rgba(191,58,43,0.06)" : "rgba(232,132,111,0.10)",
        selected: light ? "rgba(191,58,43,0.10)" : "rgba(232,132,111,0.16)",
      },
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: UI_STACK,
      button: { textTransform: "none", fontWeight: 600, letterSpacing: 0 },
      // 标题用 serif 栈（词标/书名形制，mockup §01 字排）
      h6: {
        fontFamily: SERIF_STACK,
        fontWeight: 700,
        letterSpacing: "0.12em",
      },
      subtitle2: { fontWeight: 600 },
    },
    components: {
      MuiAppBar: { defaultProps: { elevation: 0, color: "transparent" } },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: "none" },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { borderRadius: 999 } },
      },
      MuiDrawer: { styleOverrides: { paper: { backgroundImage: "none" } } },
      MuiDialog: {
        styleOverrides: {
          paper: {
            backgroundImage: "none",
            borderRadius: 16,
            border: `1px solid ${p.divider}`,
            boxShadow: "0 18px 44px -22px rgba(23,20,15,.4)",
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            fontFamily: SERIF_STACK,
            fontWeight: 700,
            letterSpacing: "0.08em",
          },
        },
      },
      MuiSnackbarContent: {
        styleOverrides: {
          root: {
            // 墨底纸字气泡（mockup §03 sel-bubble 语汇）
            backgroundColor: light ? "#17140f" : "#e6dfd2",
            color: light ? "#faf7f1" : "#17140f",
            borderRadius: 10,
            boxShadow: "0 14px 34px -12px rgba(23,20,15,.55)",
          },
        },
      },
      MuiChip: { styleOverrides: { root: { borderRadius: 999, fontWeight: 500 } } },
      MuiToggleButton: {
        styleOverrides: { root: { textTransform: "none", fontWeight: 600 } },
      },
      MuiTooltip: { styleOverrides: { tooltip: { fontSize: 12 } } },
      MuiSwitch: {
        styleOverrides: {
          switchBase: {
            "&.Mui-checked": {
              color: p.primary,
              "& + .MuiSwitch-track": { backgroundColor: p.primary },
            },
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            border: `1px solid ${p.divider}`,
            boxShadow: "0 12px 28px -14px rgba(23,20,15,.35)",
          },
        },
      },
    },
  });
}

// Built once at module load; theme switch is a cached lookup (no createTheme).
const THEMES: Record<ReadingTheme, Theme> = {
  day: buildTheme(PALETTES.day),
  sepia: buildTheme(PALETTES.sepia),
  night: buildTheme(PALETTES.night),
};

/** Cached MUI theme for the reader/library day/night/sepia theme (no rebuild). */
export function getMuiTheme(theme: ReadingTheme | string | undefined): Theme {
  return THEMES[(theme as ReadingTheme) in THEMES ? (theme as ReadingTheme) : "day"];
}
