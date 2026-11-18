// Rigged .glb characters: KayKit packs by Kay Lousberg (CC0) for the heroes and the undead,
// Quaternius models (CC0) for the orc and the giant rats.
// Each model ships every weapon as a mesh on the hand bones and ~80 animation clips; we
// keep the weapons a unit uses and drive the clips through an AnimationMixer.
// A model that fails to load falls back to the unit's procedural figure.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const BASE = `${import.meta.env.BASE_URL}models/`;

/**
 * Per unit: which file, which built-in meshes to show (every other weapon/prop is hidden),
 * procedural weapons for the unarmed skeletons, figure height, and the clips used.
 */
const QUATERNIUS = {
  idle: 'Idle', walk: 'Walk', melee: 'Attack', arrow: 'Attack', javelin: 'Attack',
  hit: 'HitRecieve', die: 'Death', dead: 'Death',
};

const SPECS = {
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
  // Goblins: the KayKit rogue, small and green, knife and crossbow; Grukk is a green,
  // goblin-sized barbarian with axe and shield.
  g: {
    file: 'Rogue_Hooded', height: 1.0, tint: 0x9ccf6e,
    show: ['Knife'], ranged: ['1H_Crossbow'],
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

const DEFAULT_CLIPS = {
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

const loaded = new Map(); // file -> gltf

/** Load every model once. Never rejects: a model that fails just isn't used. */
export function preloadModels() {
  const loader = new GLTFLoader();
  const files = [...new Set(Object.values(SPECS).map((s) => s.file))];
  return Promise.all(files.map((f) => loader.loadAsync(`${BASE}${f}.glb`)
    .then((g) => loaded.set(f, g))
    .catch((e) => console.warn(`Model ${f} not loaded, using the built-in figure`, e))));
}

const specFor = (unit) => (unit.code === 's' && unit.name.startsWith('Risen') ? SPECS.risen : SPECS[unit.code]);

/** Bone-tied weapons for the skeletons, built in the model's own units (blade along +Y). */
function skeletonBlade() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x8d8a80, metalness: 0.6, roughness: 0.55 });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.15, 0.04), steel);
  blade.position.y = 0.75;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.07, 0.1), new THREE.MeshStandardMaterial({ color: 0x4a3b2a }));
  guard.position.y = 0.16;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 6), guard.material);
  grip.position.y = 0;
  g.add(blade, guard, grip);
  return g;
}

function necroStaff() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 2.2, 7),
    new THREE.MeshStandardMaterial({ color: 0x2c2420, roughness: 0.9 }));
  shaft.position.y = 0.2;
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0x40ff80, emissive: 0x30ff70, emissiveIntensity: 2 }));
  orb.position.y = 1.4;
  g.add(shaft, orb);
  return { g, orb };
}

/**
 * A ready-to-place figure for `unit`, or null if this unit has no .glb (or it failed to load).
 * Returns { root, height, gltf: rig } where rig plays clips (see GltfRig).
 */
export function buildGltfModel(unit) {
  const spec = specFor(unit);
  const src = spec && loaded.get(spec.file);
  if (!src) return null;

  const scene = cloneSkinned(src.scene);
  const show = new Set([...(spec.show ?? []), ...(spec.ranged ?? [])]);
  const props = [];
  const ranged = [];
  const melee = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    // Weapons and props hang off the hand slots; hats and helmets stay.
    if (!o.isSkinnedMesh && o.parent?.name.startsWith('handslot')) {
      props.push(o);
      o.visible = show.has(o.name);
      if (spec.ranged?.includes(o.name)) {
        o.visible = false;
        ranged.push(o);
      } else if (o.visible) melee.push(o);
    }
    if (spec.hide?.includes(o.name)) o.visible = false;
    if (spec.tint) {
      o.material = o.material.clone();
      o.material.color.multiply(new THREE.Color(spec.tint));
    }
  });

  let flare = null;
  const hand = scene.getObjectByName('handslotr') ?? scene.getObjectByName('handslot.r');
  if (spec.blade && hand) hand.add(skeletonBlade());
  if (spec.staff && hand) {
    const { g, orb } = necroStaff();
    hand.add(g);
    flare = () => {
      orb.material.emissiveIntensity = 8;
      setTimeout(() => { orb.material.emissiveIntensity = 2; }, 700);
    };
  }

  // Scale to the miniature's height (the packs are about 2.4 units tall).
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  scene.traverse((o) => {
    if (o.isMesh && !o.parent?.name.startsWith('handslot')) box.expandByObject(o);
  });
  const s = spec.height / (box.max.y - box.min.y);
  scene.scale.setScalar(s);
  scene.position.y = -box.min.y * s;

  const root = new THREE.Group();
  root.add(scene);
  const rig = new GltfRig(scene, src.animations, { ...DEFAULT_CLIPS, ...spec.clips }, { ranged, melee });
  return { root, height: spec.height, gltf: rig, flare, dieAxis: spec.quadruped ? 'z' : undefined };
}

