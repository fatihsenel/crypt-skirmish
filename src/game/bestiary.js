// The bestiary: which kinds of monster the player has met, kept in the browser across runs.
// A kind counts as met once the heroes have seen one in a fight (main.js calls meet).

import { TEMPLATES } from './units.js';

export const BESTIARY_KEY = 'crypt-skirmish:bestiary';

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
