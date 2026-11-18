// HTML overlay: initiative tracker, action bar, combat log, banners.

import { signed } from '../game/dice.js';
import { ACTIONS, SPELLS, PASSIVES } from '../game/abilities.js';
import { ITEMS } from '../game/items.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const who = (u) => `<span class="${u.team}">${esc(u.name)}</span>`;
const ordinal = (n) => ['', '1st', '2nd', '3rd'][n] ?? `${n}th`;
const dice = (roll) => `<span class="dice">[${roll.rolls.join('+')}${roll.bonus ? ` ${signed(roll.bonus)}` : ''}]</span>`;
const saveText = (s, fail = 'fails') =>
  `${who(s.unit)} <span class="dice">${s.total}</span> ` + (s.success ? '<b class="hit">saves</b>' : `<b class="crit">${fail}</b>`);

export class Hud {
  /**
   * onChoose receives { kind: 'attack', attack } | { kind: 'spell', id } | { kind: 'action', id }
   */
  constructor({ onEndTurn, onChoose, onRestart, onNext, onMap, onToggleSound }) {
    this.handlers = { onChoose };
    $('#end-turn').addEventListener('click', onEndTurn);
    $('#restart').addEventListener('click', onRestart);
    $('#next').addEventListener('click', onNext);
    $('#to-map').addEventListener('click', onMap);
    $('#sound').addEventListener('click', onToggleSound);
    $('#attacks').addEventListener('click', (ev) => this.onAbilityClick(ev));
    this.toastTimer = null;
  }

  reset() {
    $('#log-list').innerHTML = '';
    $('#banner').hidden = true;
    this.hint('');
  }

  log(html, cls = '') {
    const li = document.createElement('li');
    li.className = cls;
    li.innerHTML = html;
    const list = $('#log-list');
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
  }

