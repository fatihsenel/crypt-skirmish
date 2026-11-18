// Which .glb each unit uses and which of its clips the game plays. Kept free of three.js so
// scripts/trim-models.js can read it and drop the clips nobody uses from the model files.

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
  R: {
    file: 'Rogue_Hooded', height: 1.28,
    show: ['Knife', 'Knife_Offhand'],
    ranged: ['1H_Crossbow'], // swapped in for a shot
    clips: { melee: 'Dualwield_Melee_Attack_Stab', arrow: '1H_Ranged_Shoot' },
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
