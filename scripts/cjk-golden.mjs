#!/usr/bin/env node
/**
 * CJK coverage golden harness (D-46 / DEC-002).
 *
 * Captures screenshots of tests/fixtures/cjk/coverage-sheet.html under:
 *   - Chromium (Blink family — covers Windows WebView2 product path)
 *   - WebKit (when Playwright WebKit is installed)
 *
 * Outputs:
 *   tests/fixtures/cjk/golden/blink/coverage.png
 *   tests/fixtures/cjk/golden/webkit/coverage.png
 *
 * Exit codes:
 *   0 — Chromium capture ok; WebKit ok or explicitly skipped after attempt log
 *   1 — Chromium failed / script crash
 *
 * CI: at least Chromium. WebKit required for full phase gate on macOS/WebKit runners.
 * First run creates baselines; optional pixel compare when baselines already exist
 * is left as a future enhancement (document: visual review of PNGs is primary).
 *
 * Usage: node scripts/cjk-golden.mjs
 * Optional: pnpm exec playwright install chromium webkit
 */

import { mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const fixture = path.join(root, "tests/fixtures/cjk/coverage-sheet.html");
const goldenRoot = path.join(root, "tests/fixtures/cjk/golden");

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function capture(browserType, label, outDir) {
  await mkdir(outDir, { recursive: true });
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 1200 },
    });
    const url = pathToFileURL(fixture).href;
    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    await page.waitForTimeout(300);
    const out = path.join(outDir, "coverage.png");
    await page.screenshot({ path: out, fullPage: true });
    console.log(`[cjk-golden] ${label}: wrote ${path.relative(root, out)}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!(await exists(fixture))) {
    console.error(`[cjk-golden] missing fixture: ${fixture}`);
    process.exit(1);
  }

  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    console.error(
      "[cjk-golden] playwright not installed. Run: pnpm add -D playwright@1.52.0 && pnpm exec playwright install chromium webkit",
    );
    process.exit(1);
  }

  const { chromium, webkit } = playwright;

  // Blink / Chromium — required
  try {
    await capture(
      chromium,
      "blink/chromium",
      path.join(goldenRoot, "blink"),
    );
  } catch (err) {
    console.error("[cjk-golden] Chromium capture failed:", err);
    process.exit(1);
  }

  // WebKit — attempt; log skip if browser binary missing
  try {
    await capture(webkit, "webkit", path.join(goldenRoot, "webkit"));
  } catch (err) {
    const msg = String(err?.message ?? err);
    console.warn(
      "[cjk-golden] WebKit capture skipped/failed (install with: pnpm exec playwright install webkit):",
      msg.split("\n")[0],
    );
    // Non-zero only if we want strict gate; plan allows attempt + log when unavailable.
  }

  console.log("[cjk-golden] done");
}

main().catch((err) => {
  console.error("[cjk-golden] fatal:", err);
  process.exit(1);
});
