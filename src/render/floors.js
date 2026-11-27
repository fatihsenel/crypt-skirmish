// Floors that react, drawn only: damp stone beside shallow water, frost that creeps out over and
// around Ice Storm's ground (and melts back), and glowing seams in the flagstones under burning
// coals. Blood drying over the rounds is marks.js (`age`).

import * as THREE from 'three';
import { key } from '../game/grid.js';
import { tween, calm, keepAwake } from './tween.js';

const GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const tex = {};

function canvasTex(w, draw, { srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = w;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const rng = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

/** A dark damp patch, heavier on the side the water lies (the texture's -z edge). */
function dampTex() {
  return tex.damp ??= canvasTex(128, (g) => {
    const r = rng(41);
    for (let i = 0; i < 26; i++) {
      const x = r() * 128;
      const y = r() * 52; // near the water's edge
      const rad = 14 + r() * 26;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, 'rgba(10,12,14,0.5)');
      grad.addColorStop(1, 'rgba(10,12,14,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
    }
  });
}

/** Frost: fine branching crystals over a pale haze. */
function frostTex() {
  return tex.frost ??= canvasTex(128, (g) => {
    const r = rng(77);
    const grad = g.createRadialGradient(64, 64, 10, 64, 64, 64);
    grad.addColorStop(0, 'rgba(225,240,255,0.42)');
    grad.addColorStop(1, 'rgba(225,240,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(240,250,255,0.75)';
    g.lineWidth = 1;
    const branch = (x, y, a, len, depth) => {
      if (depth > 3 || len < 3) return;
      const x2 = x + Math.cos(a) * len;
      const y2 = y + Math.sin(a) * len;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x2, y2);
      g.stroke();
      branch(x2, y2, a + 0.7, len * 0.55, depth + 1);
      branch(x2, y2, a - 0.7, len * 0.55, depth + 1);
    };
    for (let i = 0; i < 16; i++) branch(20 + r() * 88, 20 + r() * 88, r() * Math.PI * 2, 8 + r() * 14, 0);
  });
}

/** Seams of fire: jagged bright lines where the flagstones meet, glowing through the coals. */
function seamTex() {
  return tex.seam ??= canvasTex(128, (g) => {
    const r = rng(19);
    g.strokeStyle = 'rgba(255,150,50,1)';
    g.shadowColor = 'rgba(255,90,20,1)';
    g.shadowBlur = 6;
    g.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      let x = r() * 128;
      let y = r() * 128;
      g.beginPath();
      g.moveTo(x, y);
      for (let n = 0; n < 6; n++) {
        x += (r() - 0.5) * 36;
        y += (r() - 0.5) * 36;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}

export class Floors {
  /** `board` gives the grid, the group to draw into and its fog cells; `liftAt` the floor's height. */
  constructor(board, liftAt) {
    this.board = board;
    this.liftAt = liftAt;
    this.frost = new Map(); // tile key -> mesh
    this.seams = new Map(); // tile key -> mesh
    const g = board.grid;
    // Damp stone: every dry floor tile beside the water, darkened toward it.
    for (const k of g.water) {
      const [wx, wz] = k.split(',').map(Number);
      for (const [dx, dz] of DIRS) {
        const x = wx + dx;
        const z = wz + dz;
        if (!this.floor(x, z)) continue;
        const mesh = new THREE.Mesh(GEO, new THREE.MeshStandardMaterial({
          map: dampTex(), transparent: true, depthWrite: false, roughness: 0.35, metalness: 0.05,
          polygonOffset: true, polygonOffsetFactor: -1,
        }));
        mesh.position.set(x, this.liftAt(x, z) + 0.0082, z);
        mesh.rotation.y = Math.atan2(dx, dz); // the texture's wet edge toward the water
        mesh.renderOrder = -1;
        mesh.raycast = () => {};
        board.group.add(mesh);
        board.addToCell(x, z, mesh);
      }
    }
  }

  floor(x, z) {
    const g = this.board.grid;
    const k = key(x, z);
    return g.inBounds(x, z) && !g.isWall(x, z) && !g.water.has(k) && !g.chasms.has(k) && !g.links.has(k);
  }

  /** A decal on (x, z) of `map`, `opts` for its material, registered with the tile's fog. */
  decal(x, z, map, opts, y = 0.0112) {
    const mesh = new THREE.Mesh(GEO, new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, ...opts }));
    mesh.position.set(x, this.liftAt(x, z) + y, z);
    mesh.rotation.y = ((x * 7 + z * 13) % 4) * (Math.PI / 2);
    mesh.raycast = () => {};
    this.board.group.add(mesh);
    this.board.addToCell(x, z, mesh);
    return mesh;
  }

  drop(map, k) {
    const mesh = map.get(k);
    if (!mesh) return;
    map.delete(k);
    const cell = this.board.cells.get(k);
    if (cell) {
      cell.objects = cell.objects.filter((o) => o !== mesh);
      cell.mats = cell.mats.filter(({ m }) => m !== mesh.material);
    }
    this.board.group.remove(mesh);
    mesh.material.dispose();
  }

  /** Frost over the icy tiles and a thinner rim around them; it grows in and melts away. */
  setFrost(keys) {
    const want = new Map();
    for (const k of keys) want.set(k, 1);
    for (const k of keys) {
      const [x, z] = k.split(',').map(Number);
      for (const [dx, dz] of DIRS) {
        const nk = key(x + dx, z + dz);
        if (!want.has(nk) && this.floor(x + dx, z + dz)) want.set(nk, 0.45);
      }
    }
    for (const k of [...this.frost.keys()]) {
      if (want.has(k)) continue;
      const mesh = this.frost.get(k);
      if (calm()) this.drop(this.frost, k);
      else {
        keepAwake(1300);
        tween(1200, (p) => mesh.scale.setScalar(Math.max(0.01, 1 - p))).then(() => this.drop(this.frost, k));
      }
    }
    for (const [k, strength] of want) {
      if (this.frost.has(k)) continue;
      const [x, z] = k.split(',').map(Number);
      if (!this.floor(x, z)) continue;
      const mesh = this.decal(x, z, frostTex(), { opacity: strength, blending: THREE.NormalBlending });
      this.frost.set(k, mesh);
      if (!calm()) {
        mesh.scale.setScalar(0.01);
        keepAwake(1000);
        tween(900, (p) => mesh.scale.setScalar(Math.max(0.01, p)));
      }
    }
    this.board.fogDirty = true;
  }

  /** Glowing seams through the coals' tiles (`keys`) and fainter in the flags round them; gone with the fire. */
  setSeams(keys) {
    const want = new Map();
    for (const k of keys) want.set(k, 1);
    for (const k of keys) {
      const [x, z] = k.split(',').map(Number);
      for (const [dx, dz] of DIRS) {
        const nk = key(x + dx, z + dz);
        if (!want.has(nk)) want.set(nk, 0.55);
      }
    }
    for (const k of [...this.seams.keys()]) if (!want.has(k)) this.drop(this.seams, k);
    for (const [k, strength] of want) {
      if (this.seams.has(k)) continue;
      const [x, z] = k.split(',').map(Number);
      if (!this.floor(x, z)) continue;
      const mesh = this.decal(x, z, seamTex(), { blending: THREE.AdditiveBlending, opacity: 0, color: 0xffe2a0 }, 0.0115);
      mesh.userData.strength = strength;
      this.seams.set(k, mesh);
    }
    this.board.fogDirty = true;
  }

  /** The seams pulse with the coals. */
  tick(t) {
    if (!this.seams.size) return;
    const pulse = calm() ? 1 : 0.75 + 0.2 * Math.sin(t * 5) + 0.05 * Math.sin(t * 13);
    for (const [k, mesh] of this.seams) mesh.material.opacity = mesh.userData.strength * pulse * (this.board.cells.get(k)?.f ?? 0);
  }
}
