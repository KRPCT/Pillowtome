/**
 * 响应式 UI 审计：vite dev + harness.html + Playwright 截图与重叠检测。
 * 用法: node scripts/ui-audit.mjs [--shots-only]
 * 产物: audit/*.png + 控制台重叠/横向滚动报告。
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const PORT = 5199;
const BASE = `http://localhost:${PORT}/harness.html`;
const OUT = new URL("../audit/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800 },
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "800x600", width: 800, height: 600 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1440x900", width: 1440, height: 900 },
];

/** 页面内：横向溢出 + 指定选择器可见元素两两重叠检测。 */
function auditInPage(selector) {
  const out = { hOverflow: null, overlaps: [] };
  const de = document.documentElement;
  if (de.scrollWidth > window.innerWidth + 1) {
    out.hOverflow = { scrollWidth: de.scrollWidth, innerWidth: window.innerWidth };
  }
  const els = [...document.querySelectorAll(selector)].filter((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
  });
  const rects = els.map((el) => ({
    el,
    r: el.getBoundingClientRect(),
    tag: String(el.className?.toString() || el.tagName).slice(0, 40),
  }));
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      // 父子包含不是重叠
      if (rects[i].el.contains(rects[j].el) || rects[j].el.contains(rects[i].el)) continue;
      const a = rects[i].r, b = rects[j].r;
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 1 && oy > 1) {
        out.overlaps.push({ a: rects[i].tag, b: rects[j].tag, ox: Math.round(ox), oy: Math.round(oy) });
      }
    }
  }
  return out;
}

function startVite() {
  // 直接用 node 跑 vite CLI（不经过 npx/cmd 壳），保证 kill() 能真正结束进程。
  const child = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--port", String(PORT), "--strictPort"],
    { stdio: "pipe", cwd: process.cwd() },
  );
  child.stdout.on("data", (d) => process.stdout.write(d));
  child.stderr.on("data", (d) => process.stderr.write(d));
  return child;
}

async function waitServer(url, timeoutMs = 45000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 3000);
      const res = await fetch(url, { signal: ac.signal });
      clearTimeout(timer);
      if (res.ok) return;
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error("vite dev server timeout");
    await new Promise((r) => setTimeout(r, 400));
  }
}

const problems = [];

async function auditState(page, label, selector, shotName) {
  await page.waitForTimeout(350);
  const res = await page.evaluate(auditInPage, selector);
  if (res.hOverflow) {
    problems.push(`${label}: 横向溢出 scrollWidth=${res.hOverflow.scrollWidth} > ${res.hOverflow.innerWidth}`);
  }
  for (const o of res.overlaps) {
    problems.push(`${label}: 重叠 [${o.a}] × [${o.b}] ${o.ox}x${o.oy}px`);
  }
  await page.screenshot({ path: `${OUT}${shotName}.png` });
  console.log(`shot ${shotName}`);
}

async function closeSheets(page) {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
}

async function auditLibrary(page, vp) {
  const L = `[lib ${vp.name}]`;
  await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector(".app-topbar", { timeout: 10000 });
  await auditState(
    page, L,
    ".app-topbar .app-wordmark, .app-topbar button, .app-topbar .lib-search",
    `lib-topbar-${vp.name}`,
  );

  // 搜索展开
  const toggle = page.locator(".app-topbar__search-toggle");
  if (await toggle.isVisible()) {
    await toggle.click();
    await auditState(page, `${L} search-open`, ".app-topbar button, .app-topbar .lib-search", `lib-search-${vp.name}`);
    await toggle.click();
  }

  // 「⋯」溢出菜单（≤1000px）
  const overflow = page.locator(".app-topbar__overflow");
  if (await overflow.isVisible()) {
    await overflow.click();
    await auditState(page, `${L} overflow`, ".app-overflow-menu__item", `lib-overflow-${vp.name}`);
    // 从菜单打开设置
    await page.getByRole("button", { name: "设置", exact: true }).last().click();
    await auditState(page, `${L} settings-sheet`, ".reader-settings-sheet button", `lib-settings-${vp.name}`);
    await closeSheets(page);
  } else {
    // 宽屏：直接开设置
    await page.locator(".app-topbar__settings").click();
    await auditState(page, `${L} settings-sheet`, ".reader-settings-sheet button", `lib-settings-${vp.name}`);
    await closeSheets(page);
  }

  // 移动 tab bar（≤640px）
  const tabbar = page.locator(".tabbar");
  if (await tabbar.isVisible()) {
    const tabs = await tabbar.locator("button").allTextContents();
    console.log(`${L} tabbar tabs: ${tabs.map((t) => t.trim()).join("/")}`);
    if (tabs.some((t) => t.includes("批注"))) problems.push(`${L}: tab bar 仍含「批注」`);
    await auditState(page, `${L} tabbar`, ".tabbar button", `lib-tabbar-${vp.name}`);
  }

  // 书架网格
  await auditState(page, `${L} grid`, ".shelf .book", `lib-grid-${vp.name}`);
}

