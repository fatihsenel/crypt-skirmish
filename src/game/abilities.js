// Actions, bonus actions and spells (SRD 5.1). Definitions only; the rules
// for resolving them live in combat.js.

/** Standard actions anyone can take, plus class/monster features and items. */
export const ACTIONS = {
  dash: { name: 'Dash', time: 'action', desc: 'Gain extra movement equal to your speed this turn.' },
  dodge: { name: 'Dodge', time: 'action', desc: 'Attacks against you have disadvantage until your next turn.' },
  disengage: { name: 'Disengage', time: 'action', desc: 'Your movement doesn’t provoke opportunity attacks this turn.' },
  hide: {
    name: 'Hide', time: 'action',
    desc: 'Roll Stealth. Monsters only spot you if their passive Perception beats it, they are next to you, or they Search and roll high enough. Alert monsters lose track of you and hunt where they last saw you. Your first attack from hiding has advantage. Not while an alert enemy can see you.',
  },
  potion: { name: 'Potion', time: 'action', desc: 'Drink a potion of healing: regain 2d4 + 2 HP.' },
  // Fighter
  secondWind: { name: 'Second Wind', time: 'bonus', feature: true, desc: 'Regain 1d10 + fighter level HP. Once per fight.' },
  // Rogue
  cunningDash: { name: 'Cunning Dash', time: 'bonus', feature: true, desc: 'Cunning Action: Dash as a bonus action.' },
  cunningDisengage: { name: 'Cunning Disengage', time: 'bonus', feature: true, desc: 'Cunning Action: Disengage as a bonus action.' },
  cunningHide: { name: 'Cunning Hide', time: 'bonus', feature: true, desc: 'Cunning Action: Hide as a bonus action (Stealth with expertise).' },
  // Cleric
  turnUndead: {
    name: 'Turn Undead', time: 'action', feature: true, range: 6,
    desc: 'Channel Divinity: undead within 30 ft make a WIS save or flee for 2 turns. Once per fight.',
  },
  // Monsters
  nimbleEscape: { name: 'Nimble Escape', time: 'bonus', feature: true, desc: 'Disengage as a bonus action.' },
  aggressive: { name: 'Aggressive', time: 'bonus', feature: true, desc: 'Move up to its speed toward an enemy.' },
  nimbleHide: { name: 'Nimble Hide', time: 'bonus', feature: true, desc: 'Nimble Escape: Hide as a bonus action, behind cover or out of sight.' },
  search: { name: 'Search', time: 'action', desc: 'Roll Perception against the Stealth of every hidden enemy you can see; a success finds them.' },
};

export const STANDARD_ACTIONS = ['dash', 'dodge', 'disengage', 'hide', 'search'];

/** Shove sits with the attacks: it takes one attack of the Attack action. */
export const SHOVE = {
  name: 'Shove', reach: 1,
  desc: 'Instead of one attack: Athletics (STR + proficiency) against the target’s STR or DEX. Win and it is knocked prone: melee attacks against it have advantage until it gets up on its turn.',
};

/** What each condition does, for tooltips and the log. */
export const CONDITION_INFO = {
  prone: 'Prone: melee attacks against it have advantage, ranged ones disadvantage; its own attacks have disadvantage. Standing up costs half its movement.',
  poisoned: 'Poisoned: disadvantage on attack rolls and Stealth.',
  frightened: 'Frightened: disadvantage on attacks while it can see the source of its fear, and it can’t move closer to it. A WIS save at the end of each turn ends it.',
  restrained: 'Restrained: can’t move; attacks against it have advantage, its own attacks and DEX saves disadvantage. Wears off at the end of its next turn.',
};

