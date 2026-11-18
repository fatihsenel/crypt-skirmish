// Procedural, rigged miniatures built from three.js primitives.
//
// Every builder returns a rig:
//   root   - whole figure (feet at y = 0, facing +z)
//   body   - upper body pivot at the hips (bobs, leans)
//   head   - head pivot
//   armL / armR - shoulder pivots, arm hangs along -y, hand at (0, -len, 0)
//   legL / legR - hip pivots (null for robed figures)
//   skirt  - optional robe pivot that sways when walking
//   rest   - resting arm angles { armL, armR } (rotation.x; negative = forward)
//   height - top of the figure, used to place the name label
//   idle(t, walking) - optional per-model idle flourish
//
// Swap any builder for a GLTF model later; keep the same rig fields and the
// animations in unitView.js keep working.

import * as THREE from 'three';
import { piece } from './dungeonKit.js';

const { PI } = Math;
const cache = new Map();

/** Shared standard material, cached by color + options. */
function mat(color, opts = {}) {
  const k = `${color}|${JSON.stringify(opts)}`;
  if (!cache.has(k)) cache.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...opts }));
  return cache.get(k);
}

const shade = (color, f) => new THREE.Color(color).multiplyScalar(f).getHex();

function add(parent, geo, material, pos = [0, 0, 0], rot = [0, 0, 0], scale = null) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(...pos);
  m.rotation.set(...rot);
  if (scale) m.scale.set(...scale);
  parent.add(m);
  return m;
}

