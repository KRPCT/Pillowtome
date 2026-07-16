/**
 * Shared zh (Hans/Hant) kinsoku prohibition tables (CJK-03).
 *
 * Runtime enforcer is CSS `line-break: strict` (03-01). These tables exist for
 * unit snapshots and golden fixtures only — no DOM rewriter, no JA UI.
 * Derived from CLREQ §6.1 start/end prohibition sets.
 */

/** Must not start a line (行首禁则) — closing / trailing punctuation. */
export const ZH_PROHIBITED_LINE_START = [
  "。",
  "，",
  "、",
  "；",
  "：",
  "？",
  "！",
  "》",
  "」",
  "』",
  "】",
  "）",
  "〗",
  "〉",
  "”",
  "’",
  "℃",
  "%",
  "‰",
  "…",
  "—",
] as const;

/** Must not end a line (行尾禁则) — opening punctuation. */
export const ZH_PROHIBITED_LINE_END = [
  "《",
  "「",
  "『",
  "【",
  "（",
  "〖",
  "〈",
  "“",
  "‘",
] as const;
