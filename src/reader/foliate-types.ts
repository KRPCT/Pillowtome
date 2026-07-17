/**
 * Ambient contract for foliate-js `<foliate-view>` (Wave 0).
 * Clean-room types only — no React, no implementation.
 * Consumers (02-01+) import from here instead of inventing APIs.
 */

export interface FoliateRenderer {
  next(distance?: number): Promise<void>;
  prev(distance?: number): Promise<void>;
  nextSection?(): Promise<void>;
  prevSection?(): Promise<void>;
  goTo?(target: {
    index: number;
    anchor?: number | (() => number) | unknown;
  }): Promise<void>;
  setAttribute?(name: string, value: string): void;
  getAttribute?(name: string): string | null;
  setStyles?(css: string | [string, string]): void;
  /** True when flow="scrolled". */
  scrolled?: boolean;
  /** Scroll offset / extent (scrolled mode). */
  start?: number;
  end?: number;
  viewSize?: number;
  size?: number;
}

export interface FoliateBookTocItem {
  label?: string;
  href?: string;
  subitems?: FoliateBookTocItem[];
}

export interface FoliateBookSection {
  load(): string | Promise<string>;
  unload?(): void;
  linear?: string;
  cfi?: string;
  id?: string;
}

export interface FoliateBook {
  toc?: FoliateBookTocItem[];
  rendition?: { layout?: string };
  sections?: FoliateBookSection[];
  metadata?: { language?: string; title?: string };
  /**
   * EventTarget that fires a `data` event before each resource blob URL is
   * created (foliate epub.js Loader). Listeners may rewrite `event.detail.data`
   * (string, awaitable) to transform section content before render — the hook
   * used for 简繁转换 / 词不拆行 (works for both paginate + scroll, CFI-stable).
   */
  transformTarget?: EventTarget;
  resolveHref?(
    href: string,
  ): { index: number; anchor?: unknown } | null | undefined;
  resolveCFI?(
    cfi: string,
  ): { index: number; anchor?: unknown } | null | undefined;
}

export interface FoliateViewElement extends HTMLElement {
  open(book: File | Blob | string | FoliateBook): Promise<void>;
  close?(): void;
  renderer?: FoliateRenderer;
  book?: FoliateBook;
  goTo(target: string): Promise<unknown>;
  goToTextStart(): Promise<unknown>;
  /** Jump to a whole-book fraction 0..1 (scrubber, paginate surface). */
  goToFraction(frac: number): Promise<unknown>;
  /** Whole-book start fraction of each spine section (for chapter tick marks). */
  getSectionFractions?(): number[];
  goLeft(): Promise<unknown>;
  goRight(): Promise<unknown>;
  /** Resolve href/CFI to spine index without navigating (when available). */
  resolveNavigation?(target: string): { index?: number } | null | undefined;
  /** Resolve a CFI string to { index, anchor } without navigating. */
  resolveCFI?(cfi: string): { index: number; anchor?: unknown } | null | undefined;
  search(opts: {
    query: string;
    index?: number;
    matchWholeWords?: boolean;
  }): AsyncGenerator<unknown>;
  clearSearch?(): void;
  /** Range → range-CFI joined onto the section base CFI (paginate selection). */
  getCFI?(index: number, range: Range): string;
  /**
   * Draw (or remove) an annotation via the closed-shadow Overlayer — the only
   * path into the paginate iframe. `value` is a CFI string. Emits
   * `draw-annotation` for the section whose overlayer is rendered.
   */
  addAnnotation?(
    annotation: { value: string; type?: string; color?: string | null },
    remove?: boolean,
  ): Promise<{ index: number; label: string } | undefined>;
}

export interface RelocateDetail {
  fraction?: number;
  cfi?: string;
  range?: Range;
  tocItem?: FoliateBookTocItem;
  section?: { current?: number; total?: number };
  location?: { current?: number; next?: number; total?: number };
}
