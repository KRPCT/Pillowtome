import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { unwrapCascadeLayers } from "./src/lib/css-unwrap-layers";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/**
 * Wire foliate-js's `pdf.js` to load its runtime assets from `/pdfjs/`.
 *
 * foliate-js dynamically `import('./pdf.js')` for PDFs; that module resolves the
 * pdf.js worker / cmaps / standard-fonts / CSS via
 * `new URL(`vendor/pdfjs/${path}`, import.meta.url)`, a template-literal glob
 * that Vite's asset-import-analysis mangles (and its `cmaps/`/`standard_fonts/`
 * base-URL uses can't survive the glob rewrite). We instead serve those assets
 * verbatim from `public/pdfjs/` and rewrite `pdfjsPath` to an absolute
 * same-origin `/pdfjs/…` URL — no glob, CSP-`self`-clean, identical in dev and
 * build. The submodule stays pristine on disk (this is a build-time transform).
 * The pdf.mjs lib itself keeps loading via the static `import './vendor/…'`.
 */
function wireFoliatePdf(): Plugin {
  return {
    name: "pillowtome:wire-foliate-pdf",
    enforce: "pre",
    transform(code, id) {
      if (!id.replace(/\\/g, "/").endsWith("/vendor/foliate-js/pdf.js")) {
        return null;
      }
      const patched = code
        .replace(
          /const pdfjsPath = path =>[^\n]*/,
          "const pdfjsPath = path => '/pdfjs/' + path",
        )
        // Route the worker through the polyfilled entry (older WebViews lack
        // Uint8Array.prototype.toHex, which pdf.js's worker calls).
        .replace("pdfjsPath('pdf.worker.mjs')", "pdfjsPath('pdf.worker.entry.mjs')");
      return patched === code ? null : { code: patched, map: null };
    },
  };
}

// NOTE: foliate-js's zip.js needs `DecompressionStream('deflate-raw')`
// (Chrome 103+) to unzip EPUBs. Older WebViews are covered by the fflate-based
// ponyfill installed at app entry (`src/lib/webview-shims.ts`) — deliberately
// NOT a build-time patch: zip.js captures the global at module init, and the
// vendored bundle ships no JS inflate fallback codec of its own.

/**
 * Unwrap Tailwind v4's @layer blocks in the final CSS bundle (Chrome ≤ 98
 * can't parse them; lightningcss intentionally preserves layers). Runs last,
 * after the lightningcss minifier, on the emitted asset text.
 */
function unwrapLayersPlugin(): Plugin {
  return {
    name: "pillowtome:unwrap-cascade-layers",
    apply: "build",
    enforce: "post",
    generateBundle(_, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (!fileName.endsWith(".css")) continue;
        const asset = bundle[fileName];
        if (asset.type === "asset" && typeof asset.source === "string") {
          asset.source = unwrapCascadeLayers(asset.source);
        }
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [wireFoliatePdf(), unwrapLayersPlugin(), react(), tailwindcss()],
  css: {
    // Old-System-WebView compat (Chrome 91 baseline, LDPlayer canary):
    // Tailwind v4 emits @layer/oklch/color-mix/nesting that Chrome ≤98 cannot
    // parse — the whole utilities layer was being dropped, which left every
    // Radix Sheet (设置/目录/搜索/批注) DOM-mounted but UNPOSITIONED
    // (position: static, off-screen) →「菜单打不开」. lightningcss lowers the
    // bundle to chrome91 (unwraps @layer, converts oklch/color-mix, flattens
    // nesting). JS-side gaps are covered by src/lib/webview-shims.ts.
    transformer: "lightningcss",
    lightningcss: {
      targets: { chrome: 91 },
    },
  },
  build: {
    cssMinify: "lightningcss",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
