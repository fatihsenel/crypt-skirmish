import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';

function fight(rules) {
  const g = new Game(['##########', '#R..F...o#', '#........#', '##########'], { senses: false, rng: () => 0.5, ...(rules && { rules }) });
  g.start();
  return { g, r: g.units.find((u) => u.code === 'R'), f: g.units.find((u) => u.code === 'F'), orc: g.units.find((u) => u.team === 'monsters') };
}

describe('creatures give cover', () => {
  it('a figure between the archer and the target gives half cover', () => {
    const { g, r, orc } = fight();
    expect(g.coverBonus(r, orc)).toBe(2);
    expect(g.coverBonus(orc, r)).toBe(2); // and the other way
  });

  it('not one right next to the attacker, nor one out of the line', () => {
    const { g, r, f, orc } = fight();
    f.x = 2;
    expect(g.coverBonus(r, orc)).toBe(0);
    f.x = 4; f.z = 2;
    expect(g.coverBonus(r, orc)).toBe(0);
  });

  it('not under the first rules', () => {
    const { g, r, orc } = fight(1);
    expect(g.coverBonus(r, orc)).toBe(0);
  });
});
