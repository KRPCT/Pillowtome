// CDP-over-adb harness for device-level acceptance scenarios (BDD runner lib).
// Connects to the app's WebView on emulator-5554 via forwarded devtools socket.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ADB_CANDIDATES = [
  process.env.ADB,
  process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, "platform-tools", "adb.exe"),
  "C:/Users/Administrator/AppData/Local/Android/Sdk/platform-tools/adb.exe",
  "adb",
].filter(Boolean);
const ADB = ADB_CANDIDATES.find((p) => p === "adb" || existsSync(p)) ?? "adb";
const DEVICE = process.env.DEVICE ?? "emulator-5554";

export function adb(...args) {
  return execFileSync(ADB, ["-s", DEVICE, ...args], {
    encoding: "utf8",
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

export function tap(x, y) {
  adb("shell", "input", "tap", String(Math.round(x)), String(Math.round(y)));
}

export function swipe(x1, y1, x2, y2, ms = 300) {
  adb("shell", "input", "swipe", String(Math.round(x1)), String(Math.round(y1)), String(Math.round(x2)), String(Math.round(y2)), String(ms));
}

export function screenshot(path) {
  execFileSync(ADB, ["-s", DEVICE, "exec-out", "screencap", "-p"], {
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", require("node:fs").openSync(path, "w"), "inherit"],
  });
}

export function logcatCount(tag, sinceExpr = null) {
  const args = ["logcat", "-d", "-s", tag];
  const out = adb(...args);
  return out.split("\n").filter((l) => l.includes("ResizeObserver loop limit exceeded")).length;
}

export class Cdp {
  static async connect() {
    // App's own devtools socket: @webview_devtools_remote_<pid-of-app>.
    const pid = adb("shell", "pidof", "com.pillowtome.app");
    const sockets = adb("shell", "cat", "/proc/net/unix");
    const m = sockets.match(/webview_devtools_remote_(\d+)/g);
    if (!m) throw new Error("no webview devtools socket (debug build running?)");
    const sock = m.find((s) => s.endsWith(`_${pid}`)) ?? m[0];
    adb("forward", "tcp:9222", `localabstract:${sock}`);
    const targets = await (await fetch("http://localhost:9222/json")).json();
    const page = targets.find((t) => t.type === "page" && t.url.includes("tauri"));
    if (!page) throw new Error(`no tauri page target: ${JSON.stringify(targets.map((t) => t.url))}`);
    const c = new Cdp();
    c.ws = new WebSocket(page.webSocketDebuggerUrl);
    c.idSeq = 0;
    c.pending = new Map();
    c.consoleLogs = [];
    c.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { resolve, reject } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method === "Runtime.consoleAPICalled") {
        c.consoleLogs.push(
          `[${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "),
        );
      } else if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        c.consoleLogs.push(`[exception] ${d.text} ${d.exception?.description ?? ""}`);
      }
    };
    await new Promise((r, j) => {
      c.ws.onopen = r;
      c.ws.onerror = j;
    });
    await c.send("Runtime.enable");
    return c;
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.idSeq;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluate JS in the page; throws on JS exception. */
  async ev(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    }
    return r.result?.value;
  }

  async clickText(text, opts = {}) {
    const pred = opts.contains
      ? `t.includes(${JSON.stringify(text)})`
      : opts.startsWith
        ? `t.startsWith(${JSON.stringify(text)})`
        : `t === ${JSON.stringify(text)}`;
    return this.ev(`(() => {
      const b = [...document.querySelectorAll('button, [role="menuitem"], a')].find(e => { const t = e.textContent.trim(); return ${pred}; });
      if (!b) return false;
      b.click();
      return true;
    })()`);
  }

  async clickAria(label) {
    return this.ev(`(() => {
      const b = document.querySelector('button[aria-label="${label}"]');
      if (!b) return false;
      b.click();
      return true;
    })()`);
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until `fn()` returns truthy, polling every `step` ms up to `timeout` ms. */
export async function until(fn, { timeout = 10000, step = 250, label = "condition" } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${label}`);
    await sleep(step);
  }
}
