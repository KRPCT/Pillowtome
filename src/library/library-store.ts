/**
 * Local library catalog via tauri-plugin-sql (LIB-01..04).
 * Bound `$n` params only (T-04-sql). Soft-fail list → [].
 */

import Database from "@tauri-apps/plugin-sql";
import type { LibraryItem, LibraryItemRow } from "./types";

const DB_PATH = "sqlite:pillow.db";

async function openDb(): Promise<Database> {
  return Database.load(DB_PATH);
}

export function rowToLibraryItem(row: LibraryItemRow): LibraryItem {
  return {
    itemId: row.item_id,
    workId: row.work_id,
    sourceId: row.source_id,
    title: row.title || "未知书名",
    author: row.author ?? null,
    coverFile: row.cover_file ?? null,
    importedAt: row.imported_at,
    lastOpenedAt: row.last_opened_at ?? null,
    lastReadAt: row.last_read_at ?? null,
    progressFraction:
      typeof row.progress_fraction === "number" && Number.isFinite(row.progress_fraction)
        ? row.progress_fraction
        : null,
  };
}

/** List shelf items with optional progress join (soft-fail → []). */
export async function listLibraryItems(): Promise<LibraryItem[]> {
  try {
    const db = await openDb();
    const rows = await db.select<LibraryItemRow[]>(
      `SELECT
         li.item_id,
         li.work_id,
         li.source_id,
         li.title,
         li.author,
         li.cover_file,
         li.imported_at,
         li.last_opened_at,
         li.last_read_at,
         loc.progress_fraction AS progress_fraction
       FROM library_item li
       LEFT JOIN locator loc ON loc.work_id = li.work_id
       ORDER BY
         CASE WHEN li.last_read_at IS NULL THEN 1 ELSE 0 END,
         li.last_read_at DESC,
         li.imported_at DESC`,
    );
    return (rows ?? []).map(rowToLibraryItem);
  } catch (err) {
    console.warn("[library-store] list failed", err);
    return [];
  }
}

/** True if a shelf row already exists for this work_id (dedup D-51). */
export async function libraryHasWorkId(workId: string): Promise<boolean> {
  try {
    const db = await openDb();
    const rows = await db.select<{ n: number }[]>(
      `SELECT COUNT(1) AS n FROM library_item WHERE work_id = $1`,
      [workId],
    );
    return (rows?.[0]?.n ?? 0) > 0;
  } catch (err) {
    console.warn("[library-store] hasWorkId failed", err);
    return false;
  }
}

/** Insert library_item; ignores conflict on work_id (UNIQUE). */
export async function insertLibraryItem(item: {
  itemId: string;
  workId: string;
  sourceId: string;
  title: string;
  author: string | null;
  coverFile: string | null;
  importedAt: number;
}): Promise<void> {
  const db = await openDb();
  try {
    await db.execute(
      `INSERT INTO library_item (
         item_id, work_id, source_id, title, author, cover_file,
         imported_at, last_opened_at, last_read_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL)
       ON CONFLICT(work_id) DO NOTHING`,
      [
        item.itemId,
        item.workId,
        item.sourceId,
        item.title,
        item.author,
        item.coverFile,
        item.importedAt,
      ],
    );
  } catch (err) {
    const msg = String(err);
    // Common when app DB has not migrated to SCHEMA_V4 yet — surface clearly.
    if (
      msg.includes("no such table") ||
      msg.includes("library_item") ||
      msg.includes("SQLITE_ERROR")
    ) {
      throw new Error(
        "书库数据表未就绪，请完全退出应用后重新打开（将自动升级数据库）。",
      );
    }
    throw err;
  }
}

/** Touch last_opened_at (D-65). */
export async function touchLastOpened(workId: string, at = Date.now()): Promise<void> {
  try {
    const db = await openDb();
    await db.execute(
      `UPDATE library_item SET last_opened_at = $1 WHERE work_id = $2`,
      [at, workId],
    );
  } catch (err) {
    console.warn("[library-store] touchLastOpened failed", err);
  }
}

/** Touch last_read_at (D-65). */
export async function touchLastRead(workId: string, at = Date.now()): Promise<void> {
  try {
    const db = await openDb();
    await db.execute(
      `UPDATE library_item SET last_read_at = $1 WHERE work_id = $2`,
      [at, workId],
    );
  } catch (err) {
    console.warn("[library-store] touchLastRead failed", err);
  }
}
