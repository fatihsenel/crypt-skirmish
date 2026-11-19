// The daily crypt: one room a day, the same for everyone on that date. The date picks the
// room, the party (its level, and whether a Paladin or a Ranger comes along) and the seed the
// fight's dice start from. It's played outside the campaign (the save isn't touched), as
// often as you like; the best result of the day is kept, and wins on days in a row make a
// streak.

import { newCampaign, heroUnit } from './campaign.js';
import { MAX_LEVEL } from './units.js';

export const DAILY_KEY = 'crypt-skirmish:daily';
const KEEP_DAYS = 60;

/**
 * The rooms a daily can be, with the party level that suits each (roughly where a campaign
 * party would be on reaching it). The final room is left out: it ends a campaign.
 */
export const DAILY_ROOMS = [
  ['crypt', 3], ['warren', 3], ['ossuary', 3], ['sanctum', 4], ['catacombs', 4], ['vault', 4],
  ['barrow', 5], ['larder', 5], ['nest', 6], ['gallery', 6],
];

/**
 * From this date the daily can also be the Throne (no longer the last room) and act four's
 * Halls and Armory. Days before it keep the old list, so no past daily changes.
 */
export const ACT_FOUR_DAILY_FROM = '2026-11-20';
export const DAILY_ROOMS_ACT_FOUR = [...DAILY_ROOMS, ['throne', 6], ['halls', 7], ['armory', 8]];

/** The room list a day's daily is drawn from. */
export const dailyRooms = (key) => (key >= ACT_FOUR_DAILY_FROM ? DAILY_ROOMS_ACT_FOUR : DAILY_ROOMS);

/** A date as its local YYYY-MM-DD. */
export function dayKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The day before `key`. */
export function prevDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1));
}

/** A 32-bit hash of a string (FNV-1a, then mixed), so neighbouring dates land far apart. */
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Today's crypt (or any day's): room, party level, class swaps and dice seed. */
export function dailyPlan(key = dayKey()) {
  const seed = hash(`crypt-skirmish daily ${key}`);
  const rooms = dailyRooms(key);
  const [node, level] = rooms[seed % rooms.length];
  const classes = {};
  if ((seed >>> 8) & 1) classes.F = 'P';
  if ((seed >>> 9) & 1) classes.R = 'A';
  if ((seed >>> 10) & 1) classes.W = 'K';
  return { key, seed, node, level, classes };
}

/** A fresh, rested party at `level` (3 to MAX_LEVEL). */
export function partyAt(state, level) {
  if (!(level > 3 && level <= MAX_LEVEL)) return state;
  for (const [code, rec] of Object.entries(state.party)) {
    const u = heroUnit(code, { ...rec, level });
    Object.assign(rec, { level, hp: u.maxHp, slots: { ...u.slotMax } });
    if (u.layOnHandsMax) rec.layOnHands = u.layOnHandsMax;
  }
  return state;
}

/** The campaign state a daily is fought with (never saved). */
export const dailyCampaign = (plan) => partyAt(newCampaign('normal', {}, plan.classes), plan.level);

/** Whether result `a` beats `b`: a win beats a loss, then fewer rounds, then fewer heroes down. */
export function better(a, b) {
  if (!b) return true;
  if (a.won !== b.won) return a.won;
  if (a.rounds !== b.rounds) return a.won ? a.rounds < b.rounds : a.rounds > b.rounds;
  return a.downed < b.downed;
}

/**
 * The results with this attempt added: each day keeps its best result and how many tries it
 * took, and only the last KEEP_DAYS days are kept.
 */
export function addDaily(results, key, attempt) {
  const prev = results[key];
  const best = better(attempt, prev) ? attempt : { won: prev.won, rounds: prev.rounds, downed: prev.downed };
  const next = { ...results, [key]: { ...best, node: attempt.node, tries: (prev?.tries ?? 0) + 1 } };
  const days = Object.keys(next).sort().slice(-KEEP_DAYS);
  return Object.fromEntries(days.map((d) => [d, next[d]]));
}

/** Days in a row won, ending today (or yesterday, if today isn't won yet). */
export function streak(results, today = dayKey()) {
  let day = results[today]?.won ? today : prevDay(today);
  let n = 0;
  while (results[day]?.won) {
    n++;
    day = prevDay(day);
  }
  return n;
}

/** Parse the stored results; anything unreadable counts as none. */
export function parseDaily(text) {
  try {
    const raw = JSON.parse(text ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([k, r]) =>
      /^\d{4}-\d\d-\d\d$/.test(k) && r && typeof r.won === 'boolean' && Number.isFinite(r.rounds)));
  } catch {
    return {};
  }
}

export function loadDaily() {
  try {
    return parseDaily(localStorage.getItem(DAILY_KEY));
  } catch {
    return {};
  }
}

/** Store an attempt at `key`'s crypt; returns the updated results. */
export function recordDaily(key, attempt) {
  const results = addDaily(loadDaily(), key, attempt);
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(results));
  } catch {
    /* storage unavailable: the result just isn't kept */
  }
  return results;
}

/**
 * A won daily as text to paste anywhere: the day, the room, how it went, a mark per hero
 * (a shield if they stayed up, a skull if they fell) and the streak.
 */
export function shareText({ key, room, level, rounds, marks, streak: days = 0 }) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const fell = marks.filter((x) => x === 'fell').length;
  return [
    `Crypt Skirmish daily, ${date}`,
    `${room}, party level ${level}`,
    `Won in ${rounds} round${rounds === 1 ? '' : 's'}, ${fell === 0 ? 'nobody fell' : `${fell} of ${marks.length} fell`}`,
    marks.map((x) => (x === 'fell' ? '💀' : '🛡️')).join(''),
    ...(days > 1 ? [`Streak: ${days} days`] : []),
    'https://fatihsenel.github.io/crypt-skirmish/',
  ].join('\n');
}
