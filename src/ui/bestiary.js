// The bestiary screen: every monster kind the player has met, with its character card and a
// line of lore; the rest stay ??? until met. Opened from the title screen and from camp.

import { createUnit } from '../game/units.js';
import { ELITE_TRAITS } from '../game/combat.js';
import { MONSTERS, loadBestiary, loadSlain, loadHurt, deadliest, unread, markRead, loadElitesSlain, loadHeard } from '../game/bestiary.js';
import { unitCard, OUT_OF_FIGHT } from './unitCard.js';
import { reachedNewGamePlus, loadDeepest, loadHistory } from '../game/history.js';
import { unitIcon, unknownIcon } from './icons.js';
import { Overlay } from './overlay.js';
import { bestiaryLabel } from './bestiaryLabel.js';
import { loadWeekly } from '../game/weekly.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export const LORE = {
  g: 'Small, quick and cruel. They duck out of sight when hurt and strike when you look away.',
  s: 'Bones held together by old orders. They don’t tire, and they don’t stop.',
  o: 'Raiders who charge at the first scent of a fight.',
  r: 'Fat on what the crypt leaves behind, and never alone.',
  b: 'The goblins’ boss, who lets his gang take the blows for him.',
  n: 'A necromancer who dug too deep and raises whatever he finds.',
  u: 'Grave-eaters. Their claws carry the filth they feed on.',
  h: 'An elder ghoul. The stench alone turns the stomach.',
  w: 'The older thing Morvath served: a wight in rusted mail, risen from his bier.',
  m: 'It looks like a chest until you reach for the lid.',
  k: 'It webs the passages and waits overhead.',
  e: 'A chill with a will of its own. Its touch drains the courage out of you.',
  q: 'The banshee who called Varek back. Her touch withers, her face terrifies.',
  y: 'Wrapped servants of the tomb. Their fists carry a rot that keeps wounds from closing.',
  t: 'A hateful shade that drains the life from whatever it touches.',
  x: 'The tomb’s guards, whose oaths rotted along with their lord.',
  l: 'The crypt’s first lord, sealed below the throne for an age and in no mood to be woken.',
  a: 'Carved to guard the chasm, and still guarding it. It holds still as a statue until you come close.',
  z: 'Eight legs, a heavy tail and a bite that turns flesh to stone. Its den is full of statues.',
  j: 'A mound of yellow ooze that eats through flesh and bone alike. Cut it, and there are two.',
  i: 'A block of clear jelly that sweeps the halls clean. You see it when you are already inside, with the bones of the last ones.',
  d: 'A body that forgot how to lie down. Cut it down and it gets up again, unless the blow is clean or holy.',
  c: 'Not one rat but a hundred, pouring over and under everything. Swords find little to cut.',
  f: 'A zealot in red who mutters, and the bones answer. Two skeletons at a time climb up at its call; cut it down and they fall apart.',
  v: 'The beast Nekhet walled into the labyrinth’s heart. A thousand years of pacing have not calmed him.',
};

/** "87 damage, 2 heroes dropped". */
function hurtText({ damage, downs }) {
  return `${damage} damage${downs ? `, ${downs} ${downs === 1 ? 'hero' : 'heroes'} dropped` : ''}`;
}

export class Bestiary {
  constructor() {
    this.panel = new Overlay($('#bestiary'));
  }

  /** A button that opens it (see bestiaryLabel). */
  static label(button) {
    bestiaryLabel(button);
  }

  open(opener) {
    const met = loadBestiary();
    const slain = loadSlain();
    const hurt = loadHurt();
    const heard = loadHeard();
    const name = (code) => createUnit(code, 0, 0).name;
    const worst = deadliest(hurt).filter((h) => met.includes(h.code));
    $('#bestiary-deadliest').hidden = !worst.length;
    $('#bestiary-deadliest').innerHTML = worst.length
      ? `<b>Deadliest foes:</b> ${worst.map((h) => `${esc(name(h.code))} (${hurtText(h)})`).join(', ')}`
      : '';
    // New Game+ 2 and deeper: what an elite can be, shown once New Game+ is open or a weekly
    // elite crypt has been tried.
    const eliteSlain = loadElitesSlain();
    const elites = reachedNewGamePlus(loadDeepest(), loadHistory()) || Object.keys(loadWeekly()).length > 0;
    $('#bestiary-elites').hidden = !elites;
    $('#bestiary-elites').innerHTML = !elites ? '' : `<h3 class="sub">Elites</h3>
      <p class="muted">From New Game+ 2, the strongest monster in each room is an elite with one of these traits. It wears a gold band.</p>
      <ul class="elite-traits">${ELITE_TRAITS.map((t) => `<li><b>${esc(t.name)}</b>: ${esc(t.desc)}.${
        eliteSlain[t.id] ? ` <span class="muted">${eliteSlain[t.id]} slain</span>` : ''}</li>`).join('')}</ul>`;
    const fresh = unread();
    markRead();
    for (const b of document.querySelectorAll('.bestiary-open')) Bestiary.label(b);
    $('#bestiary-count').textContent = met.length === MONSTERS.length
      ? 'Every creature of the crypt, met and survived.'
      : `${met.length} of ${MONSTERS.length} met. The rest wait deeper down.`;
    $('#bestiary .beasts').innerHTML = MONSTERS.map((code) => {
      if (!met.includes(code)) {
        return `<li class="beast unknown"><span class="pic">${unknownIcon()}</span>
          <div class="tipcard"><div class="tip-head"><b>???</b><small>Not met yet</small></div></div></li>`;
      }
      const u = createUnit(code, 0, 0);
      const color = `#${(u.color ?? 0x777777).toString(16).padStart(6, '0')}`;
      const isNew = fresh.includes(code) ? '<span class="new-tag">New</span>' : '';
      return `<li class="beast"><span class="pic" style="--c:${color}">${unitIcon(u)}</span>${isNew}
        <div class="tipcard">${unitCard(OUT_OF_FIGHT, u)}<p class="lore">${esc(LORE[code] ?? '')}</p>${heard[code] ? `<p class="lore">“${esc(heard[code])}”</p>` : ''}
        <p class="slain">${slain[code] ? `Slain: ${slain[code]}` : 'None slain yet'}${hurt[code] ? ` · Dealt you ${hurtText(hurt[code])}` : ''}</p></div></li>`;
    }).join('');
    this.panel.open(opener);
  }
}
