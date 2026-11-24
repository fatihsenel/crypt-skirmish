// Campaign: the dungeon map that links the levels, party XP and levelling, the
// party's pack of loot, and save data. Pure state, no DOM and no storage. Every
// function returns a new state; the controller decides when to persist it.

import {
  TEMPLATES, PROGRESSION, MAX_LEVEL, CLASS_CHOICES, createUnit, applyLevel, classOf, asiLevels, asiDefault, cleanPick, ABILITY_NAMES,
} from './units.js';
import { ITEMS, applyItems, relicFrom, cleanRelics } from './items.js';
import { abilityMod } from './dice.js';
import { levelById } from './maps.js';
import { ELITE_TRAITS, eliteTrait, RULES } from './elites.js';
import { goldFor, cleanGold } from './shop.js';

export const SAVE_VERSION = 1;
export const HERO_CODES = ['F', 'W', 'R', 'C'];

/** Party XP (shared) needed for each level. Heroes start at level 3. */
export const XP_LEVELS = { 4: 450, 5: 900, 6: 2000, 7: 9700, 8: 10400 };

/**
 * Chosen for the whole run. Monsters' HP is scaled and their weapon attacks get a bonus
 * (or penalty) to hit and damage; the heroes are untouched.
 */
export const DIFFICULTIES = {
  story: { name: 'Story', hp: 0.75, bonus: -1, desc: 'Weaker monsters: for enjoying the tale.' },
  normal: { name: 'Normal', hp: 1, bonus: 0, desc: 'The crypt as intended.' },
  hard: { name: 'Hard', hp: 1.2, bonus: 1, thin: true, desc: 'Tougher monsters that hit harder. Every choice counts.' },
};

/** The deepest New Game+ tier (a link carries up to this). */
export const MAX_TIER = 99;

/**
 * Each New Game+ tier adds this much monster HP (a share of the difficulty's). Monsters also get
 * +1 to hit and damage from the first tier on, but no more: +2 made each tier a cliff (npm run sim).
 */
export const TIER_HP = 0.1;

/** The `{ hp, bonus, thin }` the rules take for a run's difficulty at a New Game+ tier. */
export function runDifficulty(difficulty, tier = 0) {
  const base = DIFFICULTIES[difficulty] ?? DIFFICULTIES.normal;
  if (!tier) return base;
  // From NG+2 each room's strongest monster is an elite (Game#makeElite).
  return { ...base, hp: base.hp * (1 + TIER_HP * tier), bonus: base.bonus + 1, ...(tier >= 2 && { elite: tier }) };
}

/** "Hard", or "Hard NG+2" for a New Game+ run. */
export function difficultyLabel(difficulty, tier = 0) {
  const name = (DIFFICULTIES[difficulty] ?? DIFFICULTIES.normal).name;
  return tier > 0 ? `${name} NG+${tier}` : name;
}

/**
 * The dungeon map. Columns go deeper; `next` lists where you can go from here. An entry
 * may be { to, ifAll: [...] }: only offered once all those rooms are cleared.
 * `unlessAll` on a node hides it once all those rooms are cleared.
 * The fork: take one middle room and rest at the chapel, or clear both middle rooms
 * (more XP and loot) and face the necromancer without that rest.
 * `boss` draws a crown on the map; `actBreak` gives a long rest after the fight.
 * Act two (after the sanctum) asks the same question once more: the vault or the well (or the
 * cistern, a room on two floors).
 * Act three (after the barrow) asks it again: the gallery's loot or the shrine's rest.
 * Act four (after the throne) asks it again: the armory's loot or the hearth's rest.
 * Act five (after the tomb) asks it a last time: the basilisk den's loot or the grotto's rest.
 */
