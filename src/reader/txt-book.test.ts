import { describe, expect, it } from "vitest";
import { chapterToHtml, decodeTextBytes, splitChapters } from "./txt-book";

const utf8 = (s: string) => new TextEncoder().encode(s);

describe("decodeTextBytes", () => {
  it("decodes UTF-8 and strips a BOM", () => {
    expect(decodeTextBytes(utf8("你好世界"))).toBe("你好世界");
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("标题")]);
    expect(decodeTextBytes(bom)).toBe("标题");
  });

  it("falls back to GB18030 for non-UTF-8 Chinese bytes", () => {
    // "第一章" in GBK/GB18030.
    const gbk = new Uint8Array([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2]);
    expect(decodeTextBytes(gbk)).toBe("第一章");
  });

  it("rejects binary (NUL bytes) and empty input", () => {
    expect(decodeTextBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x00, 0x04]))).toBeNull();
    expect(decodeTextBytes(new Uint8Array())).toBeNull();
  });
});

describe("splitChapters", () => {
  it("splits on CN chapter headings", () => {
    const text = "楔子\n开场白\n第一章 商品\n正文一\n第二章 货币\n正文二";
    const chs = splitChapters(text);
    expect(chs.map((c) => c.title)).toEqual(["楔子", "第一章 商品", "第二章 货币"]);
    expect(chs[1].body).toContain("正文一");
  });

  it("does not treat prose beginning with 第一章… as a heading", () => {
    const text = "第一章讲述了商品的两个因素以及价值形式的演变过程反复展开论述".repeat(1);
    const chs = splitChapters(text);
    // No heading match ⇒ single size-split part, not a chapter titled by the prose.
    expect(chs.length).toBe(1);
    expect(chs[0].title).not.toContain("讲述");
  });

  it("size-splits a heading-less book into bounded parts", () => {
    const big = "段落。\n".repeat(20_000); // ~120k chars, no headings
    const chs = splitChapters(big);
    expect(chs.length).toBeGreaterThan(1);
    expect(chs[0].title).toBe("第 1 部分");
    for (const c of chs) expect(c.body.length).toBeLessThanOrEqual(60_000);
  });
});

describe("chapterToHtml", () => {
  it("escapes markup and wraps lines in paragraphs", () => {
    const html = chapterToHtml({ title: "第一章 <A>", body: "第一行 & 记号\n第二行" });
    expect(html).toContain("<title>第一章 &lt;A&gt;</title>");
    expect(html).toContain("<h2>第一章 &lt;A&gt;</h2>");
    expect(html).toContain("<p>第一行 &amp; 记号</p>");
    expect(html).toContain("<p>第二行</p>");
  });
});
