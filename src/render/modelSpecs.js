// Which .glb each unit uses and which of its clips the game plays. Kept free of three.js so
// scripts/trim-models.js can read it and drop the clips nobody uses from the model files.

import { TEMPLATES, classOf } from '../game/units.js';

/**
 * Per unit: which file, which built-in meshes to show (every other weapon/prop is hidden),
 * procedural weapons for the unarmed skeletons, figure height, and the clips used.
 */
export const QUATERNIUS = {
  idle: 'Idle', walk: 'Walk', melee: 'Attack', arrow: 'Attack', javelin: 'Attack',
  hit: 'HitRecieve', die: 'Death', dead: 'Death',
};

export const SPECS = {
  F: {
    file: 'Knight', height: 1.35,
    show: ['1H_Sword', 'Round_Shield'],
    clips: { melee: '1H_Melee_Attack_Slice_Diagonal' },
  },
  // The Paladin: the same knight in white and gold, with the crested shield.
  P: {
    file: 'Knight', height: 1.35,
    show: ['1H_Sword', 'Badge_Shield'],
    tint: 0xffe6a8,
    clips: { melee: '1H_Melee_Attack_Slice_Diagonal' },
  },
  W: {
    file: 'Mage', height: 1.35,
    show: ['2H_Staff'],
    clips: { melee: '2H_Melee_Attack_Stab' },
  },
  // The Warlock: Ilsa's mage robes dyed a deep infernal red.
  K: {
    file: 'Mage', height: 1.35,
    show: ['2H_Staff'],
    recolor: { hue: 352, sat: 1.7, light: 0.9, from: [190, 320] },
    clips: { melee: '2H_Melee_Attack_Stab' },
  },
  R: {
    file: 'Rogue_Hooded', height: 1.28,
    show: ['Knife', 'Knife_Offhand'],
    ranged: ['1H_Crossbow'], // swapped in for a shot
    clips: { melee: 'Dualwield_Melee_Attack_Stab', arrow: '1H_Ranged_Shoot' },
  },
  // The Ranger: the hooded rogue with its green cloth dyed a weathered brown (so it reads as
  // neither Wren nor a goblin), blade in hand and the big crossbow swapped in to shoot (the
  // pack has no bow; the rules call it a longbow).
  A: {
    file: 'Rogue_Hooded', height: 1.3,
    show: ['Knife'],
    ranged: ['2H_Crossbow'],
    recolor: { hue: 30, sat: 0.55, light: 0.75 },
    clips: { melee: '1H_Melee_Attack_Stab', arrow: '1H_Ranged_Shoot' },
  },
  C: {
    file: 'Barbarian', height: 1.35,
    show: ['1H_Axe', 'Barbarian_Round_Shield'],
    hide: ['Barbarian_Hat'],
    tint: 0xfff3dc,
    clips: { melee: '1H_Melee_Attack_Chop' },
  },
  s: {
    file: 'Skeleton_Warrior', height: 1.3, blade: true,
    clips: { melee: '1H_Melee_Attack_Chop', walk: 'Walking_D_Skeletons', rise: 'Spawn_Ground_Skeletons' },
  },
  risen: {
    file: 'Skeleton_Minion', height: 1.2, blade: true,
    clips: { melee: '1H_Melee_Attack_Chop', walk: 'Walking_D_Skeletons', rise: 'Spawn_Ground_Skeletons' },
  },
  n: {
    file: 'Skeleton_Mage', height: 1.5, staff: true,
    clips: { melee: '1H_Melee_Attack_Stab', walk: 'Walking_D_Skeletons' },
  },
  // Act two reuses the skeleton rigs: ghouls are a grey-green, clawing minion; the wight a
  // tall, cold-blue warrior.
  u: {
    file: 'Skeleton_Minion', height: 1.2, tint: 0x9fb88a,
    clips: { melee: 'Unarmed_Melee_Attack_Punch_A', walk: 'Walking_D_Skeletons', idle: 'Unarmed_Idle' },
  },
  // The ghast: a bigger, darker ghoul.
  h: {
    file: 'Skeleton_Minion', height: 1.38, tint: 0x6f8060,
    clips: { melee: 'Unarmed_Melee_Attack_Punch_A', walk: 'Walking_D_Skeletons', idle: 'Unarmed_Idle' },
  },
  w: {
    file: 'Skeleton_Warrior', height: 1.5, blade: true, tint: 0x8fa0d0,
    clips: { melee: '1H_Melee_Attack_Slice_Diagonal', walk: 'Walking_D_Skeletons' },
  },
  // Goblins: the KayKit rogue, small and green with pointed ears, knife and crossbow;
  // Grukk is a green, goblin-sized barbarian with axe and shield.
  g: {
    file: 'Rogue_Hooded', height: 1.0, tint: 0x9ccf6e,
    show: ['Knife'], ranged: ['1H_Crossbow'],
    ears: { mesh: 'Rogue_Head_Hooded', color: 0xa39a52 },
    clips: { melee: '1H_Melee_Attack_Stab', arrow: '1H_Ranged_Shoot' },
  },
  b: {
    file: 'Barbarian', height: 1.12, tint: 0xa8d080,
    show: ['1H_Axe', 'Barbarian_Round_Shield'],
    clips: { melee: '1H_Melee_Attack_Chop' },
  },
  // The orc and the rats: Quaternius (CC0), one swing clip for every attack.
  o: { file: 'monsters/Orc', height: 1.45, clips: { ...QUATERNIUS, melee: 'Weapon', javelin: 'Weapon', arrow: 'Weapon', hit: 'HitReact' } },
  r: { file: 'monsters/Rat', height: 0.5, quadruped: true, clips: { ...QUATERNIUS, melee: 'Rat_Attack', idle: 'Rat_Idle', walk: 'Rat_Walk', die: 'Rat_Death', dead: 'Rat_Death' } },
  // Act three: Quaternius's spider (Animated Enemies, like the rats) for the giant spiders,
  // dyed a little darker, and his ghost (Ultimate Monsters, like the orc) for the specters,
  // pale blue and half see-through (`ghost` = opacity). Neither has a hit clip: they flinch.
  // (`height` fits the model's height, and a spider is mostly legs: this keeps it to its tile.)
  k: { file: 'monsters/Spider', height: 0.45, quadruped: true, tint: 0x8a7a9a, clips: { ...QUATERNIUS, melee: 'Spider_Attack', idle: 'Spider_Idle', walk: 'Spider_Walk', die: 'Spider_Death', dead: 'Spider_Death' } },
  e: {
    file: 'monsters/Ghost', height: 1.15, tint: 0xd4e2ff, ghost: 0.7,
    clips: { ...QUATERNIUS, idle: 'Flying_Idle', walk: 'Fast_Flying', melee: 'Punch', arrow: 'Punch', javelin: 'Punch', hit: 'HitReact', die: 'Death', dead: 'Death' },
  },
  // Ysolde, the banshee queen: the skeleton mage, pale and see-through, so she stands apart
  // from her ghosts.
  q: {
    file: 'Skeleton_Mage', height: 1.55, tint: 0xe8f0ff, ghost: 0.6,
    clips: { melee: '1H_Melee_Attack_Stab', walk: 'Walking_D_Skeletons' },
  },
  // Act four: mummies are the clawing skeleton in old linen; the wraith Quaternius's ghost,
  // dark violet; the fallen knights KayKit's knight in black iron; Nekhet the skeleton mage,
  // tall and wrapped in gold-stained linen.
  y: {
    file: 'Skeleton_Minion', height: 1.3, tint: 0xd8c8a0,
    clips: { melee: 'Unarmed_Melee_Attack_Punch_A', walk: 'Walking_D_Skeletons', idle: 'Unarmed_Idle' },
  },
  t: {
    file: 'monsters/Ghost', height: 1.3, tint: 0x6a5090, ghost: 0.82,
    clips: { ...QUATERNIUS, idle: 'Flying_Idle', walk: 'Fast_Flying', melee: 'Punch', arrow: 'Punch', javelin: 'Punch', hit: 'HitReact', die: 'Death', dead: 'Death' },
  },
  x: {
    file: 'Knight', height: 1.38,
    show: ['1H_Sword', 'Round_Shield'],
    tint: 0x55556a,
    clips: { melee: '1H_Melee_Attack_Slice_Diagonal' },
  },
  l: {
    file: 'Skeleton_Mage', height: 1.6, tint: 0xf0d890,
    clips: { melee: '1H_Melee_Attack_Stab', walk: 'Walking_D_Skeletons' },
  },
};

