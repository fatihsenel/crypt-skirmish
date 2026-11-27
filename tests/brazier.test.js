import { describe, it, expect } from 'vitest';
import { Game, SPILL_DC } from '../src/game/combat.js';
import { Grid, key } from '../src/game/grid.js';
import { LEVELS } from '../src/game/maps.js';
import { applyCommand } from '../src/game/replay.js';

/** A fight on `rows`, run on to the first hero's turn. */
function fight(rows, rng = () => 0.5) {
  const g = new Game(rows, { senses: false, rng });
  g.start();
  while (g.current.team !== 'heroes') g.endTurn();
  return g;
}

describe('shallow water', () => {
  it('costs double to wade through, but not for fliers', () => {
    const g = fight(['#########', '#F~~~..o#', '#########']);
    const f = g.current;
    const reach = g.reachable(f); // 6 squares: 3 of water cost 6
    expect(reach.get(key(4, 1)).dist).toBe(6);
    expect(reach.has(key(5, 1))).toBe(false);
    expect(g.moveCost({ flies: true })).toBe(null);
  });

  it('leaves rooms without water, ice, (rules 11) ledges or (rules 12) heights on the plain paths', () => {
    for (const level of LEVELS) {
      const g = new Game(level, { senses: false, rng: () => 0.5 });
      expect(g.moveCost() === null).toBe(!new Grid(level.rows).water.size && !level.high && !level.heights);
      expect(new Game(level, { senses: false, rng: () => 0.5, rules: 10 }).moveCost() === null).toBe(!new Grid(level.rows).water.size);
    }
  });
});

describe('a brazier', () => {
  const rows = ['########', '#F*.o..#', '#......#', '########'];

  it('spills its coals past it, away from the hero, and burns who stands there', () => {
    const g = fight(rows, () => 0.1); // low rolls: the orc fails its save
    const f = g.current;
    const orc = g.units.find((u) => u.team === 'monsters');
    orc.x = 3; // right past the brazier
    const hp = orc.hp;
    const r = applyCommand(g, { type: 'brazier', x: 2, z: 1 });
    expect(r.ok).toBe(true);
    expect(r.tiles.map((t) => key(t.x, t.z)).sort()).toEqual(['3,1', '3,2']); // 3,0 is a wall
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]).toMatchObject({ unit: orc, dc: SPILL_DC, success: false });
    expect(orc.hp).toBe(Math.max(0, hp - r.hits[0].damage));
    expect(g.tally(f).damage).toBe(hp - orc.hp); // the tipper is credited
    expect(f.actionUsed).toBe(true);
    expect(g.brazierProblem(f, 2, 1)).toBe('The brazier is already on its side');
  });

  it('needs a hero next to it with an action left', () => {
    const g = fight(['########', '#F.*o..#', '########']);
    const f = g.current;
    expect(g.brazierProblem(f, 3, 1)).toBe('Move next to the brazier to tip it');
    expect(g.brazierProblem(f, 1, 1)).toBe('Nothing to tip over here');
    f.x = 2;
    f.actionUsed = true;
    expect(g.brazierProblem(f, 3, 1)).toBe('Action already used this turn');
  });

  it('burns whoever walks onto the coals, once a turn, and the party walks around them', () => {
    const g = fight(rows, () => 0.9);
    const f = g.current;
    const orc = g.units.find((u) => u.team === 'monsters');
    orc.x = 6;
    applyCommand(g, { type: 'brazier', x: 2, z: 1 });
    expect(g.reachable(f).has(key(3, 2))).toBe(false); // coals: not a way for heroes
    g.endTurn();
    while (g.current !== orc) g.endTurn();
    const hp = orc.hp;
    const r = g.move(orc, 3, 1);
    const burns = r.steps.filter((s) => s.type === 'burn');
    expect(burns).toHaveLength(1);
    expect(orc.hp).toBe(hp - burns[0].result.damage);
    expect(orc.burnTurn).toBe(g.turnId());
  });

  it('goes out at the end of the tipper’s third turn', () => {
    const g = fight(rows);
    const f = g.current;
    applyCommand(g, { type: 'brazier', x: 2, z: 1 });
    for (let turns = 0; turns < 3; turns++) {
      expect(g.burningTiles().size).toBe(2);
      g.endTurn();
      while (g.current !== f && !g.over) g.endTurn();
    }
    expect(g.burningTiles().size).toBe(0);
  });
});
