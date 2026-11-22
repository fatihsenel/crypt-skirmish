// The character card's text: what a unit is, how tough it is, what it hits with and what
// ails it. Used by the HUD (figures and portraits in a fight) and the bestiary.

import { signed } from '../game/dice.js';
import { SPELLS, PASSIVES, CONDITION_INFO } from '../game/abilities.js';
import { ITEMS } from '../game/items.js';
import { Game, ELITE_TRAITS, RULES, longReach } from '../game/combat.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const markOf = (u) => (u.marked === true ? 'huntersMark' : u.marked);

/** A unit's numbers outside a fight (the bestiary): the rules' own sums, nothing situational. */
export const OUT_OF_FIGHT = {
  acOf: (u) => Game.prototype.acOf.call(null, u),
  toHitBonus: (u, a) => Game.prototype.toHitBonus.call(null, u, a),
  damageBonus: (u, a) => Game.prototype.damageBonus.call(null, u, a),
  spellDC: (u) => Game.prototype.spellDC.call(null, u),
};

const CR = { 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' };
const cap = (s) => s[0].toUpperCase() + s.slice(1);
/** One attack on a character card: to hit, damage, reach and what a hit does. */
function attackLine(game, u, a) {
  const bonus = game.damageBonus(u, a);
  const dmg = a.damage ? `${a.damage}${bonus ? ` ${signed(bonus).replace(/^([+-])/, '$1 ')}` : ''}` : 'no damage';
  const long = (game.rules ?? RULES) >= 2 ? longReach(a) : a.reach;
  const reach = a.reach > 1 ? `range ${a.reach * 5}${long > a.reach ? `/${long * 5}` : ''} ft` : 'melee';
  const r = a.rider?.v2 && (game.rules ?? RULES) >= 2 ? a.rider.v2 : a.rider; // a ghoul's claws paralyse under rules 2
  const rider = !r ? '' : r.save ? ` · ${r.save.toUpperCase()} DC ${r.dc} or ${r.condition}` : ` · ${r.condition} on a hit`;
  const recharge = a.recharge ? ` · recharge ${a.recharge}–6${u.spent?.[a.name] ? ', spent' : ''}` : '';
  return `<li><b>${esc(a.name)}</b> ${signed(game.toHitBonus(u, a))} · ${esc(dmg)} · ${reach}${esc(rider)}${recharge}</li>`;
}

/** The card's HTML. `game` gives the numbers: a live Game, or OUT_OF_FIGHT. */
export function unitCard(game, u) {
  const kind = u.team === 'heroes' ? `${u.cls} · Level ${u.level}`
    : `${u.cls}${u.cr !== undefined ? ` · CR ${CR[u.cr] ?? u.cr}` : ''}${u.undead ? ' · Undead' : ''}`;
  const chips = u.alive ? [
    `HP ${u.hp}/${u.maxHp}${u.tempHp > 0 ? ` +${u.tempHp}` : ''}`,
    `AC ${game.acOf(u)}`,
    `Speed ${u.speed * 5} ft`,
    ...(game.order?.includes(u) ? [`Initiative ${u.initiative}`] : []),
  ] : [];
  const status = [
    !u.alive && (u.corpse ? 'Long dead.' : 'Fallen.'),
    u.alive && u.asleep && 'Asleep. It wakes if it notices you or takes damage.',
    u.alive && !u.asleep && u.unaware && u.team === 'monsters' && 'Hasn’t noticed you yet.',
    u.alive && u.hidden && 'Hidden.',
    u.alive && u.turned > 0 && 'Turned: fleeing from the holy symbol.',
  ].filter(Boolean);
  const attacks = u.alive ? u.attacks.filter((a) => u.team === 'monsters' || a.damage) : [];
  const conds = Object.keys(u.conditions ?? {});
  const elite = ELITE_TRAITS.find((t) => t.id === u.elite);
  const traits = [
    elite && `Elite · ${elite.name}: ${elite.desc}.`,
    u.multiattack > 1 && `Attacks ${u.multiattack === 2 ? 'twice' : `${u.multiattack} times`} a turn.`,
    u.team === 'monsters' && u.spells?.length && `Casts ${u.spells.map((id) => SPELLS[id]?.name ?? id).join(', ')} (DC ${game.spellDC(u)}).`,
    u.flies && 'Flies: icy ground doesn’t slow it.',
    u.stench && `Stench: a hero starting a turn next to it makes a CON save (DC ${u.stench.dc}) or is poisoned.`,
    u.rises && !u.roused && 'At half HP his fallen house rises to fight again.',
  ].filter(Boolean);
  const tags = [
    ...(u.team === 'heroes' ? u.passives.map((p) => PASSIVES[p].split(':')[0]) : []),
    ...(u.items ?? []).map((i) => ITEMS[i].name),
  ];
  return `<div class="tip-head"><b class="${u.team}">${esc(u.name)}</b><small>${esc(kind)}</small></div>
    ${chips.length ? `<div class="tip-chips">${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</div>` : ''}
    ${status.map((t) => `<p class="tip-note">${esc(t)}</p>`).join('')}
    ${conds.length || u.marked ? `<ul class="tip-list tip-conds">${u.marked ? `<li><b>${esc(SPELLS[markOf(u)].name)}</b> <span>${esc(SPELLS[markOf(u)].desc)}</span></li>` : ''}${conds.map((c) => {
      const [name, ...rest] = (CONDITION_INFO[c] ?? cap(c)).split(': ');
      return `<li class="cond ${c}"><b>${esc(name)}</b> <span>${esc(rest.join(': '))}</span></li>`;
    }).join('')}</ul>` : ''}
    ${attacks.length ? `<ul class="tip-list">${attacks.map((a) => attackLine(game, u, a)).join('')}</ul>` : ''}
    ${traits.map((t) => `<p>${esc(t)}</p>`).join('')}
    ${tags.length ? `<p class="tip-note">${esc(tags.join(' · '))}</p>` : ''}`;
}

/**
 * A name short enough for a turn-order portrait: past 10 letters, the words before the last
 * shrink to initials, so "Giant Spider 2" shows as "G. Spider 2" and "Risen Mummy" as
 * "R. Mummy". One-word names are left for the ellipsis.
 */
export function shortName(name) {
  if (name.length <= 10) return name;
  const words = name.split(' ');
  const num = /^\d+$/.test(words.at(-1)) ? words.pop() : null;
  if (words.length < 2) return name;
  return [...words.slice(0, -1).map((w) => `${w[0]}.`), words.at(-1), ...(num ? [num] : [])].join(' ');
}
