import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { key } from '../src/game/grid.js';

const unit = (game, code) => game.units.find((u) => u.code === code);

describe('threat zones', () => {
  it('a melee monster threatens one step beyond where it can walk', () => {
    // The rat (speed 6, 30 ft) at x=13 can walk to x=7 and bite x=6.
    const game = new Game(['###############', '#C...........r#', '###############'], { senses: false });
    const { melee, ranged } = game.threatOf(unit(game, 'r'));
    expect(melee.has(key(6, 1))).toBe(true);
    expect(melee.has(key(5, 1))).toBe(false);
    expect(ranged.size).toBe(0);
  });

  it('heroes block the way, unless they are the one about to move', () => {
    const game = new Game(['###########', '#....F...r#', '###########'], { senses: false });
    const [f, r] = [unit(game, 'F'), unit(game, 'r')];
    expect(game.threatOf(r).melee.has(key(5, 1))).toBe(true); // the Fighter where they stand
    expect(game.threatOf(r).melee.has(key(4, 1))).toBe(false); // can't get past them
    expect(game.threatOf(r, { ignore: f }).melee.has(key(4, 1))).toBe(true);
  });

  it('a monster that has not noticed the party, or is fleeing, threatens nothing', () => {
    const game = new Game(['#######', '#C...r#', '#######'], { senses: false });
    const r = unit(game, 'r');
    r.unaware = true;
    expect(game.threatOf(r).melee.size).toBe(0);
    r.unaware = false;
    r.turned = true;
    expect(game.threatOf(r).melee.size).toBe(0);
  });

  it('a restrained monster only threatens around itself', () => {
    const game = new Game(['###########', '#C.......r#', '###########'], { senses: false });
    const r = unit(game, 'r');
    r.conditions = { restrained: { turns: 1 } };
    expect([...game.threatOf(r).melee].sort()).toEqual([key(8, 1)]);
  });

  it('ranged attacks need a line of sight from somewhere the monster can stand', () => {
    const game = new Game([
      '#########',
      '#C......#',
      '#####.###',
      '#s....#.#',
      '#########',
    ], { senses: false });
    const s = unit(game, 's');
    s.speed = 0; // stand still: only what it can see from where it is
    const { ranged } = game.threatOf(s);
    expect(ranged.has(key(5, 3))).toBe(true);
    expect(ranged.has(key(7, 3))).toBe(false); // behind the wall
    expect(ranged.has(key(1, 1))).toBe(false); // round the corner, out of sight
  });

  it('marks the tiles only a long-range shot reaches, from the second rules', () => {
    // The goblin (speed 6, shortbow 16, 64 long) at x=61: it can shoot x=39 at its range, x=20 only long.
    const row = '#C' + '.'.repeat(59) + 'g#';
    const map = ['#'.repeat(row.length), row, '#'.repeat(row.length)];
    const now = new Game(map, { senses: false });
    const t = now.threatOf(unit(now, 'g'));
    expect(t.ranged.has(key(39, 1))).toBe(true);
    expect(t.far.has(key(39, 1))).toBe(false);
    expect(t.far.has(key(20, 1))).toBe(true);
    expect(t.ranged.has(key(20, 1))).toBe(false);
    const old = new Game(map, { senses: false, rules: 1 });
    expect(old.threatOf(unit(old, 'g')).far.size).toBe(0);
  });
});
