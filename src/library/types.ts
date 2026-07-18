/**
 * Library catalog types (LIB-01..04).
 * Maps SQL `library_item` + optional locator progress.
 */

export interface LibraryItem {
  itemId: string;
  workId: string;
  /** SourceRegistry / import id for pillow:// open. */
  sourceId: string;
  title: string;
  author: string | null;
  /** Relative under app_data/covers/, or null. */
  coverFile: string | null;
  importedAt: number;
  lastOpenedAt: number | null;
  lastReadAt: number | null;
  /** From locator.progress_fraction when joined; null if never opened. */
  progressFraction: number | null;
  /** Phase 7: the book file is held locally (placeholder rows carry the
   *  `sync-remote` sentinel source_id until downloaded + adopted). */
  fileLocal?: boolean;
  /** Phase 7: per-book 同步此书 opt-in (SCHEMA_V8 file_sync_enabled). */
  fileSyncEnabled?: boolean;
}

export interface LibraryItemRow {
  item_id: string;
  work_id: string;
  source_id: string;
  title: string;
  author: string | null;
  cover_file: string | null;
  imported_at: number;
  last_opened_at: number | null;
  last_read_at: number | null;
  progress_fraction?: number | null;
  /** SCHEMA_V8 column; optional so rows predating V8 still type-check. */
  file_sync_enabled?: number | null;
}
