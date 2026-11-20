import { describe, it, expect } from 'vitest';
import { Game, ELITE_TRAITS, eliteTrait, isMelee } from '../src/game/combat.js';
import { seeded } from '../src/game/dice.js';
import { levelById } from '../src/game/maps.js';
import { NODES, newCampaign, runDifficulty, completeFight, recordDefeat, runSummary, runShareText, roomElite } from '../src/game/campaign.js';
import { runRecord } from '../src/game/history.js';

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

  it('have six traits', () => {
    expect(ELITE_TRAITS.map((t) => t.id)).toEqual(['regenerating', 'relentless', 'frenzied', 'swift', 'warded', 'barbed']);
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

  it('cut a foe that hits them with a melee weapon when barbed, by 3 and no roll', () => {
    const g = room(0);
    const [m] = monsters(g);
    const fighter = g.units.find((u) => u.code === 'F');
    const wizard = g.units.find((u) => u.code === 'W');
    g.makeElite(m, 'barbed');
    m.hp = m.maxHp = 500;
    fighter.x = m.x + 1; fighter.z = m.z;
    const swing = (who, foe, a) => { who.actionUsed = false; return g.attack(who, foe, a); }; // a fresh action each time
    const seen = [];
    g.on('barbs', (r) => seen.push(r));
    const sword = fighter.attacks.find((a) => a.reach === 1);
    g.rng = () => 0.99; // every swing hits
    const hp = fighter.hp;
    const r = swing(fighter, m, sword);
    expect(r.hit).toBe(true);
    expect(r.barbs).toEqual({ unit: m, target: fighter, damage: 3 });
    expect(fighter.hp).toBe(hp - 3);
    expect(seen).toHaveLength(1);
    expect(g.blows.at(-1)).toMatchObject({ to: fighter.name, by: m.name, how: 'barbs', via: 'melee', damage: 3 });
    // A miss, a spell attack or a ranged one: no barbs.
    g.rng = () => 0;
    expect(swing(fighter, m, sword).barbs).toBeNull();
    g.rng = () => 0.99;
    const bolt = wizard.attacks.find((a) => !isMelee(a));
    wizard.x = m.x - 1; wizard.z = m.z;
    expect(swing(wizard, m, bolt).barbs).toBeNull();
    // Nor from an ordinary monster.
    const [, plain] = monsters(g);
    fighter.x = plain.x + 1; fighter.z = plain.z;
    expect(swing(fighter, plain, sword).barbs).toBeNull();
  });

  it('can drop the hero who strikes a barbed elite, ending their attacks', () => {
    const g = room(0);
    const [m] = monsters(g);
    const fighter = g.units.find((u) => u.code === 'F');
    g.makeElite(m, 'barbed');
    m.hp = m.maxHp = 500;
    fighter.x = m.x + 1; fighter.z = m.z;
    fighter.hp = 2;
    g.rng = () => 0.99;
    const r = g.attack(fighter, m, fighter.attacks.find((a) => a.reach === 1));
    expect(r.barbs.damage).toBe(3);
    expect(fighter.alive).toBe(false);
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

describe('elites in the run summary', () => {
  const won = (state, node, tier) => {
    const g = new Game(levelById(NODES[node].level), { party: state.party, difficulty: runDifficulty('normal', tier) });
    for (const m of g.units) if (m.team === 'monsters') m.alive = false;
    return completeFight(state, node, g).state;
  };

  it('counts the elites slain in won rooms, by trait', () => {
    let state = { ...newCampaign(), tier: 4 };
    state = won(state, 'crypt', 4); // the crypt's NG+4 elite is Barbed
    expect(state.stats.elites).toEqual({ barbed: 1 });
    state = won(state, 'crypt', 4);
    state = won(state, 'sanctum', 2); // the sanctum's NG+2 elite is Regenerating
    expect(state.stats.elites).toEqual({ barbed: 2, regenerating: 1 });
    const s = runSummary(state);
    expect(s.eliteCount).toBe(3);
    expect(s.elites).toEqual([{ id: 'regenerating', name: 'Regenerating', count: 1 }, { id: 'barbed', name: 'Barbed', count: 2 }]);
    expect(runShareText(s).split('\n')[1]).toMatch(/, 3 elites slain$/);
    expect(runRecord(state, 'won', 1).elites).toBe(3);
  });

  it('has none below NG+2, after a loss, or in a save from before', () => {
    const state = won(newCampaign(), 'crypt', 0);
    expect(state.stats.elites).toBeUndefined();
    const lost = new Game(levelById('crypt'), { party: state.party, difficulty: runDifficulty('normal', 4) });
    expect(recordDefeat(state, lost).stats.elites).toBeUndefined();
    const s = runSummary({ ...state, stats: { ...state.stats, elites: { relentless: 'x', nonsense: 2 } } });
    expect(s.eliteCount).toBe(0);
    expect(s.elites).toEqual([]);
    expect(runShareText(s)).not.toMatch(/elite/);
    expect(runRecord(state, 'won', 1).elites).toBeUndefined();
  });
});

describe('elites on the camp map', () => {
  it('names the trait each fight room will have, from New Game+ 2', () => {
    expect(roomElite('crypt', 1)).toBeNull();
    expect(roomElite('crypt', 4).id).toBe('barbed');
    expect(roomElite('sanctum', 2).id).toBe('regenerating');
    const rest = Object.keys(NODES).find((id) => NODES[id].kind === 'rest');
    expect(roomElite(rest, 3)).toBeNull();
    expect(roomElite('nowhere', 3)).toBeNull();
  });

  it('matches the elite the fight then has', () => {
    for (const node of Object.keys(NODES).filter((id) => NODES[id].kind !== 'rest')) {
      const g = room(3, 1, node);
      expect(elites(g).map((u) => u.elite)).toEqual([roomElite(node, 3).id]);
    }
  });
});