async function auditReader(page, vp) {
  const L = `[reader ${vp.name}]`;
  await page.goto(`${BASE}?mode=reader`, { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector(".reader__toolbar", { timeout: 10000 });

  // chrome 顶/底栏 + 划词气泡（默认右缘）
  await auditState(
    page, L,
    ".reader__toolbar button, .reader__chrome-title",
    `reader-chrome-${vp.name}`,
  );
  const bubble = await page.evaluate(() => {
    const el = document.querySelector(".reader-anno-bubble");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, iw: window.innerWidth };
  });
  if (bubble && (bubble.left < -1 || bubble.right > bubble.iw + 1)) {
    problems.push(`${L}: 划词气泡越界 left=${Math.round(bubble.left)} right=${Math.round(bubble.right)} vw=${bubble.iw}`);
  }

  // Aa 面板
  await page.getByRole("button", { name: "排版设置" }).click();
  await auditState(page, `${L} aa-sheet`, ".reader-settings-sheet .reader-aa-switch-row, .reader-settings-sheet .reader-seg", `reader-aa-${vp.name}`);
  // 字体键检查：应含 思源宋体/思源黑体/系统默认
  const fontLabels = await page.locator(".reader-font-list__item").allTextContents();
  console.log(`${L} font keys: ${fontLabels.map((t) => t.trim()).join("/")}`);
  for (const want of ["思源宋体", "思源黑体", "系统默认"]) {
    if (!fontLabels.some((t) => t.includes(want))) problems.push(`${L}: Aa 字体缺「${want}」`);
  }
  await closeSheets(page);

  // 目录
  await page.getByRole("button", { name: "目录", exact: true }).click();
  await auditState(page, `${L} toc`, ".reader-toc-item", `reader-toc-${vp.name}`);
  await closeSheets(page);

  // 搜索
  await page.getByRole("button", { name: "搜索", exact: true }).first().click();
  await auditState(page, `${L} search`, ".reader-search-sheet input", `reader-search-${vp.name}`);
  await closeSheets(page);

  // 批注面板
  await page.getByRole("button", { name: "批注", exact: true }).click();
  await auditState(page, `${L} anno`, ".reader-anno-tab, .reader-anno-item", `reader-anno-${vp.name}`);
  await closeSheets(page);
}

const vite = startVite();
try {
  await waitServer(BASE);
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  // 预热 vite 依赖转换（冷启动首次加载慢，避免首个视口 goto 超时）。
  {
    const warm = await browser.newPage();
    try {
      await warm.goto(BASE, { waitUntil: "load", timeout: 90000 });
      await warm.goto(`${BASE}?mode=reader`, { waitUntil: "load", timeout: 90000 });
      await warm.waitForSelector(".reader__toolbar", { timeout: 30000 });
    } catch (err) {
      console.warn("warmup failed:", String(err).slice(0, 200));
    }
    await warm.close();
  }
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    page.on("pageerror", (e) => console.warn(`[pageerror ${vp.name}]`, String(e).slice(0, 200)));
    try {
      await auditLibrary(page, vp);
      await auditReader(page, vp);
    } catch (err) {
      problems.push(`[${vp.name}] 审计异常: ${String(err).slice(0, 300)}`);
    }
    await page.close();
  }
  await browser.close();
} finally {
  vite.kill();
}

console.log("\n==== AUDIT RESULT ====");
if (problems.length === 0) {
  console.log("无重叠 / 无横向溢出 / 结构检查通过");
} else {
  for (const p of problems) console.log("PROBLEM:", p);
  process.exitCode = 1;
}