export const NODES = {
  crypt: { kind: 'fight', level: 'crypt', col: 0, row: 1, next: ['warren', 'ossuary', 'pilgrim'] },
  // A stop with a choice and no fight (EVENTS below): off the crypt, on the way to either middle room.
  pilgrim: { kind: 'event', col: 1, row: 1, next: ['warren', 'ossuary'], name: 'The Wounded Pilgrim', short: 'Pilgrim' },
  warren: {
    kind: 'fight', level: 'warren', col: 1, row: 0,
    next: ['ossuary', 'chapel', { to: 'sanctum', ifAll: ['warren', 'ossuary'] }],
    teaser: 'Goblins and an orc. Most XP; a chest with a magic weapon.',
  },
  ossuary: {
    kind: 'fight', level: 'ossuary', col: 1, row: 2,
    next: ['warren', 'chapel', { to: 'sanctum', ifAll: ['warren', 'ossuary'] }],
    teaser: 'Skeletons and rats. Two chests, one with a magic ring.',
  },
  chapel: {
    kind: 'rest', col: 2, row: 1, next: ['sanctum'], unlessAll: ['warren', 'ossuary'],
    name: 'The Forgotten Chapel', short: 'Chapel', verb: 'Rest at the chapel',
    intro: 'A quiet chapel, untouched by the dead. The party takes a long rest.',
    teaser: 'A long rest: full HP and every spell slot back. No XP, no loot.',
  },
  sanctum: {
    kind: 'fight', level: 'sanctum', short: 'Sanctum', col: 3, row: 1, next: ['catacombs'],
    boss: true, actBreak: true,
    teaser: 'Morvath the necromancer, the end of the first act. Afterwards the party takes a long rest.',
  },
  // Act two: one fight, then the vault's loot or the well's rest, an optional larder, then the wight.
  catacombs: {
    kind: 'fight', level: 'catacombs', col: 4, row: 1, next: ['vault', 'cistern', 'well'],
    teaser: 'Ghouls: their claws poison. Skeletons besides.',
  },
  vault: {
    kind: 'fight', level: 'vault', short: 'Vault', col: 5, row: 0, next: ['barrow', 'larder'],
    teaser: 'Guarded treasure: a magic cloak and weapon. Skip the rest at the well.',
  },
  // A room on two floors: skeletons in the hall above, ghouls in the flooded cistern below.
  cistern: {
    kind: 'fight', level: 'cistern', short: 'Cistern', col: 5, row: 1, next: ['barrow', 'larder'],
    teaser: 'Two floors: skeletons in the hall above, ghouls in the flooded cistern below, stairs between. A magic weapon and ring, no rest.',
  },
  well: {
    kind: 'rest', col: 5, row: 2, next: ['barrow', 'larder'],
    name: 'The Still Well', short: 'Well', verb: 'Rest at the well',
    intro: 'Clean water and a door that bars from the inside. The party takes a long rest.',
    teaser: 'A long rest: full HP and every spell slot back. No XP, no loot.',
  },
  // Optional: a ghast's hoard on the way down, but no rest before the wight.
  larder: {
    kind: 'fight', level: 'larder', short: 'Larder', col: 6, row: 2, next: ['barrow'],
    teaser: 'A ghast and its ghouls. A runed weapon and potions, but no rest before the Barrow.',
  },
  barrow: {
    kind: 'fight', level: 'barrow', short: 'Barrow', col: 7, row: 1, next: ['nest'], boss: true,
    actBreak: true,
    teaser: 'Varek the wight, the end of the second act. Afterwards the party takes a long rest.',
  },
  // Act three: the nest, then the gallery's loot or the shrine's rest, then the banshee.
  nest: {
    kind: 'fight', level: 'nest', short: 'Nest', col: 8, row: 1, next: ['gallery', 'shrine', 'altar'],
    teaser: 'Giant spiders: their webs hold you fast, their bites poison.',
  },
  gallery: {
    kind: 'fight', level: 'gallery', short: 'Gallery', col: 9, row: 0, next: ['throne'],
    teaser: 'Specters and skeletons. A magic cloak and weapon, but no rest before the throne.',
  },
  shrine: {
    kind: 'rest', col: 9, row: 2, next: ['throne'],
    name: 'The Silent Shrine', short: 'Shrine', verb: 'Rest at the shrine',
    intro: 'A shrine to a forgotten saint, where no ghost will tread. The party takes a long rest.',
    teaser: 'A long rest: full HP and every spell slot back. No XP, no loot.',
  },
  altar: { kind: 'event', col: 9, row: 1, next: ['gallery', 'shrine'], name: 'The Blood Altar', short: 'Altar' },
  throne: {
    kind: 'fight', level: 'throne', short: 'Throne', col: 10, row: 1, next: ['halls'], boss: true,
    actBreak: true,
    teaser: 'Ysolde the banshee, the end of the third act. Afterwards the party takes a long rest.',
  },
  // Act four: the halls, then the armory's loot or the hearth's rest, then the mummy lord.
  halls: {
    kind: 'fight', level: 'halls', short: 'Halls', col: 11, row: 1, next: ['armory', 'hearth', 'reliquary'],
    teaser: 'Mummies, skeletons and a wraith whose touch drains the life from you.',
  },
  armory: {
    kind: 'fight', level: 'armory', short: 'Armory', col: 12, row: 0, next: ['tomb'],
    teaser: 'Fallen knights in black iron. A Runed Weapon +2, but no rest before the tomb.',
  },
  hearth: {
    kind: 'rest', col: 12, row: 2, next: ['tomb'],
    name: 'The Ember Hearth', short: 'Hearth', verb: 'Rest at the hearth',
    intro: 'Embers still glow in the hearth of an old guardroom. The party takes a long rest.',
    teaser: 'A long rest: full HP and every spell slot back. No XP, no loot.',
  },
  reliquary: { kind: 'event', col: 12, row: 1, next: ['armory', 'hearth'], name: 'The Saint’s Reliquary', short: 'Reliquary' },
  tomb: {
    kind: 'fight', level: 'tomb', short: 'Tomb', col: 13, row: 1, next: ['bridge'], boss: true,
    actBreak: true,
    teaser: 'Nekhet the Mummy Lord, the end of the fourth act. Afterwards the party takes a long rest.',
  },
  // Act five: the bridge, then the basilisk den's loot, the undercroft's two floors or the grotto's rest, then the minotaur.
  bridge: {
    kind: 'fight', level: 'bridge', short: 'Bridge', col: 14, row: 1, next: ['lair', 'undercroft', 'grotto'],
    teaser: 'Gargoyles and a fallen knight, across a chasm no one can climb.',
  },
  lair: {
    kind: 'fight', level: 'lair', short: 'Den', col: 15, row: 0, next: ['labyrinth'],
    teaser: 'Basilisks: their bite turns you to stone. A Runed Weapon +2, but no rest before the Labyrinth.',
  },
  undercroft: {
    kind: 'fight', level: 'undercroft', short: 'Undercroft', col: 15, row: 1, next: ['labyrinth'],
    teaser: 'Two floors: gargoyles and a knight in the chapel, basilisks and ghouls waiting below. A Runed Weapon +2, no rest.',
  },
  grotto: {
    kind: 'rest', col: 15, row: 2, next: ['labyrinth'],
    name: 'The Dripping Grotto', short: 'Grotto', verb: 'Rest in the grotto',
    intro: 'A dry ledge above a slow stream, too narrow for anything big to follow. The party takes a long rest.',
    teaser: 'A long rest: full HP and every spell slot back. No XP, no loot.',
  },
  labyrinth: {
    kind: 'fight', level: 'labyrinth', short: 'Labyrinth', col: 16, row: 1, next: [], boss: true,
    teaser: 'Tharok the minotaur, who charges down the corridors. The end of the road.',
  },
};

