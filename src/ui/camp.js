// Between fights: the dungeon map, the party, the pack of loot, and what just happened.
// Also the title screen. Plain HTML/SVG; all state changes go through the handlers.

import { bestiaryLabel } from './bestiaryLabel.js';
import { canTrade } from '../game/shop.js';
import { Overlay } from './overlay.js';
import {
  NODES, choices, mapEdges, nodeName, heroUnit, HERO_CODES, XP_LEVELS, levelForXp, equipProblem, equipPreview, DIFFICULTIES, difficultyLabel,
  cleanName, roomElite, EVENTS, eventProblem, openPicks, pickOptions,
} from '../game/campaign.js';
import { TEMPLATES, CLASS_CHOICES, ABILITY_NAMES } from '../game/units.js';
import { ITEMS, RELICS } from '../game/items.js';
import { MAX_LEVEL } from '../game/units.js';
import { levelById } from '../game/maps.js';
import { tips } from './tips.js';
import { UnitTip } from './unitTip.js';
import { announce } from './announce.js';
import { loadHistory, loadDeepest, deepestLabel } from '../game/history.js';
import { ACHIEVEMENTS, loadAchievements } from '../game/achievements.js';
import { dayKey, dailyPlan, loadDaily, streak, bestFight, loadBestFights, resultFor } from '../game/daily.js';
import { weekKey, weeklyPlan, loadWeekly, weekStreak } from '../game/weekly.js';
import { ELITE_TRAITS } from '../game/elites.js';
import { loadEndless, loadBestFloor, nextFloor, levelOf, restFloor, floorTier } from '../game/endless.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ordinal = (n) => ['', '1st', '2nd', '3rd'][n] ?? `${n}th`;

const COLS = Math.max(...Object.values(NODES).map((n) => n.col)) + 1;
const COL_W = 104;
const MAP_W = COL_W * COLS;
const pos = (id) => ({ x: COL_W / 2 + NODES[id].col * COL_W, y: 40 + NODES[id].row * 82 });

/** Small glyphs drawn inside the map nodes. */
const GLYPH = {
  fight: '<path d="M-7 -7 L7 7 M7 -7 L-7 7 M-8 4 L-4 8 M8 4 L4 8" />',
  rest: '<path d="M0 -8 V8 M-6 -2 H6" />',
  boss: '<path d="M-8 5 H8 L9 -5 L4 -1 L0 -7 L-4 -1 L-9 -5 Z" />',
  event: '<path d="M-4 -4 A4 4 0 1 1 1 0 Q0 1 0 3 M0 7.5 V8" />', // a question mark: a stop with a choice
};

/** What each choice at a stop with no fight did, for the camp's report. */
const EVENT_NEWS = {
  'pilgrim:tend': 'You bind the pilgrim’s leg and give him a potion. He swears he’ll find you after the Sanctum.',
  'pilgrim:rob': 'You take the pilgrim’s purse: two potions, shared out. He curses you as you go.',
  'altar:offer': 'Each hero bleeds on the altar, a quarter of their HP maximum. The party is blessed for its next fight: +1 to hit and +1 AC.',
  'reliquary:open': 'The Iron Key turns. Inside lies a Periapt of Wound Closure; hand it out from the pack.',
};

/** One line on what each swappable class brings, for the title screen's class picker. */
const CLASS_BLURB = {
  F: 'Fighter: the most HP, Second Wind to heal mid-fight, Extra Attack at level 5.',
  P: 'Paladin: Divine Smite burns spell slots for radiant damage, Lay on Hands and Shield of Faith protect the party, Aura of Protection at level 6.',
  W: 'Wizard: the most spell slots: Magic Missile, Burning Hands, Misty Step and Shield, then Fireball and Lightning Bolt at level 5.',
  K: 'Warlock: two strong pact slots that come back after every room, Eldritch Blast, Hex and Hellish Rebuke, and temporary HP for every kill. Fireball and two beams at level 5.',
  R: 'Rogue: Sneak Attack, hides as a bonus action and slips past monsters unseen, spots traps.',
  A: 'Ranger: a longbow with Archery, Hunter’s Mark for extra damage on one foe, spots traps. Extra Attack and Colossus Slayer at level 5.',
  C: 'Cleric: heavy armour and the party’s healer: Cure Wounds, Healing Word, Sacred Flame and Turn Undead. Spiritual Weapon and Mass Healing Word at level 5.',
  B: 'Bard: Bardic Inspiration turns an ally’s near miss or failed save, Cutting Words spoils a foe’s hit, Vicious Mockery, Shatter and Healing Word. Fear at level 5.',
  Z: 'Barbarian: Rage for extra damage and half damage from weapons, Reckless Attack for advantage (and to be hit), Danger Sense and a bonus Frenzy attack. Extra Attack at level 5.',
  S: 'Sorcerer: fire spells (Fire Bolt, Burning Hands, Scorching Ray), Shield, and sorcery points to Quicken a spell into a bonus action. Fireball at level 5.',
  M: 'Monk: fast, unarmoured, with a free unarmed strike after attacking and ki for Flurry of Blows, Patient Defense and Step of the Wind; catches arrows. Stunning Strike at level 5.',
  D: 'Druid: Entangle holds foes, Thunderwave knocks them down, Healing Word and Cure Wounds mend, Shillelagh in hand. Call Lightning at level 5.',
};

