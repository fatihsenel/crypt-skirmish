// Achievements: goals that last across runs, kept in the browser. Each is checked when a room
// is won (`room`: the fight that just ended, its node, and `feats` main.js tallied from the
// fight's attacks), when a campaign is won (`run`: the finished campaign), or when the daily
// crypt is won (`daily`: the daily win streak, today included), and unlocks once.
// Pure checks here; main.js stores and shows them.

import { NODES, HERO_CODES } from './campaign.js';
import { classOf } from './units.js';

export const ACHIEVEMENTS_KEY = 'crypt-skirmish:achievements';

const heroTotal = (stats, field) => Object.values(stats ?? {}).reduce((n, h) => n + (h[field] ?? 0), 0);
const heroesUp = (game) => game.units.filter((u) => u.team === 'heroes' && u.alive).length;

/** In the order the title screen lists them. */
export const ACHIEVEMENTS = [
  {
    id: 'first-room', name: 'Into the dark', desc: 'Win your first room.',
    on: 'room', test: () => true,
  },
  {
    id: 'swift', name: 'Swift work', desc: 'Win a room in 3 rounds or fewer.',
    on: 'room', test: ({ game }) => game.round <= 3,
  },
  {
    id: 'crits', name: 'Lucky streak', desc: 'Land 3 critical hits in one fight.',
    on: 'room', test: ({ game }) => heroTotal(game.stats, 'crits') >= 3,
  },
  {
    id: 'thorough', name: 'Thorough', desc: 'Open every chest in a room before the last enemy falls.',
    on: 'room',
    test: ({ game }) => {
      const chests = [...(game.grid?.chests?.values() ?? [])].filter((c) => !c.mimic);
      return chests.length > 0 && chests.every((c) => c.opened);
    },
  },
  {
    id: 'mimic', name: 'Not a chest', desc: 'Defeat a mimic.',
    on: 'room', test: ({ game }) => game.units.some((u) => u.cls === 'Mimic' && !u.alive && !u.corpse),
  },
  {
    id: 'clean-boss', name: 'Clean kill', desc: 'Beat a boss room without a hero falling.',
    on: 'room', test: ({ game, node }) => !!NODES[node]?.boss && heroTotal(game.stats, 'downed') === 0,
  },
  {
    id: 'heavy-blow', name: 'Heavy blow', desc: 'Deal 25 or more damage with a single attack.',
    on: 'room', test: ({ feats }) => (feats?.maxHit ?? 0) >= 25,
  },
  {
    id: 'sneaky', name: 'Knife in the dark', desc: 'Land 4 sneak attacks in one fight.',
    on: 'room', test: ({ feats }) => (feats?.sneaks ?? 0) >= 4,
  },
  {
    id: 'medic', name: 'Field medic', desc: 'Heal 30 HP in one fight.',
    on: 'room', test: ({ game }) => heroTotal(game.stats, 'healing') >= 30,
  },
  {
    id: 'one-hero', name: 'One-hero army', desc: 'Win a room where one hero lands every kill (at least 4).',
    on: 'room',
    test: ({ game }) => {
      const kills = Object.values(game.stats ?? {}).map((h) => h.kills ?? 0);
      const total = kills.reduce((a, b) => a + b, 0);
      return total >= 4 && kills.includes(total);
    },
  },
  {
    id: 'last-stand', name: 'Last one standing', desc: 'Win a room with only one hero still on their feet.',
    on: 'room', test: ({ game }) => heroesUp(game) === 1,
  },
  {
    id: 'act-one', name: 'The necromancer', desc: 'Clear the Sanctum, the end of act one.',
    on: 'room', test: ({ node, daily }) => !daily && node === 'sanctum', // campaign progress, not a daily
  },
  {
    id: 'act-two', name: 'The barrow king', desc: 'Clear the Barrow, the end of act two.',
    on: 'room', test: ({ node, daily }) => !daily && node === 'barrow',
  },
  {
    id: 'campaign', name: 'Crypt cleared', desc: 'Win a campaign.',
    on: 'run', test: () => true,
  },
  {
    id: 'hard', name: 'Hard as bone', desc: 'Win a campaign on Hard.',
    on: 'run', test: ({ state }) => state.difficulty === 'hard',
  },
  {
    id: 'unbroken', name: 'Unbroken', desc: 'Win a campaign without losing a fight.',
    on: 'run', test: ({ state }) => (state.stats?.lost ?? 0) === 0,
  },
  {
    id: 'iron', name: 'Iron party', desc: 'Win a campaign without a hero ever falling.',
    on: 'run', test: ({ state }) => heroTotal(state.stats?.heroes, 'downed') === 0,
  },
  {
    id: 'new-blood', name: 'New blood', desc: 'Win a campaign with a Paladin, a Ranger or a Warlock in the party.',
    on: 'run',
    test: ({ state }) => HERO_CODES.some((c) => ['P', 'A', 'K'].includes(classOf(c, state.party?.[c]))),
  },
  {
    id: 'daily', name: 'Daily delver', desc: 'Win a daily crypt.',
    on: 'daily', test: () => true,
  },
  {
    id: 'daily-streak', name: 'Creature of habit', desc: 'Win the daily crypt 3 days in a row.',
    on: 'daily', test: ({ streak }) => streak >= 3,
  },
];

/** The achievements this event earns that aren't already unlocked. */
export function earned(event, ctx, unlocked) {
  return ACHIEVEMENTS.filter((a) => a.on === event && !unlocked[a.id] && a.test(ctx));
}

/** Parse the stored { id: timestamp } map; unknown ids and junk are dropped. */
export function parseAchievements(text) {
  try {
    const raw = JSON.parse(text ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(ACHIEVEMENTS.filter((a) => Number.isFinite(raw[a.id])).map((a) => [a.id, raw[a.id]]));
  } catch {
    return {};
  }
}

export function loadAchievements() {
  try {
    return parseAchievements(localStorage.getItem(ACHIEVEMENTS_KEY));
  } catch {
    return {};
  }
}

/** Check an event, store anything new, and return what was just unlocked (for the banner). */
export function unlock(event, ctx, when = Date.now()) {
  const have = loadAchievements();
  const fresh = earned(event, ctx, have);
  if (fresh.length) {
    for (const a of fresh) have[a.id] = when;
    try {
      localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(have));
    } catch {
      /* storage unavailable: they'll unlock again next time */
    }
  }
  return fresh;
}
