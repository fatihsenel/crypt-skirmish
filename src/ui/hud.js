// HTML overlay: initiative tracker, action bar, combat log, banners.

import { EndBanner } from './banner.js';
import { announce } from './announce.js';
import { signed, abilityMod } from '../game/dice.js';
import { ACTIONS, SPELLS, PASSIVES, SHOVE, PUSH, HELP, FEED, GRAPPLE, CONDITION_INFO } from '../game/abilities.js';
import { ITEMS } from '../game/items.js';
import { unitIcon, unknownIcon } from './icons.js';
import { AbilityTip } from './abilityTip.js';
import { UnitTip } from './unitTip.js';
import { buttonTips } from './buttonTips.js';
import { unitCard, shortName } from './unitCard.js';

/** A turn-order name, short enough to tell apart: "Giant Spider 2" shows as "G. Spider 2". */
const chipName = (name) => esc(shortName(name));
import { isWeapon, isMelee, longReach, LIGHT_CLASSES, PROP_HP, TRAP_DC } from '../game/combat.js';

const $ = (sel) => document.querySelector(sel);
/** Standard actions few turns need: they sit behind More with Grapple, Help and Give potion. */
const RARE_ACTIONS = new Set(['disengage', 'search']);
/** A monk's features that spend ki (the button shows what's left). */
const KI_COST = new Set(['flurry', 'patientDefense', 'stepOfTheWind', 'stunningStrike']);
const LOG_KEY = 'crypt-skirmish:log'; // '0' when the log beside the board is folded
const NARROW = '(max-width: 900px)'; // the log is a panel of its own (style.css)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const who = (u) => `<span class="${u.team}" data-unit="${u.id}">${esc(u.name)}</span>`;
const ordinal = (n) => ['', '1st', '2nd', '3rd'][n] ?? `${n}th`;
const spellLevel = (s) => (s.level ? `${ordinal(s.level)}-level spell` : s.pool ? 'Paladin feature' : 'Cantrip');
/** The numbers worth seeing at a glance on a spell's card. */
/** A Warlock casts every spell with its pact slots, so at their level. */
const pactLevel = (u) => Math.max(0, ...Object.entries(u.slotMax ?? {}).filter(([, n]) => n > 0).map(([l]) => +l));
const castLevel = (s, u) => (u.pactMagic && s.level ? Math.max(s.level, pactLevel(u)) : s.level);
function spellChips(s, u) {
  const chips = [];
  const up = castLevel(s, u) - s.level;
  const damage = s.targeting === 'cone' && up && s.damage ? s.damage.replace(/^(\d+)/, (n) => +n + up) : s.damage;
  if (s.damage) chips.push(`${s.darts ? `${s.darts + up} × ` : s.rays ? `${s.rays + up} × ` : ''}${damage} damage`);
  if (s.heal) chips.push(`heal ${s.heal[0]}d${s.heal[1]} + WIS`);
  if (s.pool) chips.push(`${u.layOnHands} HP in the pool`);
  if (s.uses) chips.push(`d${u.inspirationDie}, ${u.inspiration} left`);
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
  `${who(s.unit)} <span class="dice">${s.total}${s.aura ? ` (aura +${s.aura})` : ''}${s.inspired ? ` (inspired +${s.inspired.total})` : ''}${s.paralyzed ? ' (paralysed: fails)' : ''}</span> ` + (s.success ? '<b class="hit">saves</b>' : `<b class="crit">${fail}</b>`);
const CONDITION_VERB = { prone: 'is knocked prone!', poisoned: 'is poisoned!', frightened: 'is frightened!', restrained: 'is caught in the web!', petrified: 'turns to stone!', rotting: 'is wracked by mummy rot!', mocked: 'is mocked!', paralyzed: 'is paralysed!', stunned: 'is stunned!', burning: 'catches fire!', engulfed: 'is engulfed!' };

/** Blessed Healer's line under a healing spell, if the cleric healed too. */
const blessed = (r) => (r.selfHeal ? `<br>${who(r.caster)} is <b class="spell">Blessed Healer</b>: <b class="heal">+${r.selfHeal} HP</b>` : '');

/** Marks which edges of a sideways-scrolling row have more out of sight (more-left, more-right). */
function markOverflow(row) {
  row.classList.toggle('more-left', row.scrollLeft > 2);
  row.classList.toggle('more-right', row.scrollLeft + row.clientWidth < row.scrollWidth - 2);
}

/** A dying hero's death saves, for screen readers. */
const dyingText = (d) => (d.stable ? 'stable at 0 HP' : `dying: ${d.successes} of 3 successes, ${d.failures} of 3 failures`);

/** A dying hero's death saves as pips: three for successes, three for failures. */
function savePips(d) {
  const pip = (n, kind) => [0, 1, 2].map((i) => `<i class="${i < n ? kind : ''}"></i>`).join('');
  return `<span class="pips${d.stable ? ' stable' : ''}" aria-hidden="true">${pip(d.successes, 'ok')}<b></b>${pip(Math.min(3, d.failures), 'no')}</span>`;
}

export class Hud {
  /**
   * onChoose receives { kind: 'attack', attack } | { kind: 'spell', id } | { kind: 'action', id }
   */
  constructor({ onEndTurn, onUndo, onChoose, onRestart, onEase, onNext, onMap, onToggleSound, onToggleMusic }) {
    this.handlers = { onChoose };
    this.canUndo = false; // the controller sets it: the last move can be taken back
    $('#end-turn').addEventListener('click', onEndTurn);
    $('#undo').addEventListener('click', onUndo);
    $('#restart').addEventListener('click', onRestart);
    $('#ease').addEventListener('click', onEase);
    $('#next').addEventListener('click', onNext);
    $('#to-map').addEventListener('click', onMap);
    $('#sound').addEventListener('click', onToggleSound);
    $('#music').addEventListener('click', onToggleMusic);
    buttonTips($('#audio'));
    $('#attacks').addEventListener('click', (ev) => this.onAbilityClick(ev));
    this.tips = new Map();
    this.abilityTip = new AbilityTip($('#attacks'), (key) => this.tips.get(key) ?? null);
    this.unitTip = new UnitTip();
    // No hover on a touch screen: tapping a tag shows its hint (hints.js), a portrait its card.
    const chipOf = (ev) => ev.target.closest('#initiative .chip');
    $('#initiative').addEventListener('pointerover', (ev) => {
      if (ev.pointerType !== 'mouse') return;
      const chip = chipOf(ev);
      if (chip) this.showUnitTip(chip, 'below', true);
    });
    $('#initiative').addEventListener('pointerleave', (ev) => ev.pointerType === 'mouse' && this.unitTip.hide());
    $('#initiative').addEventListener('scroll', () => this.unitTip.hide(), { passive: true });
    // Rows that scroll sideways on a phone fade the edge with more out of sight (style.css).
    const rows = ['#initiative', '#attacks', '#who'].map((sel) => $(sel));
    const resized = new ResizeObserver(() => rows.forEach(markOverflow));
    for (const row of rows) {
      row.addEventListener('scroll', () => markOverflow(row), { passive: true });
      resized.observe(row);
    }
    $('#initiative').addEventListener('click', (ev) => {
      const chip = chipOf(ev);
      if (!this.touch || !chip) return;
      if (this.unitTip.key === this.tipKey(chip)) return this.unitTip.hide(); // tap again to close
      this.showUnitTip(chip, 'below', false);
    });
    document.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType !== 'mouse' && !this.unitTip.el.hidden && !$('#initiative').contains(ev.target)) this.unitTip.hide();
    });
    $('#log-toggle').addEventListener('click', () => this.panelLog());
    $('#log-close').addEventListener('click', () => this.panelLog(false));
    $('#log-fold').addEventListener('click', () => this.toggleLog());
    // Scrolled up to read: new lines don't pull the log down; a button goes back to them.
    $('#log-list').addEventListener('scroll', () => this.atLogEnd() && this.hideLatest(), { passive: true });
    $('#log-latest').addEventListener('click', () => this.logToEnd());
    // A name in the log points at its figure: hover to mark its tile, click to look at it.
    const named = (ev) => ev.target.closest?.('#log-list [data-unit]');
    $('#log-list').addEventListener('pointerover', (ev) => {
      if (ev.pointerType === 'mouse') this.onLogName?.(Number(named(ev)?.dataset.unit), named(ev) ? 'hover' : 'leave');
    });
    $('#log-list').addEventListener('pointerleave', () => this.onLogName?.(NaN, 'leave'));
    // From the keyboard: Tab to the log, arrows step from name to name, Enter looks at one.
    const list = $('#log-list');
    const names = () => [...list.querySelectorAll('[data-unit]')].filter((e) => e.getClientRects().length);
    const pick = (el) => {
      list.querySelector('.kbd-name')?.classList.remove('kbd-name');
      this.kbdName = el;
      if (!el) return this.onLogName?.(NaN, 'leave');
      el.classList.add('kbd-name');
      el.scrollIntoView({ block: 'nearest' });
      this.onLogName?.(Number(el.dataset.unit), 'hover');
      announce(`${el.textContent}: ${el.closest('summary, li').textContent}`);
    };
    list.addEventListener('focus', () => pick(this.kbdName?.isConnected ? this.kbdName : names().at(-1)));
    list.addEventListener('blur', () => pick(null));
    list.addEventListener('keydown', (ev) => {
      const all = names();
      const at = all.indexOf(this.kbdName);
      const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[ev.key];
      if (step) {
        ev.preventDefault();
        ev.stopPropagation();
        const next = all[Math.min(all.length - 1, Math.max(0, (at < 0 ? all.length : at) + step))];
        if (next) pick(next);
      } else if (ev.key === 'Enter' && this.kbdName) {
        ev.preventDefault();
        this.onLogName?.(Number(this.kbdName.dataset.unit), 'go');
      } else if ((ev.key === 'f' || ev.key === 'F') && this.kbdName) {
        ev.preventDefault();
        ev.stopPropagation(); // F isn't a game key here
        this.filterLog(Number(this.kbdName.dataset.unit));
      } else if (ev.key === 'Escape') list.blur();
    });
    // One figure's lines only: double-click a name, F on it, or a long press on a touch screen.
    list.addEventListener('dblclick', (ev) => {
      const name = named(ev);
      if (!name) return;
      ev.preventDefault();
      getSelection()?.removeAllRanges(); // a double-click selects the word
      this.filterLog(Number(name.dataset.unit));
    });
    let press = null;
    list.addEventListener('pointerdown', (ev) => {
      const name = named(ev);
      if (ev.pointerType === 'mouse' || !name) return;
      clearTimeout(press);
      press = setTimeout(() => {
        press = 'held';
        this.filterLog(Number(name.dataset.unit));
      }, 500);
    });
    for (const type of ['pointerup', 'pointercancel', 'pointermove']) {
      list.addEventListener(type, (ev) => {
        if (press === 'held' || (type === 'pointermove' && Math.hypot(ev.movementX, ev.movementY) < 4)) return;
        clearTimeout(press);
        press = null;
      });
    }
    list.addEventListener('contextmenu', (ev) => named(ev) && ev.pointerType !== 'mouse' && ev.preventDefault());
    $('#log-only').addEventListener('click', () => this.filterLog(null));
    $('#log-list').addEventListener('click', (ev) => {
      const name = named(ev);
      if (!name) return;
      ev.preventDefault(); // a name in a monster turn's summary doesn't open it
      if (press === 'held') return void (press = null); // the long press filtered instead
      if (matchMedia(NARROW).matches) this.panelLog(false); // the panel would cover the board
      this.onLogName?.(Number(name.dataset.unit), 'go');
    });
    try {
      this.logFolded = localStorage.getItem(LOG_KEY) === '0';
    } catch {
      this.logFolded = false; // storage unavailable: start open
    }
    this.foldLog(this.logFolded, false);
    this.toastTimer = null;
    this.touch = false;
    this.end = new EndBanner({ toast: (text) => this.toast(text), touch: () => this.touch, logText: () => this.logText() });
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
    this.markLine(u);
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

  /** L, the log's header or its button: fold the log beside the board, or on a narrow screen
      open and close it as a panel of its own. */
  toggleLog() {
    if (matchMedia(NARROW).matches) this.panelLog();
    else this.foldLog(!this.logFolded);
  }

  /** Fold the log beside the board down to its header, or open it again (remembered). */
  foldLog(folded, save = true) {
    this.logFolded = folded;
    $('#log').classList.toggle('folded', folded);
    $('#log-fold').setAttribute('aria-expanded', String(!folded));
    if (!folded) {
      this.logToEnd(); // catch up on what came in
      this.newLines = 0;
      $('#log-new').hidden = true;
    }
    if (!save) return;
    try {
      localStorage.setItem(LOG_KEY, folded ? '0' : '1');
    } catch {
      /* it just won't be remembered */
    }
  }

  /** The combat log as a panel of its own, for screens too narrow to keep it beside the board. */
  panelLog(open = !this.logOpen) {
    this.logOpen = open;
    $('#app').classList.toggle('log-open', open);
    $('#log-toggle').setAttribute('aria-expanded', String(open));
    if (open) {
      this.setUnread(0);
      this.logToEnd(); // a hidden list can't scroll, so catch up now
    }
  }

  /** Show only the lines that name figure `id` (and the turns they're in), or every line again
      (`null`, or the same figure again). The bar above the list says whose, and clears it. */
  filterLog(id) {
    if (id === this.only) id = null;
    const list = $('#log-list');
    const name = id == null ? null : list.querySelector(`[data-unit="${id}"]`)?.textContent;
    this.only = name ? id : null;
    const btn = $('#log-only');
    btn.hidden = !name;
    if (name) {
      btn.innerHTML = 'Only <b></b> <span aria-hidden="true">✕</span>';
      btn.querySelector('b').textContent = name;
      btn.setAttribute('aria-label', `Showing only lines naming ${name}. Show every line`);
    } else {
      for (const d of list.querySelectorAll('details[data-was-open]')) { // fold back what was folded
        d.open = d.dataset.wasOpen === '1';
        delete d.dataset.wasOpen;
      }
    }
    this.applyFilter();
    this.logToEnd();
    announce(name ? `Only lines naming ${name}. F or the Only button shows every line.` : 'Every line shown.');
  }

  /** Hide the lines that don't name the figure the log is filtered to (`this.only`), opening
      the rounds and turns so their lines show; folding waits until the filter is cleared. */
  applyFilter() {
    const list = $('#log-list');
    for (const li of list.querySelectorAll('li.off')) li.classList.remove('off');
    if (this.only == null) return;
    const has = (el) => !!el.querySelector(`[data-unit="${this.only}"]`);
    const walk = (ol) => {
      for (const li of ol.children) {
        const d = li.querySelector(':scope > details');
        if (!has(li)) li.classList.add('off');
        else if (d) {
          if (!d.dataset.wasOpen) {
            d.dataset.wasOpen = d.open ? '1' : '0';
            d.open = true;
          }
          // A round's lines, and a turn that only mentions them, are sifted; their own turn shows whole.
          if (li.classList.contains('round-block') || !has(d.querySelector(':scope > summary'))) walk(d.querySelector(':scope > ol'));
        }
      }
    };
    walk(list);
  }

  /** Fold a round or turn, or note it to fold once the log is no longer filtered. */
  fold(details) {
    if (this.only != null) details.dataset.wasOpen = '0';
    else details.open = false;
  }

  reset() {
    $('#log-list').innerHTML = '';
    this.only = null;
    $('#log-only').hidden = true;
    this.turn = null;
    this.round = null;
    this.litLine = this.litUnit = null;
    this.newLines = 0;
    $('#log-new').hidden = true;
    this.hideLatest();
    this.setUnread(0);
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
    const reading = !this.atLogEnd(); // scrolled up to an earlier line: leave it there
    const turn = this.turn;
    if (cls === 'death' && this.round) this.round.fallen.push(html.replace(/ falls\.$/, ''));
    if (cls === 'round' && !turn) this.startRound(html);
    else if (turn) { // a monster's turn: its lines go under one summary line
      if (!turn.li.isConnected) this.addLine(turn.li);
      turn.list.appendChild(li);
      if (cls === 'death') this.turnNote(html.replace(/\.$/, ''));
    } else this.addLine(li);
    if (reading) {
      this.behind = (this.behind ?? 0) + 1;
      const btn = $('#log-latest');
      btn.textContent = `${this.behind} new line${this.behind === 1 ? '' : 's'} ↓`;
      btn.hidden = false;
    } else this.logToEnd();
    if (this.only != null) this.applyFilter();
    if (this.litUnit) this.markLine(this.litUnit, false); // the figure under the mouse may be in this line
    announce(li.textContent); // read out even while the log panel is closed
  }

  /** Whether the log shows its last line (or can't be seen, so it has nowhere to be). */
  atLogEnd() {
    const list = $('#log-list');
    return !list.clientHeight || list.scrollHeight - list.scrollTop - list.clientHeight < 24;
  }

  /** Scroll the log to its last line. */
  logToEnd() {
    const list = $('#log-list');
    list.scrollTop = list.scrollHeight;
    this.hideLatest();
  }

  /** Put away the button back to the newest lines (the log is there). */
  hideLatest() {
    this.behind = 0;
    $('#log-latest').hidden = true;
  }

  /** The log button's count of lines that came in while its panel was closed (a phone). */
  setUnread(n) {
    this.unread = n;
    const btn = $('#log-toggle');
    btn.classList.toggle('unread', n > 0);
    btn.dataset.count = n > 99 ? '99+' : String(n);
  }

  /** A line of the log's own (not one inside a turn): counted on the log button while its panel
      is closed, or on the header while the log is folded. */
  addLine(li) {
    (this.round?.list ?? $('#log-list')).appendChild(li);
    if (matchMedia(NARROW).matches) return void (!this.logOpen && this.setUnread((this.unread ?? 0) + 1));
    if (!this.logFolded) return;
    this.newLines = (this.newLines ?? 0) + 1;
    const badge = $('#log-new');
    badge.textContent = `${this.newLines} new`;
    badge.hidden = false;
  }

  /** A new round: the one before folds under its heading, which then names who fell in it and
      the HP the party dealt and took. Its heading opens it again. */
  startRound(html) {
    const last = this.round;
    if (last) {
      this.fold(last.details);
      const hurt = last.n ? this.game?.roundHurt?.(last.n) : null;
      const notes = [
        last.fallen.length && `${last.fallen.join(', ')} fell`,
        hurt?.monsters && `dealt ${hurt.monsters}`,
        hurt?.heroes && `took ${hurt.heroes}`,
      ].filter(Boolean);
      if (notes.length) last.summary.insertAdjacentHTML('beforeend', ` <span class="round-note">· ${notes.join(' · ')}</span>`);
    }
    const li = document.createElement('li');
    li.className = 'round-block';
    li.innerHTML = `<details open><summary class="round">${html}</summary><ol></ol></details>`;
    this.round = null; // the heading itself goes at the top level
    this.addLine(li);
    const details = li.querySelector('details');
    this.round = { details, summary: details.querySelector('summary'), list: details.querySelector('ol'), fallen: [], n: Number(html.match(/\d+/)?.[0]) }; // "Round 3"
  }

  /** Light the last line that names `u` (a figure under the mouse), or none. */
  markLine(u, scroll = true) {
    this.litLine?.classList.remove('lit');
    this.litLine = null;
    this.litUnit = u;
    if (!u || this.unknown?.(u)) return;
    const name = [...document.querySelectorAll(`#log-list [data-unit="${u.id}"]`)].filter((e) => !e.closest('.off')).at(-1);
    if (!name) return;
    // The line itself, or the heading of the folded turn or round it's in.
    let line = name.closest('li');
    for (let d = line.closest('details:not([open])'); d; d = d.parentElement.closest('details:not([open])')) {
      line = d.querySelector('summary');
    }
    line.classList.add('lit');
    this.litLine = line;
    const list = $('#log-list');
    const r = line.getBoundingClientRect();
    const box = list.getBoundingClientRect();
    if (scroll && box.height && (r.top < box.top || r.bottom > box.bottom)) line.scrollIntoView({ block: 'nearest' });
  }

  /** A monster's turn starts: what it does is logged under one line that sums it up, and opens
      to show the dice. Nothing is shown if nothing is logged (a monster out of sight). */
  beginTurn(unit, hidden = () => false, open = false) {
    const li = document.createElement('li');
    li.className = `turn ${unit.team}`;
    li.innerHTML = `<details${open ? ' open' : ''}><summary></summary><ol></ol></details>`;
    this.turn = { unit, hidden, li, details: li.firstChild, summary: li.querySelector('summary'), list: li.querySelector('ol'), notes: [] };
    this.turnNote(null);
  }

  /** The turn is over: a hero's, open while they act, folds like a monster's. */
  endTurn() {
    if (this.turn) this.fold(this.turn.details);
    this.turn = null;
  }

  /** The whole log as text, folded parts included and indented under their line (Copy log). */
  logText() {
    const out = [];
    const line = (el) => {
      const copy = el.cloneNode(true);
      for (const br of copy.querySelectorAll('br')) br.replaceWith(' — ');
      return copy.textContent.replace(/\s+/g, ' ').trim();
    };
    const walk = (list, depth) => {
      for (const li of list.children) {
        const d = li.querySelector(':scope > details');
        if (!d) {
          out.push('  '.repeat(depth) + line(li));
          continue;
        }
        out.push('  '.repeat(depth) + line(d.querySelector(':scope > summary')));
        walk(d.querySelector(':scope > ol'), depth + 1);
      }
    };
    walk($('#log-list'), 0);
    return out.filter((l) => l.trim()).join('\n');
  }

  /** Add to the summary of the turn: "moves", "hits Brannoc for 5", … */
  turnNote(html) {
    const t = this.turn;
    if (!t) return;
    if (html && t.notes.at(-1) !== html) t.notes.push(html);
    const name = t.hidden() ? '<span class="monsters">Something</span>' : who(t.unit); // out of sight
    t.summary.innerHTML = t.notes.length ? `${name}: ${t.notes.join(', ')}` : `${name}’s turn`;
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
    const bard = r.inspired ? ` <b class="spell">Bardic Inspiration</b> <span class="dice">+${r.inspired.total} (d${r.inspired.die})</span>`
      : r.cutting ? ` ${who(r.cutting.by)}’s <b class="spell">Cutting Words</b> <span class="dice">−${r.cutting.total} (d${r.cutting.die})</span>` : '';
    const d20 = r.rolls.length > 1 ? `d20 [${r.rolls.join(', ')}] → ${r.d20}` : `d20 ${r.d20}`;
    const why = r.mods.mode === 'adv'
      ? ` <span class="adv">advantage: ${esc(r.mods.adv.join(', '))}</span>`
      : r.mods.mode === 'dis'
        ? ` <span class="dis">disadvantage: ${esc(r.mods.dis.join(', '))}</span>`
        : '';
    const tag = r.opportunity ? '<b class="opp">Opportunity attack!</b><br>'
      : r.readied ? '<b class="opp">Readied attack!</b><br>'
        : r.bonus ? `<b class="spell">${{ flurry: 'Flurry of Blows', martial: 'Martial Arts', frenzy: 'Frenzy' }[r.bonus]}</b> <span class="dice">bonus action</span><br>` : '';
    const sneak = (r.sneak ? ` incl. <b class="sneak">Sneak Attack +${r.sneak.total}</b> ${dice(r.sneak)}` : '')
      + (r.smite ? ` incl. <b class="spell">Divine Smite +${r.smite.total} radiant</b> ${dice(r.smite.roll)}${r.target.undead ? ' (undead +1d8)' : ''} <span class="dice">${ordinal(r.smite.slot)}-level slot</span>` : '')
      + (r.mark ? ` incl. <b class="spell">${r.mark.spell === 'hex' ? 'Hex' : 'Hunter’s Mark'} +${r.mark.total}</b> ${dice(r.mark)}` : '')
      + (r.colossus ? ` incl. <b class="sneak">Colossus Slayer +${r.colossus.total}</b> ${dice(r.colossus)}` : '')
      + (r.strike ? ` incl. <b class="spell">Divine Strike +${r.strike.total} radiant</b> ${dice(r.strike)}` : '')
      + (r.charge ? ` incl. <b class="crit">Charge +${r.charge.total}</b> ${dice(r.charge)}` : '')
      + (r.uncanny ? ` <b class="spell">Uncanny Dodge</b> halves it.` : '')
      + (r.resisted ? (r.target.swarm ? ' The swarm scatters: half damage.' : ` <b class="spell">Rage</b> halves it.`) : '')
      + (r.deflect ? ` <b class="spell">Deflect Missiles</b> takes off ${r.deflect.total} ${dice(r.deflect)}.` : '');
    const did = r.crit ? `crits ${who(r.target)}${r.attack.damage ? ` for ${r.damage}` : ''}`
      : r.hit && !r.shielded && !r.fumble ? `hits ${who(r.target)}${r.attack.damage ? ` for ${r.damage}` : ''}`
        : `misses ${who(r.target)}`;
    this.turnNote(r.attacker === this.turn?.unit ? did : `${who(r.attacker)} ${did}`);
    this.log(
      `${tag}${who(r.attacker)} → ${who(r.target)} · ${esc(r.attack.name)}${why}<br> ` +
        `<span class="dice">${d20} ${signed(r.toHit)}</span>${bard} <span class="dice">= ${r.total}</span> vs AC ${r.ac}${r.cover ? ' <span class="cover">(half cover +2)</span>' : ''}. ${outcome}${dmg}${sneak}`,
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

  /** A monk's Stunning Strike or Open Hand Technique, or a minotaur's Charge, after the hit. */
  logTechnique(r) {
    for (const [x, name] of [[r.stun, 'Stunning Strike'], [r.topple, 'Open Hand'], [r.knock, 'Charge']]) {
      if (!x) continue;
      this.log(`<b class="spell">${name}</b>: ${who(r.target)} <span class="dice">${x.stat.toUpperCase()} save ${x.total} vs DC ${x.dc}</span>: ` +
        (x.success ? `<b class="hit">shrugs it off</b>.` : `<b class="cond ${x.condition}">${CONDITION_VERB[x.condition]}</b>`));
    }
  }

  /** Rules 4: a gargoyle's claws or Tharok's charge throw a hero back, maybe toward the chasm. */
  logThrow(r) {
    const save = r.dc ? `${who(r.target)} <span class="dice">STR save ${r.total} vs DC ${r.dc}</span>: ` : `${who(r.target)} `;
    const edge = r.edge ? ` <span class="dice">DEX save ${r.edge.total} vs DC ${r.edge.dc}</span>` : '';
    this.log(`<b class="spell">Thrown back</b>: ${save}` + (r.success ? '<b class="hit">holds firm</b>.'
      : r.push?.fall ? `is thrown over the chasm’s edge${edge}. <b class="crit">Gone!</b>`
      : r.edge ? `is thrown to the very edge${edge} and <b class="hit">catches it</b>, prone.`
      : r.push ? 'is thrown 5 ft back.'
      : 'has nowhere to go and keeps their ground.'));
  }

  logStench(r) {
    this.log(`The stench of ${who(r.by)} reaches ${who(r.target)}.`);
    this.logRider(r);
  }

  logHelp(r) {
    this.log(`${who(r.unit)} distracts ${who(r.target)}: the next ally to attack it has <b class="adv">advantage</b>.`);
  }

  logFeed(r) {
    this.log(`${who(r.unit)} ${r.thrown ? 'tosses' : 'pours'} a <b>potion of healing</b> ${r.thrown ? 'to' : 'into'} ${who(r.target)}: <b class="heal">+${r.healed} HP</b> ${dice(r.roll)}.`);
  }

  logGrapple(r) {
    const roll = `<span class="dice">${r.roll.rolls.length > 1 ? `d20 [${r.roll.rolls.join(', ')}] → ${r.roll.d20}` : `d20 ${r.roll.d20}`} ${signed(r.roll.bonus)} = ${r.roll.total}</span>`;
    const resist = `<span class="dice">${r.resist.d20} ${signed(r.resist.bonus)} = ${r.resist.total}</span>`;
    this.log(`${who(r.attacker)} grapples ${who(r.target)}: ${roll} vs ${resist}. ` +
      (r.success ? '<b class="cond">Held: speed 0.</b>' : '<b class="miss">It twists free.</b>'));
  }

  logStruggle(r) {
    this.log(`${who(r.unit)} strains against ${who(r.by)}’s grip: <span class="dice">d20 ${r.d20} ${signed(r.bonus)} = ${r.total}</span> vs ${r.hold}. ` +
      (r.success ? '<b class="miss">It breaks free.</b>' : '<b class="cond">Still held.</b>'));
  }

  logGrappleEnd({ unit, by, why }) {
    if (why === 'broken') return; // told with the struggle
    this.log(why === 'let go' ? `${who(by)} lets go of ${who(unit)}.` : `${who(unit)} is no longer held.`);
  }

  logShove(r) {
    const roll = `<span class="dice">${r.roll.rolls.length > 1 ? `d20 [${r.roll.rolls.join(', ')}] → ${r.roll.d20}` : `d20 ${r.roll.d20}`} ${signed(r.roll.bonus)} = ${r.roll.total}</span>`;
    const resist = `<span class="dice">${r.resist.d20} ${signed(r.resist.bonus)} = ${r.resist.total}</span>`;
    this.log(`${who(r.attacker)} shoves ${who(r.target)}: ${roll} vs ${resist}. ` +
      (!r.success ? '<b class="miss">It keeps its feet.</b>'
        : r.push?.fall ? '<b class="crit">Pushed over the edge!</b>'
        : r.push?.crash ? '<b class="crit">Pushed through the cracked floor!</b>'
        : r.push?.stair ? '<b class="crit">Pushed down the stairs!</b>'
        : r.push ? '<b>Pushed back 5 ft.</b>'
        : '<b class="cond prone">Knocked prone!</b>'));
  }

  /** A condition starts or ends. (Starting ones from riders and spells are logged with them.) */
  logCondition({ unit, name, on, cause }) {
    if (on || cause === 'used' || cause === 'inside') return; // (a mockery spent on an attack shows in its line)
    if (name === 'engulfed') {
      if (cause === 'save') this.log(`${who(unit)} <b class="hit">struggles out</b> of the cube.`, 'sys');
      else if (cause === 'freed') this.log(`${who(unit)} slides free of the cube.`, 'sys');
      return;
    }
    const text = {
      stand: `gets up off the floor (half movement).`,
      save: name === 'paralyzed' ? 'shakes off the paralysis.' : name === 'burning' ? 'beats out the flames.' : `shakes off the fear.`,
      concentration: 'is no longer frightened: the spell ended.',
      expired: name === 'poisoned' ? 'is no longer poisoned.' : name === 'frightened' ? 'is no longer frightened.'
        : name === 'restrained' ? 'tears free.' : name === 'rotting' ? 'is free of the rot.'
          : name === 'mocked' ? 'shakes off the mockery.' : name === 'paralyzed' ? 'can move again.' : 'recovers.',
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
  logWard({ unit, relentless, relic }) {
    if (relic) this.log(`<b class="heal">Morvath’s Phylactery</b> holds: ${who(unit)} stays on their feet with 1 HP.`);
    else if (relentless) this.log(`${who(unit)} is <b>Relentless</b>: it stays on its feet with 1 HP.`);
    else this.log(`<b class="heal">Death Ward</b> holds: ${who(unit)} stays on their feet with 1 HP.`);
  }

  /** A Barbed elite's spines bite the foe that struck it in melee. */
  logBarbs({ unit, target, damage }) {
    this.log(`${who(target)} is cut by ${who(unit)}’s barbs for <b>${damage}</b> damage.`);
  }

  /** A regenerating elite's wounds close at the start of its turn. */
  logRegen({ unit, amount }) {
    this.log(`${who(unit)} regenerates ${amount} HP.`);
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
    if (r.readied) this.log(`<b class="opp">Readied spell!</b> ${who(r.target)} steps into ${who(r.caster)}’s view.`);
    const slot = (r.slot ? `<span class="dice">${ordinal(r.slot)}-level slot</span>` : '<span class="dice">cantrip</span>')
      + (r.quickened ? ' <span class="dice">Quickened: bonus action</span>' : '');
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
    } else if (r.id === 'viciousMockery') {
      const out = r.save.success ? '' : `, <b class="hit">${r.damage} psychic damage</b> ${dice(r.roll)} and disadvantage on its next attack`;
      this.log(`${who(r.caster)} hurls ${name} at ${who(r.target)}. WIS save DC ${r.dc}: ` +
        `${saveText({ ...r.save, unit: r.target })}${out}. ${slot}`);
    } else if (r.id === 'bardicInspiration') {
      this.log(`${who(r.caster)} gives ${who(r.target)} <b class="spell">Bardic Inspiration</b>: a d${r.die} for a near miss or a failed save. ` +
        `<span class="dice">bonus action, ${r.left} left</span>`);
    } else if (r.id === 'thunderwave') {
      const saves = r.saves.map((s) => `${who(s.unit)} <span class="dice">CON ${s.total}</span> ` +
        (s.success ? `saves, <b class="hit">${s.damage}</b>` : `fails, <b class="crit">${s.damage}</b> and is knocked prone`)).join('<br>');
      this.log(`${who(r.caster)} casts ${name} <span class="dice">${r.roll.total} thunder [${r.roll.rolls.join('+')}], DC ${r.dc}</span>. ${slot}<br>${saves}`);
    } else if (r.id === 'entangle') {
      const saves = r.saves.length ? r.saves.map((s) => saveText(s, 'is restrained')).join('<br>') : '<span class="miss">The weeds catch no one.</span>';
      this.log(`${who(r.caster)} casts ${name}, STR save DC ${r.dc}. ${slot}<br>${saves}`);
    } else if (r.id === 'callLightning') {
      const saves = r.saves.length
        ? r.saves.map((s) => `${who(s.unit)} <span class="dice">DEX ${s.total}</span> ` +
            (s.success ? `saves, <b class="hit">${s.damage}</b>` : `fails, <b class="crit">${s.damage}</b>`) +
            (s.evasion ? ' <span class="dice">Evasion</span>' : '')).join('<br>')
        : '<span class="miss">The bolt strikes no one.</span>';
      const how = r.again ? 'calls another bolt from the storm' : `casts ${name}`;
      this.log(`${who(r.caster)} ${how} <span class="dice">${r.roll.total} lightning [${r.roll.rolls.join('+')}], DC ${r.dc}</span>. ${r.again ? '<span class="dice">no slot</span>' : slot}<br>${saves}`);
    } else if (r.id === 'shatter') {
      const saves = r.saves.length
        ? r.saves.map((s) => `${who(s.unit)} <span class="dice">CON ${s.total}</span> ` +
            (s.success ? `saves, <b class="hit">${s.damage}</b>` : `fails, <b class="crit">${s.damage}</b>`)).join('<br>')
        : '<span class="miss">The ringing hurts no one.</span>';
      this.log(`${who(r.caster)} casts ${name} <span class="dice">${r.roll.total} thunder [${r.roll.rolls.join('+')}], DC ${r.dc}</span>. ${slot}<br>${saves}`);
    } else if (r.id === 'fear') {
      const saves = r.saves.length
        ? r.saves.map((s) => saveText(s, 'is frightened')).join('<br>')
        : '<span class="miss">No foe stands in the cone.</span>';
      this.log(`${who(r.caster)} casts ${name}, WIS save DC ${r.dc}. ${slot}<br>${saves}`);
    } else if (r.id === 'greaterInvisibility') {
      const self = r.target === r.caster ? 'themself' : who(r.target);
      this.log(`${who(r.caster)} casts ${name} on ${self}: invisible for the rest of the fight. ${slot}`);
    } else if (r.id === 'animateDead') {
      this.log(`${who(r.caster)} casts ${name}. The ${esc(r.corpse.cls.toLowerCase())} corpse rises as ` +
        `<span class="monsters">${esc(r.risen.name)}</span>! ${slot}`, 'death');
    }
  }

  logTrap(r) {
    const opener = r.trap.rigged && r.unit.team === 'monsters' ? '<b class="crit">The rigged trap!</b>' // rules 8
      : r.trap.revealed && r.unit.team === 'heroes' && r.unit === this.disarming ? '<b class="crit">The trap goes off!</b>' : '<b class="crit">A hidden trap!</b>';
    this.disarming = null;
    this.log(`${opener} Spikes burst from the floor under ${who(r.unit)}. ` +
      `DEX save DC ${r.dc}: ${saveText(r)}, takes <b class="hit">${r.damage} piercing</b> ${dice(r.roll)}` +
      // (logged before the damage lands: it goes down only if it survives the spikes)
      (!r.success && r.unit.hp > r.damage ? ' and is <b class="cond prone">knocked prone</b>.' : '.'));
  }

  logLever({ unit, gates, down }) {
    this.log(`${who(unit)} pulls the lever: ${down
      ? `the portcullis <b class="crit">crashes down</b>${gates.length > 1 ? ` across ${gates.length} tiles` : ''}. No way through, but the bars hide nothing.`
      : 'the portcullis grinds back up.'}`);
  }

  logBrazier({ unit, tiles }) {
    this.log(`${who(unit)} tips the brazier over: <b class="crit">burning coals</b> spill across ${tiles.length} tile${tiles.length === 1 ? '' : 's'}.`);
  }

  /** Someone was where the coals landed. */
  logSpill(r) {
    this.log(`${who(r.unit)} is caught in the coals. DEX save DC ${r.dc}: ${saveText(r)}, takes <b class="hit">${r.damage} fire</b> ${dice(r.roll)}.`);
  }

  /** Someone walked onto the coals. */
  logBurn(r) {
    this.log(`${who(r.unit)} steps onto the coals and takes <b class="hit">${r.damage} fire</b> ${dice(r.roll)}.`);
  }

  /** Rules 6: alchemist's fire thrown. */
  logFlask(r) {
    const roll = `<span class="dice">${r.rolls.length > 1 ? `d20 [${r.rolls.join(', ')}] → ${r.d20}` : `d20 ${r.d20}`} ${signed(r.bonus)} = ${r.total}</span>`;
    this.log(`${who(r.unit)} hurls <b>alchemist’s fire</b> at ${who(r.target)}: ${roll} vs AC ${r.ac}. ` +
      (r.hit ? `${r.crit ? '<b class="crit">Critical!</b> ' : ''}<b class="hit">${r.damage} fire</b> ${dice(r.roll)}${r.target.alive ? ', and it <b class="cond burning">catches fire</b>.' : '.'}` : '<b class="miss">The flask smashes wide.</b>'));
  }

  /** Burning at the end of its turn, then the save to put it out. */
  logAflame(r) {
    this.log(`${who(r.unit)} burns for <b class="hit">${r.damage} fire</b> ${dice(r.roll)}.`);
  }

  /** Rules 7: a torch thrown, or Light cast, on a tile. */
  logLight({ unit, spell }) {
    this.log(spell ? `${who(unit)} casts <b class="spell">Light</b>: a mote of light hangs over the dark.`
      : `${who(unit)} throws a <b>torch</b> into the dark.`);
  }

  /** Rules 7: a blow at a barrel or crate. */
  logSmash({ unit, prop, damage, roll, broken, hp }) {
    this.log(`${who(unit)} smashes at the ${prop}: <b class="hit">${damage}</b> ${dice(roll)}` +
      (broken ? `. <b class="crit">It breaks apart.</b>` : `. It holds (${hp} left).`));
  }

  /** Rules 8: a hero shuts and bars a door. */
  logBar({ unit, shut, dc }) {
    this.log(`${who(unit)} ${shut ? 'swings the door shut and drops' : 'drops'} the <b>bar</b> across it. A monster must break it: STR DC ${dc}.`);
  }

  /** Rules 8: a monster at a barred door. */
  logBash(r, seen) {
    const name = seen ? who(r.unit) : 'Something';
    this.log(`${name} throws itself at the barred door. STR DC ${r.dc}: ${r.d20} ${signed(r.total - r.d20)} = ${r.total}` +
      (r.success ? `. <b class="crit">The bar breaks!</b>` : '. It holds, splintering.'));
  }

  /** Rules 8: a hero works at a trap. */
  logDisarm(r) {
    if (!r.success && r.sprung) this.disarming = r.unit; // the springing is logged next
    this.log(`${who(r.unit)} works at the trap. DEX check DC ${r.dc}: ${r.d20} ${signed(r.bonus)} = ${r.total}` +
      (r.success ? `: <b class="spell">rigged</b>. Heroes can cross it now, and the next monster to step on it sets it off.`
        : r.sprung ? ': a slip.' : ': no luck this time.'));
  }

  /** Rules 8: a zombie's Undead Fortitude. */
  logFortitude(r) {
    if (r.why) this.log(`${who(r.unit)} goes down for good: ${r.why === 'crit' ? 'a critical hit' : 'radiant damage'} beats Undead Fortitude.`);
    else this.log(`${who(r.unit)}’s Undead Fortitude: CON save DC ${r.dc}: ${saveText({ ...r, unit: r.unit }, 'stays down')}` +
      (r.success ? ': it <b class="crit">gets back up</b> on 1 HP!' : '.'));
  }

  /** Rules 7: a monster tests its nerve. */
  logMorale(r) {
    const why = r.why === 'leader' ? 'sees its leader fall' : 'is badly hurt';
    this.log(`${who(r.unit)} ${why}. WIS save DC ${r.dc}: ${saveText(r, 'breaks')}` + (r.success ? ': stands its ground.' : ' and <b class="cond">runs</b>!'));
  }

  /** Rules 7: a gelatinous cube's acid at the start of an engulfed creature's turn. */
  logDigest(r) {
    this.log(`${who(r.unit)} burns in the cube’s acid: <b class="hit">${r.damage}</b> ${dice(r.roll)}.` +
      (r.save ? ` STR save DC ${r.save.dc}: ${saveText({ ...r.save, unit: r.unit }, 'stays stuck')}.` : ''));
  }

  logCaltrops({ unit }) {
    this.log(`${who(unit)} spreads <b>caltrops</b> across the floor.`);
  }

  logCaltropStep(r) {
    this.log(`${who(r.unit)} steps on the caltrops. DEX save DC ${r.dc}: ${saveText(r)}` +
      (r.success ? ': picks a way through.' : ', takes <b class="hit">1 piercing</b> and stops there.'));
  }

  logTumble(r) {
    this.log(`${who(r.unit)} ${r.through ? 'crashes through the floor to the hall below' : 'tumbles down the stairs'} and takes <b class="hit">${r.damage} bludgeoning</b> ${dice(r.roll)}${r.lands ? ', landing prone' : ''}.`);
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
      ready: r.spell ? `readies <b class="spell">${esc(r.spell.name)}</b>: the first foe to step into view takes it.`
        : r.attack && `readies <b>${esc(r.attack.name)}</b>: the first foe to step into ${r.attack.reach === 1 ? 'reach' : 'view'} takes it.`,
      disengage: 'Disengages. Moving won’t provoke opportunity attacks.',
      nimbleEscape: 'uses <b>Nimble Escape</b> to slip away.',
      secondWind: `uses <b>Second Wind</b> and regains <b class="heal">${r.healed} HP</b> ${r.roll && dice(r.roll)}.`,
      cunningDash: 'uses <b>Cunning Action</b> to Dash.',
      cunningDisengage: 'uses <b>Cunning Action</b> to Disengage.',
      hide: `slips into the shadows: <b>Stealth ${r.total}</b> ${stealthRoll(r)}.`,
      cunningHide: `uses <b>Cunning Action</b> to Hide: <b>Stealth ${r.total}</b> ${stealthRoll(r)}.`,
      nimbleHide: 'ducks out of sight (<b>Nimble Escape</b>) and hides.',
      aggressive: 'roars and charges (<b>Aggressive</b>).',
      rage: 'flies into a <b class="crit">Rage</b>: +2 melee damage, half damage from weapons, for the rest of the fight.',
      reckless: 'attacks <b>recklessly</b>: advantage on Strength melee attacks this turn, and attacks against them have advantage.',
      quicken: r.armed ? `readies a <b class="spell">Quickened Spell</b> <span class="dice">2 sorcery points, ${r.left} left</span>.` : `lets the Quickened Spell go <span class="dice">back to ${r.left} sorcery points</span>.`,
      stunningStrike: r.armed ? 'readies a <b class="spell">Stunning Strike</b> for the next melee hit.' : 'lets the Stunning Strike go.',
      flurry: `unleashes a <b class="spell">Flurry of Blows</b>: two unarmed strikes <span class="dice">1 ki, ${r.left} left</span>.`,
      patientDefense: `takes up <b class="spell">Patient Defense</b>: attacks against them have disadvantage <span class="dice">1 ki, ${r.left} left</span>.`,
      stepOfTheWind: `moves with the <b class="spell">Step of the Wind</b>: Dash and Disengage <span class="dice">1 ki, ${r.left} left</span>.`,
      wholeness: `uses <b>Wholeness of Body</b> and regains <b class="heal">${r.healed} HP</b>.`,
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

  /** A concentration save, or concentration lost (rules 2). A switch to another spell says nothing. */
  logConcentration(r) {
    if (r.cause === 'switch' || r.cause === 'fell') return;
    const name = `<b class="spell">${esc(SPELLS[r.spell].name)}</b>`;
    if (!r.save) return this.log(`${who(r.unit)} loses concentration (${esc(r.cause)}): ${name} ends.`);
    const save = `<span class="dice">CON d20 ${r.save.d20} → ${r.save.total} vs DC ${r.save.dc}</span>`;
    this.log(r.broken ? `${who(r.unit)} loses concentration ${save}: ${name} ends.` : `${who(r.unit)} holds concentration on ${name} ${save}.`);
  }

  /** A death save, as the log tells it. */
  logDeathSave(r) {
    const roll = `<span class="dice">d20 ${r.d20}</span>`;
    const tail = r.result === 'rally' ? ': a 20, back up with <b class="heal">1 HP</b>!'
      : r.result === 'stable' ? ': a success. <b>Stable</b>, out of danger.'
        : r.result === 'dead' ? `: ${r.d20 === 1 ? 'a 1, two failures' : 'a failure'}. Out of the fight.`
          : `: ${r.d20 >= 10 ? 'a success' : r.d20 === 1 ? 'a 1, two failures' : 'a failure'} (${r.successes} ✓ ${r.failures} ✗).`;
    this.log(`${who(r.unit)} makes a <b>death save</b> ${roll}${tail}`, r.result === 'dead' ? 'death' : '');
  }

  renderInitiative(game) {
    this.game = game;
    this.unitTip.refresh();
    // The round, first and pinned while the portraits scroll: timed effects count by it.
    const round = game.round >= 1 ? `<div class="round"><span class="sr-only">Round ${game.round}</span><small aria-hidden="true">Rd</small><b aria-hidden="true">${game.round}</b></div>` : '';
    $('#initiative').innerHTML = round + game.order
      .map((u) => {
        const cls = ['chip', u.team, u === game.current ? 'current' : '', u.alive ? '' : 'dead', u.dying ? 'dying' : ''].join(' ');
        const pct = Math.max(0, (u.hp / u.maxHp) * 100);
        if (this.unknown?.(u)) {
          return `<div class="${cls} unknown" aria-label="Something you haven't seen yet">
            <span class="pic">${unknownIcon()}<b class="init">?</b></span><span class="nm">???</span><span class="mini"><i style="width:100%"></i></span>
          </div>`;
        }
        const color = `#${(u.color ?? 0x777777).toString(16).padStart(6, '0')}`;
        // New Game+ 2 and deeper: the elite's portrait wears the same gold as its band.
        return `<div class="${cls}${u.elite ? ' elite' : ''}" data-unit="${u.id}" aria-label="${esc(u.name)} (${esc(u.cls)})${u.elite ? ' · elite' : ''} · initiative ${u.initiative}${u.dying ? ` · ${dyingText(u.dying)}` : ''}">
          <span class="pic" style="--c:${color}">${unitIcon(u)}<b class="init">${u.initiative}</b></span>
          <span class="nm">${chipName(u.name)}</span>
          ${u.dying ? savePips(u.dying) : `<span class="mini"><i style="width:${pct}%"></i></span>`}
        </div>`;
      })
      .join('');
    // Long fights overflow the bar: keep whoever is acting in view.
    const bar = $('#initiative');
    const cur = bar.querySelector('.current');
    if (cur) bar.scrollLeft = cur.offsetLeft - bar.clientWidth / 2 + cur.clientWidth / 2;
    markOverflow(bar);
  }

  renderActionBar(game, { selected, busy }) {
    const u = game.current;
    this.lastBar = [game, { selected, busy }]; // More redraws the bar from it
    this.readying = selected?.kind === 'ready'; // the next attack clicked is the one to hold
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
    const pip = (label, used, hint) => `<span class="pip ${used ? 'used' : 'ready'}" data-hint="${esc(hint)}">${label}</span>`;
    const PIP_HINTS = {
      action: 'Action: one a turn, to attack, cast a spell, or Dash, Dodge, Disengage, Hide…',
      attacks: 'Attacks left from this turn’s Attack action.',
      bonus: 'Bonus action: one quick extra a turn, like Second Wind or a bonus-action spell.',
      reaction: 'Reaction: one a round, for an opportunity attack, a readied attack or a spell like Shield. It comes back at the start of this figure’s turn.',
    };
    const spent = (text, used) => (used ? `${text} Used this turn.` : text);
    const conds = Object.keys(u.conditions ?? {});
    const slots = Object.entries(u.slots)
      .filter(([l, n]) => n > 0 || (u.slotMax?.[l] ?? 0) > 0) // a warlock's old 2nd-level slots are gone at 5
      .map(([l, n]) => `<span class="slots" data-hint="${ordinal(+l)}-level spell slots">${ordinal(+l)} ${'◆'.repeat(n)}<s>${'◇'.repeat(Math.max(0, (u.slotMax?.[l] ?? n) - n))}</s></span>`)
      .join('');
    this.setHtml($('#who'), `
      <div class="who-name ${u.team}">${esc(u.name)} <small>${esc(u.cls)}${u.team === 'heroes' ? ` · Lv ${u.level}` : ''}</small></div>
      <div class="stats">
        <span>HP <b>${u.hp}</b>/${u.maxHp}${u.tempHp > 0 ? ` <b class="temp-hp" data-hint="Temporary HP: lost before your hit points">+${u.tempHp}</b>` : ''}</span>
        <span>AC <b>${game.acOf(u)}</b></span>
        <span>Move <b>${u.movesLeft * 5}</b> ft</span>
        ${u.team === 'heroes' ? `<span data-hint="Potions of healing">Potions <b>${u.potions}</b></span>` : ''}
        ${u.flasks > 0 ? `<span data-hint="Flasks of alchemist’s fire">Fire <b>${u.flasks}</b></span>` : ''}
        ${u.caltrops > 0 ? `<span data-hint="Bags of caltrops">Caltrops <b>${u.caltrops}</b></span>` : ''}
        ${u.ki !== undefined ? `<span data-hint="Ki points: your level, back every fight">Ki <b>${u.ki}</b></span>` : ''}
        ${u.sorcery !== undefined ? `<span data-hint="Sorcery points: your level, back every fight">Sorcery <b>${u.sorcery}</b></span>` : ''}
      </div>
      ${u.passives.length || u.items?.length || conds.length || u.marked || u.inspired || u.invisibleFrom || u.concentrating ? `<div class="passives">${u.faithFrom ? `<span class="passive-tag item" data-hint="${esc(SPELLS.shieldOfFaith.desc)}">Shield of Faith</span>` : ''}${u.inspired ? `<span class="passive-tag item" data-hint="${esc(SPELLS.bardicInspiration.desc)}">Inspired d${u.inspired.die}</span>` : ''}${u.invisibleFrom ? `<span class="passive-tag item" data-hint="${esc(SPELLS.greaterInvisibility.desc)}">Invisible</span>` : ''}${u.concentrating ? `<span class="passive-tag item" data-hint="${esc(SPELLS[u.concentrating].desc)}">Concentrating: ${esc(SPELLS[u.concentrating].name)}</span>` : ''}${u.marked ? `<span class="passive-tag cond" data-hint="${esc(SPELLS[markOf(u)].desc)}">${esc(SPELLS[markOf(u)].name)}</span>` : ''}${conds.map((c) =>
        `<span class="passive-tag cond ${c}" data-hint="${esc(CONDITION_INFO[c])}">${esc(c[0].toUpperCase() + c.slice(1))}</span>`).join('')}${u.passives.map((p) =>
        `<span class="passive-tag" data-hint="${esc(PASSIVES[p])}">${esc(PASSIVES[p].split(':')[0])}</span>`).join('')}${(u.items ?? []).map((i) =>
        `<span class="passive-tag item" data-hint="${esc(ITEMS[i].desc)}">${esc(ITEMS[i].name)}</span>`).join('')}</div>` : ''}
      <div class="economy">
        ${u.actionUsed && u.attacksLeft > 0 ? pip(`Attack ×${u.attacksLeft}`, false, PIP_HINTS.attacks) : pip('Action', u.actionUsed, spent(PIP_HINTS.action, u.actionUsed))}${pip('Bonus', u.bonusUsed, spent(PIP_HINTS.bonus, u.bonusUsed))}${pip('Reaction', u.reactionUsed, u.reactionUsed ? 'Reaction: used. It comes back at the start of this figure’s turn.' : PIP_HINTS.reaction)}${slots}
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

  /** Writes `html` into `el` if it differs from what's there. */
  setHtml(el, html) {
    if (el.dataset.html === html) return;
    el.dataset.html = html;
    el.innerHTML = html;
    markOverflow(el); // the ability row and the hero's line scroll sideways on a phone
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
    // Past the Attack action: a bonus-action strike (Martial Arts, Flurry of Blows, Frenzy) if one fits.
    const strikeWhy = (atk) => (attackWhy && !game.bonusStrike(u, atk) ? attackWhy : null);

    const atks = u.attacks.map((atk, i) => button({
      kind: 'attack', id: i, name: atk.name,
      sub: `${attackWhy && game.bonusStrike(u, atk) ? 'bonus · ' : ''}${signed(game.toHitBonus(u, atk))} · ${atk.damage} · ${atk.reach * 5} ft`,
      tip: this.attackTip(game, u, atk),
      problem: strikeWhy(atk),
      disabled: !!strikeWhy(atk),
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
    // Moves most turns don't need wait behind More, so the bar stays short (on a phone, one row).
    const more = [];
    // Push (rules 3): on the bar where there is a chasm, coals or (rules 5) a stairwell to push a foe into, else behind More.
    if (u.team === 'heroes' && (game.rules ?? 3) >= 3) {
      (game.grid.chasms?.size || game.fire?.length || (game.rules >= 5 && game.grid.links?.size) ? atks : more).push(button({
        kind: 'push', id: 'push', name: PUSH.name, cls: 'act',
        sub: `${signed(game.shoveBonus(u))} · 5 ft back`,
        tip: { kind: 'Takes one attack', chips: [`${signed(game.shoveBonus(u))} Athletics`, '5 ft'], desc: PUSH.desc, how: this.howTo('an enemy') },
        problem: attackWhy,
        disabled: !!attackWhy,
        active: selected?.kind === 'push',
      }));
    }
    if (u.team === 'heroes') {
      more.push(button({
        kind: 'grapple', id: 'grapple', name: GRAPPLE.name, cls: 'act',
        sub: `${signed(game.shoveBonus(u))} · hold in place · 5 ft`,
        tip: { kind: 'Takes one attack', chips: [`${signed(game.shoveBonus(u))} Athletics`, '5 ft'], desc: GRAPPLE.desc, how: this.howTo('an enemy') },
        problem: attackWhy,
        disabled: !!attackWhy,
        active: selected?.kind === 'grapple',
      }));
    }

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
      // While picking what to Ready, only the spells it can hold.
      const problem = this.readying ? game.readySpellProblem(u, id) : game.spellProblem(u, id);
      return button({
        kind: 'spell', id, name: s.name, cls: 'spell',
        sub: s.pool ? `${u.layOnHands}/${u.layOnHandsMax} HP left · action`
          : s.uses ? `${u.inspiration} left · bonus`
          : id === 'spiritualWeapon' && u.spiritWeapon ? 'strike again · bonus' : `${s.level ? ordinal(castLevel(s, u)) : 'cantrip'} · ${s.time === 'bonus' ? 'bonus' : 'action'}`,
        tip: {
          kind: `${spellLevel(s)} · ${s.time === 'bonus' ? 'bonus action' : 'action'}`,
          chips: spellChips(s, u),
          desc: s.desc,
          how: s.targeting === 'enemy' || s.targeting === 'cone' ? this.howTo(s.targeting === 'cone' ? 'where to aim' : 'an enemy')
            : s.targeting === 'ally' ? this.howTo(id === 'bardicInspiration' ? 'an ally' : 'an ally (or yourself)') : s.targeting === 'tile' ? this.howTo('a spot') : null,
        },
        problem: problem && `${problem}.`,
        disabled: !!problem,
        active: selected?.kind === 'spell' && selected.id === id,
      });
    });

    const acts = [];
    for (const id of game.actionsFor(u)) {
      const a = ACTIONS[id];
      const problem = game.actionProblem(u, id);
      const armed = (id === 'quicken' && u.quickened) || (id === 'stunningStrike' && u.stunArmed) || (id === 'reckless' && u.reckless);
      const cost = KI_COST.has(id) ? ` · ${u.ki} ki` : id === 'quicken' && !armed ? ` · ${u.sorcery} pts` : '';
      (RARE_ACTIONS.has(id) ? more : acts).push(button({
        kind: id === 'ready' ? 'ready' : 'action', id, name: armed ? `${a.name.split(' ')[0]} armed` : a.name,
        cls: `${a.time === 'bonus' ? 'bonus' : a.time === 'free' ? 'spell' : 'act'} ${armed ? 'armed' : ''}`,
        sub: armed ? (id === 'reckless' ? 'this turn' : 'click to cancel')
          : (a.time === 'bonus' ? 'bonus' : a.time === 'free' ? 'free' : 'action') + (id === 'potion' ? ` · ${u.potions} left` : '') + cost,
        tip: {
          kind: `${a.time === 'bonus' ? 'Bonus action' : a.time === 'free' ? 'Free, no action' : 'Action'}${a.feature ? ' · class feature' : ''}`,
          chips: [id === 'potion' ? `${u.potions} left` : null, a.range ? `${a.range * 5} ft` : null,
            id === 'ready' ? 'melee: into reach' : null, id === 'ready' ? 'ranged: into view' : null].filter(Boolean),
          desc: a.desc,
          how: id === 'ready' ? `${this.touch ? 'Tap' : 'Click'} it, then the attack${u.spells.some((sp) => !game.readySpellProblem(u, sp)) ? ' or spell' : ''} to hold.` : null,
        },
        problem: problem && `${problem}.`,
        disabled: !!problem,
        active: armed || (id === 'ready' && selected?.kind === 'ready'),
      }));
    }

    if (u.team === 'heroes') {
      const helpWhy = u.actionUsed ? 'Action already used this turn.' : u.turned ? 'Turned: can only flee.' : null;
      more.push(button({
        kind: 'help', id: 'help', name: HELP.name, cls: 'act',
        sub: 'action · ally advantage',
        tip: { kind: 'Action', chips: ['5 ft', 'advantage for an ally'], desc: HELP.desc, how: this.howTo('an enemy next to you') },
        problem: helpWhy,
        disabled: !!helpWhy,
        active: selected?.kind === 'help',
      }));
      if (u.potions > 0) {
        const feedWhy = u.actionUsed ? 'Action already used this turn.' : u.turned ? 'Turned: can only flee.' : null;
        more.push(button({
          kind: 'feed', id: 'feed', name: FEED.name, cls: 'act',
          sub: `action · ${u.potions} left`,
          tip: game.rules >= 6
            ? { kind: 'Action', chips: [`${u.potions} left`, '2d4 + 2 HP', '15 ft'], desc: FEED.toss, how: this.howTo('an ally within 15 ft') }
            : { kind: 'Action', chips: [`${u.potions} left`, '2d4 + 2 HP', '5 ft'], desc: FEED.desc, how: this.howTo('an ally next to you') },
          problem: feedWhy,
          disabled: !!feedWhy,
          active: selected?.kind === 'feed',
        }));
      }
      // Rules 6: the pedlar's alchemist's fire and caltrops, while the hero carries any.
      const supplyWhy = u.actionUsed ? 'Action already used this turn.' : u.turned ? 'Turned: can only flee.' : null;
      if (game.rules >= 6 && u.flasks > 0) {
        more.push(button({
          kind: 'flask', id: 'flask', name: ITEMS.fire.name, cls: 'act',
          sub: `action · ${u.flasks} left`,
          tip: { kind: 'Action', chips: [`${u.flasks} left`, `${signed(abilityMod(u.stats.dex) + u.prof)} to hit`, '1d4 fire, then burning', '20 ft'], desc: ITEMS.fire.desc, how: this.howTo('an enemy within 20 ft') },
          problem: supplyWhy,
          disabled: !!supplyWhy,
          active: selected?.kind === 'flask',
        }));
      }
      if (game.rules >= 6 && u.caltrops > 0) {
        more.push(button({
          kind: 'caltrops', id: 'caltrops', name: ITEMS.caltrops.name, cls: 'act',
          sub: `action · ${u.caltrops} left`,
          tip: { kind: 'Action', chips: [`${u.caltrops} left`, 'DEX 15 or stop', '10 ft'], desc: ITEMS.caltrops.desc, how: this.howTo('a floor tile within 10 ft') },
          problem: supplyWhy,
          disabled: !!supplyWhy,
          active: selected?.kind === 'caltrops',
        }));
      }
      // Rules 7: in a room with dark areas, a torch to throw and (for casters) Light.
      if (game.rules >= 7 && game.dark.size) {
        const torchWhy = u.torchThrown ? 'Your torch is thrown already.' : u.bonusUsed ? 'Bonus action already used this turn.' : u.turned ? 'Turned: can only flee.' : null;
        more.push(button({
          kind: 'torch', id: 'torch', name: 'Torch', cls: 'act',
          sub: u.torchThrown ? 'thrown' : 'bonus · once',
          tip: { kind: 'Bonus action', chips: ['once a fight', '20 ft', 'lights 10 ft'], desc: 'Throw your torch onto a tile: it lights 10 ft around it for the rest of the fight. You still see 10 ft around you.', how: this.howTo('a tile within 20 ft') },
          problem: torchWhy,
          disabled: !!torchWhy,
          active: selected?.kind === 'torch',
        }));
        if (LIGHT_CLASSES.includes(u.cls)) {
          const lightWhy = u.actionUsed ? 'Action already used this turn.' : u.turned ? 'Turned: can only flee.' : null;
          more.push(button({
            kind: 'light', id: 'light', name: 'Light', cls: 'spell',
            sub: 'cantrip · action',
            tip: { kind: 'Cantrip', chips: ['action', '30 ft', 'lights 20 ft'], desc: 'A mote of light on a tile within 30 ft: it lights 20 ft around it for the rest of the fight.', how: this.howTo('a tile within 30 ft') },
            problem: lightWhy,
            disabled: !!lightWhy,
            active: selected?.kind === 'light',
          }));
        }
      }
      // Rules 8: bar a door next to the hero, or disarm a trap they've found.
      const next = (t) => Math.max(Math.abs(t.x - u.x), Math.abs(t.z - u.z)) === 1;
      const actWhy = u.actionUsed ? 'Action already used this turn.' : u.turned ? 'Turned: can only flee.' : null;
      if (game.rules >= 8 && [...game.grid.doors.values()].some((d) => !d.barred && next(d))) {
        more.push(button({
          kind: 'bar', id: 'bar', name: 'Bar door', cls: 'act',
          sub: 'action · 5 ft',
          tip: { kind: 'Action', chips: ['shuts it', 'STR 15 to break', 'easier each try'], desc: 'Shut the door next to you and drop its bar. A monster has to break it down (STR 15, 2 easier each failed try); heroes lift it by walking through.', how: this.howTo('a door next to you') },
          problem: actWhy,
          disabled: !!actWhy,
          active: selected?.kind === 'bar',
        }));
      }
      if (game.rules >= 8 && [...game.grid.traps.values()].some((t) => t.revealed && !t.sprung && !t.rigged && Math.max(Math.abs(t.x - u.x), Math.abs(t.z - u.z)) <= 1)) {
        const bonus = u.passives.includes('trapSense') ? abilityMod(u.stats.dex) + u.prof : abilityMod(u.stats.dex);
        more.push(button({
          kind: 'disarm', id: 'disarm', name: 'Disarm', cls: 'act',
          sub: `action · ${signed(bonus)}`,
          tip: { kind: 'Action', chips: [`DEX DC ${TRAP_DC}`, `${signed(bonus)}`, 'fail by 5: it goes off'], desc: 'Work at a trap you’ve found next to you. Succeed and it’s rigged against the monsters: heroes cross it safely and the next monster to step on it sets it off. Fail by 5 or more and it goes off on you.', how: this.howTo('a trap next to you') },
          problem: actWhy,
          disabled: !!actWhy,
          active: selected?.kind === 'disarm',
        }));
      }
      // Rules 7: smash a barrel or crate next to the hero.
      if (game.rules >= 7 && [...game.grid.props.values()].some((p) => PROP_HP[p.kind] && Math.max(Math.abs(p.x - u.x), Math.abs(p.z - u.z)) === 1)) {
        const smashWhy = u.actionUsed ? 'Action already used this turn.' : u.turned ? 'Turned: can only flee.' : null;
        more.push(button({
          kind: 'smash', id: 'smash', name: 'Smash', cls: 'act',
          sub: 'action · 5 ft',
          tip: { kind: 'Action', chips: ['always hits', 'barrel 5 HP', 'crate 8 HP'], desc: 'Break a barrel or crate next to you with your melee weapon. Broken, it leaves open floor: no cover, nowhere to hide.', how: this.howTo('a barrel or crate next to you') },
          problem: smashWhy,
          disabled: !!smashWhy,
          active: selected?.kind === 'smash',
        }));
      }
    }

    // Open while the player wants it, or while one of its moves is picked.
    const open = this.moreOpen || more.some((b) => b.includes(' selected"'));
    if (more.length) {
      const names = [...more.join('').matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1]);
      acts.push(`<button type="button" class="ability more ${open ? 'open' : ''}" data-kind="more" data-id="more"
        aria-expanded="${open}" aria-description="${esc(names.join(', '))}"><span>${open ? 'Less' : 'More'}</span><small>${open ? 'hide' : `${more.length} more`}</small></button>`);
    }
    const html = group('Attack', atks) + (spells.length ? group('Spells', spells) : '') + group('Actions', acts)
      + (open && more.length ? group('More', more) : '');
    // The first ten buttons answer the number keys 1-9 and 0, in the order shown (see pickByNumber).
    let n = 0;
    return html.replace(/<button type="button" class="ability[^>]*>/g, (tag) => (++n > 10 ? tag
      : `${tag.slice(0, -1)} aria-keyshortcuts="${n % 10}"><kbd class="key" aria-hidden="true">${n % 10}</kbd>`));
  }

  /**
   * Number key `n` (1-10, 10 for the 0 key): press the action bar's nth button. Returns what to read out (its name,
   * and why not when it can't be used), or null when there's no such button.
   */
  pickByNumber(n) {
    const b = document.querySelectorAll('#attacks button.ability')[n - 1];
    if (!b) return null;
    const name = b.querySelector('span').textContent;
    if (b.disabled) return `${name}: ${b.getAttribute('aria-description') || 'not now'}`;
    const was = b.classList.contains('selected');
    b.click(); // the bar is drawn afresh: look again for what's picked
    const picked = document.querySelector('#attacks button.ability.selected span')?.textContent === name;
    return picked ? `${name} picked` : was ? `${name} put away` : name;
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
    else notes.push(`Disadvantage while an enemy is next to you${weapon && game.rules >= 2 ? `, or past ${atk.reach * 5} ft (long range, up to ${longReach(atk) * 5} ft)` : ''}.`);
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
        melee ? 'reach 5 ft' : `range ${atk.reach * 5}${weapon && game.rules >= 2 ? `/${longReach(atk) * 5}` : ''} ft`],
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
    if (kind === 'more') {
      this.moreOpen = b.getAttribute('aria-expanded') !== 'true';
      // Folding it puts away a move picked from it (Grapple, Help, Give potion), which redraws the bar.
      const picked = b.closest('#attacks').querySelector('.group:last-child button.selected');
      if (!this.moreOpen && picked) this.handlers.onChoose({ kind: picked.dataset.kind });
      else this.renderActionBar(...this.lastBar);
      return;
    }
    if (kind === 'attack' && this.readying) this.handlers.onChoose({ kind: 'readyAttack', attack: Number(id) });
    else if (kind === 'spell' && this.readying && !this.lastBar[0].readySpellProblem(this.current, id)) {
      this.handlers.onChoose({ kind: 'readySpell', id });
    }
    else if (kind === 'attack') this.handlers.onChoose({ kind, attack: this.current.attacks[Number(id)] });
    else if (['shove', 'push', 'grapple', 'help', 'feed', 'flask', 'caltrops', 'torch', 'light', 'smash', 'bar', 'disarm', 'ready', 'smite', 'rebuke'].includes(kind)) this.handlers.onChoose({ kind });
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
    b.querySelector(':scope > span:not(.corner-tip)').textContent = on ? 'Sound' : 'Muted';
  }

  /**
   * The line above the action bar. `act`: it previews something a click would do; on a
   * touch screen that takes a second tap, so the hint says so.
   */
  hint(text, act = false, { warn = false } = {}) {
    if (this.touch && text) {
      text = text.replace(/\bclick\b/g, 'tap').replace(/\bClick\b/g, 'Tap').replace(/ with the mouse/g, '').replace(' · Esc to cancel', '');
      if (act) text += ' · tap again to confirm';
    } else if (this.keys && text) { // the keyboard: the cursor picks, Enter confirms
      text = text.replace(/\bclick\b/g, 'pick').replace(/\bClick\b/g, 'Pick').replace(/ with the mouse/g, '');
      const ok = this.pad ? 'A' : 'Enter'; // a gamepad presses Enter with A (gamepad.js)
      if (act) text += this.armed ? ` · ${ok} again to confirm` : ` · ${ok} to choose`;
    }
    $('#hint').textContent = text;
    $('#hint').classList.toggle('show', !!text);
    $('#hint').classList.toggle('warn', !!text && warn); // a move that would hurt the hero badly
  }

  /** The hint line as shown (what the keyboard cursor reads out). */
  hintText() {
    return $('#hint').textContent;
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

  /** End-of-fight banner (see banner.js). `final`: the last room of the campaign. */
  banner(result, opts) {
    this.hint(''); // a last tap's preview would show through the card
    this.end.show(result, opts);
  }

  /** Level title card in the log. */
  levelIntro({ name, intro }, partyLevel) {
    this.log(`<b class="level">${esc(name)}</b> <span class="dice">party level ${partyLevel}</span><br>${esc(intro)}`, 'sys');
  }
}
