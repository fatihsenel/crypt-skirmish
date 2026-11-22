import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { key } from '../src/game/grid.js';
import { LEVELS } from '../src/game/maps.js';
import { applyCommand } from '../src/game/replay.js';

/** A fight on `rows`, run on to the first hero's turn. */
function fight(rows, rng = () => 0.5) {
  const g = new Game(rows, { senses: false, rng });
  g.start();
  while (g.current.team !== 'heroes') g.endTurn();
  return g;
}

describe('a lever and its portcullis', () => {
  const rows = [
    '#########',
    '#F!.....#',
    '#.......#',
    '####:####',
    '#......o#',
    '#########',
  ];

  it('drops the portcullis: no way through, but the bars hide nothing and give half cover', () => {
    const g = fight(rows);
    const f = g.current;
    const orc = g.units.find((u) => u.team === 'monsters');
    expect(g.grid.isSolid(4, 3)).toBe(false);
    const r = applyCommand(g, { type: 'lever', x: 2, z: 1 });
    expect(r).toMatchObject({ ok: true, down: true });
    expect(g.grid.gates.get(key(4, 3)).down).toBe(true);
    expect(g.grid.isSolid(4, 3)).toBe(true);
    expect(g.grid.blocksSight(4, 3)).toBe(false);
    expect(f.interacted).toBe(true);
    expect(f.actionUsed).toBe(false); // a free interaction, like a chest
    expect(g.leverProblem(f, 2, 1)).toBe('Already interacted with something this turn');
    // The orc can't reach the heroes' side any more.
    orc.x = 4; orc.z = 4;
    expect([...g.reachable({ ...orc, movesLeft: 20 }).values()].some((t) => t.z < 3)).toBe(false);
    // Shooting through the bars: half cover.
    f.x = 4; f.z = 1;
    expect(g.coverBonus(f, orc)).toBe(2);
  });

  it('raises it again, and won’t drop it on anyone', () => {
    const g = fight(rows);
    const f = g.current;
    const orc = g.units.find((u) => u.team === 'monsters');
    orc.x = 4; orc.z = 3;
    expect(g.leverProblem(f, 2, 1)).toBe('Someone stands under the portcullis');
    orc.x = 7; orc.z = 4;
    applyCommand(g, { type: 'lever', x: 2, z: 1 });
    f.interacted = false;
    expect(applyCommand(g, { type: 'lever', x: 2, z: 1 })).toMatchObject({ ok: true, down: false });
    expect(g.grid.isSolid(4, 3)).toBe(false);
  });

  it('is pulled from next to it, by a hero', () => {
    const g = fight(rows);
    const f = g.current;
    const orc = g.units.find((u) => u.team === 'monsters');
    f.x = 5;
    expect(g.leverProblem(f, 2, 1)).toBe('Move next to the lever to pull it');
    expect(g.leverProblem(f, 3, 1)).toBe('No lever here');
    expect(g.leverProblem(orc, 2, 1)).toBe('Only heroes work the levers');
  });

  it('hangs in the Black Armory', () => {
    const g = new Game(LEVELS.find((l) => l.name === 'The Black Armory'), { senses: false, rng: () => 0.5 });
    expect(g.grid.gates.size).toBe(3);
    expect([...g.grid.props.values()].filter((p) => p.kind === 'lever')).toHaveLength(1);
  });
});
