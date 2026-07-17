import { createTheme, type Theme } from "@mui/material/styles";
import type { ReadingTheme } from "../reader/apply-reading-styles";

/**
 * 简约淡雅 (minimalist / light / refined) Material Design 3 theme for Pillowtome.
 *
 * Direction (user-chosen): neutral light surfaces, generous whitespace, minimal
 * elevation, and a restrained 墨青 (ink-teal) accent. The book PAGE keeps its own
 * paper reading tones; this theme owns the app chrome (bars, sheets, controls).
 *
 * The three themes are built ONCE at module load and cached — switching theme is
 * a map lookup, never a `createTheme` call (that per-switch cost + MUI re-style
 * was the source of the theme-switch lag). `sepia` is a distinct warm-light theme
 * (day and sepia are no longer the same MUI theme).
 */

const CJK_STACK =
  '"Geist Variable", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans CJK TC", sans-serif';

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
    primary: "#37606e", // 墨青 ink-teal
    onPrimary: "#ffffff",
    secondary: "#516069",
    bgDefault: "#f8fafb",
    bgPaper: "#ffffff",
    textPrimary: "#181d1f",
    textSecondary: "#3f484c",
    divider: "#dde4e7",
  },
  sepia: {
    mode: "light",
    primary: "#37606e",
    onPrimary: "#ffffff",
    secondary: "#6b5d47",
    bgDefault: "#f0e7d5",
    bgPaper: "#f7efdd", // warm sepia surface — the fix for "sepia menu didn't change"
    textPrimary: "#3b2f1e",
    textSecondary: "#6b5d47",
    divider: "#ddd0b8",
  },
  night: {
    mode: "dark",
    primary: "#a1cbda",
    onPrimary: "#00363f",
    secondary: "#b8cad3",
    bgDefault: "#0f1416",
    bgPaper: "#171d1f",
    textPrimary: "#dfe3e5",
    textSecondary: "#bec8cc",
    divider: "#283034",
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
        hover: light ? "rgba(55,96,110,0.06)" : "rgba(161,203,218,0.08)",
        selected: light ? "rgba(55,96,110,0.10)" : "rgba(161,203,218,0.14)",
      },
    },
    shape: { borderRadius: 14 },
    typography: {
      fontFamily: CJK_STACK,
      button: { textTransform: "none", fontWeight: 600, letterSpacing: 0 },
      h6: { fontWeight: 700 },
      subtitle2: { fontWeight: 600 },
    },
    components: {
      MuiAppBar: { defaultProps: { elevation: 0, color: "transparent" } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { borderRadius: 999 } },
      },
      MuiDrawer: { styleOverrides: { paper: { backgroundImage: "none" } } },
      MuiChip: { styleOverrides: { root: { borderRadius: 8, fontWeight: 500 } } },
      MuiToggleButton: {
        styleOverrides: { root: { textTransform: "none", fontWeight: 600 } },
      },
      MuiTooltip: { styleOverrides: { tooltip: { fontSize: 12 } } },
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
