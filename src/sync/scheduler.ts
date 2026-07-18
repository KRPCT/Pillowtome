/**
 * Sync scheduler primitives (D-90/D-91): open-book pull, close-book/background
 * push, manual button — and NOTHING else. No timers, no polling, ever.
 *
 * The close-gate guarantees `sync_book_closed` fires at most once per open:
 * unmount, the back path, and a background switch can all race to close the
 * same open — exactly one may pass.
 */

export interface CloseGate {
  /** Begin an open session; a later close may fire once. */
  markOpened(): void;
  /** true at most once per {@link markOpened} — fire the close push only when true. */
  consumeClose(): boolean;
}

export function createCloseGate(): CloseGate {
  let open = false;
  return {
    markOpened() {
      open = true;
    },
    consumeClose(): boolean {
      if (!open) return false;
      open = false;
      return true;
    },
  };
}
