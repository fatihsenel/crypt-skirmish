// The unlisted ?losses page: real players' lost fights, sent by the game (src/stats.js,
// sendLoss) to the loss-replay Worker (worker/). It asks once for the Worker's read key (kept
// in this browser), lists the newest losses with room, difficulty and mode filters, and opens
// each in the game's own replay (#watch=, in a new tab). A fight recorded before the rules
// changed no longer replays, and says so. Above the list, a summary counts the losses per room
// and difficulty in the last 7 and 30 days (the Worker's /summary), the most first; a room's
// name there filters the list to it. At the top, Play stats reads the Worker's event tallies
// (/tallies, the same numbers as the weekly digest) for the last 7 or 30 days.

import { NODES } from '../game/campaign.js';
import { levelById } from '../game/maps.js';
import { decodeFight, replayOutcome } from '../game/fightLink.js';
import { LOSS_API } from '../stats.js';
import { readTallies, pct, sum, ranked, shares } from '../tallies.js';

export const KEY_STORE = 'crypt-skirmish:loss-key';
const rooms = Object.entries(NODES).filter(([, n]) => n.kind === 'fight').map(([id, n]) => [id, levelById(n.level).name]);
const roomName = (id) => rooms.find(([r]) => r === id)?.[1] ?? id;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const readKey = () => { try { return localStorage.getItem(KEY_STORE) ?? ''; } catch { return ''; } };
const writeKey = (k) => { try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); } catch { /* this visit only */ } };

const DIFFICULTIES = [['story', 'Story'], ['normal', 'Normal'], ['hard', 'Hard']];
const order = (id) => { const i = rooms.findIndex(([r]) => r === id); return i < 0 ? rooms.length : i; };
const count = (n) => Number.isInteger(n) && n >= 0;

/**
 * The Worker's per-room, per-difficulty counts as one row a room:
 * { room, week, month, by: { hard: { week, month }, … } }, the most losses in 30 days first,
 * then in 7 days, then in campaign order. Rows with no losses are left out.
 */
export function summaryRows(list) {
  const byRoom = new Map();
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || typeof r.room !== 'string' || !count(r.week) || !count(r.month) || !r.month) continue;
    const row = byRoom.get(r.room) ?? { room: r.room, week: 0, month: 0, by: {} };
    row.week += r.week;
    row.month += r.month;
    row.by[r.difficulty] = { week: r.week, month: r.month };
    byRoom.set(r.room, row);
  }
  return [...byRoom.values()].sort((a, b) => b.month - a.month || b.week - a.week || order(a.room) - order(b.room));
}

/** Play stats from the Worker's tally rows, as HTML: the totals, each room's fights, crashes and play. */
export function statsHtml(rows) {
  const t = readTallies(rows);
  const n = t.count;
  const fights = n('fight-won') + n('fight-lost');
  const line = (label, text) => `<p><b>${label}</b> ${esc(text)}</p>`;
  const roomRows = t.rooms.map((r) => `<tr><th scope="row"><button type="button" class="link" data-room="${esc(r.id)}">${esc(roomName(r.id))}</button></th><td>${r.won}</td><td>${r.lost}</td><td>${r.left}</td><td>${r.won + r.lost ? pct(r.lost, r.won + r.lost) : '–'}</td></tr>`).join('');
  return [
    line('Players', `${n('visit')} visits, ${n('run-start')} runs started, ${n('run-continue')} continued, ${n('campaign-won')} campaigns won, ${n('daily-start')} dailies started.`),
    fights
      ? `${line('Fights', `${fights} ended: ${n('fight-won')} won, ${n('fight-lost')} lost; ${n('fight-left')} left half-way.`)}
        <table class="stats-rooms"><thead><tr><th>Room</th><th>Won</th><th>Lost</th><th>Left</th><th>Loss rate</th></tr></thead><tbody>${roomRows}</tbody></table>`
      : line('Fights', 'none ended.'),
    line('Crashes', n('error') ? `${n('error')}: ${ranked(t.values('error', 'browser'))}. Where: ${ranked(t.values('error', 'at'))}.` : 'none.'),
    sum(t.inputs) ? line('Input', `${shares(t.inputs)}.`) : '',
    sum(t.perf) ? line('Frame rate', `${shares(t.perf)} (${sum(t.perf)} visits).`) : '',
  ].join('');
}

const options = (list, all) => `<option value="">${all}</option>${list.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('')}`;

