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
    for (const l of LEVELS.filter((r) => !['cistern', 'undercroft'].includes(r.id))) {
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

  it('rules 5: a foe pushed into a stairwell tumbles down to the foot, hurt and prone', () => {
    // The fighter at (1,1) pushes the goblin at (2,1) east, onto the stair down at (3,1).
    const game = new Game(['#########', '#Fg[#]..#', '#...#...#', '#########'], { rng: () => 0.99 });
    game.start();
    const f = game.units.find((u) => u.team === 'heroes');
    const g = game.units.find((u) => u.team === 'monsters');
    setTurn(game, game.units.indexOf(f));
    expect(game.pushTo(f, g)).toEqual({ x: 5, z: 1, fall: false, tumble: { x: 3, z: 1 } });
    const hp = g.hp;
    const r = game.shove(f, g, true);
    expect(r.success).toBe(true);
    expect(r.push).toMatchObject({ to: { x: 5, z: 1 }, stair: { x: 3, z: 1 } });
    expect([g.x, g.z]).toEqual([5, 1]);
    expect(hp - g.hp).toBe(r.push.tumble.damage);
    if (g.alive) expect(game.has(g, 'prone')).toBe(true);
  });

  it('rules 5: a foe already on the stair down tumbles whichever way it is pushed', () => {
    const game = new Game(['#########', '#..[#]..#', '#.F.#.g.#', '#########'], { rng: () => 0.99 });
    game.start();
    const [f, g] = game.units;
    g.x = 3; g.z = 1; // on the stair; a push from (2,2) points into the wall at (4,0)
    expect(game.pushTo(f, g)).toMatchObject({ x: 5, z: 1, tumble: { x: 3, z: 1 } });
  });

  it('rules 5: no tumble with someone at the foot, for a flier, or under older rules', () => {
    const rows = ['#########', '#Fg[#]g.#', '#...#...#', '#########'];
    const old = new Game(rows, { rules: 4 });
    old.start();
    expect(old.pushTo(old.units[0], old.units[1])).toEqual({ x: 3, z: 1, fall: false });
    const game = new Game(rows);
    game.start();
    const [f, g, other] = game.units;
    g.flies = true;
    expect(game.pushTo(f, g).tumble).toBeUndefined();
    g.flies = false;
    expect(game.pushTo(f, g).tumble).toEqual({ x: 3, z: 1 });
    other.x = 5; other.z = 1; // someone at the foot of the stairs
    expect(game.pushTo(f, g)).toEqual({ x: 3, z: 1, fall: false });
  });

  it('rules 5: a ghoul lurks on its own floor until a hero comes down or it is hurt', () => {
    const rows = ['#########', '#F.[#]..#', '#...#...#', '#...#.u.#', '#########'];
    const up = (game) => {
      const u = game.units.find((x) => x.code === 'u');
      setTurn(game, game.units.indexOf(u));
      u.unaware = false;
      return [u, [...game.reachable(u).values()].some((n) => !game.grid.lower.has(key(n.x, n.z)))];
    };
    const game = new Game(rows, { rng: () => 0.5 });
    game.start();
    const [u, climbs] = up(game);
    expect(climbs).toBe(false); // waits below
    expect(game.reachable(u).has(key(5, 1))).toBe(true); // at the foot of the stairs, at most
    game.applyDamage(u, 1, null);
    expect(up(game)[1]).toBe(true); // hurt: it comes up
    const old = new Game(rows, { rng: () => 0.5, rules: 4 });
    old.start();
    expect(up(old)[1]).toBe(true); // older rules: no lurking
    const down = new Game(rows, { rng: () => 0.5 });
    down.start();
    const f = down.units.find((x) => x.code === 'F');
    f.x = 6; f.z = 1; // a hero sets foot below
    expect(down.lurking(down.units.find((x) => x.code === 'u'))).toBe(false);
  });

  it('the Undercroft: stairs that cross, its exit and lurkers below, its gargoyles above', () => {
    const g = new Grid(levelById('undercroft').rows);
    expect(g.stairways).toEqual([{ down: { x: 6, z: 1 }, up: { x: 1, z: 7 } }, { down: { x: 14, z: 1 }, up: { x: 13, z: 7 } }]);
    expect(g.lower.has(key(g.stairs[0].x, g.stairs[0].z))).toBe(true);
    const below = g.spawns.filter((s) => g.lower.has(key(s.x, s.z))).map((s) => s.code).sort();
    expect(below).toEqual(['u', 'z', 'z']);
    expect(g.spawns.filter((s) => /[A-Z]/.test(s.code)).every((s) => !g.lower.has(key(s.x, s.z)))).toBe(true);
  });
});