/** Passive features (no button): documented here for the HUD tooltips. */
export const PASSIVES = {
  sneakAttack: 'Sneak Attack: extra d6s (2d6; 3d6 from level 5, 4d6 from 6) once per turn when you have advantage, or an ally is next to the target.',
  extraAttack: 'Extra Attack: the Attack action lets you attack twice.',
  uncannyDodge: 'Uncanny Dodge: reaction to halve the damage of a hit (used automatically on hits of 6+).',
  destroyUndead: 'Destroy Undead: weak undead (CR ½ or lower) that fail against Turn Undead are destroyed.',
  sculptSpells: 'Sculpt Spells: your Fireball, Lightning Bolt and Burning Hands leave the party unharmed.',
  blessedHealer: 'Blessed Healer: healing someone else with a spell slot heals you too (2 + the slot level).',
  divineSmite: 'Divine Smite: arm it, and your next melee weapon hit spends a spell slot for 2d8 radiant (+1d8 per slot level above 1st, +1d8 against undead).',
  dueling: 'Dueling: +2 damage with melee weapon attacks.',
  auraOfProtection: 'Aura of Protection: you and allies within 10 ft add your CHA modifier to saving throws.',
  archery: 'Archery: +1 to hit with ranged weapon attacks.',
  colossusSlayer: 'Colossus Slayer: once per turn, a weapon hit on a foe that is already hurt deals an extra 1d8.',
  escapeTheHorde: 'Escape the Horde: opportunity attacks against you have disadvantage.',
  packTactics:'Pack Tactics: advantage when an ally is next to the target.',
  trapSense: 'Keen Eyes: spots traps within 10 ft.',
  skulker: 'Skulker: monsters that have not noticed the party only spot you within 15 ft.',
};

/**
 * targeting: 'enemy' | 'ally' (incl. self) | 'cone' | 'line' (toward a point) | 'area' (a point; radius in tiles) | 'tile'
 *            | 'corpse' | 'self' (no target, cast at once) | 'none' (reaction)
 * level 0 = cantrip, no slot needed.
 */
export const SPELLS = {
  magicMissile: {
    name: 'Magic Missile', level: 1, time: 'action', range: 24, targeting: 'enemy',
    darts: 3, damage: '1d4+1',
    desc: 'Three glowing darts that never miss, 1d4+1 force each. +1 dart per slot level above 1st.',
  },
  burningHands: {
    name: 'Burning Hands', level: 1, time: 'action', range: 3, targeting: 'cone',
    damage: '3d6', save: 'dex',
    desc: '15-ft cone of fire, 3d6 damage, DEX save for half. Hits allies too!',
  },
  mistyStep: {
    name: 'Misty Step', level: 2, time: 'bonus', range: 6, targeting: 'tile',
    desc: 'Bonus action: teleport up to 30 ft to a spot you can see.',
  },
  shield: {
    name: 'Shield', level: 1, time: 'reaction', targeting: 'none',
    desc: 'Reaction when hit: +5 AC until your next turn (cast automatically).',
  },
  sacredFlame: {
    name: 'Sacred Flame', level: 0, time: 'action', range: 12, targeting: 'enemy',
    damage: '1d8', save: 'dex',
    desc: 'Cantrip: radiant flame descends on a foe, 1d8 radiant, DEX save negates.',
  },
  cureWounds: {
    name: 'Cure Wounds', level: 1, time: 'action', range: 1, targeting: 'ally',
    heal: [1, 8],
    desc: 'Touch an ally (or yourself): heal 1d8 + WIS. +1d8 per slot level above 1st.',
  },
  healingWord: {
    name: 'Healing Word', level: 1, time: 'bonus', range: 12, targeting: 'ally',
    heal: [1, 4],
    desc: 'Bonus action, 60 ft: heal 1d4 + WIS. +1d4 per slot level above 1st.',
  },
  layOnHands: {
    name: 'Lay on Hands', level: 0, time: 'action', range: 1, targeting: 'ally', pool: true,
    desc: 'Touch an ally (or yourself) and heal from a pool of 5 HP per paladin level, as much as they are missing. The pool refills after a long rest.',
  },
  shieldOfFaith: {
    name: 'Shield of Faith', level: 1, time: 'bonus', range: 12, targeting: 'ally',
    desc: 'Bonus action, 60 ft: a shimmering field gives an ally (or yourself) +2 AC for the rest of the fight. One at a time.',
  },
  huntersMark: {
    name: 'Hunter’s Mark', level: 1, time: 'bonus', range: 18, targeting: 'enemy',
    damage: '1d6',
    desc: 'Bonus action, 90 ft: mark a foe. Your weapon hits on it deal an extra 1d6 for the rest of the fight. One mark at a time; marking another foe, even after this one drops, takes a new slot. The foe feels it: marking wakes a sleeping or unaware one.',
  },
  fireball: {
    name: 'Fireball', level: 3, time: 'action', range: 30, radius: 4, targeting: 'area',
    damage: '8d6', save: 'dex',
    desc: 'A bead of fire bursts in a 20-ft radius: 8d6 fire, DEX save for half. Hits allies too!',
  },
  lightningBolt: {
    name: 'Lightning Bolt', level: 3, time: 'action', range: 20, targeting: 'line',
    damage: '8d6', save: 'dex',
    desc: 'A 100-ft line of lightning, 5 ft wide: 8d6 lightning to everything in it, DEX save for half. Walls stop it. Hits allies too!',
  },
  spiritualWeapon: {
    name: 'Spiritual Weapon', level: 2, time: 'bonus', range: 12, targeting: 'enemy',
    damage: '1d8', reach: 5,
    desc: 'Bonus action: a floating spectral mace appears next to a foe within 60 ft and strikes (spell attack, 1d8 + WIS force). For the rest of the fight it can strike again as a bonus action, at no slot, at any foe within 25 ft of it.',
  },
  massHealingWord: {
    name: 'Mass Healing Word', level: 3, time: 'bonus', range: 12, targeting: 'self',
    desc: 'Bonus action: up to six hurt allies within 60 ft you can see regain 1d4 + WIS HP.',
  },
  dread: {
    name: 'Dread', level: 1, time: 'action', range: 12, targeting: 'enemy',
    save: 'wis', condition: 'frightened', turns: 2,
    desc: 'A whisper from the grave: one foe within 60 ft makes a WIS save or is frightened for 2 turns.',
  },
  animateDead: {
    name: 'Animate Dead', level: 3, time: 'action', range: 6, targeting: 'corpse',
    desc: 'Raise a corpse within 30 ft as a skeleton under your control.',
  },
};

