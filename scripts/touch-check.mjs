// Touch check: on a phone the first tap on a tile previews the move and the second does it.
// Starts a headless Chrome with a throwaway profile, emulates a 375×812 touch phone, opens
// ?level=1 on the dev server and taps a reachable tile twice with real touch events.
//   npm run dev        (in another terminal, port 5173)
//   npm run touch-check
// Env: URL (default http://localhost:5173/; the deploy workflow checks the preview build at
// http://localhost:4173/crypt-skirmish/), CHROME (the Chrome binary; the macOS default), SLOW
// (a CPU slowdown factor, like 6, to try it the way a slow CI machine runs), SEED (the fight's
// dice, for the same fight every time), LATE (ms before each lift is sent, still stamped 60 ms
// after the touch: a page too busy to see it sooner), VERBOSE (print the events on a pass too).
// On CI (CI set) Chrome runs without its sandbox, which the Linux runners don't allow.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_BASE = process.env.URL ?? 'http://localhost:5173/';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9300 + Math.floor(Math.random() * 500); // a fresh port: an earlier run's Chrome may still be closing
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'crypt-touch-'));
const chrome = spawn(CHROME, [`--headless=new`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
  'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeLog = '';
chrome.stderr.on('data', (d) => { chromeLog = (chromeLog + d).slice(-4000); });
let exited = null;
chrome.on('exit', (code, signal) => { exited = signal ?? code; });
chrome.on('error', (err) => { exited = err.message; });
let ws;
const done = async (ok, text) => {
  console.log(text);
  ws?.close();
  chrome.kill();
  // Wait for Chrome to close (up to 5 s) before the next run starts one, then tidy up.
  for (let i = 0; i < 50 && exited === null; i++) await sleep(100);
  // Chrome's helpers can still be writing to the profile; a failed tidy-up never fails the check.
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* left in tmp */ }
  process.exit(ok ? 0 : 1);
};

let targets;
for (let i = 0; i < 120 && !targets && exited === null; i++) { // up to 30 s on a cold CI machine
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { await sleep(250); }
}
if (!targets) {
  done(false, `FAIL: Chrome didn't start (${CHROME}${exited !== null ? `, exited: ${exited}` : ''})\nChrome's output:\n${chromeLog}`);
  await new Promise(() => {}); // done() exits
}
ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const waiting = new Map();
const pageErrors = []; // shown with a failure
const inFlight = new Map(); // requests the page is still waiting on: requestId → url
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  if (m.method === 'Network.requestWillBeSent') inFlight.set(m.params.requestId, m.params.request.url.split('/').pop() + '@' + Math.round(m.params.timestamp * 1000));
  if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') inFlight.delete(m.params.requestId);
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') pageErrors.push(`${m.params.entry.source}: ${m.params.entry.text} ${m.params.entry.url ?? ''}`);
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') pageErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'page error');
  return r.result?.result?.value;
};
// A 60 ms tap. Both touches carry their own time, as a phone's do: Chrome answers the first
// only once a busy page has handled it, and stamping the lift after that wait would make a
// slow page see a long press.
// LATE=ms sends the lift that late (still stamped 60 ms in), as a page too busy to see it sooner would.
const tap = async ({ x, y }) => {
  const t = Date.now() / 1000;
  const down = send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }], timestamp: t });
  await sleep(Number(process.env.LATE) || 60);
  await Promise.all([down, send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t + 0.06 })]);
  await sleep(700);
};

