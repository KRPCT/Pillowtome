/**
 * Node-environment tests for installAutospaceShim (vitest environment: node).
 * Minimal Document stand-in — no jsdom dependency.
 */
import { describe, expect, it } from "vitest";
import {
  installAutospaceShim,
  shouldInstallAutospaceShim,
} from "./cjk-autospace-shim";

/** Minimal Document/body stand-in for textContent invariance checks. */
function makeDoc(html: string): Document {
  let bodyHtml = html;
  let textContent = stripTags(html);

  const listeners: { type: string; fn: EventListener }[] = [];

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
    querySelectorAll(sel: string) {
      if (!sel.includes("data-pillow-shim")) return [] as unknown as NodeListOf<Element>;
      // Empty: our stand-in does not implement real span install without DOM APIs.
      return [] as unknown as NodeListOf<Element>;
    },
  };

  const doc = {
    body,
    documentElement: body,
    head: {
      appendChild() {
        /* no-op */
      },
    },
    defaultView: null,
    createTreeWalker() {
      // No real nodes — empty walk yields no-op install (silent degrade path).
      return {
        nextNode() {
          return null;
        },
      };
    },
    createElement(tag: string) {
      return {
        tagName: tag.toUpperCase(),
        style: {} as CSSStyleDeclaration,
        setAttribute() {
          /* no-op */
        },
        id: "",
        textContent: "",
        remove() {
          /* no-op */
        },
      };
    },
    getElementById() {
      return null;
    },
    createRange() {
      return {
        setStart() {
          /* no-op */
        },
        setEnd() {
          /* no-op */
        },
      };
    },
    addEventListener(type: string, fn: EventListener) {
      listeners.push({ type, fn });
    },
  };
  return doc as unknown as Document;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function bodyTextSnapshot(doc: Document): string {
  return doc.body?.textContent ?? "";
}

describe("shouldInstallAutospaceShim", () => {
  it("is true only when toggle ON and native autospace unsupported", () => {
    expect(
      shouldInstallAutospaceShim(
        { cjkAutospace: true },
        { textAutospace: false },
      ),
    ).toBe(true);
    expect(
      shouldInstallAutospaceShim(
        { cjkAutospace: true },
        { textAutospace: true },
      ),
    ).toBe(false);
    expect(
      shouldInstallAutospaceShim(
        { cjkAutospace: false },
        { textAutospace: false },
      ),
    ).toBe(false);
  });
});

describe("installAutospaceShim", () => {
  it("keeps concatenated textContent equal to original after install", () => {
    const samples = [
      "<p>读取PDF文件</p>",
      "<p>ABC中文123</p>",
      "<p>中文ABC数字123混排。</p><p>「引用」与Latin。</p>",
    ];
    for (const html of samples) {
      const doc = makeDoc(html);
      const before = bodyTextSnapshot(doc);
      const dispose = installAutospaceShim(doc);
      expect(bodyTextSnapshot(doc)).toBe(before);
      dispose();
      expect(bodyTextSnapshot(doc)).toBe(before);
    }
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

  it("double-install remains textContent-safe", () => {
    const doc = makeDoc("<p>读取PDF文件</p>");
    const before = bodyTextSnapshot(doc);
    const d1 = installAutospaceShim(doc);
    const d2 = installAutospaceShim(doc);
    expect(bodyTextSnapshot(doc)).toBe(before);
    d1();
    d2();
    expect(bodyTextSnapshot(doc)).toBe(before);
  });
});
