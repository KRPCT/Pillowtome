/**
 * Reading-position locator load/upsert via tauri-plugin-sql (D-23, D-24, D-25).
 * Composite CFI + progress_fraction + text context — never bare percentage (D-08).
 * Parameterized `$n` binds only (T-02-sql). UNIQUE on work_id (idx_locator_work_id).
 */

import Database from "@tauri-apps/plugin-sql";
import type { RelocateDetail } from "./foliate-types";
import { touchLastRead } from "../library/library-store";

/** Debounced relocate → upsert delay (D-24). */
export const LOCATOR_DEBOUNCE_MS = 500;

const DB_PATH = "sqlite:pillow.db";

/** Max chars kept for text_exact window. */
const TEXT_EXACT_MAX = 120;

/** Chars kept on each side for the pre/post self-healing window (RESEARCH text_context). */
const TEXT_CONTEXT_MAX = 16;

export interface LocatorRow {
  work_id: string;
  cfi: string | null;
  progress_fraction: number | null;
  text_pre: string | null;
  text_exact: string | null;
  text_post: string | null;
  updated_at: number;
}

async function openDb(): Promise<Database> {
  return Database.load(DB_PATH);
}

/** Ensure a `work` row exists for the given identity (INSERT OR IGNORE). */
export async function ensureWorkRow(
  workId: string,
  contentHash: string,
  format = "epub",
): Promise<void> {
  try {
    const db = await openDb();
    const createdAt = Date.now();
    await db.execute(
      `INSERT OR IGNORE INTO work (work_id, content_hash, format, created_at)
       VALUES ($1, $2, $3, $4)`,
      [workId, contentHash, format, createdAt],
    );
  } catch (err) {
    console.warn("[locator-store] ensureWorkRow failed", err);
  }
}

/** Load locator for a work; null when missing or SQL unavailable. */
export async function loadLocator(workId: string): Promise<{
  cfi: string | null;
  progress_fraction: number | null;
  text_pre: string | null;
  text_exact: string | null;
  text_post: string | null;
} | null> {
  try {
    const db = await openDb();
    const rows = await db.select<LocatorRow[]>(
      `SELECT work_id, cfi, progress_fraction, text_pre, text_exact, text_post, updated_at
       FROM locator WHERE work_id = $1`,
      [workId],
    );
    if (!rows?.length) return null;
    const row = rows[0];
    return {
      cfi: row.cfi,
      progress_fraction: row.progress_fraction,
      text_pre: row.text_pre,
      text_exact: row.text_exact,
      text_post: row.text_post,
    };
  } catch (err) {
    console.warn("[locator-store] loadLocator failed", err);
    return null;
  }
}

/** Upsert locator on UNIQUE(work_id) — ON CONFLICT DO UPDATE (D-23). */
export async function upsertLocator(row: {
  work_id: string;
  cfi: string | null;
  progress_fraction: number | null;
  text_pre: string | null;
  text_exact: string | null;
  text_post: string | null;
}): Promise<void> {
  // Never write empty progress — would wipe a good resume point.
  if (!row.cfi && row.progress_fraction == null) {
    console.warn("[locator-store] skip empty upsert", row.work_id);
    return;
  }
  try {
    const db = await openDb();
    const updatedAt = Date.now();
    await db.execute(
      `INSERT INTO locator (
        work_id, cfi, progress_fraction, text_pre, text_exact, text_post, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT(work_id) DO UPDATE SET
        cfi = excluded.cfi,
        progress_fraction = excluded.progress_fraction,
        text_pre = excluded.text_pre,
        text_exact = excluded.text_exact,
        text_post = excluded.text_post,
        updated_at = excluded.updated_at`,
      [
        row.work_id,
        row.cfi,
        row.progress_fraction,
        row.text_pre,
        row.text_exact,
        row.text_post,
        updatedAt,
      ],
    );
    // D-65: refresh library last_read alongside locator (soft-fail).
    void touchLastRead(row.work_id, updatedAt);
  } catch (err) {
    console.warn("[locator-store] upsertLocator failed", err);
    throw err;
  }
}

/** Trim/window text_exact from a Range (or string). */
export function textExactFromRange(range: Range | null | undefined): string | null {
  if (!range) return null;
  try {
    const raw = range.toString().trim().replace(/\s+/g, " ");
    if (!raw) return null;
    return raw.length > TEXT_EXACT_MAX ? raw.slice(0, TEXT_EXACT_MAX) : raw;
  } catch {
    return null;
  }
}

/** Chars immediately before `offset` in a text node, whitespace-collapsed, capped. */
function neighborBefore(node: Node | undefined, offset: number): string {
  if (!node || node.nodeType !== 3 || typeof node.nodeValue !== "string") return "";
  return node.nodeValue.slice(0, offset).replace(/\s+/g, " ").slice(-TEXT_CONTEXT_MAX);
}

/** Chars immediately after `offset` in a text node, whitespace-collapsed, capped. */
function neighborAfter(node: Node | undefined, offset: number): string {
  if (!node || node.nodeType !== 3 || typeof node.nodeValue !== "string") return "";
  return node.nodeValue.slice(offset).replace(/\s+/g, " ").slice(0, TEXT_CONTEXT_MAX);
}

/**
 * Build the composite text window `{ text_pre, text_exact, text_post }` from a Range.
 * pre/post are the 16 chars adjacent to the range within its containing text nodes
 * (empty string at a boundary; the whole struct's fields are null when no range).
 * This is the self-healing window the shared anchor resolver reads back.
 */
export function textContextFromRange(range: Range | null | undefined): {
  text_pre: string | null;
  text_exact: string | null;
  text_post: string | null;
} {
  if (!range) return { text_pre: null, text_exact: null, text_post: null };
  let text_pre = "";
  let text_post = "";
  try {
    text_pre = neighborBefore(range.startContainer, range.startOffset);
    text_post = neighborAfter(range.endContainer, range.endOffset);
  } catch {
    /* leave boundaries empty */
  }
  return { text_pre, text_exact: textExactFromRange(range), text_post };
}

/**
 * Map a foliate `relocate` detail + work_id into a locator upsert row.
 * Uses whole-book `fraction` (view-level) and CFI when present.
 */
export function relocateToLocatorRow(
  workId: string,
  detail: RelocateDetail | null | undefined,
): {
  work_id: string;
  cfi: string | null;
  progress_fraction: number | null;
  text_pre: string | null;
  text_exact: string | null;
  text_post: string | null;
} {
  const fraction =
    typeof detail?.fraction === "number" && Number.isFinite(detail.fraction)
      ? Math.max(0, Math.min(1, detail.fraction))
      : null;
  const cfi =
    typeof detail?.cfi === "string" && detail.cfi.trim() ? detail.cfi : null;
  const ctx = textContextFromRange(detail?.range ?? null);

  return {
    work_id: workId,
    cfi,
    progress_fraction: fraction,
    text_pre: ctx.text_pre,
    text_exact: ctx.text_exact,
    text_post: ctx.text_post,
  };
}
