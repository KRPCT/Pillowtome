// Device-level BDD acceptance runner for specs/reader-experience.txt.
// Requires: emulator-5554 running the DEBUG build (webview devtools enabled).
// Usage: node scripts/acceptance/run.mjs [--only <substr>] [--keep-open]
//
// Each scenario prints PASS/FAIL + evidence; exit code 1 on any failure.
import { readFileSync } from "node:fs";
import { Cdp, adb, tap, swipe, sleep, until, logcatCount } from "./cdp-lib.mjs";

const ONLY = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1]
  : null;
const KEEP_OPEN = process.argv.includes("--keep-open");

const results = [];
async function scenario(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  const t0 = Date.now();
  try {
    const evidence = await fn();
    results.push({ name, ok: true, evidence, ms: Date.now() - t0 });
    console.log(`PASS  ${name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)  ${evidence ?? ""}`);
  } catch (err) {
    results.push({ name, ok: false, evidence: String(err).slice(0, 400), ms: Date.now() - t0 });
    console.log(`FAIL  ${name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)\n      ${String(err).slice(0, 400)}`);
  }
}

async function relaunch() {
  adb("shell", "am", "force-stop", "com.pillowtome.app");
  adb("shell", "monkey", "-p", "com.pillowtome.app", "-c", "android.intent.category.LAUNCHER", "1");
  await sleep(9000);
  const cdp = await Cdp.connect();
  // Dismiss the update dialog if it appears (test builds may be behind latest).
  await cdp.ev(`(() => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === '以后再说'); if (b) b.click(); return true })()`);
  await sleep(400);
  return cdp;
}

async function openSample(cdp) {
  await cdp.clickText("示例");
  await until(async () => cdp.ev(`!!document.querySelector('foliate-view')`), { label: "reader open", timeout: 15000 });
  await sleep(2500);
}

async function showChrome(cdp) {
  const on = await cdp.ev(`!!document.querySelector('button[aria-label="排版设置"]')`);
  if (!on) {
    await cdp.ev(`(() => {
      const host = document.querySelector('.reader') ?? document.body;
      const r = host.getBoundingClientRect();
      for (const type of ['pointerdown', 'pointerup', 'click']) {
        host.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: r.width / 2, clientY: r.height / 2, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0 }));
      }
      return true;
    })()`);
    await sleep(900);
  }
}

// ---------------------------------------------------------------- scenarios

async function scSerifLoads() {
  const cdp = await relaunch();
  try {
    await openSample(cdp);
    const faces = await until(
      async () => {
        const f = await cdp.ev(`[...document.fonts].map(f => f.family + ':' + f.status)`);
        return f.some((s) => s.includes("Serif")) ? f : null;
      },
      { label: "serif face settled", timeout: 20000 },
    );
    const serif = faces.find((s) => s.includes("Serif"));
    if (serif.endsWith(":error") || serif.endsWith(":unloaded")) {
      throw new Error(`serif face failed: ${serif}`);
    }
    // No OTS/decode errors in console.
    const bad = cdp.consoleLogs.filter((l) => l.includes("OTS parsing error") || l.includes("Failed to decode downloaded font"));
    if (bad.length) throw new Error(`font decode errors: ${bad[0]}`);
    return serif;
  } finally {
    cdp.close();
  }
}

async function scSerifPreview() {
  const cdp = await relaunch();
  try {
    await openSample(cdp);
    await showChrome(cdp);
    await cdp.clickAria("排版设置");
    await sleep(1600);
    await cdp.ev(`(() => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.includes('思源宋体')); if (!b) throw new Error('serif option missing'); b.click(); return true })()`);
    await sleep(1200);
    const st = await cdp.ev(`(() => {
      const page = document.querySelector('.reader-aa-preview__page');
      const cs = getComputedStyle(page);
      const face = [...document.fonts].find(f => f.family.includes('Serif'));
      return { ff: cs.fontFamily, face: face ? face.status : 'missing', text: page.textContent.slice(0, 8) };
    })()`);
    if (!st.ff.includes("Serif")) throw new Error(`preview not serif: ${st.ff}`);
    if (st.face !== "loaded") throw new Error(`serif face not loaded: ${st.face}`);
    return `preview=${st.ff.slice(0, 40)} face=${st.face}`;
  } finally {
    cdp.close();
  }
}

