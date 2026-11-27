// Gamepads (the standard mapping: Xbox, PlayStation, Switch Pro, Steam Deck). On the board they
// press the keyboard's keys, so the cursor, its two-step Enter and every shortcut work the same
// (controls.js): the stick or D-pad moves the cursor, A picks and acts, B cancels, X ends the
// turn (or throws the dice), Y takes back a move, LB and RB step through the action bar, LT and
// RT turn the view (Q and E), a press of the right stick looks at the other floor (V), Start opens the settings and Back
// the controls panel. Anywhere else (the title, camp, the end banner, a panel) the stick moves focus to the nearest control that way, A presses it and B is
// Escape. The pad is read 60 times a second (on a timer, not frames: a busy or slow board draws
// few, and a quick tap would fall between them), only while one is connected.

import { focusables } from './ui/overlay.js';
import { announce } from './ui/announce.js';

const $ = (sel) => document.querySelector(sel);
/** Standard-mapping button indexes. */
const PAD = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, rs: 11, up: 12, down: 13, left: 14, right: 15 };
const ARROW = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
const DEAD = 0.5; // how far the stick must lean to count
const FIRST_REPEAT = 320; // ms a held direction waits before it repeats
const REPEAT = 130;

/** The panel that has the pad's attention, or null for the board. */
function layer() {
  const open = [...document.querySelectorAll('.overlay')].find((o) => !o.hidden && o.getClientRects().length);
  if (open) return open;
  for (const id of ['#settings', '#banner', '#title', '#camp']) {
    const el = $(id);
    if (el && !el.hidden && el.getClientRects().length) return el;
  }
  return null;
}

/** The control in `root` nearest to the focused one in direction `dir` (screen space). */
export function nearest(list, from, dir) {
  const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  const a = centre(from);
  let best = null;
  let bestScore = Infinity;
  for (const [el, rect] of list) {
    const c = centre(rect);
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const along = { left: -dx, right: dx, up: -dy, down: dy }[dir];
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 2) continue;
    const score = along + across * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

/** `deps`: the HUD, the cursor's tile (`hovered()`), and whether it's a fight with a board. */
export function createGamepad({ hud, hovered, onBoard }) {
  const key = (code, k = code, target = document.body) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { code, key: k, bubbles: true, cancelable: true }));
  const usePad = (on) => {
    if (hud.pad === on) return;
    hud.pad = on;
    document.body.classList.toggle('pad', on);
  };
  // A key or the mouse takes over again from the pad.
  window.addEventListener('keydown', (ev) => ev.isTrusted && usePad(false), true);
  window.addEventListener('pointerdown', () => usePad(false), true);

  /** Move focus in a panel; a slider under focus is nudged left and right instead. */
  function menuMove(root, dir) {
    const at = document.activeElement;
    if (at instanceof HTMLInputElement && at.type === 'range' && root.contains(at) && (dir === 'left' || dir === 'right')) {
      const step = Number(at.step) || 1;
      at.value = String(Number(at.value) + (dir === 'right' ? step : -step));
      at.dispatchEvent(new Event('input', { bubbles: true }));
      at.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const list = focusables(root).map((el) => [el, el.getBoundingClientRect()]).filter(([, r]) => r.width && r.height);
    if (!list.length) return;
    const from = root.contains(at) && at !== root ? at.getBoundingClientRect() : null;
    const next = from ? nearest(list.filter(([el]) => el !== at), from, dir) : list[0][0];
    next?.focus();
  }
  function menuPress(root) {
    const at = document.activeElement;
    if (!root.contains(at) || at === root) return menuMove(root, 'down');
    if (typeof at.click === 'function') at.click();
    else at.dispatchEvent(new MouseEvent('click', { bubbles: true })); // the camp map's rooms (SVG)
  }

  /** LB / RB: the previous or next usable button on the action bar. */
  function cycle(step) {
    const all = [...document.querySelectorAll('#attacks button.ability')];
    const ok = all.filter((b) => !b.disabled);
    if (!ok.length) return;
    const at = ok.findIndex((b) => b.classList.contains('selected'));
    const next = ok[(at + step + ok.length * 2) % ok.length] ?? ok[0];
    const n = all.indexOf(next) + 1;
    if (n <= 10) key(`Digit${n % 10}`, String(n % 10)); // the number keys say what was picked
    else next.click();
  }

  function press(name) {
    usePad(true);
    const root = layer();
    if (ARROW[name]) {
      if (root) menuMove(root, name);
      else if (onBoard()) key(ARROW[name]);
      return;
    }
    if (name === 'b') {
      // B steps back from the new campaign's setup too, where Escape does nothing.
      if (root?.id === 'title' && !$('#title-setup').hidden) return $('#setup-back').click();
      return key('Escape', 'Escape', document.activeElement ?? document.body);
    }
    if (name === 'start') return $('#settings-toggle')?.click();
    if (root) {
      if (name === 'a') menuPress(root);
      return;
    }
    if (!onBoard()) return;
    if (name === 'a') {
      // With no cursor yet, A puts it on the hero (Enter alone would end the turn).
      if (hud.keys && hovered()) key('Enter');
      else key('ArrowUp');
    } else if (name === 'x') key('Space', ' ');
    else if (name === 'y') key('KeyZ', 'z');
    else if (name === 'lb') cycle(-1);
    else if (name === 'rb') cycle(1);
    else if (name === 'back') key('KeyH', 'h');
    else if (name === 'rs') key('KeyV', 'v');
    else if (name === 'lt') key('KeyQ', 'q');
    else if (name === 'rt') key('KeyE', 'e');
  }

  // Polling: what was down last frame, and when each held direction repeats next.
  const down = new Set();
  const due = new Map();
  let timer = 0;
  function poll() {
    const now = performance.now();
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find((p) => p?.connected && p.mapping === 'standard') ?? [...pads].find((p) => p?.connected);
    if (!pad) {
      clearInterval(timer);
      timer = 0;
      down.clear();
      return;
    }
    const held = new Set();
    for (const [name, i] of Object.entries(PAD)) if (pad.buttons[i]?.pressed) held.add(name);
    const [sx = 0, sy = 0] = pad.axes;
    if (Math.max(Math.abs(sx), Math.abs(sy)) > DEAD) held.add(Math.abs(sx) > Math.abs(sy) ? (sx > 0 ? 'right' : 'left') : (sy > 0 ? 'down' : 'up'));
    for (const name of held) {
      if (!down.has(name)) {
        press(name);
        if (ARROW[name]) due.set(name, now + FIRST_REPEAT);
      } else if (ARROW[name] && now >= (due.get(name) ?? Infinity)) {
        press(name);
        due.set(name, now + REPEAT);
      }
    }
    down.clear();
    for (const name of held) down.add(name);
  }
  const start = () => {
    if (!timer) timer = setInterval(poll, 16);
  };
  window.addEventListener('gamepadconnected', (ev) => {
    announce(`Gamepad connected: ${ev.gamepad.id.replace(/\s*\(.*$/, '')}.`);
    start();
  });
  if ([...(navigator.getGamepads?.() ?? [])].some((p) => p?.connected)) start();
  return { press }; // for tests
}