/** Plays clips on one figure: a looping base (idle / walk) and one-shot actions on top. */
export class GltfRig {
  constructor(scene, animations, names, weapons) {
    this.mixer = new THREE.AnimationMixer(scene);
    // Quaternius clips carry their armature as a prefix ("RatArmature|Rat_Walk").
    this.clips = new Map(animations.map((c) => [c.name.split('|').pop(), c]));
    this.names = names;
    this.weapons = weapons;
    this.base = null;     // current looping action
    this.oneShot = null;  // current one-shot action, if any
    this.holdLast = false; // a death pose stays put
  }

  has(kind) {
    return this.clips.has(this.names[kind]);
  }

  action(kind) {
    const clip = this.clips.get(this.names[kind]);
    return clip ? this.mixer.clipAction(clip) : null;
  }

  /** Keep the looping base in step with walking / standing. */
  update(dt, walking) {
    if (!this.oneShot && !this.holdLast) {
      const want = this.action(walking ? 'walk' : 'idle');
      if (want && want !== this.base) {
        want.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.15).play();
        want.timeScale = walking ? 1.25 : 1;
        this.base?.fadeOut(0.15);
        this.base = want;
      }
    }
    this.mixer.update(dt);
  }

  /**
   * Play a one-shot clip. `at` (0..1) resolves `hit` at that point of the clip (the moment
   * a blow lands or a spell leaves the hand); `done` resolves when it has finished.
   */
  play(kind, { at = 0.5, speed = 1, hold = false } = {}) {
    const a = this.action(kind);
    if (!a) return { hit: Promise.resolve(), done: Promise.resolve() };
    this.oneShot?.fadeOut(0.1);
    a.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.1).play();
    a.clampWhenFinished = true;
    a.timeScale = speed;
    this.base?.fadeOut(0.1);
    this.base = null;
    this.oneShot = a;
    if (hold) this.holdLast = true;
    const len = (a.getClip().duration / speed) * 1000;
    const hit = new Promise((r) => setTimeout(r, len * at));
    const done = new Promise((r) => setTimeout(r, len)).then(() => {
      if (this.oneShot === a && !hold) {
        this.oneShot = null; // update() fades the base loop back in
        a.fadeOut(0.2);
      }
    });
    return { hit, done };
  }

  /** Jump straight to the end of a clip (corpses already lying on the floor). */
  pose(kind) {
    const a = this.action(kind);
    if (!a) return;
    this.base?.stop();
    a.reset().setLoop(THREE.LoopOnce, 1).play();
    a.clampWhenFinished = true;
    a.time = a.getClip().duration;
    this.oneShot = a;
    this.holdLast = true;
    this.mixer.update(0);
  }

  /** Swap the melee weapons for the ranged ones while shooting. */
  drawRanged(on) {
    if (!this.weapons.ranged.length) return;
    for (const o of this.weapons.ranged) o.visible = on;
    for (const o of this.weapons.melee) o.visible = !on;
  }
}
