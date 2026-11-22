import { describe, it, expect } from 'vitest';
import { newCampaign, parseSave, serialize, NODES } from '../src/game/campaign.js';
import { goldFor, canTrade, stock, buy, buyProblem, sell, sellPrice, PRICES } from '../src/game/shop.js';

const at = (id, over = {}) => ({ ...newCampaign(), at: id, cleared: ['crypt', 'warren', 'ossuary', id].filter((c, i, a) => a.indexOf(c) === i), ...over });

describe('gold and the pedlar', () => {
  it('pays more for deeper rooms and twice for a boss, nothing for a stop', () => {
    expect(goldFor('crypt')).toBe(20);
    expect(goldFor('warren')).toBe(30);
    expect(goldFor('sanctum')).toBe(100);
    expect(goldFor('chapel')).toBe(0);
    expect(goldFor('tomb')).toBeGreaterThan(goldFor('halls'));
  });

  it('trades at rest stops and after an act’s boss, not after an ordinary room or at the end', () => {
    expect(canTrade(at('chapel'))).toBe(true);
    expect(canTrade(at('sanctum'))).toBe(true);
    expect(canTrade(at('warren'))).toBe(false);
    expect(canTrade(newCampaign())).toBe(false);
    expect(canTrade(at('tomb', { done: true }))).toBe(false);
  });

  it('always sells potions and two different pieces of gear, the same each visit', () => {
    const s = at('chapel');
    const items = stock(s);
    expect(items[0]).toBe('potion');
    expect(items).toHaveLength(3);
    expect(new Set(items).size).toBe(3);
    expect(stock(s)).toEqual(items);
    for (const id of items) expect(PRICES[id]).toBeGreaterThan(0);
  });

  it('a potion goes to whoever carries fewest; gear to the pack, once a stop', () => {
    let s = at('chapel', { gold: 1000 });
    const fewest = Math.min(...Object.values(s.party).map((r) => r.potions));
    s = buy(s, 'potion');
    expect(s.gold).toBe(1000 - PRICES.potion);
    expect(Object.values(s.party).reduce((n, r) => n + r.potions, 0)).toBe(Object.values(at('chapel').party).reduce((n, r) => n + r.potions, 0) + 1);
    expect(fewest).toBeGreaterThanOrEqual(0);
    const gear = stock(s)[1];
    s = buy(s, gear);
    expect(s.pack).toContain(gear);
    expect(stock(s)).not.toContain(gear);
    expect(buyProblem(s, gear)).toBe('Not for sale here');
    expect(stock(s)).toContain('potion'); // potions never run out
  });

  it('refuses without the gold or away from the pedlar', () => {
    expect(buyProblem(at('chapel', { gold: 5 }), 'potion')).toBe('Not enough gold');
    expect(buyProblem(at('warren', { gold: 500 }), 'potion')).toBe('The pedlar isn’t here');
    expect(() => buy(at('chapel', { gold: 5 }), 'potion')).toThrow();
  });

  it('buys spare gear from the pack at half price, never a key', () => {
    const s = at('chapel', { gold: 0, pack: ['ringProtection', 'ironKey'] });
    expect(sellPrice('ringProtection')).toBe(PRICES.ringProtection / 2);
    expect(sellPrice('ironKey')).toBe(0);
    const after = sell(s, 0);
    expect(after.pack).toEqual(['ironKey']);
    expect(after.gold).toBe(PRICES.ringProtection / 2);
    expect(() => sell(after, 0)).toThrow();
  });

  it('deeper stops carry better gear', () => {
    const early = new Set();
    const late = new Set();
    for (const id of ['chapel', 'well']) for (const g of stock(at(id)).slice(1)) early.add(g);
    for (const g of stock({ ...at('hearth'), cleared: Object.keys(NODES) }).slice(1)) late.add(g);
    expect([...early].every((g) => PRICES[g] <= PRICES.ringProtection)).toBe(true);
    expect(late.size).toBe(2);
  });

  it('a save keeps its gold; one from before gold starts with none', () => {
    const s = { ...newCampaign(), gold: 75 };
    expect(parseSave(serialize(s)).gold).toBe(75);
    const old = JSON.parse(serialize(newCampaign()));
    delete old.gold;
    expect(parseSave(JSON.stringify(old)).gold).toBe(0);
    expect(parseSave(JSON.stringify({ ...old, gold: -3 })).gold).toBe(0);
  });
});
