// Moths round the wall lights and steam off the water, drawn only. A torch keeps two or three
// moths circling its flame in loose, wandering loops, their wings beating; water breathes thin
// curls of vapour that rise, lean and fade. Each belongs to its tile's fog (`level()`), so a
// room not yet seen gives nothing away. Reduced motion hides both.

import * as THREE from 'three';
import { key } from '../game/grid.js';
import { calm } from './tween.js';

const WINGS = (() => {
  // Both wings as one shape, spread flat from the body's line (x = 0); they beat by folding
  // across it (the mesh's x scale), so a moth is a single draw.
  const s = new THREE.Shape();
  s.moveTo(0, -0.012);
  s.quadraticCurveTo(0.05, -0.03, 0.055, 0.01);
  s.quadraticCurveTo(0.04, 0.035, 0, 0.012);
  s.quadraticCurveTo(-0.04, 0.035, -0.055, 0.01);
  s.quadraticCurveTo(-0.05, -0.03, 0, -0.012);
  return new THREE.ShapeGeometry(s, 4).rotateX(-Math.PI / 2);
})();

let puffMap = null;
/** A soft, uneven curl of vapour. */
function puff() {
  if (puffMap) return puffMap;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < 6; i++) {
    const x = 20 + Math.random() * 24;
    const y = 20 + Math.random() * 24;
    const r = 10 + Math.random() * 12;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  puffMap = new THREE.CanvasTexture(c);
  return puffMap;
}

function hash(x, z, salt) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(salt | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Moths {
  /** `torches`: the board's ({ flame, cell }); `liftAt(x, z)`: the floor's height there. */
  constructor(board, torches, liftAt) {
    this.group = new THREE.Group();
    board.group.add(this.group);
    this.moths = [];
    for (const [n, t] of torches.entries()) {
      const count = 2 + (n % 2);
      for (let i = 0; i < count; i++) {
        const g = new THREE.Mesh(WINGS, new THREE.MeshBasicMaterial({ color: 0xcfc2a2, side: THREE.DoubleSide, transparent: true }));
        g.raycast = () => {};
        this.group.add(g);
        this.moths.push({ g, mat: g.material, t, ph: Math.random() * 20, r: 0.16 + Math.random() * 0.14, speed: 1.6 + Math.random() * 1.2, dir: Math.random() < 0.5 ? 1 : -1 });
      }
    }
    // Vapour over the water: a few tiles of each pool, three curls apiece.
    this.curls = [];
    const grid = board.grid;
    const wet = [...(grid.water ?? [])].filter((k) => { const [x, z] = k.split(',').map(Number); return hash(x, z, 61) < 0.45; }).slice(0, 10);
    for (const k of wet) {
      const [x, z] = k.split(',').map(Number);
      const cell = board.cells.get(key(x, z));
      for (let i = 0; i < 2; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff(), color: 0xc8d4e0, transparent: true, opacity: 0, depthWrite: false }));
        s.raycast = () => {};
        this.group.add(s);
        this.curls.push({ s, x: x + (hash(x, z, 62 + i) - 0.5) * 0.7, z: z + (hash(x, z, 72 + i) - 0.5) * 0.7, y: liftAt(x, z) + 0.06, cell, ph: hash(x, z, 82 + i), life: 4 + hash(x, z, 92 + i) * 3 });
      }
    }
  }

  tick(t) {
    const still = calm();
    this.group.visible = !still;
    if (still) return;
    for (const m of this.moths) {
      const f = m.t.cell.f;
      m.g.visible = f > 0.05;
      if (!m.g.visible) continue;
      // A loop round the flame that wanders in and out, dipping and darting.
      const a = m.dir * t * m.speed + m.ph;
      const r = m.r * (0.75 + 0.35 * Math.sin(t * 1.7 + m.ph * 3));
      const c = m.t.flame.position;
      const x = c.x + Math.cos(a) * r + Math.sin(t * 5.1 + m.ph) * 0.02;
      const z = c.z + Math.sin(a) * r + Math.cos(t * 4.3 + m.ph) * 0.02;
      const y = c.y + 0.04 + Math.sin(t * 2.3 + m.ph) * 0.09 + Math.sin(t * 7 + m.ph) * 0.015;
      m.g.position.set(x, y, z);
      m.g.rotation.set(0, Math.atan2(-Math.sin(a) * m.dir, Math.cos(a) * m.dir), 0);
      m.g.rotation.z = Math.sin(t * 3 + m.ph) * 0.4; // banking as it turns
      m.g.scale.x = 0.2 + 0.8 * Math.abs(Math.sin(t * 19 + m.ph * 5)); // wings beating
      m.mat.opacity = f; // pale in the flame's light, lost in the dark
    }
    for (const c of this.curls) {
      const f = c.cell?.f ?? 0;
      const k = ((t / c.life) + c.ph) % 1;
      c.s.position.set(c.x + Math.sin(t * 0.4 + c.ph * 6) * 0.1 + k * 0.15, c.y + k * 0.7, c.z + k * 0.08);
      c.s.scale.setScalar(0.35 + k * 0.6);
      c.s.material.opacity = 0.32 * Math.sin(Math.PI * k) * f;
      c.s.material.rotation = c.ph * 6 + k * 0.6;
    }
  }
}
