// Stat blocks. Numbers follow the SRD 5.1 (CC-BY-4.0) where possible.
// speed and reach are in tiles (1 tile = 5 ft).
// An attack's `rider` is a save the target makes when hit, or gains a condition
// (combat.js applyRider), e.g. { save: 'con', dc: 10, condition: 'poisoned', turns: 1 }.

/** Filthy bites and fouled arrows: poisoned until the end of the victim's next turn. */
const POISON_DC10 = { save: 'con', dc: 10, condition: 'poisoned', turns: 1 };

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
  // The Paladin can take the Fighter's place in the party (chosen on the title screen).
  P: {
    name: 'Brannoc', cls: 'Paladin', team: 'heroes', color: 0xe0c060,
    hp: 28, ac: 18, speed: 6, prof: 2, level: 3, // chain mail + shield
    noisyArmor: true, // chain mail: disadvantage on Stealth
    potions: 1,
    castStat: 'cha',
    spells: ['layOnHands', 'shieldOfFaith'],
    slots: { 1: 3 },
    layOnHands: 15, // the pool of healing: 5 × paladin level, back after a long rest
    passives: ['divineSmite', 'dueling'],
    stats: { str: 16, dex: 10, con: 14, int: 8, wis: 10, cha: 16 },
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
  // The Warlock (Fiend patron) can take the Wizard's place: two pact slots that come back
  // after every room, Eldritch Blast with Agonizing Blast (CHA to damage), Hex, and
  // Dark One's Blessing (temporary HP on a kill). Armor of Shadows gives Mage Armor's AC.
  K: {
    name: 'Ilsa', cls: 'Warlock', team: 'heroes', color: 0xb03a3a,
    hp: 24, ac: 15, speed: 6, prof: 2, level: 3,
    castStat: 'cha',
    spells: ['hex', 'scorchingRay', 'burningHands'],
    slots: { 2: 2 },
    pactMagic: true, // slots come back after every room (a short rest)
    passives: ['hellishRebuke', 'darkOnesBlessing'],
    ai: 'skirmisher',
    stats: { str: 8, dex: 14, con: 14, int: 12, wis: 10, cha: 16 },
    attacks: [
      { name: 'Eldritch Blast', stat: 'cha', damage: '1d10', reach: 24, projectile: 'eldritch' },
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
  // The Ranger (a Hunter) can take the Rogue's place: a longbow and Hunter's Mark, with
  // Colossus Slayer from level 5 (SRD: 3) so it doesn't outclass the Rogue. Keeps the
  // Rogue's eye for traps so the slot still finds them.
  A: {
    name: 'Wren', cls: 'Ranger', team: 'heroes', color: 0x9a7a4a,
    hp: 24, ac: 15, speed: 6, prof: 2, level: 3, // studded leather; HP below the SRD's 28 to offset the bow
    stealth: 'trained',
    ai: 'skirmisher', // when the AI plays it (autoplay, the simulator): keep away and shoot
    castStat: 'wis',
    spells: ['huntersMark'], // no Cure Wounds: the slot doesn't heal, as the Rogue's doesn't
    slots: { 1: 3 },
    passives: ['archery', 'trapSense'],
    stats: { str: 12, dex: 16, con: 14, int: 10, wis: 14, cha: 8 },
    attacks: [
      { name: 'Shortsword', stat: 'dex', damage: '1d6', reach: 1 },
      { name: 'Longbow', stat: 'dex', damage: '1d8', reach: 24, projectile: 'arrow' },
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
    features: ['nimbleEscape', 'nimbleHide'],
    stealth: 'expert', // SRD Stealth +6
    ai: 'skirmisher', // prefers shooting from a safe distance, then ducks out of sight
    stats: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
    attacks: [
      { name: 'Scimitar', stat: 'dex', damage: '1d6', reach: 1 },
      // Dipped in something foul (a house rule: SRD goblin arrows aren't poisoned).
      { name: 'Shortbow', stat: 'dex', damage: '1d6', reach: 16, projectile: 'arrow', rider: POISON_DC10 },
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
    attacks: [{ name: 'Bite', stat: 'dex', damage: '1d4', reach: 1, rider: POISON_DC10 }],
  },
  b: {
    name: 'Grukk', cls: 'Goblin Boss', team: 'monsters', color: 0x8a3a2a,
    hp: 21, ac: 17, speed: 6, prof: 2, xp: 200, cr: 1,
    features: ['nimbleEscape'],
    multiattack: 2,
    clumsyMultiattack: true, // the second attack has disadvantage (SRD goblin boss)
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
    spells: ['animateDead', 'dread'],
    slots: { 1: 2, 3: 2 },
    ai: 'caster', // keeps its distance, raises the dead, frightens the bold
    stats: { str: 9, dex: 14, con: 12, int: 17, wis: 12, cha: 11 },
    attacks: [
      { name: 'Chill Touch', stat: 'int', damage: '1d8', reach: 24, addMod: false, projectile: 'necro' },
      { name: 'Dagger', stat: 'dex', damage: '1d4', reach: 1 },
    ],
  },
  // --- act two ---------------------------------------------------------------
  u: {
    name: 'Ghoul', cls: 'Ghoul', team: 'monsters', color: 0x8a9a78,
    hp: 32, ac: 13, speed: 6, prof: 2, xp: 200, cr: 1,
    multiattack: 2, // claw, claw
    ai: 'brute',
    undead: true,
    stats: { str: 13, dex: 15, con: 10, int: 7, wis: 10, cha: 6 },
    attacks: [
      // SRD ghoul claws paralyse; here the grave-filth only poisons (DC 10 CON).
      { name: 'Claws', stat: 'dex', damage: '2d4', reach: 1, rider: { save: 'con', dc: 10, condition: 'poisoned', turns: 2 } },
    ],
  },
  // The ghouls' elder: tougher, and its stench turns the stomach of anyone close by.
  h: {
    name: 'Ghast', cls: 'Ghast', team: 'monsters', color: 0x6f7d5c,
    hp: 52, ac: 13, speed: 6, prof: 2, xp: 450, cr: 2,
    multiattack: 2,
    ai: 'brute',
    undead: true,
    stench: { dc: 10 }, // a hero starting its turn next to it: CON save or poisoned (combat.js)
    stats: { str: 16, dex: 17, con: 10, int: 11, wis: 10, cha: 8 },
    attacks: [
      { name: 'Claws', stat: 'dex', damage: '2d6', reach: 1, rider: { save: 'con', dc: 12, condition: 'poisoned', turns: 2 } },
    ],
  },
  w: {
    name: 'Varek', cls: 'Wight', team: 'monsters', color: 0x5a6a88,
    hp: 110, ac: 15, speed: 6, prof: 2, xp: 700, cr: 3,
    multiattack: 2,
    ai: 'brute',
    undead: true,
    castStat: 'cha',
    spells: ['dread'],
    slots: { 1: 3 },
    stats: { str: 15, dex: 14, con: 16, int: 10, wis: 13, cha: 15 },
    attacks: [
      { name: 'Longsword', stat: 'str', damage: '1d10', reach: 1 },
      { name: 'Longbow', stat: 'dex', damage: '1d8', reach: 24, projectile: 'arrow' },
    ],
  },
  m: {
    name: 'Mimic', cls: 'Mimic', team: 'monsters', color: 0x7a4a24,
    hp: 70, ac: 12, speed: 3, prof: 2, xp: 450, cr: 2,
    multiattack: 2,
    ai: 'brute',
    huge: true, // too heavy to shove over
    stats: { str: 17, dex: 12, con: 15, int: 5, wis: 13, cha: 8 },
    attacks: [
      // A sticky pseudopod slam: STR save or you are dragged off your feet.
      { name: 'Pseudopod', stat: 'str', damage: '2d8', reach: 1, rider: { save: 'str', dc: 13, condition: 'prone' } },
    ],
  },
  // --- act three -------------------------------------------------------------
  // SRD giant spider. Its web (Recharge 5–6) restrains whoever it hits until the end of
  // their next turn (SRD: until they break free, DC 12); the bite's venom poisons rather
  // than adding 2d8 poison damage.
  k: {
    name: 'Giant Spider', cls: 'Giant Spider', team: 'monsters', color: 0x3a3440,
    hp: 26, ac: 14, speed: 6, prof: 2, xp: 200, cr: 1,
    ai: 'brute',
    stats: { str: 14, dex: 16, con: 12, int: 2, wis: 11, cha: 4 },
    attacks: [
      { name: 'Bite', stat: 'dex', damage: '1d8', reach: 1, rider: { save: 'con', dc: 11, condition: 'poisoned', turns: 1 } },
      { name: 'Web', stat: 'dex', damage: null, reach: 6, recharge: 5, projectile: 'web', rider: { condition: 'restrained', turns: 1 } },
    ],
  },
  // SRD specter: a Life Drain touch (3d6 necrotic). Here its chill frightens (WIS save)
  // instead of lowering the victim's maximum HP, which the campaign doesn't track.
  e: {
    name: 'Specter', cls: 'Specter', team: 'monsters', color: 0xb8c8d8,
    hp: 22, ac: 12, speed: 8, prof: 2, xp: 200, cr: 1,
    flies: true, // drifts over difficult ground (Ice Storm)
    ai: 'brute',
    undead: true,
    stats: { str: 1, dex: 14, con: 11, int: 10, wis: 10, cha: 11 },
    attacks: [
      { name: 'Life Drain', stat: 'dex', damage: '3d6', reach: 1, addMod: false, rider: { save: 'wis', dc: 11, condition: 'frightened', turns: 2 } },
    ],
  },
  // The last boss: a banshee (SRD Corrupting Touch and Horrifying Visage, as Dread), made
  // tougher and given a second touch to stand up to a level 6 party. No Wail. The touch
  // aims with her Charisma: at +5 (Dex) she missed armoured heroes so often that a rested
  // party beat her 99% of the time; she now carries the fight instead of her escort.
  q: {
    name: 'Ysolde', cls: 'Banshee', team: 'monsters', color: 0xd8e4f0,
    hp: 130, ac: 14, speed: 8, prof: 3, xp: 1100, cr: 4,
    flies: true, // drifts over difficult ground (Ice Storm)
    multiattack: 2,
    ai: 'brute',
    undead: true,
    castStat: 'cha',
    spells: ['dread'],
    slots: { 1: 3 },
    stats: { str: 1, dex: 14, con: 10, int: 12, wis: 11, cha: 17 },
    attacks: [
      { name: 'Corrupting Touch', stat: 'cha', damage: '4d6', reach: 1, addMod: false, rider: { save: 'wis', dc: 13, condition: 'frightened', turns: 2 } },
    ],
  },
  // --- act four --------------------------------------------------------------
  // SRD mummy: slow, with a Rotting Fist (2d6+3 bludgeoning and 3d6 necrotic, folded into
  // one roll here; its curse is left out) and a Dreadful Glare (Dread).
  y: {
    name: 'Mummy', cls: 'Mummy', team: 'monsters', color: 0xc8b88a,
    hp: 58, ac: 11, speed: 4, prof: 2, xp: 700, cr: 3,
    ai: 'brute',
    undead: true,
    castStat: 'wis',
    spells: ['dread'],
    slots: { 1: 1 },
    stats: { str: 16, dex: 8, con: 15, int: 6, wis: 10, cha: 12 },
    attacks: [{ name: 'Rotting Fist', stat: 'str', damage: '5d6', reach: 1 }],
  },
  // SRD wraith: Life Drain without the lowered maximum HP, and no specters of its own.
  t: {
    name: 'Wraith', cls: 'Wraith', team: 'monsters', color: 0x4a3a60,
    hp: 67, ac: 13, speed: 8, prof: 3, xp: 1800, cr: 5,
    flies: true, // drifts over difficult ground (Ice Storm)
    ai: 'brute',
    undead: true,
    stats: { str: 6, dex: 16, con: 16, int: 12, wis: 14, cha: 15 },
    attacks: [{ name: 'Life Drain', stat: 'dex', damage: '4d8', reach: 1 }],
  },
  // The SRD knight, fallen to the tomb's lord: sword and shield (no Parry), and javelins.
  // Living, so Turn Undead does nothing to them.
  x: {
    name: 'Fallen Knight', cls: 'Knight', team: 'monsters', color: 0x3a3a48,
    hp: 52, ac: 18, speed: 6, prof: 2, xp: 700, cr: 3,
    multiattack: 2,
    ai: 'brute',
    stats: { str: 16, dex: 11, con: 14, int: 11, wis: 11, cha: 15 },
    attacks: [
      { name: 'Longsword', stat: 'str', damage: '1d10', reach: 1 },
      { name: 'Javelin', stat: 'str', damage: '1d6', reach: 6, projectile: 'javelin' },
    ],
  },
  // The last boss: an SRD mummy lord, cut down to stand against a level 7–8 party. Two
  // Rotting Fists and its Dreadful Glare (Dread); no legendary actions or cleric spells.
  l: {
    name: 'Nekhet', cls: 'Mummy Lord', team: 'monsters', color: 0xd8b860,
    hp: 135, ac: 17, speed: 4, prof: 3, xp: 3000, cr: 6,
    multiattack: 2,
    ai: 'brute',
    undead: true,
    castStat: 'wis',
    spells: ['dread'],
    slots: { 1: 3 },
    rises: 2, // at half HP his house rises (Game.houseRises)
    stats: { str: 18, dex: 10, con: 17, int: 11, wis: 18, cha: 16 },
    attacks: [{ name: 'Rotting Fist', stat: 'str', damage: '4d6', reach: 1 }],
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
    slot: code,         // the party slot a hero fills (a Paladin plays in the Fighter's 'F', a Ranger in the Rogue's 'R')
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
    channelUsed: 0,     // Turn Undead uses this fight (of channelUses)
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
    layOnHandsMax: t.layOnHands ?? 0,
    smiteArmed: false,  // Divine Smite on the next melee hit
    faithFrom: null,    // the paladin whose Shield of Faith is on it (+2 AC)
    spiritWeapon: null, // a cleric's Spiritual Weapon: { x, z, slot } once cast this fight
    mark: null,         // Hunter's Mark or Hex: { id, slot, spell } of the marked foe
    tempHp: 0,          // temporary HP (Dark One's Blessing): lost first, gone after the fight
    rebukeArmed: false, // Hellish Rebuke on the next enemy that damages it
    luckUsed: false,    // Dark One's Own Luck, once per fight
    colossusUsed: false, // Colossus Slayer, once per turn
    strikeUsed: false,  // Divine Strike, once per turn
    deathWard: false,   // Death Ward: the next drop to 0 HP leaves 1 instead
    conditions: {},     // prone / poisoned / frightened (combat.js)
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
    6: { hp: 8, stats: { str: 2 }, note: 'Strength 20: +1 to hit and damage' },
    7: { hp: 8, critRange: 19, passives: ['improvedCritical'], note: 'Improved Critical: weapon hits crit on a 19 or 20' },
    8: { hp: 16, stats: { con: 2 }, note: 'Constitution 17: +8 hit points' },
  },
  P: {
    4: { hp: 8, stats: { str: 2 }, note: 'Strength 18: +1 to hit and damage' },
    5: {
      hp: 8, prof: 3, extraAttack: 2, slots: { 1: 4, 2: 2 }, passives: ['extraAttack'],
      note: 'Extra Attack, and two 2nd-level slots for bigger Smites',
    },
    6: { hp: 8, passives: ['auraOfProtection'], note: 'Aura of Protection: allies within 10 ft add your CHA to saves' },
    7: { hp: 8, slots: { 2: 3 }, note: 'A third 2nd-level slot for Smites' },
    8: { hp: 8, stats: { cha: 2 }, note: 'Charisma 18: a stronger Aura of Protection and spell DC' },
  },
  W: {
    4: { hp: 5, stats: { int: 2 }, slots: { 2: 3 }, note: 'Intelligence 18, a third 2nd-level slot' },
    5: { hp: 5, prof: 3, slots: { 3: 2 }, spells: ['fireball', 'lightningBolt'], note: 'Fireball, Lightning Bolt and two 3rd-level slots' },
    6: {
      hp: 5, slots: { 3: 3 }, sculpt: true, passives: ['sculptSpells'],
      note: 'Sculpt Spells: Fireball, Lightning Bolt and Burning Hands spare the party; a third 3rd-level slot',
    },
    7: { hp: 5, slots: { 4: 1 }, spells: ['iceStorm'], note: 'Ice Storm and a 4th-level slot' },
    8: { hp: 5, slots: { 4: 2 }, stats: { int: 2 }, note: 'Intelligence 20 and a second 4th-level slot' },
  },
  K: {
    4: { hp: 7, stats: { cha: 2 }, note: 'Charisma 18: +1 to Eldritch Blast hits and damage, and to your spell DC' },
    5: {
      hp: 7, prof: 3, slots: { 2: 0, 3: 2 }, spells: ['fireball'], extraAttack: 2, extraAttackWith: 'Eldritch Blast',
      note: 'Eldritch Blast fires two beams, Fireball, and your pact slots become 3rd level',
    },
    6: { hp: 7, passives: ['ownLuck'], note: 'Dark One’s Own Luck: once per room, add 1d10 to a failed save' },
    7: { hp: 7, slots: { 3: 0, 4: 2 }, note: 'Your pact slots become 4th level' },
    8: { hp: 7, stats: { cha: 2 }, note: 'Charisma 20: +1 to Eldritch Blast hits and damage, and to your spell DC' },
  },
  R: {
    4: { hp: 6, stats: { dex: 2 }, ac: 1, note: 'Dexterity 18: +1 to hit, damage and AC' },
    5: { hp: 6, prof: 3, sneakDice: 3, passives: ['uncannyDodge'], note: 'Sneak Attack 3d6 and Uncanny Dodge' },
    6: { hp: 6, sneakDice: 4, note: 'Sneak Attack 4d6' },
    7: { hp: 6, passives: ['evasion'], note: 'Evasion: no damage from a DEX save you make, half from one you fail' },
    8: { hp: 6, stats: { dex: 2 }, ac: 1, note: 'Dexterity 20: +1 to hit, damage and AC' },
  },
  A: {
    4: { hp: 8, stats: { dex: 2 }, ac: 1, note: 'Dexterity 18: +1 to hit, damage and AC' },
    5: {
      hp: 8, prof: 3, extraAttack: 2, slots: { 1: 4, 2: 2 }, passives: ['extraAttack', 'colossusSlayer'],
      note: 'Extra Attack and Colossus Slayer (+1d8 once per turn on a hurt foe)',
    },
    6: { hp: 8, passives: ['escapeTheHorde'], note: 'Escape the Horde: opportunity attacks against you have disadvantage' },
    7: { hp: 8, slots: { 2: 3 }, note: 'A third 2nd-level slot for Hunter’s Mark' },
    8: { hp: 8, stats: { dex: 2 }, ac: 1, note: 'Dexterity 20: +1 to hit, damage and AC' },
  },
  C: {
    4: { hp: 7, stats: { wis: 2 }, slots: { 2: 3 }, note: 'Wisdom 18, a third 2nd-level slot' },
    5: {
      hp: 7, prof: 3, slots: { 3: 2 }, spells: ['massHealingWord', 'spiritualWeapon'], destroyUndead: 0.5,
      passives: ['destroyUndead'], note: 'Mass Healing Word, Spiritual Weapon, Destroy Undead and two 3rd-level slots',
    },
    6: {
      hp: 7, slots: { 3: 3 }, channelUses: 2, passives: ['blessedHealer'],
      note: 'Turn Undead twice per fight, Blessed Healer and a third 3rd-level slot',
    },
    7: { hp: 7, slots: { 4: 1 }, spells: ['deathWard'], note: 'Death Ward and a 4th-level slot' },
    8: {
      hp: 7, slots: { 4: 2 }, stats: { wis: 2 }, destroyUndead: 1, passives: ['divineStrike'],
      note: 'Wisdom 20, Divine Strike (+1d8 on a weapon hit), Destroy Undead up to CR 1 and a second 4th-level slot',
    },
  },
};

export const MAX_LEVEL = 8;

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
  if (unit.spells.includes('layOnHands')) unit.layOnHands = unit.layOnHandsMax = 5 * unit.level;
  return unit;
}

/** Classes that can fill each hero slot: the first is the default. */
export const CLASS_CHOICES = { F: ['F', 'P'], W: ['W', 'K'], R: ['R', 'A'], C: ['C'] };

/** The class (template code) a party record plays in a slot. */
export const classOf = (slot, rec) => (CLASS_CHOICES[slot]?.includes(rec?.cls) ? rec.cls : slot);
