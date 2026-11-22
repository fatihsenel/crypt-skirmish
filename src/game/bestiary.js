// The bestiary: which kinds of monster the player has met, kept in the browser across runs.
// A kind counts as met once the heroes have seen one in a fight (main.js calls meet).

import { TEMPLATES } from './units.js';
import { ELITE_TRAITS } from './combat.js';
import { NODES, nodeName } from './campaign.js';
import { levelById } from './maps.js';

export const BESTIARY_KEY = 'crypt-skirmish:bestiary';
export const SLAIN_KEY = 'crypt-skirmish:slain';
export const READ_KEY = 'crypt-skirmish:bestiary-read';
export const HURT_KEY = 'crypt-skirmish:hurt';
export const ELITES_SLAIN_KEY = 'crypt-skirmish:elites-slain';
export const HEARD_KEY = 'crypt-skirmish:heard';

/** Every monster kind, in the order the crypt introduces them. */
export const MONSTERS = Object.keys(TEMPLATES).filter((code) => TEMPLATES[code].team === 'monsters');

/** The stored list, cleaned: known codes only, each once, in bestiary order. */
export function parseBestiary(raw) {
  try {
    const list = JSON.parse(raw ?? '[]');
    return Array.isArray(list) ? MONSTERS.filter((code) => list.includes(code)) : [];
  } catch {
    return [];
  }
}

export function loadBestiary() {
  try {
    return parseBestiary(localStorage.getItem(BESTIARY_KEY));
  } catch {
    return [];
  }
}

/** Note monster kinds as met; returns the ones met for the first time. */
export function meet(codes) {
  const have = loadBestiary();
  const fresh = [...new Set(codes)].filter((c) => MONSTERS.includes(c) && !have.includes(c));
  if (fresh.length) {
    try {
      localStorage.setItem(BESTIARY_KEY, JSON.stringify(MONSTERS.filter((c) => have.includes(c) || fresh.includes(c))));
    } catch {
      /* storage unavailable: met again next time */
    }
  }
  return fresh;
}

/** How many of each kind the player has felled: { code: count }. */
export function parseSlain(raw) {
  try {
    const counts = JSON.parse(raw ?? '{}');
    if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return {};
    return Object.fromEntries(MONSTERS.filter((c) => Number.isInteger(counts[c]) && counts[c] > 0).map((c) => [c, counts[c]]));
  } catch {
    return {};
  }
}

export function loadSlain() {
  try {
    return parseSlain(localStorage.getItem(SLAIN_KEY));
  } catch {
    return {};
  }
}

/** One more of this kind felled. */
export function slay(code) {
  if (!MONSTERS.includes(code)) return;
  const counts = loadSlain();
  counts[code] = (counts[code] ?? 0) + 1;
  try {
    localStorage.setItem(SLAIN_KEY, JSON.stringify(counts));
  } catch {
    /* storage unavailable: not counted */
  }
}

/** How many elites of each trait the player has felled: { traitId: count }. */
export function parseElitesSlain(raw) {
  try {
    const counts = JSON.parse(raw ?? '{}');
    if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return {};
    return Object.fromEntries(ELITE_TRAITS.filter((t) => Number.isInteger(counts[t.id]) && counts[t.id] > 0).map((t) => [t.id, counts[t.id]]));
  } catch {
    return {};
  }
}

export function loadElitesSlain() {
  try {
    return parseElitesSlain(localStorage.getItem(ELITES_SLAIN_KEY));
  } catch {
    return {};
  }
}

/** One more elite with this trait felled. */
export function slayElite(id) {
  if (!ELITE_TRAITS.some((t) => t.id === id)) return;
  const counts = loadElitesSlain();
  counts[id] = (counts[id] ?? 0) + 1;
  try {
    localStorage.setItem(ELITES_SLAIN_KEY, JSON.stringify(counts));
  } catch {
    /* storage unavailable: not counted */
  }
}

/** The last thing each kind was heard to say in a speech bubble: { code: line }. */
export function loadHeard() {
  try {
    const heard = JSON.parse(localStorage.getItem(HEARD_KEY));
    return heard && typeof heard === 'object' ? heard : {};
  } catch {
    return {};
  }
}