export const START_NODE = 'crypt';

/**
 * The stops with a choice and no fight. Each option is taken in camp (takeEvent); none rolls
 * dice. Their lasting effects ride with the party: potions, the pack, and the altar's blessing
 * as an item, so fight records and links need nothing new.
 */
export const EVENTS = {
  pilgrim: {
    intro: 'A pilgrim slumps against the wall, a goblin arrow in his leg and a fat purse at his belt.',
    teaser: 'No fight. Help him, or help yourselves.',
    options: {
      tend: { label: 'Tend his wounds', desc: 'Give up one potion. After the Sanctum he finds you again and leaves a potion for every hero.' },
      rob: { label: 'Take his purse', desc: 'Two potions now. You won’t see him again.' },
    },
  },
  altar: {
    intro: 'A black altar, warm to the touch. Old blood has run in its grooves.',
    teaser: 'No fight. Pay in blood for a blessing.',
    options: {
      offer: { label: 'Offer blood', desc: 'Every hero loses a quarter of their HP maximum. The party is blessed for its next fight: +1 to hit and +1 AC.' },
    },
  },
  reliquary: {
    intro: 'A saint’s reliquary behind an iron door, its lock thick with rust.',
    teaser: 'No fight. It opens only with the Iron Key from the Sealed Vault.',
    options: {
      open: { label: 'Open the reliquary', desc: 'Use the Iron Key: a Periapt of Wound Closure goes into the pack.' },
    },
  },
};

/**
 * A hero name as typed on the title screen, made safe: letters, digits, spaces, apostrophes
 * and hyphens only (so it can go straight into the log's HTML), at most 14 characters.
 */
