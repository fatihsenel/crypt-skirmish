/**
 * How fast animations and pauses play: 1 is normal, 2 is twice as fast. main.js raises it
 * while monsters take their turns (the monster-turn speed setting) and puts it back after.
 */
export const playback = { rate: 1 };

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
        resolve();
      }
    };
    step();
  });
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms / playback.rate));
