// The Endless Crypt: after the campaign is won, the same heroes go down floor after floor of
// rooms made from a seed, with more and stronger monsters each floor, until the party falls.
// A floor's room is its id, `deep:<seed>:<floor>`, so a fight record (and its replay) rebuilds
// the same room from the id alone. Pure, like the rest of src/game: the map comes from `seeded`.

import { seeded, hash } from './dice.js';
import { NODES, HERO_CODES, restParty, levelForXp, cleanPicks } from './campaign.js';
import { levelById } from './maps.js';

export const ENDLESS_KEY = 'crypt-skirmish:endless';
export const ENDLESS_BEST_KEY = 'crypt-skirmish:endless-best';

const W = 16;
const H = 12;
/** The 3 × 2 chambers a floor is cut into (inclusive tile ranges), walls between them. */
const COLS = [[1, 4], [6, 9], [11, 14]];
const ROWS = [[1, 4], [6, 10]];

/** Monsters by how deep they first appear: [code, xp, first floor]. */
const POOL = [
  ['r', 25, 1], ['g', 50, 1], ['s', 50, 1], ['o', 100, 1], ['k', 200, 2], ['u', 200, 2],
  ['e', 200, 3], ['h', 450, 4], ['y', 700, 5], ['x', 700, 6], ['t', 1800, 10],
];
/** A named foe waits on every fifth floor, in turn. */
const BOSSES = ['b', 'n', 'w', 'q', 'l'];
const BOSS_XP = { b: 200, n: 450, w: 700, q: 1100, l: 3000 };

const INTROS = [
  'The stairs wind down past the tomb into rooms no map shows.',
  'Older stone here, cut by hands that weren’t human.',
  'Water drips somewhere below. Something else is moving with it.',
  'The air is colder on this floor, and the dark is patient.',
  'Old bones crunch underfoot. Not all of them stay still.',
];

/** Floor `floor` of the run with seed `seed` as a room id, and back. */
export const floorId = (seed, floor) => `deep:${seed >>> 0}:${floor}`;
export function parseFloorId(id) {
  const m = /^deep:(\d+):(\d+)$/.exec(String(id));
  return m && Number(m[2]) >= 1 ? { seed: Number(m[1]), floor: Number(m[2]) } : null;
}

/** The New Game+ tier a floor is fought at: monsters get tougher every 3 floors, elites from the 7th. */
export const floorTier = (floor) => Math.floor((floor - 1) / 3);

/** The monsters' XP budget for a floor: about an act-four room on the first, growing from there. */
export const floorBudget = (floor) => 1900 + 300 * floor;

/**
 * The room for floor `floor` of seed `seed`: { id, name, intro, rows, loot, asleep }.
 * Six chambers joined by doors and gaps in the walls (every chamber reachable), the heroes in
 * the top-left one, the stairs in the one farthest from it, monsters, chests, traps, props
 * and now and then water. Deeper floors bring more, and stronger, monsters.
 */
