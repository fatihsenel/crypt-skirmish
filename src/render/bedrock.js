// The ground under the room: rough rock falling away below its outer edge into the dark, with
// stones jutting from it, old foundation courses under the floor's lip, roots hanging down, and a
// slow cold mist far below; and rubble lodged down a chasm's sides (`shaftRubble`). Drawn only.
// Each border tile's stretch of cliff belongs to that tile's cell (Board.addToCell), so it stays
// black until the tile is seen and rises with the room; its shape comes from the tile's world
// position (fixed noise), so neighbouring stretches meet without a seam and every load looks the
// same.

import * as THREE from 'three';
import { stoneSide } from './stone.js';

export const DEPTH = 5; // how far the rock is drawn down before it's lost in the dark
const ROWS = 18;
const COLS = 6;
const TOP = -0.04; // just under the floor's edge

/** Fixed value noise in 2D, smooth, about 0..1. */
export function hash(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi) + (hash(xi + 1, yi) - hash(xi, yi)) * sx;
  const b = hash(xi, yi + 1) + (hash(xi + 1, yi + 1) - hash(xi, yi + 1)) * sx;
  return a + (b - a) * sy;
}

/** How far out the rock stands at `s` along its side (`side` 0-3) and `t` of the way down. */
function reach(side, s, t) {
  const big = noise(s * 0.7 + side * 31, t * 3.2);
  const fine = noise(s * 3.7 + side * 17, t * 11);
  // Undercut just below the lip here and there, then bulging out.
  const under = t < 0.3 ? -0.22 * noise(s * 0.5 + side * 3, 2) * Math.sin((Math.PI * t) / 0.3) : 0;
  // A ledge somewhere down, where the rock steps out sharply.
  const l0 = 0.22 + 0.45 * noise(s * 0.6 + side * 5, 9);
  const u = Math.min(1, Math.max(0, (t - l0) / 0.05));
  const ledge = 0.45 * noise(s * 0.8 + side * 11, 4) * u * u * (3 - 2 * u);
  return t ** 0.8 * (0.1 + 1.3 * big) + ledge + under + 0.1 * fine * Math.min(1, t * 6);
}
/** The rock's shade at `t` of the way down: a pale lip, then darker into black. */
function shade(side, s, t) {
  if (t < 0.025) return 1.05;
  const strata = 0.85 + 0.25 * noise(s * 1.6 + side * 7, t * 22);
  return Math.max(0, 1 - t * 1.15) ** 2.4 * strata; // gone into the dark before the bottom
}
/** The rock's colour there: its shade, darker and faintly green down damp streaks from the lip. */
function tint(side, s, t) {
  const k = shade(side, s, t);
  const wet = t < 0.025 ? 0 : Math.min(1, Math.max(0, noise(s * 4.3 + side * 19, 0.5 + t * 0.6) - 0.55) * 3.5);
  return [k * (1 - 0.55 * wet), k * (0.97 - 0.35 * wet), k * (0.94 - 0.5 * wet)];
}

