/**
 * Annotation persistence + sync-ready ledger (D-79/D-80/D-81, P5).
 *
 * Mirrors `locator-store.ts`: same DB (`sqlite:pillow.db`), same soft-fail
 * contract (console.warn + null/[]), parameterized `$n` binds ONLY — never string
 * concat of user/book text (T-05-01, security V5). Every create/update/delete is a
 * tombstone-safe mutation that appends exactly one `change_log` row carrying a
 * monotonic per-device logical clock (D-81). Delete never physically removes a row
 * — it sets `deleted = 1` (D-80). `content_hash` is a WebCrypto SHA-256 over a
 * canonical field set, tagged `hash_algo:"sha256"` in the payload (see WARNING:
 * this differs from `work.content_hash`'s blake3 — P7 sync must read hash_algo per
 * record, never assume a single algorithm across tables).
 */

import Database from "@tauri-apps/plugin-sql";

const DB_PATH = "sqlite:pillow.db";

/** Hash algorithm tag written into every change_log payload (P7 reads per-record). */
const HASH_ALGO = "sha256";

export type AnnotationType = "highlight" | "underline" | "note" | "bookmark";

export interface AnnotationRow {
  annotation_id: string;
  work_id: string;
  type: AnnotationType;
  cfi: string;
  color: string | null;
  text_pre: string | null;
  text_exact: string | null;
  text_post: string | null;
  progress_fraction: number | null;
  note: string | null;
  created_at: number;
  updated_at: number;
  revision: number;
  content_hash: string | null;
  deleted: number;
}

/** Fields that define annotation content identity (excludes updated_at/revision). */
export interface AnnotationHashFields {
  type: string;
  cfi: string;
  color: string | null;
  text_exact: string | null;
  note: string | null;
  deleted: number;
}

async function openDb(): Promise<Database> {
  return Database.load(DB_PATH);
}

let cachedDeviceId: string | null = null;

/**
 * Deterministic SHA-256 (lowercase hex) over the FIXED-order canonical field set.
 * Nulls normalize to empty string so identical content always hashes identically.
 * Pure + exported so tests can assert stability; non-security dedup hash only.
 */
