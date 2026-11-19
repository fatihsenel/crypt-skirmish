import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MONSTERS, BESTIARY_KEY, parseBestiary, loadBestiary, meet, parseSlain, loadSlain, slay, roomMonsters, onEveryPath, metBefore } from '../src/game/bestiary.js';
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

describe('the bestiary from before it existed', () => {
  it('finds the rooms every way to a room passes', () => {
    expect(onEveryPath('crypt')).toEqual(['crypt']);
    expect(onEveryPath('sanctum')).toEqual(['crypt', 'sanctum']);
    expect(onEveryPath('tomb')).toEqual(['crypt', 'sanctum', 'catacombs', 'barrow', 'nest', 'throne', 'halls', 'tomb']);
  });

  it('reads monsters from the rooms', () => {
    expect(roomMonsters('crypt')).toEqual(['g', 's', 'r']);
    expect(roomMonsters('chapel')).toEqual([]);
    expect(roomMonsters('nowhere')).toEqual([]);
  });

  it('counts rooms cleared, rooms passed on the way to where runs ended, and dailies', () => {
    expect(metBefore()).toEqual([]);
    expect(metBefore({ cleared: ['crypt', 'warren'] })).toEqual(['g', 's', 'o', 'r', 'b']);
    expect(metBefore({ reached: ['The Hollow Tomb', 'Somewhere else'] })).not.toContain('b'); // the warren is optional
    expect(metBefore({ reached: ['The Hollow Tomb'] })).toContain('l');
    expect(metBefore({ daily: ['larder'] })).toContain('h');
  });
});

describe('the tally of monsters slain', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  });
  afterEach(() => { delete globalThis.localStorage; });

  it('counts each kind and ignores heroes and junk', () => {
    slay('g'); slay('g'); slay('l'); slay('F');
    expect(loadSlain()).toEqual({ g: 2, l: 1 });
    expect(parseSlain('{"g":3,"zz":1,"s":-1,"o":"2"}')).toEqual({ g: 3 });
    expect(parseSlain('[1]')).toEqual({});
    expect(parseSlain('nope')).toEqual({});
  });
});