function pivot(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** A limb hanging down from its pivot; end of the limb is at (0, -length, 0). */
function limb(parent, [x, y, z], length, r, material, rEnd) {
  const p = pivot(parent, x, y, z);
  const geo = rEnd === undefined
    ? new THREE.CapsuleGeometry(r, Math.max(0.001, length - 2 * r), 4, 10)
    : new THREE.CylinderGeometry(r, rEnd, length, 12);
  add(p, geo, material, [0, -length / 2, 0]);
  return p;
}

// ---------------------------------------------------------------------------
// Fighter: plate armor, tabard in team color, cape, plumed helm, sword & shield
// ---------------------------------------------------------------------------
function fighter(unit) {
  const root = new THREE.Group();
  const steel = mat(0xb4bac4, { metalness: 0.75, roughness: 0.32 });
  const darkSteel = mat(0x6a707b, { metalness: 0.7, roughness: 0.45 });
  const gold = mat(0xd4a64a, { metalness: 0.8, roughness: 0.3 });
  const leather = mat(0x5a3b22);
  const cloth = mat(unit.color);
  const capeMat = mat(shade(unit.color, 0.55));
  const skin = mat(0xe0b18c);
  const dark = mat(0x1a1410);

  const hipY = 0.52;
  const legL = limb(root, [0.09, hipY, 0], 0.42, 0.07, darkSteel);
  const legR = limb(root, [-0.09, hipY, 0], 0.42, 0.07, darkSteel);
  for (const leg of [legL, legR]) {
    add(leg, new THREE.SphereGeometry(0.06, 10, 8), steel, [0, -0.2, 0.05]); // knee cop
    add(leg, new THREE.BoxGeometry(0.12, 0.08, 0.2), leather, [0, -0.41, 0.03]); // boot
  }

  const body = pivot(root, 0, hipY, 0);
  add(body, new THREE.CylinderGeometry(0.17, 0.21, 0.16, 18), darkSteel, [0, 0, 0]); // tassets
  add(body, new THREE.CylinderGeometry(0.21, 0.17, 0.36, 18), steel, [0, 0.24, 0]); // breastplate
  add(body, new THREE.BoxGeometry(0.2, 0.44, 0.03), cloth, [0, 0.1, 0.185]); // tabard
  add(body, new THREE.BoxGeometry(0.06, 0.12, 0.035), gold, [0, 0.2, 0.2]); // tabard emblem
  add(body, new THREE.TorusGeometry(0.18, 0.025, 6, 22), leather, [0, 0.07, 0], [PI / 2, 0, 0]); // belt
  add(body, new THREE.BoxGeometry(0.06, 0.05, 0.02), gold, [0, 0.07, 0.195]); // buckle
  add(body, new THREE.BoxGeometry(0.38, 0.6, 0.025), capeMat, [0, 0.12, -0.2], [0.12, 0, 0]); // cape
  for (const s of [-1, 1]) {
    add(body, new THREE.SphereGeometry(0.11, 14, 10, 0, PI * 2, 0, PI / 2), steel, [s * 0.23, 0.39, 0], [0, 0, -s * 0.45]); // pauldron
  }

  const head = pivot(body, 0, 0.56, 0);
  add(head, new THREE.SphereGeometry(0.115, 18, 14), skin);
  add(head, new THREE.SphereGeometry(0.13, 18, 12, 0, PI * 2, 0, PI * 0.55), steel, [0, 0.01, 0]); // helm
  add(head, new THREE.CylinderGeometry(0.136, 0.136, 0.035, 20), darkSteel); // helm rim
  add(head, new THREE.BoxGeometry(0.026, 0.11, 0.02), steel, [0, -0.04, 0.128]); // nasal guard
  add(head, new THREE.BoxGeometry(0.035, 0.09, 0.2), mat(0xb3282d), [0, 0.15, -0.02]); // plume
  for (const s of [-1, 1]) add(head, new THREE.SphereGeometry(0.016, 8, 6), dark, [s * 0.045, -0.03, 0.105]);

  const armL = limb(body, [0.25, 0.37, 0], 0.36, 0.055, darkSteel);
  const armR = limb(body, [-0.25, 0.37, 0], 0.36, 0.055, darkSteel);
  for (const arm of [armL, armR]) add(arm, new THREE.SphereGeometry(0.052, 10, 8), leather, [0, -0.36, 0]); // gauntlet

  const sword = pivot(armR, 0, -0.36, 0.02);
  add(sword, new THREE.BoxGeometry(0.038, 0.012, 0.54), mat(0xe2e6ec, { metalness: 0.9, roughness: 0.2 }), [0, 0, 0.33]);
  add(sword, new THREE.BoxGeometry(0.17, 0.03, 0.03), gold, [0, 0, 0.06]); // crossguard
  add(sword, new THREE.CylinderGeometry(0.018, 0.018, 0.11, 8), leather, [0, 0, 0], [PI / 2, 0, 0]); // grip
  add(sword, new THREE.SphereGeometry(0.025, 8, 6), gold, [0, 0, -0.06]); // pommel

  const shield = pivot(armL, 0.05, -0.22, 0.1);
  add(shield, new THREE.CylinderGeometry(0.2, 0.2, 0.035, 26), cloth, [0, 0, 0], [PI / 2, 0, 0]);
  add(shield, new THREE.TorusGeometry(0.2, 0.018, 6, 26), steel);
  add(shield, new THREE.SphereGeometry(0.055, 12, 8), steel, [0, 0, 0.02]); // boss
  add(shield, new THREE.BoxGeometry(0.03, 0.34, 0.01), gold, [0, 0, 0.02]); // stripe

  return { root, body, head, armL, armR, legL, legR, rest: { armL: -0.55, armR: -0.35 }, height: 1.32 };
}

// ---------------------------------------------------------------------------
// Wizard: long robe in team color, pointed hat, red hair, staff with fire orb
// ---------------------------------------------------------------------------
function wizard(unit) {
  const root = new THREE.Group();
  const robe = mat(unit.color);
  const robeDark = mat(shade(unit.color, 0.55));
  const trim = mat(0xd9b45a, { metalness: 0.6, roughness: 0.4 });
  const skin = mat(0xf0c8a6);
  const hair = mat(0x9a3c1c);
  const wood = mat(0x6b4a2b);
  const dark = mat(0x1a1410);

  // Robe skirt (sways instead of legs)
  const skirt = pivot(root, 0, 0.55, 0);
  add(skirt, new THREE.CylinderGeometry(0.16, 0.3, 0.48, 22), robe, [0, -0.24, 0]);
  add(skirt, new THREE.TorusGeometry(0.29, 0.018, 6, 26), trim, [0, -0.45, 0], [PI / 2, 0, 0]);
  add(skirt, new THREE.BoxGeometry(0.05, 0.46, 0.02), trim, [0, -0.24, 0.235], [-0.27, 0, 0]); // front trim

  const body = pivot(root, 0, 0.52, 0);
  add(body, new THREE.CylinderGeometry(0.14, 0.17, 0.34, 20), robe, [0, 0.17, 0]);
  add(body, new THREE.TorusGeometry(0.165, 0.022, 6, 22), trim, [0, 0.03, 0], [PI / 2, 0, 0]); // sash
  add(body, new THREE.TorusGeometry(0.11, 0.03, 6, 18), robeDark, [0, 0.33, 0], [PI / 2, 0, 0]); // collar
  add(body, new THREE.BoxGeometry(0.1, 0.13, 0.07), mat(0x7a5233), [0.15, 0.0, 0.08], [0, 0.5, 0]); // satchel
  add(body, new THREE.BoxGeometry(0.11, 0.08, 0.03), mat(0x3a2a6a), [-0.06, 0.18, 0.15], [0, 0, 0.2]); // spellbook strap

  const head = pivot(body, 0, 0.45, 0);
  add(head, new THREE.SphereGeometry(0.105, 18, 14), skin);
  add(head, new THREE.SphereGeometry(0.115, 16, 12), hair, [0, 0.025, -0.03]);
  add(head, new THREE.BoxGeometry(0.2, 0.3, 0.06), hair, [0, -0.12, -0.08]); // long hair
  for (const s of [-1, 1]) add(head, new THREE.SphereGeometry(0.014, 8, 6), dark, [s * 0.04, -0.005, 0.098]);
  // Hat, tipped back so the face stays visible from the isometric camera
  const hat = pivot(head, 0, 0.07, -0.02);
  hat.rotation.x = -0.32;
  add(hat, new THREE.CylinderGeometry(0.22, 0.22, 0.02, 24), robeDark, [0, 0.015, 0]);
  add(hat, new THREE.ConeGeometry(0.13, 0.34, 18), robeDark, [0, 0.19, 0]);
  add(hat, new THREE.TorusGeometry(0.125, 0.016, 6, 20), trim, [0, 0.04, 0], [PI / 2, 0, 0]);
  add(hat, new THREE.ConeGeometry(0.05, 0.16, 12), robeDark, [0, 0.37, -0.05], [-0.6, 0, 0]); // bent tip
  add(hat, new THREE.OctahedronGeometry(0.03), trim, [0, 0.13, 0.11]); // star on hat
  add(head, new THREE.SphereGeometry(0.02, 8, 6), mat(0xe39a8a), [0, -0.03, 0.105]); // nose

  const armL = limb(body, [0.19, 0.29, 0], 0.34, 0.05, robe, 0.085);
  const armR = limb(body, [-0.19, 0.29, 0], 0.34, 0.05, robe, 0.085);
  for (const arm of [armL, armR]) add(arm, new THREE.SphereGeometry(0.042, 10, 8), skin, [0, -0.37, 0]);

  // Staff, held upright in the right hand
  const staff = pivot(armR, 0, -0.37, 0);
  staff.rotation.x = 0.35; // cancels the arm's resting angle so the staff stands up
  add(staff, new THREE.CylinderGeometry(0.022, 0.028, 1.15, 8), wood, [0, 0.13, 0]);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2;
    add(staff, new THREE.ConeGeometry(0.018, 0.12, 6), wood, [Math.cos(a) * 0.05, 0.74, Math.sin(a) * 0.05], [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5]);
  }
  const orbMat = new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff5a00, emissiveIntensity: 2 });
  add(staff, new THREE.SphereGeometry(0.065, 16, 12), orbMat, [0, 0.78, 0]);
  const orbLight = new THREE.PointLight(0xff7a1a, 1.2, 2.2, 2);
  orbLight.position.set(0, 0.78, 0);
  staff.add(orbLight);

  const idle = (t) => {
    const pulse = 1.6 + Math.sin(t * 3) * 0.5;
    orbMat.emissiveIntensity = pulse;
    orbLight.intensity = pulse * 0.7;
  };

  return {
    root, body, head, armL, armR, legL: null, legR: null, skirt,
    rest: { armL: -0.15, armR: -0.35 }, height: 1.5, idle,
    flare: () => { orbMat.emissiveIntensity = 6; orbLight.intensity = 6; },
  };
}