const DIRS8 = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/** Snap the direction from `from` toward `to` onto one of 8 grid directions. */
export function directionTo(from, to) {
  const angle = Math.atan2(to.z - from.z, to.x - from.x);
  const k = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  const [x, z] = DIRS8[k];
  return { x, z };
}

/**
 * Tiles covered by a cone of `length` tiles from `origin` in grid direction `dir`.
 * Width equals length (5e cone); walls and closed doors block it.
 */
export function coneTiles(grid, origin, dir, length = 3) {
  const dirLen = Math.hypot(dir.x, dir.z);
  const out = [];
  for (let dz = -length; dz <= length; dz++) {
    for (let dx = -length; dx <= length; dx++) {
      if (!dx && !dz) continue;
      const cos = (dx * dir.x + dz * dir.z) / (Math.hypot(dx, dz) * dirLen);
      if (cos < 0.89) continue; // half-angle ≈ 26.6°: width = length
      const x = origin.x + dx;
      const z = origin.z + dz;
      if (grid.blocksSight(x, z) || !grid.lineOfSight(origin.x, origin.z, x, z)) continue;
      out.push({ x, z });
    }
  }
  return out;
}

/**
 * Tiles a `length`-tile line from `origin` toward `toward` passes through, one tile wide.
 * The first wall, column or closed door stops it.
 */
export function lineTiles(grid, origin, toward, length = 20) {
  const dx = toward.x - origin.x;
  const dz = toward.z - origin.z;
  const n = Math.hypot(dx, dz);
  if (!n) return [];
  const out = [];
  const seen = new Set();
  for (let d = 0.5; d <= length + 0.25; d += 0.25) {
    const x = Math.round(origin.x + (dx / n) * d);
    const z = Math.round(origin.z + (dz / n) * d);
    if (x === origin.x && z === origin.z) continue;
    if (grid.blocksSight(x, z)) break;
    if (Math.max(Math.abs(x - origin.x), Math.abs(z - origin.z)) > length) break;
    const k = `${x},${z}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ x, z });
  }
  return out;
}

/** Tiles within `radius` of `center` (a sphere on the grid) that the blast can reach. */
export function areaTiles(grid, center, radius) {
  const out = [];
  for (let z = center.z - radius; z <= center.z + radius; z++) {
    for (let x = center.x - radius; x <= center.x + radius; x++) {
      if (grid.blocksSight(x, z)) continue;
      if (!grid.lineOfSight(center.x, center.z, x, z)) continue;
      out.push({ x, z });
    }
  }
  return out;
}
