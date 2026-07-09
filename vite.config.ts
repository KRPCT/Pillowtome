import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/**
 * Stub foliate-js's `pdf.js` out of the bundle.
 *
 * foliate-js dynamically `import('./pdf.js')` only for PDF files; that module in
 * turn does `new URL(`vendor/pdfjs/${path}`, import.meta.url)`, a bare (no `./`)
 * glob that Vite's import-analysis rejects at build time. P1 renders EPUB only
 * (PDF is a later phase per STACK.md), so we replace the PDF entrypoint with a
 * throw-on-use stub. This keeps the vendored submodule pristine (no edits) and
 * never loads for the EPUB path. Remove when the PDF phase wires pdf.js properly.
 */
function stubFoliatePdf(): Plugin {
  const STUB_ID = "\0foliate-pdf-stub";
  return {
    name: "pillowtome:stub-foliate-pdf",
    enforce: "pre",
    resolveId(source, importer) {
      if (
        source === "./pdf.js" &&
        importer &&
        importer.replace(/\\/g, "/").includes("/vendor/foliate-js/")
      ) {
        return STUB_ID;
      }
      return null;
    },
    load(id) {
      if (id === STUB_ID) {
        return 'export const makePDF = () => { throw new Error("PDF 渲染属于后续阶段，尚未启用。"); };\n';
      }
      return null;
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [stubFoliatePdf(), react()],

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