async function scPreviewLive() {
  const cdp = await relaunch();
  try {
    await openSample(cdp);
    await showChrome(cdp);
    await cdp.clickAria("排版设置");
    await sleep(1600);
    const before = await cdp.ev(`getComputedStyle(document.querySelector('.reader-aa-preview__page')).fontSize`);
    // 字号 slider is a plain <input type="range" aria-label="字号">; drive it
    // through the native value setter so React's value tracker picks it up.
    const clicked = await cdp.ev(`(() => {
      const input = document.querySelector('input[aria-label="字号"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const next = Math.min(Number(input.max), Number(input.value) + 2);
      setter.call(input, String(next));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return next;
    })()`);
    if (!clicked) throw new Error("font-size slider not found");
    const after = await until(
      async () => {
        const v = await cdp.ev(`getComputedStyle(document.querySelector('.reader-aa-preview__page')).fontSize`);
        return v !== before ? v : null;
      },
      { label: "preview font-size change", timeout: 3000 },
    );
    return `fontSize ${before} → ${after}`;
  } finally {
    cdp.close();
  }
}

async function scScrub() {
  const cdp = await relaunch();
  try {
    await openSample(cdp);
    await showChrome(cdp);
    const r = await cdp.ev(`document.querySelector('.reader__scrub-track').getBoundingClientRect().toJSON()`);
    // Synthetic pointer events (uncaptured on purpose → exercises the fallback).
    await cdp.ev(`(() => {
      const track = document.querySelector('.reader__scrub-track');
      const r = track.getBoundingClientRect();
      const x = r.left + r.width * 0.5, y = r.top + r.height / 2;
      const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 99, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
      track.dispatchEvent(new PointerEvent('pointerdown', o));
      window.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
      return true;
    })()`);
    await sleep(2500);
    const st = await cdp.ev(`(() => {
      const pct = document.querySelector('.reader__scrub-pages')?.textContent ?? '';
      const cap = document.querySelector('.reader__scrub-caption')?.textContent ?? '';
      return { pct, cap };
    })()`);
    const val = parseFloat(st.pct);
    if (!(val >= 40 && val <= 60)) throw new Error(`scrub landed at ${st.pct}, expected 40–60%`);
    return `landed ${st.pct} (${st.cap})`;
  } finally {
    cdp.close();
  }
}

async function scTocNav() {
  const cdp = await relaunch();
  try {
    await openSample(cdp);
    await showChrome(cdp);
    await cdp.clickAria("目录");
    await sleep(1400);
    const items = await cdp.ev(`[...document.querySelectorAll('.reader-toc-item')].map(i => i.textContent.trim())`);
    if (items.length < 2) throw new Error(`toc too short: ${JSON.stringify(items)}`);
    await cdp.ev(`(() => { [...document.querySelectorAll('.reader-toc-item')][1].click(); return true })()`);
    await sleep(2500);
    const st = await cdp.ev(`(() => ({
      cap: document.querySelector('.reader__scrub-caption')?.textContent ?? '',
      pct: document.querySelector('.reader__scrub-pages')?.textContent ?? '',
      tocOpen: !!document.querySelector('.reader-toc-item'),
    }))()`);
    if (!st.cap.includes("第二章")) throw new Error(`caption not ch2: ${st.cap}`);
    if (st.tocOpen) throw new Error("toc sheet did not close");
    return `caption=${st.cap} pct=${st.pct}`;
  } finally {
    cdp.close();
  }
}

