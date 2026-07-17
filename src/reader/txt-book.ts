/**
 * Plain-text → reflowable book adapter for foliate-view.
 *
 * foliate-js has no `.txt` handler (`makeBook` throws `UnsupportedTypeError`), so
 * we build a minimal foliate book object ourselves — mirroring the shape of
 * `comic-book.js`/`makeFB2` (sections with `load()` returning an HTML blob URL,
 * a TOC, and the `resolveHref`/`splitTOCHref`/`getTOCFragment` trio needed for
 * TOC progress). The book is reflowable (no `rendition.layout`) so it rides the
 * normal paginator + continuous-scroll path and inherits the reader's CJK
 * typography.
 *
 * Two jobs a CN `.txt` needs: (1) encoding detection — Chinese text files are
 * frequently GB18030/GBK, not UTF-8; (2) auto chapter splitting — most have
 * `第N章`-style headings, and those without are size-split so no single section
 * is unbounded (paginator + scroll-window are per-section).
 */

import type { FoliateBook } from "./foliate-types";

/** Sections larger than this many chars are split (perf: bounded sections). */
const MAX_SECTION_CHARS = 40_000;
/** A chapter heading line is short; longer matches are prose, not a heading. */
const MAX_HEADING_LEN = 30;

/** `第N章/回/卷/节…`, `序/楔子/前言/后记…`, `Chapter N` — CN novel headings. */
const CHAPTER_RE =
  /^[\s　]{0,8}(第[0-9零〇一二三四五六七八九十百千两]{1,8}[章回卷节節部篇折出集]|卷[0-9零〇一二三四五六七八九十百千两]{1,5}|序章|序言|序|楔子|引子|前言|后记|後記|尾声|尾聲|终章|終章|番外[^\n]{0,12}|外传|外傳|附录|附錄|[Cc]hapter\s+\d+)([\s　:：、.。·—-]|$)/;

interface Chapter {
  title: string;
  /** Raw text body (without the heading line). */
  body: string;
}

/**
 * Decode raw bytes to text, honoring BOM and falling back UTF-8 → GB18030.
 *
 * Returns `null` when the bytes clearly are not text (binary that foliate simply
 * failed to parse) so the caller can re-surface the original open error instead
 * of rendering garbage.
 */
export function decodeTextBytes(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return null;

  // BOM sniff.
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }

  // NUL bytes in the first chunk ⇒ binary, not text.
  const probe = bytes.subarray(0, 4096);
  if (probe.includes(0)) return null;

  // Strict UTF-8 first; on failure treat as GB18030 (superset of GBK/GB2312).
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("gb18030").decode(bytes);
  }

  // Reject if decoding produced mostly replacement chars (wrong guess / binary).
  const sample = text.slice(0, 4000);
  if (sample.length) {
    let bad = 0;
    for (const ch of sample) if (ch === "�") bad++;
    if (bad / sample.length > 0.1) return null;
  }
  return text;
}

