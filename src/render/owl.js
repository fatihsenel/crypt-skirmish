// Rules 9: the Wizard's or Warlock's owl familiar, a small figure of plain shapes that perches on
// a tile and flies in an arc to the next one.

import * as THREE from 'three';
import { tween, easeOut, keepAwake } from './tween.js';

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
const PERCH = 0.06;

export function createOwl(scene, at) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const brown = mat(0x8a6a48);
  const trunk = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), brown);
  trunk.scale.set(1, 1.25, 0.95);
  trunk.position.y = 0.15;
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mat(0xd8c4a0));
  belly.scale.set(0.9, 1.1, 0.5);
  belly.position.set(0, 0.13, 0.07);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), brown);
  head.position.y = 0.33;
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.075, 16), mat(0xe6d6b4));
  face.position.set(0, 0.33, 0.102);
  const eyeMat = mat(0xffc830, { emissive: 0xc08010, emissiveIntensity: 0.8 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), eyeMat);
    eye.position.set(s * 0.035, 0.345, 0.104);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), mat(0x111111));
    pupil.position.set(s * 0.035, 0.345, 0.125);
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 6), brown);
    tuft.position.set(s * 0.06, 0.43, 0);
    tuft.rotation.z = -s * 0.35;
    body.add(eye, pupil, tuft);
  }
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.05, 6), mat(0x3a3028));
  beak.position.set(0, 0.31, 0.115);
  beak.rotation.x = Math.PI * 0.6;
  const wings = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.11, 0.2, 0);
    const wing = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mat(0x6e5236));
    wing.scale.set(0.35, 1, 0.8);
    wing.position.set(s * 0.02, -0.04, -0.01);
    pivot.add(wing);
    body.add(pivot);
    return { pivot, s };
  });
  body.add(trunk, belly, head, face, beak);
  body.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  body.scale.setScalar(1.6); // about half a figure's height
  group.position.set(at.x, PERCH, at.z);
  group.rotation.y = Math.PI / 4; // facing the camera
  scene.add(group);

  const flap = (a) => { for (const { pivot, s } of wings) pivot.rotation.z = s * a; };
  let tile = { x: at.x, z: at.z };
  return {
    group,
    get tile() { return tile; },
    /** Fly in an arc to (x, z), wings beating, and settle there. */
    async flyTo(x, z, ms = 650) {
      const from = group.position.clone();
      const dist = Math.hypot(x - from.x, z - from.z);
      group.rotation.y = Math.atan2(x - from.x, z - from.z);
      keepAwake(ms + 100);
      await tween(ms, (t) => {
        group.position.set(from.x + (x - from.x) * t, PERCH + Math.sin(t * Math.PI) * (0.5 + dist * 0.12), from.z + (z - from.z) * t);
        flap(Math.sin(t * Math.PI * 8) * 1.1 + 0.6);
      }, easeOut);
      flap(0);
      group.rotation.y = Math.PI / 4; // settled, it looks out at the camera
      tile = { x, z };
    },
    /** Swatted: gone in a puff, until the next fight. */
    async vanish() {
      keepAwake(500);
      await tween(400, (t) => {
        group.scale.setScalar(Math.max(0.01, 1 - t));
        group.position.y = PERCH + t * 0.5;
        flap(Math.sin(t * Math.PI * 6));
      });
      scene.remove(group);
      tile = null;
    },
    remove() {
      scene.remove(group);
      tile = null;
    },
  };
}