// ---------------------------------------------------------------------------
// Goblin: small, hunched, big ears, hooked nose, glowing eyes, scimitar, bow
// ---------------------------------------------------------------------------
function goblin(unit) {
  const root = new THREE.Group();
  const variant = unit.variant ?? 1;
  const skin = mat(variant % 2 ? 0x6e9b3a : 0x7f9a2e);
  const skinDark = mat(variant % 2 ? 0x4f7426 : 0x5d7322);
  const leather = mat(0x6b4a2b);
  const cloth = mat(0x7a5c3a);
  const eye = new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xffa000, emissiveIntensity: 0.9 });
  const dark = mat(0x140c08);
  const tooth = mat(0xf2ecd0);
  const steel = mat(0xa9adb3, { metalness: 0.7, roughness: 0.4 });

  const hipY = 0.3;
  const legL = limb(root, [0.07, hipY, 0], 0.24, 0.045, skin);
  const legR = limb(root, [-0.07, hipY, 0], 0.24, 0.045, skin);
  for (const leg of [legL, legR]) {
    add(leg, new THREE.BoxGeometry(0.08, 0.04, 0.15), skinDark, [0, -0.235, 0.035]); // bare foot
  }

  const body = pivot(root, 0, hipY, 0);
  body.rotation.x = 0.25; // hunched forward
  add(body, new THREE.CylinderGeometry(0.12, 0.14, 0.12, 14), cloth, [0, 0, 0]); // loincloth
  add(body, new THREE.BoxGeometry(0.11, 0.15, 0.02), cloth, [0, -0.08, 0.125]); // flap
  add(body, new THREE.SphereGeometry(0.16, 16, 12), skin, [0, 0.17, 0], [0, 0, 0], [1, 1.15, 0.85]); // torso
  add(body, new THREE.SphereGeometry(0.1, 12, 10), skinDark, [0, 0.12, 0.06], [0, 0, 0], [1, 0.9, 0.8]); // belly
  add(body, new THREE.BoxGeometry(0.045, 0.38, 0.02), leather, [0, 0.18, 0.13], [0, 0, 0.6]); // harness
  add(body, new THREE.BoxGeometry(0.045, 0.38, 0.02), leather, [0, 0.18, -0.13], [0, 0, -0.6]);

  // Shortbow slung across the back
  const bow = pivot(body, 0, 0.2, -0.17);
  bow.rotation.z = 0.5;
  add(bow, new THREE.TorusGeometry(0.2, 0.013, 6, 18, PI), leather, [0, 0, 0], [0, 0, -PI / 2]);
  add(bow, new THREE.CylinderGeometry(0.004, 0.004, 0.4, 4), mat(0xe8e0c8));

  const head = pivot(body, 0, 0.4, 0.05);
  head.rotation.x = -0.25; // look up despite the hunch
  add(head, new THREE.SphereGeometry(0.15, 18, 14), skin, [0, 0, 0], [0, 0, 0], [1.05, 0.95, 1]);
  for (const s of [-1, 1]) {
    // long pointed ears sticking out sideways and up
    add(head, new THREE.ConeGeometry(0.055, 0.3, 10), skin, [s * 0.27, 0.08, -0.01], [0, 0, -s * (PI / 2 - 0.35)], [1, 1, 0.45]);
    add(head, new THREE.ConeGeometry(0.03, 0.2, 8), skinDark, [s * 0.25, 0.08, 0.008], [0, 0, -s * (PI / 2 - 0.35)], [1, 1, 0.3]);
    add(head, new THREE.SphereGeometry(0.032, 10, 8), eye, [s * 0.06, 0.03, 0.12]);
    add(head, new THREE.SphereGeometry(0.013, 6, 6), dark, [s * 0.06, 0.03, 0.15]);
    add(head, new THREE.ConeGeometry(0.012, 0.035, 5), tooth, [s * 0.035, -0.06, 0.14]); // tusk
  }
  add(head, new THREE.ConeGeometry(0.035, 0.14, 8), skinDark, [0, -0.01, 0.18], [PI / 2 + 0.3, 0, 0]); // hooked nose
  add(head, new THREE.BoxGeometry(0.17, 0.025, 0.04), skinDark, [0, 0.075, 0.12], [0.35, 0, 0]); // angry brow
  add(head, new THREE.BoxGeometry(0.1, 0.014, 0.02), dark, [0, -0.075, 0.13]); // mouth
  if (variant % 2 === 0) {
    // the second goblin wears a crude leather cap
    add(head, new THREE.SphereGeometry(0.155, 16, 10, 0, PI * 2, 0, PI * 0.45), leather, [0, 0.02, -0.01]);
  }

  const armL = limb(body, [0.17, 0.26, 0], 0.3, 0.038, skin);
  const armR = limb(body, [-0.17, 0.26, 0], 0.3, 0.038, skin);
  for (const arm of [armL, armR]) add(arm, new THREE.SphereGeometry(0.045, 10, 8), skinDark, [0, -0.3, 0]);

  // Scimitar: curved blade made from a torus arc
  const sword = pivot(armR, 0, -0.3, 0.02);
  const bladeGeo = new THREE.TorusGeometry(0.3, 0.02, 4, 14, PI / 3).rotateY(-PI / 2).translate(0, 0, -0.3);
  add(sword, bladeGeo, steel, [0, 0, 0.05], [0, 0, 0], [0.35, 1, 1]);
  add(sword, new THREE.BoxGeometry(0.1, 0.025, 0.025), leather, [0, 0, 0.04]);
  add(sword, new THREE.CylinderGeometry(0.016, 0.016, 0.09, 6), leather, [0, 0, 0], [PI / 2, 0, 0]);

  const idle = (t) => {
    eye.emissiveIntensity = 0.7 + Math.max(0, Math.sin(t * 1.3)) * 0.6;
    head.rotation.y = Math.sin(t * 0.7) * 0.25; // shifty glances
  };

  return { root, body, head, armL, armR, legL, legR, rest: { armL: -0.2, armR: -0.45 }, height: 1.0, idle };
}

