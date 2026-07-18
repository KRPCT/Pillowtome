/**
 * Typed thin invoke wrappers for the ten phase-7 sync IPC commands (SYNC-01..05).
 * Single point for command names; all wire shapes camelCase (house convention).
 *
 * Password containment (RESEARCH Pattern 4 / T-07-04-01): the password exists
 * ONLY as an inbound field of {@link syncTestAndSave}'s payload — no wrapper
 * returns it, no wrapper logs its arguments.
 */

import { invoke } from "@tauri-apps/api/core";

/** `sync_get_config()` — password-free by construction. */
export interface SyncPublicConfig {
  configured: boolean;
  serverUrl: string | null;
  username: string | null;
  remotePath: string;
  allowHttp: boolean;
  trustSelfSigned: boolean;
  deviceName: string | null;
  keyringAvailable: boolean;
}

/** `sync_status()` / `sync_now()` result — carries NO transfer arrays. */
export interface SyncStatusSnapshot {
  configured: boolean;
  serverUrl: string | null;
  username: string | null;
  syncing: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
}

/** The `"sync-status"` event payload (sole emitter: the engine). */
export interface SyncStatusEvent {
  configured: boolean;
  syncing: boolean;
  lastError: string | null;
  downloads: Array<{ workId: string; percent: number }>;
  uploads: Array<{ workId: string; percent: number }>;
}

/** `sync_book_opened()` — the merge trace (D-92). All quiet fields when no jump. */
export interface SyncOpenResult {
  jumped: boolean;
  deviceName: string | null;
  progressFraction: number | null;
  replacedLocal: { cfi: string; progressFraction: number } | null;
}

/** `sync_download_book()` — the D-100 hand-off. */
export interface SyncDownloadResult {
  workId: string;
  sourceId: string;
  localPath: string;
}

/** `sync_revert_jump()` — the restored pre-jump position, or null (no stash). */
export interface RevertedLocator {
  cfi: string;
  progressFraction: number;
}

/** Inbound-only config payload. The password never rides back out. */
export interface SyncConfigPayload {
  serverUrl: string;
  username: string;
  password: string;
  remotePath?: string;
  allowHttp?: boolean;
  trustSelfSigned?: boolean;
  deviceName?: string;
}

export function syncGetConfig(): Promise<SyncPublicConfig> {
  return invoke<SyncPublicConfig>("sync_get_config");
}

/**
 * The D-97 forced gate. Resolves on save success (连接成功，已保存); REJECTS
 * with the engine's `Err(String)` — the already-classified Chinese copy,
 * rendered verbatim by the caller (never re-mapped here).
 */
export async function syncTestAndSave(payload: SyncConfigPayload): Promise<void> {
  await invoke("sync_test_and_save", { input: payload });
}

export async function syncDisconnect(): Promise<void> {
  await invoke("sync_disconnect");
}

export function syncNow(): Promise<SyncStatusSnapshot> {
  return invoke<SyncStatusSnapshot>("sync_now");
}

export function syncStatus(): Promise<SyncStatusSnapshot> {
  return invoke<SyncStatusSnapshot>("sync_status");
}

export async function syncSetFileSync(args: {
  workId: string;
  enabled: boolean;
}): Promise<void> {
  await invoke("sync_set_file_sync", args);
}

export function syncDownloadBook(args: { workId: string }): Promise<SyncDownloadResult> {
  return invoke<SyncDownloadResult>("sync_download_book", args);
}

/** 开书拉 (D-90) — `sync_book_opened`; resolves to the merge trace. */
export function syncBookOpened(args: { workId: string }): Promise<SyncOpenResult> {
  return invoke<SyncOpenResult>("sync_book_opened", args);
}

/** 合书推 (D-90) — `sync_book_closed`; fire-and-forget push. */
export async function syncBookClosed(args: { workId: string }): Promise<void> {
  await invoke("sync_book_closed", args);
}

export function syncRevertJump(args: { workId: string }): Promise<RevertedLocator | null> {
  return invoke<RevertedLocator | null>("sync_revert_jump", args);
}
