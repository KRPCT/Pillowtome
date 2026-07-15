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
}

function isMode(v: string): v is ReadingMode {
  return v === "paginate" || v === "scroll";
}

function isTheme(v: string): v is ReadingTheme {
  return v === "day" || v === "night" || v === "sepia";
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
      "SELECT id, mode, theme, font_family_key, font_size_px, line_height, margin_px, active_font_id, updated_at FROM reading_prefs WHERE id = $1",
      [GLOBAL_ID],
    );
    if (!rows?.length) return { ...DEFAULT_PREFS };
    return rowToPrefs(rows[0]);
  } catch (err) {
    console.warn("[reading-prefs] load failed; using defaults", err);
    return { ...DEFAULT_PREFS };
  }
}

/** Upsert global prefs with bound parameters only (T-02-sql). */
export async function saveReadingPrefs(prefs: ReadingPrefs): Promise<void> {
  const db = await openDb();
  const updatedAt = Date.now();
  await db.execute(
    `INSERT INTO reading_prefs (
      id, mode, theme, font_family_key, font_size_px, line_height, margin_px, active_font_id, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT(id) DO UPDATE SET
      mode = excluded.mode,
      theme = excluded.theme,
      font_family_key = excluded.font_family_key,
      font_size_px = excluded.font_size_px,
      line_height = excluded.line_height,
      margin_px = excluded.margin_px,
      active_font_id = excluded.active_font_id,
      updated_at = excluded.updated_at`,
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
    ],
  );
}
