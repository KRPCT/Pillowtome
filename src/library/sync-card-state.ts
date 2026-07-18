/**
 * Pure placeholder-card state derivation (SYNC-04, UI-SPEC §3).
 *
 * A library row whose file lives on a peer renders as a placeholder card; the
 * download lifecycle comes from the `"sync-status"` event's `downloads` map
 * (entry PRESENT ⇒ in flight; removed at 100 ⇒ terminal) plus a local failed
 * marker set when the download IPC chain rejects (failure copy comes from the
 * command's Err, never the event).
 */

export type SyncCardState = "local" | "downloadable" | "downloading" | "failed" | "unsynced";

/**
 * - local:        the file is on this device (normal card).
 * - downloading:  remote-only + a download entry is in flight.
 * - failed:       remote-only + the last download attempt rejected.
 * - downloadable: remote-only + the peer enabled file sync (tap downloads).
 * - unsynced:     remote-only + the peer did NOT enable file sync (D-102 grey).
 */
export function deriveCardState(
  item: { fileLocal?: boolean; fileSyncEnabled?: boolean },
  download: { percent: number } | "failed" | null,
): SyncCardState {
  if (item.fileLocal !== false) return "local";
  if (download === "failed") return "failed";
  if (download != null) return "downloading";
  return item.fileSyncEnabled ? "downloadable" : "unsynced";
}
