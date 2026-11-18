// Stat blocks. Numbers follow the SRD 5.1 (CC-BY-4.0) where possible.
// speed and reach are in tiles (1 tile = 5 ft).

export const TEMPLATES = {
  F: {
    name: 'Brannoc', cls: 'Fighter', team: 'heroes', color: 0x3b6fd8,
    hp: 31, ac: 17, speed: 6, prof: 2, level: 3,
    features: ['secondWind'],
    noisyArmor: true, // splint: disadvantage on Stealth
    potions: 1,
    stats: { str: 16, dex: 12, con: 15, int: 10, wis: 12, cha: 10 },
    attacks: [
      { name: 'Longsword', stat: 'str', damage: '1d8', reach: 1 },
      { name: 'Javelin', stat: 'str', damage: '1d6', reach: 6, projectile: 'javelin' },
    ],
  },
  W: {
    name: 'Ilsa', cls: 'Wizard', team: 'heroes', color: 0x8b4fd6,
    hp: 20, ac: 15, speed: 6, prof: 2, level: 3, // AC from Mage Armor
    castStat: 'int',
    spells: ['magicMissile', 'burningHands', 'mistyStep', 'shield'],
    slots: { 1: 4, 2: 2 },
    autoShield: true,
    stats: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
    attacks: [
      { name: 'Fire Bolt', stat: 'int', damage: '1d10', reach: 24, addMod: false, projectile: 'fire' },
      { name: 'Dagger', stat: 'dex', damage: '1d4', reach: 1 },
    ],
  },
  R: {
    name: 'Wren', cls: 'Rogue', team: 'heroes', color: 0x3a8f6a,
    hp: 24, ac: 14, speed: 6, prof: 2, level: 3,
    features: ['cunningDash', 'cunningDisengage', 'cunningHide'],
    stealth: 'expert',
    passives: ['sneakAttack', 'trapSense', 'skulker'],
    stats: { str: 10, dex: 16, con: 12, int: 12, wis: 14, cha: 12 },
    attacks: [
      { name: 'Shortsword', stat: 'dex', damage: '1d6', reach: 1 },
      { name: 'Shortbow', stat: 'dex', damage: '1d6', reach: 16, projectile: 'arrow' },
    ],
  },
  C: {
    name: 'Maela', cls: 'Cleric', team: 'heroes', color: 0xd8c36a,
    hp: 24, ac: 18, speed: 6, prof: 2, level: 3, // chain mail + shield
    features: ['turnUndead'],
    noisyArmor: true, // chain mail: disadvantage on Stealth
    castStat: 'wis',
    spells: ['sacredFlame', 'cureWounds', 'healingWord'],
    slots: { 1: 4, 2: 2 },
    stats: { str: 14, dex: 10, con: 14, int: 10, wis: 16, cha: 12 },
    attacks: [
      { name: 'Mace', stat: 'str', damage: '1d6', reach: 1 },
    ],
  },
  g: {
    name: 'Goblin', cls: 'Goblin', team: 'monsters', color: 0x5f8f2a,
    hp: 7, ac: 15, speed: 6, prof: 2, xp: 50, cr: 0.25,
    features: ['nimbleEscape'],
    ai: 'skirmisher', // prefers shooting from a safe distance
    stats: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
    attacks: [
      { name: 'Scimitar', stat: 'dex', damage: '1d6', reach: 1 },
      { name: 'Shortbow', stat: 'dex', damage: '1d6', reach: 16, projectile: 'arrow' },
    ],
  },
  s: {
    name: 'Skeleton', cls: 'Skeleton', team: 'monsters', color: 0xd9d2c3,
    hp: 13, ac: 13, speed: 6, prof: 2, xp: 50, cr: 0.25,
    ai: 'brute', // walks up and hits things
    undead: true,
    stats: { str: 10, dex: 14, con: 15, int: 6, wis: 8, cha: 5 },
    attacks: [
      { name: 'Shortsword', stat: 'dex', damage: '1d6', reach: 1 },
      { name: 'Shortbow', stat: 'dex', damage: '1d6', reach: 16, projectile: 'arrow' },
    ],
  },
  o: {
    name: 'Orc', cls: 'Orc', team: 'monsters', color: 0x6d7f5a,
    hp: 15, ac: 13, speed: 6, prof: 2, xp: 100, cr: 0.5,
    features: ['aggressive'],
    ai: 'brute',
    stats: { str: 16, dex: 12, con: 16, int: 7, wis: 11, cha: 10 },
    attacks: [
      { name: 'Greataxe', stat: 'str', damage: '1d12', reach: 1 },
      { name: 'Javelin', stat: 'str', damage: '1d6', reach: 6, projectile: 'javelin' },
    ],
  },
  r: {
    name: 'Giant Rat', cls: 'Giant Rat', team: 'monsters', color: 0x6b5a4c,
    hp: 7, ac: 12, speed: 6, prof: 2, xp: 25, cr: 0.125,
    passives: ['packTactics'],
    ai: 'brute',
    stats: { str: 7, dex: 15, con: 11, int: 2, wis: 10, cha: 4 },
    attacks: [{ name: 'Bite', stat: 'dex', damage: '1d4', reach: 1 }],
  },
  b: {
    name: 'Grukk', cls: 'Goblin Boss', team: 'monsters', color: 0x8a3a2a,
    hp: 21, ac: 17, speed: 6, prof: 2, xp: 200, cr: 1,
    features: ['nimbleEscape'],
    multiattack: 2, // the second attack has disadvantage (SRD)
    ai: 'brute',
    stats: { str: 10, dex: 14, con: 10, int: 10, wis: 8, cha: 10 },
    attacks: [
      { name: 'Scimitar', stat: 'dex', damage: '1d6', reach: 1 },
      { name: 'Javelin', stat: 'str', damage: '1d6', reach: 6, projectile: 'javelin' },
    ],
  },
  n: {
    name: 'Morvath', cls: 'Necromancer', team: 'monsters', color: 0x3d2a4f,
    hp: 24, ac: 12, speed: 6, prof: 2, xp: 450, cr: 2, level: 5,
    castStat: 'int',
    spells: ['animateDead'],
    slots: { 3: 2 },
    ai: 'caster', // keeps its distance, raises the dead
    stats: { str: 9, dex: 14, con: 12, int: 17, wis: 12, cha: 11 },
    attacks: [
      { name: 'Chill Touch', stat: 'int', damage: '1d8', reach: 24, addMod: false, projectile: 'necro' },
      { name: 'Dagger', stat: 'dex', damage: '1d4', reach: 1 },
    ],
  },
};

