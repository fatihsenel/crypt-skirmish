// Marks a fight leaves on the floor: soot where fire burst, a charred star where lightning
// struck, and what a slain monster leaves (blood, bone dust, an ooze's puddle). Drawn only:
// the rules never see them, a restored fight starts clean, and they look nothing like the
// rules' own ground (coals glow, ice is striped, grease is slick yellow).
// One mark a tile (a new one replaces the old), at most MAX in all.

import * as THREE from 'three';
import { key } from '../game/grid.js';

const MAX = 80;
const GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const VARIANTS = 3;

// How each kind is drawn: its colour, how big, how blotchy, and whether it catches the light.
const KINDS = {
  scorch: { color: [14, 10, 8], alpha: 0.8, blobs: 10, radius: 0.26, size: 1.1, lit: false, rim: [70, 38, 18] },
  char: { color: [10, 12, 22], alpha: 0.85, blobs: 3, radius: 0.15, size: 1.0, lit: false, rays: 18 },
  blood: { color: [100, 8, 10], alpha: 0.9, blobs: 7, radius: 0.17, size: 1.0, lit: true, drops: 14 },
  bone: { color: [214, 206, 184], alpha: 0.75, blobs: 6, radius: 0.13, size: 0.95, lit: false, grit: true },
  ooze: { color: [86, 160, 40], alpha: 0.8, blobs: 7, radius: 0.2, size: 1.0, lit: true, drops: 8 },
};

const textures = new Map(); // `${kind}:${i}` -> CanvasTexture

/** A soft blotch for `kind` on a 128 px canvas, variant `i` (each kind keeps a few). */
function texture(kind, i) {
  const k = `${kind}:${i}`;
  if (textures.has(k)) return textures.get(k);
  const spec = KINDS[kind];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  let s = 97 + i * 131 + kind.length * 17;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const [cr, cg, cb] = spec.color;
  const blob = (x, y, rad, a) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`);
    grad.addColorStop(0.6, `rgba(${cr},${cg},${cb},${a * 0.7})`);
    grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  };
  const rad = 128 * spec.radius;
  const reach = 60 - rad * 0.8; // every blob stays inside the canvas, so no edge is cut square
  if (spec.rim) {
    // Scorch: a brown singe around the soot.
    const [rr, rg, rb] = spec.rim;
    const grad = g.createRadialGradient(64, 64, rad * 0.8, 64, 64, 60);
    grad.addColorStop(0, `rgba(${rr},${rg},${rb},0.45)`);
    grad.addColorStop(1, `rgba(${rr},${rg},${rb},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  blob(64, 64, rad, 0.95);
  for (let n = 0; n < spec.blobs; n++) {
    const a = r() * Math.PI * 2;
    const d = r() * reach * 0.6;
    blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, rad * (0.4 + r() * 0.4), 0.55 + r() * 0.4);
  }
  for (let n = 0; n < (spec.drops ?? 0); n++) {
    // Splashes flung out from the pool.
    const a = r() * Math.PI * 2;
    const d = rad + r() * (reach - rad + 8);
    blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 2 + r() * 4, 0.9);
  }
  if (spec.rays) {
    // A lightning strike's scorched starburst: many thin, tapering streaks from a black core.
    g.lineCap = 'round';
    for (let n = 0; n < spec.rays; n++) {
      const a = (n / spec.rays) * Math.PI * 2 + (r() - 0.5) * 0.35;
      const len = 22 + r() * 32;
      for (let w = 3.5; w > 0.5; w -= 1) {
        const l = len * (1.1 - w / 4); // thinner strokes reach further: a taper
        g.strokeStyle = `rgba(${cr},${cg},${cb},${0.35 + 0.15 * w})`;
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(64, 64);
        g.lineTo(64 + Math.cos(a) * l, 64 + Math.sin(a) * l);
        g.stroke();
      }
    }
  }
  if (spec.grit) {
    for (let n = 0; n < 60; n++) {
      const a = r() * Math.PI * 2;
      const d = r() * 46;
      g.fillStyle = `rgba(${cr},${cg},${cb},${0.4 + r() * 0.5})`;
      g.fillRect(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 1 + r() * 2.5, 1 + r() * 2.5);
    }
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  textures.set(k, map);
  return map;
}

