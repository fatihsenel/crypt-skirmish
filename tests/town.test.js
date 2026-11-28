import { describe, it, expect } from 'vitest';
import { newCampaign, newGamePlus, parseSave, serialize, completeFight, HERO_CODES, heroUnit } from '../src/game/campaign.js';
import { TOWN, COSTS, stageOf, canBuild, buildProblem, build } from '../src/game/town.js';
import { stock, priceOf, sellPrice, buy, PRICES } from '../src/game/shop.js';
import { ITEMS } from '../src/game/items.js';

const at = (id, over = {}) => ({ ...newCampaign(), at: id, cleared: ['crypt', 'warren', 'chapel', id].filter((c, i, a) => a.indexOf(c) === i), ...over });
const restedHero = (code, rec) => heroUnit(code, { cls: rec.cls, level: rec.level, items: rec.items ?? [], picks: rec.picks });
const town = (smith = 0, temple = 0, library = 0) => ({ smith, temple, library });

/** A won fight as completeFight sees it: the party as it stands, no chests, no XP. */
const won = (state) => ({
  partyState: () => Object.fromEntries(HERO_CODES.map((c) => [c, { hp: state.party[c].hp, slots: { ...state.party[c].slots } }])),
  xpEarned: () => 0,
  found: [],
  grid: { chests: new Map() },
  units: [],
  log: [],
  round: 1,
});

describe('the village', () => {
  it('has three buildings of three stages at 120, 220 and 340 gold', () => {
    expect(COSTS).toEqual([120, 220, 340]);
    expect(Object.keys(TOWN)).toEqual(['smith', 'temple', 'library']);
    for (const b of Object.values(TOWN)) {
      expect(b.stages).toHaveLength(3);
      for (const s of b.stages) expect(s.desc && s.look && s.news).toBeTruthy();
    }
  });

  it('is rebuilt only in camp after an act’s boss, in a campaign run', () => {
    expect(canBuild(at('sanctum'))).toBe(true);
    expect(canBuild(at('chapel'))).toBe(false);
    expect(canBuild(at('warren'))).toBe(false);
    expect(canBuild(at('tomb', { done: true }))).toBe(false);
    expect(canBuild(at('sanctum', { endless: { seed: 1, floor: 3 } }))).toBe(false);
    expect(buildProblem(at('warren', { gold: 999 }), 'smith')).toBe('Only after an act’s boss');
    expect(buildProblem(at('sanctum', { gold: 999 }), 'mill')).toBe('No such building');
    expect(buildProblem(at('sanctum', { gold: 119 }), 'smith')).toBe('Not enough gold');
    expect(buildProblem(at('sanctum', { gold: 999, town: town(3) }), 'smith')).toBe('Already rebuilt');
    expect(buildProblem(at('sanctum', { gold: 120 }), 'smith')).toBe(null);
  });

  it('spends the stage’s cost and raises the building a stage', () => {
    let s = at('sanctum', { gold: 600 });
    s = build(s, 'temple');
    expect(s.gold).toBe(480);
    expect(stageOf(s, 'temple')).toBe(1);
    s = build(s, 'temple');
    expect(s.gold).toBe(260);
    expect(s.town).toEqual(town(0, 2, 0));
    expect(() => build(s, 'temple')).toThrow('Not enough gold');
  });

  it('starts in ruins on New Game+', () => {
    const ng = newGamePlus({ ...at('tomb', { done: true }), town: town(3, 3, 3) });
    expect(ng.town).toEqual(town());
  });

  it('starts in ruins, and a save from before the village loads with none built', () => {
    expect(stageOf(newCampaign(), 'smith')).toBe(0);
    const s = at('sanctum');
    delete s.town;
    expect(parseSave(serialize(s)).town).toEqual(town());
    const bad = parseSave(serialize({ ...s, town: { smith: 2, temple: 9, library: 'x', mill: 3 } }));
    expect(bad.town).toEqual(town(2, 0, 0));
  });
});