/** A selector for a camp control that a redraw replaces, to focus its new copy (null: leave focus). */
function focusKey(el) {
  if (!el?.closest?.('#camp')) return null;
  for (const a of ['data-node', 'data-enter', 'data-equip', 'data-unequip', 'data-pick']) {
    if (el.hasAttribute(a)) return `#camp [${a}="${el.getAttribute(a)}"]`;
  }
  return el.id ? `#${el.id}` : null;
}

/** The name field's spoken label: "Fighter's name (Brannoc if left blank)". */
const nameLabel = (cls) => `${TEMPLATES[cls].cls}’s name (${TEMPLATES[cls].name} if left blank)`;

export class Camp {
  constructor({ onEnter, onEquip, onUnequip, onNewCampaign, onContinue, onDaily, onWeekly, onWatch, onShareFight, onNewGamePlus, onTrade, onEndless, onEndDive, onPick }) {
    this.h = { onEnter, onEquip, onUnequip, onNewCampaign, onContinue, onDaily, onWeekly, onWatch, onShareFight, onNewGamePlus, onTrade, onEndless, onEndDive, onPick };
    this.selected = null;
    this.confirmNew = false;
    $('#camp').addEventListener('click', (ev) => this.onClick(ev));
    // A room on the map names itself on hover in a card of the camp's own, not the browser's
    // tooltip, which would stay up over the fight when the room is entered.
    this.mapTip = new UnitTip();
    this.mapTip.el.id = 'map-tip';
    $('#camp').addEventListener('pointerover', (ev) => {
      if (ev.pointerType !== 'mouse') return;
      const node = ev.target.closest?.('[data-node]');
      if (!node) return this.mapTip.hide();
      this.mapTip.hover(`node:${node.dataset.node}`, () => node.dataset.card, () => node.querySelector('circle').getBoundingClientRect(), 'below');
    });
    $('#camp').addEventListener('pointerleave', () => this.mapTip.hide());
    $('#camp').addEventListener('keydown', (ev) => {
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.closest?.('[data-node]')) {
        ev.preventDefault();
        this.onClick(ev);
      }
    });
    $('#title').addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (b?.id === 'title-continue') this.h.onContinue();
      if (b?.id === 'title-ngplus') this.h.onNewGamePlus(b);
      if (b?.id === 'title-endless') this.h.onEndless();
      if (b?.id === 'title-daily-play') this.h.onDaily();
      if (b?.id === 'title-weekly-play') this.h.onWeekly();
      if (b?.dataset.best) {
        const fight = this.best?.[b.dataset.best];
        if (fight) this.h.onShareFight(fight, b, b.dataset.kind);
      }
      if (b?.id === 'title-daily-watch' || b?.id === 'title-weekly-watch') {
        const fight = this.best?.[b.id === 'title-daily-watch' ? 'daily' : 'weekly'];
        if (fight) this.h.onWatch(fight);
      }
      if (b?.id === 'title-new') this.titleStep('setup');
      if (b?.id === 'setup-back') this.titleStep('main');
      if (b?.id === 'setup-start') this.h.onNewCampaign(this.difficulty, this.names(), { ...this.classes });
      if (b?.id === 'title-runs') this.runsPanel.open(b);
      if (b?.id === 'title-achievements') this.awardsPanel.open(b);
      if (b?.dataset.cls) this.pickClass(b.dataset.slot, b.dataset.cls);
    });
    this.runsPanel = new Overlay($('#title-history'));
    $('#title-history').addEventListener('click', (ev) => {
      const link = ev.target.closest('button[data-link]');
      if (link) {
        const run = this.runs?.[Number(link.dataset.link)];
        if (run?.fight) this.h.onShareFight(run.fight, link);
        return;
      }
      const b = ev.target.closest('button[data-watch]');
      if (!b) return;
      const run = this.runs?.[Number(b.dataset.watch)];
      if (!run?.fight) return;
      this.runsPanel.close();
      this.h.onWatch(run.fight);
    });
    this.awardsPanel = new Overlay($('#title-awards'));
    $('#title-tips').addEventListener('change', (ev) => tips.setOn(ev.target.checked));
    $('#title-difficulty').addEventListener('change', (ev) => {
      this.difficulty = ev.target.value;
      this.renderDifficulty();
    });
  }

  get open() {
    return !$('#camp').hidden || !$('#title').hidden;
  }

  // --- title ------------------------------------------------------------------
  /** The title's two steps: 'main' (continue, daily, records) or 'setup' (a new campaign). */
  titleStep(step) {
    $('#title-main').hidden = step !== 'main';
    $('#title-setup').hidden = step !== 'setup';
    $(step === 'setup' ? '#setup-start' : '#title-new').focus();
  }

  /** The Story / Normal / Hard picker; the choice is remembered for the next new run. */
  renderDifficulty() {
    this.difficulty ??= 'normal';
    $('#title-difficulty .seg').innerHTML = Object.entries(DIFFICULTIES).map(([id, d]) => `
      <label><input type="radio" name="difficulty" value="${id}"${id === this.difficulty ? ' checked' : ''}>
      <span>${esc(d.name)}</span></label>`).join('');
    $('#difficulty-desc').textContent = DIFFICULTIES[this.difficulty].desc;
  }

  /** The names typed for a new run, by hero code (blank ones are left out). */
  names() {
    const out = {};
    for (const input of document.querySelectorAll('#title-names input')) {
      const name = cleanName(input.value);
      if (name) out[input.dataset.code] = name;
    }
    return out;
  }

  renderNames() {
    const grid = $('#title-names .name-grid');
    if (grid.children.length) return; // keep whatever was typed
    this.classes = {};
    grid.innerHTML = HERO_CODES.map((code) => {
      const options = CLASS_CHOICES[code];
      const head = options.length > 1
        ? `<span class="cls-pick" role="group" aria-label="${options.map((c) => TEMPLATES[c].cls).join(' or ')}">${options.map((c) => `
            <button type="button" data-slot="${code}" data-cls="${c}" data-hint="${esc(CLASS_BLURB[c])}"
              aria-pressed="${c === code}">${esc(TEMPLATES[c].cls)}</button>`).join('')}</span>`
        : `<small>${esc(TEMPLATES[code].cls)}</small>`;
      // A div, not a label: a label would name (and click) the first class button.
      return `<div class="name-slot">${head}
      <input type="text" data-code="${code}" maxlength="14" placeholder="${esc(TEMPLATES[code].name)}" aria-label="${esc(nameLabel(code))}" autocomplete="off" spellcheck="false"></div>`;
    }).join('');
  }

  /** Swap the class that fills a hero slot for the next new run. */
  pickClass(slot, cls) {
    this.classes[slot] = cls;
    for (const b of document.querySelectorAll(`#title-names [data-slot="${slot}"]`)) {
      b.setAttribute('aria-pressed', String(b.dataset.cls === cls));
    }
    const input = document.querySelector(`#title-names input[data-code="${slot}"]`);
    input.placeholder = TEMPLATES[cls].name;
    input.setAttribute('aria-label', nameLabel(cls));
  }

  /** `won`: a won run kept for New Game+ (offered until a new campaign starts). */
  showTitle(save, won = null) {
    this.difficulty ??= save?.difficulty ?? 'normal';
    this.renderDifficulty();
    this.renderNames();
    $('#camp').hidden = true;
    $('#title').hidden = false;
    $('#title-continue').hidden = !save;
    $('#title-ngplus').hidden = !won;
    $('#title-ngplus').textContent = won ? `New Game+ (${difficultyLabel(won.difficulty, (won.tier ?? 0) + 1)})` : 'New Game+';
    // The Endless Crypt opens with a won campaign, and stays open while a dive is under way.
    const dive = loadEndless();
    const best = loadBestFloor();
    $('#title-endless').hidden = !won && !dive;
    $('#title-endless').textContent = dive ? `Endless Crypt: floor ${dive.endless.floor}` : 'Endless Crypt';
    if (best) $('#title-endless').dataset.hint = `Deepest floor cleared: ${best}`;
    else delete $('#title-endless').dataset.hint;
    $('#title-tips').checked = tips.on;
    tips.hide();
    $('#title-save').textContent = save
      ? `Saved run (${difficultyLabel(save.difficulty, save.tier)}): party level ${save.party.F.level}, ${save.cleared.length} room${save.cleared.length === 1 ? '' : 's'} cleared, ${save.xp} XP`
        + (save.fight ? `. Mid-fight in ${nodeName(save.fight.node)}.` : '')
      : deepestLabel(loadDeepest()) ? `Deepest win: ${deepestLabel(loadDeepest())}` : '';
    $('#setup-warn').hidden = !save;
    $('#title-main').hidden = false;
    $('#title-setup').hidden = true;
    this.renderHistory(loadHistory());
    this.renderAwards(loadAchievements());
    bestiaryLabel($('#title-bestiary'));
    this.best = {};
    this.renderDaily();
    this.renderWeekly();
    // Back from a run: focus was on something now hidden. (Not on page load, where a ring
    // would show for the mouse too.)
    if (document.activeElement !== document.body && !document.activeElement?.checkVisibility?.()) {
      (save ? $('#title-continue') : won ? $('#title-ngplus') : $('#title-new')).focus();
    }
  }

  /** Today's crypt: which room, the party, and the day's best result and the streak so far. */
  renderDaily() {
    const plan = dailyPlan(dayKey());
    const results = loadDaily();
    const today = resultFor(results, plan.key, plan.node);
    const party = [plan.classes.F ? 'a Paladin' : 'a Fighter', plan.classes.W ? 'a Warlock' : 'a Wizard', plan.classes.R ? 'a Ranger' : 'a Rogue', 'a Cleric'];
    const box = $('#title-daily');
    box.querySelector('.daily-date').textContent = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    box.querySelector('.daily-room').textContent =
      `${levelById(NODES[plan.node].level).name}, with ${party.slice(0, 3).join(', ')} and ${party[3]} at level ${plan.level}. The same for everyone today.`;
    const run = streak(today ? results : { ...results, [plan.key]: null }, plan.key);
    const rounds = (n) => `${n} round${n === 1 ? '' : 's'}`;
    box.querySelector('.daily-result').textContent = today
      ? (today.won ? `Best today: won in ${rounds(today.rounds)}` : `Not won yet today (${today.tries} ${today.tries === 1 ? 'try' : 'tries'})`)
        + (run ? ` · Streak: ${run} day${run === 1 ? '' : 's'}` : '')
      : run ? `Streak: ${run} day${run === 1 ? '' : 's'}. Win today to keep it going.` : 'Not played yet today.';
    $('#title-daily-play').textContent = today?.won ? 'Play it again' : 'Play today’s crypt';
    this.showBest('daily', plan.key, plan.node);
  }

  /** This week's elite crypt: the trait, room and party, and the week's best and the streak so far. */
  renderWeekly() {
    const plan = weeklyPlan(weekKey());
    const results = loadWeekly();
    const week = resultFor(results, plan.key, plan.node); // not one from before a rules change moved the room
    const trait = ELITE_TRAITS.find((t) => t.id === plan.trait);
    const party = [plan.classes.F ? 'a Paladin' : 'a Fighter', plan.classes.W ? 'a Warlock' : 'a Wizard', plan.classes.R ? 'a Ranger' : 'a Rogue', 'a Cleric'];
    const box = $('#title-weekly');
    const [y, m, d] = plan.key.split('-').map(Number);
    const first = new Date(y, m - 1, d);
    const last = new Date(y, m - 1, d + 6);
    const day = (date) => date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    box.querySelector('.daily-date').textContent = first.getMonth() === last.getMonth()
      ? `${first.toLocaleDateString(undefined, { month: 'short' })} ${first.getDate()}–${last.getDate()}` : `${day(first)} – ${day(last)}`;
    box.querySelector('.daily-room').textContent =
      `${levelById(NODES[plan.node].level).name} at New Game+ ${plan.tier}, with a ${trait.name} elite. ${party.slice(0, 3).join(', ').replace(/^a/, 'A')} and ${party[3]} at level ${plan.level}.`;
    box.querySelector('.daily-trait').innerHTML = `<b>${esc(trait.name)}:</b> ${esc(trait.desc)}.`;
    const run = weekStreak(week ? results : { ...results, [plan.key]: null }, plan.key); // nor in the streak
    const rounds = (n) => `${n} round${n === 1 ? '' : 's'}`;
    const weeks = (n) => `${n} week${n === 1 ? '' : 's'}`;
    box.querySelector('.daily-result').textContent = week
      ? (week.won ? `Best this week: won in ${rounds(week.rounds)}` : `Not won yet this week (${week.tries} ${week.tries === 1 ? 'try' : 'tries'})`)
        + (run ? ` · Streak: ${weeks(run)}` : '')
      : run ? `Streak: ${weeks(run)}. Win this week to keep it going.` : 'The same for everyone this week. Not played yet.';
    $('#title-weekly-play').textContent = week?.won ? 'Play it again' : 'Play this week’s crypt';
    this.showBest('weekly', plan.key, plan.node);
  }

  /** Watch your best and its links under a daily or weekly box, when its best win was kept. */
  showBest(mode, key, node) {
    const fight = bestFight(loadBestFights(), mode, key, node);
    this.best = { ...this.best, [mode]: fight };
    $(`#title-${mode}-best`).hidden = !fight;
    if (!fight) return;
    $(`#title-${mode}-watch`).setAttribute('aria-label', `Watch your best ${mode} fight again`);
    // A link needs how the fight ended (kept since links began); an older fight just can't be shared.
    for (const b of $(`#title-${mode}-best`).querySelectorAll('.daily-link')) {
      b.hidden = !fight.check;
      b.setAttribute('aria-label', `${b.dataset.kind === 'play' ? 'Copy a challenge link to' : 'Copy a replay link to'} your best ${mode} fight`);
    }
  }

  /** Every achievement: unlocked ones in gold with the date, the rest dimmed, as goals. */
  renderAwards(have) {
    const box = $('#title-awards');
    const n = ACHIEVEMENTS.filter((a) => have[a.id]).length;
    $('#title-achievements').textContent = `Achievements (${n}/${ACHIEVEMENTS.length})`;
    $('#awards-head').textContent = `Achievements (${n}/${ACHIEVEMENTS.length})`;
    box.querySelector('.awards').innerHTML = ACHIEVEMENTS.map((a) => {
      const when = have[a.id] && new Date(have[a.id]).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      return `<li class="${when ? 'got' : 'locked'}">
        <span class="award-mark" aria-hidden="true">${when ? '★' : '☆'}</span>
        <span><b>${esc(a.name)}</b>${when ? `<span class="muted"> · ${when}</span>` : '<span class="sr-only"> (locked)</span>'}<small>${esc(a.desc)}</small></span>
      </li>`;
    }).join('');
  }

  /** Past runs, newest first: how each ended, how far the party got, and who was in it. */
  renderHistory(runs) {
    const box = $('#title-history');
    this.runs = runs;
    $('#title-runs').textContent = `Past runs (${runs.length})`;
    $('#title-runs').hidden = runs.length === 0; // nothing to show until a run has ended
    const deepest = deepestLabel(loadDeepest());
    $('#history-deepest').hidden = !deepest;
    $('#history-deepest').textContent = deepest ? `Deepest win: ${deepest}` : '';
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    box.querySelector('.runs').innerHTML = runs.map((r, i) => {
      const date = new Date(r.when).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      const how = r.result === 'won'
        ? '<b class="won">Victory</b>'
        : `<b class="lost">Abandoned</b>${r.reached ? ` after ${esc(r.reached)}` : ''}`;
      const party = (r.heroes ?? []).map((h) => `${esc(h.name)} <small>${esc(h.cls)}</small>`).join(', ');
      return `<li>
        <div class="run-head"><span>${how}</span><span class="muted">${esc(r.difficulty)} · ${date}</span></div>
        <div class="run-stats">Party level ${r.level} · ${plural(r.won, 'room')} won · ${plural(r.rounds, 'round')}`
        + (Number.isInteger(r.elites) && r.elites > 0 ? ` · ${plural(r.elites, 'elite')} slain` : '')
        + (r.mvp ? ` · most damage: ${esc(r.mvp.name)} (${r.mvp.damage})` : '') + `</div>
        <div class="run-party">${party}</div>`
        + (r.fight && NODES[r.fight.node] ? `<button type="button" class="watch-run" data-watch="${i}">Watch the last fight: ${esc(nodeName(r.fight.node))}`
          + ` <small>${r.fight.result === 'victory' ? 'won' : 'lost'}</small></button>`
          + (r.fight.check ? ` <button type="button" class="watch-run quiet" data-link="${i}">Copy link</button>` : '') : '')
        + `</li>`;
    }).join('');
  }

  hide() {
    this.mapTip.hide();
    $('#camp').hidden = true;
    $('#title').hidden = true;
  }

  // --- camp -------------------------------------------------------------------
  /** report: from completeFight ({ xp, levelUps, loot }), { rest: id }, or null. */
  show(state, report = this.report) {
    const had = focusKey(document.activeElement); // the redraw replaces it: put focus back after
    this.state = state;
    this.report = report;
    const deep = !!state.endless; // a dive in the Endless Crypt: its floors instead of the map
    const options = deep ? ['deep'] : choices(state);
    if (!options.includes(this.selected)) this.selected = options[0] ?? null;
    this.confirmNew = false;
    $('#title').hidden = true;
    $('#camp').hidden = false;
    $('#camp-report').innerHTML = this.reportHtml(state, report);
    const map = $('#camp-map');
    map.innerHTML = deep ? this.floorsHtml(state) : this.mapSvg(state, options);
    // The acts don't fit a narrow panel at a readable size: scroll to where the party is.
    const here = state.at && !deep ? pos(state.at).x : 0;
    map.scrollLeft = Math.max(0, here * (map.scrollWidth / MAP_W) - map.clientWidth / 2);
    $('#camp-room').innerHTML = deep ? this.floorHtml(state) : this.roomHtml(state);
    $('#camp-party').innerHTML = this.partyHtml(state);
    $('#camp-pack').innerHTML = this.packHtml(state);
    $('#camp-pack-box').hidden = !state.pack.length; // nothing to hand out
    const relics = state.relics ?? [];
    $('#camp-relics-box').hidden = !relics.length;
    $('#camp-relics').innerHTML = relics.map((id) => {
      const asleep = id === 'phylactery' && state.phylacterySpent;
      return `<div class="relic-item${asleep ? ' asleep' : ''}"><b class="relic">${esc(RELICS[id].name)}</b>${asleep ? ' <span class="relic-state">spent until the next long rest</span>' : ''}<small>${esc(RELICS[id].desc)}</small></div>`;
    }).join('');
    $('#camp-new').textContent = deep ? 'End the dive' : 'Abandon run';
    bestiaryLabel($('#camp-bestiary'));
    // The pedlar trades at the rest stops and after each act's boss.
    $('#camp-trade').hidden = !canTrade(state);
    const returned = had?.includes('data-unequip') && document.querySelector('#camp-pack .pack-item:last-child [data-equip]:not([disabled])');
    if (had) (document.querySelector(had) ?? (returned || this.firstControl()))?.focus();
  }

  /** Back at camp after a room (or at the start of a run): focus on the way on, and say what happened. */
  arrive(state, report) {
    this.show(state, report);
    this.firstControl()?.focus();
    const lvl = levelForXp(state.xp);
    const next = XP_LEVELS[lvl + 1];
    const news = [...$('#camp-report').children].filter((e) => !e.classList.contains('xp'))
      .map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' ');
    announce(`Camp. Party level ${lvl}, ${state.xp}${next ? ` of ${next}` : ''} XP. ${news}`
      + (state.endless ? ` Next: floor ${state.endless.floor}.` : this.selected ? ` Next: ${nodeName(this.selected)}.` : ''));
  }

  /** Where focus goes when the camp opens or a focused control is gone: the way on, or the pack. */
  firstControl() {
    return document.querySelector('#camp-room [data-enter]:not([disabled]), #camp-pack [data-equip]:not([disabled]), #camp-new');
  }

  reportHtml(state, report) {
    const lvl = levelForXp(state.xp);
    const next = XP_LEVELS[lvl + 1];
    const prev = XP_LEVELS[lvl] ?? 0;
    const pct = next ? ((state.xp - prev) / (next - prev)) * 100 : 100;
    const bar = `<div class="xp" data-hint="Party XP">
      <span>Party level <b>${lvl}</b></span>
      <span class="xpbar"><i style="width:${pct}%"></i></span>
      <span>${next ? `${state.xp} / ${next} XP` : `${state.xp} XP · max level`} · <b class="gold">${state.gold ?? 0} gold</b> · ${esc(difficultyLabel(state.difficulty ?? 'normal', state.tier))}</span>
    </div>`;
    let news = '';
    if (report?.event) {
      news = `<p><b>${esc(nodeName(report.event))}.</b> ${esc(EVENT_NEWS[`${report.event}:${report.option}`])}</p>`;
    } else if (report?.rest) {
      news = `<p><b>${esc(nodeName(report.rest))}.</b> ${esc(NODES[report.rest].intro)} Full HP and every spell slot back.</p>`;
    } else if (report) {
      const found = [
        ...(report.potions ? [`<b class="loot">${report.potions} potion${report.potions > 1 ? 's' : ''} of healing</b> (shared out)`] : []),
        ...report.loot.map((i) => `<b class="loot">${esc(ITEMS[i].name)}</b>`),
      ];
      const parts = [`<p>${report.floor ? `Floor ${report.floor} cleared` : 'Room cleared'}: <b>+${report.xp} XP</b>${report.gold ? `, <b class="gold">+${report.gold} gold</b>` : ''}. ${report.longRest
        ? 'Long rest: full HP and every spell slot back.'
        : state.relics?.includes('jar') ? 'Short rest, with the Embalming Jar: three-quarters of everyone’s missing HP back.' : 'Short rest: half of everyone’s missing HP back.'}${found.length ? ` Found ${found.join(', ')}${report.loot.length ? '; hand it out from the pack' : ''}.` : ''}</p>`];
      if (report.banter) parts.push(`<p>${report.banter.map(([n, l]) => `<b>${esc(n)}:</b> “${esc(l)}”`).join('<br>')}</p>`);
      if (report.blessed) parts.push('<p>The altar’s blessing fades.</p>');
      if (report.pilgrim) parts.push('<p>The pilgrim you tended finds you again: <b class="loot">a potion for every hero</b>.</p>');
      if (report.phylactery === 'spent') parts.push(`<p><b class="relic">${esc(RELICS.phylactery.name)}</b> is spent: it sleeps until the next long rest.</p>`);
      if (report.phylactery === 'ready') parts.push(`<p><b class="relic">${esc(RELICS.phylactery.name)}</b> wakes with the long rest.</p>`);
      if (report.relic) parts.push(`<p>Relic found: <b class="relic">${esc(RELICS[report.relic].name)}</b>. ${esc(RELICS[report.relic].desc)}</p>`);
      if (report.levelUps.length) {
        parts.push(`<div class="levelups"><b>Level up!</b><ul>${report.levelUps.map((l) =>
          `<li><b>${esc(l.name)}</b> reaches level ${l.level}: ${esc(l.note)}${l.asi ? '. Or raise another ability: choose on their card' : ''}</li>`).join('')}</ul></div>`);
      }
      news = parts.join('');
    } else if (!state.at && state.endless) {
      news = '<p>Below the labyrinth the stairs go on down, into rooms no map shows. Every floor is deeper and deadlier; every third ends in a long rest, and the pedlar. The dive ends when the party falls.</p>';
    } else if (!state.at) {
      news = '<p>The crypt waits below. Choose your way on the map; the party rests and shares XP between rooms. Progress is saved after every room.</p>';
    }
    return bar + news;
  }

  mapSvg(state, options) {
    const cleared = new Set(state.cleared);
    const walked = new Set();
    state.cleared.forEach((c, i) => { if (i) walked.add(`${state.cleared[i - 1]}>${c}`); });
    const edges = mapEdges().map(({ from, to }) => {
      const a = pos(from);
      const b = pos(to);
      const done = walked.has(`${from}>${to}`) || walked.has(`${to}>${from}`);
      const open = (state.at === from && options.includes(to)) || (state.at === to && options.includes(from));
      const cls = done ? 'done' : open ? 'open' : '';
      return `<line class="edge ${cls}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`;
    }).join('');
    const nodes = Object.entries(NODES).map(([id, n]) => {
      const p = pos(id);
      const kind = n.kind === 'rest' || n.kind === 'event' ? n.kind : n.boss ? 'boss' : 'fight';
      const state_ = cleared.has(id) ? 'cleared' : options.includes(id) ? 'available' : 'locked';
      const cls = ['node', kind, state_, id === state.at ? 'here' : '', id === this.selected ? 'selected' : ''].join(' ');
      const label = n.short ?? nodeName(id).replace(/^The /, '');
      const elite = cleared.has(id) ? null : roomElite(id, state.tier); // New Game+ 2 and deeper
      const r = kind === 'boss' ? 21 : 18;
      const spoken = `${nodeName(id)}, ${{ rest: 'a rest', event: 'a stop with no fight', boss: 'the boss room', fight: 'a room' }[kind]}`
        + `${{ cleared: ', cleared', available: ', open', locked: '' }[state_]}${id === state.at ? ', the party is here' : ''}`
        + `${elite ? `, elite: ${elite.name}` : ''}`;
      const role = state_ === 'available'
        ? `tabindex="0" role="button" aria-pressed="${id === this.selected}"` : 'role="img"';
      const card = `<div class="tip-head"><b>${esc(nodeName(id))}</b><small>${{ rest: 'A rest', event: 'A stop with no fight', boss: 'The boss room', fight: 'A room' }[kind]}`
        + `${{ cleared: ' · cleared', available: ' · open', locked: '' }[state_]}${id === state.at ? ' · the party is here' : ''}</small></div>`
        + (elite ? `<p class="tip-note">Elite: ${esc(elite.name)}</p>` : '');
      return `<g class="${cls}" data-node="${id}" data-card="${esc(card)}" transform="translate(${p.x} ${p.y})" ${role} aria-label="${esc(spoken)}">
        <circle r="${r}" />
        <g class="glyph">${GLYPH[kind]}</g>
        ${cleared.has(id) ? '<path class="tick" d="M10 -14 l4 4 l8 -9" />' : ''}
        ${elite ? `<circle class="elite-pip" cx="${-r * 0.72}" cy="${-r * 0.72}" r="4.5" />` : ''}
        <text y="${kind === 'boss' ? 38 : 34}">${esc(label)}</text>
      </g>`;
    }).join('');
    return `<svg viewBox="0 0 ${MAP_W} 248" role="group" aria-label="Dungeon map">${edges}${nodes}</svg>`;
  }

  roomHtml(state) {
    const id = this.selected;
    if (!id) return '<p class="muted">No way onward.</p>';
    const n = NODES[id];
    if (n.kind === 'event') {
      const e = EVENTS[id];
      const opts = Object.entries(e.options).map(([opt, o]) => {
        const why = eventProblem(state, id, opt);
        return `<button type="button" class="primary event-choice" data-enter="${id}:${opt}" ${why ? 'disabled' : ''}>
          <b>${esc(o.label)}</b><small>${esc(why ?? o.desc)}</small></button>`;
      }).join('');
      return `<h3>${esc(nodeName(id))}</h3>
        <p>${esc(e.intro)}</p>
        <p class="teaser">${esc(e.teaser)}</p>
        <div class="event-choices">${opts}</div>`;
    }
    const intro = n.kind === 'rest' ? n.intro : levelById(n.level).intro;
    const verb = n.verb ?? `Enter ${nodeName(id)}`;
    const elite = roomElite(id, state.tier);
    return `<h3>${esc(nodeName(id))}</h3>
      <p>${esc(intro)}</p>
      ${n.teaser ? `<p class="teaser">${esc(n.teaser)}</p>` : ''}
      ${elite ? `<p class="elite-note"><b>Elite here: ${esc(elite.name)}</b> (${esc(elite.desc)}).</p>` : ''}
      <button type="button" class="primary" data-enter="${id}">${esc(verb)}</button>`;
  }

  /** The Endless Crypt's floors around the party's: cleared, this one, and the next few. */
  floorsHtml(state) {
    const now = state.endless.floor;
    const best = loadBestFloor();
    const floors = [];
    for (let f = Math.max(1, now - 3); f <= now + 6; f++) floors.push(f);
    return `<ol class="deep-track" aria-label="Floors of the Endless Crypt">${floors.map((f) => {
      const cls = [f < now ? 'cleared' : f === now ? 'here' : '', f % 5 === 0 ? 'boss' : '', restFloor(f) ? 'rest' : ''].join(' ');
      const what = [f < now ? 'cleared' : f === now ? 'next' : '', f % 5 === 0 ? 'a named foe' : '', restFloor(f) ? 'then a long rest and the pedlar' : ''].filter(Boolean).join(', ');
      return `<li class="${cls}" aria-label="Floor ${f}${what ? `, ${what}` : ''}"><b>${f}</b></li>`;
    }).join('')}</ol>
    <p class="muted deep-best">Deepest floor ever cleared: ${best || 'none yet'}.</p>`;
  }

  /** The next floor of the Endless Crypt and the way down. */
  floorHtml(state) {
    const floor = state.endless.floor;
    const level = levelOf(nextFloor(state));
    const tier = floorTier(floor);
    return `<h3>${esc(level.name)}</h3>
      <p>${esc(level.intro)}</p>
      <p class="teaser">${tier ? `Monsters here are as tough as New Game+ ${tier}${tier >= 2 ? ', and one is an elite' : ''}. ` : ''}${restFloor(floor) ? 'A long rest after this floor, and the pedlar.' : `A long rest after floor ${Math.ceil(floor / 3) * 3}.`}</p>
      <button type="button" class="primary" data-enter="deep">Go down to floor ${floor}</button>`;
  }

  partyHtml(state) {
    return HERO_CODES.map((code) => {
      const rec = state.party[code];
      const u = heroUnit(code, rec);
      const pct = Math.max(0, (u.hp / u.maxHp) * 100);
      const slots = Object.entries(u.slotMax).map(([l, max]) => {
        const n = u.slots[l] ?? 0;
        return `<span class="slots" data-hint="${ordinal(+l)}-level spell slots">${ordinal(+l)} ${'◆'.repeat(n)}<s>${'◇'.repeat(Math.max(0, max - n))}</s></span>`;
      }).join('');
      const items = rec.items.map((it, i) => (ITEMS[it].kind === 'boon'
        ? `<span class="item-chip boon" data-hint="${esc(ITEMS[it].desc)}">${esc(ITEMS[it].name)}</span>`
        : `<span class="item-chip" data-hint="${esc(ITEMS[it].desc)}">${esc(ITEMS[it].name)}<button type="button" data-unequip="${code}:${i}" aria-label="Put ${esc(ITEMS[it].name)} back in the pack">×</button></span>`)).join('');
      return `<div class="hero-card ${code}">
        <div class="hero-top"><b>${esc(u.name)}</b> <small>${esc(u.cls)} · Lv ${u.level}${u.level >= MAX_LEVEL ? ' (max)' : ''}</small></div>
        <div class="hp-line"><span class="hpbar"><i style="width:${pct}%"></i></span><span>${u.hp}/${u.maxHp} HP</span><span>AC ${u.ac + u.acBonus}</span></div>
        <div class="hero-meta">${slots}<span data-hint="Potions of healing">Potions ${u.potions}</span>${u.flasks > 0 ? `<span data-hint="Flasks of alchemist’s fire">Fire ${u.flasks}</span>` : ''}${u.caltrops > 0 ? `<span data-hint="Bags of caltrops">Caltrops ${u.caltrops}</span>` : ''}${u.scrolls?.length ? `<span data-hint="${esc(u.scrolls.map((x) => ITEMS[x].name).join(', '))}">Scrolls ${u.scrolls.length}</span>` : ''}</div>
        ${items ? `<div class="hero-items">${items}</div>` : ''}
        ${this.pickHtml(state, code, u)}
      </div>`;
    }).join('');
  }

  /** An Ability Score Improvement waiting on hero `code`: one button per ability worth raising, the class's own first. */
  pickHtml(state, code, u) {
    const [level] = openPicks(state, code);
    if (!level) return '';
    const buttons = pickOptions(state, code, level).map((o) =>
      `<button type="button" data-pick="${code}:${level}:${o.stat}"><b>${ABILITY_NAMES[o.stat]} ${o.value}${o.own ? ' <span class="own">usual</span>' : ''}</b><small>${esc(o.lines.join(' · '))}</small></button>`).join('');
    return `<div class="hero-pick"><div class="give-label">Level ${level}: raise an ability by 2 <span data-hint="Until the next fight starts. Left alone, ${esc(u.name)} raises the usual one.">(choose before the next fight)</span></div>
      <div class="give" role="group" aria-label="${esc(u.name)}: ability to raise at level ${level}">${buttons}</div></div>`;
  }

  packHtml(state) {
    if (!state.pack.length) return '<p class="muted">The pack is empty. Magic items from chests land here.</p>';
    return state.pack.map((id, i) => {
      const it = ITEMS[id];
      if (it.kind === 'key') return `<div class="pack-item"><div><b class="loot">${esc(it.name)}</b><small>${esc(it.desc)}</small></div></div>`;
      const give = HERO_CODES.map((code) => {
        const why = equipProblem(state, i, code);
        const name = heroUnit(code, state.party[code]).name;
        const gain = why ? why : equipPreview(state, i, code).join(' · ') || 'No change for them';
        return `<button type="button" data-equip="${i}:${code}" ${why ? 'disabled' : ''}><b>${esc(name)}</b><small>${esc(gain)}</small></button>`;
      }).join('');
      return `<div class="pack-item"><div><b class="loot">${esc(it.name)}</b><small>${esc(it.desc)}</small></div>
        <div class="give-label">Give to</div><div class="give">${give}</div></div>`;
    }).join('');
  }

  onClick(ev) {
    const node = ev.target.closest('[data-node]');
    if (node && node.classList.contains('available')) {
      this.selected = node.dataset.node;
      this.show(this.state);
      const elite = roomElite(this.selected, this.state.tier);
      announce(`${nodeName(this.selected)} chosen.${elite ? ` Elite here: ${elite.name}.` : ''} Its button is below the map.`);
      return;
    }
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'camp-trade') this.h.onTrade(b);
    else if (b.dataset.enter) this.h.onEnter(b.dataset.enter);
    else if (b.dataset.equip) {
      const [i, code] = b.dataset.equip.split(':');
      const what = `${ITEMS[this.state.pack[i]].name} given to ${heroUnit(code, this.state.party[code]).name}.`;
      this.h.onEquip(Number(i), code);
      announce(what);
    } else if (b.dataset.pick) {
      const [code, level, stat] = b.dataset.pick.split(':');
      const name = heroUnit(code, this.state.party[code]).name;
      const to = pickOptions(this.state, code, Number(level)).find((o) => o.stat === stat)?.value;
      this.h.onPick(code, Number(level), stat);
      announce(`${name} raises ${ABILITY_NAMES[stat]} to ${to}.`);
    } else if (b.dataset.unequip) {
      const [code, i] = b.dataset.unequip.split(':');
      const what = `${ITEMS[this.state.party[code].items[i]].name} back in the pack.`;
      this.h.onUnequip(code, Number(i));
      announce(what);
    } else if (b.id === 'camp-new') {
      if (!this.confirmNew) {
        this.confirmNew = true;
        b.textContent = this.state.endless ? 'Press again to end the dive' : 'Press again to abandon this run';
        return;
      }
      if (this.state.endless) this.h.onEndDive();
      else this.h.onNewCampaign();
    }
  }
}
