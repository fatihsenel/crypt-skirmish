// What the title and camp need from the rules without the rules engine itself: the rules
// version and the New Game+ elites' traits. combat.js re-exports them.

import { hash } from './dice.js';

/**
 * The rules new fights are played by. 1: as first released. 2: death saves, concentration,
 * ghoul claws that paralyse, long range and creatures giving cover. 3: a shove can push a foe
 * 5 ft back instead of knocking it prone (into a chasm, it falls). A saved fight, replay or
 * link carries the number it began under (none means 1), so it plays back by its own rules.
 */
export const RULES = 3;

/**
 * New Game+ 2 and deeper: each room's strongest monster is an elite with one of these traits
 * (see Game#makeElite). Which trait goes by the room and the tier, never by the dice.
 */
export const ELITE_TRAITS = [
  { id: 'regenerating', name: 'Regenerating', desc: 'regains 5 HP at the start of each of its turns' },
  { id: 'relentless', name: 'Relentless', desc: 'the first time it drops to 0 HP, it stays on 1 instead' },
  { id: 'frenzied', name: 'Frenzied', desc: 'makes one more attack with each Attack action' },
  { id: 'swift', name: 'Swift', desc: 'moves 10 ft farther' },
  { id: 'warded', name: 'Warded', desc: '+2 AC; can’t be frightened, knocked prone or poisoned' },
  { id: 'barbed', name: 'Barbed', desc: 'a foe that hits it with a melee weapon takes 3 piercing damage' },
];
export const ELITE_REGEN = 5;
export const ELITE_BARBS = 3;

/**
 * The elite's trait in the room `levelId` at New Game+ `tier`: it moves on one trait a tier.
 * The hash gives every trait a room at each tier, and a weekly room at New Game+ 3 (weekly.js).
 */
export function eliteTrait(levelId, tier) {
  return ELITE_TRAITS[(tier + hash(String(levelId))) % ELITE_TRAITS.length];
}
