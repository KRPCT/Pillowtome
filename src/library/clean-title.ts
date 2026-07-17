/**
 * Lightweight shelf-title cleaning: strip the source-site tail that CN novel
 * sites append to `<dc:title>` (e.g. "…-第一卷-迷糊轻小说"). Display-only —
 * callers pass the raw stored title and show the cleaned result; the DB is never
 * mutated, so the toggle is reversible.
 *
 * ponytail: conservative by design — only a curated known-site list + a trailing
 * domain-in-parens are stripped, so real titles (even ones containing "小说")
 * are never truncated. Upgrade path: derive the site from `dc:publisher` at
 * import time if the list proves too narrow.
 */

/** Known source-site tails seen on CN light-novel / novel EPUBs. */
const SITE_SUFFIXES = [
  "迷糊轻小说",
  "轻小说文库",
  "轻之国度",
  "SF轻小说",
  "知轩藏书",
  "刺猬猫",
  "书虫小说网",
  "无限轻小说",
  "落秋中文",
  "神様小说",
];

/** Separators a site tail hangs off (ascii + fullwidth + CJK dashes/space). */
const SEP = "\\s\\-_|·—～~　";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strip the source-site tail from a shelf title; falls back to raw if empty. */
export function cleanBookTitle(raw: string | null | undefined): string {
  if (!raw) return raw ?? "";
  const original = raw.trim();
  let t = original;

  // Trailing "(www.xxx.com)" / "（xxx.net）" domain parens.
  t = t
    .replace(/[（(][^（()）]*(?:www\.)?[a-z0-9-]+\.[a-z]{2,}[^（()）]*[）)]\s*$/i, "")
    .trim();

  // Repeatedly peel a trailing "<sep><site>" or a bracketed "【site】" tag.
  let changed = true;
  while (changed) {
    changed = false;
    for (const site of SITE_SUFFIXES) {
      const tail = new RegExp(`[${SEP}]+${escapeRe(site)}\\s*$`);
      if (tail.test(t)) {
        t = t.replace(tail, "").trim();
        changed = true;
      }
      const bracket = new RegExp(`[【\\[（(]\\s*${escapeRe(site)}\\s*[】\\])）]`, "g");
      if (bracket.test(t)) {
        t = t.replace(bracket, "").trim();
        changed = true;
      }
    }
  }

  return t.length ? t : original;
}
