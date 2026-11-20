// The weekly elite crypt: one room a week at New Game+ 3, the same for everyone that week.
// The week picks an elite trait, then a room whose elite has that trait at New Game+ 3 (see
// eliteTrait in combat.js), so the fight is an ordinary NG+ fight: its replays and links
// carry it as they carry any other. Like the daily it's played outside the campaign, as
// often as you like; each week keeps its best result, and weeks won in a row make a streak.

import { ELITE_TRAITS } from './combat.js';
import { roomElite } from './campaign.js';
import { hash, dayKey, dailyCampaign, DAILY_ROOMS_ACT_FOUR, addDaily, parseDaily } from './daily.js';

export const WEEKLY_KEY = 'crypt-skirmish:weekly';
export const WEEKLY_TIER = 3;

/**
 * The daily's rooms and party levels, less the ones a fresh party rarely wins at New Game+ 3
 * (the Catacombs, the Vault and the Barrow: under 40% in the sim). Every trait keeps a room.
 */
const TOO_HARD = ['catacombs', 'vault', 'barrow'];
export const WEEKLY_ROOMS = DAILY_ROOMS_ACT_FOUR.filter(([node]) => !TOO_HARD.includes(node));

/** The week of `date`, as its Monday's YYYY-MM-DD. */
export function weekKey(date = new Date()) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
  return dayKey(monday);
}

/** The week before `key`. */
export function prevWeek(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 7));
}

/** This week's crypt (or any week's): its elite trait, room, party level, class swaps and dice seed. */
export function weeklyPlan(key = weekKey()) {
  const seed = hash(`crypt-skirmish weekly ${key}`);
  const trait = ELITE_TRAITS[seed % ELITE_TRAITS.length].id;
  const rooms = WEEKLY_ROOMS.filter(([node]) => roomElite(node, WEEKLY_TIER).id === trait);
  const [node, level] = rooms[(seed >>> 3) % rooms.length];
  const classes = {};
  if ((seed >>> 8) & 1) classes.F = 'P';
  if ((seed >>> 9) & 1) classes.R = 'A';
  if ((seed >>> 10) & 1) classes.W = 'K';
  return { key, seed, node, level, classes, tier: WEEKLY_TIER, trait, weekly: true };
}

/** The campaign state a weekly is fought with (never saved). */
export const weeklyCampaign = (plan) => ({ ...dailyCampaign(plan), tier: plan.tier });

/** Weeks in a row won, ending this week (or last week, if this one isn't won yet). */
export function weekStreak(results, thisWeek = weekKey()) {
  let week = results[thisWeek]?.won ? thisWeek : prevWeek(thisWeek);
  let n = 0;
  while (results[week]?.won) {
    n++;
    week = prevWeek(week);
  }
  return n;
}

export function loadWeekly() {
  try {
    return parseDaily(localStorage.getItem(WEEKLY_KEY));
  } catch {
    return {};
  }
}

/** Store an attempt at week `key`'s crypt; returns the updated results. */
export function recordWeekly(key, attempt) {
  const results = addDaily(loadWeekly(), key, attempt);
  try {
    localStorage.setItem(WEEKLY_KEY, JSON.stringify(results));
  } catch {
    /* storage unavailable: the result just isn't kept */
  }
  return results;
}

/** A won weekly as text to paste anywhere, like the daily's. */
export function weeklyShareText({ key, room, trait, level, rounds, marks, streak = 0 }) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const fell = marks.filter((x) => x === 'fell').length;
  return [
    `Crypt Skirmish weekly elite, week of ${date}`,
    `${room}, ${trait} elite, party level ${level}, New Game+ ${WEEKLY_TIER}`,
    `Won in ${rounds} round${rounds === 1 ? '' : 's'}, ${fell === 0 ? 'nobody fell' : `${fell} of ${marks.length} fell`}`,
    marks.map((x) => (x === 'fell' ? '💀' : '🛡️')).join(''),
    ...(streak > 1 ? [`Streak: ${streak} weeks`] : []),
    'https://fatihsenel.github.io/crypt-skirmish/',
  ].join('\n');
}
