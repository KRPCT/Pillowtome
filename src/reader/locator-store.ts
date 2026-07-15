/**
 * Reading-position locator load/upsert via tauri-plugin-sql (D-23, D-24, D-25).
 * Composite CFI + progress_fraction + text context — never bare percentage (D-08).
 * Parameterized `$n` binds only (T-02-sql). UNIQUE on work_id (idx_locator_work_id).
 */

import Database from "@tauri-apps/plugin-sql";
import type { RelocateDetail } from "./foliate-types";

/** Debounced relocate → upsert delay (D-24). */
export const LOCATOR_DEBOUNCE_MS = 500;

const DB_PATH = "sqlite:pillow.db";

/** Max chars kept for text_exact window (P2; pre/post may be empty — research A1). */
const TEXT_EXACT_MAX = 120;

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
  } catch (err) {
    console.warn("[locator-store] upsertLocator failed", err);
    throw err;
  }
}

/** Trim/window text_exact from a Range (or string); empty pre/post in P2. */
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
  const textExact = textExactFromRange(detail?.range ?? null);

  return {
    work_id: workId,
    cfi,
    progress_fraction: fraction,
    text_pre: null, // P2: pre/post empty (research A1)
    text_exact: textExact,
    text_post: null,
  };
}

/**
 * Continuous-scroll resume token stored in `cfi` when real EPUB CFI is absent.
 * Format: `pillow-scroll:{spineIndex}:{offsetFraction}`
 */
export const SCROLL_CFI_PREFIX = "pillow-scroll:";

export function encodeScrollLocator(
  spineIndex: number,
  offsetFraction: number,
): string {
  const f = Math.max(0, Math.min(1, offsetFraction));
  return `${SCROLL_CFI_PREFIX}${Math.max(0, Math.floor(spineIndex))}:${f.toFixed(4)}`;
}

export function parseScrollLocator(
  cfi: string | null | undefined,
): { spineIndex: number; offsetFraction: number } | null {
  if (!cfi || !cfi.startsWith(SCROLL_CFI_PREFIX)) return null;
  const rest = cfi.slice(SCROLL_CFI_PREFIX.length);
  const [a, b] = rest.split(":");
  const spineIndex = Number(a);
  const offsetFraction = Number(b);
  if (!Number.isFinite(spineIndex) || !Number.isFinite(offsetFraction)) {
    return null;
  }
  return {
    spineIndex: Math.max(0, Math.floor(spineIndex)),
    offsetFraction: Math.max(0, Math.min(1, offsetFraction)),
  };
}

/** Persist continuous-scroll progress (no real CFI). */
export function continuousProgressToLocatorRow(
  workId: string,
  spineIndex: number,
  offsetFraction: number,
): {
  work_id: string;
  cfi: string | null;
  progress_fraction: number | null;
  text_pre: string | null;
  text_exact: string | null;
  text_post: string | null;
} {
  return {
    work_id: workId,
    cfi: encodeScrollLocator(spineIndex, offsetFraction),
    // Approximate book progress as fraction of spine index only (coarse).
    progress_fraction: null,
    text_pre: null,
    text_exact: null,
    text_post: null,
  };
}
