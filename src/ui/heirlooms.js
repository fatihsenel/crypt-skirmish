// New Game+: after the campaign is won, each hero picks one magic item to keep, and the party
// goes back down one tier deeper (see newGamePlus in game/campaign.js).

import { Overlay } from './overlay.js';
import { HERO_CODES, heirloomChoices, heroName, difficultyLabel, TIER_HP } from '../game/campaign.js';
import { TEMPLATES, classOf } from '../game/units.js';
import { ITEMS } from '../game/items.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Heirlooms {
  /** `onGo(won, keep)` starts the run; `keep` is { F: 'ringProtection', … } (heroes with nothing are left out). */
  constructor(onGo) {
    this.el = $('#heirlooms');
    this.panel = new Overlay(this.el);
    this.el.querySelector('form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const keep = {};
      for (const input of this.el.querySelectorAll('input[type=radio]:checked')) keep[input.name] = input.value;
      this.panel.close();
      onGo(this.won, keep);
    });
  }

  /** Opens the picker for the won campaign `won`. */
  open(won, opener) {
    this.won = won;
    const tier = (won.tier ?? 0) + 1;
    const choices = heirloomChoices(won);
    const pct = Math.round(TIER_HP * tier * 100);
    $('#heirlooms-intro').textContent = `The same heroes go back down from the first room, as fresh as on day one, on ${difficultyLabel(won.difficulty, tier)}: `
      + `monsters have ${pct}% more hit points and +${tier} to hit and damage. Each hero may carry one magic item from this run.`;
    $('#heirlooms-list').innerHTML = HERO_CODES.map((code) => {
      const rec = won.party[code];
      const items = choices[code];
      const pick = items.length
        ? items.map((id, i) => `<label title="${esc(ITEMS[id].desc ?? '')}"><input type="radio" name="${code}" value="${esc(id)}"${i === 0 ? ' checked' : ''} /> ${esc(ITEMS[id].name)}</label>`).join('')
        : '<span class="muted">No magic items to keep</span>';
      return `<li><div class="who"><b>${esc(heroName(code, rec))}</b> <span class="muted">${esc(TEMPLATES[classOf(code, rec)].cls)}</span></div><div class="keep">${pick}</div></li>`;
    }).join('');
    $('#heirlooms-go').textContent = `Go back down (NG+${tier})`;
    this.panel.open(opener);
  }
}
