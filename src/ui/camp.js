// Between fights: the dungeon map, the party, the pack of loot, and what just happened.
// Also the title screen. Plain HTML/SVG; all state changes go through the handlers.

import { Bestiary } from './bestiary.js';
import { Overlay } from './overlay.js';
import {
  NODES, choices, mapEdges, nodeName, heroUnit, HERO_CODES, XP_LEVELS, levelForXp, equipProblem, equipPreview, DIFFICULTIES, difficultyLabel,
  cleanName, roomElite,
} from '../game/campaign.js';
import { TEMPLATES, CLASS_CHOICES } from '../game/units.js';
import { ITEMS } from '../game/items.js';
import { MAX_LEVEL } from '../game/units.js';
import { levelById } from '../game/maps.js';
import { tips } from './tips.js';
import { loadHistory, loadDeepest, deepestLabel } from '../game/history.js';
import { ACHIEVEMENTS, loadAchievements } from '../game/achievements.js';
import { dayKey, dailyPlan, loadDaily, streak } from '../game/daily.js';

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
};

/** One line on what each swappable class brings, for the title screen's class picker. */
const CLASS_BLURB = {
  F: 'Fighter: the most HP, Second Wind to heal mid-fight, Extra Attack at level 5.',
  P: 'Paladin: Divine Smite burns spell slots for radiant damage, Lay on Hands and Shield of Faith protect the party, Aura of Protection at level 6.',
  W: 'Wizard: the most spell slots: Magic Missile, Burning Hands, Misty Step and Shield, then Fireball and Lightning Bolt at level 5.',
  K: 'Warlock: two strong pact slots that come back after every room, Eldritch Blast, Hex and Hellish Rebuke, and temporary HP for every kill. Fireball and two beams at level 5.',
  R: 'Rogue: Sneak Attack, hides as a bonus action and slips past monsters unseen, spots traps.',
  A: 'Ranger: a longbow with Archery, Hunter’s Mark for extra damage on one foe, spots traps. Extra Attack and Colossus Slayer at level 5.',
};

