// Campaign: the dungeon map that links the levels, party XP and levelling, the
// party's pack of loot, and save data. Pure state, no DOM and no storage. Every
// function returns a new state; the controller decides when to persist it.

import { TEMPLATES, PROGRESSION, MAX_LEVEL, CLASS_CHOICES, createUnit, applyLevel, classOf } from './units.js';
import { ITEMS, applyItems } from './items.js';
import { abilityMod } from './dice.js';
import { levelById } from './maps.js';
import { ELITE_TRAITS, eliteTrait } from './combat.js';

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
 * Act two (after the sanctum) asks the same question once more: the vault or the well.
 * Act three (after the barrow) asks it again: the gallery's loot or the shrine's rest.
 * Act four (after the throne) asks it a last time: the armory's loot or the hearth's rest.
 */
export const NODES = {
  crypt: { kind: 'fight', level: 'crypt', col: 0, row: 1, next: ['warren', 'ossuary'] },
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
    kind: 'fight', level: 'catacombs', col: 4, row: 1, next: ['vault', 'well'],
    teaser: 'Ghouls: their claws poison. Skeletons besides.',
  },
  vault: {
    kind: 'fight', level: 'vault', short: 'Vault', col: 5, row: 0, next: ['barrow', 'larder'],
    teaser: 'Guarded treasure: a magic cloak and weapon. Skip the rest at the well.',
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
    kind: 'fight', level: 'nest', short: 'Nest', col: 8, row: 1, next: ['gallery', 'shrine'],
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
  throne: {
    kind: 'fight', level: 'throne', short: 'Throne', col: 10, row: 1, next: ['halls'], boss: true,
    actBreak: true,
    teaser: 'Ysolde the banshee, the end of the third act. Afterwards the party takes a long rest.',
  },
  // Act four: the halls, then the armory's loot or the hearth's rest, then the mummy lord.
  halls: {
    kind: 'fight', level: 'halls', short: 'Halls', col: 11, row: 1, next: ['armory', 'hearth'],
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
  tomb: {
    kind: 'fight', level: 'tomb', short: 'Tomb', col: 13, row: 1, next: [], boss: true,
    teaser: 'Nekhet the Mummy Lord. The end of the road.',
  },
};

export const START_NODE = 'crypt';

/**
 * A hero name as typed on the title screen, made safe: letters, digits, spaces, apostrophes
 * and hyphens only (so it can go straight into the log's HTML), at most 14 characters.
 */
export function cleanName(text) {
  return String(text ?? '').replace(/[^\p{L}\p{N} '’-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 14).trim();
}

export const nodeName = (id) => NODES[id].name ?? levelById(NODES[id].level).name;

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
  applyLevel(u, rec.level);
  applyItems(u, rec.items);
  for (const f of ['hp', 'alive', 'slots', 'potions', 'layOnHands']) if (rec[f] !== undefined) u[f] = structuredClone(rec[f]);
  u.hp = Math.min(u.hp, u.maxHp);
  if (rec.name) u.name = rec.name;
  return u;
}

/** The fresh-from-a-long-rest version of a slot's hero at `level`, with their items (an Amulet of Health adds HP). */
const restedHero = (code, rec, level = rec.level) => heroUnit(code, { cls: rec.cls, level, items: rec.items ?? [] });

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
export function recordDefeat(prev, game) {
  const state = clone(prev);
  state.stats = validStats(state.stats);
  state.stats.lost++;
  state.stats.rounds += game.round;
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
  return { v: SAVE_VERSION, at: null, cleared: [], xp: 0, party, pack: [], done: false, difficulty, tier: 0, stats: blankStats() };
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
  let state = { ...newCampaign(won.difficulty, names, classes), tier: Math.min(MAX_TIER, (won.tier ?? 0) + 1) };
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
 * Returns { state, report: { xp, total, levelUps: [{ code, name, level, note }], loot, potions } }.
 */
export function completeFight(prev, id, game) {
  const state = clone(prev);
  const carried = game.partyState();
  for (const code of HERO_CODES) {
    if (!carried[code]) continue;
    const rec = { ...state.party[code], ...carried[code] };
    const max = restedHero(code, rec).maxHp;
    rec.hp = Math.min(max, rec.hp + Math.ceil((max - rec.hp) / 2));
    rec.alive = true;
    state.party[code] = rec;
  }

  state.stats = validStats(state.stats);
  state.stats.won++;
  addStats(state.stats, game);

  const xp = game.xpEarned();
  state.xp += xp;
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
      levelUps.push({ code, name: heroName(code, rec), level: l, note: PROGRESSION[classOf(code, rec)][l]?.note ?? '' });
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
  state.cleared.push(id);
  state.at = id;
  if (NODES[id].next.length === 0) state.done = true;
  // The end of an act: a long rest before the next one (casters would start it empty).
  const longRest = !!NODES[id].actBreak;
  if (longRest) restParty(state);
  return { state, report: { xp, total: state.xp, levelUps, loot, potions, longRest } };
}

/** Everyone back to full HP and spell slots. */
function restParty(state) {
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

export const serialize = (state) => JSON.stringify(state);

/**
 * A fight saved mid-battle (see replay.js): { node, seed, log, check, explored, seen }.
 * Only its shape is checked here; a log that no longer replays is caught on loading.
 */
function validFight(f) {
  return !!f && typeof f === 'object'
    && !!NODES[f.node]?.level
    && Number.isInteger(f.seed)
    && Array.isArray(f.log) && f.log.every((c) => c && typeof c.type === 'string')
    && (f.check === null || typeof f.check === 'string')
    && Array.isArray(f.explored) && f.explored.every((k) => typeof k === 'string')
    && Array.isArray(f.seen) && f.seen.every(Number.isInteger);
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
    for (const code of HERO_CODES) {
      const r = s.party?.[code];
      if (!r || typeof r.hp !== 'number' || typeof r.level !== 'number' || !Array.isArray(r.items)) return null;
      if (!r.items.every((i) => ITEMS[i]) || typeof r.slots !== 'object') return null;
      if (r.name !== undefined && (typeof r.name !== 'string' || !r.name || cleanName(r.name) !== r.name)) delete r.name;
      if (r.cls !== undefined && (r.cls === code || !CLASS_CHOICES[code].includes(r.cls))) delete r.cls;
      const rested = restedHero(code, r);
      // A save from before a class lost hit points (the Ranger's 28 → 24) keeps no extra HP.
      r.hp = Math.min(r.hp, rested.maxHp);
      const max = rested.layOnHandsMax;
      if (max) r.layOnHands = Number.isFinite(r.layOnHands) ? Math.max(0, Math.min(max, r.layOnHands)) : max;
      else delete r.layOnHands;
    }
    if (s.fight !== undefined && !validFight(s.fight)) delete s.fight;
    // A run finished before act two existed ended at the Sanctum: open the way on, after
    // the long rest the act break gives.
    if (s.done && NODES[s.at]?.next.length) {
      s.done = false;
      restParty(s);
    }
    return s;
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