/** Split text into chapters by heading lines, else into bounded size chunks. */
export function splitChapters(text: string): Chapter[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  const chapters: Chapter[] = [];
  let current: { title: string; lines: string[] } | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    const isHeading =
      trimmed.length > 0 &&
      trimmed.length <= MAX_HEADING_LEN &&
      CHAPTER_RE.test(trimmed);
    if (isHeading) {
      if (current) chapters.push({ title: current.title, body: current.lines.join("\n") });
      current = { title: trimmed, lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else if (trimmed.length > 0) {
      // Preamble before the first heading becomes an untitled opening section.
      current = { title: "", lines: [line] };
    }
  }
  if (current) chapters.push({ title: current.title, body: current.lines.join("\n") });

  // No real chapter structure (or one giant blob): size-split into parts.
  if (chapters.length <= 1) {
    return sizeSplit(normalized);
  }

  // Guard against a single oversized chapter (e.g. one 章 holding the whole book).
  return chapters.flatMap((ch) =>
    ch.body.length > MAX_SECTION_CHARS * 1.5
      ? sizeSplit(ch.body, ch.title)
      : [ch],
  );
}

/** Split text into ~MAX_SECTION_CHARS chunks at paragraph boundaries. */
function sizeSplit(text: string, titlePrefix = ""): Chapter[] {
  const paras = text.split("\n");
  const out: Chapter[] = [];
  let buf: string[] = [];
  let count = 0;
  const flush = () => {
    if (!buf.length) return;
    const n = out.length + 1;
    const title = titlePrefix
      ? `${titlePrefix}（${n}）`
      : `第 ${n} 部分`;
    out.push({ title, body: buf.join("\n") });
    buf = [];
    count = 0;
  };
  for (const p of paras) {
    buf.push(p);
    count += p.length + 1;
    if (count >= MAX_SECTION_CHARS) flush();
  }
  flush();
  return out.length ? out : [{ title: titlePrefix || "正文", body: text }];
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Render a chapter to a standalone reflowable HTML document string. */
export function chapterToHtml(chapter: Chapter): string {
  const paras = chapter.body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => `<p>${escapeHtml(l)}</p>`)
    .join("\n");
  const heading = chapter.title
    ? `<h2>${escapeHtml(chapter.title)}</h2>\n`
    : "";
  const titleTag = escapeHtml(chapter.title || "正文");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${titleTag}</title></head><body>\n${heading}${paras}\n</body></html>`;
}

export interface MakeTxtBookOptions {
  /** Title shown in reader chrome (library already holds the cleaned title). */
  titleHint?: string;
  /**
   * Applied to each chapter's HTML before it is served — carries 简繁转换 / 词不拆行
   * (txt has no foliate `transformTarget`, so we transform at build time; the
   * reader re-opens the book on toggle, rebuilding with fresh prefs).
   */
  transformHtml?: (html: string) => string;
}

/**
 * Build a foliate book from a plain-text blob. Returns `null` when the blob is
 * not decodable text, so the caller can fall back to the original open error.
 */
export async function makeTxtBook(
  blob: Blob,
  opts: MakeTxtBookOptions = {},
): Promise<FoliateBook | null> {
  const { titleHint, transformHtml } = opts;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = decodeTextBytes(bytes);
  if (text == null) return null;

  const chapters = splitChapters(text);
  const htmlCache = new Map<number, string>();
  const urlCache = new Map<number, string>();

  const htmlOf = (i: number): string => {
    let html = htmlCache.get(i);
    if (html == null) {
      html = chapterToHtml(chapters[i]);
      if (transformHtml) html = transformHtml(html);
      htmlCache.set(i, html);
    }
    return html;
  };

  const sections = chapters.map((_, i) => ({
    id: `ch${i}`,
    linear: "yes",
    size: chapters[i].body.length + chapters[i].title.length,
    load: () => {
      let url = urlCache.get(i);
      if (!url) {
        url = URL.createObjectURL(new Blob([htmlOf(i)], { type: "text/html" }));
        urlCache.set(i, url);
      }
      return url;
    },
    unload: () => {
      const url = urlCache.get(i);
      if (url) {
        URL.revokeObjectURL(url);
        urlCache.delete(i);
      }
    },
    createDocument: () =>
      new DOMParser().parseFromString(htmlOf(i), "text/html"),
  }));

  const book: FoliateBook & {
    dir?: string;
    splitTOCHref?: (href: string) => [string, string | null];
    getTOCFragment?: (doc: Document) => Element;
    destroy?: () => void;
  } = {
    metadata: { title: titleHint ?? "", language: "zh" },
    rendition: {},
    dir: "ltr",
    sections,
    toc: chapters.map((ch, i) => ({
      label: ch.title || `第 ${i + 1} 部分`,
      href: `ch${i}`,
    })),
    resolveHref: (href: string) => ({
      index: sections.findIndex((s) => s.id === href),
    }),
    splitTOCHref: (href: string) => [href, null],
    getTOCFragment: (doc: Document) => doc.documentElement,
    destroy: () => {
      for (const url of urlCache.values()) URL.revokeObjectURL(url);
      urlCache.clear();
    },
  };
  return book;
}
