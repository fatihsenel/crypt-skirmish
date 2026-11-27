// The wall lights of each act after the first (which keeps the kit's mounted torch): an iron
// cage lantern on an arm in the catacombs, a skull with a candle in its crown in the nest and
// throne, a bronze oil lamp in the sunken halls, and an iron fire basket on the bridge and in the
// den. Built in the wall's frame: the group stands on the wall's face, +z out into the room.
// `sconce(act)` gives the holder, where its flame burns and the flame's and light's colours.

import * as THREE from 'three';
import { mergeMeshes } from './merge.js';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
const IRON = () => std(0x2f2b29, { metalness: 0.7, roughness: 0.45 });

/** A flat iron plate on the wall, where every holder is fixed. */
function plate(g, y, w = 0.14, h = 0.2) {
  const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.025), IRON());
  p.position.set(0, y, 0.012);
  g.add(p);
}

/** Act II: a lantern in an iron cage, hung from an arm. */
function lantern(g) {
  const iron = IRON();
  plate(g, 1.06, 0.1, 0.16);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.3), iron);
  arm.position.set(0, 1.1, 0.15);
  g.add(arm);
  const brace = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.24), iron);
  brace.position.set(0, 1.0, 0.09);
  brace.rotation.x = -0.75;
  g.add(brace);
  const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 5), iron);
  hook.position.set(0, 1.06, 0.28);
  g.add(hook);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.07, 4), iron);
  cap.rotation.y = Math.PI / 4;
  cap.position.set(0, 0.99, 0.28);
  g.add(cap);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.12), iron);
  base.position.set(0, 0.79, 0.28);
  g.add(base);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.19, 0.012), iron);
    bar.position.set(sx * 0.055, 0.885, 0.28 + sz * 0.055);
    g.add(bar);
  }
  // Dim panes of horn between the bars, lit from within.
  const pane = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.1), new THREE.MeshBasicMaterial({ color: 0x8a5a24, transparent: true, opacity: 0.35, depthWrite: false }));
  pane.position.set(0, 0.885, 0.28);
  g.add(pane);
  const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.06, 7), std(0xd8ccae, { roughness: 0.9 }));
  wax.position.set(0, 0.83, 0.28);
  g.add(wax);
  for (const c of g.children) c.position.y -= 0.16; // under the wall's top
  return { at: new THREE.Vector3(0, 0.725, 0.28), scale: 0.55, flame: 0xffc27a, light: 0xffa24d };
}

/** Act III: a skull on a bracket, a candle burning in its crown and its sockets aglow. */
function skullLamp(g) {
  const iron = IRON();
  plate(g, 0.74, 0.12, 0.14);
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.025, 0.2), iron);
  shelf.position.set(0, 0.76, 0.13);
  g.add(shelf);
  const strut = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.18), iron);
  strut.position.set(0, 0.69, 0.08);
  strut.rotation.x = 0.6;
  g.add(strut);
  const bone = std(0x4e473c, { roughness: 0.9 }); // darker than it looks: the flame's right over it
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), bone);
  head.scale.set(0.95, 0.9, 1.1);
  head.position.set(0, 0.86, 0.13);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.045, 0.08), bone);
  jaw.position.set(0, 0.795, 0.18);
  g.add(head, jaw);
  const glow = new THREE.MeshBasicMaterial({ color: 0x9a70e8 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 7, 6), glow);
    eye.scale.z = 0.5;
    eye.position.set(s * 0.036, 0.865, 0.235);
    g.add(eye);
  }
  const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.08, 8), std(0x6a6150, { roughness: 0.9 }));
  wax.position.set(0, 0.97, 0.13);
  g.add(wax);
  // Wax run down over the brow.
  const drip = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.07, 5), wax.material);
  drip.position.set(0.03, 0.93, 0.19);
  g.add(drip);
  return { at: new THREE.Vector3(0, 1.04, 0.13), scale: 0.42, flame: 0xc4a4ff, light: 0xd4c0ff };
}

