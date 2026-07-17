/**
 * Pure geometry helpers for continuous-scroll progress (no DOM).
 * Kept separate from scroll-cfi.ts so unit tests can import without NodeFilter.
 */

/**
 * Project outer-scroller geometry into the iframe-local visible window.
 *
 * The iframe content is not scrolled (height expanded); only the outer
 * scroller moves. Given the outer scrollTop and the section's top offset
 * inside the scroller, return the visible window in iframe-content px.
 */
export function iframeLocalVisibleWindow(
  outerScrollTop: number,
  sectionTopInScroller: number,
  viewportHeight: number,
): { localStart: number; localEnd: number } {
  const localStart = Math.max(0, outerScrollTop - sectionTopInScroller);
  return { localStart, localEnd: localStart + Math.max(0, viewportHeight) };
}
