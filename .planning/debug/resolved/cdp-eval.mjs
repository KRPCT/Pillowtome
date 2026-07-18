// Sync CDP Runtime.evaluate against the forwarded WebView (no awaitPromise — hangs).
// Usage: node .planning/debug/cdp-eval.mjs "<expression>"
const expr = process.argv[2];
if (!expr) {
  console.error("usage: node cdp-eval.mjs <expression>");
  process.exit(2);
}
const ws = new WebSocket("ws://127.0.0.1:9222/devtools/page/03D23A6AFBAD6CF6D9798AF61C0436D7");
const timer = setTimeout(() => {
  console.error("TIMEOUT");
  process.exit(3);
}, 10000);
ws.onopen = () => {
  ws.send(JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: { expression: expr, returnByValue: true },
  }));
};
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id !== 1) return;
  clearTimeout(timer);
  if (msg.result?.exceptionDetails) {
    console.log("EXCEPTION:", JSON.stringify(msg.result.exceptionDetails, null, 2).slice(0, 2000));
  } else {
    console.log(JSON.stringify(msg.result?.result?.value, null, 2));
  }
  ws.close();
  process.exit(0);
};
ws.onerror = (e) => {
  clearTimeout(timer);
  console.error("WS ERROR", e.message ?? e);
  process.exit(4);
};
