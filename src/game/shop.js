// Gold and the pedlar. Every won room pays gold (deeper rooms and bosses more); the pedlar, who
// follows the party down, trades at the rest stops and in camp after each act's boss. He always
// sells potions, and two pieces of gear that change from stop to stop (better ones deeper down);
// he buys spare gear from the pack at half price. Pure state like campaign.js: nothing rolls
// dice, and what's bought rides with the party (potions, the pack), so fight records need nothing.

import { NODES, HERO_CODES } from './campaign.js';
import { ITEMS, SCROLLS, readsScroll } from './items.js';
import { classOf } from './units.js';

/** What the pedlar asks for each thing; he pays half for gear from the pack. */
export const PRICES = {
  potion: 30,
  fire: 40,
  caltrops: 15,
  scrollCureWounds: 60,
  scrollMagicMissile: 60,
  scrollFogCloud: 60,
  scrollMistyStep: 90,
  scrollFireball: 180,
  periaptPoison: 150,
  weaponPlus1: 200,
  ringProtection: 250,
  cloakProtection: 250,
  bracersDefense: 250,
  gauntletsOgre: 300,
  amuletHealth: 350,
  periaptWounds: 400,
  weaponPlus2: 500,
};

/** The gear he may carry, weakest first: each act cleared opens two more. */
const STOCK = ['periaptPoison', 'weaponPlus1', 'ringProtection', 'cloakProtection', 'gauntletsOgre', 'amuletHealth', 'weaponPlus2', 'periaptWounds'];

/** Gold for winning room `id`: 20 plus 10 a column deeper, twice that for a boss. */
export function goldFor(id) {
  const n = NODES[id];
  return n?.kind === 'fight' ? (20 + 10 * n.col) * (n.boss ? 2 : 1) : 0;
}

/** Is the pedlar here? At a rest stop, or in camp after an act's boss (in the Endless Crypt, every third floor). */
export const canTrade = (state) => !state.done && !!state.at
  && (state.endless ? !!state.endless.rested : NODES[state.at]?.kind === 'rest' || !!NODES[state.at]?.actBreak);

/** A small, steady hash of a string, so a stop's stock is the same every visit. */
function hash(text) {
  let h = 7;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** The heroes (slot codes) who can read scroll `id`. */
export const readers = (state, id) => HERO_CODES.filter((c) => state.party[c] && readsScroll(classOf(c, state.party[c]), id));

/** What's for sale here: potions, alchemist's fire and caltrops, a spell scroll, then two pieces of gear not yet bought at this stop. */
export function stock(state) {
  // In the Endless Crypt he carries everything.
  const acts = state.endless ? 9 : state.cleared.filter((c) => NODES[c]?.actBreak).length;
  const pool = STOCK.slice(0, Math.min(STOCK.length, 3 + 2 * acts));
  const start = hash(`${state.at}:${state.tier ?? 0}`) % pool.length;
  const gear = [pool[start], pool[(start + 1 + (hash(state.at) % (pool.length - 1))) % pool.length]];
  const bought = state.traded?.at === state.at ? state.traded.bought : [];
  const scroll = SCROLLS[hash(`${state.at}:${state.tier ?? 0}:scroll`) % SCROLLS.length];
  return ['potion', 'fire', 'caltrops', ...[scroll, ...gear].filter((id) => !bought.includes(id))];
}

/** Why `id` can't be bought now, or null. */
export function buyProblem(state, id) {
  if (!canTrade(state)) return 'The pedlar isn’t here';
  if (!stock(state).includes(id)) return 'Not for sale here';
  if ((state.gold ?? 0) < PRICES[id]) return 'Not enough gold';
  if (ITEMS[id]?.kind === 'scroll' && !readers(state, id).length) return 'No one in the party can read it';
  return null;
}

/** Buy `id`: a potion (or a flask, or caltrops) goes to whoever carries fewest, gear to the pack. Returns the new state. */
export function buy(prev, id) {
  const problem = buyProblem(prev, id);
  if (problem) throw new Error(problem);
  const state = structuredClone(prev);
  state.gold -= PRICES[id];
  if (id === 'potion') {
    const code = HERO_CODES.reduce((a, b) => (state.party[b].potions < state.party[a].potions ? b : a));
    state.party[code].potions++;
  } else if (ITEMS[id]?.kind === 'supply') {
    const f = ITEMS[id].carry;
    const code = HERO_CODES.reduce((a, b) => ((state.party[b][f] ?? 0) < (state.party[a][f] ?? 0) ? b : a));
    state.party[code][f] = (state.party[code][f] ?? 0) + 1;
  } else if (ITEMS[id]?.kind === 'scroll') { // to the reader who carries fewest
    const code = readers(state, id).reduce((a, b) => ((state.party[b].scrolls?.length ?? 0) < (state.party[a].scrolls?.length ?? 0) ? b : a));
    (state.party[code].scrolls ??= []).push(id);
    if (state.traded?.at !== state.at) state.traded = { at: state.at, bought: [] };
    state.traded.bought.push(id);
  } else {
    state.pack.push(id);
    if (state.traded?.at !== state.at) state.traded = { at: state.at, bought: [] };
    state.traded.bought.push(id);
  }
  return state;
}

/** What the pedlar pays for item `id` from the pack (0: he won't take it). */
export const sellPrice = (id) => (ITEMS[id]?.kind === 'gear' ? Math.floor((PRICES[id] ?? 0) / 2) : 0);

/** Sell the pack's item at `index`. Returns the new state. */
export function sell(prev, index) {
  const id = prev.pack[index];
  if (!canTrade(prev)) throw new Error('The pedlar isn’t here');
  if (!sellPrice(id)) throw new Error('He won’t take that');
  const state = structuredClone(prev);
  state.pack.splice(index, 1);
  state.gold = (state.gold ?? 0) + sellPrice(id);
  return state;
}

/** A save's gold and this stop's purchases, made safe (saves from before gold have none). */
export function cleanGold(s) {
  if (!Number.isInteger(s.gold) || s.gold < 0) s.gold = 0;
  const t = s.traded;
  if (!t || !NODES[t.at] || !Array.isArray(t.bought) || !t.bought.every((id) => PRICES[id])) delete s.traded;
  return s;
}
