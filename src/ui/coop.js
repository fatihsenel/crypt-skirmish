// Play together (co-op online): the lobby where two to four players meet in a room, the host
// picks the fight and hands out the heroes, and everyone starts it at once. The room lives on
// the relay (src/coop.js, worker/src/room.js); this panel draws it and sends the host's choices.
// Built on first open, with its styles, so neither weighs on the title.

import { Overlay } from './overlay.js';
import { announce } from './announce.js';
import { copyText } from './copyBox.js';
import { unitIcon } from './icons.js';
import { CoopLink, HERO_SLOTS, newRoomCode, cleanCode } from '../coop.js';
import { NODES, nodeName, DIFFICULTIES } from '../game/campaign.js';
import { CLASS_CHOICES, TEMPLATES } from '../game/units.js';
import { DAILY_ROOMS_TWO_FLOORS } from '../game/daily.js';
import { newSeed } from '../game/replay.js';
import { RULES } from '../game/elites.js';
import './coop.css';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NAME_KEY = 'crypt-skirmish:coop-name';
/** The rooms a co-op fight can be, each with the party level it's fought at (the daily's list). */
export const COOP_ROOMS = DAILY_ROOMS_TWO_FLOORS.filter(([node]) => NODES[node]);
const DEFAULT_DRAFT = { node: 'warren', difficulty: 'normal', classes: {} };

/** The fight a draft starts: its room, party level, difficulty, classes, fresh dice and these rules. */
export function fightFrom(draft, seed = newSeed()) {
  const [node, level] = COOP_ROOMS.find(([n]) => n === draft?.node) ?? COOP_ROOMS.find(([n]) => n === DEFAULT_DRAFT.node);
  const classes = Object.fromEntries(HERO_SLOTS.filter((s) => CLASS_CHOICES[s].includes(draft?.classes?.[s]) && draft.classes[s] !== s).map((s) => [s, draft.classes[s]]));
  return { node, level, difficulty: DIFFICULTIES[draft?.difficulty] ? draft.difficulty : 'normal', classes, seed, rules: RULES };
}

