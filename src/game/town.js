// The village above the crypt, rebuilt with gold between acts. After each act's boss the party
// may pay to raise the smith, the temple or the library a stage (three each); what a stage does
// lands outside fights, in the pedlar's stock and prices (shop.js) and in what the party gets
// back after a room (completeFight), so fight records and links need nothing. Pure state like
// shop.js: a campaign run only (not the Endless Crypt), and a New Game+ run starts in ruins.

import { NODES } from './campaign.js';

/** What each stage costs. */
export const COSTS = [120, 220, 340];

/** The buildings: each stage's rule (`desc`), how it looks then and the camp's news of it. */
export const TOWN = {
  smith: {
    name: 'The Smith',
    ruin: 'A cold forge under a fallen roof.',
    stages: [
      { desc: 'The pedlar carries a third piece of gear.', look: 'The forge glows again; a smith works at the anvil.', news: 'The forge is lit again. The pedlar has more to sell.' },
      { desc: 'Gear sells for three quarters of its price, not half.', look: 'Two anvils ring; blades hang along the wall.', news: 'The smith buys what you bring back, and pays well for it.' },
      { desc: 'The next act’s gear comes into stock an act early.', look: 'A busy forge, its chimney smoking day and night.', news: 'The smith’s finest work goes down to the pedlar ahead of you.' },
    ],
  },
  temple: {
    name: 'The Temple',
    ruin: 'A roofless shrine, its altar cracked.',
    stages: [
      { desc: 'After every room each hero gets 3 HP more back.', look: 'The altar is mended; a priest keeps the lamps.', news: 'The temple’s lamps are lit. Its prayers follow you down.' },
      { desc: 'Each act’s end, every hero gets a potion of healing.', look: 'Acolytes brew draughts in the cloister.', news: 'The acolytes will send potions down at each act’s end.' },
      { desc: 'After every room each caster gets one spent 1st-level slot back.', look: 'Bells ring the hours from a new tower.', news: 'The temple bells ring. Your casters feel them, even below.' },
    ],
  },
  library: {
    name: 'The Library',
    ruin: 'Scorched shelves open to the rain.',
    stages: [
      { desc: 'The pedlar carries a second spell scroll.', look: 'Shelves are rebuilt; a scribe copies by candle.', news: 'The scribes are at work. The pedlar carries more scrolls.' },
      { desc: 'Spell scrolls cost a third less.', look: 'A reading room, its tables full.', news: 'The library copies scrolls cheaply now.' },
      { desc: 'Each act’s end, every hero who can read one gets a free scroll.', look: 'A great library, its dome lit at night.', news: 'The librarian promises a scroll for every reader at each act’s end.' },
    ],
  },
};

/** Building `id`'s stage in this run (0: in ruins). */
export const stageOf = (state, id) => state.town?.[id] ?? 0;

/** Can the party rebuild here? In camp after an act's boss, in a campaign run. */
export const canBuild = (state) => !state.done && !state.endless && !!NODES[state.at]?.actBreak;

/** Why building `id` can't go up a stage now, or null. */
export function buildProblem(state, id) {
  if (!TOWN[id]) return 'No such building';
  if (!canBuild(state)) return 'Only after an act’s boss';
  const stage = stageOf(state, id);
  if (stage >= COSTS.length) return 'Already rebuilt';
  if ((state.gold ?? 0) < COSTS[stage]) return 'Not enough gold';
  return null;
}

/** Raise building `id` a stage. Returns the new state. */
export function build(prev, id) {
  const problem = buildProblem(prev, id);
  if (problem) throw new Error(problem);
  const state = structuredClone(prev);
  const stage = stageOf(state, id);
  state.gold -= COSTS[stage];
  state.town = { smith: 0, temple: 0, library: 0, ...state.town, [id]: stage + 1 };
  return state;
}

/** A save's village, made safe (saves from before it have none built). */
export function cleanTown(s) {
  const t = s.town && typeof s.town === 'object' ? s.town : {};
  s.town = Object.fromEntries(Object.keys(TOWN).map((id) => [id, Number.isInteger(t[id]) && t[id] >= 0 && t[id] <= COSTS.length ? t[id] : 0]));
  return s;
}
