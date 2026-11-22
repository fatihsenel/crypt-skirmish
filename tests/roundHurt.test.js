import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { seeded } from '../src/game/dice.js';
import { levelById } from '../src/game/maps.js';
import { NODES, newCampaign } from '../src/game/campaign.js';

const room = () => new Game(levelById(NODES.crypt.level), { party: newCampaign().party, rng: seeded(1) });

describe('HP lost each round', () => {
  it('counts what landed on each side, by round, not overkill or temporary HP', () => {
    const g = room();
    const hero = g.units.find((u) => u.team === 'heroes');
    const rat = g.units.find((u) => u.team === 'monsters');
    g.round = 2;
    hero.tempHp = 3;
    g.applyDamage(hero, 5, rat); // 3 soaked, 2 lost
    g.applyDamage(rat, 999, hero); // only its HP
    expect(g.roundHurt(2)).toEqual({ heroes: 2, monsters: rat.maxHp });
    expect(g.roundHurt(1)).toEqual({ heroes: 0, monsters: 0 });
  });
});
