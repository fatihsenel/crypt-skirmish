// Stills of the 3D emblem (render/titleLogo.js) and the README shots that show it, rendered in
// headless Chrome from the production build. Run it after changing the emblem:
//   npm run stills                    (builds first; all of them)
//   npm run stills -- icons og        (only some: icons, og, boot, title, victory)
// It serves dist/ with `vite preview` on port 4173 (stop any other server there first) and
// writes public/icon-512.png, icon-192.png, apple-touch-icon.png, og-image.jpg, boot-logo.jpg
// and docs/screenshots/title.jpg and victory.jpg. Chrome uses the GPU: the software renderer
// draws the bone peach. The emblem is in its reduced-motion pose. Env: CHROME (the Chrome binary;
// the macOS default).

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ALL = ['icons', 'og', 'boot', 'title', 'victory'];
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const unknown = wanted.filter((w) => !ALL.includes(w));
if (unknown.length) {
  console.error(`Unknown: ${unknown.join(', ')}. Pick from ${ALL.join(', ')}.`);
  process.exit(1);
}
const URL_BASE = 'http://localhost:4173/crypt-skirmish/';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- the server and the browser -------------------------------------------------------------
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
const profile = mkdtempSync(join(tmpdir(), 'crypt-stills-'));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let ws;
async function finish(code) {
  ws?.close();
  chrome.kill();
  server.kill();
  await sleep(800);
  rmSync(profile, { recursive: true, force: true });
  process.exit(code);
}

let targets;
for (let i = 0; i < 120 && !targets; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(250); }
}
let served = false;
for (let i = 0; i < 60 && !served; i++) {
  try { served = (await fetch(URL_BASE)).ok; } catch { await sleep(500); }
}
if (!targets || !served) {
  console.error(!targets ? `Chrome didn't start (${CHROME})` : 'vite preview didn\'t start on 4173 (is something else using the port?)');
  await finish(1);
}
ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const waiting = new Map();
const pageErrors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'page error');
  return r.result?.result?.value;
};
async function until(expr, what, ms = 90000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(600)) {
    if (await ev(expr).catch(() => false)) return;
  }
  throw new Error(`timed out waiting for ${what}`);
}
const size = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
/** A PNG of the top-left `w`×`h` of the page, as base64. */
const shot = async (w, h) => (await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } })).result.data;

/**
 * Turns the PNG `b64` into files in the page itself (no image tools needed): each output is
 * { file, w, h, type: 'png' | 'jpeg', quality, pad: { size, inset, feather, bg } }. `pad` draws
 * the picture at `inset` inside a `size` square of `bg`, its edges feathered by `feather` px.
 */
async function encode(b64, outs) {
  const res = await ev(`(async () => {
    const img = new Image();
    img.src = 'data:image/png;base64,${b64}';
    await img.decode();
    const outs = ${JSON.stringify(outs)};
    const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
    let src = img;
    const pad = outs.find((o) => o.pad)?.pad;
    if (pad) {
      const inner = pad.size - pad.inset * 2;
      const mask = canvas(inner, inner), m = mask.getContext('2d');
      m.filter = 'blur(' + pad.feather / 2 + 'px)';
      m.fillRect(pad.feather * 0.7, pad.feather * 0.7, inner - pad.feather * 1.4, inner - pad.feather * 1.4);
      m.filter = 'none';
      m.globalCompositeOperation = 'source-in';
      m.imageSmoothingQuality = 'high';
      m.drawImage(img, 0, 0, inner, inner);
      src = canvas(pad.size, pad.size);
      const s = src.getContext('2d');
      s.fillStyle = pad.bg;
      s.fillRect(0, 0, pad.size, pad.size);
      s.drawImage(mask, pad.inset, pad.inset);
    }
    return outs.map((o) => {
      const c = canvas(o.w, o.h), g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, o.w, o.h);
      return c.toDataURL('image/' + o.type, o.quality).split(',')[1];
    });
  })()`);
  outs.forEach((o, i) => {
    writeFileSync(o.file, Buffer.from(res[i], 'base64'));
    console.log('wrote', o.file);
  });
}

/** Opens `url` and waits for the 3D emblem (`cls`) to replace the flat one. */
async function openWithLogo(url, cls) {
  await send('Emulation.clearDeviceMetricsOverride');
  await send('Page.navigate', { url });
  await until(`!!document.querySelector('canvas.${cls}')`, `the 3D emblem at ${url}`);
}

/**
 * The page laid out as one picture: a background, the emblem's canvas at `logo`, and `html`
 * on top; everything else hidden.
 */
async function compose({ w, h, bg, logo, html = '', css = '' }) {
  await size(w, h);
  await ev(`(() => {
    let s = document.getElementById('stills-style');
    if (!s) { s = document.createElement('style'); s.id = 'stills-style'; document.head.append(s); }
    let d = document.getElementById('stills');
    if (!d) { d = document.createElement('div'); d.id = 'stills'; document.body.append(d); }
    d.innerHTML = ${JSON.stringify(html)};
    s.textContent = ${JSON.stringify(`html, body { background: transparent !important; }
      body * { visibility: hidden !important; }
      body::before { content: ''; position: fixed; left: 0; top: 0; width: ${w}px; height: ${h}px; background: ${bg}; z-index: 0; }
      canvas.title-logo { visibility: visible !important; position: fixed !important; z-index: 1;
        left: ${logo.x}px; top: ${logo.y}px; width: ${logo.w}px !important; height: ${logo.h}px !important;
        max-width: none !important; margin: 0 !important; animation: none !important; }
      #stills, #stills * { visibility: visible !important; }
      #stills { position: fixed; left: 0; top: 0; width: ${w}px; height: ${h}px; z-index: 2; pointer-events: none; }
      ${css}`)};
    document.querySelector('#title').style.cssText = 'background:none; overflow:visible; z-index:5';
    return document.fonts.ready.then(() => 1);
  })()`);
  await sleep(2500); // the new size drawn
  return shot(w, h);
}