function material(kind, i) {
  const spec = KINDS[kind];
  const opts = {
    map: texture(kind, i), transparent: true, opacity: spec.alpha, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2,
  };
  // The board clones this per tile (for the fog), so it isn't shared or cached here.
  return spec.lit ? new THREE.MeshStandardMaterial({ ...opts, roughness: 0.25, metalness: 0.1 }) : new THREE.MeshBasicMaterial(opts);
}

export class Marks {
  /** `board` gives the grid, the group to draw into and its fog cells (`addToCell`). */
  constructor(board, liftAt) {
    this.board = board;
    this.liftAt = liftAt;
    this.byTile = new Map(); // tile key -> mesh, oldest first
  }

  /** Whether (x, z) is plain floor a mark can lie on. */
  canMark(x, z) {
    const g = this.board.grid;
    const k = key(x, z);
    return g.inBounds(x, z) && !g.isWall(x, z) && !g.chasms.has(k) && !g.water.has(k) && !g.links.has(k)
      && !g.stairs.some((s) => s.x === x && s.z === z) && !this.board.cracks?.has(k);
  }

  /**
   * Leaves a `kind` mark on each tile in `tiles` ({x, z}); `chance` skips some for a ragged
   * edge, `scale` shrinks a small one (a single bolt).
   */
  add(kind, tiles, { chance = 1, scale = 1 } = {}) {
    if (!KINDS[kind]) return;
    for (const t of tiles) {
      const x = Math.round(t.x);
      const z = Math.round(t.z);
      if (!this.canMark(x, z) || Math.random() > chance) continue;
      this.remove(key(x, z));
      const mesh = new THREE.Mesh(GEO, material(kind, Math.floor(Math.random() * VARIANTS)));
      const size = scale * KINDS[kind].size * (0.85 + Math.random() * 0.3);
      mesh.scale.set(size, 1, size);
      mesh.rotation.y = Math.random() * Math.PI * 2;
      mesh.position.set(x + (Math.random() - 0.5) * 0.15, this.liftAt(x, z) + 0.0085, z + (Math.random() - 0.5) * 0.15);
      mesh.renderOrder = -1;
      mesh.userData.kind = kind; // footprints read it (tracks.js)
      this.board.group.add(mesh);
      this.board.addToCell(x, z, mesh);
      this.byTile.set(key(x, z), mesh);
      if (this.byTile.size > MAX) this.remove(this.byTile.keys().next().value);
    }
    this.board.fogDirty = true; // the new marks take their tile's fog
  }

  /** A round passes: blood soaks in and dries, darker, browner and duller over four rounds. */
  age() {
    for (const [k, mesh] of this.byTile) {
      if (mesh.userData.kind !== 'blood') continue;
      const a = Math.min(1, (mesh.userData.age = (mesh.userData.age ?? 0) + 1) / 4);
      const m = mesh.material;
      m.roughness = 0.25 + a * 0.65;
      m.opacity = KINDS.blood.alpha * (1 - a * 0.22);
      const entry = this.board.cells.get(k)?.mats.find((e) => e.m === m);
      if (entry) entry.base.setRGB(1 - a * 0.42, 1 - a * 0.55, 1 - a * 0.5); // the fog tints from this
      else m.color.setRGB(1 - a * 0.42, 1 - a * 0.55, 1 - a * 0.5);
      const cell = this.board.cells.get(k);
      if (cell) cell.applied = null;
    }
    this.board.fogDirty = true;
  }

  remove(k) {
    const mesh = this.byTile.get(k);
    if (!mesh) return;
    this.byTile.delete(k);
    this.board.group.remove(mesh);
    const cell = this.board.cells.get(k);
    if (cell) {
      cell.objects = cell.objects.filter((o) => o !== mesh);
      cell.mats = cell.mats.filter(({ m }) => m !== mesh.material);
    }
    mesh.material.dispose();
  }

  dispose() {
    for (const k of [...this.byTile.keys()]) this.remove(k);
  }
}

/** What a slain monster leaves: bone dust for the undead, a puddle for oozes, else blood. */
export function remainsOf(unit) {
  if (unit.code === 'j' || unit.code === 'i') return 'ooze';
  return unit.undead ? 'bone' : 'blood';
}