export class Camp {
  constructor({ onEnter, onEquip, onUnequip, onNewCampaign, onContinue, onDaily, onWatch, onShareFight, onNewGamePlus }) {
    this.h = { onEnter, onEquip, onUnequip, onNewCampaign, onContinue, onDaily, onWatch, onShareFight, onNewGamePlus };
    this.selected = null;
    this.confirmNew = false;
    $('#camp').addEventListener('click', (ev) => this.onClick(ev));
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
      if (b?.id === 'title-daily-play') this.h.onDaily();
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
        ? `<span class="cls-pick" role="group" aria-label="Class">${options.map((c) => `
            <button type="button" data-slot="${code}" data-cls="${c}" title="${esc(CLASS_BLURB[c])}"
              aria-pressed="${c === code}">${esc(TEMPLATES[c].cls)}</button>`).join('')}</span>`
        : `<small>${esc(TEMPLATES[code].cls)}</small>`;
      return `<label>${head}
      <input type="text" data-code="${code}" maxlength="14" placeholder="${esc(TEMPLATES[code].name)}" autocomplete="off" spellcheck="false"></label>`;
    }).join('');
  }

  /** Swap the class that fills a hero slot for the next new run. */
  pickClass(slot, cls) {
    this.classes[slot] = cls;
    for (const b of document.querySelectorAll(`#title-names [data-slot="${slot}"]`)) {
      b.setAttribute('aria-pressed', String(b.dataset.cls === cls));
    }
    document.querySelector(`#title-names input[data-code="${slot}"]`).placeholder = TEMPLATES[cls].name;
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
    Bestiary.label($('#title-bestiary'));
    this.renderDaily();
  }

  /** Today's crypt: which room, the party, and the day's best result and the streak so far. */
  renderDaily() {
    const plan = dailyPlan(dayKey());
    const results = loadDaily();
    const today = results[plan.key];
    const party = [plan.classes.F ? 'a Paladin' : 'a Fighter', plan.classes.W ? 'a Warlock' : 'a Wizard', plan.classes.R ? 'a Ranger' : 'a Rogue', 'a Cleric'];
    const box = $('#title-daily');
    box.querySelector('.daily-date').textContent = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    box.querySelector('.daily-room').textContent =
      `${levelById(NODES[plan.node].level).name}, with ${party.slice(0, 3).join(', ')} and ${party[3]} at level ${plan.level}. The same for everyone today.`;
    const run = streak(results, plan.key);
    const rounds = (n) => `${n} round${n === 1 ? '' : 's'}`;
    box.querySelector('.daily-result').textContent = today
      ? (today.won ? `Best today: won in ${rounds(today.rounds)}` : `Not won yet today (${today.tries} ${today.tries === 1 ? 'try' : 'tries'})`)
        + (run ? ` · Streak: ${run} day${run === 1 ? '' : 's'}` : '')
      : run ? `Streak: ${run} day${run === 1 ? '' : 's'}. Win today to keep it going.` : 'Not played yet today.';
    $('#title-daily-play').textContent = today?.won ? 'Play it again' : 'Play today’s crypt';
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
    $('#camp').hidden = true;
    $('#title').hidden = true;
  }

  // --- camp -------------------------------------------------------------------
  /** report: from completeFight ({ xp, levelUps, loot }), { rest: id }, or null. */
  show(state, report = this.report) {
    this.state = state;
    this.report = report;
    const options = choices(state);
    if (!options.includes(this.selected)) this.selected = options[0] ?? null;
    this.confirmNew = false;
    $('#title').hidden = true;
    $('#camp').hidden = false;
    $('#camp-report').innerHTML = this.reportHtml(state, report);
    const map = $('#camp-map');
    map.innerHTML = this.mapSvg(state, options);
    // The acts don't fit a narrow panel at a readable size: scroll to where the party is.
    const here = state.at ? pos(state.at).x : 0;
    map.scrollLeft = Math.max(0, here * (map.scrollWidth / MAP_W) - map.clientWidth / 2);
    $('#camp-room').innerHTML = this.roomHtml(state);
    $('#camp-party').innerHTML = this.partyHtml(state);
    $('#camp-pack').innerHTML = this.packHtml(state);
    $('#camp-pack-box').hidden = !state.pack.length; // nothing to hand out
    $('#camp-new').textContent = 'Abandon run';
    Bestiary.label($('#camp-bestiary'));
  }

  reportHtml(state, report) {
    const lvl = levelForXp(state.xp);
    const next = XP_LEVELS[lvl + 1];
    const prev = XP_LEVELS[lvl] ?? 0;
    const pct = next ? ((state.xp - prev) / (next - prev)) * 100 : 100;
    const bar = `<div class="xp" title="Party XP">
      <span>Party level <b>${lvl}</b></span>
      <span class="xpbar"><i style="width:${pct}%"></i></span>
      <span>${next ? `${state.xp} / ${next} XP` : `${state.xp} XP · max level`} · ${esc(difficultyLabel(state.difficulty ?? 'normal', state.tier))}</span>
    </div>`;
    let news = '';
    if (report?.rest) {
      news = `<p><b>${esc(nodeName(report.rest))}.</b> ${esc(NODES[report.rest].intro)} Full HP and every spell slot back.</p>`;
    } else if (report) {
      const found = [
        ...(report.potions ? [`<b class="loot">${report.potions} potion${report.potions > 1 ? 's' : ''} of healing</b> (shared out)`] : []),
        ...report.loot.map((i) => `<b class="loot">${esc(ITEMS[i].name)}</b>`),
      ];
      const parts = [`<p>Room cleared: <b>+${report.xp} XP</b>. ${report.longRest
        ? 'Long rest: full HP and every spell slot back.'
        : 'Short rest: half of everyone’s missing HP back.'}${found.length ? ` Found ${found.join(', ')}${report.loot.length ? '; hand it out from the pack' : ''}.` : ''}</p>`];
      if (report.levelUps.length) {
        parts.push(`<div class="levelups"><b>Level up!</b><ul>${report.levelUps.map((l) =>
          `<li><b>${esc(l.name)}</b> reaches level ${l.level}: ${esc(l.note)}</li>`).join('')}</ul></div>`);
      }
      news = parts.join('');
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
      const kind = n.kind === 'rest' ? 'rest' : n.boss ? 'boss' : 'fight';
      const state_ = cleared.has(id) ? 'cleared' : options.includes(id) ? 'available' : 'locked';
      const cls = ['node', kind, state_, id === state.at ? 'here' : '', id === this.selected ? 'selected' : ''].join(' ');
      const label = n.short ?? nodeName(id).replace(/^The /, '');
      const elite = cleared.has(id) ? null : roomElite(id, state.tier); // New Game+ 2 and deeper
      const r = kind === 'boss' ? 21 : 18;
      return `<g class="${cls}" data-node="${id}" transform="translate(${p.x} ${p.y})" ${state_ === 'available' ? 'tabindex="0" role="button"' : ''}>
        <title>${esc(nodeName(id))}${elite ? ` · Elite: ${esc(elite.name)}` : ''}</title>
        <circle r="${r}" />
        <g class="glyph">${GLYPH[kind]}</g>
        ${cleared.has(id) ? '<path class="tick" d="M10 -14 l4 4 l8 -9" />' : ''}
        ${elite ? `<circle class="elite-pip" cx="${-r * 0.72}" cy="${-r * 0.72}" r="4.5" />` : ''}
        <text y="${kind === 'boss' ? 38 : 34}">${esc(label)}</text>
      </g>`;
    }).join('');
    return `<svg viewBox="0 0 ${MAP_W} 248" role="img" aria-label="Dungeon map">${edges}${nodes}</svg>`;
  }

  roomHtml(state) {
    const id = this.selected;
    if (!id) return '<p class="muted">No way onward.</p>';
    const n = NODES[id];
    const intro = n.kind === 'rest' ? n.intro : levelById(n.level).intro;
    const verb = n.verb ?? `Enter ${nodeName(id)}`;
    const elite = roomElite(id, state.tier);
    return `<h3>${esc(nodeName(id))}</h3>
      <p>${esc(intro)}</p>
      ${n.teaser ? `<p class="teaser">${esc(n.teaser)}</p>` : ''}
      ${elite ? `<p class="elite-note"><b>Elite here: ${esc(elite.name)}</b> (${esc(elite.desc)}).</p>` : ''}
      <button type="button" class="primary" data-enter="${id}">${esc(verb)}</button>`;
  }

  partyHtml(state) {
    return HERO_CODES.map((code) => {
      const rec = state.party[code];
      const u = heroUnit(code, rec);
      const pct = Math.max(0, (u.hp / u.maxHp) * 100);
      const slots = Object.entries(u.slotMax).map(([l, max]) => {
        const n = u.slots[l] ?? 0;
        return `<span class="slots" title="${ordinal(+l)}-level spell slots">${ordinal(+l)} ${'◆'.repeat(n)}<s>${'◇'.repeat(Math.max(0, max - n))}</s></span>`;
      }).join('');
      const items = rec.items.map((it, i) =>
        `<span class="item-chip" title="${esc(ITEMS[it].desc)}">${esc(ITEMS[it].name)}<button type="button" data-unequip="${code}:${i}" aria-label="Put ${esc(ITEMS[it].name)} back in the pack">×</button></span>`).join('');
      return `<div class="hero-card ${code}">
        <div class="hero-top"><b>${esc(u.name)}</b> <small>${esc(u.cls)} · Lv ${u.level}${u.level >= MAX_LEVEL ? ' (max)' : ''}</small></div>
        <div class="hp-line"><span class="hpbar"><i style="width:${pct}%"></i></span><span>${u.hp}/${u.maxHp} HP</span><span>AC ${u.ac + u.acBonus}</span></div>
        <div class="hero-meta">${slots}<span title="Potions of healing">Potions ${u.potions}</span></div>
        ${items ? `<div class="hero-items">${items}</div>` : ''}
      </div>`;
    }).join('');
  }

  packHtml(state) {
    if (!state.pack.length) return '<p class="muted">The pack is empty. Magic items from chests land here.</p>';
    return state.pack.map((id, i) => {
      const it = ITEMS[id];
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
      return;
    }
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.enter) this.h.onEnter(b.dataset.enter);
    else if (b.dataset.equip) {
      const [i, code] = b.dataset.equip.split(':');
      this.h.onEquip(Number(i), code);
    } else if (b.dataset.unequip) {
      const [code, i] = b.dataset.unequip.split(':');
      this.h.onUnequip(code, Number(i));
    } else if (b.id === 'camp-new') {
      if (!this.confirmNew) {
        this.confirmNew = true;
        b.textContent = 'Click again to abandon this run';
        return;
      }
      this.h.onNewCampaign();
    }
  }
}
