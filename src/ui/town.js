// The village panel, opened from camp after an act's boss (game/town.js): the smith, the temple
// and the library, each a card with its stage, what it does now and what the next stage brings,
// and a button to rebuild it with the party's gold. Built on first open, like the pedlar's panel.

import { Overlay } from './overlay.js';
import { announce } from './announce.js';
import { TOWN, COSTS, stageOf, buildProblem } from '../game/town.js';
import './town.css';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Town {
  /**
   * `get()` is the campaign now; `onBuild(id)` rebuilds building `id` a stage (alone: at once,
   * returning true; in a run together it's a vote, returning false).
   */
  constructor(get, onBuild) {
    this.get = get;
    this.onBuild = onBuild;
    this.el = document.createElement('section');
    this.el.id = 'town';
    this.el.className = 'overlay';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-labelledby', 'town-head');
    this.el.innerHTML = `<div class="overlay-card narrow">
      <header class="camp-head"><h2 id="town-head">The Village</h2><button type="button" class="quiet" data-close>Close</button></header>
      <p class="muted">The village above the crypt lies half in ruins. Gold sent up rebuilds it, and what it rebuilds helps you below.</p>
      <p class="town-gold"></p><p class="town-news" hidden></p>
      <ul class="town-list"></ul>
    </div>`;
    document.body.append(this.el);
    this.panel = new Overlay(this.el);
    this.el.addEventListener('click', (ev) => this.onClick(ev));
  }

  open(opener) {
    this.el.querySelector('.town-news').hidden = true;
    this.draw();
    this.panel.open(opener);
  }

  get isOpen() { return !this.el.hidden; }

  close() {
    if (this.isOpen) this.panel.close();
  }

  /** Say what was just rebuilt (also when a run together's vote lands). */
  news(id) {
    const stage = stageOf(this.get(), id);
    const line = TOWN[id].stages[stage - 1]?.news;
    if (!line) return;
    const p = this.el.querySelector('.town-news');
    p.textContent = line;
    p.hidden = false;
    announce(`${TOWN[id].name} rebuilt. ${line} ${this.get().gold} gold left.`);
  }

  draw() {
    const state = this.get();
    this.el.querySelector('.town-gold').innerHTML = `The party has <b class="gold">${state.gold ?? 0} gold</b>.`;
    this.el.querySelector('.town-list').innerHTML = Object.entries(TOWN).map(([id, b]) => {
      const stage = stageOf(state, id);
      const pips = COSTS.map((_, i) => `<i class="${i < stage ? 'on' : ''}"></i>`).join('');
      const now = stage ? b.stages.slice(0, stage).map((s) => `<li>${esc(s.desc)}</li>`).join('') : '';
      const next = b.stages[stage];
      const problem = next && buildProblem(state, id);
      return `<li class="town-card">
        <div class="town-top"><b>${esc(b.name)}</b><span class="pips" role="img" aria-label="Stage ${stage} of ${COSTS.length}">${pips}</span></div>
        <p class="town-look">${esc(stage ? b.stages[stage - 1].look : b.ruin)}</p>
        ${now ? `<ul class="town-now">${now}</ul>` : ''}
        ${next ? `<div class="town-next"><span><small>Next</small> ${esc(next.desc)}</span>
          <button type="button" data-build="${id}"${problem ? ` disabled data-hint="${esc(problem)}"` : ''}>Rebuild · ${COSTS[stage]} gold</button></div>`
        : '<p class="town-done">Rebuilt in full.</p>'}
      </li>`;
    }).join('');
  }

  onClick(ev) {
    const b = ev.target.closest('button[data-build]');
    if (!b || b.disabled) return;
    const id = b.dataset.build;
    if (!this.onBuild(id)) return; // a run together: a vote, drawn when it lands
    this.draw();
    this.news(id);
    (this.el.querySelector(`[data-build="${id}"]:not([disabled])`) ?? this.el.querySelector('[data-close]')).focus();
  }
}