// ---------------------------------------------------------------------------
// Skeleton: skull with glowing eyes and chattering jaw, ribcage, bone limbs
// ---------------------------------------------------------------------------
function skeleton() {
  const root = new THREE.Group();
  const bone = mat(0xe8dfc8, { roughness: 0.85 });
  const boneDark = mat(0xb9ad8e, { roughness: 0.9 });
  const socket = new THREE.MeshBasicMaterial({ color: 0x120a08 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xff3b2b });
  const rust = mat(0x8a6f55, { metalness: 0.5, roughness: 0.6 });
  const rag = mat(0x3d3328, { roughness: 1 });

  const hipY = 0.5;
  const legs = [-1, 1].map((s) => {
    const thigh = limb(root, [s * 0.08, hipY, 0], 0.22, 0.025, bone);
    add(thigh, new THREE.SphereGeometry(0.035, 8, 6), boneDark, [0, -0.22, 0]); // knee
    const shin = limb(thigh, [0, -0.22, 0], 0.22, 0.022, bone);
    add(shin, new THREE.BoxGeometry(0.06, 0.03, 0.12), bone, [0, -0.215, 0.03]); // foot
    return thigh;
  });

  const body = pivot(root, 0, hipY, 0);
  // pelvis: two hip-bone wings plus a small crest
  for (const s of [-1, 1]) {
    add(body, new THREE.SphereGeometry(0.06, 10, 8), boneDark, [s * 0.06, 0.01, 0], [0, 0, 0], [1, 0.75, 0.45]);
  }
  add(body, new THREE.BoxGeometry(0.05, 0.05, 0.04), boneDark, [0, -0.02, -0.04]);
  add(body, new THREE.BoxGeometry(0.2, 0.12, 0.015), rag, [0, -0.08, 0.05], [0.12, 0, 0]); // tattered loincloth
  add(body, new THREE.BoxGeometry(0.06, 0.06, 0.015), rag, [0.05, -0.16, 0.06], [0.12, 0, 0.3]);
  add(body, new THREE.CylinderGeometry(0.02, 0.022, 0.44, 6), bone, [0, 0.22, -0.07]); // spine
  for (let i = 0; i < 5; i++) add(body, new THREE.BoxGeometry(0.045, 0.022, 0.04), boneDark, [0, 0.04 + i * 0.045, -0.07]);
  [0.105, 0.125, 0.13, 0.12].forEach((r, i) => {
    // rib arcs, open at the back where the spine is
    const geo = new THREE.TorusGeometry(r, 0.013, 5, 20, PI * 1.7).rotateX(PI / 2).rotateY(0.35 * PI);
    add(body, geo, bone, [0, 0.38 - i * 0.055, 0], [0, 0, 0], [1, 1, 0.8]);
  });
  add(body, new THREE.BoxGeometry(0.03, 0.17, 0.02), bone, [0, 0.3, 0.1]); // sternum
  add(body, new THREE.BoxGeometry(0.36, 0.03, 0.04), bone, [0, 0.42, -0.02]); // collarbones

  const head = pivot(body, 0, 0.56, 0);
  add(head, new THREE.SphereGeometry(0.11, 18, 14), bone, [0, 0.02, 0], [0, 0, 0], [1, 1.05, 1.12]);
  for (const s of [-1, 1]) {
    add(head, new THREE.SphereGeometry(0.033, 10, 8), socket, [s * 0.045, 0.0, 0.095]);
    add(head, new THREE.SphereGeometry(0.014, 8, 6), glow, [s * 0.045, 0.0, 0.122]);
  }
  add(head, new THREE.ConeGeometry(0.016, 0.035, 3), socket, [0, -0.04, 0.118], [PI, 0, 0]); // nose hole
  const jaw = pivot(head, 0, -0.06, 0.02);
  add(jaw, new THREE.BoxGeometry(0.13, 0.04, 0.1), bone, [0, -0.025, 0.04]);
  add(jaw, new THREE.BoxGeometry(0.1, 0.018, 0.01), mat(0xf6f0de), [0, 0, 0.09]); // teeth

  const arms = [-1, 1].map((s) => {
    const upper = limb(body, [s * 0.18, 0.42, -0.02], 0.2, 0.022, bone);
    add(upper, new THREE.SphereGeometry(0.03, 8, 6), boneDark, [0, -0.2, 0]); // elbow
    const fore = limb(upper, [0, -0.2, 0], 0.19, 0.019, bone);
    fore.rotation.x = -0.3;
    add(fore, new THREE.BoxGeometry(0.05, 0.06, 0.03), bone, [0, -0.2, 0]); // hand
    return { upper, fore };
  });
  const [armRParts, armLParts] = arms; // s = -1 is the right side

  // Rusty shortsword
  const sword = pivot(armRParts.fore, 0, -0.2, 0.01);
  add(sword, new THREE.BoxGeometry(0.035, 0.01, 0.42), rust, [0, 0, 0.26]);
  add(sword, new THREE.BoxGeometry(0.12, 0.025, 0.025), boneDark, [0, 0, 0.05]);
  add(sword, new THREE.CylinderGeometry(0.014, 0.014, 0.08, 6), rag, [0, 0, 0], [PI / 2, 0, 0]);

  const idle = (t) => {
    jaw.rotation.x = Math.max(0, Math.sin(t * 11)) * 0.25 * (Math.sin(t * 0.8) > 0.4 ? 1 : 0.15);
    glow.color.setHSL(0.01, 1, 0.45 + Math.sin(t * 4) * 0.1);
  };

  return {
    root, body, head,
    armL: armLParts.upper, armR: armRParts.upper,
    legL: legs[1], legR: legs[0],
    rest: { armL: -0.15, armR: -0.3 }, height: 1.25, idle,
  };
}

// ---------------------------------------------------------------------------
// Rogue: hooded leather armor, cloak in team color, shortsword, bow on the back
// ---------------------------------------------------------------------------
function rogue(unit) {
  const root = new THREE.Group();
  const leather = mat(0x4a3424);
  const leatherDark = mat(0x2f2119);
  const cloak = mat(shade(unit.color, 0.8));
  const cloakDark = mat(shade(unit.color, 0.5));
  const skin = mat(0xd9a67e);
  const steel = mat(0xd0d5dc, { metalness: 0.85, roughness: 0.25 });
  const dark = mat(0x140e0a);
  const scarf = mat(0x2a2a30);

  const hipY = 0.5;
  const legL = limb(root, [0.08, hipY, 0], 0.4, 0.055, leatherDark);
  const legR = limb(root, [-0.08, hipY, 0], 0.4, 0.055, leatherDark);
  for (const leg of [legL, legR]) {
    add(leg, new THREE.CylinderGeometry(0.062, 0.06, 0.16, 10), leather, [0, -0.33, 0]); // tall boot
    add(leg, new THREE.BoxGeometry(0.1, 0.05, 0.17), leather, [0, -0.39, 0.03]);
  }

  const body = pivot(root, 0, hipY, 0);
  body.rotation.x = 0.08; // slight crouch
  add(body, new THREE.CylinderGeometry(0.15, 0.16, 0.12, 16), leatherDark, [0, 0, 0]);
  add(body, new THREE.CylinderGeometry(0.17, 0.14, 0.36, 16), leather, [0, 0.22, 0]); // jerkin
  for (let i = 0; i < 3; i++) add(body, new THREE.BoxGeometry(0.2, 0.015, 0.02), leatherDark, [0, 0.14 + i * 0.08, 0.15]); // straps
  add(body, new THREE.TorusGeometry(0.16, 0.02, 6, 20), leatherDark, [0, 0.06, 0], [PI / 2, 0, 0]); // belt
  for (const s of [-1, 1]) add(body, new THREE.BoxGeometry(0.05, 0.08, 0.04), leather, [s * 0.12, 0.05, 0.11]); // pouches
  add(body, new THREE.BoxGeometry(0.36, 0.62, 0.025), cloak, [0, 0.1, -0.17], [0.15, 0, 0]); // cloak
  add(body, new THREE.TorusGeometry(0.12, 0.035, 8, 18), cloakDark, [0, 0.4, 0], [PI / 2, 0, 0]); // mantle

  // Shortbow and quiver on the back
  const quiver = pivot(body, 0.08, 0.22, -0.2);
  quiver.rotation.z = -0.35;
  add(quiver, new THREE.CylinderGeometry(0.045, 0.04, 0.3, 10), leatherDark);
  for (let i = 0; i < 3; i++) add(quiver, new THREE.ConeGeometry(0.02, 0.06, 4), mat(0xd8d0c0), [(i - 1) * 0.025, 0.18, 0]);

  const head = pivot(body, 0, 0.5, 0);
  add(head, new THREE.SphereGeometry(0.1, 18, 14), skin);
  add(head, new THREE.BoxGeometry(0.17, 0.06, 0.04), scarf, [0, -0.05, 0.085]); // face scarf
  for (const s of [-1, 1]) add(head, new THREE.SphereGeometry(0.014, 8, 6), dark, [s * 0.038, 0.01, 0.094]);
  add(head, new THREE.BoxGeometry(0.12, 0.018, 0.02), mat(0x3a2418), [0, 0.04, 0.09], [0.2, 0, 0]); // brow
  // Deep hood, pulled forward
  add(head, new THREE.SphereGeometry(0.135, 18, 12, 0, PI * 2, 0, PI * 0.62), cloak, [0, 0.02, -0.015], [-0.25, 0, 0]);
  add(head, new THREE.ConeGeometry(0.06, 0.16, 10), cloak, [0, 0.07, -0.13], [-1.9, 0, 0]); // hood tail

  const armL = limb(body, [0.21, 0.36, 0], 0.34, 0.045, leather);
  const armR = limb(body, [-0.21, 0.36, 0], 0.34, 0.045, leather);
  for (const arm of [armL, armR]) add(arm, new THREE.SphereGeometry(0.042, 10, 8), leatherDark, [0, -0.34, 0]);

  const sword = pivot(armR, 0, -0.34, 0.02);
  add(sword, new THREE.BoxGeometry(0.03, 0.01, 0.36), steel, [0, 0, 0.23]);
  add(sword, new THREE.BoxGeometry(0.1, 0.02, 0.02), leatherDark, [0, 0, 0.05]);
  add(sword, new THREE.CylinderGeometry(0.014, 0.014, 0.08, 6), leather, [0, 0, 0], [PI / 2, 0, 0]);
  const dagger = pivot(armL, 0, -0.34, 0.02);
  dagger.rotation.x = PI; // reverse grip
  add(dagger, new THREE.BoxGeometry(0.025, 0.008, 0.2), steel, [0, 0, 0.13]);
  add(dagger, new THREE.CylinderGeometry(0.012, 0.012, 0.06, 6), leatherDark, [0, 0, 0], [PI / 2, 0, 0]);

  return { root, body, head, armL, armR, legL, legR, rest: { armL: -0.5, armR: -0.55 }, height: 1.22 };
}

