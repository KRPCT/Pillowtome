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
}

export interface FoliateViewElement extends HTMLElement {
  open(book: File | Blob | string): Promise<void>;
  close?(): void;
  renderer?: FoliateRenderer;
  book?: FoliateBook;
  goTo(target: string): Promise<unknown>;
  goToTextStart(): Promise<unknown>;
  goLeft(): Promise<unknown>;
  goRight(): Promise<unknown>;
  search(opts: {
    query: string;
    index?: number;
    matchWholeWords?: boolean;
  }): AsyncGenerator<unknown>;
  clearSearch?(): void;
}

export interface RelocateDetail {
  fraction?: number;
  cfi?: string;
  range?: Range;
  tocItem?: FoliateBookTocItem;
  section?: { current?: number; total?: number };
  location?: { current?: number; next?: number; total?: number };
}
