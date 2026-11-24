// The loss-replay Worker's event tallies (/tallies: { event, prop, value, n } rows, an event's
// total where prop is '') read into the numbers the weekly digest (scripts/digest.mjs) and the
// ?losses page's Play stats show. Pure: no DOM, no network.

import { NODES } from './game/campaign.js';
import { levelById } from './game/maps.js';

export const WORST_MIN = 5; // fights in a room before its loss rate counts
export const roomName = (id) => (NODES[id]?.level ? levelById(NODES[id].level).name : id);
export const pct = (n, of) => `${Math.round((100 * n) / of)}%`;
export const sum = (obj) => Object.values(obj).reduce((n, k) => n + k, 0);
const byMost = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);
/** "safari 5, chrome 1", the most first. */
export const ranked = (obj) => byMost(obj).map(([k, n]) => `${k} ${n}`).join(', ');
/** "touch 70%, mouse 30%", the most first. */
export const shares = (obj) => { const all = sum(obj); return byMost(obj).map(([k, n]) => `${k} ${pct(n, all)}`).join(', '); };

/** "41 (+12)": a count and its change from the period before; just "41" with nothing to compare. */
export const withChange = (n, before) => (before == null ? String(n) : `${n} (${n >= before ? '+' : '−'}${Math.abs(n - before)})`);

/**
 * The tallies as numbers: `count(event)`, `values(event, prop)` ({ value: n }), each room's
 * fights ({ id, won, lost, left, rate }, the highest loss rate first), the worst room once it
 * has WORST_MIN fights, the input used in fights, the frame-rate bands and the visits from
 * browsers that played before, and the falls into chasms ({ heroes, foes }). With `wider` (the same days plus as many before them, e.g. 14 for
 * 7), `change(event)` gives a count with its change from the period before ("41 (+12)").
 */
export function readTallies(rows, wider) {
  const totals = {}; const props = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.event !== 'string' || !Number.isFinite(r.n)) continue;
    if (!r.prop) totals[r.event] = (totals[r.event] ?? 0) + r.n;
    else { const p = (props[`${r.event}:${r.prop}`] ??= {}); p[r.value] = (p[r.value] ?? 0) + r.n; }
  }
  const count = (event) => totals[event] ?? 0;
  const values = (event, prop) => props[`${event}:${prop}`] ?? {};
  const [won, lost, left] = ['fight-won', 'fight-lost', 'fight-left'].map((e) => values(e, 'room'));
  const rooms = [...new Set([...Object.keys(won), ...Object.keys(lost), ...Object.keys(left)])].map((id) => {
    const w = won[id] ?? 0; const l = lost[id] ?? 0;
    return { id, won: w, lost: l, left: left[id] ?? 0, rate: w + l ? l / (w + l) : 0 };
  }).sort((a, b) => b.rate - a.rate || b.lost - a.lost);
  const inputs = {};
  for (const e of ['fight-won', 'fight-lost', 'fight-left']) for (const [k, n] of Object.entries(values(e, 'input'))) inputs[k] = (inputs[k] ?? 0) + n;
  // Falls into chasms, summed over every fight that ended or was left (each value is how many fell).
  const fallen = (prop) => ['fight-won', 'fight-lost', 'fight-left']
    .reduce((n, e) => n + Object.entries(values(e, prop)).reduce((m, [k, c]) => m + (Number(k) || 0) * c, 0), 0);
  const falls = { heroes: fallen('heroesFell'), foes: fallen('foesFell') };
  const tumbles = { heroes: fallen('heroesTumbled'), foes: fallen('foesTumbled') };
  const all = wider ? readTallies(wider) : null;
  const change = (event) => withChange(count(event), all ? all.count(event) - count(event) : null);
  return {
    count, values, rooms, inputs, change, falls, tumbles, perf: values('perf', 'fps'),
    returning: values('visit', 'returning').true ?? 0,
    worst: rooms.find((r) => r.won + r.lost >= WORST_MIN) ?? null,
  };
}