// ---------------------------------------------------------------------------
// Cleric: chain mail, white tabard with a golden sun, round shield, mace
// ---------------------------------------------------------------------------
function cleric(unit) {
  const root = new THREE.Group();
  const chain = mat(0x8d939c, { metalness: 0.7, roughness: 0.5 });
  const steel = mat(0xc7ccd3, { metalness: 0.8, roughness: 0.3 });
  const white = mat(0xece6d6);
  const gold = mat(0xe0b44a, { metalness: 0.8, roughness: 0.3 });
  const team = mat(unit.color);
  const leather = mat(0x5a3b22);
  const skin = mat(0xb07a56);
  const hair = mat(0x241812);
  const dark = mat(0x1a1410);

  const hipY = 0.5;
  const legL = limb(root, [0.085, hipY, 0], 0.4, 0.06, chain);
  const legR = limb(root, [-0.085, hipY, 0], 0.4, 0.06, chain);
  for (const leg of [legL, legR]) add(leg, new THREE.BoxGeometry(0.11, 0.07, 0.19), leather, [0, -0.39, 0.03]);

  const body = pivot(root, 0, hipY, 0);
  add(body, new THREE.CylinderGeometry(0.19, 0.24, 0.24, 18), chain, [0, -0.02, 0]); // mail skirt
  add(body, new THREE.CylinderGeometry(0.2, 0.18, 0.36, 18), chain, [0, 0.24, 0]); // hauberk
  add(body, new THREE.BoxGeometry(0.24, 0.6, 0.03), white, [0, 0.08, 0.19]); // tabard front
  add(body, new THREE.BoxGeometry(0.24, 0.6, 0.03), white, [0, 0.08, -0.19]); // tabard back
  const sun = pivot(body, 0, 0.24, 0.21);
  add(sun, new THREE.CylinderGeometry(0.05, 0.05, 0.015, 16), gold, [0, 0, 0], [PI / 2, 0, 0]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2;
    add(sun, new THREE.ConeGeometry(0.014, 0.05, 4), gold, [Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0], [0, 0, a - PI / 2]);
  }
  add(body, new THREE.TorusGeometry(0.19, 0.022, 6, 22), team, [0, 0.06, 0], [PI / 2, 0, 0]); // sash
  for (const s of [-1, 1]) {
    add(body, new THREE.SphereGeometry(0.1, 14, 10, 0, PI * 2, 0, PI / 2), steel, [s * 0.22, 0.38, 0], [0, 0, -s * 0.4]);
  }

  const head = pivot(body, 0, 0.55, 0);
  add(head, new THREE.SphereGeometry(0.11, 18, 14), skin);
  add(head, new THREE.SphereGeometry(0.118, 16, 12, 0, PI * 2, 0, PI * 0.5), hair, [0, 0.015, -0.01]);
  add(head, new THREE.BoxGeometry(0.16, 0.2, 0.05), hair, [0, -0.06, -0.08]); // braid
  add(head, new THREE.TorusGeometry(0.112, 0.012, 6, 24), gold, [0, 0.04, 0], [PI / 2 - 0.15, 0, 0]); // circlet
  add(head, new THREE.OctahedronGeometry(0.022), mat(0xffe9a0, { emissive: 0xffc040, emissiveIntensity: 0.8 }), [0, 0.06, 0.11]);
  for (const s of [-1, 1]) add(head, new THREE.SphereGeometry(0.015, 8, 6), dark, [s * 0.04, -0.01, 0.1]);

  const armL = limb(body, [0.24, 0.36, 0], 0.35, 0.052, chain);
  const armR = limb(body, [-0.24, 0.36, 0], 0.35, 0.052, chain);
  for (const arm of [armL, armR]) add(arm, new THREE.SphereGeometry(0.05, 10, 8), leather, [0, -0.35, 0]);

  // Flanged mace
  const mace = pivot(armR, 0, -0.35, 0.02);
  add(mace, new THREE.CylinderGeometry(0.016, 0.016, 0.4, 8), leather, [0, 0, 0.14], [PI / 2, 0, 0]);
  add(mace, new THREE.SphereGeometry(0.055, 12, 10), steel, [0, 0, 0.36]);
  for (let i = 0; i < 4; i++) {
    add(mace, new THREE.BoxGeometry(0.012, 0.13, 0.08), steel, [0, 0, 0.36], [0, 0, (i / 4) * PI]);
  }

  // Shield with the sun emblem
  const shield = pivot(armL, 0.05, -0.22, 0.1);
  add(shield, new THREE.CylinderGeometry(0.21, 0.21, 0.035, 26), white, [0, 0, 0], [PI / 2, 0, 0]);
  add(shield, new THREE.TorusGeometry(0.21, 0.02, 6, 26), gold);
  add(shield, new THREE.CylinderGeometry(0.07, 0.07, 0.01, 16), gold, [0, 0, 0.022], [PI / 2, 0, 0]);

  const holy = new THREE.PointLight(0xffd27a, 0, 2.5, 2);
  holy.position.set(0, 1.0, 0.3);
  root.add(holy);
  // flare() lights a short holy glow; idle() fades it out.
  let flareAt = null;
  const idle = (t) => {
    if (flareAt === 'now') flareAt = t;
    holy.intensity = flareAt === null ? 0 : Math.max(0, 5 * (1 - (t - flareAt) / 0.8));
  };

  return {
    root, body, head, armL, armR, legL, legR, rest: { armL: -0.55, armR: -0.35 }, height: 1.3, idle,
    flare: () => { flareAt = 'now'; },
  };
}

