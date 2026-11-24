import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { applyCommand, unitRef } from '../src/game/replay.js';

/** Brannoc with two flasks and a bag of caltrops, an orc 3 tiles off, on Brannoc's turn. */
function fight(rng = () => 0.99, rules) {
  const party = { F: { level: 3, hp: 30, items: [], potions: 0, flasks: 2, caltrops: 1 } };
  const g = new Game(['#########', '#F...o..#', '#.......#', '#########'], { senses: false, rng, party, ...(rules && { rules }) });
  g.start();
  const f = g.units.find((u) => u.cls === 'Fighter');
  const o = g.units.find((u) => u.team === 'monsters');
  o.x = 4;
  while (g.current !== f) g.endTurn();
  return { g, f, o };
}

describe('alchemist’s fire (rules 6)', () => {
  it('a hit burns now and sets the foe burning until a DEX save puts it out', () => {
    const { g, f, o } = fight();
    const hp = o.hp;
    const r = applyCommand(g, { type: 'flask', target: unitRef(g, o) });
    expect(r).toMatchObject({ ok: true, hit: true });
    expect(o.hp).toBe(hp - r.damage);
    expect(g.has(o, 'burning')).toBe(true);
    expect(f.flasks).toBe(1);
    expect(f.actionUsed).toBe(true);
    g.endTurn();
    while (g.current !== o) g.endTurn();
    const before = o.hp;
    const flames = [];
    g.on('aflame', (e) => flames.push(e));
    g.endTurn(); // the orc's turn ends: it burns, then saves (a 20) and puts it out
    expect(flames).toHaveLength(1);
    expect(o.hp).toBe(before - flames[0].damage);
    expect(g.has(o, 'burning')).toBe(false);
  });

  it('needs a flask, a foe within 20 ft and a clear throw', () => {
    const { g, f, o } = fight();
    o.x = 7;
    expect(g.flaskProblem(f, o)).toBe('Too far: 20 ft at most');
    o.x = 4;
    f.flasks = 0;
    expect(g.flaskProblem(f, o)).toBe('No flasks left');
  });

  it('is refused under rules 5', () => {
    const { g, f, o } = fight(() => 0.99, 5);
    expect(g.flaskProblem(f, o)).toBe('This fight began before flasks');
  });
});

describe('caltrops (rules 6)', () => {
  it('stop a foe that fails its save, with 1 piercing, and the party walks round them', () => {
    const { g, f, o } = fight(() => 0.05);
    const r = applyCommand(g, { type: 'caltrops', x: 3, z: 1 });
    expect(r.ok).toBe(true);
    expect(f.caltrops).toBe(0);
    expect(g.passableFor(f)(3, 1)).toBe(false);
    g.endTurn();
    while (g.current !== o) g.endTurn();
    o.x = 4; o.z = 1;
    const hp = o.hp;
    const m = g.move(o, 2, 1);
    expect(m.steps.some((s) => s.type === 'caltrops' && !s.result.success)).toBe(true);
    expect([o.x, o.z]).toEqual([3, 1]);
    expect(o.hp).toBe(hp - 1);
    expect(o.movesLeft).toBe(0);
  });

  it('go only on open floor within 10 ft', () => {
    const { g, f } = fight();
    expect(g.caltropProblem(f, 0, 1)).toBe('Pick an open floor tile');
    expect(g.caltropProblem(f, 5, 1)).toBe('Too far: 10 ft at most');
    expect(g.caltropProblem(f, 3, 2)).toBe(null);
  });

  it('ride with the party record only while carried', () => {
    const { g, f } = fight();
    f.flasks = 0;
    const p = g.partyState().F;
    expect(p.flasks).toBeUndefined();
    expect(p.caltrops).toBe(1);
  });
});