let nextId = 1;

export function createUnit(code, x, z, number = 1, total = 1) {
  const t = TEMPLATES[code];
  if (!t) throw new Error(`Unknown unit code "${code}"`);
  return {
    ...structuredClone(t),
    id: nextId++,
    code,
    name: total > 1 ? `${t.name} ${number}` : t.name,
    variant: number, // lets the renderer vary look between copies
    maxHp: t.hp,
    hp: t.hp,
    x,
    z,
    alive: true,
    initiative: 0,
    features: t.features ? [...t.features] : [],
    passives: t.passives ? [...t.passives] : [],
    potions: t.potions ?? 0,
    items: [],          // magic items worn (campaign loot)
    weaponBonus: 0,     // +N weapons
    acBonus: 0,         // ring of protection etc.
    saveBonus: 0,
    attacksLeft: 0,     // extra attacks left this turn (Multiattack)
    sneakUsed: false,
    turned: 0,          // turns left fleeing from Turn Undead
    channelUsed: false, // Turn Undead
    corpse: false,
    spells: t.spells ? [...t.spells] : [],
    slots: t.slots ? { ...t.slots } : {},
    slotMax: t.slots ? { ...t.slots } : {},
    movesLeft: 0,
    actionUsed: false,
    bonusUsed: false,
    reactionUsed: false,
    dodging: false,     // until the start of its next turn
    disengaged: false,  // this turn
    shielded: false,    // Shield spell, until the start of its next turn
    secondWindUsed: false,
  };
}

/**
 * What each hero gains on reaching a level. Heroes start at level 3 (their stat blocks
 * above). hp is added to max HP; stats are added; slots set the slot maximum per level;
 * spells / passives are learned; other keys are copied onto the unit.
 */
export const PROGRESSION = {
  F: {
    4: { hp: 8, stats: { str: 2 }, note: 'Strength 18: +1 to hit and damage' },
    5: { hp: 8, prof: 3, extraAttack: 2, passives: ['extraAttack'], note: 'Extra Attack: two swings per Attack action' },
  },
  W: {
    4: { hp: 5, stats: { int: 2 }, slots: { 2: 3 }, note: 'Intelligence 18, a third 2nd-level slot' },
    5: { hp: 5, prof: 3, slots: { 3: 2 }, spells: ['fireball'], note: 'Fireball and two 3rd-level slots' },
  },
  R: {
    4: { hp: 6, stats: { dex: 2 }, ac: 1, note: 'Dexterity 18: +1 to hit, damage and AC' },
    5: { hp: 6, prof: 3, sneakDice: 3, passives: ['uncannyDodge'], note: 'Sneak Attack 3d6 and Uncanny Dodge' },
  },
  C: {
    4: { hp: 7, stats: { wis: 2 }, slots: { 2: 3 }, note: 'Wisdom 18, a third 2nd-level slot' },
    5: {
      hp: 7, prof: 3, slots: { 3: 2 }, spells: ['massHealingWord'], destroyUndead: 0.5,
      passives: ['destroyUndead'], note: 'Mass Healing Word, Destroy Undead and two 3rd-level slots',
    },
  },
};

export const MAX_LEVEL = 5;

/** Raise a freshly created unit to `level`. Slots are refilled to the new maximum. */
export function applyLevel(unit, level) {
  const table = PROGRESSION[unit.code];
  if (!table || !unit.level) return unit;
  for (let l = unit.level + 1; l <= Math.min(level, MAX_LEVEL); l++) {
    const g = table[l];
    if (!g) continue;
    const { hp = 0, stats = {}, slots = {}, spells = [], passives = [], note, ac = 0, ...rest } = g;
    unit.maxHp += hp;
    unit.hp += hp;
    unit.ac += ac;
    for (const [k, v] of Object.entries(stats)) unit.stats[k] += v;
    for (const [k, v] of Object.entries(slots)) unit.slotMax[k] = v;
    unit.spells.push(...spells.filter((s) => !unit.spells.includes(s)));
    unit.passives.push(...passives.filter((p) => !unit.passives.includes(p)));
    Object.assign(unit, rest);
    unit.level = l;
  }
  unit.slots = { ...unit.slotMax };
  return unit;
}
