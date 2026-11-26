// Embers rising from torches and braziers, and dust drifting in their light: two point clouds
// for the whole board, updated on the frames the stage draws anyway (no keepAwake, so they
// drift at the idle rate when nothing else moves). Each source's `level()` (its tile's fog,
// whether it still burns) fades its motes, so a room not yet seen gives nothing away.
// Reduced motion hides them.

import * as THREE from 'three';
import { calm } from './tween.js';

let dotMap = null;
/** A soft round dot (points are square otherwise). */
function dot() {
  if (dotMap) return dotMap;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  dotMap = new THREE.CanvasTexture(c);
  return dotMap;
}

function cloud(n, size) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    size, map: dot(), vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: false,
  }));
  points.frustumCulled = false; // the positions move every frame
  return points;
}

const EMBER = [1, 0.5, 0.16];
const DUST = [1, 0.84, 0.6];
const rand = (a, b) => a + Math.random() * (b - a);

export class Motes {
  constructor(parent) {
    this.parent = parent;
    this.sources = [];
    this.dirty = false;
    this.embers = null;
    this.dust = null;
  }

  /**
   * A fire at `pos` (a Vector3, read every frame). `level()` is 0..1; `embers` and `dust`
   * are how many of each it keeps.
   */
  add(pos, level, { embers = 5, dust = 7, spread = 1.1 } = {}) {
    this.sources.push({ pos, level, embers, dust, spread });
    this.dirty = true;
  }

  build() {
    this.dirty = false;
    for (const p of [this.embers, this.dust]) {
      if (!p) continue;
      this.parent.remove(p);
      p.geometry.dispose();
      p.material.dispose();
    }
    this.e = [];
    this.d = [];
    for (const s of this.sources) {
      for (let i = 0; i < s.embers; i++) this.e.push(this.ember(s, rand(-1.5, 0)));
      for (let i = 0; i < s.dust; i++) {
        const a = rand(0, Math.PI * 2);
        const r = Math.sqrt(Math.random()) * s.spread;
        this.d.push({ s, ox: Math.cos(a) * r, oz: Math.sin(a) * r, oy: rand(-0.55, 0.15), ph: rand(0, 6.3), r });
      }
    }
    this.embers = cloud(this.e.length, 3.2);
    this.dust = cloud(this.d.length, 2.6);
    this.parent.add(this.embers, this.dust);
  }

  /** A new ember for source `s`; `age` below 0 delays it (they don't all start together). */
  ember(s, age = 0) {
    return { s, age, life: rand(0.9, 1.7), ox: rand(-0.04, 0.04), oz: rand(-0.04, 0.04), up: rand(0.35, 0.6), ph: rand(0, 6.3) };
  }

  tick(t, dt) {
    if (this.dirty) this.build();
    if (!this.embers) return;
    const still = calm();
    this.embers.visible = this.dust.visible = !still;
    if (still) return;
    dt = Math.min(dt, 0.1);

    const ep = this.embers.geometry.attributes.position;
    const ec = this.embers.geometry.attributes.color;
    this.e.forEach((m, i) => {
      m.age += dt;
      if (m.age > m.life) Object.assign(m, this.ember(m.s));
      const k = Math.max(0, m.age) / m.life;
      const { x, y, z } = m.s.pos;
      const sway = Math.sin(t * 3 + m.ph) * 0.06 * k;
      ep.setXYZ(i, x + m.ox + sway, y + m.up * Math.max(0, m.age), z + m.oz + sway * 0.6);
      const a = m.age < 0 ? 0 : Math.sin(Math.PI * k) * m.s.level();
      ec.setXYZ(i, EMBER[0] * a, EMBER[1] * a, EMBER[2] * a);
    });
    ep.needsUpdate = ec.needsUpdate = true;

    const dp = this.dust.geometry.attributes.position;
    const dc = this.dust.geometry.attributes.color;
    this.d.forEach((m, i) => {
      const { x, y, z } = m.s.pos;
      const w = t * 0.25 + m.ph;
      dp.setXYZ(i, x + m.ox + Math.sin(w) * 0.12, y + m.oy + Math.sin(w * 1.3) * 0.08, z + m.oz + Math.cos(w * 0.8) * 0.12);
      const a = 0.55 * (0.6 + 0.4 * Math.sin(t * 0.9 + m.ph)) * (1 - m.r / (m.s.spread * 1.1)) * m.s.level();
      dc.setXYZ(i, DUST[0] * a, DUST[1] * a, DUST[2] * a);
    });
    dp.needsUpdate = dc.needsUpdate = true;
  }

  dispose() {
    for (const p of [this.embers, this.dust]) {
      p?.geometry.dispose();
      p?.material.dispose();
    }
  }
}
