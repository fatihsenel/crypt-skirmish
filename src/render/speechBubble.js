// Speech bubbles over the figures (lines from speech.js): one at a time, just above the
// speaker's name label, typed out a letter at a time, held, then faded. A new one replaces
// the old. They follow the monster-turn speed (playback.rate) and never hold up a turn.
// Reduced motion shows the whole line at once and takes it away without a fade.
// The bubble lives inside the label, so it moves and hides with the figure; screen readers
// skip it (the log already says what happened).

import { playback, calm } from './tween.js';
import './speechBubble.css';

const LETTERS_PER_SECOND = 35;
let current = null; // { el, timers }

/** Take the bubble that's showing away now. */
export function hush() {
  if (!current) return;
  for (const t of current.timers) clearTimeout(t);
  current.el.remove();
  current = null;
}

/** `view` (a UnitView) says `text`. */
export function speak(view, text) {
  hush();
  const label = view?.label?.element;
  if (!label || !text || !view.label.visible) return;
  const el = document.createElement('div');
  el.className = `speech${view.unit.team === 'monsters' ? ' foe' : ''}`;
  el.setAttribute('aria-hidden', 'true');
  const shown = document.createElement('span');
  const rest = document.createElement('span');
  rest.className = 'rest'; // takes its room from the start, so the bubble doesn't grow
  rest.textContent = text;
  el.append(shown, rest);
  label.prepend(el);
  const me = { el, timers: [] };
  current = me;
  stepAside(el, label);

  const rate = playback.rate || 1;
  const later = (ms, fn) => me.timers.push(setTimeout(() => current === me && fn(), ms / rate));
  const still = calm();
  let typed = 0;
  if (still) {
    shown.textContent = text;
    rest.textContent = '';
  } else {
    // A letter at a time; spaces go with the letter before them.
    for (let i = 1, t = 0; i <= text.length; i++) {
      if (text[i - 1] !== ' ') t += 1000 / LETTERS_PER_SECOND;
      later(t, () => {
        typed = i;
        shown.textContent = text.slice(0, typed);
        rest.textContent = text.slice(typed);
      });
    }
  }
  const typing = still ? 0 : (text.replaceAll(' ', '').length * 1000) / LETTERS_PER_SECOND;
  const hold = typing + 1100 + text.length * 25;
  if (still) {
    later(hold, hush);
  } else {
    later(hold, () => el.classList.add('fading'));
    later(hold + 220, hush);
  }
}

/**
 * Over a crowd the bubble would cover a neighbour's name: slide it to the side that doesn't
 * (the tail stays on the speaker).
 */
function stepAside(el, label) {
  const others = [...document.querySelectorAll('.unit-label')]
    .filter((l) => l !== label && l.offsetParent && l.style.display !== 'none')
    .map((l) => l.querySelector('.name')?.getBoundingClientRect())
    .filter((r) => r && r.width);
  if (!others.length) return;
  const box = el.getBoundingClientRect();
  const covers = (dx) => others.some((r) => r.left < box.right + dx && r.right > box.left + dx && r.top < box.bottom && r.bottom > box.top);
  if (!covers(0)) return;
  const shift = Math.round(box.width / 2 - 18);
  const dx = [shift, -shift].find((d) => !covers(d));
  if (dx !== undefined) el.style.setProperty('--shift', `${dx}px`);
}
