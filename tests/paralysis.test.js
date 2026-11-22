import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';

const seq = (...vals) => () => (vals.length ? vals.shift() : 0.5);
const d20 = (n) => (n - 1) / 20 + 0.001;

function fight(rules) {
  const g = new Game(['########', '#F.u...#', '#......#', '########'], { senses: false, rng: () => 0.5, ...(rules && { rules }) });
  g.start();
  const f = g.units.find((u) => u.code === 'F');
  const ghoul = g.units.find((u) => u.code === 'u');
  ghoul.x = 2;
  f.hp = f.maxHp = 200;
  return { g, f, ghoul };
}

describe('a ghoul’s claws', () => {
  it('paralyse on a failed CON save', () => {
    const { g, f, ghoul } = fight();
    g.turn = g.order.indexOf(ghoul);
    g.beginTurn();
    g.rng = seq(d20(20), 0.5, 0.5, 0.5, 0.5, d20(1)); // a crit (4d4), then the save fails
    const r = g.attack(ghoul, f, ghoul.attacks[0]);
    expect(r.rider).toMatchObject({ condition: 'paralyzed', success: false });
    expect(g.has(f, 'paralyzed')).toBe(true);
    expect(f.reactionUsed).toBe(true);
  });

  it('a paralysed hero: no move or action, fails DEX saves, and a hit next to them is a crit', () => {
    const { g, f, ghoul } = fight();
    g.addCondition(f, 'paralyzed', { turns: 10, by: ghoul, dc: 10 });
    g.turn = g.order.indexOf(f);
    g.rng = () => d20(1); // the save as the turn starts fails
    g.beginTurn();
    expect(f.movesLeft).toBe(0);
    expect(g.attackProblem(f, ghoul, f.attacks[0])).toBeTruthy();
    expect(g.save(f, 'dex', 2)).toMatchObject({ success: false, paralyzed: true });
    expect(g.attackMods(ghoul, f, ghoul.attacks[0]).adv).toContain('target paralyzed');
    g.turn = g.order.indexOf(ghoul);
    g.beginTurn();
    g.rng = seq(d20(15));
    const r = g.attack(ghoul, f, ghoul.attacks[0]);
    expect(r.hit && r.crit).toBe(true);
  });

  it('a CON save as the hero’s turn starts ends it, in time to act', () => {
    const { g, f, ghoul } = fight();
    g.addCondition(f, 'paralyzed', { turns: 10, by: ghoul, dc: 10 });
    g.turn = g.order.indexOf(f);
    g.rng = () => d20(15);
    g.beginTurn();
    expect(g.has(f, 'paralyzed')).toBe(false);
    expect(f.actionUsed).toBe(false);
    expect(f.movesLeft).toBeGreaterThan(0);
  });

  it('still poison under the first rules', () => {
    const { g, f, ghoul } = fight(1);
    g.turn = g.order.indexOf(ghoul);
    g.beginTurn();
    g.rng = seq(d20(20), 0.5, 0.5, 0.5, 0.5, d20(1));
    const r = g.attack(ghoul, f, ghoul.attacks[0]);
    expect(r.rider.condition).toBe('poisoned');
  });
});
