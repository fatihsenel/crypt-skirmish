// The replay bar while a finished fight plays back: pause, next turn, speed and the keys for
// them. `r` is the replay in progress (see startReplay in main.js), `round` the fight's round.

import { playback } from '../render/tween.js';
import { sfx } from '../audio/sfx.js';

export const REPLAY_SPEEDS = [1, 2, 4];

const el = (id) => document.getElementById(id);

/** How fast the replay plays: 1 when there is none. */
export const replayRate = (r) => (r ? REPLAY_SPEEDS[r.speed] : 1);

/** Resolves at once, or when a paused replay is played again. */
export function replayGate(r) {
  if (!r?.paused) return Promise.resolve();
  return new Promise((resolve) => { r.wake = resolve; });
}

export function replayLabel(r, round) {
  if (!r) return;
  el('replay-label').textContent = r.over ? `Replay · ${r.rec.result === 'victory' ? 'won' : 'lost'} in round ${round}` : `Replay · round ${Math.max(1, round)}`;
  el('replay-pause').textContent = r.paused ? 'Play' : 'Pause';
  el('replay-pause').disabled = r.over;
  el('replay-step').disabled = !r.paused || r.over;
  el('replay-play').hidden = !r.link;
  el('replay-speed').textContent = `${REPLAY_SPEEDS[r.speed]}×`;
}

/** Pause or play on; with `stepTurn`, play to the start of the next turn and pause there. */
export function replayPlay(r, round, stepTurn = false) {
  if (!r || r.over) return;
  sfx.ui();
  r.paused = stepTurn ? false : !r.paused;
  r.stepTurn = stepTurn;
  if (!r.paused) {
    const wake = r.wake;
    r.wake = null;
    wake?.();
  }
  replayLabel(r, round);
}

/** The next speed up (`by` 1), down (-1), or round to the slowest again (`wrap`). */
export function replaySpeed(r, round, by = 1, wrap = false) {
  if (!r) return;
  const speed = wrap ? (r.speed + by) % REPLAY_SPEEDS.length : Math.min(REPLAY_SPEEDS.length - 1, Math.max(0, r.speed + by));
  if (speed === r.speed) return;
  sfx.ui();
  r.speed = speed;
  playback.rate = replayRate(r);
  replayLabel(r, round);
}

/** The replay's keys: Space pause, → next turn, + and − speed, Esc `exit`. True if handled. */
export function replayKey(r, ev, round, exit) {
  if (ev.code === 'Space' || ev.code === 'KeyK') {
    if (ev.target instanceof HTMLButtonElement) return true; // the focused button takes it
    ev.preventDefault();
    replayPlay(r, round);
  } else if (ev.code === 'ArrowRight') {
    ev.preventDefault();
    replayPlay(r, round, true);
  } else if (ev.key === '+' || ev.key === '=' || ev.key === '-' || ev.key === '_') {
    replaySpeed(r, round, ev.key === '+' || ev.key === '=' ? 1 : -1);
  } else if (ev.code === 'Escape') {
    sfx.ui();
    exit();
  } else return false;
  return true;
}
