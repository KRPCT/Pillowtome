/**
 * Real-CFI save/restore helpers for the continuous-scroll iframe stream.
 *
 * The stream stacks blob-URL iframes (one per spine section) in an outer
 * scroller, bypassing foliate's paginator. To get reliable resume without the
 * paginator, we reuse foliate's pure CFI utilities (`epubcfi.js`) and a copy of
 * its `getVisibleRange` algorithm to anchor progress to a DOM node rather than
 * a pixel offset fraction (which drifts when fonts/images reflow).
 *
 * Clean-room from foliate-js paginator.js + epubcfi.js (MIT).
 */

import * as CFI from "../vendor/foliate-js/epubcfi.js";

// --- getVisibleRange (ported from paginator.js, pure, doc-agnostic) ---------
// NOTE: NodeFilter is destructured lazily inside getVisibleRange (not at module
// top level) so this module stays importable in a non-DOM (node) test env — the
// CFI-string helpers below (cfiToRange/spineFromCfi) can then be unit-tested.

const makeRange = (doc: Document, node: Node, start: number, end: number = start): Range => {
    const range = doc.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return range;
};

// Binary search for the offset in a text node where visibility changes.
const bisectNode = (
    doc: Document,
    node: Text | CDATASection,
    cb: (a: Range, b: Range) => number,
    start = 0,
    end = (node.nodeValue ?? "").length,
): number => {
    if (end - start === 1) {
        const result = cb(makeRange(doc, node, start), makeRange(doc, node, end));
        return result < 0 ? start : end;
    }
    const mid = Math.floor(start + (end - start) / 2);
    const result = cb(makeRange(doc, node, start, mid), makeRange(doc, node, mid, end));
    return result < 0
        ? bisectNode(doc, node, cb, start, mid)
        : result > 0
            ? bisectNode(doc, node, cb, mid, end)
            : mid;
};

// Firefox omits zero-width rects from getBoundingClientRect; union the client rects.
const getBoundingClientRect = (target: Element | Range): DOMRect => {
    let top = Infinity, right = -Infinity, left = Infinity, bottom = -Infinity;
    for (const rect of target.getClientRects()) {
        left = Math.min(left, rect.left);
        top = Math.min(top, rect.top);
        right = Math.max(right, rect.right);
        bottom = Math.max(bottom, rect.bottom);
    }
    return new DOMRect(left, top, right - left, bottom - top);
};

/**
 * Compute a DOM Range spanning the first-to-last visible text node in `doc`,
 * given a 1-D visible window `[start, end]` and a `mapRect` that projects a
 * DOMRect into that 1-D axis (for vertical scrolling: `({top,bottom}) => ({left:top, right:bottom})`).
 *
 * Ported verbatim from foliate-js paginator.js `getVisibleRange` (lines 94-151).
 */
export function getVisibleRange(
    doc: Document,
    start: number,
    end: number,
    mapRect: (rect: DOMRect) => { left: number; right: number },
): Range {
    const { SHOW_ELEMENT, SHOW_TEXT, SHOW_CDATA_SECTION,
        FILTER_ACCEPT, FILTER_REJECT, FILTER_SKIP } = NodeFilter;
    const TREE_WALKER_FILTER = SHOW_ELEMENT | SHOW_TEXT | SHOW_CDATA_SECTION;
    const acceptNode = (node: Node): number => {
        const name = (node as Element).localName?.toLowerCase();
        if (name === "script" || name === "style") return FILTER_REJECT;
        if (node.nodeType === 1) {
            const { left, right } = mapRect(getBoundingClientRect(node as Element));
            if (right < start || left > end) return FILTER_REJECT;
            if (left >= start && right <= end) return FILTER_ACCEPT;
        } else {
            if (!(node as Text).nodeValue?.trim()) return FILTER_SKIP;
            const range = doc.createRange();
            range.selectNodeContents(node);
            const { left, right } = mapRect(range.getBoundingClientRect());
            if (right >= start && left <= end) return FILTER_ACCEPT;
        }
        return FILTER_SKIP;
    };
    const walker = doc.createTreeWalker(doc.body as HTMLElement, TREE_WALKER_FILTER, { acceptNode });
    const nodes: Node[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        nodes.push(node);
    }

    const from = nodes[0] ?? doc.body;
    const to = nodes[nodes.length - 1] ?? from;

    const startOffset = from.nodeType === 1 ? 0
        : bisectNode(doc, from as Text, (a, b) => {
            const p = mapRect(getBoundingClientRect(a));
            const q = mapRect(getBoundingClientRect(b));
            if (p.right < start && q.left > start) return 0;
            return q.left > start ? -1 : 1;
        });
    const endOffset = to.nodeType === 1 ? 0
        : bisectNode(doc, to as Text, (a, b) => {
            const p = mapRect(getBoundingClientRect(a));
            const q = mapRect(getBoundingClientRect(b));
            if (p.right < end && q.left > end) return 0;
            return q.left > end ? -1 : 1;
        });

    const range = doc.createRange();
    range.setStart(from, startOffset);
    range.setEnd(to, endOffset);
    return range;
}

