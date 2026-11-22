import { describe, it, expect } from 'vitest';
import { Game, hitChance, failChance, diceRange } from '../src/game/combat.js';

describe('odds for the preview', () => {
  it('counts the faces of a d20 that hit, a 1 always missing and a 20 always hitting', () => {
    expect(hitChance(5, 15)).toBeCloseTo(0.55); // 10 or more
    expect(hitChance(20, 10)).toBeCloseTo(0.95); // only a 1 misses
    expect(hitChance(0, 30)).toBeCloseTo(0.05); // only a 20 hits
    expect(hitChance(0, 30, 'normal', 19)).toBeCloseTo(0.1); // Improved Critical
  });

  it('takes the better of two dice with advantage and the worse with disadvantage', () => {
    expect(hitChance(5, 15, 'adv')).toBeCloseTo(1 - 0.45 ** 2);
    expect(hitChance(5, 15, 'dis')).toBeCloseTo(0.55 ** 2);
  });

  it('gives the chance a save falls short, with no automatic 1s or 20s', () => {
    expect(failChance(2, 13)).toBeCloseTo(0.5); // 11 or more saves
    expect(failChance(10, 5)).toBe(0);
    expect(failChance(-5, 30)).toBe(1);
    expect(failChance(2, 13, 'dis')).toBeCloseTo(0.75);
  });

  it('gives the lowest and highest damage a hit can do', () => {
    expect(diceRange('1d8', 3)).toEqual({ min: 4, max: 11 });
    expect(diceRange('2d6+2')).toEqual({ min: 4, max: 14 });
    expect(diceRange('1d4', -3)).toEqual({ min: 1, max: 1 });
  });

  it('reads an attack the way the roll would: cover, advantage and Sneak Attack', () => {
    const g = new Game(['#######', '#R.o..#', '#######'], { senses: false, rng: () => 0.5 });
    g.start();
    const r = g.units.find((u) => u.code === 'R');
    const orc = g.units.find((u) => u.team === 'monsters');
    const bow = r.attacks.find((a) => a.reach > 1);
    const o = g.attackOdds(r, orc, bow);
    expect(o.chance).toBeCloseTo(hitChance(g.toHitBonus(r, bow), g.acOf(orc), o.mods.mode));
    expect(o.min).toBe(diceRange(bow.damage, g.damageBonus(r, bow)).min);
    const goblin = { ...orc, id: 99, x: 2, z: 1, name: 'Wall' };
    g.units.push(goblin);
    orc.x = 4;
    expect(g.attackOdds(r, orc, bow).cover).toBe(0); // right next to the archer: no cover
  });

  it('a paralysed creature fails DEX saves', () => {
    const g = new Game(['#####', '#R.o#', '#####'], { senses: false });
    const orc = g.units.find((u) => u.team === 'monsters');
    expect(g.saveOdds(orc, 'dex', 5)).toBeLessThan(1);
    orc.conditions = { paralyzed: { turns: 3 } };
    expect(g.saveOdds(orc, 'dex', 5)).toBe(1);
  });
});
