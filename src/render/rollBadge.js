// The d20 badge: pops up over whoever rolls, tumbles through a few faces, lands on the roll,
// then says what it means (Hit, Miss, Saves...). For the player's own attacks it can wait
// first, pulsing, until they throw it. With advantage or disadvantage both dice
// show and the one that doesn't count fades. Runs on the same clock as the rest of the
// animations, so the monster-turn speed setting speeds it up too.

import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { tween, wait, linear, calm } from './tween.js';

const TUMBLE = 380;
const LINGER = 1150;

const DIE = `<svg viewBox="0 0 54 54" aria-hidden="true"><polygon class="face" points="27,2 50,15 50,39 27,52 4,39 4,15"/><polygon class="facet" points="27,12 42,36 12,36"/></svg>`;

/**
 * Show a roll over a unit. Resolves once the die has landed and the result is showing;
 * the badge then lingers and fades on its own.
 * @param at       {x, z} board position
 * @param height   how high above the floor (above the unit's name label)
 * @param roll     { rolls: [d20...], d20, line, result, tone }
 *   tone: 'hit' | 'crit' | 'miss' | 'fumble' | 'save' | 'fail'
 * @param prompt   optional { label, thrown: () => Promise }: the die waits, showing the
 *                 label, until thrown() resolves
 */
export async function rollBadge(scene, at, height, { rolls, d20, line, result, tone }, prompt = null) {
  const el = document.createElement('div');
  el.className = 'roll-badge';
  const pair = rolls.length > 1;
  const dropped = pair ? rolls.indexOf(d20) === 0 ? 1 : 0 : -1;
  // The renderer owns the outer element's transform, so the pop-in scales an inner box.
  el.innerHTML = `<div class="roll-in"><div class="roll-dice">${rolls.map(() => `<div class="roll-die">${DIE}<span></span></div>`).join('')}</div>`
    + '<div class="roll-line"></div><div class="roll-result"></div><div class="roll-prompt"></div></div>';
  el.querySelector('.roll-line').textContent = line;
  el.querySelector('.roll-result').textContent = result;
  const box = el.querySelector('.roll-in');
  const dice = [...el.querySelectorAll('.roll-die')];
  const nums = dice.map((d) => d.querySelector('span'));

  const obj = new CSS2DObject(el);
  obj.position.set(at.x, height, at.z);
  scene.add(obj);

  if (prompt) {
    el.querySelector('.roll-prompt').textContent = prompt.label;
    for (const n of nums) n.textContent = '20';
    el.classList.add('waiting');
    box.style.transform = 'translateX(-50%) scale(1)';
    keepOnScreen(el, box);
    await prompt.thrown();
    el.classList.remove('waiting');
  }

  // Pop in while tumbling: each face shows a random number until the dice land.
  let last = -1;
  const still = calm(); // reduced motion: the numbers still tumble, the dice don't wobble
  await tween(TUMBLE, (t) => {
    if (!prompt) box.style.transform = `translateX(-50%) scale(${Math.min(1, 0.4 + t * 2.4)})`;
    const step = Math.floor(t * 8);
    if (step !== last && t < 1) {
      last = step;
      for (const n of nums) n.textContent = 1 + Math.floor(Math.random() * 20);
      if (!still) for (const d of dice) d.style.transform = `rotate(${step % 2 ? -16 : 16}deg)`;
    }
  }, linear);

  rolls.forEach((r, i) => { nums[i].textContent = r; dice[i].style.transform = ''; });
  if (dropped >= 0) dice[dropped].classList.add('dropped');
  el.classList.add('landed', tone);
  keepOnScreen(el, box);
  await wait(110);
  el.classList.add('told');

  // Linger, then fade and go (not awaited: the attack plays on underneath).
  wait(LINGER)
    .then(() => tween(240, (t) => { el.style.opacity = String(1 - t); }, linear))
    .then(() => scene.remove(obj));
}

/**
 * Near the top of the screen the badge would hide under the portraits: hang it below the
 * name label instead, over the figure. Near a side it slides back in. Checked once the
 * renderer has placed it.
 */
function keepOnScreen(el, box) {
  requestAnimationFrame(() => {
    const top = document.getElementById('initiative')?.getBoundingClientRect().bottom ?? 0;
    if (box.getBoundingClientRect().top < top + 6) el.classList.add('below');
    box.style.translate = '';
    const r = box.getBoundingClientRect();
    const pad = 8;
    const dx = r.left < pad ? pad - r.left : r.right > innerWidth - pad ? innerWidth - pad - r.right : 0;
    if (dx) box.style.translate = `${Math.round(dx)}px 0`;
  });
}

/** What an attack roll says: the line under the die and the outcome. */
export function attackRoll(r) {
  const line = r.d20 === 20 ? 'Natural 20' : r.d20 === 1 ? 'Natural 1'
    : `${r.toHit >= 0 ? '+' : '−'}${Math.abs(r.toHit)} = ${r.total} vs AC ${r.ac}`;
  const [result, tone] = r.crit ? ['Critical hit', 'crit']
    : r.fumble ? ['Miss', 'fumble']
      : r.shielded ? ['Blocked', 'miss']
        : r.hit ? ['Hit', 'hit'] : ['Miss', 'miss'];
  return { rolls: r.rolls, d20: r.d20, line, result, tone };
}

/** What a saving throw says. */
export function saveRoll(s, stat, dc, failWord = 'Fails') {
  return {
    rolls: [s.d20], d20: s.d20,
    line: `${stat} ${s.total} vs DC ${dc}`,
    result: s.success ? 'Saves' : failWord,
    tone: s.success ? 'save' : 'fail',
  };
}