let rockTex = null;
/** Rough rock: mottled grey-brown with darker seams and a few pale flecks, tiled. */
export function rockTexture() {
  if (rockTex) return rockTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#5d554d';
  g.fillRect(0, 0, 256, 256);
  let s = 11;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  // Blotches, drawn three times across the edges so the texture tiles.
  for (let i = 0; i < 260; i++) {
    const x = r() * 256;
    const y = r() * 256;
    const rad = 6 + r() * 26;
    const v = r() < 0.5 ? `rgba(30,24,20,${0.06 + r() * 0.12})` : `rgba(150,140,125,${0.04 + r() * 0.08})`;
    g.fillStyle = v;
    for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) {
      g.beginPath();
      g.ellipse(x + ox, y + oy, rad, rad * (0.4 + r() * 0.4), r() * 0.6 - 0.3, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Seams running roughly level, the way rock splits.
  g.strokeStyle = 'rgba(18,14,12,0.55)';
  for (let i = 0; i < 14; i++) {
    g.lineWidth = 1 + r() * 2.2;
    let y = r() * 256;
    g.beginPath();
    g.moveTo(-4, y);
    for (let x = 0; x <= 264; x += 16) {
      y += (r() - 0.5) * 10;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  for (let i = 0; i < 120; i++) {
    g.fillStyle = 'rgba(210,200,180,0.18)';
    g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1);
  }
  rockTex = new THREE.CanvasTexture(c);
  rockTex.wrapS = rockTex.wrapT = THREE.RepeatWrapping;
  rockTex.colorSpace = THREE.SRGBColorSpace;
  return rockTex;
}

/**
 * The cliff under one side of a border tile: `side` 0 north (−z), 1 east (+x), 2 south (+z),
 * 3 west (−x); `a` and `b` are where it runs from and to along that side, in world units.
 */
function cliffGeometry(width, height, side, a, b) {
  const out = [[0, -1], [1, 0], [0, 1], [-1, 0]][side];
  const edge = [-0.5, width - 0.5, height - 0.5, -0.5][side]; // the side's line, x or z
  const along = side % 2 === 0; // runs along x
  const pos = [];
  const col = [];
  const uv = [];
  for (let r = 0; r <= ROWS; r++) {
    const t = r / ROWS;
    for (let i = 0; i <= COLS; i++) {
      const s = a + ((b - a) * i) / COLS;
      const d = reach(side, s, t);
      const y = TOP - t * DEPTH;
      const x = along ? s : edge + out[0] * d;
      const z = along ? edge + out[1] * d : s;
      pos.push(x, y, z);
      col.push(...tint(side, s, t));
      uv.push(s * 0.5, y * 0.5);
    }
  }
  const index = [];
  for (let r = 0; r < ROWS; r++) {
    for (let i = 0; i < COLS; i++) {
      const p = r * (COLS + 1) + i;
      const q = p + COLS + 1;
      // Wound to face outward (away from the room).
      if (side === 0 || side === 3) index.push(p, p + 1, q, p + 1, q + 1, q);
      else index.push(p, q, p + 1, p + 1, q, q + 1);
    }
  }
  return finish(pos, col, uv, index);
}

/** A room corner: the rock between the ends of the two sides that meet there. */
function cornerGeometry(width, height, cx, cz) {
  const sideX = cz === 0 ? 0 : 2; // the side along x at this corner
  const sideZ = cx === 0 ? 3 : 1; // the side along z
  const sx = cx === 0 ? -0.5 : width - 0.5;
  const sz = cz === 0 ? -0.5 : height - 0.5;
  const ox = cx === 0 ? -1 : 1;
  const oz = cz === 0 ? -1 : 1;
  const pos = [];
  const col = [];
  const uv = [];
  for (let r = 0; r <= ROWS; r++) {
    const t = r / ROWS;
    const y = TOP - t * DEPTH;
    // The x side's end, the corner pushed out on both, and the z side's end.
    const dx = reach(sideX, sx, t);
    const dz = reach(sideZ, sz, t);
    const pts = [[sx, sz + oz * dx], [sx + ox * dz * 0.8, sz + oz * dx * 0.8], [sx + ox * dz, sz]];
    for (const [x, z] of pts) {
      pos.push(x, y, z);
      col.push(...tint(sideX, sx, t));
      uv.push((x + z) * 0.5, y * 0.5);
    }
  }
  const index = [];
  const flip = (ox * oz > 0);
  for (let r = 0; r < ROWS; r++) {
    for (let i = 0; i < 2; i++) {
      const p = r * 3 + i;
      const q = p + 3;
      if (flip) index.push(p, q, p + 1, p + 1, q, q + 1);
      else index.push(p, p + 1, q, p + 1, q + 1, q);
    }
  }
  return finish(pos, col, uv, index);
}

function finish(pos, col, uv, index) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

const STONE_GEO = new THREE.DodecahedronGeometry(0.34, 0);
// One course-high box a tile long (scaled to its height), its side textured as cut stone.
const FOOTING_GEO = new THREE.BoxGeometry(1, 1, 0.26);
let footingMat = null;
const footingMaterial = () => (footingMat ??= new THREE.MeshStandardMaterial({ map: stoneSide(), color: 0xb0a496, roughness: 0.95 }));
const ROOT_MAT = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 });

/** A stone of rock `k` bright (0 black, 1 lit), shaped and turned by the numbers `seed` gives. */
function rubble(size, k, seed) {
  const m = new THREE.Mesh(STONE_GEO, new THREE.MeshStandardMaterial({ map: rockTexture(), roughness: 1, color: new THREE.Color(0.78 * k, 0.74 * k, 0.7 * k) }));
  m.scale.set(size * (1 + hash(seed, 9) * 0.8), size * (0.45 + hash(seed, 4) * 0.4), size * (1 + hash(seed, 6) * 0.8));
  m.rotation.set(hash(seed, 1) * 0.6, hash(seed, 2) * Math.PI, hash(seed, 8) * 0.5);
  m.receiveShadow = true;
  m.raycast = () => {};
  return m;
}

/**
 * Stones lodged down a chasm's rock face at (x, z), the face toward (dx, dz) and `depth` deep,
 * darker the deeper they sit (board.js adds them with the shaft).
 */
export function shaftRubble(x, z, dx, dz, depth) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    const seed = x * 92821 + z * 6151 + dx * 37 + dz * 101 + i * 7;
    if (hash(seed, 21) > 0.6) continue;
    const t = 0.1 + hash(seed, 22) * 0.55;
    const along = (hash(seed, 23) - 0.5) * 0.8;
    const m = rubble(0.3 + hash(seed, 24) * 0.25, Math.max(0, 1 - t) ** 1.6, seed);
    m.position.set(x + dx * 0.42 + dz * along, -t * depth, z + dz * 0.42 + dx * along);
    out.push(m);
  }
  return out;
}

