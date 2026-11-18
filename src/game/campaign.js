// Campaign: the dungeon map that links the levels, party XP and levelling, the
// party's pack of loot, and save data. Pure state, no DOM and no storage. Every
// function returns a new state; the controller decides when to persist it.

import { TEMPLATES, PROGRESSION, MAX_LEVEL, createUnit, applyLevel } from './units.js';
import { ITEMS, applyItems } from './items.js';
import { levelById } from './maps.js';

export const SAVE_VERSION = 1;
export const HERO_CODES = ['F', 'W', 'R', 'C'];

/** Party XP (shared) needed for each level. Heroes start at level 3. */
export const XP_LEVELS = { 4: 450, 5: 900, 6: 2000 };

/**
 * Chosen for the whole run. Monsters' HP is scaled and their weapon attacks get a bonus
 * (or penalty) to hit and damage; the heroes are untouched.
 */
export const DIFFICULTIES = {
  story: { name: 'Story', hp: 0.75, bonus: -1, desc: 'Weaker monsters: for enjoying the tale.' },
  normal: { name: 'Normal', hp: 1, bonus: 0, desc: 'The crypt as intended.' },
  hard: { name: 'Hard', hp: 1.2, bonus: 1, desc: 'Tougher monsters that hit harder. Every choice counts.' },
};

/**
 * The dungeon map. Columns go deeper; `next` lists where you can go from here. An entry
 * may be { to, ifAll: [...] }: only offered once all those rooms are cleared.
 * `unlessAll` on a node hides it once all those rooms are cleared.
 * The fork: take one middle room and rest at the chapel, or clear both middle rooms
 * (more XP and loot) and face the necromancer without that rest.
 * `boss` draws a crown on the map; `actBreak` gives a long rest after the fight.
 * Act two (after the sanctum) asks the same question once more: the vault or the well.
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
    kind: 'fight', level: 'barrow', short: 'Barrow', col: 7, row: 1, next: [], boss: true,
    teaser: 'Varek the wight. The end of the road.',
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

/** A hero unit as described by a party record (for the camp screen and rest maths). */
export function heroUnit(code, rec) {
  const u = createUnit(code, 0, 0);
  applyLevel(u, rec.level);
  applyItems(u, rec.items);
  for (const f of ['hp', 'alive', 'slots', 'potions']) if (rec[f] !== undefined) u[f] = structuredClone(rec[f]);
  if (rec.name) u.name = rec.name;
  return u;
}

/** `names` may rename heroes, e.g. { F: 'Tamsin' }; blank or unusable names keep the default. */
export function newCampaign(difficulty = 'normal', names = {}) {
  const party = {};
  for (const code of HERO_CODES) {
    const u = createUnit(code, 0, 0);
    party[code] = { level: u.level, hp: u.hp, alive: true, slots: { ...u.slots }, potions: u.potions, items: [] };
    const name = cleanName(names[code]);
    if (name) party[code].name = name;
  }
  return { v: SAVE_VERSION, at: null, cleared: [], xp: 0, party, pack: [], done: false, difficulty };
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
    const max = heroUnit(code, { level: rec.level }).maxHp;
    rec.hp = Math.min(max, rec.hp + Math.ceil((max - rec.hp) / 2));
    rec.alive = true;
    state.party[code] = rec;
  }

  const xp = game.xpEarned();
  state.xp += xp;
  const target = levelForXp(state.xp);
  const levelUps = [];
  for (const code of HERO_CODES) {
    const rec = state.party[code];
    if (rec.level >= target) continue;
    const before = heroUnit(code, { level: rec.level });
    const after = heroUnit(code, { level: target });
    rec.hp += after.maxHp - before.maxHp;
    // Newly gained slots arrive ready to use.
    for (const [l, n] of Object.entries(after.slotMax)) {
      rec.slots[l] = (rec.slots[l] ?? 0) + n - (before.slotMax[l] ?? 0);
    }
    for (let l = rec.level + 1; l <= target; l++) {
      levelUps.push({ code, name: rec.name ?? TEMPLATES[code].name, level: l, note: PROGRESSION[code][l]?.note ?? '' });
    }
    rec.level = target;
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
    const u = heroUnit(code, { level: rec.level });
    Object.assign(rec, { hp: u.maxHp, alive: true, slots: { ...u.slotMax } });
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
  if (state.party[code].items.includes(id)) return `${state.party[code].name ?? TEMPLATES[code].name} already has one`;
  return null;
}

export function equip(prev, i, code) {
  if (equipProblem(prev, i, code)) return prev;
  const state = clone(prev);
  const [id] = state.pack.splice(i, 1);
  state.party[code].items.push(id);
  return state;
}

export function unequip(prev, code, i) {
  const state = clone(prev);
  const [id] = state.party[code].items.splice(i, 1);
  if (id) state.pack.push(id);
  return state;
}

export const serialize = (state) => JSON.stringify(state);

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
    for (const code of HERO_CODES) {
      const r = s.party?.[code];
      if (!r || typeof r.hp !== 'number' || typeof r.level !== 'number' || !Array.isArray(r.items)) return null;
      if (!r.items.every((i) => ITEMS[i]) || typeof r.slots !== 'object') return null;
      if (r.name !== undefined && (typeof r.name !== 'string' || !r.name || cleanName(r.name) !== r.name)) delete r.name;
    }
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
