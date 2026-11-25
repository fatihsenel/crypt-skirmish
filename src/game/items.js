import { abilityMod } from './dice.js';
import { classSpells } from './units.js';

// Loot found in chests. Potions go straight to whoever opens the chest; the rest go
// to the party's pack and are handed out at camp between fights.

export const ITEMS = {
  potion: {
    name: 'Potion of Healing', kind: 'potion',
    desc: 'Drink as an action: regain 2d4 + 2 HP.',
  },
  // Rules 6: the pedlar's supplies, carried like potions (a hero's `flasks` and `caltrops`).
  fire: {
    name: 'Alchemist’s Fire', kind: 'supply', carry: 'flasks',
    desc: 'Throw as an action at a foe within 20 ft: on a hit, 1d4 fire, and it burns for 1d4 at the end of each of its turns until a DC 10 DEX save puts it out.',
  },
  caltrops: {
    name: 'Caltrops', kind: 'supply', carry: 'caltrops',
    desc: 'Spread as an action on a tile within 10 ft: whoever steps on it saves (DEX 15) or takes 1 piercing and stops there. The party steps round them.',
  },
  // Rules 10: spell scrolls, one use each, carried by a hero (`scrolls`, the item ids). Only a
  // class with the spell on its list reads one (classSpells); it casts at the spell's own level
  // and costs no slot.
  scrollCureWounds: { name: 'Scroll of Cure Wounds', kind: 'scroll', spell: 'cureWounds', desc: 'One use: cast Cure Wounds without a slot. A Cleric, Bard or Druid can read it.' },
  scrollMagicMissile: { name: 'Scroll of Magic Missile', kind: 'scroll', spell: 'magicMissile', desc: 'One use: cast Magic Missile without a slot. A Wizard can read it.' },
  scrollFogCloud: { name: 'Scroll of Fog Cloud', kind: 'scroll', spell: 'fogCloud', desc: 'One use: cast Fog Cloud without a slot. A Wizard, Sorcerer or Druid can read it.' },
  scrollMistyStep: { name: 'Scroll of Misty Step', kind: 'scroll', spell: 'mistyStep', desc: 'One use: cast Misty Step without a slot. A Wizard or Sorcerer can read it.' },
  scrollFireball: { name: 'Scroll of Fireball', kind: 'scroll', spell: 'fireball', desc: 'One use: cast Fireball without a slot. A Wizard, Sorcerer or Warlock can read it.' },
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
  // From the stops with no fight (EVENTS in campaign.js). Kept at the end: links list items by id.
  ironKey: {
    name: 'Iron Key', kind: 'key',
    desc: 'Opens the Saint’s Reliquary, after the Halls in the fourth act.',
  },
  periaptWounds: {
    name: 'Periapt of Wound Closure', kind: 'gear',
    desc: 'Whenever the wearer regains hit points, they regain twice as many.',
    apply: (u) => { u.healTwice = true; },
  },
  altarBlessing: {
    name: 'Altar Blessing', kind: 'boon',
    desc: '+1 to hit and +1 AC, for the next fight only.',
    apply: (u) => { u.hitBonus = (u.hitBonus ?? 0) + 1; u.acBonus += 1; },
  },
};

/** Equip a list of item ids on a unit (after levelling). */
export function applyItems(unit, items = []) {
  unit.items = [...items];
  for (const id of items) ITEMS[id]?.apply?.(unit);
  return unit;
}

// Relics: each boss leaves one behind. A relic isn't worn: it works for the whole party for
// the rest of the run (and into New Game+). `boss` is the room (level id) that drops it.
export const RELICS = {
  phylactery: {
    name: 'Morvath’s Phylactery', boss: 'sanctum',
    desc: 'The first hero who would drop to 0 HP stays on 1 HP instead. Once used, it sleeps until the next long rest.',
  },
  horn: {
    name: 'Varek’s Barrow Horn', boss: 'barrow',
    desc: 'The heroes take the top of the turn order in every fight.',
  },
  veil: {
    name: 'Ysolde’s Veil', boss: 'throne',
    desc: 'The party starts every fight hidden (15 + Stealth, even in plate). Each hero stays hidden until they attack or cast, get hurt, or a sharp-eyed monster spots them.',
  },
  jar: {
    name: 'Nekhet’s Embalming Jar', boss: 'tomb',
    desc: 'The short rest after a room heals three-quarters of everyone’s missing HP, not half.',
  },
  thread: {
    name: 'Tharok’s Red Thread', boss: 'labyrinth',
    desc: 'The thread that marks every way out of the labyrinth: each hero moves one tile further every turn.',
  },
};

/** The relic a boss room (level id) leaves behind, or null. */
export function relicFrom(levelId) {
  return Object.keys(RELICS).find((id) => RELICS[id].boss === levelId) ?? null;
}

/** A list of relic ids kept to known ones, each once, in table order. */
export function cleanRelics(list) {
  return Array.isArray(list) ? Object.keys(RELICS).filter((id) => list.includes(id)) : [];
}

/** Rules 10: the spell scrolls, cheapest first. */
export const SCROLLS = Object.keys(ITEMS).filter((id) => ITEMS[id].kind === 'scroll');
/** Can a hero of class `code` read scroll `id`? Only with the spell on the class's list. */
export const readsScroll = (code, id) => ITEMS[id]?.kind === 'scroll' && classSpells(code).has(ITEMS[id].spell);
