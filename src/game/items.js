import { abilityMod } from './dice.js';

// Loot found in chests. Potions go straight to whoever opens the chest; the rest go
// to the party's pack and are handed out at camp between fights.

export const ITEMS = {
  potion: {
    name: 'Potion of Healing', kind: 'potion',
    desc: 'Drink as an action: regain 2d4 + 2 HP.',
  },
  weaponPlus1: {
    name: 'Runed Weapon +1', kind: 'gear',
    desc: '+1 to hit and damage with weapon attacks (not spells).',
    apply: (u) => { u.weaponBonus += 1; },
  },
  weaponPlus2: {
    name: 'Runed Weapon +2', kind: 'gear',
    desc: '+2 to hit and damage with weapon attacks (not spells).',
    apply: (u) => { u.weaponBonus += 2; },
  },
  ringProtection: {
    name: 'Ring of Protection', kind: 'gear',
    desc: '+1 AC and +1 to saving throws.',
    apply: (u) => { u.acBonus += 1; u.saveBonus += 1; },
  },
  cloakProtection: {
    name: 'Cloak of Protection', kind: 'gear',
    desc: '+1 AC and +1 to saving throws.',
    apply: (u) => { u.acBonus += 1; u.saveBonus += 1; },
  },
  bracersDefense: {
    name: 'Bracers of Defense', kind: 'gear',
    desc: '+2 AC while wearing no armor and carrying no shield (the Wizard).',
    only: (u) => (u.cls === 'Wizard' ? null : 'Only a hero in no armor can use them'),
    apply: (u) => { u.acBonus += 2; },
  },
  gauntletsOgre: {
    name: 'Gauntlets of Ogre Power', kind: 'gear',
    desc: 'Strength becomes 19, and +1 damage with Strength weapons.',
    apply: (u) => { u.stats.str = Math.max(u.stats.str, 19); u.strDamage = (u.strDamage ?? 0) + 1; },
  },
  amuletHealth: {
    name: 'Amulet of Health', kind: 'gear',
    desc: 'Constitution becomes 19: more hit points and stronger Constitution saves.',
    apply: (u) => {
      const before = abilityMod(u.stats.con);
      u.stats.con = Math.max(u.stats.con, 19);
      const more = (abilityMod(u.stats.con) - before) * (u.level ?? 1);
      u.maxHp += more;
      u.hp += more;
    },
  },
  periaptPoison: {
    name: 'Periapt of Proof against Poison', kind: 'gear',
    desc: 'Can’t be poisoned: goblin arrows, rat and spider bites, ghoul claws and ghast stench don’t take hold.',
    apply: (u) => { (u.immune ??= []).push('poisoned'); },
  },
};

/** Equip a list of item ids on a unit (after levelling). */
export function applyItems(unit, items = []) {
  unit.items = [...items];
  for (const id of items) ITEMS[id]?.apply?.(unit);
  return unit;
}
