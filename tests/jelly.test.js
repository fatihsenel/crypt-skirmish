import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { levelById } from '../src/game/maps.js';

/** Brannoc next to an ochre jelly, on Brannoc's turn; the dice always roll high. */
function fight(rules) {
  const g = new Game(['#######', '#F.j..#', '#.....#', '#######'], { senses: false, rng: () => 0.99, ...(rules && { rules }) });
  g.start();
  const f = g.units.find((u) => u.cls === 'Fighter');
  const j = g.units.find((u) => u.code === 'j');
  f.x = 2;
  while (g.current !== f) g.endTurn();
  return { g, f, j };
}

describe('the ochre jelly', () => {
  it('splits in two when a melee weapon hits it, from rules 6', () => {
    const { g, f, j } = fight();
    const r = g.attack(f, j, f.attacks[0]);
    expect(r.hit).toBe(true);
    const half = j.hp;
    expect(r.split).toBeTruthy();
    expect(r.split.hp).toBe(half);
    expect(j.maxHp).toBe(half);
    expect(j.size).toBe(1);
    expect(r.split.size).toBe(1);
    expect(g.units.filter((u) => u.code === 'j' && u.alive)).toHaveLength(2);
    expect(g.order.indexOf(r.split)).toBe(g.order.indexOf(j) + 1);
    expect(Math.max(Math.abs(r.split.x - j.x), Math.abs(r.split.z - j.z))).toBe(1);
  });

  it('a Small jelly or one under 10 HP splits no more', () => {
    const { g, j } = fight();
    j.size = 0;
    expect(g.split(j)).toBe(null);
    j.size = 1; j.hp = 9;
    expect(g.split(j)).toBe(null);
  });

  it('needs a free tile beside it', () => {
    const g = new Game(['#####', '#.F.#', '#FjF#', '#.F.#', '#####'], { senses: false, rng: () => 0.5 });
    g.start();
    const j = g.units.find((u) => u.code === 'j');
    for (const [x, z] of [[1, 1], [3, 1], [1, 3], [3, 3]]) g.grid.props.set(`${x},${z}`, { x, z, kind: 'crate', cover: 'half' });
    expect(g.split(j)).toBe(null);
  });

  it('stays whole under rules 5', () => {
    const { g, f, j } = fight(5);
    const r = g.attack(f, j, f.attacks[0]);
    expect(r.hit).toBe(true);
    expect(r.split).toBeFalsy();
    expect(g.units.filter((u) => u.code === 'j')).toHaveLength(1);
  });

  it('waits in the Cistern only from rules 6', () => {
    const level = levelById('cistern');
    const jelly = new Game(level, { rules: 6 }).units.find((u) => u.code === 'j');
    expect(jelly).toMatchObject({ size: 1, hp: 23, maxHp: 23, asleep: true }); // a young one, lying still
    expect(new Game(level, { rules: 5 }).units.some((u) => u.code === 'j')).toBe(false);
  });
});
