/**
 * How fast animations and pauses play: 1 is normal, 2 is twice as fast. main.js raises it
 * while monsters take their turns (the monster-turn speed setting) and puts it back after.
 */
export const playback = { rate: 1 };

const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
let motion = 'system'; // the Motion setting: 'system', 'reduce' or 'full'

/** Use the Motion setting (see game/settings.js). */
export function setMotion(pref) {
  motion = pref;
}

/** Call `fn` when the system's reduced-motion setting changes. */
export const onSystemMotion = (fn) => reduce?.addEventListener?.('change', fn);

/**
 * Less motion (the Motion setting, or the system's when it follows that): no screen shake,
 * camera pans jump, floating text fades where it appears, dice don't wobble. Figures still
 * walk and swing; that's the game itself.
 */
export const calm = () => motion === 'reduce' || (motion === 'system' && !!reduce?.matches);

/**
 * Whether anything on the board is moving. The 3D view draws every frame while it is, and
 * only a few times a second otherwise (the torches still flicker), to spare phone batteries.
 * Tweens and waits count, and so does anything that calls keepAwake.
 */
let running = 0;
let awakeUntil = 0;
const wakers = new Set();
export const animating = () => running > 0 || performance.now() < awakeUntil;
/** `fn()` runs whenever something starts moving. */
export const onAnimate = (fn) => wakers.add(fn);
/** Draw every frame for the next `ms` (input, a camera glide, a clip playing). */
export function keepAwake(ms = 0) {
  awakeUntil = Math.max(awakeUntil, performance.now() + ms);
  for (const fn of wakers) fn();
}

export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const linear = (t) => t;

/**
 * Animate t from 0..1 over `ms`, calling onUpdate(easedT). Resolves when done.
 * Uses requestAnimationFrame, with a timer fallback so turns never stall
 * when the browser throttles rAF (background tab, hidden pane).
 */
export function tween(ms, onUpdate, ease = easeInOut) {
  ms /= playback.rate;
  running++;
  keepAwake();
  return new Promise((resolve) => {
    const start = performance.now();
    let done = false;
    let timer = 0;
    const step = () => {
      if (done) return;
      clearTimeout(timer);
      const t = Math.min(1, (performance.now() - start) / ms);
      onUpdate(ease(t));
      if (t < 1) {
        requestAnimationFrame(step);
        timer = setTimeout(step, 100);
      } else {
        done = true;
        running--;
        keepAwake(300); // what the tween started (a fade, a fall) settles over the next frames
        resolve();
      }
    };
    step();
  });
}

export const wait = (ms) => {
  keepAwake(ms / playback.rate + 300);
  return new Promise((r) => setTimeout(r, ms / playback.rate));
};