export async function annotationContentHash(fields: AnnotationHashFields): Promise<string> {
  const canonical = JSON.stringify({
    type: fields.type ?? "",
    cfi: fields.cfi ?? "",
    color: fields.color ?? "",
    text_exact: fields.text_exact ?? "",
    note: fields.note ?? "",
    deleted: fields.deleted ?? 0,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Bootstrap the single device row (id='device') and return its device_id.
 * INSERT OR IGNORE keeps the original id on subsequent launches. Cached after the
 * first successful read; falls back to the freshly generated id when the SELECT
 * yields nothing (keeps device_id non-null for the change_log NOT NULL column).
 */
export async function ensureDevice(): Promise<string | null> {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    const db = await openDb();
    const fresh = crypto.randomUUID();
    await db.execute(
      `INSERT OR IGNORE INTO sync_meta (id, device_id, logical_clock)
       VALUES ('device', $1, 0)`,
      [fresh],
    );
    const rows = await db.select<{ device_id: string }[]>(
      `SELECT device_id FROM sync_meta WHERE id = 'device'`,
    );
    cachedDeviceId = rows?.[0]?.device_id ?? fresh;
    return cachedDeviceId;
  } catch (err) {
    console.warn("[annotation-store] ensureDevice failed", err);
    return null;
  }
}

/**
 * Append one change_log row. logical_clock is computed INSIDE the INSERT as
 * COALESCE(MAX(logical_clock for this device), 0) + 1 — a single atomic statement,
 * so SQLite's writer serialization keeps the clock strictly monotonic per device
 * without a cross-statement transaction (T-05-02).
 */
async function appendChangeLog(
  db: Database,
  deviceId: string,
  op: "upsert" | "delete",
  row: AnnotationRow,
): Promise<void> {
  const payload = JSON.stringify({
    annotation_id: row.annotation_id,
    type: row.type,
    cfi: row.cfi,
    color: row.color,
    text_pre: row.text_pre,
    text_exact: row.text_exact,
    text_post: row.text_post,
    progress_fraction: row.progress_fraction,
    note: row.note,
    deleted: row.deleted,
    content_hash: row.content_hash,
    hash_algo: HASH_ALGO,
  });
  await db.execute(
    `INSERT INTO change_log (id, device_id, logical_clock, entity, op, payload, created_at)
     VALUES (
       $1, $2,
       COALESCE((SELECT MAX(logical_clock) FROM change_log WHERE device_id = $2), 0) + 1,
       'annotation', $3, $4, $5
     )`,
    [crypto.randomUUID(), deviceId, op, payload, Date.now()],
  );
}

/**
 * Insert or update an annotation (ON CONFLICT(annotation_id)), bumping revision +
 * updated_at, then append one op='upsert' change_log row. Annotation write first
 * (user sees their highlight even in a crash window), ledger append second.
 */
export async function upsertAnnotation(row: AnnotationRow): Promise<void> {
  try {
    const deviceId = await ensureDevice();
    if (!deviceId) {
      console.warn("[annotation-store] upsertAnnotation skipped: no device_id");
      return;
    }
    const db = await openDb();
    const contentHash = await annotationContentHash(row);
    const updatedAt = Date.now();
    await db.execute(
      `INSERT INTO annotation (
        annotation_id, work_id, type, cfi, color,
        text_pre, text_exact, text_post, progress_fraction, note,
        created_at, updated_at, content_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT(annotation_id) DO UPDATE SET
        type = excluded.type,
        cfi = excluded.cfi,
        color = excluded.color,
        text_pre = excluded.text_pre,
        text_exact = excluded.text_exact,
        text_post = excluded.text_post,
        progress_fraction = excluded.progress_fraction,
        note = excluded.note,
        content_hash = excluded.content_hash,
        updated_at = excluded.updated_at,
        revision = annotation.revision + 1,
        deleted = 0`,
      [
        row.annotation_id,
        row.work_id,
        row.type,
        row.cfi,
        row.color,
        row.text_pre,
        row.text_exact,
        row.text_post,
        row.progress_fraction,
        row.note,
        row.created_at,
        updatedAt,
        contentHash,
      ],
    );
    await appendChangeLog(db, deviceId, "upsert", { ...row, content_hash: contentHash, updated_at: updatedAt });
  } catch (err) {
    console.warn("[annotation-store] upsertAnnotation failed", err);
  }
}

/**
 * Soft-delete via tombstone (D-80): set deleted=1, bump revision/updated_at, read
 * the row back for the payload, then append one op='delete' change_log row. Never
 * a physical DELETE.
 */
export async function deleteAnnotation(annotationId: string): Promise<void> {
  try {
    const deviceId = await ensureDevice();
    if (!deviceId) {
      console.warn("[annotation-store] deleteAnnotation skipped: no device_id");
      return;
    }
    const db = await openDb();
    const updatedAt = Date.now();
    await db.execute(
      `UPDATE annotation SET deleted = 1, revision = revision + 1, updated_at = $2
       WHERE annotation_id = $1`,
      [annotationId, updatedAt],
    );
    const rows = await db.select<AnnotationRow[]>(
      `SELECT annotation_id, work_id, type, cfi, color,
              text_pre, text_exact, text_post, progress_fraction, note,
              created_at, updated_at, revision, content_hash, deleted
       FROM annotation WHERE annotation_id = $1`,
      [annotationId],
    );
    const row = rows?.[0];
    if (!row) {
      console.warn("[annotation-store] deleteAnnotation: row not found", annotationId);
      return;
    }
    await appendChangeLog(db, deviceId, "delete", row);
  } catch (err) {
    console.warn("[annotation-store] deleteAnnotation failed", err);
  }
}

/** Non-deleted annotations for a work, stable order; [] on failure. */
export async function listAnnotations(workId: string): Promise<AnnotationRow[]> {
  try {
    const db = await openDb();
    const rows = await db.select<AnnotationRow[]>(
      `SELECT annotation_id, work_id, type, cfi, color,
              text_pre, text_exact, text_post, progress_fraction, note,
              created_at, updated_at, revision, content_hash, deleted
       FROM annotation
       WHERE work_id = $1 AND deleted = 0
       ORDER BY created_at ASC`,
      [workId],
    );
    return rows ?? [];
  } catch (err) {
    console.warn("[annotation-store] listAnnotations failed", err);
    return [];
  }
}