const MARGIN = 4; // tiles of mist beyond the room's edge
const PX = 24; // the mist's canvas pixels a tile

/**
 * Mist hugging the rock: soft puffs along the room's outline, a little way out from it, thinning
 * to nothing further off. `seed` makes each layer different.
 */
function skirtTexture(width, height, seed) {
  const px = Math.min(PX, Math.floor(1024 / (Math.max(width, height) + MARGIN * 2)));
  const c = document.createElement('canvas');
  c.width = (width + MARGIN * 2) * px;
  c.height = (height + MARGIN * 2) * px;
  const g = c.getContext('2d');
  let s = seed;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const perimeter = 2 * (width + height);
  for (let i = 0; i < perimeter * 3; i++) {
    // A point on the outline, pushed out by up to two tiles.
    let u = r() * perimeter;
    const out = 0.3 + r() ** 1.5 * 2.2;
    let x;
    let z;
    if (u < width) { x = u; z = -out; } else if ((u -= width) < height) { x = width + out; z = u; } else if ((u -= height) < width) { x = width - u; z = height + out; } else { x = -out; z = height - (u - width); }
    const cx = (x + MARGIN - 0.5) * px;
    const cy = (z + MARGIN - 0.5) * px;
    const rad = (0.6 + r() * 1.4) * px;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0, `rgba(255,255,255,${(0.1 + r() * 0.14) * (1 - out / 2.6)})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  return new THREE.CanvasTexture(c);
}

export class Bedrock {
  /** Builds the rock under `board`'s outer edge, each stretch in its border tile's cell. */
  constructor(board) {
    const { width, height } = board.grid;
    const rock = new THREE.MeshStandardMaterial({ map: rockTexture(), bumpMap: rockTexture(), bumpScale: 3, roughness: 1, vertexColors: true, side: THREE.DoubleSide });
    const add = (x, z, geo) => {
      const m = new THREE.Mesh(geo, rock);
      m.receiveShadow = true;
      m.raycast = () => {};
      board.group.add(m);
      board.addToCell(x, z, m);
    };
    const out = (side) => [[0, -1], [1, 0], [0, 1], [-1, 0]][side];
    const edge = (side) => [-0.5, width - 0.5, height - 0.5, -0.5][side];
    /** The point `d` out from the side at `s` along it, `y` high. */
    const at = (side, s, d, y) => (side % 2 === 0
      ? new THREE.Vector3(s, y, edge(side) + out(side)[1] * d)
      : new THREE.Vector3(edge(side) + out(side)[0] * d, y, s));
    const put = (x, z, m) => {
      board.group.add(m);
      board.addToCell(x, z, m);
    };
    // A stone jutting from the cliff now and then, darker the deeper it sits.
    const stone = (x, z, side, s) => {
      if (hash(s * 13 + side, 77) > 0.24) return;
      const t = 0.15 + hash(s * 5 + side, 3) * 0.45;
      const m = rubble(1, shade(side, s, t), s * 3 + side);
      m.position.copy(at(side, s, reach(side, s, t) + 0.12, TOP - t * DEPTH));
      put(x, z, m);
    };
    // Old foundations: courses of cut stone under the floor's lip, in runs of a few tiles.
    const footing = (x, z, side, s) => {
      if (noise(s * 0.45 + side * 13, 5.5) < 0.45) return;
      const tall = 0.5 + hash(s * 3 + side, 41) * 0.35;
      const m = new THREE.Mesh(FOOTING_GEO, footingMaterial());
      m.scale.set(1.02, tall, 1);
      m.position.copy(at(side, s, 0.12, TOP - tall / 2));
      m.rotation.y = side % 2 === 0 ? 0 : Math.PI / 2;
      m.receiveShadow = true;
      m.castShadow = true;
      m.raycast = () => {};
      put(x, z, m);
    };
    // Roots hanging from the lip, following the rock down a way.
    const roots = (x, z, side, s) => {
      const n = hash(s * 7 + side, 55) < 0.3 ? 1 + Math.floor(hash(s * 7 + side, 56) * 3) : 0;
      for (let i = 0; i < n; i++) {
        const seed = s * 7 + side * 3 + i * 11;
        const u = s + (hash(seed, 57) - 0.5) * 0.85;
        const long = 0.25 + hash(seed, 58) * 0.35; // the fraction of the depth it hangs
        const pts = [];
        for (let j = 0; j <= 5; j++) {
          const t = (j / 5) * long;
          const sway = (noise(seed + j * 0.7, 3) - 0.5) * 0.3;
          pts.push(at(side, u + sway, reach(side, u, t) + 0.03 + t * 0.15, TOP - t * DEPTH + 0.02));
        }
        const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.035 + hash(seed, 59) * 0.03, 5);
        const m = new THREE.Mesh(geo, ROOT_MAT);
        m.raycast = () => {};
        put(x, z, m);
      }
    };
    const dress = (x, z, side, s) => {
      stone(x, z, side, s);
      footing(x, z, side, s);
      roots(x, z, side, s);
    };
    for (let x = 0; x < width; x++) {
      add(x, 0, cliffGeometry(width, height, 0, x - 0.5, x + 0.5));
      add(x, height - 1, cliffGeometry(width, height, 2, x - 0.5, x + 0.5));
      dress(x, 0, 0, x);
      dress(x, height - 1, 2, x);
    }
    for (let z = 0; z < height; z++) {
      add(width - 1, z, cliffGeometry(width, height, 1, z - 0.5, z + 0.5));
      add(0, z, cliffGeometry(width, height, 3, z - 0.5, z + 0.5));
      dress(width - 1, z, 1, z);
      dress(0, z, 3, z);
    }
    for (const [cx, cz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      add(cx ? width - 1 : 0, cz ? height - 1 : 0, cornerGeometry(width, height, cx, cz));
    }

    // Cold mist clinging round the rock, two layers drifting against each other.
    this.mists = [];
    for (const [i, y] of [[0, -DEPTH * 0.5], [1, -DEPTH * 0.7]]) {
      const geo = new THREE.PlaneGeometry(width + MARGIN * 2, height + MARGIN * 2).rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: skirtTexture(width, height, 5 + i * 17), color: 0x9aa8c8, transparent: true, opacity: i ? 0.26 : 0.22, depthWrite: false, fog: false,
      }));
      m.position.set((width - 1) / 2, y, (height - 1) / 2);
      m.raycast = () => {};
      board.group.add(m);
      this.mists.push({ m, y, x: m.position.x, z: m.position.z, opacity: m.material.opacity });
    }
  }

  /** The mists drift and breathe (not under reduced motion). */
  tick(t, still) {
    if (still) return;
    this.mists.forEach((w, i) => {
      const k = i ? -1 : 1;
      w.m.position.x = w.x + Math.sin(t * 0.11 + i) * 0.35 * k;
      w.m.position.z = w.z + Math.cos(t * 0.09 + i * 2) * 0.35 * k;
      w.m.position.y = w.y + Math.sin(t * 0.2 + i) * 0.08;
      w.m.material.opacity = w.opacity * (0.85 + 0.15 * Math.sin(t * 0.3 + i * 1.7));
    });
  }
}
