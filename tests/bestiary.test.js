import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MONSTERS, BESTIARY_KEY, parseBestiary, loadBestiary, meet, parseSlain, loadSlain, slay, slainTotal, unread, markRead, roomMonsters, onEveryPath, metBefore, HURT_KEY, parseHurt, loadHurt, addBlows, recordBlows, deadliest, parseElitesSlain, loadElitesSlain, slayElite } from '../src/game/bestiary.js';
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
    expect(MONSTERS.length).toBe(21);
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

  it('counts elites slain by trait, and drops junk', () => {
    expect(loadElitesSlain()).toEqual({});
    slayElite('relentless');
    slayElite('relentless');
    slayElite('swift');
    slayElite('nonsense');
    expect(loadElitesSlain()).toEqual({ relentless: 2, swift: 1 });
    expect(parseElitesSlain('{"warded":1,"frenzied":0,"swift":"2","x":3}')).toEqual({ warded: 1 });
    expect(parseElitesSlain('[1]')).toEqual({});
    expect(parseElitesSlain('nope')).toEqual({});
  });

  it('adds up every kind slain', () => {
    expect(slainTotal({})).toBe(0);
    expect(slainTotal({ g: 2, l: 1 })).toBe(3);
  });

  it('marks kinds met since the bestiary was last opened as new', () => {
    meet(['g', 's']);
    expect(unread()).toEqual(['g', 's']);
    markRead();
    expect(unread()).toEqual([]);
    meet(['l']);
    expect(unread()).toEqual(['l']);
  });

  it('counts each kind and ignores heroes and junk', () => {
    slay('g'); slay('g'); slay('l'); slay('F');
    expect(loadSlain()).toEqual({ g: 2, l: 1 });
    expect(parseSlain('{"g":3,"zz":1,"s":-1,"o":"2"}')).toEqual({ g: 3 });
    expect(parseSlain('[1]')).toEqual({});
    expect(parseSlain('nope')).toEqual({});
  });
});

describe('the deadliest foes', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  });
  afterEach(() => { delete globalThis.localStorage; });

  const blow = (code, damage, down = false) => ({ code, damage, down });

  it('adds up the damage each kind dealt and the heroes it dropped, leaving traps out', () => {
    recordBlows([blow('g', 5), blow('g', 7, true), blow('s', 4), blow(null, 9, true)]);
    recordBlows([blow('s', 6, true), blow('F', 3)]);
    expect(loadHurt()).toEqual({ g: { damage: 12, downs: 1 }, s: { damage: 10, downs: 1 } });
  });

  it('does not change the tally it was given', () => {
    const hurt = { g: { damage: 1, downs: 0 } };
    addBlows(hurt, [blow('g', 5)]);
    expect(hurt.g.damage).toBe(1);
  });

  it('lists the worst first, damage then falls', () => {
    const hurt = { g: { damage: 30, downs: 1 }, s: { damage: 30, downs: 2 }, l: { damage: 80, downs: 0 }, o: { damage: 5, downs: 0 } };
    expect(deadliest(hurt).map((h) => h.code)).toEqual(['l', 's', 'g']);
    expect(deadliest({})).toEqual([]);
  });

  it('ignores junk in storage', () => {
    store.set(HURT_KEY, '{"g":{"damage":4,"downs":"x"},"zz":{"damage":3},"s":5,"l":{"damage":-2}}');
    expect(loadHurt()).toEqual({ g: { damage: 4, downs: 0 } });
    expect(parseHurt('[1]')).toEqual({});
    expect(parseHurt('nope')).toEqual({});
  });
});

describe('names in the turn order', () => {
  it('shortens long names to fit a portrait', async () => {
    const { shortName } = await import('../src/ui/unitCard.js');
    expect(shortName('Skeleton 2')).toBe('Skeleton 2');
    expect(shortName('Giant Spider 2')).toBe('G. Spider 2');
    expect(shortName('Fallen Knight 1')).toBe('F. Knight 1');
    expect(shortName('Risen Mummy')).toBe('R. Mummy');
    expect(shortName('Risen Servant')).toBe('R. Servant');
    expect(shortName('Bartholomew12')).toBe('Bartholomew12');
    expect(shortName('Nekhet')).toBe('Nekhet');
  });
});
