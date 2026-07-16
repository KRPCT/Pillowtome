/**
 * Custom font import / list / remove (READ-06, D-27..D-30).
 *
 * - Rust copies into app_data/fonts with server-side limits (20 / 20MB).
 * - Frontend owns `custom_font` SQL rows with bound params (T-02-sql).
 * - Face URL via pillow scheme + convertFileSrc — never hand-roll host (D-30).
 * - Never transfer font bytes over IPC (T-02-ipc).
 */

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import Database from "@tauri-apps/plugin-sql";
import { pillowFontUrl } from "../lib/pillow";
import { SYSTEM_CJK_STACK } from "./apply-reading-styles";

const DB_PATH = "sqlite:pillow.db";

/** Metadata from Rust `import_font` — no bytes (T-02-ipc). */
export interface FontMeta {
  id: string;
  familyName: string;
  fileName: string;
  byteSize: number;
}

/** Row shape for `custom_font` + UI list. */
export interface CustomFont {
  id: string;
  familyName: string;
  fileName: string;
  byteSize: number;
  createdAt: number;
}

interface CustomFontRow {
  id: string;
  family_name: string;
  file_name: string;
  byte_size: number;
  created_at: number;
}

function rowToFont(row: CustomFontRow): CustomFont {
  return {
    id: row.id,
    familyName: row.family_name,
    fileName: row.file_name,
    byteSize: row.byte_size,
    createdAt: row.created_at,
  };
}

async function openDb(): Promise<Database> {
  return Database.load(DB_PATH);
}

/** List custom fonts from SQL (metadata only). */
export async function listCustomFonts(): Promise<CustomFont[]> {
  try {
    const db = await openDb();
    const rows = await db.select<CustomFontRow[]>(
      "SELECT id, family_name, file_name, byte_size, created_at FROM custom_font ORDER BY created_at ASC",
    );
    return (rows ?? []).map(rowToFont);
  } catch (err) {
    console.warn("[fonts] list failed", err);
    return [];
  }
}

/**
 * Desktop: open file dialog → Rust import_font → INSERT custom_font.
 * Returns the new font meta or throws with a 简体中文 message.
 */
export async function importCustomFont(): Promise<CustomFont> {
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [
      {
        name: "Fonts",
        extensions: ["ttf", "otf", "woff"],
      },
    ],
  });
  if (picked === null) {
    throw new Error("已取消");
  }
  const path = picked as string;

  const meta = await invoke<FontMeta>("import_font", { path });
  const createdAt = Date.now();
  const db = await openDb();
  await db.execute(
    `INSERT INTO custom_font (id, family_name, file_name, byte_size, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [meta.id, meta.familyName, meta.fileName, meta.byteSize, createdAt],
  );

  return {
    id: meta.id,
    familyName: meta.familyName,
    fileName: meta.fileName,
    byteSize: meta.byteSize,
    createdAt,
  };
}

/**
 * Remove app-data copy + SQL row (D-29). Never deletes the original user file.
 * Caller should fall back to system stack if the removed font was active.
 */
export async function removeCustomFont(id: string): Promise<void> {
  await invoke("remove_font", { id });
  const db = await openDb();
  await db.execute("DELETE FROM custom_font WHERE id = $1", [id]);
}

/** CSS font-family name injected for a custom face. */
export function pillowCustomFamily(id: string): string {
  return `PillowCustom-${id}`;
}

/** Bundled Noto Sans CJK family name (D-47 / CJK-05). */
export const BUNDLED_CJK_FAMILY = "PillowBundledCJK";

/** Pillow protocol font ids for materialized Noto SC/TC (safe flat tokens). */
export const BUNDLED_NOTO_SC_ID = "bundled-noto-sc";
export const BUNDLED_NOTO_TC_ID = "bundled-noto-tc";

/**
 * `@font-face` CSS for bundled CJK faces (same family, SC + TC sources).
 * Served via pillow fonts path — never IPC bytes (D-06).
 */
export function buildBundledCjkFontFaceCss(): string {
  const sc = pillowFontUrl(BUNDLED_NOTO_SC_ID);
  const tc = pillowFontUrl(BUNDLED_NOTO_TC_ID);
  return `
    @font-face {
      font-family: "${BUNDLED_CJK_FAMILY}";
      src: url("${sc}");
      font-display: swap;
    }
    @font-face {
      font-family: "${BUNDLED_CJK_FAMILY}";
      src: url("${tc}");
      font-display: swap;
    }
  `;
}

/**
 * Build `@font-face` CSS for the active custom font (D-30).
 * Empty string when system / missing id.
 */
export function buildFontFaceCss(activeFontId: string | null | undefined): string {
  if (!activeFontId) return "";
  const family = pillowCustomFamily(activeFontId);
  const url = pillowFontUrl(activeFontId);
  return `
    @font-face {
      font-family: "${family}";
      src: url("${url}");
      font-display: swap;
    }
  `;
}

/**
 * Body font-family CSS: custom? → PillowBundledCJK → system CJK stack (D-47).
 * Incomplete custom face still falls through to bundled for CJK coverage.
 */
export function fontFamilyCssFor(
  fontFamilyKey: string,
  activeFontId: string | null | undefined,
): string {
  const tail = `"${BUNDLED_CJK_FAMILY}", ${SYSTEM_CJK_STACK}`;
  if (fontFamilyKey === "system" || !activeFontId) {
    return tail;
  }
  return `"${pillowCustomFamily(activeFontId)}", ${tail}`;
}
