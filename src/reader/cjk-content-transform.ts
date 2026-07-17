/**
 * Section-HTML content transform for 简繁转换 + 词不拆行, applied via foliate's
 * `book.transformTarget` BEFORE a section is rendered (epub.js Loader.createURL).
 *
 * Why pre-render (not a post-render DOM shim): foliate's paginator iframe lives
 * in a CLOSED shadow root a DOM shim can't reach, and transforming before render
 * means foliate computes CFI against the transformed content → paginate + scroll
 * both work and reading positions stay stable (no post-hoc reflow drift).
 *
 * Both features are display-only and reversible at the source level (the original
 * book file is never modified — only the in-memory blob served to the WebView).
 */

import { convertText } from "./cjk-convert-shim";
import type { ReadingPrefs } from "./apply-reading-styles";

/** Han ideographs (core + ext-A + compat) — a run is "CJK" if it contains one. */
const HAN_RE = /[㐀-鿿豈-﫿]/;

interface WordSegment {
  segment: string;
}
interface SegmenterLike {
  segment(input: string): Iterable<WordSegment>;
}
type SegmenterCtor = new (
  locales?: string,
  options?: { granularity?: "word" | "sentence" | "grapheme" },
) => SegmenterLike;

function makeSegmenter(lang: string): SegmenterLike | null {
  const Seg = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (typeof Seg !== "function") return null;
  try {
    return new Seg(lang || "zh", { granularity: "word" });
  } catch {
    return null;
  }
}

export interface ContentTransformOpts {
  convert: ReadingPrefs["cnConvert"];
  wordKeep: boolean;
  lang?: string;
}

/** True if this resource MIME type is (X)HTML content we should transform. */
export function isHtmlType(type: string | undefined): boolean {
  return typeof type === "string" && /html/i.test(type);
}

export function needsTransform(opts: ContentTransformOpts): boolean {
  return opts.convert !== "off" || opts.wordKeep;
}

/**
 * Transform a section's (X)HTML string: convert Simplified/Traditional and/or
 * wrap CJK words in `white-space:nowrap` spans so they never split across a
 * line/page. Returns the original string unchanged on any parse failure.
 */
export function transformSectionHtml(html: string, opts: ContentTransformOpts): string {
  if (!needsTransform(opts)) return html;
  if (typeof DOMParser === "undefined") return html;

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return html;
  }
  if (!doc?.body) return html;

  const seg = opts.wordKeep ? makeSegmenter(opts.lang ?? "zh") : null;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  let n = walker.nextNode();
  while (n) {
    const tag = (n as Text).parentElement?.tagName?.toLowerCase();
    if (tag !== "script" && tag !== "style" && (n as Text).data) texts.push(n as Text);
    n = walker.nextNode();
  }

  for (const text of texts) {
    let data = text.data;
    // 1) 简繁转换 (display-only, OpenCC) — do this first so word segmentation runs
    //    on the text the reader actually sees.
    if (opts.convert !== "off" && HAN_RE.test(data)) {
      data = convertText(data, opts.convert);
    }
    // 2) 词不拆行 — wrap each multi-char CJK word in a nowrap span.
    if (seg && data.length >= 2 && HAN_RE.test(data)) {
      let words: WordSegment[];
      try {
        words = [...seg.segment(data)];
      } catch {
        words = [];
      }
      if (words.some((w) => w.segment.length >= 2 && HAN_RE.test(w.segment))) {
        const frag = doc.createDocumentFragment();
        for (const w of words) {
          const s = w.segment;
          if (s.length >= 2 && HAN_RE.test(s)) {
            const span = doc.createElement("span");
            span.style.whiteSpace = "nowrap";
            span.textContent = s;
            frag.appendChild(span);
          } else {
            frag.appendChild(doc.createTextNode(s));
          }
        }
        text.parentNode?.replaceChild(frag, text);
        continue;
      }
    }
    // Convert-only path: replace the text in place.
    if (data !== text.data) text.data = data;
  }

  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
}

/**
 * Coerce foliate's `event.detail.data` (string | ArrayBuffer | Blob | Promise)
 * to a string so it can be transformed.
 */
export async function coerceToString(data: unknown): Promise<string | null> {
  const v = await data;
  if (typeof v === "string") return v;
  if (v instanceof ArrayBuffer) return new TextDecoder().decode(v);
  if (typeof (v as Blob)?.text === "function") return (v as Blob).text();
  if (ArrayBuffer.isView(v as ArrayBufferView)) {
    return new TextDecoder().decode(v as ArrayBufferView);
  }
  return null;
}
