import { describe, it, expect } from 'vitest';
import { Game, ELITE_TRAITS, eliteTrait } from '../src/game/combat.js';
import { seeded } from '../src/game/dice.js';
import { levelById } from '../src/game/maps.js';
import { NODES, newCampaign, runDifficulty } from '../src/game/campaign.js';

const room = (tier, seed = 1, node = 'crypt') => {
  const level = levelById(NODES[node].level);
  return new Game(level, { party: newCampaign().party, difficulty: runDifficulty('normal', tier), rng: seeded(seed) });
};
const monsters = (g) => g.units.filter((u) => u.team === 'monsters' && !u.corpse);
const elites = (g) => g.units.filter((u) => u.elite);

describe('elite monsters', () => {
  it('come with New Game+ 2 and deeper', () => {
    expect(runDifficulty('normal', 1).elite).toBeUndefined();
    expect(runDifficulty('normal', 2).elite).toBe(2);
    expect(elites(room(0))).toEqual([]);
    expect(elites(room(1))).toEqual([]);
  });

  it('are the strongest monster in the room, the first one on a tie', () => {
    const g = room(2);
    const [e] = elites(g);
    expect(elites(g)).toHaveLength(1);
    const top = Math.max(...monsters(g).map((u) => u.xp));
    expect(e.xp).toBe(top);
    expect(e).toBe(monsters(g).find((u) => u.xp === top));
    expect(e.elite).toBe(eliteTrait(levelById(NODES.crypt.level).id, 2).id);
  });

  it('are the same whatever the dice', () => {
    const a = room(3, 1), b = room(3, 99);
    expect(a.units.findIndex((u) => u.elite)).toBe(b.units.findIndex((u) => u.elite));
    expect(elites(a)[0].elite).toBe(elites(b)[0].elite);
    expect(eliteTrait('x', 2)).not.toBe(eliteTrait('x', 3)); // the trait moves on with the tier
  });

  it('have five traits', () => {
    expect(ELITE_TRAITS.map((t) => t.id)).toEqual(['regenerating', 'relentless', 'frenzied', 'swift', 'warded']);
  });

  it('get what their trait says', () => {
    const g = room(0);
    const [a, b, c, d] = monsters(g);
    const speed = a.speed;
    g.makeElite(a, 'swift');
    expect(a.speed).toBe(speed + 2);
    const swings = b.multiattack ?? 1;
    g.makeElite(b, 'frenzied');
    expect(b.multiattack).toBe(swings + 1);
    const ac = g.acOf(c);
    g.makeElite(c, 'warded');
    expect(g.acOf(c)).toBe(ac + 2);
    expect(c.immune).toEqual(expect.arrayContaining(['frightened', 'prone', 'poisoned']));
    g.makeElite(d, 'relentless');
    expect(d.deathWard).toBe(true);
    expect([a, b, c, d].map((u) => u.elite)).toEqual(['swift', 'frenzied', 'warded', 'relentless']);
  });

  it('regenerate at the start of their turn while alive', () => {
    const g = room(0);
    const [m] = monsters(g);
    g.makeElite(m, 'regenerating');
    const seen = [];
    g.on('regen', (r) => seen.push(r));
    g.start(); // the initiative order
    m.hp = m.maxHp - 8;
    g.turn = g.order.indexOf(m);
    g.beginTurn();
    expect(m.hp).toBe(m.maxHp - 3);
    expect(seen).toEqual([{ unit: m, amount: 5 }]);
    m.hp = m.maxHp - 2;
    g.beginTurn();
    expect(m.hp).toBe(m.maxHp); // not over the top
  });

  it('stand once on 1 HP when relentless', () => {
    const g = room(0);
    const [m] = monsters(g);
    g.makeElite(m, 'relentless');
    const wards = [];
    g.on('ward', (r) => wards.push(r));
    g.applyDamage(m, 999, null);
    expect(m.alive).toBe(true);
    expect(m.hp).toBe(1);
    expect(wards[0].relentless).toBe(true);
    g.applyDamage(m, 999, null);
    expect(m.alive).toBe(false);
  });

  it('can’t be shoved prone or knocked down by a trap when warded', () => {
    const g = room(0);
    const [m] = monsters(g);
    const hero = g.units.find((u) => u.team === 'heroes');
    g.makeElite(m, 'warded');
    hero.x = m.x + 1; hero.z = m.z; // next to it
    expect(g.shoveProblem(hero, m)).toBe(`${m.name} can’t be knocked prone`);
    g.rng = () => 0; // the trap's save fails
    const r = g.springTrap({ x: m.x, z: m.z }, m);
    expect(r.success).toBe(false);
    expect(r.prone).toBe(false);
    expect(g.has(m, 'prone')).toBe(false);
  });
});
