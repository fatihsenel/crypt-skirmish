// Achievements: goals that last across runs, kept in the browser. Each is checked when a room
// is won (`room`: the fight that just ended, its node, and `feats` main.js tallied from the
// fight's attacks), when a campaign is won (`run`: the finished campaign), or when the daily
// crypt is won (`daily`: the daily win streak, today included) or the weekly elite crypt
// (`weekly`: its streak of weeks), and unlocks once. A room's
// check also gets the bestiary: `met` (kinds met), `slain` (monsters slain, all runs) and
// `eliteKinds` (elite traits slain at least once, all runs).
// Pure checks here; main.js stores and shows them.

import { NODES, HERO_CODES } from './campaign.js';
import { classOf } from './units.js';
import { ELITE_TRAITS } from './elites.js';

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
    id: 'hold-door', name: 'Hold the door', desc: 'Fell a foe with a readied attack.',
    on: 'room', test: ({ feats }) => !!feats?.held,
  },
  {
    id: 'hot-coals', name: 'Hot coals', desc: 'Let a tipped brazier’s coals finish a foe.',
    on: 'room', test: ({ feats }) => !!feats?.coals,
  },
  {
    id: 'edge', name: 'Mind the gap', desc: 'Push a foe over a chasm’s edge.',
    on: 'room', test: ({ feats }) => !!feats?.edge,
  },
  {
    id: 'pinned', name: 'Pinned', desc: 'Slay a foe a hero is still grappling.',
    on: 'room', test: ({ feats }) => !!feats?.pinned,
  },
  {
    id: 'teamwork', name: 'Teamwork', desc: 'Fell a foe with an attack another hero’s Help set up.',
    on: 'room', test: ({ feats }) => !!feats?.teamwork,
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
    id: 'act-three', name: 'The weeping queen', desc: 'Clear the Throne, the end of act three.',
    on: 'room', test: ({ node, daily }) => !daily && node === 'throne',
  },
  {
    id: 'act-four', name: 'The mummy lord', desc: 'Clear the Hollow Tomb, the end of act four.',
    on: 'room', test: ({ node, daily }) => !daily && node === 'tomb',
  },
  {
    id: 'scholar', name: 'Scholar of the crypt', desc: 'Meet all 20 kinds of monster in the bestiary.',
    on: 'room', test: ({ met }) => (met ?? 0) >= 20,
  },
  {
    id: 'exterminator', name: 'Exterminator', desc: 'Slay 100 monsters, counted across runs.',
    on: 'room', test: ({ slain }) => (slain ?? 0) >= 100,
  },
  {
    id: 'warded', name: 'Not today', desc: 'Have Death Ward keep a hero on their feet.',
    on: 'room', test: ({ game }) => heroTotal(game.stats, 'warded') >= 1,
  },
  {
    id: 'elite', name: 'Gilded prey', desc: 'Slay an elite (New Game+ 2 and deeper).',
    on: 'room', test: ({ game }) => game.units.some((u) => u.elite && !u.alive),
  },
  {
    id: 'stay-down', name: 'Stay down', desc: 'Finish a Relentless elite in the same round it clung on at 1 HP.',
    on: 'room', test: ({ feats }) => !!feats?.stayDown,
  },
  {
    id: 'elite-hunter', name: 'Trophy hunter', desc: 'Slay an elite of every trait, counted across runs.',
    on: 'room', test: ({ eliteKinds }) => (eliteKinds ?? 0) >= ELITE_TRAITS.length,
  },
  {
    id: 'no-rest', name: 'No rest for the wicked', desc: 'Win a campaign through the Black Armory, skipping the Ember Hearth.',
    on: 'run', test: ({ state }) => (state.cleared ?? []).includes('armory'),
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
    id: 'ngplus', name: 'Back for more', desc: 'Win a New Game+.',
    on: 'run', test: ({ state }) => (state.tier ?? 0) >= 1,
  },
  {
    id: 'ngplus3', name: 'Deeper still', desc: 'Win New Game+ 3 or deeper.',
    on: 'run', test: ({ state }) => (state.tier ?? 0) >= 3,
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
    id: 'new-blood', name: 'New blood', desc: 'Win a campaign with a hero who isn’t one of the first four classes.',
    on: 'run',
    test: ({ state }) => HERO_CODES.some((c) => classOf(c, state.party?.[c]) !== c),
  },
  {
    id: 'daily', name: 'Daily delver', desc: 'Win a daily crypt.',
    on: 'daily', test: () => true,
  },
  {
    id: 'daily-streak', name: 'Creature of habit', desc: 'Win the daily crypt 3 days in a row.',
    on: 'daily', test: ({ streak }) => streak >= 3,
  },
  {
    id: 'weekly', name: 'Elite of the week', desc: 'Win a weekly elite crypt.',
    on: 'weekly', test: () => true,
  },
  {
    id: 'weekly-streak', name: 'Season of the hunt', desc: 'Win the weekly elite crypt 3 weeks in a row.',
    on: 'weekly', test: ({ streak }) => streak >= 3,
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
