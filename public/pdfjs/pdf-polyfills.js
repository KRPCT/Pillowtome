// pdf.js 5.5.207 compat shims for older WebViews (Android System WebView 134 gate).
//
// pdf.js targets a very recent JS baseline and calls two 2025-era TC39 methods that
// Chromium 134 lacks; every patch is guarded so native always wins:
//   Uint8Array.prototype.toHex   — worker fingerprint (throws on 134)
//   Map.prototype.getOrInsertComputed — worker + main-thread caches (throws on 134)
// The base64 shims are defensive for even older WebViews (base64 shipped in 133).
//
// Runs in the main thread (index.html <script>) and the pdf worker
// (pdf.worker.entry.mjs imports this first). Plain IIFE so it is valid both as a
// classic script and as a module import.
(() => {
  const U8 = Uint8Array.prototype;

  if (typeof U8.toHex !== "function") {
    Object.defineProperty(U8, "toHex", {
      writable: true,
      configurable: true,
      value() {
        let s = "";
        for (let i = 0; i < this.length; i++) {
          s += this[i].toString(16).padStart(2, "0");
        }
        return s;
      },
    });
  }

  if (typeof Uint8Array.fromHex !== "function") {
    Object.defineProperty(Uint8Array, "fromHex", {
      writable: true,
      configurable: true,
      value(hex) {
        const clean = hex.replace(/\s+/g, "");
        const out = new Uint8Array(clean.length >> 1);
        for (let i = 0; i < out.length; i++) {
          out[i] = parseInt(clean.substr(i * 2, 2), 16);
        }
        return out;
      },
    });
  }

  const B64 =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  if (typeof U8.toBase64 !== "function") {
    Object.defineProperty(U8, "toBase64", {
      writable: true,
      configurable: true,
      value() {
        let s = "";
        for (let i = 0; i < this.length; i += 3) {
          const b0 = this[i];
          const b1 = this[i + 1];
          const b2 = this[i + 2];
          s += B64[b0 >> 2];
          s += B64[((b0 & 3) << 4) | (b1 >> 4)];
          s += i + 1 < this.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : "=";
          s += i + 2 < this.length ? B64[b2 & 63] : "=";
        }
        return s;
      },
    });
  }

  if (typeof Uint8Array.fromBase64 !== "function") {
    Object.defineProperty(Uint8Array, "fromBase64", {
      writable: true,
      configurable: true,
      value(str) {
        const bin = atob(str.replace(/\s+/g, ""));
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      },
    });
  }

  // Map/WeakMap.prototype.getOrInsertComputed(key, callback): return the existing
  // value or compute+store+return one. https://github.com/tc39/proposal-upsert
  for (const Ctor of [Map, WeakMap]) {
    if (typeof Ctor.prototype.getOrInsertComputed !== "function") {
      Object.defineProperty(Ctor.prototype, "getOrInsertComputed", {
        writable: true,
        configurable: true,
        value(key, callbackfn) {
          if (this.has(key)) return this.get(key);
          const value = callbackfn(key);
          this.set(key, value);
          return value;
        },
      });
    }
  }
})();
