// Achievements: goals that last across runs, kept in the browser. Each is checked when a room
// is won (`room`: from the fight that just ended) or when a campaign is won (`run`: from the
// finished campaign), and unlocks once. Pure checks here; main.js stores and shows them.

import { NODES, HERO_CODES } from './campaign.js';
import { classOf } from './units.js';

export const ACHIEVEMENTS_KEY = 'crypt-skirmish:achievements';

const heroTotal = (stats, field) => Object.values(stats ?? {}).reduce((n, h) => n + (h[field] ?? 0), 0);

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
    id: 'act-one', name: 'The necromancer', desc: 'Clear the Sanctum, the end of act one.',
    on: 'room', test: ({ node }) => node === 'sanctum',
  },
  {
    id: 'act-two', name: 'The barrow king', desc: 'Clear the Barrow, the end of act two.',
    on: 'room', test: ({ node }) => node === 'barrow',
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
    id: 'new-blood', name: 'New blood', desc: 'Win a campaign with a Paladin or a Ranger in the party.',
    on: 'run',
    test: ({ state }) => HERO_CODES.some((c) => ['P', 'A'].includes(classOf(c, state.party?.[c]))),
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