// ---------------------------------------------------------------------------
// Orc: big, grey-green, tusks, fur mantle, greataxe
// ---------------------------------------------------------------------------
function orc() {
  const root = new THREE.Group();
  const skin = mat(0x6f8f5a);
  const skinDark = mat(0x4e6a3e);
  const fur = mat(0x5a4632, { roughness: 1 });
  const leather = mat(0x3d2a1c);
  const iron = mat(0x80858d, { metalness: 0.7, roughness: 0.45 });
  const tusk = mat(0xf1e8cc);
  const eye = new THREE.MeshStandardMaterial({ color: 0xff4020, emissive: 0xc01000, emissiveIntensity: 0.9 });
  const dark = mat(0x140c08);

  const hipY = 0.56;
  const legL = limb(root, [0.11, hipY, 0], 0.46, 0.08, leather);
  const legR = limb(root, [-0.11, hipY, 0], 0.46, 0.08, leather);
  for (const leg of [legL, legR]) {
    add(leg, new THREE.CylinderGeometry(0.09, 0.085, 0.14, 10), fur, [0, -0.36, 0]);
    add(leg, new THREE.BoxGeometry(0.14, 0.06, 0.22), skinDark, [0, -0.44, 0.04]);
  }

  const body = pivot(root, 0, hipY, 0);
  body.rotation.x = 0.12;
  add(body, new THREE.CylinderGeometry(0.22, 0.24, 0.16, 16), leather, [0, 0, 0]); // kilt
  add(body, new THREE.SphereGeometry(0.27, 18, 14), skin, [0, 0.28, 0], [0, 0, 0], [1.05, 1.0, 0.8]); // barrel chest
  add(body, new THREE.BoxGeometry(0.06, 0.5, 0.025), leather, [0, 0.25, 0.2], [0, 0, 0.55]); // strap
  add(body, new THREE.TorusGeometry(0.19, 0.08, 8, 18), fur, [0, 0.47, -0.02], [PI / 2, 0, 0]); // fur mantle
  for (const s of [-1, 1]) {
    add(body, new THREE.SphereGeometry(0.11, 12, 10, 0, PI * 2, 0, PI / 2), iron, [s * 0.29, 0.44, 0], [0, 0, -s * 0.5]);
    add(body, new THREE.ConeGeometry(0.025, 0.08, 6), tusk, [s * 0.32, 0.53, 0], [0, 0, -s * 0.4]); // spike
  }

  const head = pivot(body, 0, 0.62, 0.06);
  add(head, new THREE.SphereGeometry(0.14, 18, 14), skin, [0, 0, 0], [0, 0, 0], [1.1, 1, 1]);
  add(head, new THREE.BoxGeometry(0.22, 0.09, 0.12), skinDark, [0, -0.06, 0.07]); // heavy jaw
  add(head, new THREE.BoxGeometry(0.22, 0.035, 0.05), skinDark, [0, 0.05, 0.11], [0.3, 0, 0]); // brow ridge
  for (const s of [-1, 1]) {
    add(head, new THREE.ConeGeometry(0.022, 0.08, 6), tusk, [s * 0.065, -0.02, 0.13], [-0.25, 0, s * 0.15]);
    add(head, new THREE.SphereGeometry(0.022, 8, 6), eye, [s * 0.05, 0.02, 0.125]);
    add(head, new THREE.ConeGeometry(0.035, 0.12, 6), skin, [s * 0.15, 0.02, -0.01], [0, 0, -s * 1.2], [1, 1, 0.5]); // ear
  }
  add(head, new THREE.CylinderGeometry(0.03, 0.05, 0.16, 8), dark, [0, 0.14, -0.04], [-0.3, 0, 0]); // topknot

  const armL = limb(body, [0.33, 0.42, 0], 0.4, 0.075, skin);
  const armR = limb(body, [-0.33, 0.42, 0], 0.4, 0.075, skin);
  for (const arm of [armL, armR]) {
    add(arm, new THREE.CylinderGeometry(0.08, 0.08, 0.1, 10), leather, [0, -0.28, 0]); // bracer
    add(arm, new THREE.SphereGeometry(0.07, 10, 8), skinDark, [0, -0.41, 0]);
  }

  // Greataxe, two-handed look: haft along the arm, big crescent head
  const axe = pivot(armR, 0, -0.41, 0.02);
  add(axe, new THREE.CylinderGeometry(0.02, 0.022, 0.8, 8), mat(0x5a3b22), [0, 0, 0.22], [PI / 2, 0, 0]);
  const blade = new THREE.CylinderGeometry(0.2, 0.2, 0.02, 20, 1, false, 0, PI).rotateZ(PI / 2);
  add(axe, blade, iron, [0, 0.0, 0.52], [0, PI / 2, 0], [1, 0.9, 0.9]);

  const idle = (t) => {
    eye.emissiveIntensity = 0.7 + Math.sin(t * 2) * 0.3;
    body.rotation.x = 0.12 + Math.sin(t * 1.6) * 0.03; // heavy breathing
  };

  return { root, body, head, armL, armR, legL, legR, rest: { armL: -0.3, armR: -0.6 }, height: 1.5, idle };
}

