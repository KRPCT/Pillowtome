/**
 * Reversible 盘古之白 (CJK autospace) shim (D-36 / D-37).
 *
 * Wave 0: API + textContent invariance contract.
 * Wave 1 (03-01): Custom Highlight → reversible spans → silent degrade.
 *
 * HARD BANS:
 * - Never insert U+0020 / U+2009 into book text
 * - Never leave permanent DOM mutations after disposer
 * - Concatenated body textContent must equal pre-install snapshot
 */

/**
 * Install autospace visual spacing for CJK↔Latin/digit boundaries.
 * Returns a disposer that restores the document.
 *
 * Wave 0: no-op install that still returns a safe disposer (full strategy in 03-01).
 */
export function installAutospaceShim(doc: Document): () => void {
  // Wave 0 contract: reversible path without character insertion.
  // Full Highlight/span strategy lands in 03-01; keep API stable for callers.
  void doc;
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
  };
}
