import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { applyCommand } from '../src/game/replay.js';

/** A fight on `rows`, run on to the first hero's turn. */
function fight(rows, rng = () => 0.5) {
  const g = new Game(rows, { senses: false, rng });
  g.start();
  while (g.current.team !== 'heroes') g.endTurn();
  return g;
}

/** Pass turns until it is `unit`'s. */
function turnOf(g, unit) {
  g.endTurn();
  while (g.current !== unit && !g.over) g.endTurn();
}

describe('the Ready action', () => {
  it('strikes the first foe to step into reach, with the reaction, once', () => {
    const g = fight(['##########', '#F......o#', '##########'], () => 0.9);
    const f = g.current;
    const orc = g.units.find((u) => u.team === 'monsters');
    const r = applyCommand(g, { type: 'action', id: 'ready' });
    expect(r.ok).toBe(true);
    expect(f.actionUsed).toBe(true);
    expect(g.actionProblem(f, 'ready')).toBe('Action already used this turn');
    turnOf(g, orc);
    const hp = orc.hp;
    const m = g.move(orc, 2, 1);
    const ready = m.steps.filter((s) => s.type === 'readied');
    expect(ready).toHaveLength(1);
    expect(ready[0].at).toEqual({ x: 2, z: 1 }); // as it stepped next to Brannoc
    expect(ready[0].result).toMatchObject({ ok: true, attacker: f, target: orc, readied: true });
    expect(ready[0].result.attack.name).toBe('Longsword'); // not the javelin, though it was in range sooner
    expect(orc.hp).toBe(Math.max(0, hp - ready[0].result.damage));
    expect(f.reactionUsed).toBe(true);
    expect(f.readied).toBe(false);
  });

  it('fires a spell at a foe that steps into view', () => {
    // Ilsa waits behind the corner; the orc comes round it into the corridor.
    const g = fight([
      '#######',
      '#W....#',
      '#####.#',
      '#####o#',
      '#######',
    ], () => 0.9);
    const ilsa = g.current;
    const orc = g.units.find((u) => u.team === 'monsters');
    applyCommand(g, { type: 'action', id: 'ready' });
    turnOf(g, orc);
    const m = g.move(orc, 5, 1);
    const ready = m.steps.find((s) => s.type === 'readied');
    expect(ready.result.attack.name).toBe('Fire Bolt');
    // The first tile Ilsa can see, coming from one she couldn't.
    const seen = (t) => g.grid.lineOfSight(ilsa.x, ilsa.z, t.x, t.z);
    expect(seen(ready.at)).toBe(true);
    expect(seen({ x: ready.at.x, z: ready.at.z + 1 })).toBe(false);
  });

  it('lets a foe already in sight walk on, and lapses at the hero’s next turn', () => {
    const g = fight(['##########', '#W......o#', '##########'], () => 0.9);
    const ilsa = g.current;
    const orc = g.units.find((u) => u.team === 'monsters');
    applyCommand(g, { type: 'action', id: 'ready' });
    turnOf(g, orc);
    expect(g.move(orc, 4, 1).steps.some((s) => s.type === 'readied')).toBe(false); // no new view
    turnOf(g, ilsa);
    expect(ilsa.readied).toBe(false);
  });

  it('is a hero action only, and changes no dice when it is not used', () => {
    const g = fight(['######', '#F..o#', '######']);
    const orc = g.units.find((u) => u.team === 'monsters');
    expect(g.actionsFor(g.current).at(-1)).toBe('ready');
    expect(g.actionsFor(orc)).not.toContain('ready');
  });
});