// ---------------------------------------------------------------------------
// Giant rat: a quadruped. Front legs are wired as armL/armR so the walk cycle
// and rig contract still work; `bite` tells unitView to lunge instead of swing.
// ---------------------------------------------------------------------------
function giantRat(unit) {
  const root = new THREE.Group();
  const variant = unit.variant ?? 1;
  const fur = mat([0x6b5a4c, 0x5a4b40, 0x7a6655][variant % 3]);
  const furDark = mat(0x3d3029);
  const pink = mat(0xd89a94);
  const eye = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xc00000, emissiveIntensity: 1.2 });
  const tooth = mat(0xf4e8b0);

  const legY = 0.2;
  const legL = limb(root, [0.1, legY, -0.14], 0.2, 0.04, furDark);
  const legR = limb(root, [-0.1, legY, -0.14], 0.2, 0.04, furDark);
  const armL = limb(root, [0.08, legY, 0.16], 0.2, 0.034, furDark);
  const armR = limb(root, [-0.08, legY, 0.16], 0.2, 0.034, furDark);
  for (const l of [legL, legR, armL, armR]) add(l, new THREE.BoxGeometry(0.06, 0.02, 0.09), pink, [0, -0.2, 0.03]);

  const body = pivot(root, 0, 0.27, 0);
  add(body, new THREE.SphereGeometry(0.2, 18, 14), fur, [0, 0, -0.02], [0, 0, 0], [0.85, 0.75, 1.45]);
  add(body, new THREE.SphereGeometry(0.14, 14, 10), furDark, [0, 0.07, -0.1], [0, 0, 0], [0.9, 0.6, 1.3]); // back ridge
  for (let i = 0; i < 4; i++) {
    add(body, new THREE.ConeGeometry(0.025, 0.08, 4), furDark, [0, 0.18 - Math.abs(i - 1.5) * 0.01, -0.22 + i * 0.1], [-0.3, 0, 0]); // bristles
  }

  // Tail: a chain of segments that wave
  const tail = [];
  let parent = pivot(body, 0, -0.02, -0.28);
  for (let i = 0; i < 6; i++) {
    const seg = pivot(parent, 0, 0, i === 0 ? 0 : -0.1);
    add(seg, new THREE.CylinderGeometry(0.018 - i * 0.0025, 0.022 - i * 0.0025, 0.11, 6), pink, [0, 0, -0.05], [PI / 2, 0, 0]);
    tail.push(seg);
    parent = seg;
  }

  const head = pivot(body, 0, 0.06, 0.27);
  add(head, new THREE.ConeGeometry(0.11, 0.3, 14), fur, [0, 0, 0.1], [PI / 2, 0, 0]);
  add(head, new THREE.SphereGeometry(0.03, 8, 6), pink, [0, 0, 0.25]); // nose
  for (const s of [-1, 1]) {
    add(head, new THREE.SphereGeometry(0.025, 8, 6), eye, [s * 0.06, 0.05, 0.08]);
    add(head, new THREE.SphereGeometry(0.06, 10, 8), pink, [s * 0.08, 0.1, -0.02], [0, 0, 0], [1, 1, 0.3]); // ear
    add(head, new THREE.BoxGeometry(0.14, 0.003, 0.003), furDark, [s * 0.07, -0.01, 0.2], [0, s * 0.3, 0]); // whisker
  }
  add(head, new THREE.BoxGeometry(0.035, 0.04, 0.012), tooth, [0, -0.06, 0.21]); // incisors

  const idle = (t, walking) => {
    tail.forEach((seg, i) => { seg.rotation.y = Math.sin(t * (walking ? 9 : 3) - i * 0.6) * 0.25; });
    head.rotation.x = Math.sin(t * 7) * 0.05; // sniffing
    eye.emissiveIntensity = 1 + Math.sin(t * 3) * 0.3;
  };

  return {
    root, body, head, armL, armR, legL, legR, rest: { armL: 0, armR: 0 }, height: 0.62, idle,
    bite: true, dieAxis: 'z',
  };
}

// ---------------------------------------------------------------------------
// Goblin boss: a bigger goblin with a crown, breastplate and red cape
// ---------------------------------------------------------------------------
function goblinBoss(unit) {
  const rig = goblin({ ...unit, variant: 1 });
  const gold = mat(0xd9aa3a, { metalness: 0.85, roughness: 0.3 });
  const iron = mat(0x5e636b, { metalness: 0.7, roughness: 0.45 });
  const cape = mat(0x8a2222);
  const crown = pivot(rig.head, 0, 0.12, 0);
  add(crown, new THREE.CylinderGeometry(0.1, 0.11, 0.06, 12, 1, true), gold);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    add(crown, new THREE.ConeGeometry(0.02, 0.07, 4), gold, [Math.cos(a) * 0.1, 0.06, Math.sin(a) * 0.1]);
  }
  add(crown, new THREE.OctahedronGeometry(0.022), mat(0xc0203a, { metalness: 0.3, roughness: 0.2 }), [0, 0.01, 0.11]);
  add(rig.body, new THREE.SphereGeometry(0.17, 16, 12, 0, PI * 2, 0, PI * 0.55), iron, [0, 0.12, 0], [0, 0, 0], [1, 1.2, 0.95]);
  add(rig.body, new THREE.BoxGeometry(0.34, 0.45, 0.02), cape, [0, 0.12, -0.17], [0.1, 0, 0]);
  for (const s of [-1, 1]) add(rig.body, new THREE.SphereGeometry(0.07, 10, 8, 0, PI * 2, 0, PI / 2), iron, [s * 0.17, 0.3, 0], [0, 0, -s * 0.5]);
  rig.root.scale.setScalar(1.25);
  rig.height *= 1.25;
  return rig;
}