  logAttack(r) {
    const outcome = r.crit
      ? `<b class="crit">Critical hit!</b> ${r.damage} damage`
      : r.fumble
        ? `<b class="miss">Natural 1, miss.</b>`
        : r.shielded
          ? `<b class="spell">Blocked by Shield</b>`
          : r.hit
            ? `<b class="hit">Hit</b> for ${r.damage} damage`
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
      + (r.uncanny ? ` <b class="spell">Uncanny Dodge</b> halves it.` : '');
    this.log(
      `${tag}${who(r.attacker)} → ${who(r.target)} · ${esc(r.attack.name)}${why}<br> ` +
        `<span class="dice">${d20} ${signed(r.toHit)} = ${r.total}</span> vs AC ${r.ac}. ${outcome}${dmg}${sneak}`,
    );
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
    } else if (r.id === 'massHealingWord') {
      this.log(`${who(r.caster)} calls out a ${name}. ${slot}<br>` +
        r.heals.map((h) => `${who(h.unit)} <b class="heal">+${h.healed} HP</b> ${dice(h.roll)}`).join('<br>'));
    } else if (r.id === 'mistyStep') {
      this.log(`${who(r.caster)} casts ${name} and vanishes in silver mist. ${slot}`);
    } else if (r.id === 'sacredFlame') {
      const out = r.save.success ? '' : `, <b class="hit">${r.damage} radiant damage</b> ${dice(r.roll)}`;
      this.log(`${who(r.caster)} casts ${name} on ${who(r.target)}. DEX save DC ${r.dc}: ` +
        `${saveText({ ...r.save, unit: r.target })}${out}. ${slot}`);
    } else if (r.id === 'cureWounds' || r.id === 'healingWord') {
      const self = r.target === r.caster ? 'themself' : who(r.target);
      this.log(`${who(r.caster)} casts ${name} on ${self}: <b class="heal">+${r.healed} HP</b> ${dice(r.roll)}. ${slot}`);
    } else if (r.id === 'animateDead') {
      this.log(`${who(r.caster)} casts ${name}. The ${esc(r.corpse.cls.toLowerCase())} corpse rises as ` +
        `<span class="monsters">${esc(r.risen.name)}</span>! ${slot}`, 'death');
    }
  }

  logTrap(r) {
    this.log(`<b class="crit">A hidden trap!</b> Spikes burst from the floor under ${who(r.unit)}. ` +
      `DEX save DC ${r.dc}: ${saveText(r)}, takes <b class="hit">${r.damage} piercing</b> ${dice(r.roll)}.`);
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
      aggressive: 'roars and charges (<b>Aggressive</b>).',
      potion: `drinks a <b>potion of healing</b>: <b class="heal">+${r.healed} HP</b> ${r.roll && dice(r.roll)}.`,
      turnUndead: `presents a holy symbol: <b class="spell">Turn Undead</b> (WIS save DC ${r.dc})<br>` +
        (r.saves ?? []).map((s) => saveText(s, s.destroyed ? 'is destroyed' : 'is turned and flees')).join('<br>'),
    }[r.id];
    this.log(`${who(r.unit)} ${text ?? `uses ${esc(r.name)}.`}`);
  }

  renderInitiative(game) {
    $('#initiative').innerHTML = game.order
      .map((u) => {
        const cls = ['chip', u.team, u === game.current ? 'current' : '', u.alive ? '' : 'dead'].join(' ');
        const pct = Math.max(0, (u.hp / u.maxHp) * 100);
        if (this.unknown?.(u)) {
          return `<div class="${cls} unknown" title="Something you haven't seen yet">
            <span class="init">?</span><span class="nm">???</span><span class="mini"><i style="width:100%"></i></span>
          </div>`;
        }
        return `<div class="${cls}" title="Initiative ${u.initiative}">
          <span class="init">${u.initiative}</span>
          <span class="nm">${esc(u.name)}</span>
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
      this.setHtml($('#attacks'), '<span class="waiting">Something moves in the dark…</span>');
      return;
    }
    const pip = (label, used) => `<span class="pip ${used ? 'used' : 'ready'}">${label}</span>`;
    const slots = Object.entries(u.slots)
      .map(([l, n]) => `<span class="slots" title="${ordinal(+l)}-level spell slots">${ordinal(+l)} ${'◆'.repeat(n)}<s>${'◇'.repeat(Math.max(0, (u.slotMax?.[l] ?? n) - n))}</s></span>`)
      .join('');
    this.setHtml($('#who'), `
      <div class="who-name ${u.team}">${esc(u.name)} <small>${esc(u.cls)}${u.team === 'heroes' ? ` · Lv ${u.level}` : ''}</small></div>
      <div class="stats">
        <span>HP <b>${u.hp}</b>/${u.maxHp}</span>
        <span>AC <b>${game.acOf(u)}</b></span>
        <span>Move <b>${u.movesLeft * 5}</b> ft</span>
        ${u.team === 'heroes' ? `<span title="Potions of healing">Potions <b>${u.potions}</b></span>` : ''}
      </div>
      ${u.passives.length || u.items?.length ? `<div class="passives">${u.passives.map((p) =>
        `<span class="passive-tag" title="${esc(PASSIVES[p])}">${esc(PASSIVES[p].split(':')[0])}</span>`).join('')}${(u.items ?? []).map((i) =>
        `<span class="passive-tag item" title="${esc(ITEMS[i].desc)}">${esc(ITEMS[i].name)}</span>`).join('')}</div>` : ''}
      <div class="economy">
        ${pip(u.actionUsed && u.attacksLeft > 0 ? `Attack ×${u.attacksLeft}` : 'Action', u.actionUsed && !u.attacksLeft)}${pip('Bonus', u.bonusUsed)}${pip('Reaction', u.reactionUsed)}${slots}
      </div>`);

    $('#end-turn').disabled = !mine || busy;
    // Rendered as a string and only written when it changes: hover refreshes call this
    // constantly, and replacing buttons mid-click would swallow the click.
    this.setHtml($('#attacks'), mine ? this.abilityButtons(game, u, selected, busy)
      : game.over ? '' : `<span class="waiting">${esc(u.name)} ${u.unaware ? "hasn't noticed you yet…" : 'is acting…'}</span>`);
  }

  setHtml(el, html) {
    if (el.dataset.html === html) return;
    el.dataset.html = html;
    el.innerHTML = html;
  }

  abilityButtons(game, u, selected, busy) {
    this.current = u;
    const button = ({ kind, id, name, sub, title = '', disabled, active, cls = '' }) =>
      `<button type="button" class="ability ${cls} ${active ? 'selected' : ''}" data-kind="${kind}" data-id="${id}"
        title="${esc(title)}" ${disabled || busy ? 'disabled' : ''}><span>${esc(name)}</span><small>${sub}</small></button>`;
    const group = (label, buttons) =>
      `<div class="group"><span class="group-label">${label}</span><div class="buttons">${buttons.join('')}</div></div>`;

    const atks = u.attacks.map((atk, i) => button({
      kind: 'attack', id: i, name: atk.name,
      sub: `${signed(game.toHitBonus(u, atk))} · ${atk.damage} · ${atk.reach * 5} ft`,
      title: 'Select, then click an enemy (or just click an enemy to use the best weapon)',
      disabled: !game.canAttack(u),
      active: selected?.kind === 'attack' && selected.attack === atk,
    }));

    const spells = u.spells.map((id) => {
      const s = SPELLS[id];
      if (s.time === 'reaction') {
        const ready = game.canShield(u);
        return button({ kind: 'none', id, name: s.name, sub: ready ? 'auto reaction' : 'unavailable',
          title: s.desc, disabled: true, cls: `passive ${ready ? 'armed' : ''}` });
      }
      const problem = game.spellProblem(u, id);
      return button({
        kind: 'spell', id, name: s.name, cls: 'spell',
        sub: `${s.level ? ordinal(s.level) : 'cantrip'} · ${s.time === 'bonus' ? 'bonus' : 'action'}`,
        title: problem ? `${s.desc}\n(${problem})` : s.desc,
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
        title: problem ? `${a.desc}\n(${problem})` : a.desc,
        disabled: !!problem,
      });
    });

    return group('Attack', atks) + (spells.length ? group('Spells', spells) : '') + group('Actions', acts);
  }

  onAbilityClick(ev) {
    const b = ev.target.closest('button.ability');
    if (!b || b.disabled) return;
    const { kind, id } = b.dataset;
    if (kind === 'attack') this.handlers.onChoose({ kind, attack: this.current.attacks[Number(id)] });
    else if (kind === 'spell' || kind === 'action') this.handlers.onChoose({ kind, id });
  }

  setSound(on) {
    const b = $('#sound');
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('off', !on);
    b.querySelector('span').textContent = on ? 'Sound' : 'Muted';
  }

  hint(text) {
    $('#hint').textContent = text;
    $('#hint').classList.toggle('show', !!text);
  }

  toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  /** End-of-fight banner. `final`: the last room of the campaign. */
  banner(result, { round, level, final, xp }) {
    const rounds = `${round} round${round === 1 ? '' : 's'}`;
    const won = result === 'victory';
    $('#banner-title').textContent = won ? (final ? 'Victory' : 'Room cleared') : 'Defeat';
    $('#banner-text').textContent = won
      ? final
        ? `Morvath is destroyed and the crypt is cleansed after ${rounds}. Well fought! (+${xp} XP)`
        : `${level} is quiet after ${rounds}. The party shares ${xp} XP and catches its breath (short rest: regain half your missing HP).`
      : `Your party has fallen in ${level}. Try the room again as you entered it, or go back to the map and pick another way.`;
    $('#next').hidden = !won || final;
    $('#to-map').hidden = won;
    $('#restart').textContent = won ? 'New campaign' : 'Try again';
    $('#restart').hidden = won && !final;
    $('#banner').dataset.result = result;
    $('#banner').hidden = false;
  }

  /** Level title card in the log. */
  levelIntro({ name, intro }, partyLevel) {
    this.log(`<b class="level">${esc(name)}</b> <span class="dice">party level ${partyLevel}</span><br>${esc(intro)}`, 'sys');
  }
}
