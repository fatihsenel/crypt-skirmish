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

/**
 * The tallies as numbers: `count(event)`, `values(event, prop)` ({ value: n }), each room's
 * fights ({ id, won, lost, left, rate }, the highest loss rate first), the worst room once it
 * has WORST_MIN fights, and the input used in fights and the frame-rate bands.
 */
export function readTallies(rows) {
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
  return {
    count, values, rooms, inputs, perf: values('perf', 'fps'),
    worst: rooms.find((r) => r.won + r.lost >= WORST_MIN) ?? null,
  };
}
