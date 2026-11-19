// The bestiary: which kinds of monster the player has met, kept in the browser across runs.
// A kind counts as met once the heroes have seen one in a fight (main.js calls meet).

import { TEMPLATES } from './units.js';
import { NODES, nodeName } from './campaign.js';
import { levelById } from './maps.js';

export const BESTIARY_KEY = 'crypt-skirmish:bestiary';
export const SLAIN_KEY = 'crypt-skirmish:slain';
export const READ_KEY = 'crypt-skirmish:bestiary-read';

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
