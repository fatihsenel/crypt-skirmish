// The weekly digest: the last 7 days of play stats (the loss-replay Worker's /tallies, a count
// of each event by day) and stored losses (its /summary) as a short Markdown report.
// `npm run digest` prints it; `npm run digest -- --out file.md` also saves it.
//
// Keys, from the environment only: LOSS_READ_KEY (the Worker's READ_KEY) and, optionally,
// UMAMI_API_KEY (Umami Cloud › Settings › API keys) for visitors, page views and referrers. It runs every Monday in
// GitHub Actions (.github/workflows/digest.yml), with the key as a repository secret.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NODES } from '../src/game/campaign.js';
import { levelById } from '../src/game/maps.js';
import { LOSS_API, WEBSITE } from '../src/stats.js';

const DAY = 86_400_000;
const UMAMI = 'https://api.umami.is/v1';
const WORST_MIN = 5; // fights in a room before its loss rate counts

const roomName = (id) => (NODES[id]?.level ? levelById(NODES[id].level).name : id);
const pct = (n, of) => `${Math.round((100 * n) / of)}%`;
const sum = (obj) => Object.values(obj).reduce((n, k) => n + k, 0);
/** "safari 5, chrome 1", the most first. */
const ranked = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
const shares = (obj) => { const all = sum(obj); return Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${pct(n, all)}`).join(', '); };

/** The read key, from the environment. */
export const readKeys = (env) => ({ losses: env.LOSS_READ_KEY || null, umami: env.UMAMI_API_KEY || null });

/** A number from Umami's stats, which some versions give as { value, prev }. */
const num = (v) => (typeof v === 'number' ? v : typeof v?.value === 'number' ? v.value : 0);

/** Umami's side of the week (only with its key): visitors, page views and where they came from. */
async function umamiLines({ fetch, key, now }) {
  if (!key) return [];
  const get = async (path, params = {}) => {
    const query = new URLSearchParams({ startAt: String(now - 7 * DAY), endAt: String(now), ...params });
    const res = await fetch(`${UMAMI}/websites/${WEBSITE}/${path}?${query}`, { headers: { 'x-umami-api-key': key, Accept: 'application/json' } }).catch(() => null);
    if (!res?.ok) throw new Error(res ? `Umami refused the key (${res.status})` : 'Couldn’t reach Umami');
    return res.json();
  };
  const lines = ['## Visitors (Umami)', ''];
  try {
    const stats = await get('stats');
    const from = (await get('metrics', { type: 'referrer', limit: '5' })) ?? [];
    lines.push(`${num(stats.visitors)} visitors, ${num(stats.visits)} visits, ${num(stats.pageviews)} page views.`);
    if (from.length) lines.push(`Came from: ${from.map((r) => `${r.x || '(direct)'} ${r.y}`).join(', ')}.`);
  } catch (error) {
    lines.push(`${error.message}: left out.`);
  }
  return ['', ...lines];
}

/** The report for the 7 days to `now`. `fetch` is the network (a stand-in in tests). */
export async function buildDigest({ fetch, keys, now = Date.now() }) {
  const out = [`# Crypt Skirmish: the week to ${new Date(now).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`, ''];
  const umami = await umamiLines({ fetch, key: keys.umami, now });
  if (!keys.losses) return `${[...out, 'No read key (LOSS_READ_KEY): the Worker’s numbers left out.', ...umami].join('\n').trim()}\n`;
  const worker = async (path) => {
    const res = await fetch(`${LOSS_API}${path}`, { headers: { Authorization: `Bearer ${keys.losses}` } }).catch(() => null);
    if (!res?.ok) return { error: res ? `The Worker refused the read key (${res.status})` : 'Couldn’t reach the Worker' };
    return { body: await res.json() };
  };

  // --- Play stats (tallies) ---
  const tallies = await worker('/tallies?days=7');
  if (tallies.error) out.push(`${tallies.error}: play stats left out.`, '');
  else {
    const ev = {}; const props = {};
    for (const { event, prop, value, n } of tallies.body.tallies ?? []) {
      if (!prop) ev[event] = (ev[event] ?? 0) + n;
      else ((props[`${event}:${prop}`] ??= {})[value] = (props[`${event}:${prop}`]?.[value] ?? 0) + n);
    }
    const e = (name) => ev[name] ?? 0;
    const values = (event, prop) => props[`${event}:${prop}`] ?? {};
    const won = values('fight-won', 'room'); const lost = values('fight-lost', 'room'); const left = values('fight-left', 'room');
    const inputs = [values('fight-won', 'input'), values('fight-lost', 'input'), values('fight-left', 'input')]
      .reduce((all, c) => { for (const [k, n] of Object.entries(c)) all[k] = (all[k] ?? 0) + n; return all; }, {});
    const perf = values('perf', 'fps');

    out.push(`${e('visit')} visits.`);
    out.push(`${e('run-start')} runs started, ${e('run-continue')} continued, ${e('campaign-won')} campaigns won, ${e('daily-start')} dailies started.`, '');

    out.push('## Rooms', '');
    if (e('fight-won') + e('fight-lost') === 0) out.push('No fights ended this week.', '');
    else {
      out.push(`${e('fight-won') + e('fight-lost')} fights ended: ${e('fight-won')} won, ${e('fight-lost')} lost; ${e('fight-left')} left half-way.`, '');
      const rooms = [...new Set([...Object.keys(won), ...Object.keys(lost), ...Object.keys(left)])].map((id) => {
        const w = won[id] ?? 0; const l = lost[id] ?? 0;
        return { id, w, l, left: left[id] ?? 0, rate: w + l ? l / (w + l) : 0 };
      }).sort((a, b) => b.rate - a.rate || b.l - a.l);
      out.push('| Room | Won | Lost | Left | Loss rate |', '|---|---|---|---|---|');
      for (const r of rooms) out.push(`| ${roomName(r.id)} | ${r.w} | ${r.l} | ${r.left} | ${r.w + r.l ? pct(r.l, r.w + r.l) : '–'} |`);
      const worst = rooms.find((r) => r.w + r.l >= WORST_MIN);
      if (worst) out.push('', `Worst room: ${roomName(worst.id)}, ${worst.l} of ${worst.w + worst.l} fights lost (${pct(worst.l, worst.w + worst.l)}).`);
      out.push('');
    }

    out.push('## Crashes', '');
    out.push(e('error') ? `${e('error')} crashes: ${ranked(values('error', 'browser'))}. Where: ${ranked(values('error', 'at'))}.` : 'No crashes.', '');

    out.push('## How they play', '');
    if (sum(inputs)) out.push(`Input: ${shares(inputs)}.`);
    if (sum(perf)) out.push(`Frame rate: ${shares(perf)} (${sum(perf)} visits).`);
    if (!sum(inputs) && !sum(perf)) out.push('Nothing recorded yet.');
    out.push('');
  }

  // --- Stored losses ---
  out.push('## Loss replays', '');
  const summary = await worker('/summary');
  if (summary.error) out.push(`${summary.error}.`);
  else {
    const byRoom = {};
    for (const r of summary.body.rooms ?? []) byRoom[r.room] = (byRoom[r.room] ?? 0) + (r.week ?? 0);
    const total = sum(byRoom);
    const [top] = Object.entries(byRoom).sort((a, b) => b[1] - a[1]);
    out.push(total ? `${total} losses stored, most in ${roomName(top[0])} (${top[1]}). Watch them: https://fatihsenel.github.io/crypt-skirmish/?losses` : 'No losses stored.');
  }
  out.push(...umami);
  return `${out.join('\n').trim()}\n`;
}

// npm run digest [-- --out file.md]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = await buildDigest({ fetch, keys: readKeys(process.env) });
  process.stdout.write(text);
  const at = process.argv.indexOf('--out');
  if (at > 0 && process.argv[at + 1]) writeFileSync(process.argv[at + 1], text);
}