async function scPageTurnAnimation() {
  const cdp = await relaunch();
  try {
    await openSample(cdp);
    const animated = await cdp.ev(`(() => {
      const v = document.querySelector('foliate-view');
      const r = v?.renderer;
      return r?.hasAttribute?.('animated') ?? null;
    })()`);
    if (animated !== true) throw new Error(`paginator animated attr = ${animated}`);
    // Measure a turn: tap right side, time to relocate.
    await cdp.ev(`(() => {
      window.__turnMark = null;
      const v = document.querySelector('foliate-view');
      v.addEventListener('relocate', () => { if (window.__turnMark == null) window.__turnMark = performance.now(); }, { once: true });
      return true;
    })()`);
    const t0 = Date.now();
    tap(1780, 540);
    await until(async () => cdp.ev(`window.__turnMark != null`), { label: "relocate after turn", timeout: 5000 });
    const done = await cdp.ev(`(() => {
      const bar = document.querySelector('.reader__scrub-pages')?.textContent ?? '';
      return bar;
    })()`);
    const ms = Date.now() - t0;
    if (ms > 1500) throw new Error(`turn took ${ms}ms (>1500)`);
    return `animated=true turn=${ms}ms pct=${done}`;
  } finally {
    cdp.close();
  }
}

async function scSheetActuallyVisible() {
  const cdp = await relaunch();
  try {
    await openSample(cdp);
    await showChrome(cdp);
    await cdp.clickAria("目录");
    await sleep(1600);
    const st = await cdp.ev(`(() => {
      const sheet = document.querySelector('[data-slot="sheet-content"]') ?? document.querySelector('.reader-toc-sheet');
      if (!sheet) return null;
      const cs = getComputedStyle(sheet);
      const r = sheet.getBoundingClientRect();
      return {
        position: cs.position,
        zIndex: cs.zIndex,
        inViewport: r.left >= -4 && r.top >= -4 && r.left < innerWidth && r.top < innerHeight,
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        items: document.querySelectorAll('.reader-toc-item').length,
      };
    })()`);
    if (!st) throw new Error("toc sheet not in DOM");
    if (st.position !== "fixed") {
      throw new Error(`sheet position=${st.position} (Tailwind utilities dead — @layer regression) rect=${st.rect}`);
    }
    if (!st.inViewport) throw new Error(`sheet off-viewport rect=${st.rect}`);
    return `position=fixed rect=[${st.rect}] items=${st.items}`;
  } finally {
    cdp.close();
  }
}

async function scResizeObserverSilence() {
  const cdp = await relaunch();
  try {
    await openSample(cdp);
    adb("logcat", "-c");
    // Toggle chrome a few times (host resizes) + settle 10s.
    for (let i = 0; i < 3; i++) {
      tap(960, 540);
      await sleep(1200);
    }
    await sleep(8000);
    const n = logcatCount("Tauri/Console");
    if (n > 0) throw new Error(`${n} ResizeObserver loop errors in logcat`);
    return `0 ResizeObserver loop errors after toggles + 8s settle`;
  } finally {
    cdp.close();
  }
}

/** Tap the first node in the current native UI whose text/desc matches `re`. */
function nativeTapMatches(re, opts = {}) {
  adb("shell", "uiautomator", "dump", "/sdcard/ui-accept.xml");
  adb("pull", "/sdcard/ui-accept.xml", "target/tmp/ui-accept.xml");
  const xml = readFileSync("target/tmp/ui-accept.xml", "utf8");
  const nodes = xml.match(/<node[^>]*bounds="\[\d+,\d+\]\[\d+,\d+\]"[^>]*\/?>/g) ?? [];
  for (const node of nodes) {
    const text = node.match(/text="([^"]*)"/)?.[1] ?? node.match(/content-desc="([^"]*)"/)?.[1] ?? "";
    const b = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!b || !re.test(text)) continue;
    const cy = (Number(b[2]) + Number(b[4])) / 2;
    if (opts.minY != null && cy < opts.minY) continue; // skip toolbar-title lookalikes
    const cx = (Number(b[1]) + Number(b[3])) / 2;
    tap(cx, cy);
    return text;
  }
  return null;
}

