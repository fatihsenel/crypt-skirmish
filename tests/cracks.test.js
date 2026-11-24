import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { levelById } from '../src/game/maps.js';

// Upper hall on the left, lower hall on the right (6 tiles east), linked by one stair. Brannoc
// at (1,1) stands next to a foe at (2,1), with the crack behind it at (3,1).
function fight(rules, { foe = 'o' } = {}) {
  const rows = [
    '############',
    `#F${foe},.##....#`,
    '#C...##....#',
    '#...[##]...#',
    '############',
  ];
  const g = new Game({ rows, below: [6, 0] }, { senses: false, rng: () => 0.99, ...(rules && { rules }) });
  g.start();
  const f = g.units.find((u) => u.cls === 'Fighter');
  const o = g.units.find((u) => u.team === 'monsters');
  while (g.current !== f) g.endTurn();
  return { g, f, o };
}

describe('cracked floor', () => {
  it('gives way under a pushed foe, from rules 6: down to the hall below, hurt and prone', () => {
    const { g, f, o } = fight();
    expect(g.grid.lower.has('9,1')).toBe(true);
    const r = g.shove(f, o, true);
    expect(r.success).toBe(true);
    expect(r.push).toMatchObject({ to: { x: 9, z: 1 }, stair: { x: 3, z: 1 }, crash: true });
    expect([o.x, o.z]).toEqual([9, 1]);
    expect(r.push.tumble.damage).toBeGreaterThan(0);
    expect(g.has(o, 'prone') || !o.alive).toBe(true);
    expect(g.grid.cracks.has('3,1')).toBe(false);
    expect(g.grid.isSolid(3, 1)).toBe(true); // a hole now
  });

  it('is plain floor under rules 5', () => {
    const { g, f, o } = fight(5);
    expect(g.grid.cracks.size).toBe(0);
    const r = g.shove(f, o, true);
    expect(r.push).toMatchObject({ to: { x: 3, z: 1 } });
    expect(r.push.crash).toBeUndefined();
  });

  it('holds when the tile below is taken', () => {
    const { g, f, o } = fight();
    const c = g.units.find((u) => u.cls === 'Cleric');
    c.x = 9; c.z = 1; // standing below the crack
    const r = g.shove(f, o, true);
    expect(r.push).toMatchObject({ to: { x: 3, z: 1 } });
    expect(r.push.crash).toBeUndefined();
    expect(g.grid.cracks.has('3,1')).toBe(true);
  });

  it('a flier is not dropped', () => {
    const { g, f, o } = fight(undefined, { foe: 'a' });
    o.unaware = false;
    const r = g.pushTo(f, o);
    expect(r.crash).toBeUndefined();
  });

  it('is in the Cistern and the Undercroft, each over a tile of its lower hall', () => {
    for (const id of ['cistern', 'undercroft']) {
      const level = levelById(id);
      const g = new Game(level, { rules: 6 });
      expect(g.grid.cracks.size).toBeGreaterThan(0);
      for (const c of g.grid.cracks.values()) {
        const x = c.x + level.below[0], z = c.z + level.below[1];
        expect(g.grid.lower.has(`${x},${z}`)).toBe(true);
        expect(g.grid.lower.has(`${c.x},${c.z}`)).toBe(false);
        expect(g.grid.isSolid(x, z)).toBe(false);
      }
    }
  });
});
