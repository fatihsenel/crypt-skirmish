import { describe, it, expect } from 'vitest';
import { Grid, key } from '../src/game/grid.js';
import { Game } from '../src/game/combat.js';
import { chooseMove } from '../src/game/ai.js';
import { levelById, LEVELS } from '../src/game/maps.js';

// A room on two floors: '[' on the upper floor leads down to ']' on the lower one.
const map = [
  '#########',
  '#F.[#]..#',
  '#...#...#',
  '#...#.g.#',
  '#########',
];

function setTurn(game, i) {
  game.order = [game.units[i], ...game.units.filter((_, j) => j !== i)];
  game.turn = 0;
  game.beginTurn();
  return game.units[i];
}

describe('rooms on two floors', () => {
  it('links each stair down to its stair up, and knows the lower hall', () => {
    const g = new Grid(map);
    expect(g.stairways).toEqual([{ down: { x: 3, z: 1 }, up: { x: 5, z: 1 } }]);
    expect([...g.neighbors(3, 1)]).toContainEqual([5, 1]);
    expect([...g.neighbors(5, 1)]).toContainEqual([3, 1]);
    expect(g.lower.has(key(6, 3))).toBe(true);
    expect(g.lower.has(key(5, 1))).toBe(true);
    expect(g.lower.has(key(2, 2))).toBe(false);
    expect(g.lower.has(key(3, 1))).toBe(false);
    expect(() => new Grid(['#####', '#.[.#', '#####'])).toThrow();
  });

  it('leaves one-floor rooms as they were', () => {
    for (const l of LEVELS.filter((r) => r.id !== 'cistern')) {
      const g = new Grid(l.rows);
      expect([g.links.size, g.lower.size]).toEqual([0, 0]);
    }
  });

  it('a move down the stairs is one step, and ends on the other floor', () => {
    const game = new Game(map, { rng: () => 0.5 });
    game.start();
    const f = setTurn(game, 0);
    const r = game.move(f, 6, 2);
    expect(r.steps.map((s) => s.type)).toEqual(['walk', 'stairs', 'walk']);
    expect(r.steps[1]).toEqual({ type: 'stairs', from: { x: 3, z: 1 }, to: { x: 5, z: 1 }, down: true });
    expect([f.x, f.z]).toEqual([6, 2]);
    expect(f.movesLeft).toBe(6 - 4);
    expect(r.undo).toBeUndefined(); // no taking back a trip to the other floor
  });

  it('walls hide each floor from the other, but monsters climb the stairs', () => {
    const game = new Game(map, { rng: () => 0.5 });
    game.start();
    const [f, g] = game.units;
    expect(game.grid.lineOfSight(f.x, f.z, g.x, g.z)).toBe(false);
    setTurn(game, 1);
    const r = game.move(g, 2, 1);
    expect(r.steps.find((s) => s.type === 'stairs')).toMatchObject({ from: { x: 5, z: 1 }, to: { x: 3, z: 1 }, down: false });
  });

  it('leaving reach by the stairs provokes an opportunity attack', () => {
    const game = new Game(['#########', '#.g[#]..#', '#..F#...#', '#########'], { rng: () => 0.5 });
    game.start();
    const f = game.units.find((u) => u.team === 'heroes');
    f.x = 3; f.z = 1; // on the stair, next to the goblin
    const i = game.units.indexOf(f);
    setTurn(game, i);
    const r = game.move(f, 6, 1);
    expect(r.steps[0].type).toBe('opportunity');
  });

  it('an aware monster takes the stairs to reach a hero on the other floor', () => {
    const game = new Game(map, { rng: () => 0.5 });
    game.start();
    const g = game.units.find((u) => u.team === 'monsters');
    setTurn(game, game.units.indexOf(g));
    g.attacks = g.attacks.filter((a) => a.reach === 1); // melee only
    g.unaware = false;
    const dest = chooseMove(game, g);
    expect(game.grid.lower.has(key(dest.x, dest.z))).toBe(false); // up on the hero's floor
    const r = game.move(g, dest.x, dest.z);
    expect(r.steps.some((s) => s.type === 'stairs' && !s.down)).toBe(true);
  });

  it('someone on the far stair blocks it to foes, not to friends', () => {
    const game = new Game(['#########', '#F.[#]..#', '#W..#.g.#', '#...#...#', '#########'], { rng: () => 0.5 });
    game.start();
    const f = game.units.find((u) => u.code === 'F');
    const w = game.units.find((u) => u.code === 'W');
    const g = game.units.find((u) => u.team === 'monsters');
    setTurn(game, game.units.indexOf(f));
    g.x = 5; g.z = 1; // a goblin on the stair up
    expect(game.reachable(f).has(key(6, 1))).toBe(false);
    expect(game.move(f, 6, 2)).toBeNull();
    g.x = 7; g.z = 3;
    w.x = 5; w.z = 1; // a friend there: walk through it, but not stop on it
    expect(game.reachable(f).has(key(6, 1))).toBe(true);
    expect(game.canEndOn(f, 5, 1)).toBe(false);
  });

  it('the Cistern Stair has two stairways, its exit in the lower hall, and a foe on each floor', () => {
    const level = levelById('cistern');
    const g = new Grid(level.rows);
    expect(g.stairways).toHaveLength(2);
    expect(g.lower.has(key(g.stairs[0].x, g.stairs[0].z))).toBe(true);
    const spawns = g.spawns.filter((s) => /[a-z]/.test(s.code));
    expect(spawns.some((s) => g.lower.has(key(s.x, s.z)))).toBe(true);
    expect(spawns.some((s) => !g.lower.has(key(s.x, s.z)))).toBe(true);
    expect(g.spawns.filter((s) => /[A-Z]/.test(s.code)).every((s) => !g.lower.has(key(s.x, s.z)))).toBe(true);
  });
});