export const DEFAULT_CLIPS = {
  idle: 'Idle',
  walk: 'Walking_A',
  melee: '1H_Melee_Attack_Chop',
  arrow: '1H_Ranged_Shoot',
  javelin: 'Throw',
  spell: 'Spellcast_Shoot',
  cast: 'Spellcast_Raise',
  hit: 'Hit_A',
  die: 'Death_A',
  dead: 'Death_A_Pose',
  rise: 'Lie_StandUp',
};

/** For each model file, the clip names some unit plays from it. */
export function clipsByFile() {
  const out = new Map();
  for (const spec of Object.values(SPECS)) {
    const names = out.get(spec.file) ?? new Set();
    for (const n of Object.values({ ...DEFAULT_CLIPS, ...spec.clips })) names.add(n);
    out.set(spec.file, names);
  }
  return out;
}

const specFor = (code) => SPECS[code];

/**
 * The model files a room needs: its heroes (as the party's classes) and monsters, any
 * corpses, and the risen-skeleton rig when someone there can cast Animate Dead. A fight
 * waits only for these; the rest keep loading behind it.
 * `rows` is the level's map, `party` the campaign's party records (or null).
 */
export function filesForRoom(rows, party) {
  const files = new Set();
  for (const ch of rows.join('')) {
    if (!/[a-zA-Z]/.test(ch)) continue;
    const code = classOf(ch, party?.[ch]);
    const spec = specFor(code);
    if (spec) files.add(spec.file);
    if (TEMPLATES[code]?.spells?.includes('animateDead')) files.add(SPECS.risen.file);
  }
  return [...files];
}

/** Every model file, for loading in the background. */
export const allFiles = () => [...new Set(Object.values(SPECS).map((s) => s.file))];
