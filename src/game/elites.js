// What the title and camp need from the rules without the rules engine itself: the rules
// version and the New Game+ elites' traits. combat.js re-exports them.

import { hash } from './dice.js';

/**
 * The rules new fights are played by. 1: as first released. 2: death saves, concentration,
 * ghoul claws that paralyse, long range and creatures giving cover. 3: a shove can push a foe
 * 5 ft back instead of knocking it prone (into a chasm, it falls). 4: monsters throw heroes
 * back too (a gargoyle's claws, Tharok's charge); a hero sent over a chasm's edge may catch
 * it. 5: a foe pushed (or a hero thrown) into a stairwell tumbles down to the floor below,
 * 1d6 damage and prone. 6: a potion can be tossed to an ally 15 ft away, the Ochre Jelly
 * splits, cracked floors give way to the hall below, alchemist's fire and caltrops, and dark
 * chambers. 7: torches thrown and the Light cantrip, living monsters breaking
 * and running (morale), smashable barrels and crates, and the Gelatinous Cube. 8: doors shut and barred, traps disarmed and turned on monsters,
 * zombies (Undead Fortitude) and swarms of rats. 9: alarm gongs and the monsters they call,
 * rooms to hold and prisoners to free, the owl familiar, secret doors and the cult fanatic who
 * calls up skeletons. 10: bosses' lair actions, spell scrolls, Counterspell, pit traps, cracked
 * ceilings that cave in, Fog Cloud and Grease. 11: fighting styles for the Fighter and
 * the Paladin, high ground (ledges), and the shadow, the hobgoblin and the kobold. 12: heights in
 * steps, cliffs and ladders, raised ground hiding what lies past it, no melee across a cliff and
 * falls of 1d6 a step. A saved fight, replay or
 * link carries the number it began under (none means 1), so it plays back by its own rules.
 */
export const RULES = 12;

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
