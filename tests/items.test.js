import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { LEVELS } from '../src/game/maps.js';
import { seeded } from '../src/game/dice.js';
import { ITEMS } from '../src/game/items.js';
import { newCampaign, equip, unequip, equipProblem, equipPreview, heroUnit } from '../src/game/campaign.js';

/** A campaign with `items` in the pack. */
const withPack = (...items) => ({ ...newCampaign('normal'), pack: [...items] });

describe('magic items', () => {
  it('lists every item in some chest, but those of the stops with no fight', () => {
    const found = new Set(LEVELS.flatMap((l) => [...(l.loot ?? []), ...(l.loot10 ?? [])].flat()));
    const fromStops = ['periaptWounds', 'altarBlessing']; // the reliquary and the altar
    for (const id of Object.keys(ITEMS)) if (ITEMS[id].kind !== 'supply') expect(found.has(id) || fromStops.includes(id), id).toBe(true); // supplies: the pedlar's
  });

  it('keeps Bracers of Defense for a hero in no armor', () => {
    const state = withPack('bracersDefense');
    expect(equipProblem(state, 0, 'F')).toMatch(/no armor/);
    expect(equipProblem(state, 0, 'W')).toBeNull();
    const w = heroUnit('W', equip(state, 0, 'W').party.W);
    expect(w.ac + w.acBonus).toBe(heroUnit('W', state.party.W).ac + 2);
    const warlock = withPack('bracersDefense');
    warlock.party.W.cls = 'K';
    expect(equipProblem(warlock, 0, 'W')).toMatch(/no armor/);
  });

  it('sets Strength to 19 with Gauntlets of Ogre Power', () => {
    const state = equip(withPack('gauntletsOgre'), 0, 'F');
    expect(heroUnit('F', state.party.F).stats.str).toBe(19);
  });

  it('adds +1 damage with Strength weapons even at Strength 20', () => {
    const state = withPack('gauntletsOgre');
    state.party.F.level = 6; // Strength 20 by now
    const plain = heroUnit('F', state.party.F);
    const worn = heroUnit('F', equip(state, 0, 'F').party.F);
    expect(worn.stats.str).toBe(20);
    const game = new Game(LEVELS[0], { rng: seeded(1) });
    const sword = plain.attacks.find((a) => a.stat === 'str');
    expect(game.damageBonus(worn, sword)).toBe(game.damageBonus(plain, sword) + 1);
    expect(game.toHitBonus(worn, sword)).toBe(game.toHitBonus(plain, sword));
    const [, hitA, hitB, dmgA, dmgB] = equipPreview(state, 0, 'F')[0].match(/hit \+(\d+) → \+(\d+), damage \+(\d+) → \+(\d+)/);
    expect([hitA, Number(dmgB) - Number(dmgA)]).toEqual([hitB, 1]);
  });

  it('adds hit points with an Amulet of Health, and takes them back', () => {
    const state = withPack('amuletHealth');
    state.party.W.hp = 15; // 5 below the Wizard's 20
    const plain = heroUnit('W', state.party.W);
    const worn = equip(state, 0, 'W');
    const u = heroUnit('W', worn.party.W);
    // Con 12 (+1) to 19 (+4): 3 HP a level, at level 3.
    expect(u.maxHp).toBe(plain.maxHp + 9);
    expect(worn.party.W.hp).toBe(24); // still 5 below
    const off = unequip(worn, 'W', 0);
    expect(off.party.W.hp).toBe(15);
    expect(heroUnit('W', off.party.W).maxHp).toBe(plain.maxHp);
  });

  it('never leaves a hero with more HP than the maximum', () => {
    const state = withPack();
    state.party.W.items = ['amuletHealth'];
    state.party.W.hp = 29;
    state.party.W.items = [];
    expect(heroUnit('W', state.party.W).hp).toBe(20);
    const g = new Game(LEVELS[0], { party: state.party, rng: seeded(1) });
    expect(g.units.find((u) => u.slot === 'W').hp).toBe(20);
  });

  it('wards off poison with the Periapt, without a save', () => {
    const state = equip(withPack('periaptPoison'), 0, 'F');
    const g = new Game(LEVELS[0], { party: state.party, rng: seeded(2) });
    const f = g.units.find((u) => u.slot === 'F');
    const rat = g.units.find((u) => u.team === 'monsters');
    const rolls = g.rolls;
    expect(g.applyRider(rat, f, { save: 'con', dc: 10, condition: 'poisoned', turns: 1 })).toBeNull();
    g.addCondition(f, 'poisoned');
    expect(f.conditions.poisoned).toBeUndefined();
    expect(g.rolls).toBe(rolls);
    g.addCondition(f, 'prone');
    expect(f.conditions.prone).toBeTruthy();
  });
});

describe('item previews at camp', () => {
  it('shows the AC and saves a ring would add', () => {
    const state = withPack('ringProtection');
    const w = heroUnit('W', state.party.W);
    expect(equipPreview(state, 0, 'W')).toEqual([`AC ${w.ac} → ${w.ac + 1}`, '+1 to saves']);
  });

  it('shows the main weapon getting better with a runed weapon', () => {
    const [line] = equipPreview(withPack('weaponPlus1'), 0, 'F');
    expect(line).toMatch(/^.+: hit \+(\d+) → \+\d+, damage \+\d+ → \+\d+$/);
  });

  it('shows the hit points an Amulet of Health adds', () => {
    const state = withPack('amuletHealth');
    const w = heroUnit('W', state.party.W);
    expect(equipPreview(state, 0, 'W')).toContain(`Max HP ${w.maxHp} → ${w.maxHp + 9}`);
  });

  it('says when an item does nothing for a hero', () => {
    // The Rogue fights with Dexterity, so Strength 19 changes nothing.
    expect(equipPreview(withPack('gauntletsOgre'), 0, 'R')).toEqual([]);
    expect(equipPreview(withPack('periaptPoison'), 0, 'R')).toEqual(['Can’t be poisoned']);
  });

  it('leaves the state untouched', () => {
    const state = withPack('amuletHealth');
    const copy = structuredClone(state);
    equipPreview(state, 0, 'C');
    expect(state).toEqual(copy);
  });
});