/** Act IV: a bronze oil lamp on a curling arm, its flame on the spout. */
function oilLamp(g) {
  const bronze = std(0x8a6430, { metalness: 0.75, roughness: 0.38 });
  plate(g, 0.8, 0.12, 0.22);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.74, 0.02), new THREE.Vector3(0, 0.72, 0.12), new THREE.Vector3(0, 0.78, 0.2), new THREE.Vector3(0, 0.84, 0.22),
  ]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.014, 6), bronze));
  const pts = [[0, 0], [0.04, 0], [0.085, 0.02], [0.1, 0.045], [0.092, 0.055], [0.06, 0.05], [0, 0.05]].map(([a, b]) => new THREE.Vector2(a, b));
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(pts, 16), bronze);
  bowl.scale.z = 0.75;
  bowl.position.set(0, 0.84, 0.22);
  g.add(bowl);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.03, 0.1, 8), bronze);
  spout.rotation.x = Math.PI / 2 - 0.35;
  spout.position.set(0, 0.88, 0.31);
  g.add(spout);
  const oil = new THREE.Mesh(new THREE.CircleGeometry(0.075, 14).rotateX(-Math.PI / 2), std(0x2a1a08, { roughness: 0.15 }));
  oil.scale.z = 0.75;
  oil.position.set(0, 0.885, 0.22);
  g.add(oil);
  return { at: new THREE.Vector3(0, 0.95, 0.35), scale: 0.6, flame: 0xffc870, light: 0xffa84a };
}

/** Act V: an iron basket of burning coals on a bracket, a big flame. */
function fireBasket(g) {
  const iron = IRON();
  plate(g, 0.72, 0.16, 0.18);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.26), iron);
    arm.position.set(s * 0.05, 0.75, 0.13);
    arm.rotation.x = -0.25;
    g.add(arm);
  }
  const ringGeo = new THREE.TorusGeometry(0.11, 0.012, 5, 16).rotateX(Math.PI / 2);
  for (const [y, r] of [[0.78, 0.6], [0.9, 1]]) {
    const ring = new THREE.Mesh(ringGeo, iron);
    ring.scale.set(r, 1, r);
    ring.position.set(0, y, 0.24);
    g.add(ring);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.14, 0.012), iron);
    bar.position.set(Math.cos(a) * 0.088, 0.84, 0.24 + Math.sin(a) * 0.088);
    bar.rotation.set(Math.sin(a) * 0.28, 0, -Math.cos(a) * 0.28);
    g.add(bar);
    // A spike above the rim.
    if (i % 2 === 0) {
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.06, 4), iron);
      tip.position.set(Math.cos(a) * 0.11, 0.93, 0.24 + Math.sin(a) * 0.11);
      g.add(tip);
    }
  }
  const coals = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), std(0x401006, { emissive: 0xff4a10, emissiveIntensity: 1.2, roughness: 0.9 }));
  coals.scale.y = 0.6;
  coals.position.set(0, 0.84, 0.24);
  g.add(coals);
  return { at: new THREE.Vector3(0, 0.96, 0.24), scale: 1.15, flame: 0xff9a4a, light: 0xff7432 };
}

const BIG = 1.4;
const KINDS = [null, lantern, skullLamp, oilLamp, fireBasket];

/** The act's wall light (an index into the acts, 1–4), or null for the first act's kit torch. */
export function sconce(act) {
  const make = KINDS[act % KINDS.length];
  if (!make) return null;
  const inner = new THREE.Group();
  const spec = make(inner);
  // A size up, about the flame, so it reads at the usual zoom without climbing over the wall.
  inner.scale.setScalar(BIG);
  inner.position.copy(spec.at).multiplyScalar(1 - BIG);
  const g = new THREE.Group();
  g.add(inner);
  inner.traverse((o) => { if (o.isMesh) o.castShadow = !o.material.transparent; });
  mergeMeshes(g); // a draw a material, not one a part (merge.js)
  return { holder: g, ...spec };
}
