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
  ringProtection: {
    name: 'Ring of Protection', kind: 'gear',
    desc: '+1 AC and +1 to saving throws.',
    apply: (u) => { u.acBonus += 1; u.saveBonus += 1; },
  },
};

/** Equip a list of item ids on a unit (after levelling). */
export function applyItems(unit, items = []) {
  unit.items = [...items];
  for (const id of items) ITEMS[id]?.apply?.(unit);
  return unit;
}
