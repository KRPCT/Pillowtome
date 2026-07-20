/**
 * 老旧 Android System WebView 运行时补齐（Chromium 91 量级）。
 *
 * 国内大量设备（无 Play 商店的 ROM、老旧机型、部分模拟器）的 System WebView
 * 停留在 Chromium ≤ 103 之前：缺 `Array.prototype.at`（92+）、`Object.hasOwn`
 * （93+）、`findLast/findLastIndex`（97+）、`structuredClone`（98+）、
 * `DecompressionStream('deflate-raw')`（103+）、`Object.groupBy`/`Map.groupBy`
 * （117+）、`Promise.withResolvers`（119+）。foliate-js 的 EPUB 解压与解析
 * （zip.js 原生解压流、`Object.groupBy` 解析 OPF、`parents.at(-1)` 加载章节、
 * paginator `findLastIndex`）与我们的 locator/annotation 存储
 * （`crypto.randomUUID`）都会直接抛 TypeError，被阅读器兜成
 * 「文件已损坏或无法读取。」—— 本模块在应用入口最先执行，把缺口补齐。
 *
 * 只装缺失项，不覆盖原生实现（`DecompressionStream` 例外：原生在但格式不全，
 * 整体替换为行为等价的 ponyfill）；实现遵循 ECMAScript 规范语义（简化边界：
 * 稀疏数组、奇异 receiver 不作完整模拟）。
 */

import { Gunzip, Inflate, Unzlib } from "fflate";

type AnyFn = (...args: never[]) => unknown;

/** 定义缺失的原型/静态方法（可配置、可写、不可枚举，与原生一致）。 */
function define(target: object, key: string | symbol, value: AnyFn): void {
  if ((target as Record<PropertyKey, unknown>)[key] !== undefined) return;
  Object.defineProperty(target, key, {
    value,
    writable: true,
    configurable: true,
  });
}

/**
 * fflate 版 `DecompressionStream` ponyfill（ZIP 条目 = raw deflate）。
 *
 * foliate-js 的 vendored zip.js 解 EPUB 完全依赖原生
 * `DecompressionStream('deflate-raw')`（Chrome 103+），且禁用了 WASM worker
 * （`useWebWorkers: false`）、bundle 内也不含 JS inflate 回退 codec —— 在
 * Chromium ≤102 的 WebView 上**任何** EPUB 都解压失败。zip.js 在模块初始化时
 * 捕获全局 `DecompressionStream`，因此在入口最早处装上 ponyfill 即可被其
 * 透明使用（现代 WebView 保留原生实现，零成本）。
 */
export class FflateDecompressionStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor(format: string) {
    // 与原生一致：未知格式在构造时同步抛错（zip.js 依赖该行为做 codec 回退）。
    if (format !== "deflate-raw" && format !== "deflate" && format !== "gzip") {
      throw new TypeError(
        `Failed to construct 'DecompressionStream': Unsupported compression format: '${format}'`,
      );
    }
    type Pushable = {
      ondata: ((chunk: Uint8Array, final: boolean) => void) | null;
      push: (chunk: Uint8Array, final?: boolean) => void;
    };
    let inflate: Pushable;
    super({
      start: (controller) => {
        inflate = (
          format === "deflate-raw"
            ? new Inflate()
            : format === "deflate"
              ? new Unzlib()
              : new Gunzip()
        ) as unknown as Pushable;
        inflate.ondata = (chunk) => controller.enqueue(chunk);
      },
      transform: (chunk) => {
        inflate.push(toUint8(chunk), false);
      },
      flush: () => {
        inflate.push(new Uint8Array(0), true);
      },
    });
  }
}

function toUint8(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  return new Uint8Array(chunk as ArrayLike<number>);
}

/** 原生 `DecompressionStream` 是否支持 ZIP 需要的 `deflate-raw`（Chrome 103+）。 */
export function supportsDeflateRaw(): boolean {
  try {
    if (typeof DecompressionStream !== "function") return false;
    new DecompressionStream("deflate-raw");
    return true;
  } catch {
    return false;
  }
}

