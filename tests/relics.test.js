import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { seeded } from '../src/game/dice.js';
import { levelById } from '../src/game/maps.js';
import { RELICS, relicFrom, cleanRelics } from '../src/game/items.js';
import { NODES, newCampaign, completeFight, newGamePlus, parseSave, serialize, heroUnit } from '../src/game/campaign.js';
import { watchable } from '../src/game/history.js';

const room = (relics = [], node = 'crypt', seed = 1) =>
  new Game(levelById(NODES[node].level), { party: newCampaign().party, rng: seeded(seed), relics });
const heroes = (g) => g.units.filter((u) => u.team === 'heroes' && !u.corpse);
const won = (state, node) => {
  const g = new Game(levelById(NODES[node].level), { party: state.party, relics: state.relics });
  for (const m of g.units) if (m.team === 'monsters') m.alive = false;
  return completeFight(state, node, g);
};

describe('boss relics', () => {
  it('come one from each boss room', () => {
    const bosses = Object.values(NODES).filter((n) => n.boss).map((n) => n.level);
    expect(bosses.map(relicFrom)).toEqual(['phylactery', 'horn', 'veil', 'jar']);
    expect(relicFrom('crypt')).toBeNull();
    expect(Object.values(RELICS).every((r) => r.name && r.desc)).toBe(true);
    expect(cleanRelics(['jar', 'crown', 'horn', 'jar'])).toEqual(['horn', 'jar']);
    expect(cleanRelics('horn')).toEqual([]);
  });

  it('are found when the boss falls, once a run', () => {
    let state = newCampaign();
    expect(state.relics).toEqual([]);
    let r = won(state, 'crypt');
    expect(r.report.relic).toBeNull();
    r = won(r.state, 'sanctum');
    expect(r.report.relic).toBe('phylactery');
    expect(r.state.relics).toEqual(['phylactery']);
    r = won(r.state, 'sanctum');
    expect(r.report.relic).toBeNull();
    expect(r.state.relics).toEqual(['phylactery']);
  });

  it('phylactery: the first hero to drop in a fight stays on 1 HP, once', () => {
    const g = room(['phylactery']);
    const [a, b] = heroes(g);
    const wards = [];
    g.on('ward', (w) => wards.push(w));
    g.applyDamage(a, 999, null);
    expect(a.alive).toBe(true);
    expect(a.hp).toBe(1);
    expect(wards).toEqual([expect.objectContaining({ unit: a, relic: 'phylactery' })]);
    g.applyDamage(b, 999, null);
    expect(b.alive).toBe(false);
    g.applyDamage(a, 999, null);
    expect(a.alive).toBe(false);
    // Monsters get nothing from it, and without it a hero drops.
    const g2 = room(['phylactery']);
    const m = g2.units.find((u) => u.team === 'monsters');
    g2.applyDamage(m, 999, null);
    expect(m.alive).toBe(false);
    const g3 = room();
    const [c] = heroes(g3);
    g3.applyDamage(c, 999, null);
    expect(c.alive).toBe(false);
  });

  it('horn: the heroes take the top of the turn order, in their own order, with the same dice', () => {
    for (const seed of [1, 2, 3, 4]) {
      const plain = room([], 'crypt', seed);
      plain.start();
      const g = room(['horn'], 'crypt', seed);
      g.start();
      const n = heroes(g).length;
      expect(g.order.slice(0, n).every((u) => u.team === 'heroes')).toBe(true);
      expect(g.order.slice(n).every((u) => u.team === 'monsters')).toBe(true);
      const ids = (o, team) => o.filter((u) => u.team === team).map((u) => `${u.slot}${u.x},${u.z}`);
      expect(ids(g.order, 'heroes')).toEqual(ids(plain.order, 'heroes'));
      expect(ids(g.order, 'monsters')).toEqual(ids(plain.order, 'monsters'));
      expect(g.rolls).toBe(plain.rolls);
    }
  });

  it('veil: the party starts hidden at passive Stealth, with no roll', () => {
    const plain = room();
    plain.start();
    const g = room(['veil']);
    g.start();
    expect(g.rolls).toBe(plain.rolls);
    const hidden = heroes(g).filter((h) => h.hidden);
    // The crypt's monsters are far off at the start: nobody sees through it yet.
    expect(hidden.length).toBe(heroes(g).length);
    for (const h of hidden) expect(h.hidden).toBe(10 + g.stealthBonus(h) - (h.noisyArmor ? 5 : 0));
    expect(heroes(plain).some((h) => h.hidden)).toBe(false);
  });

  it('jar: the rest after a room heals fully', () => {
    const hurt = (relics) => {
      const state = { ...newCampaign(), relics };
      const g = new Game(levelById('crypt'), { party: state.party, relics });
      for (const m of g.units) if (m.team === 'monsters') m.alive = false;
      heroes(g)[0].hp = 2;
      return completeFight(state, 'crypt', g).state.party.F.hp;
    };
    const max = heroUnit('F', newCampaign().party.F).maxHp;
    expect(hurt(['jar'])).toBe(max);
    expect(hurt([])).toBeLessThan(max);
  });

  it('are kept in saves, come to old saves from the bosses beaten, and go into New Game+', () => {
    const s = { ...newCampaign(), cleared: ['crypt', 'chapel', 'sanctum'], at: 'sanctum', relics: ['jar', 'nope'] };
    expect(parseSave(serialize(s)).relics).toEqual(['jar']);
    const old = { ...s };
    delete old.relics;
    expect(parseSave(serialize(old)).relics).toEqual(['phylactery']);
    const plus = newGamePlus({ ...newCampaign(), done: true, relics: ['phylactery', 'horn', 'veil', 'jar'] });
    expect(plus.relics).toEqual(['phylactery', 'horn', 'veil', 'jar']);
    expect(newGamePlus({ ...newCampaign(), done: true }).relics).toEqual([]);
  });

  it('stay with a saved fight and a kept replay, so both play back the same', () => {
    const fight = { node: 'barrow', seed: 5, log: [], check: null, explored: [], seen: [], relics: ['phylactery'] };
    const s = { ...newCampaign(), relics: ['phylactery', 'horn'], fight };
    expect(parseSave(serialize(s)).fight.relics).toEqual(['phylactery']);
    expect(parseSave(serialize({ ...s, fight: { ...fight, relics: ['crown'] } })).fight).toBeUndefined();
    const { relics: _r, ...before } = fight; // saved before relics: none
    expect(parseSave(serialize({ ...s, fight: before })).fight.relics).toBeUndefined();
    const rec = { node: 'barrow', seed: 5, party: newCampaign().party, difficulty: 'normal', log: [], result: 'victory' };
    expect(watchable({ ...rec, relics: ['veil', 'nope'] }).relics).toEqual(['veil']);
    expect(watchable(rec).relics).toBeUndefined();
  });
});