export function showLosses() {
  document.title = 'Lost fights · Crypt Skirmish';
  const box = document.createElement('main');
  box.id = 'losses';
  box.innerHTML = `
    <h1>Lost fights</h1>
    <p class="losses-note">Real players’ defeats from the last 60 days, newest first, without names. Watch opens the game’s replay in a new tab.</p>
    <form class="losses-key" ${readKey() ? 'hidden' : ''}>
      <label>Read key <input type="password" name="key" autocomplete="off" required /></label>
      <button type="submit" class="primary">Show</button>
    </form>
    <div class="losses-filters" hidden>
      <label>Room <select name="room">${options(rooms, 'Every room')}</select></label>
      <label>Difficulty <select name="difficulty">${options(DIFFICULTIES, 'Any')}</select></label>
      <label>Mode <select name="mode">${options([['campaign', 'Campaign'], ['daily', 'Daily'], ['weekly', 'Weekly']], 'Any')}</select></label>
      <button type="button" class="losses-forget">Forget key</button>
    </div>
    <section class="losses-stats" hidden>
      <h2>Play stats <select name="days" aria-label="Days"><option value="7">last 7 days</option><option value="30">last 30 days</option></select></h2>
      <div class="stats-body"></div>
    </section>
    <section class="losses-summary" hidden>
      <h2>Where they fall</h2>
      <table>
        <thead><tr><th>Room</th>${DIFFICULTIES.map(([, d]) => `<th>${d}</th>`).join('')}<th>All</th></tr></thead>
        <tbody></tbody>
      </table>
      <p class="losses-legend">Losses in the last 7 days / last 30 days, for the mode chosen above.</p>
    </section>
    <p class="losses-status" role="status"></p>
    <table class="losses-table" hidden>
      <thead><tr><th>When</th><th>Room</th><th>Difficulty</th><th>Mode</th><th>Rounds</th><th></th></tr></thead>
      <tbody></tbody>
    </table>
    <button type="button" class="losses-more" hidden>Older</button>`;
  document.body.append(box);

  const $ = (s) => box.querySelector(s);
  const form = $('.losses-key');
  const filters = $('.losses-filters');
  const status = $('.losses-status');
  const table = $('.losses-table');
  const body = $('tbody');
  const more = $('.losses-more');
  const summary = $('.losses-summary');
  const stats = $('.losses-stats');
  let oldest = null;

  async function loadStats() {
    const days = stats.querySelector('[name=days]').value;
    try {
      const res = await fetch(`${LOSS_API}/tallies?days=${days}`, { headers: { Authorization: `Bearer ${readKey()}` } });
      if (!res.ok) return void (stats.hidden = true);
      stats.querySelector('.stats-body').innerHTML = statsHtml((await res.json()).tallies);
      stats.hidden = false;
    } catch { stats.hidden = true; }
  }

  async function loadSummary() {
    const q = new URLSearchParams();
    const mode = filters.querySelector('[name=mode]').value;
    if (mode) q.set('mode', mode);
    let rooms = [];
    try {
      const res = await fetch(`${LOSS_API}/summary?${q}`, { headers: { Authorization: `Bearer ${readKey()}` } });
      if (res.ok) rooms = summaryRows((await res.json()).rooms);
    } catch { /* the list says if the Worker is out of reach */ }
    const cell = (c) => (c ? `${esc(c.week)} / ${esc(c.month)}` : '–');
    summary.querySelector('tbody').innerHTML = rooms.map((r) => `<tr><th scope="row"><button type="button" class="link" data-room="${esc(r.room)}">${esc(roomName(r.room))}</button></th>${DIFFICULTIES.map(([d]) => `<td>${cell(r.by[d])}</td>`).join('')}<td>${cell(r)}</td></tr>`).join('');
    summary.hidden = !rooms.length;
  }

  async function load(append = false) {
    if (!LOSS_API) return void (status.textContent = 'The loss-replay Worker isn’t set up (LOSS_API in src/stats.js).');
    const q = new URLSearchParams({ limit: '50' });
    for (const sel of filters.querySelectorAll('select')) if (sel.value) q.set(sel.name, sel.value);
    if (append && oldest) q.set('before', String(oldest));
    status.textContent = 'Loading…';
    let res;
    try {
      res = await fetch(`${LOSS_API}/losses?${q}`, { headers: { Authorization: `Bearer ${readKey()}` } });
    } catch {
      status.textContent = 'Couldn’t reach the Worker.';
      return;
    }
    if (res.status === 401) {
      writeKey('');
      form.hidden = false;
      filters.hidden = true;
      table.hidden = true;
      more.hidden = true;
      summary.hidden = true;
      stats.hidden = true;
      status.textContent = 'That key wasn’t accepted.';
      return;
    }
    const { losses = [] } = await res.json().catch(() => ({}));
    form.hidden = true;
    filters.hidden = false;
    if (!append) {
      body.innerHTML = '';
      loadSummary();
      if (stats.hidden) loadStats(); // not the filters' business: once a visit, or on its own select
    }
    for (const l of losses) body.append(row(l));
    oldest = losses.at(-1)?.id ?? oldest;
    table.hidden = !body.children.length;
    more.hidden = losses.length < 50;
    status.textContent = body.children.length ? `${body.children.length} shown.` : 'No lost fights yet.';
  }

  function row(l) {
    const tr = document.createElement('tr');
    const when = new Date(l.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const tier = l.tier ? ` +${esc(l.tier)}` : '';
    tr.innerHTML = `<td>${esc(when)}</td><td>${esc(roomName(l.room))}</td><td>${esc(l.difficulty)}${tier}</td><td>${esc(l.mode)}</td><td>${esc(l.rounds)}</td><td class="losses-watch">…</td>`;
    const cell = tr.querySelector('.losses-watch');
    // Does it still replay with this version of the rules?
    const code = typeof l.code === 'string' && /^[\w-]+$/.test(l.code) ? l.code : null;
    (code ? decodeFight(code) : Promise.resolve(null)).then((f) => {
      if (f && replayOutcome(f)) cell.innerHTML = `<a href="./#watch=${code}" target="_blank" rel="noopener">Watch</a>`;
      else cell.textContent = 'Older version';
    });
    return tr;
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    writeKey(form.elements.key.value.trim());
    form.reset();
    load();
  });
  filters.addEventListener('change', () => load());
  stats.querySelector('[name=days]').addEventListener('change', loadStats);
  more.addEventListener('click', () => load(true));
  stats.addEventListener('click', (ev) => {
    const room = ev.target.closest('[data-room]')?.dataset.room;
    if (!room) return;
    filters.querySelector('[name=room]').value = room;
    load();
  });
  summary.addEventListener('click', (ev) => {
    const room = ev.target.closest('[data-room]')?.dataset.room;
    if (!room) return;
    filters.querySelector('[name=room]').value = room;
    load();
  });
  $('.losses-forget').addEventListener('click', () => {
    writeKey('');
    location.reload();
  });
  if (readKey()) load();
  else form.elements.key.focus();
}
