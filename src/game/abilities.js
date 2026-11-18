// Actions, bonus actions and spells (SRD 5.1). Definitions only; the rules
// for resolving them live in combat.js.

/** Standard actions anyone can take, plus class/monster features and items. */
export const ACTIONS = {
  dash: { name: 'Dash', time: 'action', desc: 'Gain extra movement equal to your speed this turn.' },
  dodge: { name: 'Dodge', time: 'action', desc: 'Attacks against you have disadvantage until your next turn.' },
  disengage: { name: 'Disengage', time: 'action', desc: 'Your movement doesn’t provoke opportunity attacks this turn.' },
  hide: {
    name: 'Hide', time: 'action',
    desc: 'Roll Stealth. Unaware monsters only spot you if their passive Perception beats it (or they are next to you); your first attack from hiding has advantage. Not while an alert enemy can see you.',
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
};

export const STANDARD_ACTIONS = ['dash', 'dodge', 'disengage', 'hide'];

/** Passive features (no button): documented here for the HUD tooltips. */
export const PASSIVES = {
  sneakAttack: 'Sneak Attack: extra d6s (2d6, 3d6 from level 5) once per turn when you have advantage, or an ally is next to the target.',
  extraAttack: 'Extra Attack: the Attack action lets you attack twice.',
  uncannyDodge: 'Uncanny Dodge: reaction to halve the damage of a hit (used automatically on hits of 6+).',
  destroyUndead: 'Destroy Undead: weak undead (CR ½ or lower) that fail against Turn Undead are destroyed.',
  packTactics: 'Pack Tactics: advantage when an ally is next to the target.',
  trapSense: 'Keen Eyes: spots traps within 10 ft.',
  skulker: 'Skulker: monsters that have not noticed the party only spot you within 15 ft.',
};

/**
 * targeting: 'enemy' | 'ally' (incl. self) | 'cone' | 'area' (a point; radius in tiles) | 'tile'
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
  fireball: {
    name: 'Fireball', level: 3, time: 'action', range: 30, radius: 4, targeting: 'area',
    damage: '8d6', save: 'dex',
    desc: 'A bead of fire bursts in a 20-ft radius: 8d6 fire, DEX save for half. Hits allies too!',
  },
  massHealingWord: {
    name: 'Mass Healing Word', level: 3, time: 'bonus', range: 12, targeting: 'self',
    desc: 'Bonus action: up to six hurt allies within 60 ft you can see regain 1d4 + WIS HP.',
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