/**
 * 原生缺 `deflate-raw` 时用 ponyfill **覆盖**全局（原生仍在但格式不全；
 * ponyfill 三种格式都支持，行为对齐原生流式语义）。
 */
function installDecompressionStream(): void {
  (globalThis as Record<string, unknown>).DecompressionStream = FflateDecompressionStream;
}

/** `Array/String/TypedArray.prototype.at`（Chrome 92+）。 */
function installAt(): void {
  function at(this: { length: number }, index: number): unknown {
    const len = this.length >>> 0;
    const i = Math.trunc(index) || 0;
    const k = i >= 0 ? i : len + i;
    return k >= 0 && k < len ? (this as Record<number, unknown>)[k] : undefined;
  }
  define(Array.prototype, "at", at as AnyFn);
  define(String.prototype, "at", at as AnyFn);
  const typedArrays: { prototype: object }[] = [
    Uint8Array,
    Uint8ClampedArray,
    Int8Array,
    Uint16Array,
    Int16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
  ];
  if (typeof BigInt64Array !== "undefined") {
    typedArrays.push(BigInt64Array, BigUint64Array);
  }
  for (const ctor of typedArrays) define(ctor.prototype, "at", at as AnyFn);
}

/** `Array.prototype.findLast` / `findLastIndex`（Chrome 97+）。 */
function installFindLast(): void {
  function findLastIndex(
    this: ArrayLike<unknown>,
    predicate: (value: unknown, index: number, arr: ArrayLike<unknown>) => boolean,
    thisArg?: unknown,
  ): number {
    for (let i = this.length - 1; i >= 0; i--) {
      if (predicate.call(thisArg, this[i], i, this)) return i;
    }
    return -1;
  }
  function findLast(
    this: ArrayLike<unknown>,
    predicate: (value: unknown, index: number, arr: ArrayLike<unknown>) => boolean,
    thisArg?: unknown,
  ): unknown {
    const i = findLastIndex.call(this, predicate, thisArg);
    return i < 0 ? undefined : this[i];
  }
  define(Array.prototype, "findLastIndex", findLastIndex as AnyFn);
  define(Array.prototype, "findLast", findLast as AnyFn);
}

/** `Object.hasOwn`（Chrome 93+）。 */
function installHasOwn(): void {
  define(Object, "hasOwn", ((obj: unknown, key: PropertyKey) =>
    Object.prototype.hasOwnProperty.call(Object(obj), key)) as AnyFn);
}

/** `Object.groupBy` / `Map.groupBy`（Chrome 117+）。 */
function installGroupBy(): void {
  define(
    Object,
    "groupBy",
    (<T, K extends PropertyKey>(items: Iterable<T>, callback: (item: T, index: number) => K) => {
      const groups: Record<PropertyKey, T[]> = Object.create(null);
      let i = 0;
      for (const item of items) {
        const key = callback(item, i++);
        (groups[key] ??= []).push(item);
      }
      return groups;
    }) as AnyFn,
  );
  define(
    Map,
    "groupBy",
    (<T, K>(items: Iterable<T>, callback: (item: T, index: number) => K) => {
      const groups = new Map<K, T[]>();
      let i = 0;
      for (const item of items) {
        const key = callback(item, i++);
        const list = groups.get(key);
        if (list) list.push(item);
        else groups.set(key, [item]);
      }
      return groups;
    }) as AnyFn,
  );
}

