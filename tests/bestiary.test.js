import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MONSTERS, BESTIARY_KEY, parseBestiary, loadBestiary, meet } from '../src/game/bestiary.js';
import { LORE } from '../src/ui/bestiary.js';
import { unitCard, OUT_OF_FIGHT } from '../src/ui/unitCard.js';
import { createUnit } from '../src/game/units.js';

describe('the bestiary', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    };
  });
  afterEach(() => { delete globalThis.localStorage; });

  it('lists every monster kind once, with a line of lore and a card', () => {
    expect(MONSTERS.length).toBe(17);
    expect(new Set(MONSTERS).size).toBe(MONSTERS.length);
    expect(Object.keys(LORE).sort()).toEqual([...MONSTERS].sort());
    for (const code of MONSTERS) {
      const card = unitCard(OUT_OF_FIGHT, createUnit(code, 0, 0));
      expect(card).toContain('AC');
      expect(card).not.toMatch(/NaN|undefined/);
    }
  });

  it('keeps only known kinds from storage, in bestiary order', () => {
    expect(parseBestiary(null)).toEqual([]);
    expect(parseBestiary('not json')).toEqual([]);
    expect(parseBestiary('{"g":1}')).toEqual([]);
    expect(parseBestiary('["l","zz","g","g",3]')).toEqual(['g', 'l']);
  });

  it('notes kinds as met and reports only the new ones', () => {
    expect(meet(['s'])).toEqual(['s']);
    expect(meet(['g', 's', 'g', 'F'])).toEqual(['g']); // heroes aren't monsters
    expect(meet(['s'])).toEqual([]);
    expect(loadBestiary()).toEqual(['g', 's']);
    expect(JSON.parse(store.get(BESTIARY_KEY))).toEqual(['g', 's']);
  });
});