// --- CFI generation (save) --------------------------------------------------

/**
 * Build a complete EPUB CFI for the currently visible content in an iframe doc.
 *
 * The iframe is NOT scrolled internally (height expanded to content); the OUTER
 * scroller moves. A node inside such an iframe reports getBoundingClientRect in
 * the iframe's OWN content viewport (verified empirically: the value is constant
 * as the outer scroller scrolls). `localStart` (= outerScrollTop -
 * sectionTopInScroller) is in that SAME content-Y space, so the visible window
 * `[localStart, localStart + viewportHeight]` and the node rects share one
 * coordinate system — the projection is the IDENTITY. (An earlier version
 * subtracted iframe.getBoundingClientRect().top, mixing outer-viewport and
 * content-Y spaces, which always captured the section top → mid-section resume
 * landed at chapter start.)
 *
 * `baseCfi` is the section's spine base CFI (`book.sections[i].cfi` or
 * `CFI.fake.fromIndex(i)`).
 * `localStart` is the top of the visible window in iframe-content px (≥ 0).
 * `viewportHeight` is the outer scroller's clientHeight.
 */
export function visibleRangeCfi(
    doc: Document,
    baseCfi: string,
    localStart: number,
    viewportHeight: number,
    _iframe: HTMLIFrameElement,
): string | null {
    if (!doc?.body) return null;
    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return null;
    try {
        const start = Math.max(0, localStart);
        const end = start + viewportHeight;
        // Node rects are already in iframe-content-Y (same space as localStart).
        const mapRect = (rect: DOMRect) => ({
            left: rect.top,
            right: rect.bottom,
        });
        const range = getVisibleRange(doc, start, end, mapRect);
        const local = CFI.fromRange(range);
        if (!local) return null;
        return CFI.joinIndir(baseCfi, local);
    } catch (err) {
        console.warn("[scroll-cfi] visibleRangeCfi failed", err);
        return null;
    }
}

/**
 * Turn a selection Range into a full range-CFI, using the same
 * `CFI.fromRange` + `CFI.joinIndir(baseCfi, local)` idiom as `visibleRangeCfi`.
 *
 * Scroll-mode counterpart to foliate's `view.getCFI(index, range)` (plan 05-03),
 * so paginate and scroll selections produce comparable range-CFIs. Returns null
 * for an empty/collapsed/failed range.
 */
export function selectionCfi(baseCfi: string, range: Range | null | undefined): string | null {
    if (!range || range.collapsed) return null;
    try {
        const local = CFI.fromRange(range);
        if (!local) return null;
        return CFI.joinIndir(baseCfi, local);
    } catch (err) {
        console.warn("[scroll-cfi] selectionCfi failed", err);
        return null;
    }
}


// --- CFI resolution (restore) ----------------------------------------------

/**
 * Resolve a CFI to the DOM Range it points at, within `doc`.
 * Returns null if the CFI cannot be resolved against this document.
 */
