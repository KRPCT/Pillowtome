/**
 * TOC flatten helpers (READ-05).
 * Pure — no React / foliate imports.
 */

export interface TocItem {
  label: string;
  href: string;
  subitems?: TocItem[];
}

export interface FlatTocItem {
  label: string;
  href: string;
  depth: number;
}

/** Depth-first flatten with indent depth for sheet rendering. */
export function flattenToc(items: TocItem[], depth = 0): FlatTocItem[] {
  const out: FlatTocItem[] = [];
  for (const item of items) {
    out.push({ label: item.label, href: item.href, depth });
    if (item.subitems?.length) {
      out.push(...flattenToc(item.subitems, depth + 1));
    }
  }
  return out;
}
