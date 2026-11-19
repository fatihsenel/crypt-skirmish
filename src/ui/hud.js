// HTML overlay: initiative tracker, action bar, combat log, banners.

import { saveRunCard } from './runCard.js';
import { signed } from '../game/dice.js';
import { ACTIONS, SPELLS, PASSIVES, SHOVE, CONDITION_INFO } from '../game/abilities.js';
import { ITEMS } from '../game/items.js';
import { unitIcon, unknownIcon } from './icons.js';
import { AbilityTip } from './abilityTip.js';
import { UnitTip } from './unitTip.js';
import { unitCard, shortName } from './unitCard.js';

/** A turn-order name, short enough to tell apart: "Giant Spider 2" shows as "G. Spider 2". */
const chipName = (name) => esc(shortName(name));
import { isWeapon, isMelee } from '../game/combat.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const who = (u) => `<span class="${u.team}">${esc(u.name)}</span>`;
const ordinal = (n) => ['', '1st', '2nd', '3rd'][n] ?? `${n}th`;
const spellLevel = (s) => (s.level ? `${ordinal(s.level)}-level spell` : s.pool ? 'Paladin feature' : 'Cantrip');
/** The numbers worth seeing at a glance on a spell's card. */
/** A Warlock casts every spell with its pact slots, so at their level. */
const pactLevel = (u) => Math.max(0, ...Object.entries(u.slotMax ?? {}).filter(([, n]) => n > 0).map(([l]) => +l));
const castLevel = (s, u) => (u.pactMagic && s.level ? Math.max(s.level, pactLevel(u)) : s.level);
function spellChips(s, u) {
  const chips = [];
  const up = castLevel(s, u) - s.level;
  const damage = s.targeting === 'cone' && up ? s.damage.replace(/^(\d+)/, (n) => +n + up) : s.damage;
  if (s.damage) chips.push(`${s.darts ? `${s.darts + up} × ` : s.rays ? `${s.rays + up} × ` : ''}${damage} damage`);
  if (s.heal) chips.push(`heal ${s.heal[0]}d${s.heal[1]} + WIS`);
  if (s.pool) chips.push(`${u.layOnHands} HP in the pool`);
  if (s.save) chips.push(`${s.save.toUpperCase()} save`);
  if (s.range) chips.push(s.range === 1 ? 'touch' : s.targeting === 'cone' ? `${s.range * 5}-ft cone` : `range ${s.range * 5} ft`);
  return chips;
}
/** The tooltip card's HTML. */
function tipCard({ name, kind, chips = [], desc, notes = [], note, how, problem }) {
  return `<div class="tip-head"><b>${esc(name)}</b>${kind ? `<small>${esc(kind)}</small>` : ''}</div>
    ${chips.length ? `<div class="tip-chips">${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</div>` : ''}
    ${desc ? `<p>${esc(desc)}</p>` : ''}
    ${[...notes, note].filter(Boolean).map((n) => `<p class="tip-note">${esc(n)}</p>`).join('')}
    ${problem ? `<p class="tip-problem">${esc(problem)}</p>` : how ? `<p class="tip-how">${esc(how)}</p>` : ''}`;
}
/** Which spell marks a unit: Hunter's Mark (older saves stored `true`) or Hex. */
const markOf = (u) => (u.marked === true ? 'huntersMark' : u.marked);
const dice = (roll) => `<span class="dice">[${roll.rolls.join('+')}${roll.bonus ? ` ${signed(roll.bonus)}` : ''}]</span>`;
// (logAction builds every action's text, so this must cope with results that have no roll)
const stealthRoll = (r) => !r.rolls ? '' : `<span class="dice">${r.rolls.length > 1 ? `d20 [${r.rolls.join(', ')}] → ${r.d20}` : `d20 ${r.d20}`} ${signed(r.bonus)}${r.noisy ? ' · noisy armour' : ''}${r.poisoned ? ' · poisoned' : ''}</span>`;
const saveText = (s, fail = 'fails') =>
  `${who(s.unit)} <span class="dice">${s.total}${s.aura ? ` (aura +${s.aura})` : ''}</span> ` + (s.success ? '<b class="hit">saves</b>' : `<b class="crit">${fail}</b>`);
const CONDITION_VERB = { prone: 'is knocked prone!', poisoned: 'is poisoned!', frightened: 'is frightened!', restrained: 'is caught in the web!', rotting: 'is wracked by mummy rot!' };

/** Blessed Healer's line under a healing spell, if the cleric healed too. */
const blessed = (r) => (r.selfHeal ? `<br>${who(r.caster)} is <b class="spell">Blessed Healer</b>: <b class="heal">+${r.selfHeal} HP</b>` : '');

export class Hud {
  /**
   * onChoose receives { kind: 'attack', attack } | { kind: 'spell', id } | { kind: 'action', id }
   */
  constructor({ onEndTurn, onUndo, onChoose, onRestart, onNext, onMap, onToggleSound, onToggleMusic }) {
    this.handlers = { onChoose };
    this.canUndo = false; // the controller sets it: the last move can be taken back
    $('#end-turn').addEventListener('click', onEndTurn);
    $('#undo').addEventListener('click', onUndo);
    $('#restart').addEventListener('click', onRestart);
    $('#next').addEventListener('click', onNext);
    $('#to-map').addEventListener('click', onMap);
    $('#share').addEventListener('click', () => this.share());
    $('#save-card').addEventListener('click', () => this.saveCard());
    $('#sound').addEventListener('click', onToggleSound);
    $('#music').addEventListener('click', onToggleMusic);
    $('#attacks').addEventListener('click', (ev) => this.onAbilityClick(ev));
    this.tips = new Map();
    this.abilityTip = new AbilityTip($('#attacks'), (key) => this.tips.get(key) ?? null);
    this.unitTip = new UnitTip();
    // No hover on a touch screen: tapping a tag shows its tooltip, a portrait its card.
    $('#who').addEventListener('click', (ev) => {
      const tip = ev.target.closest('[title]');
      if (this.touch && tip) this.toast(tip.title);
    });
    const chipOf = (ev) => ev.target.closest('#initiative .chip');
    $('#initiative').addEventListener('pointerover', (ev) => {
      if (ev.pointerType !== 'mouse') return;
      const chip = chipOf(ev);
      if (chip) this.showUnitTip(chip, 'below', true);
    });
    $('#initiative').addEventListener('pointerleave', (ev) => ev.pointerType === 'mouse' && this.unitTip.hide());
    $('#initiative').addEventListener('scroll', () => this.unitTip.hide(), { passive: true });
    $('#initiative').addEventListener('click', (ev) => {
      const chip = chipOf(ev);
      if (!this.touch || !chip) return;
      if (this.unitTip.key === this.tipKey(chip)) return this.unitTip.hide(); // tap again to close
      this.showUnitTip(chip, 'below', false);
    });
    document.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType !== 'mouse' && !this.unitTip.el.hidden && !$('#initiative').contains(ev.target)) this.unitTip.hide();
    });
    $('#log-toggle').addEventListener('click', () => this.toggleLog());
    $('#log-close').addEventListener('click', () => this.toggleLog(false));
    this.toastTimer = null;
    this.touch = false;
    this.logOpen = false;
  }

  tipKey(chip) {
    return `chip:${chip.dataset.unit ?? 'unknown'}`;
  }

  /** The card for a turn-order portrait (`chip`). */
  showUnitTip(chip, side, hover) {
    const u = this.game?.units.find((x) => x.id === Number(chip.dataset.unit));
    const html = () => (u ? this.unitCard(this.game, u) : this.unknownCard());
    if (hover) this.unitTip.hover(this.tipKey(chip), html, () => chip.getBoundingClientRect(), side);
    else {
      this.unitTip.key = this.tipKey(chip);
      this.unitTip.show(html, chip.getBoundingClientRect(), side);
    }
  }

  /** The card for a figure on the board under the mouse (`rect`: where it stands), or none. */
  hoverUnit(game, u, rect) {
    if (!u) return this.unitTip.key?.startsWith('fig:') && this.unitTip.hide();
    this.unitTip.hover(`fig:${u.id}`, () => this.unitCard(game, u), rect, 'beside');
  }

  /** The card for a figure, at once (a long press on a touch screen). */
  showUnitCard(game, u, rect) {
    this.unitTip.key = `fig:${u.id}`;
    this.unitTip.show(() => this.unitCard(game, u), rect, 'beside');
  }

  unknownCard() {
    return `<div class="tip-head"><b>???</b><small>Not seen yet</small></div><p class="tip-note">Something waits in the dark. You'll learn what it is when you see it.</p>`;
  }

  /** A character's card, or ??? for a monster not seen yet this fight. */
  unitCard(game, u) {
    return this.unknown?.(u) ? this.unknownCard() : unitCard(game, u);
  }

  /** The combat log as a panel of its own, for screens too narrow to keep it beside the board. */
  toggleLog(open = !this.logOpen) {
    this.logOpen = open;
    $('#app').classList.toggle('log-open', open);
    $('#log-toggle').setAttribute('aria-expanded', String(open));
    if (open) {
      $('#log-toggle').classList.remove('unread');
      const list = $('#log-list');
      list.scrollTop = list.scrollHeight; // a hidden list can't scroll, so catch up now
    }
  }

  reset() {
    $('#log-list').innerHTML = '';
    $('#banner').hidden = true;
    this.hint('');
  }

  /** Hold new log lines back (while the player's die waits, so the log doesn't tell first). */
  holdLog() {
    this.held ??= [];
  }

  /** Write the held lines, in order. */
  releaseLog() {
    const held = this.held;
    this.held = null;
    for (const [html, cls] of held ?? []) this.log(html, cls);
  }

  log(html, cls = '') {
    if (this.held) return void this.held.push([html, cls]);
    const li = document.createElement('li');
    li.className = cls;
    li.innerHTML = html;
    const list = $('#log-list');
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
    if (!this.logOpen) $('#log-toggle').classList.add('unread');
  }

  logAttack(r) {
    const outcome = r.crit
      ? `<b class="crit">Critical hit!</b>${r.attack.damage ? ` ${r.damage} damage` : ''}`
      : r.fumble
        ? `<b class="miss">Natural 1, miss.</b>`
        : r.shielded
          ? `<b class="spell">Blocked by Shield</b>`
          : r.hit
            ? r.attack.damage ? `<b class="hit">Hit</b> for ${r.damage} damage` : `<b class="hit">Hit</b>`
            : `<b class="miss">Miss</b>`;
    const dmg = r.damageRoll ? ` <span class="dice">[${r.damageRoll.rolls.join('+')}]</span>` : '';
    const d20 = r.rolls.length > 1 ? `d20 [${r.rolls.join(', ')}] → ${r.d20}` : `d20 ${r.d20}`;
    const why = r.mods.mode === 'adv'
      ? ` <span class="adv">advantage: ${esc(r.mods.adv.join(', '))}</span>`
      : r.mods.mode === 'dis'
        ? ` <span class="dis">disadvantage: ${esc(r.mods.dis.join(', '))}</span>`
        : '';
    const tag = r.opportunity ? '<b class="opp">Opportunity attack!</b><br>' : '';
    const sneak = (r.sneak ? ` incl. <b class="sneak">Sneak Attack +${r.sneak.total}</b> ${dice(r.sneak)}` : '')
      + (r.smite ? ` incl. <b class="spell">Divine Smite +${r.smite.total} radiant</b> ${dice(r.smite.roll)}${r.target.undead ? ' (undead +1d8)' : ''} <span class="dice">${ordinal(r.smite.slot)}-level slot</span>` : '')
      + (r.mark ? ` incl. <b class="spell">${r.mark.spell === 'hex' ? 'Hex' : 'Hunter’s Mark'} +${r.mark.total}</b> ${dice(r.mark)}` : '')
      + (r.colossus ? ` incl. <b class="sneak">Colossus Slayer +${r.colossus.total}</b> ${dice(r.colossus)}` : '')
      + (r.strike ? ` incl. <b class="spell">Divine Strike +${r.strike.total} radiant</b> ${dice(r.strike)}` : '')
      + (r.uncanny ? ` <b class="spell">Uncanny Dodge</b> halves it.` : '');
    this.log(
      `${tag}${who(r.attacker)} → ${who(r.target)} · ${esc(r.attack.name)}${why}<br> ` +
        `<span class="dice">${d20} ${signed(r.toHit)} = ${r.total}</span> vs AC ${r.ac}${r.cover ? ' <span class="cover">(half cover +2)</span>' : ''}. ${outcome}${dmg}${sneak}`,
    );
  }

  /** The save against an attack's rider (logged once the hit has landed). */
  logRider(r) {
    const x = r.rider;
    if (!x) return;
    if (!x.stat) { // no save against it
      this.log(`${who(r.target)} <b class="cond ${x.condition}">${CONDITION_VERB[x.condition]}</b>`);
      return;
    }
    this.log(`${who(r.target)} <span class="dice">${x.stat.toUpperCase()} save ${x.total} vs DC ${x.dc}</span>: ` +
      (x.success ? `<b class="hit">shrugs it off</b>.` : `<b class="cond ${x.condition}">${CONDITION_VERB[x.condition]}</b>`));
  }

  logStench(r) {
    this.log(`The stench of ${who(r.by)} reaches ${who(r.target)}.`);
    this.logRider(r);
  }

  logShove(r) {
    const roll = `<span class="dice">${r.roll.rolls.length > 1 ? `d20 [${r.roll.rolls.join(', ')}] → ${r.roll.d20}` : `d20 ${r.roll.d20}`} ${signed(r.roll.bonus)} = ${r.roll.total}</span>`;
    const resist = `<span class="dice">${r.resist.d20} ${signed(r.resist.bonus)} = ${r.resist.total}</span>`;
    this.log(`${who(r.attacker)} shoves ${who(r.target)}: ${roll} vs ${resist}. ` +
      (r.success ? '<b class="cond prone">Knocked prone!</b>' : '<b class="miss">It keeps its feet.</b>'));
  }

  /** A condition starts or ends. (Starting ones from riders and spells are logged with them.) */
  logCondition({ unit, name, on, cause }) {
    if (on) return;
    const text = {
      stand: `gets up off the floor (half movement).`,
      save: `shakes off the fear.`,
      expired: name === 'poisoned' ? 'is no longer poisoned.' : name === 'frightened' ? 'is no longer frightened.'
        : name === 'restrained' ? 'tears free of the web.' : name === 'rotting' ? 'is free of the rot.' : 'recovers.',
    }[cause] ?? 'recovers.';
    this.log(`${who(unit)} ${text}`, 'sys');
  }

  logMimic({ unit, mimic, chest }) {
    this.log(`${who(unit)} reaches for the chest… and it opens its mouth. <b class="crit">A ${esc(mimic.name.toLowerCase())}!</b>` +
      (chest.suspected ? '' : ' It strikes before anyone can react.'), 'death');
  }

  logRebukeArmed(unit, armed) {
    this.log(`${who(unit)} ${armed ? 'readies a <b class="spell">Hellish Rebuke</b> for the next enemy that hurts them' : 'lets the Rebuke go'}.`);
  }

  /** Dark One's Blessing: temporary HP from a kill. */
  logWard({ unit }) {
    this.log(`<b class="heal">Death Ward</b> holds: ${who(unit)} stays on their feet with 1 HP.`);
  }

  logRising({ unit, risen, glare, dc }) {
    const rose = risen.map((e) => `<span class="monsters">${esc(e.unit.name)}</span>`);
    let text = `${who(unit)} is bloodied, and his house answers: ` +
      (rose.length ? `${rose.join(' and ')} ${rose.length > 1 ? 'rise' : 'rises'}!` : 'but nothing is left to rise.');
    if (glare.length) {
      text += ` His glare sweeps the room, WIS save DC ${dc}: ` +
        glare.map((g) => saveText({ ...g, unit: g.target }, 'is frightened')).join(', ') + '.';
    }
    this.log(text, 'death');
  }

  logBlessing({ unit, tempHp }) {
    this.log(`${who(unit)} drinks in the fallen foe's life: <b class="heal">${tempHp} temporary HP</b> <span class="dice">Dark One’s Blessing</span>.`);
  }

  logSmiteArmed(unit, armed) {
    this.log(`${who(unit)} ${armed ? 'readies a <b class="spell">Divine Smite</b> for the next melee hit' : 'lets the Smite go'}.`);
  }

  logMimicFound({ unit }) {
    this.log(`${who(unit)} eyes a chest warily: <b class="opp">those aren't scratches, they're teeth marks</b>.`);
  }

  logSpell(r) {
    const slot = r.slot ? `<span class="dice">${ordinal(r.slot)}-level slot</span>` : '<span class="dice">cantrip</span>';
    const name = `<b class="spell">${esc(r.spell.name)}</b>`;
    if (r.id === 'shield') {
      this.log(`${who(r.caster)} casts ${name} as a reaction: AC +5 until the start of the next turn. ${slot}`);
    } else if (r.id === 'magicMissile') {
      this.log(`${who(r.caster)} casts ${name} at ${who(r.target)}: ${r.darts.length} darts, ` +
        `<b class="hit">${r.damage} force damage</b> <span class="dice">[${r.darts.join('+')}]</span>. ${slot}`);
    } else if (r.id === 'burningHands') {
      const saves = r.saves.length
        ? r.saves.map((s) => `${who(s.unit)} <span class="dice">DEX ${s.total}</span> ` +
            (s.success ? `saves, <b class="hit">${s.damage}</b>` : `fails, <b class="crit">${s.damage}</b>`)).join('<br>')
        : '<span class="miss">The flames catch no one.</span>';
      this.log(`${who(r.caster)} casts ${name} <span class="dice">${r.roll.total} fire [${r.roll.rolls.join('+')}], DC ${r.dc}</span>. ${slot}<br>${saves}`);
    } else if (r.id === 'fireball') {
      const saves = r.saves.length
        ? r.saves.map((s) => `${who(s.unit)} <span class="dice">DEX ${s.total}</span> ` +
            (s.success ? `saves, <b class="hit">${s.damage}</b>` : `fails, <b class="crit">${s.damage}</b>`)).join('<br>')
        : '<span class="miss">The blast catches no one.</span>';
      this.log(`${who(r.caster)} hurls a ${name} <span class="dice">${r.roll.total} fire [${r.roll.rolls.join('+')}], DC ${r.dc}</span>. ${slot}<br>${saves}`);
    } else if (r.id === 'iceStorm') {
      const saves = r.saves.length
        ? r.saves.map((s) => `${who(s.unit)} <span class="dice">DEX ${s.total}</span> ` +
            (s.success ? `saves, <b class="hit">${s.damage}</b>` : `fails, <b class="crit">${s.damage}</b>`) +
            (s.evasion ? ' <span class="dice">Evasion</span>' : '')).join('<br>')
        : '<span class="miss">The hail strikes no one.</span>';
      this.log(`${who(r.caster)} calls down an ${name} <span class="dice">${r.roll.total} hail and cold [${r.roll.rolls.join('+')}], DC ${r.dc}</span>. ${slot}<br>${saves}<br><span class="dice">The ground ices over: difficult terrain until the end of ${esc(r.caster.name)}’s next turn.</span>`);
    } else if (r.id === 'deathWard') {
      const self = r.target === r.caster ? 'themself' : who(r.target);
      this.log(`${who(r.caster)} casts ${name} on ${self}: the next blow that would drop them leaves them on 1 HP. ${slot}`);
    } else if (r.id === 'lightningBolt') {
      const saves = r.saves.length
        ? r.saves.map((s) => `${who(s.unit)} <span class="dice">DEX ${s.total}</span> ` +
            (s.success ? `saves, <b class="hit">${s.damage}</b>` : `fails, <b class="crit">${s.damage}</b>`)).join('<br>')
        : '<span class="miss">The bolt strikes no one.</span>';
      this.log(`${who(r.caster)} casts ${name} <span class="dice">${r.roll.total} lightning [${r.roll.rolls.join('+')}], DC ${r.dc}</span>. ${slot}<br>${saves}`);
    } else if (r.id === 'spiritualWeapon') {
      const d20 = `<span class="dice">d20 ${r.d20} ${signed(r.toHit)} = ${r.total}</span> vs AC ${r.ac}`;
      const outcome = r.crit ? `<b class="crit">Critical hit!</b> ${r.damage} force ${dice(r.roll)}`
        : r.hit ? `<b class="hit">Hit</b> for ${r.damage} force ${dice(r.roll)}` : '<b class="miss">Miss</b>';
      this.log(r.again
        ? `${who(r.caster)}'s ${name} swings at ${who(r.target)}: ${d20}. ${outcome}. <span class="dice">bonus action, no slot</span>`
        : `${who(r.caster)} casts ${name}: a spectral mace appears beside ${who(r.target)}. ${d20}. ${outcome}. ${slot}`);
    } else if (r.id === 'massHealingWord') {
      this.log(`${who(r.caster)} calls out a ${name}. ${slot}<br>` +
        r.heals.map((h) => `${who(h.unit)} <b class="heal">+${h.healed} HP</b> ${dice(h.roll)}`).join('<br>') + blessed(r));
    } else if (r.id === 'mistyStep') {
      this.log(`${who(r.caster)} casts ${name} and vanishes in silver mist. ${slot}`);
    } else if (r.id === 'sacredFlame') {
      const out = r.save.success ? '' : `, <b class="hit">${r.damage} radiant damage</b> ${dice(r.roll)}`;
      this.log(`${who(r.caster)} casts ${name} on ${who(r.target)}. DEX save DC ${r.dc}: ` +
        `${saveText({ ...r.save, unit: r.target })}${out}. ${slot}`);
    } else if (r.id === 'cureWounds' || r.id === 'healingWord') {
      const self = r.target === r.caster ? 'themself' : who(r.target);
      this.log(`${who(r.caster)} casts ${name} on ${self}: <b class="heal">+${r.healed} HP</b> ${dice(r.roll)}. ${slot}${blessed(r)}`);
    } else if (r.id === 'layOnHands') {
      const self = r.target === r.caster ? 'themself' : who(r.target);
      this.log(`${who(r.caster)} lays hands on ${self}: <b class="heal">+${r.healed} HP</b> <span class="dice">${r.left} left in the pool</span>.`);
    } else if (r.id === 'huntersMark') {
      this.log(`${who(r.caster)} casts ${name} on ${who(r.target)}: <b>+1d6</b> on every weapon hit against it. ${slot}`);
    } else if (r.id === 'hex') {
      this.log(`${who(r.caster)} casts ${name} on ${who(r.target)}: <b>+1d6 necrotic</b> on every hit against it. ${slot}`);
    } else if (r.id === 'scorchingRay') {
      const rays = r.rays.map((ray) => {
        const d20 = ray.rolls.length > 1 ? `d20 [${ray.rolls.join(', ')}] → ${ray.d20}` : `d20 ${ray.d20}`;
        const hex = ray.mark ? ` incl. <b class="spell">Hex +${ray.mark.total}</b>` : '';
        const out = ray.crit ? `<b class="crit">Critical hit!</b> ${ray.damage} fire${hex}`
          : ray.hit ? `<b class="hit">Hit</b> for ${ray.damage} fire${hex}` : '<b class="miss">Miss</b>';
        return `→ ${who(ray.target)} <span class="dice">${d20} ${signed(ray.toHit)} = ${ray.total}</span> vs AC ${ray.ac}${ray.cover ? ' <span class="cover">(half cover +2)</span>' : ''}. ${out}`;
      });
      this.log(`${who(r.caster)} casts ${name}: ${r.rays.length} rays of fire. ${slot}<br>${rays.join('<br>')}`);
    } else if (r.id === 'hellishRebuke') {
      this.log(`${who(r.caster)} answers with ${name}: flames engulf ${who(r.target)}. DEX save DC ${r.dc}: `
        + `${saveText({ ...r.save, unit: r.target })}, <b class="hit">${r.damage} fire</b> ${dice(r.roll)}. ${slot}`);
    } else if (r.id === 'shieldOfFaith') {
      const self = r.target === r.caster ? 'themself' : who(r.target);
      this.log(`${who(r.caster)} casts ${name} on ${self}: <b>AC +2</b> for the rest of the fight. ${slot}`);
    } else if (r.id === 'dread') {
      this.log(`${who(r.caster)} whispers ${name} at ${who(r.target)}. WIS save DC ${r.dc}: ` +
        `${saveText({ ...r.save, unit: r.target }, 'is frightened')}. ${slot}`);
    } else if (r.id === 'animateDead') {
      this.log(`${who(r.caster)} casts ${name}. The ${esc(r.corpse.cls.toLowerCase())} corpse rises as ` +
        `<span class="monsters">${esc(r.risen.name)}</span>! ${slot}`, 'death');
    }
  }

  logTrap(r) {
    this.log(`<b class="crit">A hidden trap!</b> Spikes burst from the floor under ${who(r.unit)}. ` +
      `DEX save DC ${r.dc}: ${saveText(r)}, takes <b class="hit">${r.damage} piercing</b> ${dice(r.roll)}` +
      // (logged before the damage lands: it goes down only if it survives the spikes)
      (!r.success && r.unit.hp > r.damage ? ' and is <b class="cond prone">knocked prone</b>.' : '.'));
  }

  logTrapFound({ unit }) {
    this.log(`${who(unit)} spots a <b class="opp">hidden trap</b>. Heroes will walk around it.`);
  }

  logChest({ unit, loot }) {
    const n = loot.filter((l) => l === 'potion').length;
    const parts = [
      ...(n ? [`<b class="heal">${n} potion${n > 1 ? 's' : ''} of healing</b>`] : []),
      ...loot.filter((l) => l !== 'potion').map((l) => `<b class="loot">${esc(ITEMS[l].name)}</b> (into the pack)`),
    ];
    this.log(`${who(unit)} opens the chest: ${parts.length ? `${parts.join(' and ')}.` : 'it is empty.'}`);
  }

  logAction(r) {
    const text = {
      dash: 'Dashes, doubling movement this turn.',
      dodge: 'takes the Dodge action. Attacks against it have disadvantage.',
      disengage: 'Disengages. Moving won’t provoke opportunity attacks.',
      nimbleEscape: 'uses <b>Nimble Escape</b> to slip away.',
      secondWind: `uses <b>Second Wind</b> and regains <b class="heal">${r.healed} HP</b> ${r.roll && dice(r.roll)}.`,
      cunningDash: 'uses <b>Cunning Action</b> to Dash.',
      cunningDisengage: 'uses <b>Cunning Action</b> to Disengage.',
      hide: `slips into the shadows: <b>Stealth ${r.total}</b> ${stealthRoll(r)}.`,
      cunningHide: `uses <b>Cunning Action</b> to Hide: <b>Stealth ${r.total}</b> ${stealthRoll(r)}.`,
      nimbleHide: 'ducks out of sight (<b>Nimble Escape</b>) and hides.',
      aggressive: 'roars and charges (<b>Aggressive</b>).',
      search: !r.checks?.length
        ? 'searches the shadows but finds nothing.'
        : 'searches the shadows: ' + r.checks.map((c) =>
          // A hero's Stealth roll is shown; a goblin's stays secret.
          `<b>Perception ${c.total}</b> <span class="dice">d20 ${c.d20} ${signed(c.bonus)}</span> vs <span class="${c.unit.team}">${esc(c.unit.name)}</span>${c.unit.team === 'heroes' ? `’s Stealth ${c.dc}` : ''}${c.success ? ': found' : ', misses'}`,
        ).join('; ') + '.',
      potion: `drinks a <b>potion of healing</b>: <b class="heal">+${r.healed} HP</b> ${r.roll && dice(r.roll)}.`,
      turnUndead: `presents a holy symbol: <b class="spell">Turn Undead</b> (WIS save DC ${r.dc})<br>` +
        (r.saves ?? []).map((s) => saveText(s, s.destroyed ? 'is destroyed' : 'is turned and flees')).join('<br>'),
    }[r.id];
    this.log(`${who(r.unit)} ${text ?? `uses ${esc(r.name)}.`}`);
  }

  renderInitiative(game) {
    this.game = game;
    this.unitTip.refresh();
    $('#initiative').innerHTML = game.order
      .map((u) => {
        const cls = ['chip', u.team, u === game.current ? 'current' : '', u.alive ? '' : 'dead'].join(' ');
        const pct = Math.max(0, (u.hp / u.maxHp) * 100);
        if (this.unknown?.(u)) {
          return `<div class="${cls} unknown" aria-label="Something you haven't seen yet">
            <span class="pic">${unknownIcon()}<b class="init">?</b></span><span class="nm">???</span><span class="mini"><i style="width:100%"></i></span>
          </div>`;
        }
        const color = `#${(u.color ?? 0x777777).toString(16).padStart(6, '0')}`;
        return `<div class="${cls}" data-unit="${u.id}" aria-label="${esc(u.name)} (${esc(u.cls)}) · initiative ${u.initiative}">
          <span class="pic" style="--c:${color}">${unitIcon(u)}<b class="init">${u.initiative}</b></span>
          <span class="nm">${chipName(u.name)}</span>
          <span class="mini"><i style="width:${pct}%"></i></span>
        </div>`;
      })
      .join('');
    // Long fights overflow the bar: keep whoever is acting in view.
    const bar = $('#initiative');
    const cur = bar.querySelector('.current');
    if (cur) bar.scrollLeft = cur.offsetLeft - bar.clientWidth / 2 + cur.clientWidth / 2;
  }

  renderActionBar(game, { selected, busy }) {
    const u = game.current;
    if (!u) return;
    const mine = u.team === 'heroes' && !game.over;
    if (!mine && !game.over && this.hidden?.(u)) {
      this.setHtml($('#who'), `<div class="who-name monsters">${this.unknown?.(u) ? '???' : esc(u.name)} <small>out of sight</small></div>
        <div class="stats"><span>Somewhere in the dark…</span></div>`);
      $('#end-turn').disabled = true;
      $('#undo').hidden = true;
      this.setHtml($('#attacks'), '<span class="waiting">Something moves in the dark…</span>');
      this.tips.clear();
      this.abilityTip.hide();
      return;
    }
    const pip = (label, used) => `<span class="pip ${used ? 'used' : 'ready'}">${label}</span>`;
    const conds = Object.keys(u.conditions ?? {});
    const slots = Object.entries(u.slots)
      .filter(([l, n]) => n > 0 || (u.slotMax?.[l] ?? 0) > 0) // a warlock's old 2nd-level slots are gone at 5
      .map(([l, n]) => `<span class="slots" title="${ordinal(+l)}-level spell slots">${ordinal(+l)} ${'◆'.repeat(n)}<s>${'◇'.repeat(Math.max(0, (u.slotMax?.[l] ?? n) - n))}</s></span>`)
      .join('');
    this.setHtml($('#who'), `
      <div class="who-name ${u.team}">${esc(u.name)} <small>${esc(u.cls)}${u.team === 'heroes' ? ` · Lv ${u.level}` : ''}</small></div>
      <div class="stats">
        <span>HP <b>${u.hp}</b>/${u.maxHp}${u.tempHp > 0 ? ` <b class="temp-hp" title="Temporary HP: lost before your hit points">+${u.tempHp}</b>` : ''}</span>
        <span>AC <b>${game.acOf(u)}</b></span>
        <span>Move <b>${u.movesLeft * 5}</b> ft</span>
        ${u.team === 'heroes' ? `<span title="Potions of healing">Potions <b>${u.potions}</b></span>` : ''}
      </div>
      ${u.passives.length || u.items?.length || conds.length || u.marked ? `<div class="passives">${u.faithFrom ? `<span class="passive-tag item" title="${esc(SPELLS.shieldOfFaith.desc)}">Shield of Faith</span>` : ''}${u.marked ? `<span class="passive-tag cond" title="${esc(SPELLS[markOf(u)].desc)}">${esc(SPELLS[markOf(u)].name)}</span>` : ''}${conds.map((c) =>
        `<span class="passive-tag cond ${c}" title="${esc(CONDITION_INFO[c])}">${esc(c[0].toUpperCase() + c.slice(1))}</span>`).join('')}${u.passives.map((p) =>
        `<span class="passive-tag" title="${esc(PASSIVES[p])}">${esc(PASSIVES[p].split(':')[0])}</span>`).join('')}${(u.items ?? []).map((i) =>
        `<span class="passive-tag item" title="${esc(ITEMS[i].desc)}">${esc(ITEMS[i].name)}</span>`).join('')}</div>` : ''}
      <div class="economy">
        ${pip(u.actionUsed && u.attacksLeft > 0 ? `Attack ×${u.attacksLeft}` : 'Action', u.actionUsed && !u.attacksLeft)}${pip('Bonus', u.bonusUsed)}${pip('Reaction', u.reactionUsed)}${slots}
      </div>`);

    $('#end-turn').disabled = !mine || busy;
    $('#undo').hidden = !mine || busy || !this.canUndo;
    // Rendered as a string and only written when it changes: hover refreshes call this
    // constantly, and replacing buttons mid-click would swallow the click.
    if (!mine) this.tips.clear();
    this.setHtml($('#attacks'), mine ? this.abilityButtons(game, u, selected, busy)
      : game.over ? '' : `<span class="waiting">${esc(u.name)} ${u.unaware ? "hasn't noticed you yet…" : 'is acting…'}</span>`);
    this.abilityTip.refresh();
    // On a phone the row scrolls sideways: keep the chosen attack or spell in view.
    const chosen = $('#attacks .selected');
    if (chosen) chosen.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  setHtml(el, html) {
    if (el.dataset.html === html) return;
    el.dataset.html = html;
    el.innerHTML = html;
  }

  abilityButtons(game, u, selected, busy) {
    this.current = u;
    this.tips.clear();
    const button = ({ kind, id, name, sub, tip, problem, disabled, active, cls = '' }) => {
      const key = `${kind}:${id}`;
      this.tips.set(key, tipCard({ name, ...tip, problem }));
      const plain = [tip.desc, problem].filter(Boolean).join(' ');
      return `<button type="button" class="ability ${cls} ${active ? 'selected' : ''}" data-kind="${kind}" data-id="${id}"
        data-tip="${esc(key)}" aria-description="${esc(plain)}" ${disabled || busy ? 'disabled' : ''}><span>${esc(name)}</span><small>${sub}</small></button>`;
    };
    const group = (label, buttons) =>
      `<div class="group"><span class="group-label">${label}</span><div class="buttons">${buttons.join('')}</div></div>`;
    const attackWhy = game.canAttack(u) ? null : 'No attacks left this turn.';

    const atks = u.attacks.map((atk, i) => button({
      kind: 'attack', id: i, name: atk.name,
      sub: `${signed(game.toHitBonus(u, atk))} · ${atk.damage} · ${atk.reach * 5} ft`,
      tip: this.attackTip(game, u, atk),
      problem: attackWhy,
      disabled: !!attackWhy,
      active: selected?.kind === 'attack' && selected.attack === atk,
    }));
    if (u.passives.includes('divineSmite')) {
      const problem = game.smiteProblem(u);
      const slot = Object.keys(u.slots).map(Number).sort((a, b) => a - b).find((l) => u.slots[l] > 0);
      atks.push(button({
        kind: 'smite', id: 'smite', name: u.smiteArmed ? 'Smite armed' : 'Divine Smite', cls: `spell ${u.smiteArmed ? 'armed' : ''}`,
        sub: u.smiteArmed ? 'next melee hit · click to cancel' : `+${Math.min(5, 1 + (slot ?? 1))}d8 · spends a slot`,
        tip: {
          kind: 'Paladin feature · free, no action',
          chips: [`+${Math.min(5, 1 + (slot ?? 1))}d8 radiant`, 'melee hits'],
          desc: PASSIVES.divineSmite.replace(/^Divine Smite: /, ''),
          note: u.smiteArmed ? 'Armed: your next melee hit spends the slot. Press again to cancel.' : null,
        },
        problem: problem && `${problem}.`,
        disabled: !!problem,
        active: u.smiteArmed,
      }));
    }
    if (u.passives.includes('hellishRebuke')) {
      const problem = game.rebukeProblem(u);
      const slot = Object.keys(u.slots).map(Number).sort((a, b) => a - b).find((l) => u.slots[l] > 0) ?? 2;
      atks.push(button({
        kind: 'rebuke', id: 'rebuke', name: u.rebukeArmed ? 'Rebuke armed' : 'Hellish Rebuke', cls: `spell ${u.rebukeArmed ? 'armed' : ''}`,
        sub: u.rebukeArmed ? 'next foe to hurt you · click to cancel' : `${1 + slot}d10 fire · spends a slot`,
        tip: {
          kind: 'Warlock spell · reaction, armed ahead',
          chips: [`${1 + slot}d10 fire`, 'DEX save for half', 'range 60 ft'],
          desc: SPELLS.hellishRebuke.desc,
          note: u.rebukeArmed ? 'Armed: the next enemy that damages you with an attack burns. Press again to cancel.' : null,
        },
        problem: problem && `${problem}.`,
        disabled: !!problem,
        active: u.rebukeArmed,
      }));
    }
    atks.push(button({
      kind: 'shove', id: 'shove', name: SHOVE.name, cls: 'act',
      sub: `${signed(game.shoveBonus(u))} · knock prone · 5 ft`,
      tip: { kind: 'Takes one attack', chips: [`${signed(game.shoveBonus(u))} Athletics`, '5 ft'], desc: SHOVE.desc, how: this.howTo('an enemy') },
      problem: attackWhy,
      disabled: !!attackWhy,
      active: selected?.kind === 'shove',
    }));

    const spells = u.spells.map((id) => {
      const s = SPELLS[id];
      if (s.time === 'reaction') {
        const ready = game.canShield(u);
        return button({ kind: 'none', id, name: s.name, sub: ready ? 'auto reaction' : 'unavailable',
          tip: { kind: `${spellLevel(s)} · reaction`, chips: ['+5 AC'], desc: s.desc,
            note: ready ? 'Ready: it casts itself when a hit would land.' : null },
          problem: ready ? null : 'No reaction or 1st-level slot left.',
          disabled: true, cls: `passive ${ready ? 'armed' : ''}` });
      }
      const problem = game.spellProblem(u, id);
      return button({
        kind: 'spell', id, name: s.name, cls: 'spell',
        sub: s.pool ? `${u.layOnHands}/${u.layOnHandsMax} HP left · action`
          : id === 'spiritualWeapon' && u.spiritWeapon ? 'strike again · bonus' : `${s.level ? ordinal(castLevel(s, u)) : 'cantrip'} · ${s.time === 'bonus' ? 'bonus' : 'action'}`,
        tip: {
          kind: `${spellLevel(s)} · ${s.time === 'bonus' ? 'bonus action' : 'action'}`,
          chips: spellChips(s, u),
          desc: s.desc,
          how: s.targeting === 'enemy' || s.targeting === 'cone' ? this.howTo(s.targeting === 'cone' ? 'where to aim' : 'an enemy')
            : s.targeting === 'ally' ? this.howTo('an ally (or yourself)') : s.targeting === 'tile' ? this.howTo('a spot') : null,
        },
        problem: problem && `${problem}.`,
        disabled: !!problem,
        active: selected?.kind === 'spell' && selected.id === id,
      });
    });

    const acts = game.actionsFor(u).map((id) => {
      const a = ACTIONS[id];
      const problem = game.actionProblem(u, id);
      return button({
        kind: 'action', id, name: a.name, cls: a.time === 'bonus' ? 'bonus' : 'act',
        sub: (a.time === 'bonus' ? 'bonus' : 'action') + (id === 'potion' ? ` · ${u.potions} left` : ''),
        tip: {
          kind: `${a.time === 'bonus' ? 'Bonus action' : 'Action'}${a.feature ? ' · class feature' : ''}`,
          chips: [id === 'potion' ? `${u.potions} left` : null, a.range ? `${a.range * 5} ft` : null].filter(Boolean),
          desc: a.desc,
        },
        problem: problem && `${problem}.`,
        disabled: !!problem,
      });
    });

    return group('Attack', atks) + (spells.length ? group('Spells', spells) : '') + group('Actions', acts);
  }

  /** How to use a targeted ability, for a mouse or a finger. */
  howTo(what) {
    return this.touch ? `Tap it, then tap ${what}.` : `Click it, then click ${what}.`;
  }

  /** The card for one of a unit's attacks: its numbers and the rules that touch it. */
  attackTip(game, u, atk) {
    const weapon = isWeapon(atk);
    const melee = atk.reach === 1;
    const bonus = game.damageBonus(u, atk);
    const notes = [];
    if (melee) notes.push('Advantage when an ally stands on the far side of the target (flanking).');
    else notes.push('Disadvantage while an enemy is next to you.');
    if (u.passives.includes('extraAttack') && weapon) notes.push('Extra Attack: the Attack action gives you two attacks.');
    if (u.passives.includes('sneakAttack')) {
      notes.push(`Sneak Attack: +${u.sneakDice ?? 2}d6 once a turn with advantage, or with an ally next to the target.${u.sneakUsed ? ' Used this turn.' : ''}`);
    }
    if (u.passives.includes('colossusSlayer') && weapon) notes.push(`Colossus Slayer: +1d8 once a turn on a foe that is already hurt.${u.colossusUsed ? ' Used this turn.' : ''}`);
    if (u.smiteArmed && isMelee(atk)) notes.push('Divine Smite is armed: a hit spends a slot for extra radiant damage.');
    if (atk.addMod === false) notes.push('A cantrip: no slot needed, and no ability bonus to damage.');
    if (!weapon && atk.addMod !== false) notes.push(`A cantrip: no slot needed. Agonizing Blast adds your ${atk.stat.toUpperCase()} to the damage.`);
    if (u.extraAttackWith === atk.name) notes.push('Two beams: the Attack action fires it twice, at one foe or two.');
    if (u.mark?.spell === 'hex') notes.push('Hex: +1d6 necrotic on every hit against the cursed foe.');
    if (weapon && u.weaponBonus) notes.push(`Runed Weapon: +${u.weaponBonus} to hit and damage, included above.`);
    if (weapon && u.strDamage && atk.stat === 'str') notes.push('Gauntlets of Ogre Power: +1 damage, included above.');
    return {
      kind: weapon ? `${melee ? 'Melee' : 'Ranged'} weapon · ${atk.stat === 'str' ? 'Strength' : 'Dexterity'}`
        : `Cantrip · ranged spell attack`,
      chips: [`${signed(game.toHitBonus(u, atk))} to hit`, `${atk.damage}${bonus ? signed(bonus) : ''} damage`,
        melee ? 'reach 5 ft' : `range ${atk.reach * 5} ft`],
      desc: notes.shift(),
      notes,
      how: this.touch ? 'Tap it, then tap an enemy (or tap an enemy for your best weapon).'
        : 'Click it, then click an enemy (or click an enemy for your best weapon).',
    };
  }

  onAbilityClick(ev) {
    const b = ev.target.closest('button.ability');
    if (!b || b.disabled) return;
    const { kind, id } = b.dataset;
    if (kind === 'attack') this.handlers.onChoose({ kind, attack: this.current.attacks[Number(id)] });
    else if (kind === 'shove' || kind === 'smite' || kind === 'rebuke') this.handlers.onChoose({ kind });
    else if (kind === 'spell' || kind === 'action') this.handlers.onChoose({ kind, id });
  }

  setMusic(on) {
    const b = $('#music');
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('off', !on);
  }

  setSound(on) {
    const b = $('#sound');
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('off', !on);
    b.querySelector('span').textContent = on ? 'Sound' : 'Muted';
  }

  /**
   * The line above the action bar. `act`: it previews something a click would do; on a
   * touch screen that takes a second tap, so the hint says so.
   */
  hint(text, act = false) {
    if (this.touch && text) {
      text = text.replace(/\bclick\b/g, 'tap').replace(/\bClick\b/g, 'Tap').replace(/ with the mouse/g, '').replace(' · Esc to cancel', '');
      if (act) text += ' · tap again to confirm';
    }
    $('#hint').textContent = text;
    $('#hint').classList.toggle('show', !!text);
  }

  /** A short note under the top bar. kind 'news' (good news, in gold) or a warning. */
  toast(text, kind) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.toggle('news', kind === 'news');
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), Math.max(2200, text.length * 55));
  }

  /** End-of-fight banner. `final`: the last room of the campaign. */
  banner(result, { round, level, final, xp, outro = '', longRest = false, summary = null, awards = [], daily = null, share = null, recap = null, win = null, replay = false }) {
    this.renderSummary(summary);
    this.renderRecap(recap, win);
    this.cardSummary = summary;
    $('#save-card').hidden = !summary;
    $('#save-card').textContent = 'Save image';
    $('#watch').hidden = !replay;
    this.renderAwards(awards);
    const rounds = `${round} round${round === 1 ? '' : 's'}`;
    const won = result === 'victory';
    const rest = longRest
      ? 'takes a long rest before going deeper (full HP and spell slots)'
      : 'catches its breath (short rest: regain half your missing HP)';
    $('#banner-title').textContent = won ? (final ? 'Victory' : 'Room cleared') : 'Defeat';
    $('#banner-text').textContent = won
      ? final
        ? summary ? outro : `${outro} Won after ${rounds}. Well fought! (+${xp} XP)`
        : `${level} is quiet after ${rounds}. The party shares ${xp} XP and ${rest}.`
      : `Your party has fallen in ${level}. Try the room again as you entered it, or go back to the map and pick another way.`;
    $('#next').hidden = !won || final;
    $('#to-map').hidden = won;
    $('#restart').textContent = won ? 'New campaign' : 'Try again';
    $('#restart').hidden = won && !final;
    $('#to-map').textContent = 'Back to the map';
    this.setShare(share);
    if (daily) this.dailyBanner(daily, level);
    $('#banner').dataset.result = result;
    $('#banner').hidden = false;
  }

  /** The daily crypt's ending: the result, the day's best and the streak; try again or leave. */
  dailyBanner(d, level) {
    const rounds = (n) => `${n} round${n === 1 ? '' : 's'}`;
    const fell = (n) => (n === 0 ? 'nobody fell' : `${n} hero${n === 1 ? '' : 'es'} fell`);
    const best = d.best.won ? `won in ${rounds(d.best.rounds)}, ${fell(d.best.downed)}` : 'not won yet';
    $('#banner-title').textContent = d.won ? 'Daily crypt won' : 'Defeat';
    $('#banner-text').textContent = (d.won
      ? `${level} is quiet after ${rounds(d.rounds)}, and ${fell(d.downed)}.`
      : `Your party has fallen in ${level}. Today’s crypt can be tried as often as you like.`)
      + ` Best today: ${best} (try ${d.best.tries}).`
      + (d.streak > 0 ? ` Streak: ${d.streak} day${d.streak === 1 ? '' : 's'}.` : '');
    $('#next').hidden = true;
    $('#restart').hidden = false;
    $('#restart').textContent = 'Try again';
    $('#to-map').hidden = false;
    $('#to-map').textContent = 'Back to the title';
    this.setShare(d.share);
  }

  /** The banner's Copy result button, for a won daily or campaign. */
  setShare(text) {
    this.shareText = text || null;
    $('#share').hidden = !this.shareText;
    $('#share').textContent = 'Copy result';
  }

  /** Copy the won daily's text, or hand it to the phone's share sheet. */
  async share() {
    const text = this.shareText;
    if (!text) return;
    const btn = $('#share');
    try {
      if (this.touch && navigator.share) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy result'; }, 2000);
    } catch (err) {
      if (err?.name === 'AbortError') return; // the share sheet was closed
      this.toast('Couldn’t copy the result here.');
    }
  }

  /** The won campaign as a picture (see runCard.js): a download, or the share sheet on a phone. */
  async saveCard() {
    if (!this.cardSummary) return;
    const btn = $('#save-card');
    btn.disabled = true;
    try {
      const done = await saveRunCard(this.cardSummary, { touch: this.touch });
      if (done !== 'cancelled') {
        btn.textContent = done === 'shared' ? 'Shared' : 'Saved';
        setTimeout(() => { btn.textContent = 'Save image'; }, 2000);
      }
    } catch {
      this.toast('Couldn’t save the image here.');
    } finally {
      btn.disabled = false;
    }
  }

  /**
   * The fight in a few lines (see game/recap.js). Lost: how each hero fell, then the foes.
   * Won: who led the way, the closest call, who fell and the potions drunk.
   */
  renderRecap(recap, win = null) {
    const el = $('#banner-recap');
    el.classList.toggle('won', !!win);
    if (win) {
      const lines = [['recap-best', win.best], ['recap-closest', win.closest], ['recap-fell', win.fell], ['recap-potions', win.potions]].filter(([, l]) => l);
      el.hidden = false;
      el.innerHTML = `<h2>How it went</h2>${lines.map(([cls, l]) => `<p class="${cls}">${esc(l)}</p>`).join('')}`;
      return;
    }
    const lines = recap ? [['recap-worst', recap.worst], ['recap-left', recap.left]].filter(([, l]) => l) : [];
    el.hidden = !recap || (!recap.falls.length && !lines.length);
    el.innerHTML = el.hidden ? '' : `<h2>How it went</h2>`
      + (recap.falls.length ? `<ol>${recap.falls.map((f) => `<li>${esc(f)}</li>`).join('')}</ol>` : '')
      + lines.map(([cls, l]) => `<p class="${cls}">${esc(l)}</p>`).join('')
      + (recap.tip ? `<p class="recap-tip"><b>Next time:</b> ${esc(recap.tip)}</p>` : '');
  }

  /** Achievements this fight unlocked, as gold chips under the banner text. */
  renderAwards(awards) {
    const el = $('#banner-awards');
    el.hidden = awards.length === 0;
    el.innerHTML = awards.map((a) => `<li title="${esc(a.desc)}"><span class="award-mark" aria-hidden="true">★</span>`
      + `<span><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></span></li>`).join('');
    el.setAttribute('aria-label', `Achievement${awards.length === 1 ? '' : 's'} unlocked`);
  }

  /** The run's ending: totals, then a row per hero with the column leaders in gold. */
  renderSummary(s) {
    const el = $('#banner-stats');
    $('#banner').classList.toggle('ending', !!s);
    el.hidden = !s;
    if (!s) {
      el.innerHTML = '';
      return;
    }
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const facts = [
      ['Difficulty', s.difficulty],
      ['Party level', s.level],
      ['Rooms won', s.won],
      ['Rounds', s.rounds],
      ['Fights lost', s.lost || 'None'],
      ['XP', s.xp],
    ];
    const cols = [
      ['damage', 'Damage'],
      ['kills', 'Kills'],
      ['crits', 'Crits'],
      ['healing', 'Healing'],
      ['downed', 'Downed'],
    ];
    const cell = (h, f) => `<td class="${h.best.includes(f) ? 'best' : ''}">${h[f]}</td>`;
    const top = (f) => s.heroes.filter((h) => h.best.includes(f)).map((h) => esc(h.name)).join(' & ');
    const honours = [
      top('damage') && `<b>${top('damage')}</b> dealt the most damage`,
      top('healing') && `<b>${top('healing')}</b> kept everyone standing`,
    ].filter(Boolean);
    const closing = s.heroes.every((h) => h.downed === 0) ? 'Nobody fell. Not once.'
      : !s.lost ? 'Not a single fight lost.'
        : `${plural(s.lost, 'fight')} lost along the way, but the crypt is quiet at last.`;
    el.innerHTML = `
      <dl class="run-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <table class="run-heroes">
        <thead><tr><th>Hero</th>${cols.map(([, label]) => `<th>${label}</th>`).join('')}</tr></thead>
        <tbody>${s.heroes.map((h) => `<tr>
          <th scope="row"><b>${esc(h.name)}</b><small>${esc(h.cls)} · <span class="nowrap">Lv ${h.level}</span></small></th>
          ${cols.map(([f]) => cell(h, f)).join('')}
        </tr>`).join('')}</tbody>
      </table>
      <p class="run-honours">${[...honours, closing].join(' · ')}</p>`;
  }

  /** Level title card in the log. */
  levelIntro({ name, intro }, partyLevel) {
    this.log(`<b class="level">${esc(name)}</b> <span class="dice">party level ${partyLevel}</span><br>${esc(intro)}`, 'sys');
  }
}
