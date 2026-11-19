// The bestiary screen: every monster kind the player has met, with its character card and a
// line of lore; the rest stay ??? until met. Opened from the title screen and from camp.

import { createUnit } from '../game/units.js';
import { MONSTERS, loadBestiary } from '../game/bestiary.js';
import { unitCard, OUT_OF_FIGHT } from './unitCard.js';
import { unitIcon, unknownIcon } from './icons.js';

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
};

export class Bestiary {
  constructor() {
    this.el = $('#bestiary');
    $('#bestiary-close').addEventListener('click', () => this.close());
    this.el.addEventListener('click', (ev) => ev.target === this.el && this.close()); // the backdrop
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !this.el.hidden) {
        ev.stopPropagation();
        this.close();
      }
    }, true);
  }

  /** "Bestiary (met/all)", for the buttons that open it. */
  static label() {
    return `Bestiary (${loadBestiary().length}/${MONSTERS.length})`;
  }

  open(opener) {
    this.opener = opener;
    const met = loadBestiary();
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
      return `<li class="beast"><span class="pic" style="--c:${color}">${unitIcon(u)}</span>
        <div class="tipcard">${unitCard(OUT_OF_FIGHT, u)}<p class="lore">${esc(LORE[code] ?? '')}</p></div></li>`;
    }).join('');
    this.el.hidden = false;
    $('#bestiary-close').focus();
  }

  close() {
    this.el.hidden = true;
    this.opener?.focus();
  }
}