const OG_HTML = `<div class="og">
  <div class="name">Crypt</div>
  <div class="rule"><i></i><b></b><i></i></div>
  <div class="name">Skirmish</div>
  <p>Four heroes, one crypt, and something older than the necromancer at the bottom of it.</p>
  <small>Turn-based dungeon tactics · Play in your browser</small>
</div>`;
const OG_CSS = `.og { position: absolute; left: 560px; top: 0; width: 600px; height: 630px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; }
  .og .name { font: 700 118px/1 Cinzel, serif; letter-spacing: .02em; text-transform: uppercase; color: #e6c56e;
    background: linear-gradient(#f3dc94, #d9b45a 55%, #a8823a); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
    filter: drop-shadow(0 3px 0 #3f2f11) drop-shadow(0 8px 14px rgba(0,0,0,.7)); }
  .og .rule { display: flex; align-items: center; gap: 12px; width: 520px; margin: 18px 0; }
  .og .rule i { flex: 1; height: 2px; background: #d9b45a; }
  .og .rule b { width: 14px; height: 14px; background: #d9b45a; transform: rotate(45deg); }
  .og p { font: 500 25px/1.35 Inter, sans-serif; color: #ece4d4; margin: 26px 0 0; max-width: 540px; }
  .og small { font: 600 15px Inter, sans-serif; letter-spacing: .12em; white-space: nowrap; text-transform: uppercase; color: #d9b45a; margin-top: 30px; }`;

try {
  await send('Runtime.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  if (wanted.some((w) => ['icons', 'og', 'boot'].includes(w))) {
    await openWithLogo(URL_BASE, 'title-logo');
    if (wanted.includes('icons')) { // the doorway inside the maskable icon's safe zone
      const png = await compose({ w: 1024, h: 1024, bg: '#0d0b10', logo: { x: 0, y: 0, w: 1024, h: 1024 } });
      const pad = { size: 1024, inset: 82, feather: 60, bg: '#0d0b10' };
      await encode(png, [[512, 'icon-512'], [192, 'icon-192'], [180, 'apple-touch-icon']]
        .map(([n, name]) => ({ file: `public/${name}.png`, w: n, h: n, type: 'png', pad })));
    }
    if (wanted.includes('og')) { // the link preview: the doorway on the left, the name on the right
      const png = await compose({ w: 1200, h: 630, bg: 'radial-gradient(ellipse at 30% 45%, #2a2333, #120f16 70%)',
        logo: { x: -150, y: -20, w: 920, h: 670 }, html: OG_HTML, css: OG_CSS });
      await encode(png, [{ file: 'public/og-image.jpg', w: 1200, h: 630, type: 'jpeg', quality: 0.9 }]);
    }
    if (wanted.includes('boot')) { // on the boot screen's centre colour; index.html feathers its edges
      const png = await compose({ w: 460, h: 400, bg: '#17131c', logo: { x: 0, y: 0, w: 460, h: 400 } });
      await encode(png, [{ file: 'public/boot-logo.jpg', w: 340, h: 296, type: 'jpeg', quality: 0.85 }]);
    }
  }

  if (wanted.includes('title')) { // with today's daily and this week's crypt won, as a returning player sees it
    for (const button of ['title-daily-play', 'title-weekly-play']) {
      await openWithLogo(URL_BASE, 'title-logo');
      await ev(`document.getElementById('${button}').click(), 1`);
      await until(`!!window.__debug?.game() && document.getElementById('title').hidden`, `the ${button} room`);
      await sleep(3000);
      await ev('window.__debug.win(), 1');
      await until(`!document.getElementById('banner').hidden`, 'the end banner');
      await sleep(1500); // the records saved
    }
    await openWithLogo(URL_BASE, 'title-logo');
    await size(1200, 918);
    await sleep(5000);
    await encode(await shot(1200, 918), [{ file: 'docs/screenshots/title.jpg', w: 800, h: 612, type: 'jpeg', quality: 0.88 }]);
  }

  if (wanted.includes('victory')) { // a won New Game+ 2 run (the ?victory sample)
    await openWithLogo(`${URL_BASE}?victory&tier=2`, 'banner-logo');
    await size(1600, 900);
    await sleep(5000);
    await encode(await shot(1600, 900), [{ file: 'docs/screenshots/victory.jpg', w: 800, h: 450, type: 'jpeg', quality: 0.88 }]);
  }
  if (pageErrors.length) console.log('Page errors:\n' + pageErrors.join('\n'));
  await finish(0);
} catch (err) {
  console.error(err.message);
  if (pageErrors.length) console.error('Page errors:\n' + pageErrors.join('\n'));
  await finish(1);
}
