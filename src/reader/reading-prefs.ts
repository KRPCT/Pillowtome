/**
 * Global reading preferences via tauri-plugin-sql (D-20, D-21, D-22).
 * Single-row table `reading_prefs` id='global'. Never localStorage.
 * Parameterized `$n` binds only (T-02-sql).
 */

import Database from "@tauri-apps/plugin-sql";
import {
  DEFAULT_PREFS,
  type ReadingMode,
  type ReadingPrefs,
  type ReadingTheme,
} from "./apply-reading-styles";

/** Debounced auto-save delay for prefs writes (D-22). */
export const PREFS_SAVE_DEBOUNCE_MS = 400;

const DB_PATH = "sqlite:pillow.db";
const GLOBAL_ID = "global";

interface ReadingPrefsRow {
  id: string;
  mode: string;
  theme: string;
  font_family_key: string;
  font_size_px: number;
  line_height: number;
  margin_px: number;
  active_font_id: string | null;
  updated_at: number;
  cjk_punct_trim?: number | null;
  cjk_autospace?: number | null;
  cjk_kinsoku?: number | null;
  clean_titles?: number | null;
  word_keep?: number | null;
  cn_convert?: string | null;
}

function isMode(v: string): v is ReadingMode {
  return v === "paginate" || v === "scroll";
}

function isTheme(v: string): v is ReadingTheme {
  return v === "day" || v === "night" || v === "sepia";
}

function isCnConvert(v: string | null | undefined): v is ReadingPrefs["cnConvert"] {
  return v === "off" || v === "s2t" || v === "t2s";
}

/** Missing/undefined columns soft-fail to ON (D-32 / D-34). */
function cjkFlagOn(value: number | null | undefined): boolean {
  if (value == null) return true;
  return value !== 0;
}

function rowToPrefs(row: ReadingPrefsRow): ReadingPrefs {
  return {
    mode: isMode(row.mode) ? row.mode : DEFAULT_PREFS.mode,
    theme: isTheme(row.theme) ? row.theme : DEFAULT_PREFS.theme,
    fontFamilyKey: row.font_family_key || DEFAULT_PREFS.fontFamilyKey,
    fontSizePx:
      typeof row.font_size_px === "number" && Number.isFinite(row.font_size_px)
        ? row.font_size_px
        : DEFAULT_PREFS.fontSizePx,
    lineHeight:
      typeof row.line_height === "number" && Number.isFinite(row.line_height)
        ? row.line_height
        : DEFAULT_PREFS.lineHeight,
    marginPx:
      typeof row.margin_px === "number" && Number.isFinite(row.margin_px)
        ? row.margin_px
        : DEFAULT_PREFS.marginPx,
    activeFontId: row.active_font_id ?? null,
    cjkPunctTrim: cjkFlagOn(row.cjk_punct_trim),
    cjkAutospace: cjkFlagOn(row.cjk_autospace),
    cjkKinsoku: cjkFlagOn(row.cjk_kinsoku),
    cleanTitles: cjkFlagOn(row.clean_titles),
    // New PoC toggles default OFF (opt-in), unlike the CJK flags above.
    wordKeep: row.word_keep == null ? false : row.word_keep !== 0,
    cnConvert: isCnConvert(row.cn_convert) ? row.cn_convert : DEFAULT_PREFS.cnConvert,
  };
}

async function openDb(): Promise<Database> {
  return Database.load(DB_PATH);
}

/** Load global prefs; on miss or error return {@link DEFAULT_PREFS}. */
export async function loadReadingPrefs(): Promise<ReadingPrefs> {
  try {
    const db = await openDb();
    const rows = await db.select<ReadingPrefsRow[]>(
      "SELECT id, mode, theme, font_family_key, font_size_px, line_height, margin_px, active_font_id, updated_at, cjk_punct_trim, cjk_autospace, cjk_kinsoku, clean_titles, word_keep, cn_convert FROM reading_prefs WHERE id = $1",
      [GLOBAL_ID],
    );
    if (!rows?.length) return { ...DEFAULT_PREFS };
    return rowToPrefs(rows[0]);
  } catch (err) {
    console.warn("[reading-prefs] load failed; using defaults", err);
    return { ...DEFAULT_PREFS };
  }
}

/** Upsert global prefs with bound parameters only (T-02-sql / T-03-sql). */
export async function saveReadingPrefs(prefs: ReadingPrefs): Promise<void> {
  const db = await openDb();
  const updatedAt = Date.now();
  await db.execute(
    `INSERT INTO reading_prefs (
      id, mode, theme, font_family_key, font_size_px, line_height, margin_px, active_font_id, updated_at,
      cjk_punct_trim, cjk_autospace, cjk_kinsoku, clean_titles, word_keep, cn_convert
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    ON CONFLICT(id) DO UPDATE SET
      mode = excluded.mode,
      theme = excluded.theme,
      font_family_key = excluded.font_family_key,
      font_size_px = excluded.font_size_px,
      line_height = excluded.line_height,
      margin_px = excluded.margin_px,
      active_font_id = excluded.active_font_id,
      updated_at = excluded.updated_at,
      cjk_punct_trim = excluded.cjk_punct_trim,
      cjk_autospace = excluded.cjk_autospace,
      cjk_kinsoku = excluded.cjk_kinsoku,
      clean_titles = excluded.clean_titles,
      word_keep = excluded.word_keep,
      cn_convert = excluded.cn_convert`,
    [
      GLOBAL_ID,
      prefs.mode,
      prefs.theme,
      prefs.fontFamilyKey,
      prefs.fontSizePx,
      prefs.lineHeight,
      prefs.marginPx,
      prefs.activeFontId,
      updatedAt,
      prefs.cjkPunctTrim ? 1 : 0,
      prefs.cjkAutospace ? 1 : 0,
      prefs.cjkKinsoku ? 1 : 0,
      prefs.cleanTitles ? 1 : 0,
      prefs.wordKeep ? 1 : 0,
      prefs.cnConvert,
    ],
  );
}
