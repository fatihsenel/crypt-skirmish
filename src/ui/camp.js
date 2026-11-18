// Between fights: the dungeon map, the party, the pack of loot, and what just happened.
// Also the title screen. Plain HTML/SVG; all state changes go through the handlers.

import {
  NODES, choices, mapEdges, nodeName, heroUnit, HERO_CODES, XP_LEVELS, levelForXp, equipProblem, DIFFICULTIES,
  cleanName,
} from '../game/campaign.js';
import { TEMPLATES, CLASS_CHOICES } from '../game/units.js';
import { ITEMS } from '../game/items.js';
import { MAX_LEVEL } from '../game/units.js';
import { levelById } from '../game/maps.js';

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
};

export class Camp {
  constructor({ onEnter, onEquip, onUnequip, onNewCampaign, onContinue }) {
    this.h = { onEnter, onEquip, onUnequip, onNewCampaign, onContinue };
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
      if (b?.id === 'title-new') this.h.onNewCampaign(this.difficulty, this.names(), { ...this.classes });
      if (b?.dataset.cls) this.pickClass(b.dataset.slot, b.dataset.cls);
    });
    $('#title-difficulty').addEventListener('change', (ev) => {
      this.difficulty = ev.target.value;
      this.renderDifficulty();
    });
  }

  get open() {
    return !$('#camp').hidden || !$('#title').hidden;
  }

  // --- title ------------------------------------------------------------------
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

  showTitle(save) {
    this.difficulty ??= save?.difficulty ?? 'normal';
    this.renderDifficulty();
    this.renderNames();
    $('#camp').hidden = true;
    $('#title').hidden = false;
    $('#title-continue').hidden = !save;
    $('#title-save').textContent = save
      ? `Saved run (${DIFFICULTIES[save.difficulty].name}): party level ${save.party.F.level}, ${save.cleared.length} room${save.cleared.length === 1 ? '' : 's'} cleared, ${save.xp} XP`
      : '';
    $('#title-new').textContent = save ? 'New campaign (replaces the save)' : 'New campaign';
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
    $('#camp-map').innerHTML = this.mapSvg(state, options);
    $('#camp-room').innerHTML = this.roomHtml(state);
    $('#camp-party').innerHTML = this.partyHtml(state);
    $('#camp-pack').innerHTML = this.packHtml(state);
    $('#camp-new').textContent = 'Abandon run';
  }

  reportHtml(state, report) {
    const lvl = levelForXp(state.xp);
    const next = XP_LEVELS[lvl + 1];
    const prev = XP_LEVELS[lvl] ?? 0;
    const pct = next ? ((state.xp - prev) / (next - prev)) * 100 : 100;
    const bar = `<div class="xp" title="Party XP">
      <span>Party level <b>${lvl}</b></span>
      <span class="xpbar"><i style="width:${pct}%"></i></span>
      <span>${next ? `${state.xp} / ${next} XP` : `${state.xp} XP · max level`} · ${esc(DIFFICULTIES[state.difficulty ?? 'normal'].name)}</span>
    </div>`;
    let news = '';
    if (report?.rest) {
      news = `<p><b>${esc(nodeName(report.rest))}.</b> ${esc(NODES[report.rest].intro)} Everyone is back to full HP with every spell slot.</p>`;
    } else if (report) {
      const parts = [report.longRest
        ? `<p>The room is cleared: <b>+${report.xp} XP</b>. Before going deeper the party takes a long rest: full HP and every spell slot back.</p>`
        : `<p>The room is cleared: <b>+${report.xp} XP</b>. A short rest restores half of everyone's missing HP.</p>`];
      if (report.potions) {
        parts.push(`<p>Searching the room turns up <b class="loot">${report.potions} potion${report.potions > 1 ? 's' : ''} of healing</b>, shared out among the party.</p>`);
      }
      if (report.loot.length) {
        parts.push(`<p>Found: ${report.loot.map((i) => `<b class="loot">${esc(ITEMS[i].name)}</b>`).join(', ')}. Hand it out below.</p>`);
      }
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
      return `<g class="${cls}" data-node="${id}" transform="translate(${p.x} ${p.y})" ${state_ === 'available' ? 'tabindex="0" role="button"' : ''}>
        <title>${esc(nodeName(id))}</title>
        <circle r="${kind === 'boss' ? 21 : 18}" />
        <g class="glyph">${GLYPH[kind]}</g>
        ${cleared.has(id) ? '<path class="tick" d="M10 -14 l4 4 l8 -9" />' : ''}
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
    return `<h3>${esc(nodeName(id))}</h3>
      <p>${esc(intro)}</p>
      ${n.teaser ? `<p class="teaser">${esc(n.teaser)}</p>` : ''}
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
        return `<button type="button" data-equip="${i}:${code}" ${why ? `disabled title="${esc(why)}"` : ''}>${esc(name)}</button>`;
      }).join('');
      return `<div class="pack-item"><div><b class="loot">${esc(it.name)}</b><small>${esc(it.desc)}</small></div>
        <div class="give"><span>Give to</span>${give}</div></div>`;
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
