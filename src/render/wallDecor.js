// What the crypt's walls carry, drawn only: cracks, a few bricks fallen out, an alcove with a
// skull, a candle or an urn in it, moss low down (most of all by water) and chains with rings.
// Each piece hangs on the face of a wall tile toward the floor beside it, along a straight run
// of wall, away from the torches and banners, and belongs to that wall's cell (Board.addToCell),
// so it is dark until seen, rises with the room and goes with the wall. It fades with the wall
// when the wall stands in front of someone (Board.wallDecor, read by tickFade). Never on a
// secret door (main.js passes them in), so it gives none away. Placement is fixed by the tile,
// so a room always looks the same.

import * as THREE from 'three';
import { mergeMeshes } from './merge.js';
import { key } from '../game/grid.js';

const FACE = 0.255; // the kit wall's face, out from the tile's middle
const HEIGHT = 1.0; // the kit wall's height (KIT_WALL in board.js)
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function hash(x, z, salt) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(salt | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function rng(seed) {
  let s = seed % 2147483647 || 1;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

const maps = new Map();
/** A decal drawn once per kind and variant on a 128² canvas by `draw(g, r)`. */
function decal(kind, v, draw) {
  const k = `${kind}:${v}`;
  if (!maps.has(k)) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    draw(c.getContext('2d'), rng(17 + v * 131 + kind.length * 977));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    maps.set(k, t);
  }
  return maps.get(k);
}

/** A crack: a jagged line, splitting now and then. */
function crackLine(g, x, y, a, len, w, r) {
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(x, y);
  for (let s = 0; s < len; s += 8) {
    a += (r() - 0.5) * 0.9;
    x += Math.cos(a) * 8;
    y += Math.sin(a) * 8;
    g.lineTo(x, y);
    if (w > 1.3 && r() < 0.15) {
      g.stroke();
      crackLine(g, x, y, a + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.6), (len - s) * 0.5, w * 0.6, r);
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x, y);
    }
  }
  g.stroke();
}

const cracks = (v) => decal('crack', v, (g, r) => {
  g.strokeStyle = 'rgba(14,10,8,0.9)';
  g.lineCap = 'round';
  for (let i = 0; i < 2; i++) crackLine(g, 30 + r() * 68, 6 + r() * 30, Math.PI / 2 + (r() - 0.5) * 0.8, 80 + r() * 50, 4, r);
});

const moss = (v) => decal('moss', v, (g, r) => {
  for (let i = 0; i < 90; i++) {
    const x = r() * 128;
    const y = 128 - r() ** 1.8 * 90; // thickest at the foot
    const rad = 3 + r() * 9;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    const gr = 70 + r() * 50;
    grad.addColorStop(0, `rgba(${gr * 0.55},${gr},${gr * 0.35},${0.5 + r() * 0.4})`);
    grad.addColorStop(1, 'rgba(40,60,20,0)');
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // Damp running down from it.
  g.strokeStyle = 'rgba(30,40,20,0.35)';
  for (let i = 0; i < 6; i++) {
    g.lineWidth = 2 + r() * 3;
    const x = r() * 128;
    g.beginPath();
    g.moveTo(x, 10 + r() * 30);
    g.lineTo(x + (r() - 0.5) * 6, 128);
    g.stroke();
  }
});

const PLANE = new THREE.PlaneGeometry(1, 1);
const decalMat = (map, opacity = 1) => new THREE.MeshStandardMaterial({ map, transparent: true, opacity, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
const stone = (color = 0x6f6860) => new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
const iron = () => new THREE.MeshStandardMaterial({ color: 0x3a3836, metalness: 0.7, roughness: 0.5 });
const BRICK = new THREE.BoxGeometry(0.2, 0.09, 0.1);
const LINK = new THREE.TorusGeometry(0.048, 0.014, 5, 10);
const RING = new THREE.TorusGeometry(0.075, 0.016, 6, 14);

/** Cracks running down the stone. */
function addCracks(g, x, z) {
  const m = new THREE.Mesh(PLANE, decalMat(cracks(Math.floor(hash(x, z, 31) * 3)), 1));
  m.scale.set(0.9, 0.9, 1);
  m.position.set((hash(x, z, 32) - 0.5) * 0.15, 0.52, 0.01);
  g.add(m);
}

/** A few bricks fallen out: dark holes in the face, the bricks lying at its foot. */
function addGap(g, x, z) {
  const hole = stone(0x0d0b0a);
  const n = 2 + Math.floor(hash(x, z, 41) * 2);
  const y0 = 0.25 + hash(x, z, 42) * 0.45;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(BRICK, hole);
    m.position.set((i % 2 ? 0.11 : -0.11) + (hash(x, z, 43 + i) - 0.5) * 0.06, y0 + Math.floor(i / 2) * 0.1 - (i % 2) * 0.05, -0.04);
    g.add(m);
    const b = new THREE.Mesh(BRICK, stone(0x77706a));
    b.position.set((hash(x, z, 50 + i) - 0.5) * 0.7, 0.045, 0.12 + hash(x, z, 60 + i) * 0.22);
    b.rotation.set(hash(x, z, 70 + i) * 0.3, hash(x, z, 80 + i) * Math.PI, 0);
    b.castShadow = true;
    g.add(b);
  }
}

/** An arched niche with a skull, a candle stub or an urn in it. */
function addAlcove(g, x, z, candle) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.15, 0);
  shape.lineTo(0.15, 0);
  shape.lineTo(0.15, 0.24);
  shape.absarc(0, 0.24, 0.15, 0, Math.PI, false);
  shape.lineTo(-0.15, 0);
  const back = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), stone(0x16120f));
  back.position.set(0, 0.38, 0.012);
  g.add(back);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.05, 0.12), stone(0x8a8278));
  sill.position.set(0, 0.37, 0.05);
  sill.castShadow = true;
  g.add(sill);
  const what = hash(x, z, 91);
  if (what < 0.4) {
    // A skull: a dome and a jaw, its sockets dark.
    const bone = new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.8 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), bone);
    head.scale.set(1, 0.92, 1.1);
    head.position.set(0, 0.46, 0.05);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.06), bone);
    jaw.position.set(0, 0.415, 0.075);
    g.add(head, jaw);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 5), stone(0x0a0806));
      eye.position.set(s * 0.024, 0.465, 0.115);
      g.add(eye);
    }
  } else if (what < 0.7 && candle) {
    const c = candle.clone(true);
    c.scale.setScalar(0.32);
    c.position.set(0, 0.395, 0.05);
    g.add(c);
  } else {
    // An urn, turned on a lathe.
    const pts = [[0, 0], [0.035, 0], [0.05, 0.03], [0.055, 0.07], [0.04, 0.11], [0.028, 0.13], [0.036, 0.145]].map(([a, b]) => new THREE.Vector2(a, b));
    const urn = new THREE.Mesh(new THREE.LatheGeometry(pts, 12), new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.7 }));
    urn.position.set(0, 0.395, 0.05);
    g.add(urn);
  }
}

