// Probe what the pillow:// protocol serves for each bundled font face.
import { Cdp } from "./cdp-lib.mjs";
const cdp = await Cdp.connect();
const r = await cdp.ev(`(async () => {
  const style = document.getElementById('pillow-bundled-fonts');
  const cssText = style ? style.textContent : '';
  const urls = [...cssText.matchAll(/url\\("([^"]+)"\\)/g)].map(m => m[1]);
  const faces = [...document.fonts].map(f => f.family + ':' + f.status);
  const out = { faces, urls, probes: [] };
  for (const u of urls) {
    try {
      // Plain GET (no author headers — a Range header triggers a CORS
      // preflight on Chrome 91 that the pillow handler doesn't answer).
      const resp = await fetch(u);
      const buf = await resp.arrayBuffer();
      const magic = [...new Uint8Array(buf.slice(0, 4))].map(b => String.fromCharCode(b)).join('');
      out.probes.push({ url: u.slice(0, 64), status: resp.status, magic, type: resp.headers.get('content-type'), bytes: buf.byteLength });
    } catch (e) {
      out.probes.push({ url: u.slice(0, 64), error: String(e).slice(0, 100) });
    }
  }
  return out;
})()`);
console.log(JSON.stringify(r, null, 1));
cdp.close();