export function makeFloor(seed, floor) {
  const rng = seeded(hash(`endless ${seed} ${floor}`));
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const grid = Array.from({ length: H }, () => Array(W).fill('#'));
  const cells = [];
  for (let r = 0; r < ROWS.length; r++) {
    for (let c = 0; c < COLS.length; c++) {
      cells.push({ c, r, x0: COLS[c][0], x1: COLS[c][1], z0: ROWS[r][0], z1: ROWS[r][1] });
    }
  }
  for (const cell of cells) for (let z = cell.z0; z <= cell.z1; z++) for (let x = cell.x0; x <= cell.x1; x++) grid[z][x] = '.';

  // Join the chambers: a random spanning tree (so all are reachable), then an extra link or two.
  const idx = (c, r) => r * COLS.length + c;
  const links = [];
  for (const a of cells) {
    if (a.c + 1 < COLS.length) links.push([a, cells[idx(a.c + 1, a.r)]]);
    if (a.r + 1 < ROWS.length) links.push([a, cells[idx(a.c, a.r + 1)]]);
  }
  const shuffled = links.map((l) => [rng(), l]).sort((p, q) => p[0] - q[0]).map(([, l]) => l);
  const group = cells.map((_, i) => i);
  const find = (i) => (group[i] === i ? i : (group[i] = find(group[i])));
  const used = [];
  for (const [a, b] of shuffled) {
    const ga = find(idx(a.c, a.r));
    const gb = find(idx(b.c, b.r));
    if (ga !== gb || rng() < 0.2) {
      group[ga] = gb;
      used.push([a, b]);
    }
  }
  const openings = [];
  for (const [a, b] of used) {
    const wide = rng() < 0.25; // now and then the wall between two chambers is mostly gone
    if (a.r === b.r) { // side by side: an opening in the wall column between them
      const x = a.x1 + 1;
      const z = a.z0 + 1 + Math.floor(rng() * (Math.min(a.z1, b.z1) - a.z0 - 1));
      for (const zz of wide ? [z - 1, z, z + 1].filter((v) => v >= a.z0 && v <= Math.min(a.z1, b.z1)) : [z]) {
        grid[zz][x] = !wide && rng() < 0.6 ? '+' : '.';
        openings.push([x, zz]);
      }
    } else { // one above the other: an opening in the wall row between them
      const z = a.z1 + 1;
      const x = a.x0 + 1 + Math.floor(rng() * (a.x1 - a.x0 - 1));
      for (const xx of wide ? [x - 1, x, x + 1] : [x]) {
        grid[z][xx] = !wide && rng() < 0.6 ? '+' : '.';
        openings.push([xx, z]);
      }
    }
  }

  // The heroes start in the top-left chamber; the stairs are in the chamber farthest from it.
  const start = cells[0];
  const heroAt = [[start.x0, start.z0], [start.x0 + 2, start.z0], [start.x0, start.z0 + 2], [start.x0 + 2, start.z0 + 2]];
  HERO_CODES.forEach((code, i) => { grid[heroAt[i][1]][heroAt[i][0]] = code; });
  const far = steps(grid, heroAt[0]);
  const end = cells.slice(1).reduce((a, b) => (cellDistance(far, b) > cellDistance(far, a) ? b : a));

  const nearOpening = (x, z) => openings.some(([ox, oz]) => Math.abs(ox - x) + Math.abs(oz - z) <= 1);
  const freeTiles = (cell) => {
    const out = [];
    for (let z = cell.z0; z <= cell.z1; z++) for (let x = cell.x0; x <= cell.x1; x++) if (grid[z][x] === '.' && !nearOpening(x, z)) out.push([x, z]);
    return out;
  };
  const place = (cell, ch) => {
    const spots = freeTiles(cell);
    if (!spots.length) return null;
    const [x, z] = pick(spots);
    grid[z][x] = ch;
    return [x, z];
  };
  place(end, '>');

  // Props and water, each kept only if every floor tile can still be walked to.
  for (const cell of cells.slice(1)) {
    const roll = rng();
    const ch = roll < 0.25 ? '|' : roll < 0.45 ? '&' : roll < 0.6 ? '=' : roll < 0.68 ? '*' : null;
    for (let n = ch ? 1 + Math.floor(rng() * 2) : 0; n > 0; n--) {
      const at = place(cell, ch);
      if (at && !allReachable(grid, heroAt[0])) grid[at[1]][at[0]] = '.';
    }
    if (rng() < 0.15) {
      for (const [x, z] of freeTiles(cell).filter(() => rng() < 0.45)) grid[z][x] = '~';
    }
  }

  // Monsters, from the pool this deep, until the floor's budget is spent (a boss every fifth floor).
  const rooms = cells.slice(1);
  let budget = floorBudget(floor);
  if (floor % 5 === 0) {
    const boss = BOSSES[(floor / 5 - 1) % BOSSES.length];
    place(end, boss);
    budget -= BOSS_XP[boss];
  }
  const pool = POOL.filter(([, , first]) => first <= floor);
  let count = grid.flat().filter((ch) => /[a-z]/.test(ch)).length;
  const asleep = [];
  while (budget > 0 && count < 10) {
    const affordable = pool.filter(([, xp]) => xp <= Math.max(budget, 50));
    if (!affordable.length) break;
    // Deeper floors lean to the stronger end of what they can afford.
    const lean = Math.min(0.8, floor * 0.06);
    const [code, xp] = rng() < lean ? affordable.at(-1 - Math.floor(rng() * Math.min(3, affordable.length))) : pick(affordable);
    const at = place(pick(rooms), code);
    if (!at) break;
    if (rng() < 0.2) asleep.push(`${at[0]},${at[1]}`);
    budget -= xp;
    count++;
  }

  // Chests (potions, and gear now and then) and a few hidden traps away from the start.
  const loot = [];
  for (let n = 1 + (rng() < 0.5 ? 1 : 0); n > 0; n--) {
    if (!place(pick(rooms), '$')) continue;
    const gear = rng() < 0.15 + floor * 0.01 ? [pick(['weaponPlus1', 'ringProtection', 'cloakProtection', 'periaptPoison', 'gauntletsOgre', 'amuletHealth'])] : [];
    loot.push(['potion', ...gear]);
  }
  for (let n = Math.floor(rng() * 3); n > 0; n--) place(pick(rooms), '^');

  return {
    id: floorId(seed, floor),
    name: `The Deep, floor ${floor}`,
    intro: floor % 5 === 0 ? 'Something with a name waits on this floor. It has been expecting you.' : pick(INTROS),
    rows: grid.map((row) => row.join('')),
    loot,
    asleep,
  };
}

