/**
 * Unwrap CSS cascade layers for old WebViews (Chrome ≤ 98, LDPlayer canary).
 *
 * Tailwind v4 emits every rule inside `@layer theme/base/components/utilities`
 * blocks. Chrome added `@layer` in 99 — older engines drop the ENTIRE block,
 * which is what left Radix sheets unpositioned (「菜单打不开」). lightningcss
 * (our css transformer/minifier) deliberately preserves layers, so the final
 * bundle is unwrapped here instead, preserving source order (= layer order,
 * so specificity semantics are unchanged for this output shape).
 *
 * Scanner is string- and comment-aware: braces inside quoted strings
 * (`content: "{"`) or comments never affect depth tracking.
 */

/** Strip `@layer a, b, c;` order statements and `@layer name{ … }` wrappers. */
export function unwrapCascadeLayers(css: string): string {
  let out = "";
  let i = 0;
  /** Depths (in output-brace counting) at which layer wrappers opened. */
  const layerDepths: number[] = [];
  let depth = 0;
  const n = css.length;

  while (i < n) {
    // Comments.
    if (css[i] === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      out += css.slice(i, stop);
      i = stop;
      continue;
    }
    // Strings.
    if (css[i] === '"' || css[i] === "'") {
      const quote = css[i];
      let j = i + 1;
      while (j < n && css[j] !== quote) {
        if (css[j] === "\\") j++;
        j++;
      }
      out += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    // At-rules.
    if (css[i] === "@") {
      const m = /^@layer\b/.exec(css.slice(i, i + 8));
      if (m) {
        // Find the terminator: ';' (order statement) or '{' (wrapper).
        let j = i + m[0].length;
        while (j < n && css[j] !== ";" && css[j] !== "{") j++;
        if (j < n && css[j] === ";") {
          i = j + 1; // drop `@layer a, b, c;` entirely
          continue;
        }
        if (j < n && css[j] === "{") {
          layerDepths.push(depth); // wrapper opens at current depth
          depth++;
          i = j + 1; // drop the prelude, keep contents
          continue;
        }
      }
      out += css[i];
      i++;
      continue;
    }
    if (css[i] === "{") {
      depth++;
      out += css[i];
      i++;
      continue;
    }
    if (css[i] === "}") {
      depth--;
      if (layerDepths.length > 0 && depth === layerDepths[layerDepths.length - 1]) {
        layerDepths.pop(); // this brace closes a layer wrapper — drop it
        i++;
        continue;
      }
      out += css[i];
      i++;
      continue;
    }
    out += css[i];
    i++;
  }
  return out;
}
