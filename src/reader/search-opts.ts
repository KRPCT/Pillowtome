/**
 * Search option helpers (READ-07, D-31/D-34).
 * Keep CJK-friendly grapheme matching — never set matchWholeWords.
 */

/** Debounce idle before firing search (within 200–300ms per D-34). */
export const SEARCH_DEBOUNCE_MS = 250;

/**
 * Build opts for `view.search(...)`.
 * Intentionally omits `matchWholeWords` so foliate defaults to grapheme matching.
 */
export function buildSearchOpts(query: string): { query: string } {
  return { query: query.trim() };
}