export function cleanName(text) {
  return String(text ?? '').replace(/[^\p{L}\p{N} '’-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 14).trim();
}

export const nodeName = (id) => NODES[id].name ?? levelById(NODES[id].level).name;

/** Why option `opt` at event `id` can't be taken now, or null. */
export function eventProblem(state, id, opt) {
  if (NODES[id]?.kind !== 'event' || !EVENTS[id].options[opt]) return 'No such choice';
  if (!choices(state).includes(id)) return 'Not on the way';
  if (id === 'pilgrim' && opt === 'tend' && !HERO_CODES.some((c) => state.party[c].potions > 0)) return 'No potion to spare';
  if (id === 'reliquary' && !state.pack.includes('ironKey')) return 'Sealed: it needs the Iron Key from the Sealed Vault';
  return null;
}

/** Take option `opt` at event `id`: the party moves there and lives with it. Returns { state, report }. */
export function takeEvent(prev, id, opt) {
  const problem = eventProblem(prev, id, opt);
  if (problem) throw new Error(problem);
  const state = clone(prev);
  const report = { event: id, option: opt, loot: [] };
  const byPotions = (most) => [...HERO_CODES].sort((a, b) => (state.party[most ? b : a].potions - state.party[most ? a : b].potions));
  if (id === 'pilgrim' && opt === 'tend') {
    state.party[byPotions(true)[0]].potions--;
    state.pilgrim = 'owed';
  }
  if (id === 'pilgrim' && opt === 'rob') {
    for (const code of byPotions(false).slice(0, 2)) state.party[code].potions++;
    state.pilgrim = 'robbed';
  }
  if (id === 'altar') {
    for (const code of HERO_CODES) {
      const rec = state.party[code];
      rec.hp = Math.max(1, rec.hp - Math.floor(restedHero(code, rec).maxHp / 4));
      if (!rec.items.includes('altarBlessing')) rec.items.push('altarBlessing');
    }
  }
  if (id === 'reliquary') {
    state.pack.splice(state.pack.indexOf('ironKey'), 1);
    state.pack.push('periaptWounds');
    report.loot.push('periaptWounds');
  }
  state.cleared.push(id);
  state.at = id;
  return { state, report };
}

export function levelForXp(xp) {
  let level = 3;
  for (const [l, need] of Object.entries(XP_LEVELS)) if (xp >= need) level = Math.max(level, Number(l));
  return Math.min(level, MAX_LEVEL);
}

/**
 * A hero unit as described by a party record (for the camp screen and rest maths). The
 * record's `cls` picks the class for the slot; pass it along with partial records.
 */
export function heroUnit(code, rec) {
  const u = createUnit(classOf(code, rec), 0, 0);
  u.slot = code;
  applyLevel(u, rec.level, rec.picks);
  applyItems(u, rec.items);
  for (const f of ['hp', 'alive', 'slots', 'potions', 'layOnHands', 'flasks', 'caltrops']) if (rec[f] !== undefined) u[f] = structuredClone(rec[f]);
  u.hp = Math.min(u.hp, u.maxHp);
  if (rec.name) u.name = rec.name;
  return u;
}

/** The fresh-from-a-long-rest version of a slot's hero at `level`, with their items (an Amulet of Health adds HP). */
const restedHero = (code, rec, level = rec.level) => heroUnit(code, { cls: rec.cls, level, items: rec.items ?? [], picks: rec.picks });

/** A hero's display name: the one typed on the title screen, or the class's default. */
export const heroName = (code, rec) => rec.name ?? TEMPLATES[classOf(code, rec)].name;

const STAT_FIELDS = ['damage', 'kills', 'crits', 'healing', 'downed'];

/** The run's tally, shown at the end: rooms won, fights lost, rounds, and each hero's numbers. */
export function blankStats() {
  const heroes = {};
  for (const code of HERO_CODES) heroes[code] = Object.fromEntries(STAT_FIELDS.map((f) => [f, 0]));
  return { won: 0, lost: 0, rounds: 0, heroes };
}

/** The elite trait waiting in a fight room at this New Game+ tier (as the fight will pick it), or null. */
export function roomElite(nodeId, tier) {
  const n = NODES[nodeId];
  if (!n || n.kind === 'rest' || !n.level || (tier ?? 0) < 2) return null;
  return eliteTrait(levelById(n.level).id, tier);
}

/** A save's stats if they look right, else a fresh tally (saves from before stats). */
function validStats(s) {
  const ok = s && ['won', 'lost', 'rounds'].every((f) => Number.isFinite(s[f]))
    && HERO_CODES.every((c) => STAT_FIELDS.every((f) => Number.isFinite(s.heroes?.[c]?.[f])));
  return ok ? s : blankStats();
}

/** Add a fight's per-hero tally (game.stats) to the run's. */
function addStats(stats, game) {
  stats.rounds += game.round;
  // New Game+ 2 and deeper: the room's elite, by trait (a won room has none left standing).
  for (const u of game.units ?? []) {
    if (!u.elite || u.alive) continue;
    stats.elites ??= {};
    stats.elites[u.elite] = (stats.elites[u.elite] ?? 0) + 1;
  }
  for (const [code, t] of Object.entries(game.stats ?? {})) {
    const h = stats.heroes[code];
    if (h) for (const f of STAT_FIELDS) h[f] += t[f] ?? 0;
  }
}

/** A lost fight counts toward the run's tally (its rounds, and one more defeat). */
export function recordDefeat(prev, game, nodeId) {
  const state = clone(prev);
  state.stats = validStats(state.stats);
  state.stats.lost++;
  state.stats.rounds += game.round;
  if (nodeId) state.fails = { ...state.fails, [nodeId]: (state.fails?.[nodeId] ?? 0) + 1 }; // for easeOffer
  return state;
}

/** Losses in one room before the Defeat banner offers to lower the run's difficulty. */
export const EASE_AFTER = 3;
const EASIER = { hard: 'normal', normal: 'story' };

/** The difficulty one step down, offered after EASE_AFTER losses in `nodeId` this run, or null. */
export function easeOffer(state, nodeId) {
  return (state.fails?.[nodeId] ?? 0) >= EASE_AFTER ? EASIER[state.difficulty] ?? null : null;
}

/** The run, one difficulty down for the rest of it (what the records and achievements then see). */
export function easeRun(prev) {
  const state = clone(prev);
  state.difficulty = EASIER[state.difficulty] ?? state.difficulty;
  state.fails = {};
  return state;
}

/**
 * Everything the ending screen shows, as plain data: the run's totals and one row per hero,
 * with `best` naming the stat columns that hero leads (ties share it; zeros lead nothing).
 */
export function runSummary(state) {
  const stats = validStats(state.stats);
  const heroes = HERO_CODES.map((code) => {
    const rec = state.party[code];
    return {
      code, name: heroName(code, rec), cls: TEMPLATES[classOf(code, rec)].cls, level: rec.level,
      items: (rec.items ?? []).map((id) => ITEMS[id]?.name).filter(Boolean), ...stats.heroes[code], best: [],
    };
  });
  for (const f of ['damage', 'kills', 'crits', 'healing']) {
    const top = Math.max(...heroes.map((h) => h[f]));
    if (top > 0) for (const h of heroes) if (h[f] === top) h.best.push(f);
  }
  const elites = ELITE_TRAITS
    .filter((t) => Number.isInteger(stats.elites?.[t.id]) && stats.elites[t.id] > 0)
    .map((t) => ({ id: t.id, name: t.name, count: stats.elites[t.id] }));
  return {
    difficulty: difficultyLabel(state.difficulty, state.tier),
    xp: state.xp,
    level: Math.max(...heroes.map((h) => h.level)),
    won: stats.won,
    lost: stats.lost,
    rounds: stats.rounds,
    elites,
    eliteCount: elites.reduce((n, e) => n + e.count, 0),
    route: (state.cleared ?? []).filter((id) => NODES[id]).map((id) => NODES[id].short ?? nodeName(id).replace(/^The /, '')), // as on the camp map
    heroes,
  };
}

/**
 * `names` may rename heroes, e.g. { F: 'Tamsin' }; blank or unusable names keep the default.
 * `classes` may swap a slot's class, e.g. { F: 'P' } for a Paladin instead of the Fighter.
 */
export function newCampaign(difficulty = 'normal', names = {}, classes = {}) {
  const party = {};
  for (const code of HERO_CODES) {
    const cls = classOf(code, { cls: classes[code] });
    const u = createUnit(cls, 0, 0);
    party[code] = { level: u.level, hp: u.hp, alive: true, slots: { ...u.slots }, potions: u.potions, items: [] };
    if (cls !== code) party[code].cls = cls;
    if (u.layOnHandsMax) party[code].layOnHands = u.layOnHandsMax;
    const name = cleanName(names[code]);
    if (name) party[code].name = name;
  }
  return { v: SAVE_VERSION, at: null, cleared: [], xp: 0, party, pack: [], relics: [], done: false, difficulty, tier: 0, gold: 0, stats: blankStats() };
}

/** The items each hero may carry into New Game+: what they have equipped, if a fresh hero of their class can use it. */
export function heirloomChoices(won) {
  const out = {};
  for (const code of HERO_CODES) {
    const rec = won.party[code];
    const fresh = newCampaign(won.difficulty, {}, { [code]: rec.cls });
    out[code] = (rec.items ?? []).filter((id) => ITEMS[id] && !equipProblem({ ...fresh, pack: [id] }, 0, code));
  }
  return out;
}

/**
 * A New Game+ run after `won`: level 1, the same names, classes and difficulty, one tier up,
 * and each hero carrying the item `keep[code]` names (if it is one they may keep).
 */
export function newGamePlus(won, keep = {}) {
  const names = {};
  const classes = {};
  for (const code of HERO_CODES) {
    if (won.party[code].name) names[code] = won.party[code].name;
    if (won.party[code].cls) classes[code] = won.party[code].cls;
  }
  // The bosses' relics come along too.
  let state = { ...newCampaign(won.difficulty, names, classes), tier: Math.min(MAX_TIER, (won.tier ?? 0) + 1), relics: cleanRelics(won.relics) };
  const allowed = heirloomChoices(won);
  for (const code of HERO_CODES) {
    const id = keep[code];
    if (!id || !allowed[code].includes(id)) continue;
    state = equip({ ...state, pack: [id] }, 0, code);
    state.party[code].hp = heroUnit(code, state.party[code]).maxHp;
  }
  return { ...state, pack: [] };
}

/** Rooms the party can enter next. */
export function choices(state) {
  if (state.done) return [];
  if (!state.at) return [START_NODE];
  const cleared = new Set(state.cleared);
  return NODES[state.at].next
    .map((e) => (typeof e === 'string' ? { to: e } : e))
    .filter((e) => !cleared.has(e.to))
    .filter((e) => !e.ifAll || e.ifAll.every((c) => cleared.has(c)))
    .filter((e) => !NODES[e.to].unlessAll?.every((c) => cleared.has(c)))
    .map((e) => e.to);
}

/** Every edge on the map, for drawing it. */
export function mapEdges() {
  const out = [];
  for (const [from, n] of Object.entries(NODES)) {
    for (const e of n.next) {
      const to = typeof e === 'string' ? e : e.to;
      if (!out.some((x) => (x.from === to && x.to === from))) out.push({ from, to });
    }
  }
  return out;
}

const clone = (s) => structuredClone(s);

/**
 * Apply a won fight: carry the party out, short rest (regain half the missing HP; the
 * fallen get back up), award XP and level up, and add found loot to the pack. Chests left
 * closed are searched now: items to the pack, potions to whoever carries fewest.
 * A boss leaves its relic (`report.relic`, the id, or null if the run already has it).
 * Returns { state, report: { xp, total, levelUps: [{ code, name, level, note }], loot, potions, longRest, relic } }.
 */
export function completeFight(prev, id, game) {
  const state = clone(prev);
  const carried = game.partyState();
  for (const code of HERO_CODES) {
    if (!carried[code]) continue;
    const rec = { ...state.party[code], ...carried[code] };
    const max = restedHero(code, rec).maxHp;
    // Half of the missing HP back; Nekhet's Embalming Jar makes it three-quarters.
    const share = state.relics?.includes('jar') ? 3 / 4 : 1 / 2;
    rec.hp = Math.min(max, rec.hp + Math.ceil((max - rec.hp) * share));
    rec.alive = true;
    state.party[code] = rec;
  }

  state.stats = validStats(state.stats);
  state.stats.won++;
  addStats(state.stats, game);

  const xp = game.xpEarned();
  state.xp += xp;
  const gold = goldFor(id);
  state.gold = (state.gold ?? 0) + gold;
  const target = levelForXp(state.xp);
  const levelUps = [];
  for (const code of HERO_CODES) {
    const rec = state.party[code];
    if (rec.level >= target) continue;
    const before = restedHero(code, rec);
    const after = restedHero(code, rec, target);
    rec.hp += after.maxHp - before.maxHp;
    if (after.layOnHandsMax) rec.layOnHands = (rec.layOnHands ?? 0) + after.layOnHandsMax - before.layOnHandsMax;
    // Newly gained slots arrive ready to use.
    for (const [l, n] of Object.entries(after.slotMax)) {
      rec.slots[l] = Math.max(0, (rec.slots[l] ?? 0) + n - (before.slotMax[l] ?? 0));
    }
    for (let l = rec.level + 1; l <= target; l++) {
      const cls = classOf(code, rec);
      levelUps.push({ code, name: heroName(code, rec), level: l, note: PROGRESSION[cls][l]?.note ?? '', asi: asiLevels(cls).includes(l) });
    }
    rec.level = target;
  }

  // Pact Magic: a warlock's slots come back with the short rest after every room.
  for (const code of HERO_CODES) {
    const rec = state.party[code];
    const u = restedHero(code, rec);
    if (u.pactMagic) rec.slots = { ...u.slotMax };
  }

  // With the room cleared, the party searches any chests it didn't get to.
  const loot = [...game.found];
  let potions = 0;
  for (const c of game.grid.chests.values()) {
    if (c.opened || c.mimic) continue; // a sleeping mimic is best left alone
    for (const item of c.loot) {
      if (item !== 'potion') loot.push(item);
      else {
        potions++;
        const code = HERO_CODES.reduce((a, b) => (state.party[b].potions < state.party[a].potions ? b : a));
        state.party[code].potions++;
      }
    }
  }
  state.pack.push(...loot);
  // A boss leaves its relic behind (once a run: New Game+ may bring it along already).
  state.relics = cleanRelics(state.relics);
  // A floor of the Endless Crypt (game/endless.js) isn't on the map: no relic, no act's end.
  const node = NODES[id] ?? { next: [id] };
  let relic = node.boss ? relicFrom(node.level) : null;
  if (relic && state.relics.includes(relic)) relic = null;
  if (relic) state.relics = cleanRelics([...state.relics, relic]);
  state.cleared.push(id);
  state.at = id;
  if (node.next.length === 0) state.done = true;
  // The end of an act: a long rest before the next one (casters would start it empty).
  const longRest = !!node.actBreak;
  // The altar's blessing lasts one won fight.
  const blessed = HERO_CODES.some((c) => state.party[c].items.includes('altarBlessing'));
  for (const code of HERO_CODES) state.party[code].items = state.party[code].items.filter((i) => i !== 'altarBlessing');
  // The pilgrim the party tended catches up at the end of the act with a potion for each hero.
  const pilgrim = longRest && state.pilgrim === 'owed';
  if (pilgrim) {
    for (const code of HERO_CODES) state.party[code].potions++;
    state.pilgrim = 'repaid';
  }
  // Morvath's Phylactery saves one hero between long rests: spent when it works.
  if (game.phylacteryUsed) state.phylacterySpent = true;
  const spent = !!state.phylacterySpent;
  if (longRest) restParty(state);
  const phylactery = !spent ? null : longRest ? 'ready' : game.phylacteryUsed ? 'spent' : null;
  return { state, report: { xp, gold, total: state.xp, levelUps, loot, potions, longRest, relic, phylactery, blessed, pilgrim } };
}

/** The relics the next fight starts with: the run's, less a Phylactery spent this act. */
export function fightRelics(state) {
  return cleanRelics(state.relics).filter((id) => id !== 'phylactery' || !state.phylacterySpent);
}

/** Everyone back to full HP and spell slots, and a spent Phylactery wakes. */
export function restParty(state) {
  delete state.phylacterySpent;
  for (const code of HERO_CODES) {
    const rec = state.party[code];
    const u = restedHero(code, rec);
    Object.assign(rec, { hp: u.maxHp, alive: true, slots: { ...u.slotMax } });
    if (u.layOnHandsMax) rec.layOnHands = u.layOnHandsMax;
  }
}

/** A rest room: long rest, everyone back to full HP and spell slots. */
export function takeRest(prev, id) {
  const state = clone(prev);
  restParty(state);
  state.cleared.push(id);
  state.at = id;
  return state;
}

/** Why `code` can't take item number `i` from the pack, or null. */
export function equipProblem(state, i, code) {
  const id = state.pack[i];
  if (!id || ITEMS[id]?.kind !== 'gear') return 'Nothing to equip';
  if (state.party[code].items.includes(id)) return 'Already has one';
  if (id.startsWith('weaponPlus') && state.party[code].items.some((i) => i.startsWith('weaponPlus'))) {
    return 'Already has a runed weapon';
  }
  return ITEMS[id].only?.(heroUnit(code, state.party[code])) ?? null;
}

const signed = (n) => (n < 0 ? `${n}` : `+${n}`);

/**
 * What pack item `i` would change on hero `code`, as short lines for the camp:
 * "AC 12 → 14", "Max HP 20 → 29", "Mace: hit +5 → +7, damage +3 → +5", "+1 to saves",
 * "Can’t be poisoned". An empty list means it would do nothing for them.
 */
export function equipPreview(state, i, code) {
  const id = state.pack[i];
  const rec = state.party[code];
  const before = heroUnit(code, rec);
  const after = heroUnit(code, { ...rec, items: [...rec.items, id] });
  const lines = [];
  const ac = (u) => u.ac + u.acBonus;
  if (ac(after) !== ac(before)) lines.push(`AC ${ac(before)} → ${ac(after)}`);
  if (after.maxHp !== before.maxHp) lines.push(`Max HP ${before.maxHp} → ${after.maxHp}`);
  const weapon = (u, a) => {
    const hit = abilityMod(u.stats[a.stat]) + u.weaponBonus;
    return { hit: hit + u.prof, dmg: hit + (a.stat === 'str' ? u.strDamage ?? 0 : 0) };
  };
  for (const a of before.attacks.filter((at) => at.stat === 'str' || at.stat === 'dex')) {
    const b = weapon(before, a);
    const n = weapon(after, a);
    if (b.hit === n.hit && b.dmg === n.dmg) continue;
    lines.push(`${a.name}: hit ${signed(b.hit)} → ${signed(n.hit)}, damage ${signed(b.dmg)} → ${signed(n.dmg)}`);
    break; // the hero's main weapon is enough
  }
  if (after.saveBonus !== before.saveBonus) lines.push(`${signed(after.saveBonus - before.saveBonus)} to saves`);
  if ((after.immune ?? []).includes('poisoned') && !(before.immune ?? []).includes('poisoned')) lines.push('Can’t be poisoned');
  if (after.healTwice && !before.healTwice) lines.push('Heals twice as much');
  return lines;
}

/** Gear that changes a hero's maximum HP moves their current HP with it (never below 1). */
function keepWounds(prev, state, code) {
  const before = heroUnit(code, prev.party[code]).maxHp;
  const after = heroUnit(code, state.party[code]).maxHp;
  const rec = state.party[code];
  if (after !== before && typeof rec.hp === 'number') rec.hp = Math.max(1, Math.min(after, rec.hp + after - before));
}

export function equip(prev, i, code) {
  if (equipProblem(prev, i, code)) return prev;
  const state = clone(prev);
  const [id] = state.pack.splice(i, 1);
  state.party[code].items.push(id);
  keepWounds(prev, state, code);
  return state;
}

export function unequip(prev, code, i) {
  const state = clone(prev);
  const [id] = state.party[code].items.splice(i, 1);
  if (id) state.pack.push(id);
  keepWounds(prev, state, code);
  return state;
}

/** Keep a party record's ability picks only where they're real: an increase level of its class, an ability. */
export function cleanPicks(code, r) {
  const levels = asiLevels(classOf(code, r));
  const ok = Object.entries(r.picks && typeof r.picks === 'object' ? r.picks : {})
    .filter(([l, stat]) => levels.includes(Number(l)) && cleanPick(stat));
  if (ok.length) r.picks = Object.fromEntries(ok);
  else delete r.picks;
  return r;
}

/**
 * Ability Score Improvements (levels 4 and 8, the Fighter's 6 too): the levels where hero
 * `code` hasn't picked yet, lowest first. An open level takes the class's own pick, and the
 * next fight settles it (settlePicks).
 */
export function openPicks(state, code) {
  const rec = state.party[code];
  return asiLevels(classOf(code, rec)).filter((l) => l <= rec.level && !cleanPick(rec.picks?.[l]));
}

/** The abilities worth raising at `level`, the class's own first: { stat, value, own, lines }. */
export function pickOptions(state, code, level) {
  const rec = state.party[code];
  const cls = classOf(code, rec);
  // The hero just before that level's increase (with the picks made below it).
  const below = heroUnit(code, { cls: rec.cls, level: level - 1, items: [], picks: rec.picks });
  const own = asiDefault(cls, level);
  const useful = [own, ...below.attacks.filter((a) => a.addMod !== false).map((a) => a.stat), below.castStat, 'con', 'dex', 'wis'];
  const as = (stat) => heroUnit(code, { ...rec, picks: { ...rec.picks, [level]: stat } });
  const plain = as(own === 'str' ? 'int' : 'str'); // the same hero with the increase where it changes nothing worked out
  return [...new Set(useful)].filter((stat) => stat && below.stats[stat] < 20).map((stat) => {
    const u = as(stat);
    const lines = [];
    if (u.maxHp > plain.maxHp) lines.push(`+${u.maxHp - plain.maxHp} max HP`);
    if (u.ac > plain.ac) lines.push(`+${u.ac - plain.ac} AC`);
    if (below.attacks.some((a) => a.stat === stat && a.addMod !== false)) lines.push('+1 to hit and damage');
    else if (below.attacks.some((a) => a.stat === stat)) lines.push('+1 to hit');
    if (below.castStat === stat) lines.push('+1 spell save DC');
    if (stat === 'dex') lines.push('+1 initiative');
    if ((u.inspiration ?? 0) > (plain.inspiration ?? 0)) lines.push('+1 Bardic Inspiration');
    if (!lines.length) lines.push(`+1 to ${ABILITY_NAMES[stat]} saves`);
    return { stat, value: u.stats[stat], own: stat === own, lines };
  });
}

/** Hero `code` raises `stat` at open level `level` (its HP moves with its maximum). */
export function choosePick(prev, code, level, stat) {
  if (!openPicks(prev, code).includes(level) || !pickOptions(prev, code, level).some((o) => o.stat === stat)) return prev;
  const state = clone(prev);
  const rec = state.party[code];
  rec.picks = { ...rec.picks, [level]: stat };
  keepWounds(prev, state, code);
  return state;
}

/** Every open increase takes the class's own pick (done as a fight starts). */
export function settlePicks(prev) {
  if (!HERO_CODES.some((code) => openPicks(prev, code).length)) return prev;
  const state = clone(prev);
  for (const code of HERO_CODES) {
    const rec = state.party[code];
    for (const l of openPicks(prev, code)) rec.picks = { ...rec.picks, [l]: asiDefault(classOf(code, rec), l) };
  }
  return state;
}

export const serialize = (state) => JSON.stringify(state);

/**
 * A fight saved mid-battle (see replay.js): { node, seed, log, check, explored, seen }.
 * Only its shape is checked here; a log that no longer replays is caught on loading.
 */
function validFight(f) {
  return !!f && typeof f === 'object'
    && !!NODES[f.node]?.level
    && Number.isInteger(f.seed)
    && (f.rules === undefined || (Number.isInteger(f.rules) && f.rules >= 2 && f.rules <= RULES))
    && Array.isArray(f.log) && f.log.every((c) => c && typeof c.type === 'string')
    && (f.check === null || typeof f.check === 'string')
    && Array.isArray(f.explored) && f.explored.every((k) => typeof k === 'string')
    && Array.isArray(f.seen) && f.seen.every(Number.isInteger)
    && (f.relics === undefined || (Array.isArray(f.relics) && cleanRelics(f.relics).length === f.relics.length));
}

/** A won run kept for New Game+ (see main.js), or null if it isn't a finished run. */
export function parseWonRun(text) {
  const s = typeof text === 'string' ? parseSave(text) : null;
  return s?.done ? s : null;
}

/** Parse save data. Returns null for anything missing, corrupt or from another version. */
export function parseSave(text) {
  try {
    const s = JSON.parse(text);
    if (!s || s.v !== SAVE_VERSION) return null;
    if (s.at !== null && !NODES[s.at]) return null;
    if (!Array.isArray(s.cleared) || !s.cleared.every((c) => NODES[c])) return null;
    if (!Array.isArray(s.pack) || !s.pack.every((i) => ITEMS[i])) return null;
    if (typeof s.xp !== 'number') return null;
    if (!DIFFICULTIES[s.difficulty]) s.difficulty = 'normal'; // saves from before difficulties
    if (!Number.isInteger(s.tier) || s.tier < 0) s.tier = 0; // saves from before New Game+
    s.tier = Math.min(s.tier, MAX_TIER);
    s.stats = validStats(s.stats); // saves from before the run tally start a fresh one
    // Saves from before relics get those of the bosses they've beaten.
    s.relics = cleanRelics(s.relics ?? s.cleared.map((c) => (NODES[c].boss ? relicFrom(NODES[c].level) : null)));
    if (s.phylacterySpent !== true) delete s.phylacterySpent; // kept only while spent
    if (!['owed', 'repaid', 'robbed'].includes(s.pilgrim)) delete s.pilgrim;
    // Losses per room (easeOffer): whole numbers for real rooms only.
    if (s.fails && typeof s.fails === 'object') s.fails = Object.fromEntries(Object.entries(s.fails).filter(([id, n]) => NODES[id] && Number.isInteger(n) && n > 0));
    else delete s.fails;
    for (const code of HERO_CODES) {
      const r = s.party?.[code];
      if (!r || typeof r.hp !== 'number' || typeof r.level !== 'number' || !Array.isArray(r.items)) return null;
      if (!r.items.every((i) => ITEMS[i]) || typeof r.slots !== 'object') return null;
      if (r.name !== undefined && (typeof r.name !== 'string' || !r.name || cleanName(r.name) !== r.name)) delete r.name;
      if (r.cls !== undefined && (r.cls === code || !CLASS_CHOICES[code].includes(r.cls))) delete r.cls;
      cleanPicks(code, r);
      const rested = restedHero(code, r);
      // A save from before a class lost hit points (the Ranger's 28 → 24) keeps no extra HP.
      r.hp = Math.min(r.hp, rested.maxHp);
      const max = rested.layOnHandsMax;
      if (max) r.layOnHands = Number.isFinite(r.layOnHands) ? Math.max(0, Math.min(max, r.layOnHands)) : max;
      else delete r.layOnHands;
      for (const f of ['flasks', 'caltrops']) if (r[f] !== undefined && !(Number.isInteger(r[f]) && r[f] > 0 && r[f] < 100)) delete r[f];
    }
    if (s.fight !== undefined && !validFight(s.fight)) delete s.fight;
    // A run finished before act two existed ended at the Sanctum: open the way on, after
    // the long rest the act break gives.
    if (s.done && NODES[s.at]?.next.length) {
      s.done = false;
      restParty(s);
    }
    return cleanGold(s); // saves from before gold start with none
  } catch {
    return null;
  }
}

/** A won campaign as text to paste anywhere: difficulty, rooms, rounds, the party and its falls. */
export function runShareText(s) {
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const falls = s.heroes.reduce((n, h) => n + (h.downed ?? 0), 0);
  const classes = s.heroes.map((h) => h.cls);
  return [
    `Crypt Skirmish: the crypt cleared on ${s.difficulty}`,
    `${plural(s.won, 'room')} won, ${s.lost ? plural(s.lost, 'fight') + ' lost' : 'no fight lost'}, ${plural(s.rounds, 'round')}`
      + (s.eliteCount ? `, ${plural(s.eliteCount, 'elite')} slain` : ''),
    `${classes.slice(0, -1).join(', ')} and ${classes.at(-1)}, level ${s.level}`,
    falls === 0 ? 'No hero ever fell 🛡️' : `Heroes fell ${plural(falls, 'time')} 💀`,
    'https://fatihsenel.github.io/crypt-skirmish/',
  ].join('\n');
}
