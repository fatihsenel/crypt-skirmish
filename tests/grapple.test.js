import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { applyCommand, unitRef } from '../src/game/replay.js';

/** Brannoc next to an orc, Maela next to Brannoc, on Brannoc's turn. */
function fight(rng = () => 0.5, rules) {
  const g = new Game(['########', '#F.o...#', '#C.....#', '########'], { senses: false, rng, ...(rules && { rules }) });
  g.start();
  const f = g.units.find((u) => u.cls === 'Fighter');
  const c = g.units.find((u) => u.cls === 'Cleric');
  const orc = g.units.find((u) => u.team === 'monsters');
  f.x = 2;
  c.x = 2; c.z = 2;
  while (g.current !== f) g.endTurn();
  return { g, f, c, orc };
}

describe('giving a potion', () => {
  it('heals an ally next to you from your own potions, with your action', () => {
    const { g, f, c } = fight();
    c.hp = 5;
    const r = applyCommand(g, { type: 'feed', target: unitRef(g, c) });
    expect(r).toMatchObject({ ok: true, unit: f, target: c });
    expect(c.hp).toBe(5 + r.healed);
    expect(r.healed).toBe(r.roll.total);
    expect(f.potions).toBe(0);
    expect(f.actionUsed).toBe(true);
    expect(g.feedProblem(f, c)).toBe('No potions left');
  });

  it('needs a hurt ally next to you, under rules 5', () => {
    const { g, f, c, orc } = fight(() => 0.5, 5);
    expect(g.feedProblem(f, c)).toBe('Maela is at full HP');
    expect(g.feedProblem(f, orc)).toBe('Choose an ally next to you');
    expect(g.feedProblem(f, f)).toBe('Choose an ally next to you');
    c.hp = 5;
    c.z = 1; c.x = 4; // not next to Brannoc any more (2 tiles off)
    expect(g.feedProblem(f, c)).toBe('Must stand next to them');
  });

  it('can be tossed to an ally up to 15 ft away in sight, from rules 6', () => {
    const { g, f, c, orc } = fight();
    expect(g.feedProblem(f, orc)).toBe('Choose an ally within 15 ft');
    c.hp = 5;
    c.z = 2; c.x = 5; // 3 tiles off
    expect(g.feedProblem(f, c)).toBe(null);
    c.x = 6; // 4 tiles off
    expect(g.feedProblem(f, c)).toBe('Too far: 15 ft at most');
    c.x = 5;
    const r = applyCommand(g, { type: 'feed', target: unitRef(g, c) });
    expect(r).toMatchObject({ ok: true, thrown: true });
    expect(c.hp).toBe(5 + r.healed);
  });

  it('a tossed potion brings a dying ally back up', () => {
    const { g, f, c } = fight();
    c.x = 4; c.z = 2;
    c.hp = 0; c.alive = false; c.dying = { successes: 0, failures: 2, stable: false };
    expect(g.feedProblem(f, c)).toBe(null);
    const r = applyCommand(g, { type: 'feed', target: unitRef(g, c) });
    expect(r.ok).toBe(true);
    expect(c.alive).toBe(true);
    expect(c.hp).toBeGreaterThan(0);
  });

  it('needs a clear throw past 5 ft', () => {
    const g = new Game(['#######', '#F#C..#', '#.....#', '#######'], { senses: false, rng: () => 0.5 });
    g.start();
    const f = g.units.find((u) => u.cls === 'Fighter');
    const c = g.units.find((u) => u.cls === 'Cleric');
    while (g.current !== f) g.endTurn();
    c.hp = 5;
    c.x = 4; c.z = 1; // behind the wall from Brannoc at (1,1)
    expect(g.feedProblem(f, c)).toBe('No clear throw');
  });
});

describe('Ready with a chosen attack', () => {
  it('holds the attack picked, and the first one when none is', () => {
    const { g, f } = fight();
    const r = applyCommand(g, { type: 'action', id: 'ready', attack: 1 });
    expect(r.attack.name).toBe('Javelin');
    expect(g.readyWeapon(f).name).toBe('Javelin');
    g.endTurn();
    while (g.current !== f) g.endTurn();
    expect(g.readyWeapon(f).name).toBe('Longsword'); // the pick lapses with the Ready
  });
});

describe('grappling', () => {
  it('holds a foe in place until it breaks free', () => {
    const { g, f, orc } = fight(() => 0.99); // Brannoc rolls 20s; so does everyone
    const r = applyCommand(g, { type: 'grapple', target: unitRef(g, orc) });
    expect(r.ok).toBe(true);
    expect(r.success).toBe(true); // 20 + 5 against the orc's 20 + 3
    expect(f.actionUsed).toBe(true);
    expect(orc.grappledBy).toBe(f);
    const tries = [];
    g.on('struggle', (s) => tries.push(s));
    g.endTurn();
    while (g.current !== orc) g.endTurn();
    expect(tries).toHaveLength(1);
    expect(tries[0].success).toBe(false); // it tried at the start of its turn, and lost
    expect(orc.movesLeft).toBe(0);
    expect(g.reachable(orc).size).toBe(1);
  });

  it('ends when the grappler walks off or falls', () => {
    const { g, f, orc } = fight(() => 0.99);
    f.grappling = orc;
    orc.grappledBy = f;
    expect(g.held(orc)).toBe(true);
    const ends = [];
    g.on('grappleEnd', (e) => ends.push(e.why));
    g.move(f, 1, 2); // two tiles from the orc
    expect(orc.grappledBy).toBe(null);
    f.grappling = orc;
    orc.grappledBy = f;
    f.x = 2; f.z = 1;
    g.applyDamage(f, 999, orc);
    expect(orc.grappledBy).toBe(null);
    expect(ends).toEqual(['let go', 'fell']);
  });

  it('is a hero thing, and not for huge foes', () => {
    const { g, f, orc } = fight();
    expect(g.grappleProblem(orc, f)).toBe('Only heroes grapple');
    orc.huge = true;
    expect(g.grappleProblem(f, orc)).toBe('Orc is too big to grapple'.replace('Orc', orc.name));
  });
});