export class CoopLobby {
  /**
   * `cb`: onFight(link, room) when a fight starts (or is running when we join), onLobby(link)
   * when the host takes everyone back here, onRoom(link, room, before) on every change, and
   * onLeave() once the room is left.
   */
  constructor(cb) {
    this.cb = cb;
    this.link = null;
    this.el = document.createElement('section');
    this.el.id = 'coop';
    this.el.className = 'overlay';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-labelledby', 'coop-head');
    this.el.innerHTML = `<div class="overlay-card narrow">
      <header class="camp-head"><h2 id="coop-head">Play together</h2><button type="button" class="quiet" data-close>Close</button></header>
      <div class="coop-body"></div>
    </div>`;
    document.body.append(this.el);
    this.panel = new Overlay(this.el);
    // Closing the panel in the lobby leaves the room; during a fight it only hides.
    this.panel.close = () => {
      if (this.link && !this.fighting) this.leave();
      this.el.hidden = true;
      this.panel.opener?.focus();
    };
    this.el.addEventListener('click', (ev) => this.onClick(ev));
    this.el.addEventListener('change', (ev) => this.onChange(ev));
    this.el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && ev.target.id === 'coop-code') this.joinTyped();
    });
    // Over the fight: whose turn and how long is left. Pressing it opens the room (seats, leaving).
    this.bar = document.createElement('button');
    this.bar.type = 'button';
    this.bar.id = 'coop-bar';
    this.bar.hidden = true;
    this.bar.dataset.hint = 'The room: who plays which hero, or leave';
    document.body.append(this.bar);
    this.fighting = false;
  }

  get open() { return !this.el.hidden; }

  /** Open the lobby: the room we're in, or the way in (`code` from a #coop= link fills it in). */
  show(opener, code = null) {
    if (code) this.pending = code;
    this.draw();
    this.panel.open(opener);
    const focus = this.link ? this.el.querySelector('#coop-start, #coop-copy') : this.el.querySelector(this.pending ? '#coop-name' : '#coop-make');
    focus?.focus();
  }

  hide() { this.el.hidden = true; }

  savedName() {
    try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
  }

  join(code, name) {
    try { localStorage.setItem(NAME_KEY, name); } catch { /* not kept */ }
    this.leave(true);
    this.pending = null;
    this.why = null;
    this.link = new CoopLink(code, name, {
      onRoom: (room, before) => this.onRoom(room, before),
      onStatus: (status, why) => {
        if (status === 'refused') this.why = why === 'full' ? 'That room is full: four players are in it.' : 'The room refused us.';
        this.draw();
        this.cb.onStatus?.(this.link, status);
      },
      onCmd: () => this.cb.onCmd?.(this.link),
      onStale: (msg) => this.cb.onStale?.(this.link, msg),
    });
    this.draw();
  }

  joinTyped() {
    const code = cleanCode(this.el.querySelector('#coop-code')?.value);
    const name = this.el.querySelector('#coop-name').value.trim();
    if (!code) {
      this.why = 'A room code is six letters and digits.';
      this.draw();
      return;
    }
    this.join(code, name);
  }

  /** Leave the room (`quiet`: to join another at once). */
  leave(quiet = false) {
    if (!this.link) return;
    this.link.close();
    this.link = null;
    this.fighting = false;
    this.bar.hidden = true;
    if (!quiet) this.cb.onLeave?.();
  }

  onRoom(room, before) {
    const link = this.link;
    if (!before) announce(`Joined room ${link.code}. ${room.players.length} player${room.players.length === 1 ? '' : 's'} here.`);
    // A fight began (or was running when we came in), or the host called everyone back.
    if (room.fight && (!before || before.game !== room.game)) {
      this.fighting = true;
      this.hide();
      this.cb.onFight(link, room);
    } else if (!room.fight && before?.fight) {
      this.fighting = false;
      this.cb.onLobby(link);
      this.show(null);
    }
    this.cb.onRoom?.(link, room, before);
    if (this.open) this.draw();
  }

  draw() {
    const body = this.el.querySelector('.coop-body');
    const link = this.link;
    if (!link || link.status === 'refused') {
      body.innerHTML = `<p class="coop-lead">Two to four players, each on their own device, in one fight. The host hands out the heroes.</p>
        <label class="coop-field coop-name">Your name <input id="coop-name" maxlength="14" autocomplete="nickname" value="${esc(this.savedName())}" placeholder="Your name"></label>
        ${this.why ? `<p class="coop-why" role="alert">${esc(this.why)}</p>` : ''}
        <div class="coop-doors">
          <div class="coop-door">
            <h3 class="sub">New room</h3>
            <p class="muted">Make one, then share its code with friends.</p>
            <button id="coop-make" type="button" class="primary">Make a room</button>
          </div>
          <div class="coop-door">
            <h3 class="sub">Have a code?</h3>
            <p class="muted">Type the code a friend sent you.</p>
            <div class="coop-join-row">
              <input id="coop-code" aria-label="Room code" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(this.pending ?? '')}" placeholder="ABC234">
              <button id="coop-join" type="button">Join</button>
            </div>
          </div>
        </div>`;
      return;
    }
    const room = link.room;
    const status = { connecting: 'Connecting…', lost: 'Connection lost: trying again…', open: '' }[link.status] ?? '';
    if (!room) {
      body.innerHTML = `<div class="coop-code-card"><div><span class="coop-label">Room code</span><span class="coop-code-big">${esc(link.code)}</span></div></div>
        <p class="muted coop-wait">${esc(status || 'Connecting…')}</p>
        <div class="coop-foot"><button type="button" class="coop-leave" data-coop="leave">Leave</button></div>`;
      return;
    }
    const host = link.host;
    const draft = { ...DEFAULT_DRAFT, ...(room.draft ?? {}) };
    const players = room.players.map((p) => {
      const tags = [p.id === room.host && 'host', p.id === link.you && 'you', !p.on && 'away'].filter(Boolean);
      return `<li class="${p.on ? 'on' : 'away'}"><span class="dot" aria-hidden="true"></span>${esc(p.name)}${tags.length ? ` <span class="tag">${tags.join(' · ')}</span>` : ''}</li>`;
    }).join('');
    const choice = (id, opts, value, label) => (host
      ? `<select id="${id}" aria-label="${esc(label)}">${opts.map(([v, t]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`
      : `<span class="coop-value">${esc(opts.find(([v]) => v === value)?.[1] ?? '')}</span>`);
    const rooms = COOP_ROOMS.map(([n, l]) => [n, `${nodeName(n)} · level ${l}`]);
    const diffs = Object.entries(DIFFICULTIES).map(([k, d]) => [k, d.name]);
    const people = room.players.map((p) => [p.id, p.name]);
    const heroes = HERO_SLOTS.map((s) => {
      const cls = CLASS_CHOICES[s].includes(draft.classes?.[s]) ? draft.classes[s] : s;
      const t = TEMPLATES[cls];
      const color = `#${(t.color ?? 0x777777).toString(16).padStart(6, '0')}`;
      return `<li${room.seats[s] === link.you ? ' class="mine"' : ''}><span class="pic" style="--c:${color}" aria-hidden="true">${unitIcon({ code: cls })}</span>
        <span class="coop-who"><b>${esc(t.name)}</b>${choice(`coop-class-${s}`, CLASS_CHOICES[s].map((c) => [c, TEMPLATES[c].cls]), cls, `${t.name}'s class`)}</span>
        ${choice(`coop-seat-${s}`, people, room.seats[s], `Who plays ${t.name}`)}</li>`;
    }).join('');
    const invite = this.inviteLink();
    body.innerHTML = `<div class="coop-code-card">
        <div><span class="coop-label">Room code</span><span class="coop-code-big">${esc(link.code)}</span></div>
        <button id="coop-copy" type="button" data-hint="${esc(invite)}">Copy invite link</button>
      </div>
      ${status ? `<p class="coop-why" role="status">${esc(status)}</p>` : ''}
      <h3 class="sub">Players <span class="coop-count">${room.players.length} of 4</span></h3>
      <ul class="coop-players">${players}</ul>
      <h3 class="sub">The fight</h3>
      <div class="coop-fight">
        <label class="coop-field">Room ${choice('coop-room', rooms, draft.node, 'Room')}</label>
        <label class="coop-field">Difficulty ${choice('coop-diff', diffs, draft.difficulty, 'Difficulty')}</label>
      </div>
      <h3 class="sub coop-heroes-head"><span>Heroes</span><span>Played by</span></h3>
      <ul class="coop-heroes">${heroes}</ul>
      <div class="coop-foot">
        <button type="button" class="coop-leave" data-coop="leave">Leave room</button>
        ${host ? `<button id="coop-start" type="button" class="primary">${this.fighting ? 'Start a new fight' : 'Start the fight'}</button>` : `<p class="coop-wait">Waiting for ${esc(link.playerName(room.host))} to start the fight…</p>`}
      </div>`;
  }

  inviteLink() {
    return `${location.origin}${location.pathname}#coop=${this.link.code}`;
  }

  /** The host's draft as the selects show it. */
  readDraft() {
    const v = (id) => this.el.querySelector(`#${id}`)?.value;
    const classes = Object.fromEntries(HERO_SLOTS.map((s) => [s, v(`coop-class-${s}`)]).filter(([s, c]) => c && c !== s));
    return { node: v('coop-room'), difficulty: v('coop-diff'), classes };
  }

  onChange(ev) {
    const link = this.link;
    if (!link?.host) return;
    const id = ev.target.id;
    if (id.startsWith('coop-seat-')) {
      link.send({ t: 'seats', seats: { [id.slice(-1)]: ev.target.value } });
    } else if (id === 'coop-room' || id === 'coop-diff' || id.startsWith('coop-class-')) {
      link.send({ t: 'draft', draft: this.readDraft() });
    }
  }

  onClick(ev) {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'coop-make') this.join(newRoomCode(), this.el.querySelector('#coop-name').value.trim());
    else if (b.id === 'coop-join') this.joinTyped();
    else if (b.id === 'coop-copy') copyText(this.inviteLink(), { button: b, label: 'Copy invite link', what: 'invite link' });
    else if (b.dataset.coop === 'leave') {
      this.leave();
      this.draw();
      this.el.querySelector('#coop-make')?.focus();
    } else if (b.id === 'coop-start' && this.link?.host) {
      this.link.send({ t: 'start', fight: fightFrom(this.readDraft()) });
    }
  }

  /** The line over the fight: whose turn, how long is left, the connection. */
  status(text) {
    this.bar.hidden = !text;
    if (this.bar.textContent !== (text ?? '')) this.bar.textContent = text ?? '';
    if (!text) return;
    // Under the initiative strip, wherever the layout (phone, text size) puts its foot.
    const foot = Math.round(document.getElementById('initiative')?.getBoundingClientRect().bottom || 54);
    this.bar.style.top = `${foot + 6}px`;
    document.documentElement.style.setProperty('--coop-under', `${foot + 44}px`);
  }
}
