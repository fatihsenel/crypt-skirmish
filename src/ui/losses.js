// The unlisted ?losses page: real players' lost fights, sent by the game (src/stats.js,
// sendLoss) to the loss-replay Worker (worker/). It asks once for the Worker's read key (kept
// in this browser), lists the newest losses with room, difficulty and mode filters, and opens
// each in the game's own replay (#watch=, in a new tab). A fight recorded before the rules
// changed no longer replays, and says so.

import { NODES } from '../game/campaign.js';
import { levelById } from '../game/maps.js';
import { decodeFight, replayOutcome } from '../game/fightLink.js';
import { LOSS_API } from '../stats.js';

export const KEY_STORE = 'crypt-skirmish:loss-key';
const rooms = Object.entries(NODES).filter(([, n]) => n.kind === 'fight').map(([id, n]) => [id, levelById(n.level).name]);
const roomName = (id) => rooms.find(([r]) => r === id)?.[1] ?? id;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const readKey = () => { try { return localStorage.getItem(KEY_STORE) ?? ''; } catch { return ''; } };
const writeKey = (k) => { try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); } catch { /* this visit only */ } };

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
      <label>Difficulty <select name="difficulty">${options([['story', 'Story'], ['normal', 'Normal'], ['hard', 'Hard']], 'Any')}</select></label>
      <label>Mode <select name="mode">${options([['campaign', 'Campaign'], ['daily', 'Daily'], ['weekly', 'Weekly']], 'Any')}</select></label>
      <button type="button" class="losses-forget">Forget key</button>
    </div>
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
  let oldest = null;

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
      status.textContent = 'That key wasn’t accepted.';
      return;
    }
    const { losses = [] } = await res.json().catch(() => ({}));
    form.hidden = true;
    filters.hidden = false;
    if (!append) body.innerHTML = '';
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
  more.addEventListener('click', () => load(true));
  $('.losses-forget').addEventListener('click', () => {
    writeKey('');
    location.reload();
  });
  if (readKey()) load();
  else form.elements.key.focus();
}
