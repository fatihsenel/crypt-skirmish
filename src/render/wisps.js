// Smoke where the explored map meets the dark never seen: a low, cold haze curling over the
// edge of the known, drifting slowly. Dim blue-grey and flat, never Fog Cloud's pale puffs.
// Each wisp lies between a seen tile (floor or wall) and an unseen one beside it (anything, or
// off the map), so it rings the explored part evenly and tells nothing of what lies past it.
// Its opacity follows both tiles' fog: it fades in as a tile comes into view and out as the
// dark beyond is revealed. One instanced mesh for the board; reduced motion keeps it still.

import * as THREE from 'three';
import { key } from '../game/grid.js';
import { calm } from './tween.js';

const MAX = 900;
const PER_EDGE = 3;
const ALPHA = 0.85;
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

let smokeMap = null;
/** A soft, lumpy cloud. */
function smoke() {
  if (smokeMap) return smokeMap;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  let s = 4242;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * 26;
    const x = 64 + Math.cos(a) * d;
    const y = 64 + Math.sin(a) * d;
    const rad = 18 + r() * 20;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(255,255,255,0.4)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  smokeMap = new THREE.CanvasTexture(c);
  return smokeMap;
}

export class Wisps {
  /** `board` gives the grid, its fog cells and the group to draw into. */
  constructor(board, liftAt) {
    this.board = board;
    this.liftAt = liftAt;
    this.dirty = true;
    this.list = []; // { a, b, x, y, z, dx, dz, ph, spin, size, alpha, base }
    this.lowerAdded = false;
    const material = new THREE.MeshBasicMaterial({ color: 0x2c3344, map: smoke(), transparent: true, depthWrite: false });
    // An instance's colour (its red) is its opacity: the smoke itself is always the same dark.
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )\n  diffuseColor.a *= vColor.r;\n#endif');
    };
    material.customProgramCacheKey = () => 'wisps';
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material, MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -0.5; // under the highlights
    board.group.add(this.mesh);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.p = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
  }

  /** The edges where seen floor meets the unseen dark now (as the fog is heading). */
  edges() {
    const { grid, cells, explored } = this.board;
    const out = new Map();
    for (const [k, cell] of cells) {
      if (cell.target <= 0) continue;
      const [x, z] = k.split(',').map(Number);
      const wall = grid.isWall(x, z);
      for (const [dx, dz] of DIRS4) {
        const nx = x + dx;
        const nz = z + dz;
        const nk = key(nx, nz);
        if (explored.has(nk)) continue;
        out.set(`${k}>${nk}`, { a: cell, b: cells.get(nk), x, z, dx, dz, wall });
      }
    }
    return out;
  }

  /**
   * A room on two floors: haze lying over the lower hall (every other tile), the same cold
   * smoke, fainter. It stays for the fight and follows its tiles' fog.
   */
  addLower() {
    this.lowerAdded = true;
    const { grid, cells } = this.board;
    for (const k of grid.lower ?? []) {
      const [x, z] = k.split(',').map(Number);
      const cell = cells.get(k);
      if (!cell || (x + z) % 2 || grid.links.has(k)) continue;
      this.list.push({
        edge: `lower:${k}`, a: cell, b: null, gone: false, fixed: true, base: 0.6,
        x: x + (Math.random() - 0.5) * 0.4, z: z + (Math.random() - 0.5) * 0.4, y: 0.09 + Math.random() * 0.05,
        dx: Math.random() < 0.5 ? 1 : 0, dz: 0, ph: Math.random() * 6.3, spin: (Math.random() - 0.5) * 0.2,
        size: 2 + Math.random() * 0.8, alpha: 0,
      });
    }
  }

  rebuild() {
    this.dirty = false;
    if (!this.lowerAdded) this.addLower();
    const now = this.edges();
    const kept = [];
    const have = new Set();
    for (const w of this.list) {
      if (w.fixed) {
        kept.push(w);
        continue;
      }
      // A wisp whose edge is gone stays until it has faded (its dark tile coming into view).
      w.gone = !now.has(w.edge);
      have.add(w.edge);
      kept.push(w);
    }
    for (const [edge, e] of now) {
      if (have.has(edge)) continue;
      for (let i = 0; i < PER_EDGE; i++) {
        const along = (Math.random() - 0.5) * 1.1;
        kept.push({
          edge, a: e.a, b: e.b, gone: false,
          // Past a wall's outer face, else over the edge of the floor.
          x: e.x + e.dx * (e.wall ? 1.05 : 0.42) + (e.dz ? along : 0), z: e.z + e.dz * (e.wall ? 1.05 : 0.42) + (e.dx ? along : 0),
          y: (e.wall ? 0 : this.liftAt(e.x, e.z)) + 0.05 + Math.random() * 0.06,
          dx: e.dx, dz: e.dz, ph: Math.random() * 6.3, spin: (Math.random() - 0.5) * 0.3,
          size: 1.4 + Math.random() * 0.7, alpha: 0,
        });
      }
    }
    this.list = kept.slice(-MAX);
  }

  tick(t) {
    if (this.dirty) this.rebuild();
    const still = calm();
    let n = 0;
    this.list = this.list.filter((w) => {
      const dark = w.b ? w.b.f : 0; // the unseen side (no cell: off the drawn map)
      const want = (w.base ?? ALPHA) * w.a.f * (1 - dark);
      w.alpha = want;
      if (w.gone && want < 0.01) return false;
      if (want < 0.005) return true;
      const k = still ? 0 : 1;
      const breathe = Math.sin(t * 0.5 + w.ph);
      // Curling out of the dark and back: along the edge's normal, and a little along it.
      this.p.set(
        w.x + (w.dx * breathe * 0.12 + Math.sin(t * 0.23 + w.ph) * 0.1 * (1 - Math.abs(w.dx))) * k,
        w.y,
        w.z + (w.dz * breathe * 0.12 + Math.sin(t * 0.23 + w.ph) * 0.1 * (1 - Math.abs(w.dz))) * k,
      );
      this.q.setFromAxisAngle(this.up, w.ph + t * w.spin * k);
      this.s.setScalar(w.size * (1 + breathe * 0.08 * k));
      this.mesh.setMatrixAt(n, this.m.compose(this.p, this.q, this.s));
      this.mesh.instanceColor.setXYZ(n, want * (0.85 + 0.15 * Math.sin(t * 0.7 + w.ph * 2) * k), 0, 0);
      n++;
      return true;
    });
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
