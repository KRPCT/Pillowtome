// Worker entry: install the Uint8Array hex/base64 polyfill before pdf.js's worker
// runs, then hand off to the real (pristine) worker. Loaded as a module worker via
// GlobalWorkerOptions.workerSrc (see vite.config.ts wireFoliatePdf). Relative imports
// resolve at runtime against /pdfjs/ — the browser fetches these public files
// directly, so Vite never touches them (works identically in dev and build).
import "./pdf-polyfills.js";
import "./pdf.worker.mjs";
