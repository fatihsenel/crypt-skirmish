import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { seeded } from '../src/game/dice.js';
import { key } from '../src/game/grid.js';
import { levelById } from '../src/game/maps.js';
import { dailyCampaign } from '../src/game/daily.js';
import { DIFFICULTIES } from '../src/game/campaign.js';

// A plain hall: a tower two steps up in the north-east corner, a ladder to it, a step west of it.
const HALL = {
  id: 'test-heights',
  rows: [
    '##########',
    '#F.......#',
    '#........#',
    '#........#',
    '#.......g#',
    '##########',
  ],
  heights: [[6, 1, 8, 2, 2], [5, 1, 5, 2, 1]],
  ladders: [[7, 3, 7, 2]],
};

function game(level = HALL, rules = 12) {
  const party = dailyCampaign({ level: 3, classes: {} }).party;
  const g = new Game(level, { party, difficulty: DIFFICULTIES.normal, rng: seeded(3), rules });
  return g;
}
const unit = (g, code) => g.units.find((u) => u.code === code);
const put = (u, x, z) => { u.x = x; u.z = z; };

describe('heights (rules 12)', () => {
  it('keep heights to rules 12', () => {
    expect(game(HALL, 11).grid.heights.size).toBe(0);
    const g = game();
    expect(g.grid.heightAt(7, 1)).toBe(2);
    expect(g.grid.heightAt(5, 2)).toBe(1);
    expect(g.grid.heightAt(4, 2)).toBe(0);
  });

  it('make a rise of two steps a cliff, except up a ladder', () => {
    const g = game();
    const n = (x, z) => [...g.grid.neighbors(x, z)].map(([a, b]) => key(a, b));
    expect(n(6, 3)).not.toContain(key(6, 2)); // a cliff
    expect(n(7, 3)).toContain(key(7, 2)); // the ladder
    expect(n(7, 2)).toContain(key(7, 3)); // both ways
    expect(n(4, 1)).toContain(key(5, 1)); // a step
    expect(n(5, 1)).toContain(key(6, 1)); // and another
  });

  it('charge a tile more for each step climbed', () => {
    const g = game();
    const cost = g.moveCost(unit(g, 'F'));
    expect(cost(5, 1, 4, 1)).toBe(2);
    expect(cost(7, 2, 7, 3)).toBe(3); // two steps up the ladder
    expect(cost(7, 3, 7, 2)).toBe(1); // down costs nothing more
  });

  it('let raised ground hide what lies beyond it, but not a low step', () => {
    const g = game();
    expect(g.grid.lineOfSight(8, 4, 3, 4)).toBe(true); // over nothing
    expect(g.grid.lineOfSight(8, 4, 8, 1)).toBe(true); // onto the tower
    expect(g.grid.lineOfSight(4, 1, 8, 3)).toBe(false); // the tower stands between, two steps over both
    expect(g.grid.lineOfSight(3, 1, 7, 1)).toBe(true); // looking up at it
    expect(game(HALL, 11).grid.lineOfSight(4, 1, 8, 3)).toBe(true);
  });

  it('refuse a melee blow across a cliff, but not a shot or a flier', () => {
    const g = game();
    const f = unit(g, 'F');
    const gob = unit(g, 'g');
    put(f, 6, 3);
    put(gob, 6, 2);
    const sword = f.attacks.find((a) => a.reach === 1);
    expect(g.attackProblem(f, gob, sword)).toMatch(/Too far above/);
    expect(g.shoveProblem(f, gob, true)).toMatch(/Too far above/);
    gob.flies = true;
    expect(g.attackProblem(f, gob, sword) ?? '').not.toMatch(/Too far above/);
  });

  it('give high ground to a shot from any step higher', () => {
    const g = game();
    const gob = unit(g, 'g');
    const f = unit(g, 'F');
    put(gob, 7, 1);
    put(f, 3, 3);
    const bow = gob.attacks.find((a) => a.reach > 1);
    expect(g.attackMods(gob, f, bow).adv).toContain('high ground');
  });

  it('drop a creature pushed off a cliff 1d6 a step, and stop a push up against one', () => {
    const g = game();
    const f = unit(g, 'F');
    const gob = unit(g, 'g');
    put(f, 6, 1);
    put(gob, 6, 2);
    expect(g.pushTo(f, gob)).toMatchObject({ x: 6, z: 3, drop: true, steps: 2 });
    put(f, 6, 4);
    put(gob, 6, 3);
    expect(g.pushTo(f, gob).why).toMatch(/No room/);
    const r = g.tumble(gob, f, 'ledge', 2);
    expect(r.roll.rolls ?? r.roll.dice).toBeTruthy();
    expect(r.steps).toBe(2);
  });

  it('leave every tile of the rooms with heights reachable on foot or by ladder', () => {
    for (const id of ['warren', 'gallery', 'bridge', 'crypt']) {
      const g = game(levelById(id));
      expect(g.grid.heights.size).toBeGreaterThan(0);
      const from = g.units.find((u) => u.team === 'heroes');
      const walked = g.grid.flood(from.x, from.z, Infinity, (x, z) => !g.grid.isSolid(x, z));
      for (let z = 0; z < g.grid.height; z++) {
        for (let x = 0; x < g.grid.width; x++) {
          if (!g.grid.isSolid(x, z)) expect(walked.has(key(x, z)), `${id} ${x},${z}`).toBe(true);
        }
      }
    }
  });
});
