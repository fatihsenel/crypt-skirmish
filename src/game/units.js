import { abilityMod } from './dice.js';

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
  // The Barbarian (a Berserker) can take the Fighter's place: Rage, Reckless Attack and
  // Frenzy. Unarmored Defense: 10 + DEX + CON. Rage lasts the whole fight (a house rule).
  Z: {
    name: 'Brannoc', cls: 'Barbarian', team: 'heroes', color: 0xb5562e,
    hp: 35, ac: 15, speed: 6, prof: 2, level: 3,
    features: ['rage', 'reckless'],
    passives: ['dangerSense', 'frenzy'],
    potions: 1,
    stats: { str: 16, dex: 14, con: 16, int: 8, wis: 12, cha: 10 },
    attacks: [
      { name: 'Greataxe', stat: 'str', damage: '1d12', reach: 1 },
      { name: 'Handaxe', stat: 'str', damage: '1d6', reach: 4, projectile: 'javelin' },
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
  // The Sorcerer (Draconic bloodline) can take the Wizard's place: fewer spells, but
  // Quickened Spell puts one on a bonus action. Draconic Resilience: AC 13 + DEX, +1 HP a level.
  S: {
    name: 'Ilsa', cls: 'Sorcerer', team: 'heroes', color: 0xd0532a,
    hp: 23, ac: 15, speed: 6, prof: 2, level: 3,
    castStat: 'cha',
    spells: ['burningHands', 'scorchingRay', 'mistyStep', 'shield'],
    slots: { 1: 4, 2: 2 },
    autoShield: true,
    features: ['quicken'],
    sorcery: 3, // sorcery points: the sorcerer's level, back every fight
    stats: { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 16 },
    attacks: [
      { name: 'Fire Bolt', stat: 'cha', damage: '1d10', reach: 24, addMod: false, projectile: 'fire' },
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
  // The Monk (Way of the Open Hand) can take the Rogue's place: Martial Arts, ki for Flurry
  // of Blows, Patient Defense and Step of the Wind, and Deflect Missiles. Unarmored Defense:
  // 10 + DEX + WIS. Keeps the Rogue's eye for traps.
  M: {
    name: 'Wren', cls: 'Monk', team: 'heroes', color: 0xd09a3a,
    hp: 24, ac: 15, speed: 8, prof: 2, level: 3,
    features: ['flurry', 'patientDefense', 'stepOfTheWind'],
    ki: 3, // ki points: the monk's level, back every fight
    stealth: 'trained',
    passives: ['martialArts', 'deflectMissiles', 'openHand', 'trapSense'],
    stats: { str: 10, dex: 16, con: 14, int: 10, wis: 14, cha: 8 },
    attacks: [
      { name: 'Unarmed Strike', stat: 'dex', damage: '1d4', reach: 1, unarmed: true },
      { name: 'Shortsword', stat: 'dex', damage: '1d6', reach: 1 },
      { name: 'Darts', stat: 'dex', damage: '1d4', reach: 4, projectile: 'arrow' },
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
  B: {
    name: 'Maela', cls: 'Bard', team: 'heroes', color: 0x4f7fd0,
    hp: 24, ac: 14, speed: 6, prof: 2, level: 3, // leather armour
    castStat: 'cha',
    spells: ['viciousMockery', 'bardicInspiration', 'healingWord', 'cureWounds', 'shatter'],
    slots: { 1: 4, 2: 2 },
    inspiration: 3, // Bardic Inspiration uses (the CHA modifier), back every fight
    inspirationDie: 6,
    passives: ['cuttingWords'],
    stats: { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 16 },
    attacks: [
      { name: 'Rapier', stat: 'dex', damage: '1d8', reach: 1 },
    ],
  },
  // The Druid (Circle of the Land) can take the Cleric's place: Shillelagh and Produce
  // Flame, Entangle and Thunderwave, Call Lightning at 5. No Wild Shape (a house rule).
  D: {
    name: 'Maela', cls: 'Druid', team: 'heroes', color: 0x5f9a3a,
    hp: 24, ac: 15, speed: 6, prof: 2, level: 3, // hide armour + a wooden shield
    dexCap: 2, // medium armour: at most +2 from DEX
    castStat: 'wis',
    spells: ['entangle', 'thunderwave', 'healingWord', 'cureWounds'],
    slots: { 1: 4, 2: 2 },
    stats: { str: 10, dex: 12, con: 14, int: 12, wis: 16, cha: 8 },
    attacks: [
      { name: 'Shillelagh', stat: 'wis', weapon: true, damage: '1d8', reach: 1 },
      { name: 'Produce Flame', stat: 'wis', damage: '1d8', reach: 6, addMod: false, projectile: 'fire' },
    ],
  },
  g: {
    name: 'Goblin', cls: 'Goblin', team: 'monsters', color: 0x5f8f2a,
    hp: 7, ac: 15, speed: 6, prof: 2, xp: 50, cr: 0.25,
    morale: true, // rules 7: may break and run when badly hurt or when its leader falls
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
    morale: true,
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
    morale: true,
    passives: ['packTactics'],
    ai: 'brute',
    stats: { str: 7, dex: 15, con: 11, int: 2, wis: 10, cha: 4 },
    attacks: [{ name: 'Bite', stat: 'dex', damage: '1d4', reach: 1, rider: POISON_DC10 }],
  },
  b: {
    name: 'Grukk', cls: 'Goblin Boss', team: 'monsters', color: 0x8a3a2a,
    hp: 21, ac: 17, speed: 6, prof: 2, xp: 200, cr: 1,
    leader: true, // rules 7: when he falls, his followers test their morale
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
    lurks: true, // rules 5: in a room on two floors, it waits on its own floor (Game#lurking)
    stats: { str: 13, dex: 15, con: 10, int: 7, wis: 10, cha: 6 },
    attacks: [
      // SRD ghoul claws paralyse (rules 2: a CON save as each turn starts ends it, 10 turns
      // at most). Fights under the first rules keep the old poison (DC 10 CON).
      { name: 'Claws', stat: 'dex', damage: '2d4', reach: 1, rider: { save: 'con', dc: 10, condition: 'poisoned', turns: 2, v2: { save: 'con', dc: 10, condition: 'paralyzed', turns: 10 } } },
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
      { name: 'Web', stat: 'dex', damage: null, reach: 6, long: 12, recharge: 5, projectile: 'web', rider: { condition: 'restrained', turns: 1 } },
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
  // one roll here; its curse is cut down to a short rot that blocks healing) and a Dreadful
  // Glare (Dread).
  y: {
    name: 'Mummy', cls: 'Mummy', team: 'monsters', color: 0xc8b88a,
    hp: 58, ac: 11, speed: 4, prof: 2, xp: 700, cr: 3,
    ai: 'brute',
    undead: true,
    castStat: 'wis',
    spells: ['dread'],
    slots: { 1: 1 },
    stats: { str: 16, dex: 8, con: 15, int: 6, wis: 10, cha: 12 },
    attacks: [{ name: 'Rotting Fist', stat: 'str', damage: '5d6', reach: 1, rider: { save: 'con', dc: 12, condition: 'rotting', turns: 2 } }],
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
    attacks: [{ name: 'Rotting Fist', stat: 'str', damage: '4d6', reach: 1, rider: { save: 'con', dc: 16, condition: 'rotting', turns: 2 } }],
  },
  // --- act five: the labyrinth below the tomb ---------------------------------
  // SRD gargoyle: claws twice (its bite folded in), and it stands as a statue until woken
  // (False Appearance, as `asleep` in the map). No resistance to plain weapons. Rules 4: once a
  // turn its claws throw a foe 5 ft back (STR save), off the bridge if that's what's behind them.
  a: {
    name: 'Gargoyle', cls: 'Gargoyle', team: 'monsters', color: 0x7a7670,
    hp: 52, ac: 15, speed: 6, prof: 2, xp: 450, cr: 2,
    flies: true, // drifts over difficult ground (Ice Storm)
    multiattack: 2,
    ai: 'brute',
    stats: { str: 15, dex: 11, con: 16, int: 6, wis: 11, cha: 7 },
    attacks: [{ name: 'Claws', stat: 'str', damage: '1d6', reach: 1, throws: { dc: 11 } }],
  },
  // SRD basilisk: a poisonous bite (2d6+3 piercing and 2d6 poison, one roll here) and its
  // Petrifying Gaze, cut down to a rider on the bite that turns a hero to stone for a turn.
  z: {
    name: 'Basilisk', cls: 'Basilisk', team: 'monsters', color: 0x6a7a4a,
    hp: 52, ac: 15, speed: 4, prof: 2, xp: 700, cr: 3,
    ai: 'brute',
    lurks: true, // rules 5: in a room on two floors, it waits on its own floor
    stats: { str: 16, dex: 8, con: 15, int: 2, wis: 8, cha: 7 },
    attacks: [{ name: 'Bite', stat: 'str', damage: '4d6', reach: 1, rider: { save: 'con', dc: 12, condition: 'petrified', turns: 1 } }],
  },
  // The last boss: an SRD minotaur made a lord of the labyrinth for a level 8 party. Two
  // greataxe swings; the first hit after a run of 2 tiles or more is a Charge (+2d8, STR
  // save or prone); Reckless every turn (advantage for him, and against him).
  v: {
    name: 'Tharok', cls: 'Minotaur', team: 'monsters', color: 0x6a4630,
    hp: 155, ac: 15, speed: 8, prof: 3, xp: 3900, cr: 7,
    multiattack: 2,
    ai: 'brute',
    recklessBrute: true,
    surefooted: true, // he knows every edge of his labyrinth: no push sends him over
    stats: { str: 18, dex: 11, con: 16, int: 6, wis: 16, cha: 9 },
    attacks: [{ name: 'Greataxe', stat: 'str', damage: '2d12', reach: 1, charge: { damage: '2d8', dc: 14 } }],
  },
  // SRD ochre jelly: a slow pseudopod (2d6+2 bludgeoning and 3d6 acid, one roll here). Rules 6:
  // Split (`splits`): a melee weapon hit on a Large or Medium jelly with 10 HP or more left
  // splits it in two, each with half its HP and a size smaller (Game.split). The game has no
  // damage types, so it neither resists acid nor shrugs off lightning and slashing.
  j: {
    name: 'Ochre Jelly', cls: 'Ochre Jelly', team: 'monsters', color: 0xc89a2a,
    hp: 45, ac: 8, speed: 2, prof: 2, xp: 450, cr: 2,
    ai: 'brute',
    splits: true,
    size: 2, // Large; each split is a size smaller, and a Small one splits no more
    stats: { str: 15, dex: 6, con: 14, int: 2, wis: 6, cha: 1 },
    attacks: [{ name: 'Pseudopod', stat: 'str', damage: '5d6', reach: 1 }],
  },
  // SRD gelatinous cube, rules 7. Its Engulf is an attack here: a hit makes the target save
  // (DEX, DC 12) or be engulfed, restrained inside it, taking 2d6 acid at the start of each of its
  // turns until a STR save (DC 12) then gets it out (Game.digest). Transparent: it starts hidden,
  // and only a hero next to it or with passive Perception 15 spots it.
  i: {
    name: 'Gelatinous Cube', cls: 'Gelatinous Cube', team: 'monsters', color: 0x8fd0c0,
    hp: 84, ac: 6, speed: 3, prof: 2, xp: 450, cr: 2,
    ai: 'brute',
    transparent: true,
    stats: { str: 14, dex: 3, con: 20, int: 1, wis: 6, cha: 1 },
    attacks: [{ name: 'Engulf', stat: 'str', damage: '3d6', reach: 1, rider: { save: 'dex', dc: 12, condition: 'engulfed' } }],
  },
  // SRD zombie, rules 8. Undead Fortitude (`fortitude`): dropped to 0 HP by anything but a crit
  // or radiant damage (Divine Smite, Divine Strike, Sacred Flame), it makes a CON save against
  // 5 + the damage taken and stays on 1 HP if it succeeds (Game#applyDamage).
  d: {
    name: 'Zombie', cls: 'Zombie', team: 'monsters', color: 0x7d8a5c,
    hp: 22, ac: 8, speed: 4, prof: 2, xp: 50, cr: 0.25,
    ai: 'brute',
    undead: true,
    fortitude: true,
    passives: ['undeadFortitude'],
    immune: ['poisoned'],
    stats: { str: 13, dex: 6, con: 16, int: 3, wis: 6, cha: 5 },
    attacks: [{ name: 'Slam', stat: 'str', damage: '1d6', reach: 1 }],
  },
  // SRD swarm of rats, rules 8 (`swarm`): weapons deal it half damage (it resists bludgeoning,
  // piercing and slashing), it moves through foes' spaces (though it can't stop in one), it
  // can't be grappled, knocked prone, held or frightened, and its bites drop from 2d6 to 1d6 at
  // half HP (`weak`).
  c: {
    name: 'Swarm of Rats', cls: 'Swarm of Rats', team: 'monsters', color: 0x5a4a3e,
    hp: 24, ac: 10, speed: 6, prof: 2, xp: 50, cr: 0.25,
    ai: 'brute',
    swarm: true,
    passives: ['swarm'],
    immune: ['frightened', 'paralyzed', 'petrified', 'prone', 'restrained', 'stunned'],
    stats: { str: 9, dex: 11, con: 9, int: 2, wis: 10, cha: 3 },
    attacks: [{ name: 'Bites', stat: 'dex', damage: '2d6', weak: '1d6', reach: 1 }],
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
    inspired: null,     // a bard's Bardic Inspiration on it: { die, by }, until used
    invisibleFrom: null, // the bard whose Greater Invisibility is on it
    raging: false,      // a barbarian's Rage, once per fight, for the rest of it
    reckless: false,    // Reckless Attack, until the barbarian's next turn
    quickened: false,   // a sorcerer's Quickened Spell, armed for the next action spell
    stunArmed: false,   // a monk's Stunning Strike, armed for the next melee hit
    strikes: 0,         // Flurry of Blows' unarmed strikes left this turn
    wholenessUsed: false,
    storm: null,        // a druid's Call Lightning: { slot } while it lasts
    conditions: {},     // prone / poisoned / frightened (combat.js)
  };
}

/**
 * What each hero gains on reaching a level. Heroes start at level 3 (their stat blocks
 * above). hp is added to max HP; stats are added; slots set the slot maximum per level;
 * spells / passives are learned; other keys are copied onto the unit. A level's `stats` is
 * its Ability Score Improvement: the class's own pick, which the player may swap (`picks`,
 * see applyLevel), and what follows from it (CON's hit points, DEX's AC in light armour,
 * CHA's Bardic Inspiration) is worked out in `raise`, never written here.
 */
export const PROGRESSION = {
  F: {
    4: { hp: 8, stats: { str: 2 }, note: 'Strength 18: +1 to hit and damage' },
    5: { hp: 8, prof: 3, extraAttack: 2, passives: ['extraAttack'], note: 'Extra Attack: two swings per Attack action' },
    6: { hp: 8, stats: { str: 2 }, note: 'Strength 20: +1 to hit and damage' },
    7: { hp: 8, critRange: 19, passives: ['improvedCritical'], note: 'Improved Critical: weapon hits crit on a 19 or 20' },
    8: { hp: 8, stats: { con: 2 }, note: 'Constitution 17: +8 hit points' },
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
    4: { hp: 6, stats: { dex: 2 }, note: 'Dexterity 18: +1 to hit, damage and AC' },
    5: { hp: 6, prof: 3, sneakDice: 3, passives: ['uncannyDodge'], note: 'Sneak Attack 3d6 and Uncanny Dodge' },
    6: { hp: 6, sneakDice: 4, note: 'Sneak Attack 4d6' },
    7: { hp: 6, passives: ['evasion'], note: 'Evasion: no damage from a DEX save you make, half from one you fail' },
    8: { hp: 6, stats: { dex: 2 }, note: 'Dexterity 20: +1 to hit, damage and AC' },
  },
  A: {
    4: { hp: 8, stats: { dex: 2 }, note: 'Dexterity 18: +1 to hit, damage and AC' },
    5: {
      hp: 8, prof: 3, extraAttack: 2, slots: { 1: 4, 2: 2 }, passives: ['extraAttack', 'colossusSlayer'],
      note: 'Extra Attack and Colossus Slayer (+1d8 once per turn on a hurt foe)',
    },
    6: { hp: 8, passives: ['escapeTheHorde'], note: 'Escape the Horde: opportunity attacks against you have disadvantage' },
    7: { hp: 8, slots: { 2: 3 }, note: 'A third 2nd-level slot for Hunter’s Mark' },
    8: { hp: 8, stats: { dex: 2 }, note: 'Dexterity 20: +1 to hit, damage and AC' },
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
  B: {
    4: { hp: 7, stats: { cha: 2 }, slots: { 2: 3 }, note: 'Charisma 18, a fourth Bardic Inspiration and a third 2nd-level slot' },
    5: {
      hp: 7, prof: 3, slots: { 3: 2 }, spells: ['fear'], inspirationDie: 8,
      note: 'Fear, a d8 Bardic Inspiration die and two 3rd-level slots',
    },
    6: { hp: 7, slots: { 3: 3 }, spells: ['massHealingWord'], note: 'Magical Secrets: Mass Healing Word, and a third 3rd-level slot' },
    7: { hp: 7, slots: { 4: 1 }, spells: ['greaterInvisibility'], note: 'Greater Invisibility and a 4th-level slot' },
    8: { hp: 7, stats: { cha: 2 }, slots: { 4: 2 }, note: 'Charisma 20, a fifth Bardic Inspiration and a second 4th-level slot' },
  },
  Z: {
    4: { hp: 9, stats: { str: 2 }, note: 'Strength 18: +1 to hit and damage' },
    5: { hp: 9, prof: 3, extraAttack: 2, speed: 8, passives: ['extraAttack', 'fastMovement'], note: 'Extra Attack and Fast Movement (+10 ft of speed)' },
    6: { hp: 9, passives: ['mindlessRage'], note: 'Mindless Rage: you can’t be frightened while raging' },
    7: { hp: 9, feral: true, passives: ['feralInstinct'], note: 'Feral Instinct: advantage on initiative' },
    8: { hp: 9, stats: { con: 2 }, note: 'Constitution 18: +8 hit points and +1 AC' },
  },
  S: {
    4: { hp: 6, stats: { cha: 2 }, slots: { 2: 3 }, note: 'Charisma 18, a third 2nd-level slot' },
    5: { hp: 6, prof: 3, slots: { 3: 2 }, spells: ['fireball'], note: 'Fireball and two 3rd-level slots' },
    6: {
      hp: 6, slots: { 3: 3 }, passives: ['elementalAffinity'],
      note: 'Elemental Affinity: add your CHA to Fire Bolt, Burning Hands and Fireball damage; a third 3rd-level slot',
    },
    7: { hp: 6, slots: { 4: 1 }, spells: ['iceStorm'], note: 'Ice Storm and a 4th-level slot' },
    8: { hp: 6, stats: { cha: 2 }, slots: { 4: 2 }, note: 'Charisma 20 and a second 4th-level slot' },
  },
  M: {
    4: { hp: 7, stats: { dex: 2 }, note: 'Dexterity 18: +1 to hit, damage and AC' },
    5: {
      hp: 7, prof: 3, extraAttack: 2, dice: { 'Unarmed Strike': '1d6' }, passives: ['extraAttack'], features: ['stunningStrike'],
      note: 'Extra Attack, Stunning Strike and a d6 Martial Arts die',
    },
    6: { hp: 7, speed: 9, features: ['wholeness'], note: 'Wholeness of Body (heal three times your level, once per fight) and +5 ft of speed' },
    7: { hp: 7, passives: ['evasion'], note: 'Evasion: no damage from a DEX save you make, half from one you fail' },
    8: { hp: 7, stats: { wis: 2 }, note: 'Wisdom 18: +1 AC and Stunning Strike DC' },
  },
  D: {
    4: { hp: 7, stats: { wis: 2 }, slots: { 2: 3 }, note: 'Wisdom 18, a third 2nd-level slot' },
    5: { hp: 7, prof: 3, slots: { 3: 2 }, spells: ['callLightning'], dice: { 'Produce Flame': '2d8' }, note: 'Call Lightning, two 3rd-level slots and a 2d8 Produce Flame' },
    6: { hp: 7, slots: { 3: 3 }, note: 'A third 3rd-level slot' },
    7: { hp: 7, slots: { 4: 1 }, spells: ['iceStorm'], note: 'Ice Storm and a 4th-level slot' },
    8: { hp: 7, stats: { wis: 2 }, slots: { 4: 2 }, note: 'Wisdom 20 and a second 4th-level slot' },
  },
};

export const MAX_LEVEL = 8;

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
/**
 * The abilities each class's AC counts: Dexterity in light armour (Mage Armor, leather, a
 * druid's hide up to +2), and Unarmored Defense's CON (barbarian) or WIS (monk).
 */
const AC_STATS = { W: ['dex'], K: ['dex'], R: ['dex'], A: ['dex'], B: ['dex'], S: ['dex'], D: ['dex'], Z: ['dex', 'con'], M: ['dex', 'wis'] };

/** The levels where class `code` raises an ability score (4 and 8; the Fighter 6 too). */
export const asiLevels = (code) =>
  Object.entries(PROGRESSION[code] ?? {}).filter(([, g]) => g.stats).map(([l]) => Number(l));

/** The ability class `code` raises at `level` unless the player picks another. */
export const asiDefault = (code, level) => Object.keys(PROGRESSION[code]?.[level]?.stats ?? {})[0] ?? null;

/** A pick the rules take: a real ability, or null (the class's own). */
export const cleanPick = (stat) => (ABILITIES.includes(stat) ? stat : null);

/** +n to one ability (20 at most), and what follows: CON's hit points for every level, DEX's AC in light armour. */
function raise(unit, stat, n, level) {
  const before = abilityMod(unit.stats[stat]);
  unit.stats[stat] = Math.min(20, unit.stats[stat] + n);
  const gain = abilityMod(unit.stats[stat]) - before;
  const cap = (m) => (stat === 'dex' ? Math.min(unit.dexCap ?? 99, m) : m);
  if (stat === 'con') {
    unit.maxHp += gain * level;
    unit.hp += gain * level;
  }
  if (AC_STATS[unit.code]?.includes(stat)) unit.ac += cap(before + gain) - cap(before);
}

/**
 * Raise a freshly created unit to `level`. Slots are refilled to the new maximum. `picks`
 * swaps a level's ability increase for another, e.g. { 4: 'con' }; a level not in it takes
 * the class's own (so records from before picks build the same heroes).
 */
export function applyLevel(unit, level, picks = {}) {
  const table = PROGRESSION[unit.code];
  if (!table || !unit.level) return unit;
  const baseCon = abilityMod(unit.stats.con);
  for (let l = unit.level + 1; l <= Math.min(level, MAX_LEVEL); l++) {
    const g = table[l];
    if (!g) continue;
    const { hp = 0, stats = {}, slots = {}, spells = [], passives = [], features = [], dice = {}, note, ac = 0, ...rest } = g;
    // A higher CON gives every new level its extra hit point too.
    const more = hp + abilityMod(unit.stats.con) - baseCon;
    unit.maxHp += more;
    unit.hp += more;
    unit.ac += ac;
    for (const [k, v] of Object.entries(stats)) raise(unit, cleanPick(picks?.[l]) ?? k, v, l);
    for (const [k, v] of Object.entries(slots)) unit.slotMax[k] = v;
    unit.spells.push(...spells.filter((s) => !unit.spells.includes(s)));
    unit.passives.push(...passives.filter((p) => !unit.passives.includes(p)));
    unit.features.push(...features.filter((p) => !unit.features.includes(p)));
    for (const a of unit.attacks) if (dice[a.name]) a.damage = dice[a.name]; // a bigger die for an attack (a monk's fists)
    Object.assign(unit, rest);
    unit.level = l;
  }
  unit.slots = { ...unit.slotMax };
  if (unit.spells.includes('layOnHands')) unit.layOnHands = unit.layOnHandsMax = 5 * unit.level;
  // Bardic Inspiration: as many uses as the CHA modifier.
  if (unit.inspirationDie) unit.inspiration = Math.max(1, abilityMod(unit.stats.cha));
  // Ki and sorcery points: one per level, back every fight.
  if (unit.ki !== undefined) unit.ki = unit.level;
  if (unit.sorcery !== undefined) unit.sorcery = unit.level;
  return unit;
}

/** Classes that can fill each hero slot: the first is the default. */
export const CLASS_CHOICES = { F: ['F', 'P', 'Z'], W: ['W', 'K', 'S'], R: ['R', 'A', 'M'], C: ['C', 'B', 'D'] };

/** The class (template code) a party record plays in a slot. */
export const classOf = (slot, rec) => (CLASS_CHOICES[slot]?.includes(rec?.cls) ? rec.cls : slot);