/** A monster of kind `code` said `line`: the bestiary quotes it. */
export function hear(code, line) {
  try {
    localStorage.setItem(HEARD_KEY, JSON.stringify({ ...loadHeard(), [code]: line }));
  } catch { /* not kept */ }
}

/** What each kind has done to the party over every fight: { code: { damage, downs } }. */
export function parseHurt(raw) {
  try {
    const all = JSON.parse(raw ?? '{}');
    if (!all || typeof all !== 'object' || Array.isArray(all)) return {};
    const count = (n) => (Number.isInteger(n) && n > 0 ? n : 0);
    return Object.fromEntries(MONSTERS
      .filter((c) => all[c] && typeof all[c] === 'object')
      .map((c) => [c, { damage: count(all[c].damage), downs: count(all[c].downs) }])
      .filter(([, h]) => h.damage || h.downs));
  } catch {
    return {};
  }
}

export function loadHurt() {
  try {
    return parseHurt(localStorage.getItem(HURT_KEY));
  } catch {
    return {};
  }
}

/** `hurt` with a fight's blows (game.blows) added: the damage each kind dealt and the heroes it dropped. */
export function addBlows(hurt, blows) {
  const next = Object.fromEntries(Object.entries(hurt).map(([c, h]) => [c, { ...h }]));
  for (const b of blows) {
    if (!MONSTERS.includes(b.code)) continue;
    const h = (next[b.code] ??= { damage: 0, downs: 0 });
    h.damage += b.damage;
    if (b.down) h.downs++;
  }
  return next;
}

/** A finished fight's blows go into the stored tally. */
export function recordBlows(blows) {
  try {
    localStorage.setItem(HURT_KEY, JSON.stringify(addBlows(loadHurt(), blows)));
  } catch {
    /* storage unavailable: not counted */
  }
}

/** The kinds that hurt the party most, worst first: [{ code, damage, downs }]. */
export const deadliest = (hurt = loadHurt(), n = 3) => Object.entries(hurt)
  .map(([code, h]) => ({ code, ...h }))
  .sort((a, b) => b.damage - a.damage || b.downs - a.downs)
  .slice(0, n);

/** The monster kinds placed in a campaign node's room (none for a rest). */
export function roomMonsters(node) {
  const id = NODES[node]?.level;
  if (!id) return [];
  const letters = new Set(levelById(id).rows.join('').split(''));
  return MONSTERS.filter((c) => letters.has(c));
}

/** The nodes every way through the dungeon to `node` passes, `node` included. */
export function onEveryPath(node) {
  const reaches = (skip) => {
    const seen = new Set(['crypt']);
    const todo = ['crypt'];
    while (todo.length) {
      for (const e of NODES[todo.pop()].next) {
        const to = typeof e === 'string' ? e : e.to;
        if (to === skip || seen.has(to)) continue;
        seen.add(to);
        todo.push(to);
      }
    }
    return seen.has(node);
  };
  return Object.keys(NODES).filter((d) => d === node || d === 'crypt' || !reaches(d));
}

/**
 * Monsters met before the bestiary existed, from what the browser remembers: the rooms the
 * saved run cleared, the rooms every past run must have passed to get where it ended, and
 * the daily crypts played.
 */
export function metBefore({ cleared = [], at = null, reached = [], daily = [] } = {}) {
  const byName = Object.fromEntries(Object.keys(NODES).map((id) => [nodeName(id), id]));
  const rooms = new Set([...cleared, ...daily].filter((id) => NODES[id]));
  for (const end of [at, ...reached.map((name) => byName[name])]) {
    if (NODES[end]) for (const id of onEveryPath(end)) rooms.add(id);
  }
  const codes = new Set([...rooms].flatMap(roomMonsters));
  return MONSTERS.filter((c) => codes.has(c));
}

/** Monsters slain in all, every kind together. */
export const slainTotal = (counts = loadSlain()) => Object.values(counts).reduce((n, c) => n + c, 0);

/** Kinds met since the bestiary was last opened. */
export function unread() {
  let read = [];
  try {
    read = parseBestiary(localStorage.getItem(READ_KEY));
  } catch {
    /* storage unavailable: everything counts as new */
  }
  return loadBestiary().filter((c) => !read.includes(c));
}

/** The bestiary was opened: everything met so far has been seen there. */
export function markRead() {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify(loadBestiary()));
  } catch {
    /* storage unavailable */
  }
}