/** `crypto.randomUUID`（Chrome 92+；我们的 locator/annotation 行 id 依赖它）。 */
function installRandomUUID(): void {
  if (typeof crypto === "undefined") return;
  if (typeof crypto.randomUUID === "function") return;
  const hex: string[] = [];
  for (let i = 0; i < 256; i++) hex.push(i.toString(16).padStart(2, "0"));
  crypto.randomUUID = function randomUUID(): `${string}-${string}-${string}-${string}-${string}` {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10
    return (
      hex[b[0]] + hex[b[1]] + hex[b[2]] + hex[b[3]] + "-" +
      hex[b[4]] + hex[b[5]] + "-" +
      hex[b[6]] + hex[b[7]] + "-" +
      hex[b[8]] + hex[b[9]] + "-" +
      hex[b[10]] + hex[b[11]] + hex[b[12]] + hex[b[13]] + hex[b[14]] + hex[b[15]]
    ) as `${string}-${string}-${string}-${string}-${string}`;
  };
}

/** `Promise.withResolvers`（Chrome 119+；pdf.js 主线程与 worker 均使用）。 */
function installWithResolvers(): void {
  define(Promise, "withResolvers", (<T>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }) as AnyFn);
}

/**
 * `structuredClone`（Chrome 98+）。覆盖常见数据类型（plain object / 数组 /
 * TypedArray / ArrayBuffer / Date / RegExp / Map / Set），支持循环引用；
 * 不可克隆类型（函数、DOM 节点）按规范抛 DataCloneError 语义退化为浅引用。
 */
function installStructuredClone(): void {
  if (typeof structuredClone === "function") return;
  const clone = <T>(value: T, seen: Map<unknown, unknown>): T => {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value) as T;
    const v = value as object;
    if (v instanceof Date) return new Date(v.getTime()) as T;
    if (v instanceof RegExp) return new RegExp(v.source, v.flags) as T;
    if (v instanceof ArrayBuffer) return v.slice(0) as T;
    if (ArrayBuffer.isView(v)) {
      const Ctor = v.constructor as new (buf: ArrayBuffer) => T;
      return new Ctor((v.buffer as ArrayBuffer).slice(0)) as T;
    }
    if (v instanceof Map) {
      const out = new Map();
      seen.set(value, out);
      for (const [k, val] of v) out.set(clone(k, seen), clone(val, seen));
      return out as T;
    }
    if (v instanceof Set) {
      const out = new Set();
      seen.set(value, out);
      for (const val of v) out.add(clone(val, seen));
      return out as T;
    }
    const out = (Array.isArray(v) ? [] : {}) as Record<PropertyKey, unknown>;
    seen.set(value, out);
    for (const key of Reflect.ownKeys(v)) {
      out[key] = clone((v as Record<PropertyKey, unknown>)[key], seen);
    }
    return out as T;
  };
  (globalThis as Record<string, unknown>).structuredClone = <T>(value: T): T =>
    clone(value, new Map());
}

/**
 * 在入口最早处调用（`main.tsx` 第一行 import）。幂等，可重复执行。
 * 返回本次检测到并补齐的 API 名，便于诊断日志与测试断言。
 */
export function installWebViewShims(): string[] {
  const missing: string[] = [];
  const probe = (name: string, present: boolean, install: () => void): void => {
    if (present) return;
    install();
    missing.push(name);
  };
  probe("at", typeof Array.prototype.at === "function", installAt);
  probe("findLast", typeof Array.prototype.findLast === "function", installFindLast);
  probe("hasOwn", typeof (Object as { hasOwn?: unknown }).hasOwn === "function", installHasOwn);
  probe(
    "groupBy",
    typeof (Object as { groupBy?: unknown }).groupBy === "function" &&
      typeof (Map as { groupBy?: unknown }).groupBy === "function",
    installGroupBy,
  );
  probe(
    "randomUUID",
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function",
    installRandomUUID,
  );
  probe(
    "withResolvers",
    typeof (Promise as { withResolvers?: unknown }).withResolvers === "function",
    installWithResolvers,
  );
  probe("structuredClone", typeof structuredClone === "function", installStructuredClone);
  probe("deflateRaw", supportsDeflateRaw(), installDecompressionStream);
  return missing;
}

installWebViewShims();