// ---------------------------------------------------------------------------
// Necromancer: tattered black robe, deep hood with a pale face, skull staff
// ---------------------------------------------------------------------------
function necromancer() {
  const root = new THREE.Group();
  const robe = mat(0x241a2e);
  const robeDark = mat(0x140e1a);
  const trim = mat(0x6a5a3a, { metalness: 0.5, roughness: 0.5 });
  const skin = mat(0xb8b6a8);
  const bone = mat(0xe8dfc8, { roughness: 0.85 });
  const wood = mat(0x2e2218);
  const green = new THREE.MeshStandardMaterial({ color: 0x7dff9a, emissive: 0x20ff60, emissiveIntensity: 1.5 });

  const skirt = pivot(root, 0, 0.55, 0);
  add(skirt, new THREE.CylinderGeometry(0.16, 0.32, 0.5, 9, 1, true), robe, [0, -0.25, 0]); // ragged (9 sides)
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * PI * 2;
    add(skirt, new THREE.ConeGeometry(0.05, 0.12, 4), robeDark, [Math.cos(a) * 0.3, -0.5, Math.sin(a) * 0.3], [PI, 0, 0]); // tatters
  }

  const body = pivot(root, 0, 0.52, 0);
  body.rotation.x = 0.1;
  add(body, new THREE.CylinderGeometry(0.14, 0.17, 0.36, 12), robe, [0, 0.18, 0]);
  add(body, new THREE.TorusGeometry(0.16, 0.02, 6, 20), trim, [0, 0.03, 0], [PI / 2, 0, 0]);
  for (let i = 0; i < 3; i++) add(body, new THREE.SphereGeometry(0.03, 8, 6), bone, [-0.1 + i * 0.1, 0.03, 0.15]); // skull charms
  add(body, new THREE.TorusGeometry(0.13, 0.04, 8, 18), robeDark, [0, 0.35, 0], [PI / 2, 0, 0]);

  const head = pivot(body, 0, 0.48, 0);
  add(head, new THREE.SphereGeometry(0.09, 16, 12), skin, [0, -0.01, 0.01]);
  for (const s of [-1, 1]) add(head, new THREE.SphereGeometry(0.016, 8, 6), green, [s * 0.034, 0.0, 0.088]);
  add(head, new THREE.SphereGeometry(0.15, 18, 12, 0, PI * 2, 0, PI * 0.66), robe, [0, 0.0, -0.02], [-0.35, 0, 0]); // hood
  add(head, new THREE.ConeGeometry(0.09, 0.24, 10), robe, [0, 0.1, -0.12], [-1.2, 0, 0]); // pointed hood

  const armL = limb(body, [0.19, 0.3, 0], 0.36, 0.05, robe, 0.09);
  const armR = limb(body, [-0.19, 0.3, 0], 0.36, 0.05, robe, 0.09);
  for (const arm of [armL, armR]) add(arm, new THREE.SphereGeometry(0.035, 8, 6), skin, [0, -0.38, 0], [0, 0, 0], [0.8, 1.3, 0.8]);

  const staff = pivot(armR, 0, -0.38, 0);
  staff.rotation.x = 0.35;
  add(staff, new THREE.CylinderGeometry(0.02, 0.026, 1.2, 7), wood, [0, 0.14, 0]);
  const skull = pivot(staff, 0, 0.8, 0);
  add(skull, new THREE.SphereGeometry(0.075, 14, 10), bone, [0, 0, 0], [0, 0, 0], [1, 1, 1.1]);
  add(skull, new THREE.BoxGeometry(0.08, 0.035, 0.07), bone, [0, -0.06, 0.02]);
  for (const s of [-1, 1]) add(skull, new THREE.SphereGeometry(0.02, 8, 6), green, [s * 0.03, 0.0, 0.07]);
  const glowLight = new THREE.PointLight(0x40ff70, 1.5, 2.6, 2);
  skull.add(glowLight);

  const idle = (t) => {
    const p = 1.2 + Math.sin(t * 2.5) * 0.5;
    green.emissiveIntensity = p;
    glowLight.intensity = p;
    skull.rotation.y = Math.sin(t * 0.9) * 0.4;
  };

  return {
    root, body, head, armL, armR, legL: null, legR: null, skirt,
    rest: { armL: -0.2, armR: -0.35 }, height: 1.5, idle,
    flare: () => { green.emissiveIntensity = 5; glowLight.intensity = 6; },
  };
}

// ---------------------------------------------------------------------------
// Mimic: the dungeon kit's own chest (so it matches the props), with a mouthful of
// teeth, a tongue and eyes inside. The lid is its jaw: `head` drives it, so the
// quadruped `bite` lunge in unitView snaps it open.
// ---------------------------------------------------------------------------
function mimic() {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);
  const head = pivot(body, 0, 0, 0); // a dummy the bite animation turns; idle maps it to the lid
  const armL = pivot(body, 0.2, 0.2, 0);
  const armR = pivot(body, -0.2, 0.2, 0);
  const tooth = mat(0xf2ead2, { roughness: 0.5 });
  const flesh = mat(0x7a1a28, { roughness: 0.6 });
  const eye = new THREE.MeshStandardMaterial({ color: 0xffd040, emissive: 0xffa000, emissiveIntensity: 1.6 });

  let lid;
  const kit = piece('chest');
  const box = new THREE.Box3();
  if (kit) {
    kit.scale.setScalar(0.5);
    kit.position.z = -0.175;
    body.add(kit);
    lid = kit.getObjectByName('chest_lid');
    kit.traverse((o) => {
      if (o.isMesh) o.material = o.material.clone(); // darkened below, others stay as they are
      if (o.isMesh) o.material.color.multiplyScalar(0.8);
    });
    root.updateMatrixWorld(true);
    box.setFromObject(kit);
  } else {
    add(body, new THREE.BoxGeometry(0.7, 0.36, 0.48), mat(0x6a3e1e), [0, 0.18, 0]);
    lid = pivot(body, 0, 0.36, -0.24);
    add(lid, new THREE.BoxGeometry(0.7, 0.12, 0.48), mat(0x6a3e1e), [0, 0.06, 0.24]);
    box.set(new THREE.Vector3(-0.35, 0, -0.24), new THREE.Vector3(0.35, 0.36, 0.24));
  }
  // The mouth sits at the top of the box, under the lid: a row of teeth along the front lip.
  const w = box.max.x - box.min.x;
  const lip = Math.min(box.max.y, 0.42) - 0.02;
  const front = box.max.z - 0.05;
  for (let i = 0; i < 7; i++) {
    const x = -w * 0.38 + (i / 6) * w * 0.76;
    add(body, new THREE.ConeGeometry(0.03, 0.09, 5), tooth, [x, lip + 0.03, front], [0, 0, 0]);
    add(body, new THREE.ConeGeometry(0.025, 0.07, 5), tooth, [x * 0.95, lip + 0.02, box.min.z + 0.08]);
  }
  const tongue = pivot(body, 0, lip - 0.02, 0);
  add(tongue, new THREE.SphereGeometry(0.1, 12, 8), flesh, [0, 0, 0.12], [0, 0, 0], [1.2, 0.35, 2.2]);
  for (const s of [-1, 1]) add(body, new THREE.SphereGeometry(0.035, 10, 8), eye, [s * 0.12, lip - 0.01, -0.05]);

  const idle = (t, walking) => {
    // The jaw hangs open a little, chewing; the bite lunge (head.rotation.x) throws it wide.
    if (lid) lid.rotation.x = -(0.32 + Math.sin(t * 2.4) * 0.08) - head.rotation.x * 2 - (walking ? 0.25 : 0);
    tongue.rotation.x = Math.sin(t * 3.1) * 0.25;
    eye.emissiveIntensity = 1.3 + Math.sin(t * 4) * 0.4;
  };

  return {
    root, body, head, armL, armR, legL: null, legR: null, rest: { armL: 0, armR: 0 },
    height: 0.75, idle, bite: true, dieAxis: 'z',
  };
}

const BUILDERS = {
  F: fighter, W: wizard, R: rogue, C: cleric,
  g: goblin, s: skeleton, o: orc, r: giantRat, b: goblinBoss, n: necromancer,
  // act two: ghouls and the wight fall back to the skeleton miniature if their .glb fails
  u: skeleton, w: skeleton, m: mimic,
};

export function buildModel(unit) {
  const build = BUILDERS[unit.code];
  if (!build) throw new Error(`No model for unit code "${unit.code}"`);
  const rig = build(unit);
  rig.root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  rig.armL.rotation.x = rig.rest.armL;
  rig.armR.rotation.x = rig.rest.armR;
  rig.bodyY = rig.body.position.y;
  return rig;
}