/** Moss and damp low on the wall. */
function addMoss(g, x, z) {
  const m = new THREE.Mesh(PLANE, decalMat(moss(Math.floor(hash(x, z, 101) * 3))));
  m.scale.set(1, 0.6, 1);
  m.position.set(0, 0.3, 0.012);
  g.add(m);
}

/** One or two chains hanging from rings in the wall, a shackle at the end. */
function addChains(g, x, z) {
  const metal = iron();
  const n = hash(x, z, 111) < 0.5 ? 1 : 2;
  for (let c = 0; c < n; c++) {
    const cx = n === 1 ? 0 : c ? 0.14 : -0.14;
    const top = 0.82;
    const ring = new THREE.Mesh(RING, metal);
    ring.position.set(cx, top, 0.02);
    g.add(ring);
    const links = 4 + Math.floor(hash(x, z, 112 + c) * 3);
    for (let i = 0; i < links; i++) {
      const l = new THREE.Mesh(LINK, metal);
      l.position.set(cx, top - 0.08 - i * 0.075, 0.03);
      l.rotation.set(0, i % 2 ? Math.PI / 2 : 0, Math.PI / 2);
      g.add(l);
    }
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.02, 6, 14), metal);
    cuff.position.set(cx, top - 0.12 - links * 0.075, 0.04);
    cuff.rotation.x = Math.PI / 2.4;
    g.add(cuff);
  }
}

/**
 * Dresses `board`'s kit walls. `skip` is the tile keys never to dress (secret doors), `avoid`
 * the spots already carrying a torch or banner. Returns Map(wall key → [groups]).
 */
export function dressWalls(board, { skip = new Set(), avoid = [], candle = null } = {}) {
  const grid = board.grid;
  const out = new Map();
  const taken = [...avoid];
  for (let z = 0; z < grid.height; z++) {
    for (let x = 0; x < grid.width; x++) {
      const k = key(x, z);
      if (!grid.isWall(x, z) || skip.has(k)) continue;
      for (const [dx, dz] of DIRS4) {
        const fx = x + dx;
        const fz = z + dz;
        if (!grid.inBounds(fx, fz) || grid.isWall(fx, fz) || grid.doors.has(key(fx, fz)) || grid.chasms?.has(key(fx, fz))) continue;
        // Only along a straight run, so it sits on a flat face.
        const along = dx ? [0, 1] : [1, 0];
        if (!grid.isWall(x + along[0], z + along[1]) || !grid.isWall(x - along[0], z - along[1])) continue;
        if (taken.some((s) => Math.abs(s.x - x) + Math.abs(s.z - z) < 2)) continue;
        const wet = DIRS4.some(([a, b]) => grid.water?.has(key(fx + a, fz + b))) || grid.water?.has(key(fx, fz));
        // Faces seen from the usual corner (toward +x or +z) get more; the rest show on a turn.
        const roll = hash(x * 3 + dx, z * 3 + dz, 7) * (dx + dz > 0 ? 1 : 1.6);
        let kind = null;
        if (wet && roll < 0.7) kind = 'moss';
        else if (roll < 0.12) kind = 'cracks';
        else if (roll < 0.2) kind = 'gap';
        else if (roll < 0.29) kind = 'alcove';
        else if (roll < 0.37) kind = 'chains';
        else if (roll < 0.43) kind = 'moss';
        if (!kind) continue;
        const g = new THREE.Group();
        g.position.set(x + dx * FACE, 0, z + dz * FACE);
        g.rotation.y = Math.atan2(dx, dz); // local +z out of the face, toward the floor
        g.scale.y = HEIGHT;
        if (kind === 'cracks') addCracks(g, x, z);
        else if (kind === 'gap') addGap(g, x, z);
        else if (kind === 'alcove') addAlcove(g, x, z, candle);
        else if (kind === 'chains') addChains(g, x, z);
        else addMoss(g, x, z);
        mergeMeshes(g); // one draw a material, not one a link (merge.js)
        board.group.add(g);
        board.addToCell(x, z, g);
        if (!out.has(k)) out.set(k, []);
        out.get(k).push(g);
        taken.push({ x, z });
        break;
      }
    }
  }
  return out;
}
