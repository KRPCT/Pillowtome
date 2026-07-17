/**
 * 简繁转换 (Simplified ↔ Traditional) via OpenCC — pure string conversion.
 *
 * `Locale.to.tw` here is char-form conversion (乾杯/後天 by context) WITHOUT
 * Taiwan vocabulary substitution (软件 stays 軟件, not 軟體), so it is
 * (near-)length-preserving — the friendliest OpenCC config for CFI/resume
 * stability. Applied to section content pre-render via `cjk-content-transform`
 * (foliate transformTarget); the original book file is never modified.
 */

import * as OpenCC from "opencc-js/core";
import * as Locale from "opencc-js/preset";

export type ConvertMode = "off" | "s2t" | "t2s";

export const CONVERT_MODES: ConvertMode[] = ["off", "s2t", "t2s"];
export function isConvertMode(v: string): v is ConvertMode {
  return v === "off" || v === "s2t" || v === "t2s";
}

let s2tFn: ((s: string) => string) | null = null;
let t2sFn: ((s: string) => string) | null = null;

/** Lazily build + cache the converter (dictionary load is the expensive part). */
function converterFor(mode: ConvertMode): ((s: string) => string) | null {
  try {
    if (mode === "s2t")
      return (s2tFn ??= OpenCC.ConverterFactory(Locale.from.cn, Locale.to.tw));
    if (mode === "t2s")
      return (t2sFn ??= OpenCC.ConverterFactory(Locale.from.tw, Locale.to.cn));
  } catch {
    return null;
  }
  return null;
}

/** Convert a string via OpenCC. `off` (or an unavailable converter) returns it as-is. */
export function convertText(text: string, mode: ConvertMode): string {
  const convert = converterFor(mode);
  return convert ? convert(text) : text;
}