async function importBigBook(cdp) {
  // Push fixture and import via SAF picker (native UI → uiautomator taps).
  adb("push", "target/tmp/stress-50ch.epub", "/sdcard/Download/stress-50ch.epub");
  adb("shell", "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE", "-d", "file:///sdcard/Download/stress-50ch.epub");
  await cdp.clickText("导入图书", { contains: true });
  await sleep(3500);
  // Fast path: file already visible (picker remembered 下载, or 最近 lists it).
  let hit = nativeTapMatches(/stress-50ch/);
  if (!hit) {
    // Drawer route: hamburger → 下载 root (drawer item sits below the toolbar
    // title of the same name — minY skips the title lookalike).
    tap(62, 96);
    await sleep(1500);
    nativeTapMatches(/^下载$/, { minY: 150 });
    await sleep(2200);
    hit = nativeTapMatches(/stress-50ch/);
  }
  if (!hit) throw new Error("stress-50ch not visible in picker");
  await sleep(7000);
}

async function scStressTurns() {
  const cdp = await relaunch();
  try {
    // Idempotent setup: open from the shelf card when a previous run already
    // imported the fixture (re-import would dedup and never open the reader).
    const hasCard = await until(
      async () => (await cdp.ev(`document.body.innerText.includes('枕籍压力测试书')`)) || null,
      { label: "big book card on shelf", timeout: 8000 },
    ).catch(() => null);
    if (!hasCard) {
      await importBigBook(cdp);
    } else {
      await cdp.ev(`(() => { const c = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.includes('枕籍压力测试书')); c?.click(); return true })()`);
    }
    // The import opens the book directly; ensure reader is up.
    await until(async () => cdp.ev(`!!document.querySelector('foliate-view')`), { label: "big book open", timeout: 20000 });
    await sleep(3000);
    const lat = [];
    let lastFrac = await cdp.ev(`parseFloat(document.querySelector('.reader__scrub-pages')?.textContent ?? '0')`);
    for (let i = 0; i < 100; i++) {
      await cdp.ev(`(() => {
        window.__rm = null;
        const v = document.querySelector('foliate-view');
        v.addEventListener('relocate', () => { if (window.__rm == null) window.__rm = performance.now(); }, { once: true });
        return true;
      })()`);
      const t0 = Date.now();
      tap(1780, 540);
      try {
        await until(async () => cdp.ev(`window.__rm != null`), { label: "relocate", timeout: 4000 });
      } catch {
        /* tolerate an occasional missed relocate at book end */
      }
      lat.push(Date.now() - t0);
      await sleep(300);
      if (i % 25 === 24) {
        const err = await cdp.ev(`document.body.innerText.includes('文件已损坏')`);
        if (err) throw new Error(`error card after ${i + 1} turns`);
      }
    }
    lat.sort((a, b) => a - b);
    const p50 = lat[Math.floor(lat.length * 0.5)];
    const p95 = lat[Math.floor(lat.length * 0.95)];
    if (p95 > 800) throw new Error(`turn P95=${p95}ms (>800), P50=${p50}ms`);
    return `100 turns P50=${p50}ms P95=${p95}ms`;
  } finally {
    cdp.close();
  }
}

