// Touch check: on a phone the first tap on a tile previews the move and the second does it.
// Starts a headless Chrome with a throwaway profile, emulates a 375×812 touch phone, opens
// ?level=1 on the dev server and taps a reachable tile twice with real touch events.
//   npm run dev        (in another terminal, port 5173)
//   npm run touch-check
// Env: URL (default http://localhost:5173/; the deploy workflow checks the preview build at
// http://localhost:4173/crypt-skirmish/), CHROME (the Chrome binary; the macOS default).
// On CI (CI set) Chrome runs without its sandbox, which the Linux runners don't allow.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_BASE = process.env.URL ?? 'http://localhost:5173/';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'crypt-touch-'));
const chrome = spawn(CHROME, [`--headless=new`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.env.CI ? ['--no-sandbox'] : []),
  'about:blank'], { stdio: 'ignore' });
let ws;
const done = (ok, text) => {
  console.log(text);
  ws?.close();
  chrome.kill();
  setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
  setTimeout(() => process.exit(ok ? 0 : 1), 700);
};

let targets;
for (let i = 0; i < 40 && !targets; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { await sleep(250); }
}
if (!targets) done(false, `FAIL: Chrome didn't start (${CHROME})`);
ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const waiting = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'page error');
  return r.result?.result?.value;
};
const tap = async ({ x, y }) => {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(60);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(700);
};

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: URL_BASE }); await sleep(2000);
  await ev(`localStorage.setItem('crypt-skirmish:tips', JSON.stringify({ on: false, seen: [] })); 1`);
  await send('Page.navigate', { url: `${URL_BASE}?level=1` });
  // The room is up once the game exists (slow on a software-rendered CI machine).
  let up = false;
  for (let t0 = Date.now(); !up && Date.now() - t0 < 60000; await sleep(500)) {
    up = await ev('!!window.__debug?.game()').catch(() => false); // false while the page swaps
  }
  if (!up) throw new Error('the room never loaded');
  await sleep(4000); // the fight's opening: initiative, the first turn's camera move

  // A hero's turn, then a free tile two or more steps away that's on screen, clear of the HUD.
  const pick = await ev(`(async () => {
    const g = __debug.game();
    for (let i = 0; i < 60 && g.current?.team !== 'heroes'; i++) await new Promise(r => setTimeout(r, 500));
    await new Promise(r => setTimeout(r, 2500)); // the camera settles on the hero
    const u = g.current;
    const steps = (t) => Math.abs(t.x - u.x) + Math.abs(t.z - u.z);
    const onScreen = (t) => { const p = __debug.tileToScreen(t.x, t.z); return p.x > 40 && p.x < innerWidth - 40 && p.y > 170 && p.y < innerHeight - 260; };
    const t = g.destinations(u)
      .filter(t => steps(t) >= 2 && onScreen(t) && !g.units.some(o => o.alive && Math.abs(o.x - t.x) + Math.abs(o.z - t.z) < 2))
      .sort((a, b) => steps(a) - steps(b))[0];
    return t && { name: u.name, from: [u.x, u.z], to: [t.x, t.z] };
  })()`);
  if (!pick) throw new Error('no free tile on screen to tap');
  const at = (t) => ev(`__debug.tileToScreen(${t[0]}, ${t[1]})`);
  const state = () => ev(`(() => { const u = __debug.game().units.find(u => u.name === ${JSON.stringify(pick.name)});
    return { at: [u.x, u.z], hint: document.getElementById('hint').textContent, touch: document.body.classList.contains('touch') }; })()`);

  await tap(await at(pick.to));
  const first = await state();
  await tap(await at(pick.to)); // aim afresh: the camera may have eased since
  await sleep(2500);
  const second = await state();
  const previewed = first.touch && String(first.at) === String(pick.from) && /tap again to confirm/.test(first.hint);
  const moved = String(second.at) === String(pick.to);
  done(previewed && moved, previewed && moved
    ? `PASS: ${pick.name}'s first tap previewed ("${first.hint}"), the second moved them to ${pick.to}`
    : `FAIL: ${JSON.stringify({ pick, first, second })}`);
} catch (err) {
  done(false, `FAIL: ${err.message}`);
}
