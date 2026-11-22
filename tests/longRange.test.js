import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';

function fight(rules) {
  const row = '#R' + '.'.repeat(30) + 'o#';
  const g = new Game(['#'.repeat(row.length), row, '#'.repeat(row.length)], { senses: false, rng: () => 0.5, ...(rules && { rules }) });
  g.start();
  const r = g.units.find((u) => u.code === 'R');
  const orc = g.units.find((u) => u.team === 'monsters');
  g.turn = g.order.indexOf(r);
  g.beginTurn();
  return { g, r, orc };
}

describe('long range', () => {
  it('lets a bow shoot past its range at disadvantage, up to four times as far', () => {
    const { g, r, orc } = fight();
    const bow = r.attacks.find((a) => a.reach > 1);
    orc.x = r.x + bow.reach + 2;
    expect(g.attackProblem(r, orc, bow)).toBeNull();
    expect(g.attackMods(r, orc, bow).dis).toContain('long range');
    orc.x = r.x + bow.reach;
    expect(g.attackMods(r, orc, bow).dis).not.toContain('long range');
  });

  it('not past four times, and not under the first rules', () => {
    const { g, r, orc } = fight(1);
    const bow = r.attacks.find((a) => a.reach > 1);
    orc.x = r.x + bow.reach + 2;
    expect(g.attackProblem(r, orc, bow)).toMatch(/Out of range/);
  });
});