async function scStressOpenClose() {
  const cdp = await relaunch();
  try {
    const heap0 = await cdp.ev(`performance.memory ? performance.memory.usedJSHeapSize : 0`);
    for (let i = 0; i < 20; i++) {
      await openSample(cdp);
      await cdp.clickAria("返回书库");
      await sleep(1200);
    }
    // Force GC signal isn't available; heap read is indicative.
    const heap1 = await cdp.ev(`performance.memory ? performance.memory.usedJSHeapSize : 0`);
    if (!heap0 || !heap1) return `performance.memory unavailable (heap0=${heap0})`;
    const growth = heap1 / heap0;
    if (growth > 1.5) throw new Error(`heap grew ${(growth * 100 - 100).toFixed(0)}% (>50%): ${(heap0 / 2 ** 20).toFixed(1)}→${(heap1 / 2 ** 20).toFixed(1)}MB`);
    return `heap ${(heap0 / 2 ** 20).toFixed(1)}MB → ${(heap1 / 2 ** 20).toFixed(1)}MB (+${(growth * 100 - 100).toFixed(0)}%)`;
  } finally {
    cdp.close();
  }
}

async function scStressToc50() {
  const cdp = await relaunch();
  try {
    // Big book should already be in the library from scStressTurns; wait for
    // the shelf to render before deciding it's missing (async DB read).
    const hasCard = await until(
      async () => (await cdp.ev(`document.body.innerText.includes('枕籍压力测试书')`)) || null,
      { label: "big book card on shelf", timeout: 8000 },
    ).catch(() => null);
    if (!hasCard) {
      await importBigBook(cdp);
    } else {
      await cdp.ev(`(() => { const c = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.includes('枕籍压力测试书')); c?.click(); return true })()`);
    }
    await until(async () => cdp.ev(`!!document.querySelector('foliate-view')`), { label: "big book open", timeout: 20000 });
    await sleep(2500);
    await showChrome(cdp);
    await cdp.clickAria("目录");
    await sleep(1800);
    const count = await cdp.ev(`document.querySelectorAll('.reader-toc-item').length`);
    if (count < 50) throw new Error(`toc count=${count} (<50)`);
    const picks = [1, 5, 9, 13, 21, 27, 33, 40, 46, 50];
    for (const ch of picks) {
      await cdp.clickAria("目录");
      await sleep(900);
      await cdp.ev(`(() => {
        const items = [...document.querySelectorAll('.reader-toc-item')];
        const t = items.find(i => i.textContent.includes('第${ch}章'));
        if (!t) throw new Error('toc item missing: 第${ch}章');
        t.click();
        return true;
      })()`);
      await sleep(1600);
      const cap = await cdp.ev(`document.querySelector('.reader__scrub-caption')?.textContent ?? ''`);
      if (!cap.includes(`第${ch}章`)) throw new Error(`nav to 第${ch}章 landed on ${cap}`);
    }
    return `10/10 chapter jumps landed (${picks.join(",")})`;
  } finally {
    cdp.close();
  }
}

// ------------------------------------------------------------------- runner

const all = [
  ["F1 字体: 思源宋体可加载无解码错误", scSerifLoads],
  ["F2 预览: 宋体预览生效", scSerifPreview],
  ["F3 预览: 字号调整实时反映", scPreviewLive],
  ["F4 进度条: 拖拽落点在容差内", scScrub],
  ["F5 目录: 点击第二章跳转", scTocNav],
  ["F6 翻页: animated 生效且翻页不卡顿", scPageTurnAnimation],
  ["F7 性能: ResizeObserver 静默", scResizeObserverSilence],
  ["F8 Sheet: 目录真实渲染在视口内（@layer 守卫）", scSheetActuallyVisible],
  ["S1 压力: 100 次连续翻页", scStressTurns],
  ["S2 压力: 20 次开关书内存", scStressOpenClose],
  ["S3 压力: 50 章目录随机跳 10 次", scStressToc50],
];

console.log(`acceptance runner — device emulator-5554, ${all.length} scenarios${ONLY ? ` (only: ${ONLY})` : ""}`);
for (const [name, fn] of all) await scenario(name, fn);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
if (!KEEP_OPEN) adb("shell", "am", "force-stop", "com.pillowtome.app");
process.exit(failed.length ? 1 : 0);
