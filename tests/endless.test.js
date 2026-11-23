import { describe, it, expect } from 'vitest';
import { makeFloor, floorId, parseFloorId, levelOf, allReachable, floorTier, newEndless, afterFloor, parseEndless, nextFloor, restFloor } from '../src/game/endless.js';
import { newCampaign, completeFight, serialize, HERO_CODES } from '../src/game/campaign.js';
import { Game } from '../src/game/combat.js';
import { seeded } from '../src/game/dice.js';
import { levelById } from '../src/game/maps.js';
import { canTrade, stock } from '../src/game/shop.js';

const won = () => ({ ...newCampaign('normal'), xp: 10400, done: true, at: 'throne', cleared: ['crypt', 'throne'], gold: 120, pack: ['ringProtection'] });

describe('the Endless Crypt', () => {
  it('makes the same floor from the same seed, and a different one from another', () => {
    expect(makeFloor(7, 3)).toEqual(makeFloor(7, 3));
    expect(makeFloor(7, 3).rows).not.toEqual(makeFloor(8, 3).rows);
    expect(makeFloor(7, 3).rows).not.toEqual(makeFloor(7, 4).rows);
  });

  it('builds rooms the rules can fight in: heroes, stairs, monsters, every tile reachable', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const floor of [1, 2, 5, 9, 15]) {
        const level = makeFloor(seed, floor);
        expect(level.rows).toHaveLength(12);
        for (const row of level.rows) expect(row).toHaveLength(16);
        const text = level.rows.join('');
        for (const code of HERO_CODES) expect(text.split(code)).toHaveLength(2);
        expect(text).toContain('>');
        expect((text.match(/[a-z]/g) ?? []).length).toBeGreaterThan(0);
        expect((text.match(/[a-z]/g) ?? []).length).toBeLessThanOrEqual(11);
        expect((text.match(/\$/g) ?? []).length).toBe(level.loot.length);
        const at = level.rows.findIndex((r) => r.includes('F'));
        expect(allReachable(level.rows, [level.rows[at].indexOf('F'), at])).toBe(true);
        const game = new Game(level, { rng: seeded(seed), party: won().party });
        expect(game.units.filter((u) => u.team === 'monsters').length).toBeGreaterThan(0);
      }
    }
  });

  it('a named foe waits on every fifth floor', () => {
    expect(makeFloor(3, 5).rows.join('')).toMatch(/b/);
    expect(makeFloor(3, 10).rows.join('')).toMatch(/n/);
  });

  it('finds a room by id: a floor, or a campaign room', () => {
    const id = floorId(12, 4);
    expect(parseFloorId(id)).toEqual({ seed: 12, floor: 4 });
    expect(levelOf(id).rows).toEqual(makeFloor(12, 4).rows);
    expect(levelOf('crypt')).toBe(levelById('crypt'));
    expect(parseFloorId('crypt')).toBeNull();
    expect(parseFloorId('deep:1:0')).toBeNull();
  });

  it('a dive keeps its generation: old dives keep their floors, new ones meet act five', () => {
    expect(parseFloorId('deep:7:3:2')).toEqual({ seed: 7, floor: 3, gen: 2 });
    expect(parseFloorId('deep:7:3:9')).toBeNull();
    expect(nextFloor({ endless: { seed: 7, floor: 3 } })).toBe('deep:7:3'); // saved before generations
    expect(levelOf('deep:7:3').rows).toEqual(makeFloor(7, 3).rows);
    const seen = (gen) => new Set(Array.from({ length: 40 }, (_, s) => makeFloor(s, 8, gen).rows.join('')).join(''));
    expect(seen(1).has('a') || seen(1).has('z')).toBe(false);
    expect(seen(2).has('a') && seen(2).has('z')).toBe(true);
    expect(makeFloor(1, 30, 2).rows.join('')).toMatch(/v/);
    expect(makeFloor(1, 30).rows.join('')).not.toMatch(/v/);
  });

  it('starts from the won party, rested, and goes deeper floor by floor', () => {
    const s = newEndless(won(), 99);
    expect(s.endless).toEqual({ seed: 99, floor: 1, gen: 2 });
    expect(s.done).toBe(false);
    expect(s.gold).toBe(120);
    expect(s.pack).toEqual(['ringProtection']);
    expect(nextFloor(s)).toBe('deep:99:1:2');
    const game = new Game(levelOf(nextFloor(s)), { rng: seeded(1), party: s.party });
    game.over = 'victory';
    const done = completeFight(s, nextFloor(s), game).state;
    expect(done.done).toBe(false);
    const { state, gold } = afterFloor(done);
    expect(state.endless.floor).toBe(2);
    expect(state.gold).toBe(120 + gold);
    expect(canTrade(state)).toBe(false);
  });

  it('every third floor brings a long rest and the pedlar; monsters toughen every three', () => {
    expect([1, 2, 3, 4, 6].map(restFloor)).toEqual([false, false, true, false, true]);
    expect([1, 3, 4, 7, 10].map(floorTier)).toEqual([0, 0, 1, 2, 3]);
    const s = { ...newEndless(won(), 5), endless: { seed: 5, floor: 3 }, at: 'deep:5:2' };
    const { state } = afterFloor(s);
    expect(state.endless.rested).toBe(true);
    expect(state.tier).toBe(1);
    expect(canTrade({ ...state, at: 'deep:5:3' })).toBe(true);
    expect(stock({ ...state, at: 'deep:5:3' })).toHaveLength(3);
  });

  it('keeps a stored dive and refuses a broken one', () => {
    const s = newEndless(won(), 3);
    expect(parseEndless(serialize(s)).endless.floor).toBe(1);
    expect(parseEndless('{"endless":{"seed":1}}')).toBeNull();
    expect(parseEndless('nonsense')).toBeNull();
  });
});