/** Steps from `from` to every tile a hero could walk (walls, props and closed doors aside, doors open). */
function steps(grid, [fx, fz]) {
  const dist = new Map([[`${fx},${fz}`, 0]]);
  const todo = [[fx, fz]];
  while (todo.length) {
    const [x, z] = todo.shift();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      const k = `${nx},${nz}`;
      if (dist.has(k) || nx < 0 || nz < 0 || nx >= W || nz >= H || '#|&=*'.includes(grid[nz][nx])) continue;
      dist.set(k, dist.get(`${x},${z}`) + 1);
      todo.push([nx, nz]);
    }
  }
  return dist;
}

const cellDistance = (dist, cell) => dist.get(`${cell.x0},${cell.z0}`) ?? 0;

/** Can every open tile be walked to from `from`? */
export function allReachable(grid, from) {
  const rows = grid.map((r) => (Array.isArray(r) ? r : [...r]));
  const dist = steps(rows, from);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (!'#|&=*'.includes(rows[z][x]) && !dist.has(`${x},${z}`)) return false;
  return true;
}

/** A room by id: a campaign room, or a floor of the Endless Crypt. */
export function levelOf(id) {
  const f = parseFloorId(id);
  return f ? makeFloor(f.seed, f.floor) : levelById(NODES[id]?.level);
}

/** Is this room id a floor of the Endless Crypt? */
export const isFloor = (id) => !!parseFloorId(id);

/** Gold for clearing a floor. */
export const floorGold = (floor) => 40 + 15 * floor;

/**
 * A new Endless Crypt run with the heroes of the won campaign `won`: their levels, names,
 * classes, gear, relics and gold, rested, on floor 1. `seed` makes its rooms.
 */
export function newEndless(won, seed) {
  const state = structuredClone(won);
  Object.assign(state, { at: null, cleared: [], done: false, tier: 0, endless: { seed: seed >>> 0, floor: 1 } });
  delete state.fight;
  delete state.fails;
  delete state.traded;
  delete state.pilgrim;
  state.gold ??= 0;
  state.party = Object.fromEntries(HERO_CODES.map((c) => [c, { ...state.party[c], items: (state.party[c].items ?? []).filter((i) => i !== 'altarBlessing') }]));
  restParty(state);
  return state;
}

/** The room the run fights next. */
export const nextFloor = (state) => floorId(state.endless.seed, state.endless.floor);

/** Every third floor ends in a long rest, and the pedlar is there. */
export const restFloor = (floor) => floor % 3 === 0;

/**
 * After a won floor (`done`, from completeFight on the floor's id): gold, the next floor, and a
 * long rest every third. Returns { state, report additions }.
 */
export function afterFloor(done) {
  const state = structuredClone(done);
  const floor = state.endless.floor;
  const gold = floorGold(floor);
  state.gold = (state.gold ?? 0) + gold;
  const longRest = restFloor(floor);
  if (longRest) restParty(state);
  state.endless = { ...state.endless, floor: floor + 1, rested: longRest };
  state.tier = floorTier(floor + 1);
  state.done = false;
  return { state, floor, gold, longRest, level: levelForXp(state.xp) };
}

/** A stored endless run, made safe (anything unreadable: none). */
export function parseEndless(text) {
  try {
    const s = JSON.parse(text);
    const e = s?.endless;
    if (!e || !Number.isInteger(e.seed) || !Number.isInteger(e.floor) || e.floor < 1) return null;
    if (!s.party || !HERO_CODES.every((c) => s.party[c] && Array.isArray(s.party[c].items))) return null;
    for (const c of HERO_CODES) cleanPicks(c, s.party[c]);
    if (!Array.isArray(s.pack)) s.pack = [];
    if (!Number.isInteger(s.gold) || s.gold < 0) s.gold = 0;
    return s;
  } catch {
    return null;
  }
}

/** The deepest floor ever cleared (stored), or 0. */
export const parseBest = (text) => (Number.isInteger(Number(text)) && Number(text) > 0 ? Number(text) : 0);

// Storage can be blocked (private windows); the dive still runs, it just isn't kept.
export function loadEndless() {
  try { return parseEndless(localStorage.getItem(ENDLESS_KEY)); } catch { return null; }
}
export function loadBestFloor() {
  try { return parseBest(localStorage.getItem(ENDLESS_BEST_KEY)); } catch { return 0; }
}
/** Keep `floor` as the deepest cleared if it is. */
export function saveBestFloor(floor) {
  try { if (floor > loadBestFloor()) localStorage.setItem(ENDLESS_BEST_KEY, String(floor)); } catch { /* not kept */ }
}
export function clearEndless() {
  try { localStorage.removeItem(ENDLESS_KEY); } catch { /* nothing to clear */ }
}
