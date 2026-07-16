/**
 * Node-environment tests for installAutospaceShim (vitest environment: node).
 * Minimal Document stand-in — no jsdom dependency.
 */
import { describe, expect, it } from "vitest";
import { installAutospaceShim } from "./cjk-autospace-shim";

/** Minimal Document/body stand-in for textContent invariance checks. */
function makeDoc(html: string): Document {
  let bodyHtml = html;
  let textContent = stripTags(html);
  const body = {
    get innerHTML() {
      return bodyHtml;
    },
    set innerHTML(v: string) {
      bodyHtml = v;
      textContent = stripTags(v);
    },
    get textContent() {
      return textContent;
    },
  };
  return { body } as unknown as Document;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function bodyTextSnapshot(doc: Document): string {
  return doc.body?.textContent ?? "";
}

describe("installAutospaceShim", () => {
  it("keeps concatenated textContent equal to original after install", () => {
    const doc = makeDoc("<p>中文ABC数字123混排。</p><p>「引用」与Latin。</p>");
    const before = bodyTextSnapshot(doc);

    const dispose = installAutospaceShim(doc);
    expect(bodyTextSnapshot(doc)).toBe(before);

    dispose();
    expect(bodyTextSnapshot(doc)).toBe(before);
  });

  it("disposer is idempotent and restores DOM", () => {
    const doc = makeDoc("<p>测试Test混排</p>");
    const htmlBefore = doc.body.innerHTML;
    const textBefore = bodyTextSnapshot(doc);

    const dispose = installAutospaceShim(doc);
    dispose();
    dispose();

    expect(bodyTextSnapshot(doc)).toBe(textBefore);
    expect(doc.body.innerHTML).toBe(htmlBefore);
  });

  it("never inserts U+0020 or U+2009 into body text", () => {
    const doc = makeDoc("<p>中A文1B字</p>");
    const before = bodyTextSnapshot(doc);
    expect(before).not.toMatch(/[\u0020\u2009]/);

    installAutospaceShim(doc);
    const after = bodyTextSnapshot(doc);
    expect(after).toBe(before);
    expect(after).not.toMatch(/[\u0020\u2009]/);
  });
});