try {
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Log.enable'); // what the browser itself reports, like a module script that failed to load
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  if (process.env.SLOW) await send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.SLOW) }); // to mimic CI
  await send('Page.navigate', { url: URL_BASE }); await sleep(2000);
  await ev(`localStorage.setItem('crypt-skirmish:tips', JSON.stringify({ on: false, seen: [] })); 1`);
  inFlight.clear(); // the title page's own requests go with it
  await send('Page.navigate', { url: `${URL_BASE}?level=1${process.env.SEED ? `&seed=${process.env.SEED}` : ''}` });
  // The room is up once the game exists (slow on a software-rendered CI machine).
  let up = false;
  for (let t0 = Date.now(); !up && Date.now() - t0 < 60000; await sleep(500)) {
    up = await ev('!!window.__debug?.game()').catch(() => false); // false while the page swaps
  }
  if (!up) {
    const where = await ev(`location.href + ' [' + document.readyState + ', main ' + (window.__debug ? 'ran' : 'not run') + ', up ' + Math.round(performance.now()) + ' ms]' + (document.getElementById('boot')?.classList.contains('done') ? ''
      : ' (boot screen still up: "' + document.getElementById('boot').textContent.replace(/\\s+/g, ' ').trim() + '", '
        + performance.getEntriesByType('resource').length + ' files loaded: '
        + performance.getEntriesByType('resource').map(r => r.name.split('/').pop() + (r.responseEnd ? '' : ' (pending)')).join(', ') + ')')`).catch(() => '?');
    // The main script, imported again: the same module, so its own error, or a hang if it's
    // still running; "finished" after "main not run" means the page's own tag never ran it.
    const main = await ev(`(async () => { const src = document.querySelector('script[type=module]')?.src;
      const r = await Promise.race([import(src).then(() => 'finished', (e) => 'failed: ' + (e?.stack ?? e)),
        new Promise((ok) => setTimeout(() => ok('still evaluating'), 3000))]);
      return r + (document.querySelector('canvas') ? ', canvas up' : ', no canvas'); })()`).catch((e) => 'import probe: ' + e.message);
    throw new Error(`the room never loaded at ${where}; the main script imported now: ${main}; still waiting on ${inFlight.size ? [...inFlight.values()].join(', ') : 'nothing'}`);
  }

  // A hero's turn ready for input (End turn enabled: not busy with the turn's opening), the
  // camera at rest on the hero, then a free tile two or more steps away, on screen, clear of the HUD
  // and not hidden behind a figure (a tap there picks the figure).
  const pick = await ev(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const g = __debug.game();
    const ready = () => g.current?.team === 'heroes' && !document.getElementById('end-turn').disabled;
    for (let t0 = Date.now(); !ready() && Date.now() - t0 < 90000;) await sleep(250);
    if (!ready()) return null;
    const u = g.current;
    // Until the camera stops easing: three still samples in a row, each after frames were
    // really drawn (a busy machine can go 400 ms without a frame, which looks still too).
    const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (let i = 0, still = 0, last = null; i < 60 && still < 3; i++) {
      await frames(); await sleep(250); await frames();
      const p = __debug.tileToScreen(u.x, u.z);
      still = last && Math.hypot(p.x - last.x, p.y - last.y) < 0.5 ? still + 1 : 0;
      last = p;
    }
    const steps = (t) => Math.abs(t.x - u.x) + Math.abs(t.z - u.z);
    const onScreen = (t) => { const p = __debug.tileToScreen(t.x, t.z); return p.x > 40 && p.x < innerWidth - 40 && p.y > 170 && p.y < innerHeight - 260; };
    const reached = (t) => { const p = __debug.tileToScreen(t.x, t.z); const h = __debug.pickAt(p.x, p.y); return h?.x === t.x && h?.z === t.z; }; // not behind a figure
    const t = g.destinations(u)
      .filter(t => steps(t) >= 2 && onScreen(t) && reached(t) && !g.units.some(o => o.alive && Math.abs(o.x - t.x) + Math.abs(o.z - t.z) < 2))
      .sort((a, b) => steps(a) - steps(b))[0];
    return t && { name: u.name, from: [u.x, u.z], to: [t.x, t.z] };
  })()`);
  if (!pick) throw new Error('no hero turn ready for input, or no free tile on screen to tap');
  const at = (t) => ev(`__debug.tileToScreen(${t[0]}, ${t[1]})`);
  const state = () => ev(`(() => { const u = __debug.game().units.find(u => u.name === ${JSON.stringify(pick.name)});
    return { at: [u.x, u.z], hint: document.getElementById('hint').textContent, touch: document.body.classList.contains('touch'),
      card: !document.getElementById('unit-tip').hidden && document.querySelector('#unit-tip .tip-head b')?.textContent }; })()`);
  const until = async (ok, ms) => { // poll: a slow CI machine takes a while to draw and move
    let s;
    for (let t0 = Date.now(); !ok(s = await state()) && Date.now() - t0 < ms;) await sleep(250);
    return s;
  };
  const isPreview = (s) => /tap again to confirm/.test(s.hint);

  // On a failure, say what was under the finger and which events reached the page.
  await ev(`window.__touchLog = []; for (const type of ['pointerdown', 'pointerup', 'click'])
    addEventListener(type, (e) => __touchLog.push(type + ':' + e.pointerType + '@' + (e.target.id || e.target.tagName)
      + ' t' + Math.round(e.timeStamp) + ' run' + Math.round(performance.now())
      + (type === 'click' ? ' ' + Math.round(e.clientX) + ',' + Math.round(e.clientY) + ' picks ' + JSON.stringify(__debug.pickAt(e.clientX, e.clientY)) : '')), true); 1`);
  const p1 = await at(pick.to);
  const under = await ev(`(() => { const e = document.elementFromPoint(${p1.x}, ${p1.y}); return e && (e.id || e.tagName) + (e.className ? '.' + e.className : ''); })()`);
  const before = await state();
  await tap(p1);
  const first = await until(isPreview, 5000);
  await tap(await at(pick.to)); // aim afresh: the camera may have eased since
  const second = await until((s) => String(s.at) === String(pick.to), 15000);
  const previewed = first.touch && String(first.at) === String(pick.from) && isPreview(first);
  const moved = String(second.at) === String(pick.to);
  done(previewed && moved, previewed && moved
    ? `PASS: ${pick.name}'s first tap previewed ("${first.hint}"), the second moved them to ${pick.to}`
      + (process.env.VERBOSE ? `\n${JSON.stringify(await ev('__touchLog'))}` : '')
    : `FAIL: ${JSON.stringify({ pick, tap: p1, under, before, first, second, events: await ev('__touchLog'),
      ready: await ev(`!document.getElementById('end-turn').disabled`), pickNow: await ev(`__debug.pickAt(${p1.x}, ${p1.y})`),
      current: await ev('__debug.game().current?.name') })}${pageErrors.length ? `\nPage errors:\n${pageErrors.slice(-10).join('\n')}` : ''}`);
} catch (err) {
  done(false, `FAIL: ${err.message}${pageErrors.length ? `\nPage errors:\n${pageErrors.slice(-10).join('\n')}` : ''}`);
}