export function cfiToRange(doc: Document, cfi: string): Range | null {
    if (!doc || !CFI.isCFI.test(cfi)) return null;
    try {
        const parts = CFI.parse(cfi);
        // Strip the spine indirection before toRange. toRange resolves
        // startParts[0] against THIS section document, but a full book CFI's
        // first path is the package spine step (/6/N) — leaving it makes toRange
        // walk the wrong path and land on a garbage/null node. foliate's own
        // resolveCFI shifts it off first (view.js:441). A base-only cfi
        // (epubcfi(/6/N) with no local path) has length 1 — leave it so toRange
        // fails cleanly and callers fall back to the offset token.
        const container = (parts as { parent?: unknown[] }).parent ?? (parts as unknown[]);
        if (Array.isArray(container) && container.length > 1) container.shift();
        return CFI.toRange(doc, parts);
    } catch (err) {
        console.warn("[scroll-cfi] cfiToRange failed", cfi, err);
        return null;
    }
}

/**
 * Parse the spine (package) index out of a full book CFI without a DOM.
 * epubcfi(/6/N!/local) → foliate's fake.toIndex(/6/N) = N/2 - 1.
 * Last-resort spine resolution when the engine's resolveCFI is unavailable.
 * Returns null for non-CFI tokens or a missing/invalid spine step.
 */
export function spineFromCfi(cfi: string | null | undefined): number | null {
    if (!cfi || !CFI.isCFI.test(cfi)) return null;
    try {
        const parsed = CFI.parse(cfi);
        const container = ((parsed as { parent?: unknown[] }).parent ??
            (parsed as unknown[])) as Array<Parameters<typeof CFI.fake.toIndex>[0]>;
        if (!Array.isArray(container) || container.length === 0) return null;
        const idx = CFI.fake.toIndex(container[0]);
        return Number.isFinite(idx) && idx >= 0 ? idx : null;
    } catch {
        return null;
    }
}

/**
 * Compute the outer scroller's target scrollTop so that the CFI's node sits
 * near the top of the viewport.
 *
 * A node inside a height-expanded, non-internally-scrolled iframe reports
 * getBoundingClientRect in the iframe's OWN content viewport (verified: constant
 * under outer scroll). To place it in the outer scroller's scroll content we add
 * the iframe element's outer-viewport top:
 *
 *   absoluteTop = iframe.top + nodeRect.top - scrollerRect.top + scroller.scrollTop
 *
 * Then `scrollTop = absoluteTop - leadPx` to leave a little air above. (An
 * earlier version omitted the iframe offset and drifted with scroll position.)
 *
 * Because the node rect is read live after layout, this is immune to the
 * height-measurement races that plagued the offset-fraction approach: even if
 * fonts/images load later, re-applying re-reads the current position.
 *
 * Returns null if the CFI can't be resolved.
 */
export function resolveCfiScrollTop(
    doc: Document,
    cfi: string,
    iframe: HTMLIFrameElement,
    scroller: HTMLElement,
    leadPx = 24,
): number | null {
    const range = cfiToRange(doc, cfi);
    if (!range) return null;
    // Use the start container's element rect (stable across range quirks).
    const node = (range.startContainer.nodeType === 1
        ? range.startContainer
        : range.startContainer.parentElement) as Element | null;
    const target = node ?? (range as Range);
    const targetRect = getBoundingClientRect(target); // iframe-content space
    const scrollerRect = scroller.getBoundingClientRect(); // outer viewport space
    const iframeTop = iframe.getBoundingClientRect().top; // outer viewport space
    const absoluteTop =
        iframeTop + targetRect.top - scrollerRect.top + scroller.scrollTop;
    // A CFI that resolves to a non-rendered node yields empty client rects →
    // Infinity/NaN. Bail so the caller falls back to the offset target instead of
    // writing NaN to scrollTop (which the browser ignores → jump no-op).
    if (!Number.isFinite(absoluteTop)) return null;
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    return Math.max(0, Math.min(Math.max(0, maxScroll), absoluteTop - leadPx));
}
