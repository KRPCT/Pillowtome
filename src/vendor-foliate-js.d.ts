/**
 * Ambient declaration for the vendored, pinned foliate-js engine (MIT).
 *
 * foliate-js is plain JavaScript with no bundled type declarations and is
 * vendored as a submodule at `src/vendor/foliate-js` (do NOT add a .d.ts inside
 * the submodule - it would dirty it). We import `view.js` only for its side
 * effect: it calls `customElements.define('foliate-view', …)`. The typed
 * surface we actually use is declared locally in `reader/FoliateView.tsx`.
 *
 * `epubcfi.js` exports pure CFI string/Range utilities used by scroll-cfi.ts
 * for real-CFI resume in the continuous-scroll stream.
 */
declare module "*/vendor/foliate-js/view.js" {
  import type { FoliateBook } from "./reader/foliate-types";
  /** Parse a File/Blob/URL into a foliate book (so we can hook `transformTarget`
   *  before the view renders the first section). */
  export function makeBook(file: File | Blob | string): Promise<FoliateBook>;
}

declare module "*/vendor/foliate-js/overlayer.js" {
  /** SVG overlay drawer used as the scroll-mode highlight fallback (WebView < 105)
   *  and by the paginate `draw-annotation` seam (closed shadow root). */
  export class Overlayer {
    readonly element: SVGElement;
    add(key: string, range: Range, draw: unknown, options?: unknown): void;
    remove(key: string): void;
    redraw(): void;
    hitTest(event: { x: number; y: number }): [string, Range] | [];
    static highlight(rects: DOMRectList | DOMRect[], options?: { color?: string }): SVGElement;
    static underline(rects: DOMRectList | DOMRect[], options?: { color?: string }): SVGElement;
  }
}

declare module "*/vendor/foliate-js/epubcfi.js" {
  /** A CFI part: { index, offset?, id?, before?, after? }. */
  export interface CfiPart {
    index: number;
    offset?: number;
    id?: string | null;
    before?: boolean;
    after?: boolean;
  }
  /** Parsed CFI: array of indirection parts, or { parent, start, end } for ranges. */
  export type ParsedCfi = CfiPart[][] | { parent: CfiPart[]; start: CfiPart[]; end: CfiPart[] };

  export const isCFI: RegExp;
  export function joinIndir(...cfis: string[]): string;
  export function parse(cfi: string): ParsedCfi;
  export function collapse(parts: ParsedCfi, toEnd?: boolean): CfiPart[][];
  export function compare(a: string, b: string): number;
  export function fromRange(range: Range, filter?: unknown): string;
  export function toRange(doc: Document, parts: ParsedCfi, filter?: unknown): Range;
  export function fromElements(elements: Element[]): string[];
  export function toElement(doc: Document, parts: ParsedCfi): Node;
  export const fake: {
    fromIndex(index: number): string;
    toIndex(parts: CfiPart[] | undefined): number;
  };
  export function fromCalibrePos(pos: string): string;
  export function fromCalibreHighlight(opts: {
    spine_index: number;
    start_cfi: string;
    end_cfi: string;
  }): string;
}