describe('what the village does', () => {
  it('the smith: a third piece of gear, three quarters back for gear, the next act’s gear early', () => {
    const s = at('sanctum');
    const gear = (st) => stock(st).filter((id) => ITEMS[id].kind === 'gear');
    expect(gear(s)).toHaveLength(2);
    expect(gear({ ...s, town: town(1) })).toHaveLength(3);
    expect(new Set(gear({ ...s, town: town(1) })).size).toBe(3);
    expect(sellPrice('ringProtection', s)).toBe(PRICES.ringProtection / 2);
    expect(sellPrice('ringProtection', { ...s, town: town(2) })).toBe(Math.floor(PRICES.ringProtection * 3 / 4));
    expect(sellPrice('ironKey', { ...s, town: town(2) })).toBe(0);
    // Before an act is won the pedlar carries the first three; the smith's third stage brings the next two.
    const pool = (st) => new Set(Array.from({ length: 40 }, (_, i) => gear({ ...st, at: 'sanctum', tier: i })).flat());
    expect(pool({ ...s, cleared: ['crypt'] }).has('cloakProtection')).toBe(false);
    expect(pool({ ...s, cleared: ['crypt'], town: town(3) }).has('cloakProtection')).toBe(true);
  });

  it('the library: a second scroll, a third off scrolls', () => {
    const s = at('sanctum', { gold: 1000 });
    const scrolls = (st) => stock(st).filter((id) => ITEMS[id].kind === 'scroll');
    expect(scrolls(s)).toHaveLength(1);
    expect(scrolls({ ...s, town: town(0, 0, 1) })).toHaveLength(2);
    expect(new Set(scrolls({ ...s, town: town(0, 0, 1) })).size).toBe(2);
    expect(priceOf(s, 'scrollFireball')).toBe(180);
    expect(priceOf({ ...s, town: town(0, 0, 2) }, 'scrollFireball')).toBe(120);
    expect(priceOf({ ...s, town: town(0, 0, 2) }, 'potion')).toBe(PRICES.potion);
    const id = scrolls(s)[0];
    const cheap = { ...s, town: town(0, 0, 2) };
    expect(buy(cheap, id).gold).toBe(1000 - priceOf(cheap, id));
  });

  it('the temple: 3 HP after a room, a level-1 slot back, a potion each at an act’s end', () => {
    const hurt = (st) => {
      for (const c of HERO_CODES) {
        st.party[c].hp = 1;
        if (st.party[c].slots[1]) st.party[c].slots[1] = 0;
      }
      return st;
    };
    const plain = completeFight(hurt(at('crypt', { cleared: [] })), 'warren', won(hurt(at('crypt', { cleared: [] }))));
    const s = hurt(at('crypt', { cleared: [], town: town(0, 3, 0) }));
    const { state, report } = completeFight(s, 'warren', won(s));
    expect(report.town.hp).toBe(3);
    for (const c of HERO_CODES) {
      const max = restedHero(c, state.party[c]).maxHp;
      expect(state.party[c].hp).toBe(Math.min(max, plain.state.party[c].hp + 3));
      const had = restedHero(c, state.party[c]).slotMax[1] ?? 0;
      if (had && !restedHero(c, state.party[c]).pactMagic) expect(state.party[c].slots[1]).toBe(1);
    }
    expect(report.town.slots).toBe(true);
    // At an act's end: the long rest heals everyone anyway; the potions are the temple's gift.
    const b = at('catacombs', { cleared: ['crypt', 'warren', 'chapel'], at: 'chapel', town: town(0, 2, 0) });
    const before = HERO_CODES.map((c) => b.party[c].potions);
    const end = completeFight(b, 'sanctum', won(b));
    expect(HERO_CODES.map((c) => end.state.party[c].potions)).toEqual(before.map((n) => n + 1));
    expect(end.report.town.potions).toBe(true);
    // Nothing without the temple.
    const none = completeFight(at('crypt', { cleared: [] }), 'warren', won(at('crypt', { cleared: [] })));
    expect(none.report.town).toBe(null);
  });

  it('the library’s third stage: a free scroll for each hero who can read one at an act’s end', () => {
    const b = at('chapel', { town: town(0, 0, 3) });
    const { state, report } = completeFight(b, 'sanctum', won(b));
    expect(report.town.scrolls.length).toBeGreaterThan(0);
    for (const [code, id] of report.town.scrolls) {
      expect(ITEMS[id].kind).toBe('scroll');
      expect(state.party[code].scrolls).toContain(id);
    }
    // The same every time: no dice.
    expect(completeFight(b, 'sanctum', won(b)).report.town.scrolls).toEqual(report.town.scrolls);
    // Not after an ordinary room.
    expect(completeFight(at('crypt', { cleared: [], town: town(0, 0, 3) }), 'warren', won(b)).report.town).toBe(null);
  });
});
