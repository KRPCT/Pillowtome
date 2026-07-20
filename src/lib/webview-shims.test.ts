/// <reference lib="es2024" />
/**
 * Node-environment tests for installWebViewShims (vitest environment: node).
 *
 * Strategy: temporarily delete/shadow a native API, run the installer, assert
 * the polyfilled behaviour, then restore the original. Node ≥ 20 ships all of
 * these natively, so a plain import is a no-op — only the delete-first path
 * exercises the shims.
 */
import { deflateSync, gzipSync, zlibSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { FflateDecompressionStream, installWebViewShims } from "./webview-shims";

type Restore = () => void;
const restores: Restore[] = [];

/** Delete `obj[key]` (or shadow it with `undefined` when not deletable). */
function remove(obj: object, key: PropertyKey, shadow = false): void {
  const rec = obj as Record<PropertyKey, unknown>;
  const had = Object.prototype.hasOwnProperty.call(obj, key);
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (had && !shadow) {
    delete rec[key];
    restores.push(() => {
      if (desc) Object.defineProperty(obj, key, desc);
    });
  } else {
    Object.defineProperty(obj, key, { value: undefined, configurable: true, writable: true });
    restores.push(() => {
      delete rec[key];
      if (desc && had) Object.defineProperty(obj, key, desc);
    });
  }
}

afterEach(() => {
  while (restores.length) restores.pop()?.();
});

describe("installWebViewShims", () => {
  it("is a no-op on a complete runtime and reports nothing", () => {
    const nativeAt = Array.prototype.at;
    const installed = installWebViewShims();
    expect(installed).toEqual([]);
    expect(Array.prototype.at).toBe(nativeAt); // native impl untouched
  });

  it("installs Array/String/TypedArray .at", () => {
    remove(Array.prototype, "at");
    remove(String.prototype, "at");
    remove(Uint8Array.prototype, "at");
    expect(installWebViewShims()).toContain("at");
    expect([1, 2, 3].at(-1)).toBe(3);
    expect([1, 2, 3].at(0)).toBe(1);
    expect([1, 2, 3].at(-4)).toBeUndefined();
    expect("读书".at(-1)).toBe("书");
    expect(new Uint8Array([7, 9]).at(-1)).toBe(9);
  });

  it("installs findLast / findLastIndex", () => {
    remove(Array.prototype, "findLast");
    remove(Array.prototype, "findLastIndex");
    expect(installWebViewShims()).toContain("findLast");
    const arr = [1, 4, 6, 8];
    expect(arr.findLast((n) => n % 2 === 0)).toBe(8);
    expect(arr.findLastIndex((n) => n % 2 === 0)).toBe(3);
    expect(arr.findLast((n) => n > 10)).toBeUndefined();
    expect(arr.findLastIndex((n) => n > 10)).toBe(-1);
  });

  it("installs Object.hasOwn", () => {
    remove(Object, "hasOwn");
    expect(installWebViewShims()).toContain("hasOwn");
    const obj = { a: 1 };
    expect(Object.hasOwn(obj, "a")).toBe(true);
    expect(Object.hasOwn(obj, "toString")).toBe(false);
  });

  it("installs Object.groupBy / Map.groupBy", () => {
    remove(Object, "groupBy");
    remove(Map, "groupBy");
    expect(installWebViewShims()).toContain("groupBy");
    const grouped = Object.groupBy([1, 2, 3, 4], (n) => (n % 2 === 0 ? "even" : "odd"));
    expect(grouped.odd).toEqual([1, 3]);
    expect(grouped.even).toEqual([2, 4]);
    const mapped = Map.groupBy(["a", "bb", "c"], (s) => s.length);
    expect(mapped.get(1)).toEqual(["a", "c"]);
    expect(mapped.get(2)).toEqual(["bb"]);
  });

  it("installs Promise.withResolvers", async () => {
    remove(Promise, "withResolvers");
    expect(installWebViewShims()).toContain("withResolvers");
    const { promise, resolve, reject } = Promise.withResolvers<number>();
    resolve(42);
    await expect(promise).resolves.toBe(42);
    const second = Promise.withResolvers<number>();
    second.reject(new Error("x"));
    await expect(second.promise).rejects.toThrow("x");
    expect(typeof reject).toBe("function");
  });

  it("installs crypto.randomUUID with v4 shape", () => {
    // crypto.randomUUID lives on the Crypto prototype in Node — shadow it.
    remove(crypto, "randomUUID", true);
    expect(installWebViewShims()).toContain("randomUUID");
    const id = crypto.randomUUID();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(crypto.randomUUID()).not.toBe(id);
  });

  it("installs structuredClone handling nested data and cycles", () => {
    remove(globalThis, "structuredClone");
    expect(installWebViewShims()).toContain("structuredClone");
    const src = {
      n: 1,
      s: "读",
      d: new Date(0),
      u8: new Uint8Array([1, 2]),
      m: new Map([["k", { deep: true }]]),
      set: new Set([1, 2]),
      arr: [1, { two: 2 }],
    };
    const out = structuredClone(src);
    expect(out).toEqual(src);
    expect(out.u8).not.toBe(src.u8);
    expect(out.m.get("k")).not.toBe(src.m.get("k"));
    type Cyclic = { self?: Cyclic };
    const cyc: Cyclic = {};
    cyc.self = cyc;
    const clonedCyc = structuredClone(cyc);
    expect(clonedCyc.self).toBe(clonedCyc);
  });

  it("installs the DecompressionStream ponyfill when deflate-raw is missing", () => {
    const native = globalThis.DecompressionStream;
    Object.defineProperty(globalThis, "DecompressionStream", {
      value: class {
        constructor(format: string) {
          if (format === "deflate-raw") {
            throw new TypeError(`Unsupported compression format: '${format}'`);
          }
        }
      },
      configurable: true,
      writable: true,
    });
    restores.push(() => {
      Object.defineProperty(globalThis, "DecompressionStream", {
        value: native,
        configurable: true,
        writable: true,
      });
    });
    expect(installWebViewShims()).toContain("deflateRaw");
    // Ponyfill now constructs deflate-raw without throwing.
    expect(() => new DecompressionStream("deflate-raw")).not.toThrow();
  });
});

describe("FflateDecompressionStream", () => {
  /** Pump chunks through the stream and join the decompressed output. */
  async function pump(
    stream: TransformStream<Uint8Array, Uint8Array>,
    chunks: Uint8Array[],
  ): Promise<Uint8Array> {
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const out: Uint8Array[] = [];
    const readAll = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out.push(value);
      }
    })();
    for (const c of chunks) await writer.write(c);
    await writer.close();
    await readAll;
    const total = out.reduce((n, c) => n + c.length, 0);
    const joined = new Uint8Array(total);
    let o = 0;
    for (const c of out) {
      joined.set(c, o);
      o += c.length;
    }
    return joined;
  }

  it("decompresses deflate-raw (ZIP entry format), chunked", async () => {
    const src = new TextEncoder().encode("枕籍 Pillowtome — EPUB 章节内容。".repeat(50));
    const packed = deflateSync(src);
    // Split the compressed payload awkwardly to prove streaming works.
    const chunks = [packed.subarray(0, 3), packed.subarray(3, 64), packed.subarray(64)];
    const out = await pump(new FflateDecompressionStream("deflate-raw"), chunks);
    expect(out).toEqual(src);
  });

  it("decompresses deflate (zlib wrapper) and gzip", async () => {
    const src = new TextEncoder().encode("老 WebView 兼容层测试数据。".repeat(20));
    expect(await pump(new FflateDecompressionStream("deflate"), [zlibSync(src)])).toEqual(src);
    expect(await pump(new FflateDecompressionStream("gzip"), [gzipSync(src)])).toEqual(src);
  });

  it("throws synchronously on unknown formats (zip.js relies on this)", () => {
    expect(() => new FflateDecompressionStream("brotli")).toThrow(TypeError);
    expect(() => new FflateDecompressionStream("deflate64-raw")).toThrow(
      /Unsupported compression format/,
    );
  });
});
