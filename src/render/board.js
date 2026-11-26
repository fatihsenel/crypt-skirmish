// Dungeon geometry plus tile highlight layers.

import * as THREE from 'three';
import { key } from '../game/grid.js';
import { tween, wait, easeOut, easeInOut, linear, keepAwake, calm } from './tween.js';
import { dustFx, glintFx } from './effects.js';
import { Motes } from './motes.js';
import { Marks } from './marks.js';
import { Tracks } from './tracks.js';
import { WaterMirror } from './reflect.js';
import { Clutter } from './clutter.js';
import { Wisps } from './wisps.js';
import { Life } from './life.js';
import { kitReady, piece } from './dungeonKit.js';

/** Wall height when built from the tile kit (the pack's walls are 4 units: squashed to fit). */
const KIT_WALL = 1.0;
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** A stable pseudo-random number in [0, 1) for a tile, so a map always looks the same. */
const hash = (x, z, salt = 0) => {
  const n = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
};

// Low walls keep figures behind them visible from the isometric angle.
const WALL_HEIGHT = 0.55;

// Rules 11: raised ledges (`grid.high`) stand this much over the floor; overlays and figures on
// them are lifted by `liftAt`.
export const LEDGE = 0.2;
let ledges = new Set();
// While a room builds itself (Board.rise), each tile's offset below its place: figures and
// overlays read it through liftAt, so they ride up with their tile.
const rising = new Map();
export const liftAt = (x, z) => {
  const k = key(Math.round(x), Math.round(z));
  return (ledges.has(k) ? LEDGE : 0) + (rising.get(k) ?? 0);
};
/** The ledge's height alone, for what is placed once and registered with its tile (rise moves it). */
const ledgeAt = (x, z) => (ledges.has(key(Math.round(x), Math.round(z))) ? LEDGE : 0);

// A room building itself: how far below the tiles start, how long each takes to rise, and how
// much later each tile starts per tile of distance from where the party stands.
const RISE_DROP = 0.9;
const RISE_MS = 300;
const RISE_STEP_MS = 24;
const RISE_MAX_DELAY = 450;
/** Ease out with a small overshoot, so a tile settles into place. */
const settle = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

/** The colour of each area spell's rune circle. */
export const RUNE_COLORS = {
  fireball: 0xff8a2a, iceStorm: 0x9fd4ff, shatter: 0xb98cff, entangle: 0x7ed35a,
  callLightning: 0xcfe0ff, fogCloud: 0xc8d0dc, grease: 0xd8c060,
};

let runeMap = null;
/** A circle of runes: two rings, a star between them and marks around the band (white, tinted). */
function runes() {
  if (runeMap) return runeMap;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.translate(256, 256);
  g.strokeStyle = '#fff';
  g.fillStyle = '#fff';
  g.lineCap = 'round';
  const ring = (r, w) => { g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); };
  ring(246, 7);
  ring(204, 4);
  ring(120, 3);
  // A seven-pointed star inside the inner band.
  g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i <= 7; i++) {
    const a = (i * 3 * Math.PI * 2) / 7 - Math.PI / 2;
    if (i === 0) g.moveTo(Math.cos(a) * 200, Math.sin(a) * 200);
    else g.lineTo(Math.cos(a) * 200, Math.sin(a) * 200);
  }
  g.stroke();
  // Angular marks round the band between the outer rings.
  let seed = 31;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const n = 18;
  g.lineWidth = 4;
  for (let i = 0; i < n; i++) {
    g.save();
    g.rotate((i / n) * Math.PI * 2);
    g.translate(0, -225);
    g.beginPath();
    g.moveTo(0, -12);
    g.lineTo(0, 12);
    const k = Math.floor(rnd() * 4);
    if (k === 0) { g.moveTo(-8, -6); g.lineTo(8, 6); }
    if (k === 1) { g.moveTo(0, -4); g.lineTo(9, -12); g.moveTo(0, 4); g.lineTo(-9, 12); }
    if (k === 2) { g.moveTo(-8, 0); g.lineTo(8, 0); }
    if (k === 3) { g.moveTo(0, -12); g.lineTo(8, -4); }
    g.stroke();
    g.restore();
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 - Math.PI / 2;
    g.beginPath();
    g.arc(Math.cos(a) * 162, Math.sin(a) * 162, 7, 0, Math.PI * 2);
    g.fill();
  }
  runeMap = new THREE.CanvasTexture(c);
  runeMap.anisotropy = 4;
  return runeMap;
}

/** A reusable set of flat tile overlays sharing one material. */
class TileLayer {
  constructor(parent, material, size = 0.9, y = 0.012) {
    this.parent = parent;
    this.material = material;
    this.geometry = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    this.y = y;
    this.meshes = [];
  }

  set(tiles) {
    this.last = tiles;
    tiles.forEach((t, i) => {
      let m = this.meshes[i];
      if (!m) {
        m = new THREE.Mesh(this.geometry, this.material);
        m.renderOrder = 2;
        this.parent.add(m);
        this.meshes.push(m);
      }
      m.position.set(t.x, this.y + liftAt(t.x, t.z), t.z);
      m.visible = true;
    });
    for (let i = tiles.length; i < this.meshes.length; i++) this.meshes[i].visible = false;
  }

  clear() {
    this.set([]);
  }
}

const DEBRIS_GEO = new THREE.BoxGeometry(1, 1, 1);
const LEDGE_GEO = new THREE.BoxGeometry(0.99, LEDGE, 0.99);

// Ambient occlusion, baked: a dark strip on the floor along the foot of each wall and ledge,
// darkest at the stone. Drawn once with the room, under the highlights; no cost per frame.
const AO_DEPTH = 0.55; // how far into the tile the shade reaches
const AO_GEO = new THREE.PlaneGeometry(1, AO_DEPTH).rotateX(-Math.PI / 2);
let aoMat = null;
function aoMaterial() {
  if (aoMat) return aoMat;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d');
  for (let y = 0; y < 64; y++) {
    const t = 1 - y / 63; // 1 at the wall (the canvas top), 0 at the far edge
    g.fillStyle = `rgba(0,0,0,${(0.72 * t ** 1.7).toFixed(3)})`;
    g.fillRect(0, y, 4, 1);
  }
  const map = new THREE.CanvasTexture(c);
  aoMat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  return aoMat;
}
const matCache = new Map();
const mat = (color, opts = {}) => {
  const k = `${color}|${JSON.stringify(opts)}`;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts }));
  return matCache.get(k);
};

/**
 * Wall spots for torches: walls facing the camera (floor at +x or +z) and
 * at least 5 tiles apart, at most 7 torches.
 */
function torchSpots(grid) {
  const spots = [];
  for (let z = 0; z < grid.height; z++) {
    for (let x = 0; x < grid.width; x++) {
      if (!grid.isWall(x, z)) continue;
      const dir = [[0, 1], [1, 0]].find(([dx, dz]) =>
        grid.inBounds(x + dx, z + dz) && !grid.isWall(x + dx, z + dz) && !grid.doors.has(key(x + dx, z + dz)));
      if (!dir) continue;
      if (spots.some((s) => Math.max(Math.abs(s.x - x), Math.abs(s.z - z)) < 5)) continue;
      spots.push({ x, z, dx: dir[0], dz: dir[1] });
      if (spots.length === 7) return spots;
    }
  }
  return spots;
}

/** How bright a tile the heroes saw before, but can't see now, is drawn. */
const REMEMBERED = 0.3;
// A dark area's tiles in sight are drawn dimmer, so the heroes' torches (UnitView.carryTorch)
// make a warm pool with a visible edge.
const DARK_SEEN = 0.62;
/** How see-through a wall gets when it stands in front of someone. */
const FADED = 0.28;

/** Walls facing the camera for banners: away from torches and from each other, up to 5. */
function bannerSpots(grid, torches) {
  const spots = [];
  for (let z = 0; z < grid.height; z++) {
    for (let x = 0; x < grid.width; x++) {
      if (!grid.isWall(x, z) || hash(x, z, 3) > 0.5) continue;
      const dir = [[0, 1], [1, 0]].find(([dx, dz]) =>
        grid.inBounds(x + dx, z + dz) && !grid.isWall(x + dx, z + dz) && !grid.doors.has(key(x + dx, z + dz)));
      if (!dir) continue;
      // only along a straight run, so the banner hangs on a flat face
      const along = dir[0] ? [0, 1] : [1, 0];
      if (!grid.isWall(x + along[0], z + along[1]) || !grid.isWall(x - along[0], z - along[1])) continue;
      if ([...torches, ...spots].some((s) => Math.max(Math.abs(s.x - x), Math.abs(s.z - z)) < 3)) continue;
      spots.push({ x, z, dx: dir[0], dz: dir[1] });
      if (spots.length === 5) return spots;
    }
  }
  return spots;
}

const WATER_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

/**
 * Ripples for shallow water: a tileable normal map (sine waves of whole periods, so tile meets
 * tile), shared by every water tile and scrolled by the board's tick, so the torchlight glints
 * on moving water.
 */
let ripples = null;
function rippleMap() {
  if (ripples) return ripples;
  const N = 128;
  const h = (x, y) => {
    const u = (x / N) * Math.PI * 2;
    const v = (y / N) * Math.PI * 2;
    return Math.sin(u * 2 + Math.sin(v) * 0.9) * 0.6 + Math.sin(v * 2 + u) * 0.4 + Math.sin((u - v) * 3) * 0.12;
  };
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * 4;
      const dy = (h(x, y + 1) - h(x, y - 1)) * 4;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * N + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  ripples = new THREE.CanvasTexture(c);
  ripples.wrapS = ripples.wrapT = THREE.RepeatWrapping;
  return ripples;
}
let waterMat = null;
const waterMaterial = () => (waterMat ??= new THREE.MeshStandardMaterial({
  color: 0x1c4a5e, transparent: true, opacity: 0.78, roughness: 0.12, metalness: 0.2, emissive: 0x08202c,
  normalMap: rippleMap(), normalScale: new THREE.Vector2(0.35, 0.35),
}));
// The lower hall of a room on two floors: a cool shadow over its floor.
const LOWER_MAT = new THREE.MeshBasicMaterial({ color: 0x061224, transparent: true, opacity: 0.5, depthWrite: false });
// A chasm's sides: a rock face wherever the hole meets solid ground (none between two chasm
// tiles, so a wide chasm is one pit), fading into black with depth (vertex colours, darkest at
// the bottom), over a layer of cold mist and a black floor far down.
const SHAFT_DEPTH = 2.2;
const SHAFT_GEO = new THREE.PlaneGeometry(1, SHAFT_DEPTH);
{
  const pos = SHAFT_GEO.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    // 1 at the rim, 0 at the bottom. Clamped: a negative base would make NaN, which the glow's
    // blur spreads over the whole screen.
    const k = Math.max(0, pos.getY(i) / SHAFT_DEPTH + 0.5) ** 1.6;
    col.set([k, k, k], i * 3);
  }
  SHAFT_GEO.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
const CHASM_MIST = new THREE.MeshBasicMaterial({ color: 0x3a4862, transparent: true, opacity: 0.4, depthWrite: false });
const CHASM_FLOOR = new THREE.MeshBasicMaterial({ color: 0x000000 });

/** Cracked floor (rules 6): a dark web of splits over the tile, drawn once and shared. */
let crackMat = null;
function crackMaterial() {
  if (crackMat) return crackMat;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = '#000';
  g.lineCap = 'round';
  let s = 7;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const crack = (x, y, a, len, w) => {
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    for (let i = 0; i < 6 && len > 0; i++) {
      a += (r() - 0.5) * 0.9;
      x += Math.cos(a) * len / 6; y += Math.sin(a) * len / 6;
      g.lineTo(x, y);
      if (r() < 0.3 && w > 1.5) crack(x, y, a + (r() < 0.5 ? 1 : -1), len * 0.45, w * 0.6);
    }
    g.stroke();
  };
  for (let i = 0; i < 5; i++) crack(64, 64, (i / 5) * Math.PI * 2 + r(), 52 + r() * 14, 4);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  crackMat = new THREE.MeshBasicMaterial({ color: 0x0c0806, map, transparent: true, opacity: 0.85, depthWrite: false, alphaTest: 0.02 });
  return crackMat;
}

const overlay = (color, opacity) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });

/**
 * A patterned overlay: diagonal stripes (Ice Storm's frost), a crosshatch (melee reach), dots
 * (ranged reach) or ripples (a foe heard out of sight). Patterns read on any floor, can't be mistaken for the solid move,
 * attack and heal highlights drawn over them, and tell melee from ranged without colour.
 */
function stripes(color, opacity, width, pattern = 'stripes') {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = g.fillStyle = '#fff';
  g.lineWidth = width;
  if (pattern === 'ripples') {
    g.setLineDash([7, 5]);
    for (const r of [10, 19, 28]) {
      g.globalAlpha = 1 - r / 40;
      g.beginPath();
      g.arc(32, 32, r, 0, Math.PI * 2);
      g.stroke();
    }
  } else if (pattern === 'spikes') { // caltrops: little four-pointed stars
    for (const [x, y] of [[14, 16], [40, 12], [26, 34], [52, 38], [12, 50], [42, 54]]) {
      g.beginPath();
      g.moveTo(x - 5, y); g.lineTo(x + 5, y);
      g.moveTo(x, y - 5); g.lineTo(x, y + 5);
      g.moveTo(x - 3, y - 3); g.lineTo(x + 3, y + 3);
      g.stroke();
    }
  } else if (pattern === 'slick') { // rules 10: Grease, glossy dark blots
    g.globalAlpha = 0.55;
    g.fillRect(0, 0, 64, 64);
    g.globalAlpha = 1;
    for (const [x, y, r] of [[18, 20, 12], [44, 16, 9], [36, 42, 14], [12, 50, 8], [56, 54, 7]]) {
      g.beginPath();
      g.ellipse(x, y, r, r * 0.7, 0.4, 0, Math.PI * 2);
      g.fill();
    }
  } else if (pattern === 'cracks') { // rules 10: a cracked ceiling's shadow, jagged lines from the middle
    const shade = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    shade.addColorStop(0, 'rgba(255,255,255,0.45)');
    shade.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = shade;
    g.fillRect(0, 0, 64, 64);
    for (const [x, y, a, b] of [[32, 32, 6, 8], [32, 32, 58, 20], [32, 32, 20, 60], [32, 32, 54, 56], [32, 32, 10, 40]]) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo((x + a) / 2 + 5, (y + b) / 2 - 4);
      g.lineTo(a, b);
      g.stroke();
    }
  } else if (pattern === 'dots') {
    for (let x = 8; x < 64; x += 16) {
      for (let y = 8; y < 64; y += 16) {
        g.beginPath();
        g.arc(x, y, width, 0, Math.PI * 2);
        g.fill();
      }
    }
  } else {
    for (let i = -64; i <= 128; i += 16) {
      g.beginPath();
      g.moveTo(i, 64);
      g.lineTo(i + 64, 0);
      g.stroke();
      if (pattern === 'crosshatch') {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i + 64, 64);
        g.stroke();
      }
    }
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ color, map, transparent: true, opacity, depthWrite: false });
}

/** Melee and ranged reach. The colour-blind pair (Okabe–Ito purple and yellow) differs in
 * brightness as well as hue, so it reads with any kind of colour blindness. */
export const THREAT_COLORS = {
  normal: { melee: 0xff2a1a, ranged: 0xffb347 },
  colorblind: { melee: 0xcc79a7, ranged: 0xf0e442 },
};

export class Board {
  constructor(grid, stage) {
    this.grid = grid;
    this.group = new THREE.Group();

    const floorGeo = new THREE.BoxGeometry(0.98, 0.2, 0.98);
    const floorMats = [
      new THREE.MeshStandardMaterial({ color: 0x4b423a, roughness: 0.95 }),
      new THREE.MeshStandardMaterial({ color: 0x433a33, roughness: 0.95 }),
    ];
    const wallGeo = new THREE.BoxGeometry(1, WALL_HEIGHT, 1);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x6f6862, roughness: 0.9 });
    const capGeo = new THREE.BoxGeometry(1.02, 0.08, 1.02);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x86807a, roughness: 0.85 });

    // Fog of war: every tile keeps its own materials so it can be dimmed on its own.
    // f = current brightness (0 unseen, REMEMBERED, 1 in view), eased toward `target`.
    this.cells = new Map();
    this.explored = new Set();
    this.fogDirty = false;
    this.walls = [];
    this.fadeSources = null; // () => [{x, z}]: figures that walls should not hide

    this.kit = kitReady();
    for (let z = 0; z < grid.height; z++) {
      for (let x = 0; x < grid.width; x++) {
        if (this.kit) {
          if (grid.isWall(x, z)) this.addKitWall(x, z);
          else if (grid.chasms.has(key(x, z))) continue; // drawn below
          else if (!grid.stairs.some((s) => s.x === x && s.z === z) && !grid.links.has(key(x, z))) this.addKitFloor(x, z);
          continue;
        }
        if (grid.isWall(x, z)) {
          const wall = new THREE.Mesh(wallGeo, wallMat);
          wall.position.set(x, WALL_HEIGHT / 2 - 0.1, z);
          wall.castShadow = wall.receiveShadow = true;
          const cap = new THREE.Mesh(capGeo, capMat);
          cap.position.set(x, WALL_HEIGHT - 0.06, z);
          cap.receiveShadow = true;
          this.group.add(wall, cap);
          this.addToCell(x, z, wall, cap);
          this.walls.push({ x, z, meshes: [wall, cap], opacity: 1 });
        } else if (!grid.chasms.has(key(x, z)) && !grid.stairs.some((s) => s.x === x && s.z === z) && !grid.links.has(key(x, z))) {
          const tile = new THREE.Mesh(floorGeo, floorMats[(x + z) % 2]);
          tile.position.set(x, -0.1, z);
          tile.receiveShadow = true;
          this.group.add(tile);
          this.addToCell(x, z, tile);
        }
      }
    }

    // Rules 11: a raised ledge, a block of dressed stone over the floor.
    ledges = new Set(grid.high ?? []);
    for (const k of ledges) {
      const [x, z] = k.split(',').map(Number);
      const block = new THREE.Mesh(LEDGE_GEO, mat(0x5e554c, { roughness: 0.92 }));
      block.position.set(x, LEDGE / 2, z);
      block.castShadow = block.receiveShadow = true;
      this.group.add(block);
      this.addToCell(x, z, block);
    }

    this.torchDim = 1; // the torches gutter for a moment as the lair shakes (lairShake)
    this.motes = new Motes(this.group); // embers and dust over the fires, grit into chasms (motes.js)
    this.ao = new Map(); // tile key -> its strips of shade
    for (let z = 0; z < grid.height; z++) for (let x = 0; x < grid.width; x++) this.addAO(x, z);

    // Shallow water: a dark, glossy sheet just over the floor.
    for (const k of grid.water) {
      const [x, z] = k.split(',').map(Number);
      const sheet = new THREE.Mesh(WATER_GEO, waterMaterial());
      sheet.position.set(x, 0.035, z);
      sheet.receiveShadow = true;
      this.group.add(sheet);
      this.addToCell(x, z, sheet);
    }

    // A room on two floors: the lower hall lies in a cooler shadow, and a flight of steps leads
    // down at each '[' and up at each ']', both toward the stair at the other end.
    for (const k of grid.lower) {
      if (grid.links.has(k)) continue;
      const [x, z] = k.split(',').map(Number);
      const shade = new THREE.Mesh(WATER_GEO, LOWER_MAT);
      shade.position.set(x, 0.006, z);
      this.group.add(shade);
      this.addToCell(x, z, shade);
    }
    this.flights = new Map(); // key -> { dx, dz, down }: which way each flight of steps runs
    for (const { down, up } of grid.stairways) {
      this.addFlight(down, up, true, grid);
      this.addFlight(up, down, false, grid);
    }

    // Chasms: a black shaft with rough rock walls dropping out of sight.
    for (const k of grid.chasms) {
      const [x, z] = k.split(',').map(Number);
      this.addShaft(x, z);
    }

    // Cracked floor (rules 6; the Game clears grid.cracks for older fights).
    this.cracks = new Map();
    for (const c of grid.cracks.values()) {
      const decal = new THREE.Mesh(WATER_GEO, crackMaterial());
      decal.position.set(c.x, 0.012, c.z);
      decal.rotation.y = ((c.x * 7 + c.z * 3) % 4) * (Math.PI / 2);
      this.group.add(decal);
      this.addToCell(c.x, c.z, decal);
      this.cracks.set(key(c.x, c.z), decal);
    }

    this.wisps = new Wisps(this, ledgeAt); // dark smoke at the edge of the unexplored (wisps.js)
    this.marks = new Marks(this, ledgeAt); // soot, charring and remains (marks.js)
    this.tracks = new Tracks(this, ledgeAt); // wet and bloody footprints (tracks.js)
    this.torches = [];
    const torches = torchSpots(grid);
    this.banners = [];
    for (const spot of torches) this.addTorch(spot);
    if (this.kit) for (const spot of bannerSpots(grid, torches)) this.addBanner(spot);

    this.doors = new Map();
    for (const d of grid.doors.values()) this.doors.set(key(d.x, d.z), { ...this.addDoor(d), opened: d.open });
    this.candles = [];
    this.braziers = new Map();
    this.pickables = []; // props the mouse can click (chests, braziers, levers), tagged with userData.tile
    this.levers = new Map();
    for (const p of grid.props.values()) this.addProp(p);
    this.gates = [...grid.gates.values()].map((g) => this.addGate(g));
    this.chests = new Map();
    for (const c of grid.chests.values()) this.chests.set(key(c.x, c.z), this.addChest(c));
    this.life = new Life(this, ledgeAt); // banners and cobwebs stirring, drips, a rat (life.js)
    this.clutter = new Clutter(this, liftAt); // pebbles, bones and shards, kicked and blown aside (clutter.js)
    this.traps = new Map();
    for (const s of grid.stairs) this.stairs = this.addStairs(s);

    // An area spell's circle of runes on the floor where it will land (preview and monster casts).
    this.runes = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: runes(), transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }),
    );
    this.runes.renderOrder = 3;
    this.runes.visible = false;
    this.group.add(this.runes);
    this.tick = (t, dt) => {
      if (this.fogDirty) this.tickFog(dt);
      if (this.fadeSources) this.tickFade(dt);
      if (this.fogDirty || this.fading) keepAwake(100); // fog and walls easing in and out
      // Flames waver and their light flickers and sways; reduced motion keeps them steady.
      const sway = calm() ? 0 : 1;
      for (const { light, seed, cell, flame, home } of this.torches) {
        const a = Math.sin(t * 9 + seed);
        const b = Math.sin(t * 23 + seed * 2);
        light.intensity = (5.5 + (a * 0.6 + b * 0.4) * sway) * cell.f * this.torchDim;
        light.position.set(home.x + Math.sin(t * 5.3 + seed) * 0.05 * sway, home.y + b * 0.03 * sway, home.z + Math.cos(t * 4.1 + seed) * 0.05 * sway);
        flame.scale.set(1 + b * 0.08 * sway, 1.5 + a * 0.22 * sway, 1 + b * 0.08 * sway);
      }
      for (const { light, seed, cell } of this.candles) {
        light.intensity = (1.1 + Math.sin(t * 11 + seed) * 0.15 * sway) * cell.f * this.torchDim;
      }
      for (const b of this.braziers.values()) {
        if (!b.lit) continue;
        b.light.intensity = (3 + (Math.sin(t * 8 + b.seed) * 0.5 + Math.sin(t * 19 + b.seed) * 0.3) * sway) * b.cell.f * this.torchDim;
        b.coals.material.emissiveIntensity = 1.6 * b.cell.f; // no glow from a room not yet seen
      }
      if (this.fireLit) this.fire.material.opacity = 0.8 + Math.sin(t * 6) * 0.1 + Math.sin(t * 15) * 0.06;
      if (this.stairs?.lit) this.stairs.light.intensity = 3 + Math.sin(t * 3) * 0.8;
      this.motes.tick(t, dt);
      if (ripples && sway) ripples.offset.set(t * 0.025, t * 0.016); // the water's ripples drift
      this.mirror?.tick(t, (x, z) => this.cells.get(key(x, z))?.f ?? 0);
      this.clutter?.tick(dt);
      this.wisps.tick(t);
      this.life?.tick(t, dt);
      if (this.runes.visible) {
        // Turning slowly and breathing; still under reduced motion.
        this.runes.rotation.y = sway ? t * 0.35 : 0;
        this.runes.material.opacity = (this.runes.userData.alpha ?? 0.8) * (sway ? 0.85 + 0.15 * Math.sin(t * 3) : 1);
      }
    };
    stage.tickers.add(this.tick);
    this.stage = stage;

    // Invisible ground plane for mouse picking.
    this.pickPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(grid.width, grid.height).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.pickPlane.position.set((grid.width - 1) / 2, 0, (grid.height - 1) / 2);
    this.group.add(this.pickPlane);

    // Highlight layers
    this.reach = new TileLayer(this.group, overlay(0x4aa3ff, 0.3));
    this.path = new TileLayer(this.group, overlay(0xffd36b, 0.55), 0.5, 0.014);
    this.hover = new TileLayer(this.group, overlay(0xffffff, 0.25), 0.96, 0.016);
    this.targets = new TileLayer(this.group, overlay(0xff4a4a, 0.4), 0.92, 0.013);
    this.active = new TileLayer(this.group, overlay(0xffd36b, 0.35), 0.96, 0.011);
    this.cone = new TileLayer(this.group, overlay(0xff8a2a, 0.5), 0.92, 0.015);
    this.teleport = new TileLayer(this.group, overlay(0xb07cff, 0.28), 0.9, 0.012);
    this.danger = new TileLayer(this.group, overlay(0xff3b3b, 0.55), 0.3, 0.017); // provoking steps
    this.allies = new TileLayer(this.group, overlay(0x4ade80, 0.4), 0.92, 0.013); // heal targets
    this.layers = [this.reach, this.path, this.hover, this.targets, this.active, this.cone, this.teleport, this.danger, this.allies];
    // Where the monsters could hurt a hero next turn (the Threats toggle). Drawn under the
    // other highlights, and left alone by clearHighlights: main.js sets them on their own.
    this.threatMelee = new TileLayer(this.group, stripes(THREAT_COLORS.normal.melee, 0.6, 4, 'crosshatch'), 0.98, 0.0104);
    this.threatRanged = new TileLayer(this.group, stripes(THREAT_COLORS.normal.ranged, 0.55, 4, 'dots'), 0.98, 0.0102);
    // Only a long-range shot reaches (at disadvantage): smaller, fainter dots.
    this.threatFar = new TileLayer(this.group, stripes(THREAT_COLORS.normal.ranged, 0.3, 2, 'dots'), 0.98, 0.0101);
    // Ice Storm's ground (difficult terrain): frost under everything else.
    this.ice = new TileLayer(this.group, stripes(0xd8f0ff, 0.6, 3), 0.98, 0.0106);
    this.fire = new TileLayer(this.group, overlay(0xff4a10, 0.8), 0.9, 0.0108); // a tipped brazier's coals
    this.caltrops = new TileLayer(this.group, stripes(0xc8c8d4, 0.95, 2.5, 'spikes'), 0.92, 0.0107); // rules 6
    // Rules 10: cracked ceilings (their shadow on the floor), Grease's slick and Fog Cloud's tiles.
    this.cracksAbove = new TileLayer(this.group, stripes(0x140e0a, 0.95, 3.5, 'cracks'), 0.98, 0.0105);
    this.grease = new TileLayer(this.group, stripes(0x5a4408, 0.85, 4, 'slick'), 0.96, 0.0107);
    this.fogPuffs = new THREE.Group();
    this.group.add(this.fogPuffs);
    this.rubbleTiles = new Set();
    // The figure a name in the combat log points at (hovered or clicked), over everything.
    this.spot = new TileLayer(this.group, overlay(0xffc93c, 0.7), 0.98, 0.018);
    // Where a foe out of sight was last heard (main.js): faint rings, over the fog.
    this.heard = new TileLayer(this.group, stripes(0xe4e8ff, 1, 4, 'ripples'), 0.96, 0.0109);
  }

  /**
   * The room builds itself: every tile and what stands on it rises into place in a wave out
   * from `from` (where the party stands). Drawn only; nothing waits for it. Reduced motion
   * shows the room at once.
   */
  rise(from) {
    rising.clear();
    if (calm()) return;
    const tiles = [];
    const home = new Set(); // an object in two cells rises with the first
    for (const [k, cell] of this.cells) {
      const [x, z] = k.split(',').map(Number);
      const delay = Math.min(RISE_MAX_DELAY, Math.hypot(x - from.x, z - from.z) * RISE_STEP_MS);
      const objs = [];
      for (const o of cell.objects) {
        if (home.has(o)) continue;
        home.add(o);
        objs.push({ o, y: o.position.y });
      }
      tiles.push({ k, delay, objs });
      rising.set(k, -RISE_DROP);
      for (const { o, y } of objs) o.position.y = y - RISE_DROP;
    }
    const layers = Object.values(this).filter((v) => v instanceof TileLayer);
    const total = RISE_MAX_DELAY + RISE_MS;
    const id = (this.riseId = (this.riseId ?? 0) + 1);
    keepAwake(total + 100);
    tween(total, (t) => {
      if (this.riseId !== id) return;
      const ms = t * total;
      for (const { k, delay, objs } of tiles) {
        const p = Math.min(1, Math.max(0, (ms - delay) / RISE_MS));
        const off = p >= 1 ? 0 : -RISE_DROP * (1 - settle(p));
        if (off === 0) rising.delete(k);
        else rising.set(k, off);
        for (const { o, y } of objs) o.position.y = y + off;
      }
      for (const l of layers) l.set(l.last ?? []); // the highlights ride up with their tiles
    }, linear).then(() => {
      if (this.riseId !== id) return;
      rising.clear();
      for (const { objs } of tiles) for (const { o, y } of objs) o.position.y = y;
      for (const l of layers) l.set(l.last ?? []);
    });
  }

  /** The threat colours: red and amber, or purple and yellow for colour-blind players. */
  setThreatColors(colorblind) {
    const c = THREAT_COLORS[colorblind ? 'colorblind' : 'normal'];
    this.threatMelee.material.color.setHex(c.melee);
    this.threatRanged.material.color.setHex(c.ranged);
    this.threatFar.material.color.setHex(c.ranged);
    this.threatMelee.material.opacity = colorblind ? 0.85 : 0.6; // the paler pair needs more ink
    this.threatRanged.material.opacity = colorblind ? 0.7 : 0.55;
    this.threatFar.material.opacity = colorblind ? 0.45 : 0.3;
  }

  /** Frost on the tiles that are difficult terrain (a Set of tile keys). */
  /** Rules 6: the tiles caltrops lie on (the Game's `caltropTiles`, a Map by key), or none. */
  setCaltrops(tiles) {
    this.caltrops.set([...(tiles?.values() ?? [])].map(({ x, z }) => ({ x, z })));
  }

  /** The tiles where a tipped brazier's coals burn (`keys`: tile keys), or none. */
  setFire(keys) {
    this.fire.set([...keys].map((k) => {
      const [x, z] = k.split(',').map(Number);
      return { x, z };
    }));
    this.fireLit = keys.size > 0;
  }

  /** Rules 10: the cracked ceilings still up (the Game's `ceilings`, a Map of {x, z, fallen}). */
  setCeilings(ceilings) {
    this.cracksAbove.set([...(ceilings?.values() ?? [])].filter((c) => !c.fallen));
  }

  /** Rules 10: the tiles Grease covers (tile keys). */
  setGrease(keys) {
    this.grease.set([...(keys ?? [])].map((k) => {
      const [x, z] = String(k).split(',').map(Number);
      return { x, z };
    }));
  }

  /** Rules 10: Fog Cloud's tiles (a Set of keys): grey puffs that hide what is in them. */
  setFog(keys) {
    const want = new Set(keys ?? []);
    for (const p of [...this.fogPuffs.children]) {
      if (!want.has(p.userData.k)) this.fogPuffs.remove(p);
      else want.delete(p.userData.k);
    }
    const m = mat(0xc8ccd0, { transparent: true, opacity: 0.82, depthWrite: false, roughness: 1 });
    for (const k of want) {
      const [x, z] = k.split(',').map(Number);
      const g = new THREE.Group();
      g.userData.k = k;
      for (let i = 0; i < 3; i++) {
        const r = 0.32 + ((x * 7 + z * 3 + i) % 3) * 0.05;
        const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), m);
        puff.scale.y = 0.75;
        puff.position.set((i - 1) * 0.22, 0.28 + (i % 2) * 0.22, ((i * 5 + x) % 3 - 1) * 0.14);
        g.add(puff);
      }
      g.position.set(x, 0, z);
      this.fogPuffs.add(g);
    }
    keepAwake(200);
  }

  /** Rules 10: rubble from a cave-in on each tile (difficult terrain): a few fallen stones. */
  addRubble(tiles) {
    const stone = mat(0x6e6458, { roughness: 1 });
    for (const { x, z } of tiles) {
      const k = key(x, z);
      if (this.rubbleTiles.has(k)) continue;
      this.rubbleTiles.add(k);
      const g = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const s = 0.09 + ((x * 3 + z * 5 + i * 7) % 4) * 0.025;
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), stone);
        const a = i * 1.7 + x + z;
        rock.position.set(Math.cos(a) * 0.25, s * 0.6, Math.sin(a) * 0.25);
        rock.rotation.set(a, a * 2, 0);
        rock.castShadow = true;
        g.add(rock);
      }
      g.position.set(x, 0, z);
      this.group.add(g);
      this.addToCell(x, z, g);
    }
    this.fogDirty = true;
  }

  setIce(keys) {
    this.ice.set([...keys].map((k) => {
      const [x, z] = k.split(',').map(Number);
      return { x, z };
    }));
  }

  // --- fog of war & wall fading ----------------------------------------------
  /** Registers objects standing on a tile, giving each mesh its own material. */
  /** A chasm's shaft at (x, z): rock faces toward solid ground, mist, and grit falling in. */
  addShaft(x, z) {
    this.holes ??= new Set();
    this.holes.add(key(x, z));
    const parts = [];
    for (const [dx, dz] of DIRS4) {
      const nk = key(x + dx, z + dz);
      if (this.grid.chasms.has(nk) || this.holes.has(nk)) continue;
      const face = new THREE.Mesh(SHAFT_GEO, mat(0x6a5c50, { roughness: 1, vertexColors: true }));
      face.position.set(x + dx * 0.5, -SHAFT_DEPTH / 2, z + dz * 0.5);
      face.rotation.y = Math.atan2(-dx, -dz); // facing into the hole
      face.receiveShadow = true;
      parts.push(face);
    }
    const mist = new THREE.Mesh(WATER_GEO, CHASM_MIST);
    mist.position.set(x, -0.8, z);
    const bottom = new THREE.Mesh(WATER_GEO, CHASM_FLOOR);
    bottom.position.set(x, -SHAFT_DEPTH, z);
    parts.push(mist, bottom);
    this.group.add(...parts);
    const cell = this.addToCell(x, z, ...parts);
    this.motes.add(new THREE.Vector3(x, -0.02, z), () => cell.f, { embers: 0, dust: 3, spread: 0.4, fall: true }); // grit trickling down
  }

  /** Rules 6: the cracked floor at (x, z) gives way: its tile drops out, leaving a shaft. */
  breakCrack(x, z) {
    const k = key(x, z);
    if (!this.cracks.delete(k)) return;
    for (const o of this.cells.get(k)?.objects ?? []) o.visible = false;
    this.addShaft(x, z);
    this.fogDirty = true;
  }

  /**
   * The baked shade on floor tile (x, z): a strip along each side that meets a wall (or a
   * ledge it stands below), starting at the wall's face (the kit's walls are half a tile thick).
   */
  addAO(x, z) {
    const g = this.grid;
    const k = key(x, z);
    if (g.isWall(x, z) || g.chasms.has(k) || g.links.has(k) || g.stairs.some((s) => s.x === x && s.z === z)) return;
    const high = ledges.has(k);
    const strips = [];
    for (const [dx, dz] of DIRS4) {
      const nx = x + dx;
      const nz = z + dz;
      if (!g.inBounds(nx, nz)) continue;
      const wall = g.isWall(nx, nz) && !g.doors.has(key(nx, nz));
      const ledge = !high && ledges.has(key(nx, nz));
      if (!wall && !ledge) continue;
      const face = wall && this.kit ? 0.75 : 0.5; // from this tile's centre
      const strip = new THREE.Mesh(AO_GEO, aoMaterial());
      const off = face - AO_DEPTH / 2;
      strip.position.set(x + dx * off, (high ? LEDGE : 0) + 0.005, z + dz * off);
      strip.rotation.y = Math.atan2(-dx, -dz); // the dark edge (the plane's far side) toward the wall
      strip.renderOrder = -1;
      strips.push(strip);
    }
    if (!strips.length) return;
    this.group.add(...strips);
    this.addToCell(x, z, ...strips);
    this.ao.set(k, strips);
  }

  /** The shade on (x, z) drawn afresh (a wall beside it opened). */
  redoAO(x, z) {
    const k = key(x, z);
    const old = this.ao.get(k);
    if (old) {
      const cell = this.cells.get(k);
      for (const o of old) {
        this.group.remove(o);
        if (cell) cell.objects = cell.objects.filter((p) => p !== o);
      }
      this.ao.delete(k);
    }
    this.addAO(x, z);
  }

  addToCell(x, z, ...objects) {
    const k = key(x, z);
    let cell = this.cells.get(k);
    if (!cell) {
      cell = { objects: [], mats: [], f: 1, target: 1 };
      this.cells.set(k, cell);
    }
    cell.applied = null; // the fog is applied to the new parts on the next tick
    for (const obj of objects) {
      cell.objects.push(obj);
      obj.traverse((o) => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        cell.mats.push({ m: o.material, base: o.material.color.clone() });
      });
    }
    return cell;
  }

  /**
   * What the heroes can see right now (a Set of tile keys). Tiles seen before stay
   * dimly drawn; tiles never seen stay black. `snap` skips the fade (new level).
   */
  setVision(visible, { snap = false, from = [] } = {}) {
    for (const k of visible) this.explored.add(k);
    const sweep = !snap && from.length && !calm();
    for (const [k, cell] of this.cells) {
      const target = visible.has(k) ? (this.dark?.has(k) ? DARK_SEEN : 1) : this.explored.has(k) ? REMEMBERED : 0;
      // What comes into sight fills in as a wave out from the eyes that saw it.
      if (sweep && target > cell.target) {
        const [x, z] = k.split(',').map(Number);
        const d = Math.min(...from.map((e) => Math.hypot(e.x - x, e.z - z)));
        cell.delay = Math.min(1, Math.max(0, d - 1) * 0.08);
      } else if (target <= cell.target) cell.delay = 0;
      cell.target = target;
      if (snap) cell.f = cell.target;
    }
    this.fogDirty = true;
    this.wisps.dirty = true;
    if (snap) this.tickFog(0);
  }

  /** The room's dark tiles (rules 6), drawn dimmer when in sight; set before the first setVision. */
  setDark(keys) {
    this.dark = new Set(keys);
  }

  isExplored(x, z) {
    return this.explored.has(key(x, z));
  }

  tickFog(dt) {
    let moving = false;
    const k = Math.min(1, dt * 5);
    for (const cell of this.cells.values()) {
      if (cell.delay > 0) { // waiting for the wave to reach it (setVision)
        cell.delay -= dt;
        moving = true;
        continue;
      }
      if (cell.f !== cell.target) {
        cell.f += (cell.target - cell.f) * k;
        if (Math.abs(cell.target - cell.f) < 0.01) cell.f = cell.target;
        else moving = true;
      } else if (cell.applied === cell.f) continue;
      cell.applied = cell.f;
      for (const { m, base } of cell.mats) m.color.copy(base).multiplyScalar(cell.f);
      for (const o of cell.objects) o.visible = cell.f > 0.005;
    }
    this.fogDirty = moving;
  }

  /**
   * Walls between the camera and a figure turn see-through. The camera looks from
   * +x/+z, so a wall is "in front" when its x+z is a little larger than the figure's
   * and it lines up on screen (similar x−z).
   */
  tickFade(dt) {
    const who = this.fadeSources();
    const k = Math.min(1, dt * 8);
    this.fading = false;
    for (const w of this.walls) {
      let target = 1;
      for (const p of who) {
        const depth = (w.x + w.z) - (p.x + p.z);
        const side = Math.abs((w.x - w.z) - (p.x - p.z));
        if (depth > 0.5 && depth < 3.5 && side < 1.6) {
          target = FADED;
          break;
        }
      }
      if (Math.abs(w.opacity - target) < 0.005) continue;
      w.opacity += (target - w.opacity) * k;
      if (Math.abs(w.opacity - target) < 0.01) w.opacity = target;
      else this.fading = true;
      const see = w.opacity < 0.999;
      for (const m of w.meshes) {
        if (m.material.transparent !== see) {
          m.material.transparent = see;
          m.material.needsUpdate = true;
        }
        m.material.opacity = w.opacity;
        m.castShadow = !see;
      }
    }
  }

  // --- props ----------------------------------------------------------------------
  /**
   * Barrels and crates (low, half cover) and columns (full height, fade like walls). A few
   * crates carry a lit candle. Plain boxes stand in when the kit didn't load.
   */
  addProp({ x, z, kind }) {
    const parts = [];
    const turn = hash(x, z, 5) * Math.PI * 2;
    const kitPiece = (name, scale, dx = 0, dz = 0, y = 0) => {
      const p = this.kit ? piece(name) : null;
      if (!p) return null;
      p.scale.setScalar(scale);
      p.position.set(x + dx, y, z + dz);
      p.rotation.y = turn + dx * 3;
      parts.push(p);
      return p;
    };
    const box = (w, h, color) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat(color));
      m.position.set(x, h / 2, z);
      m.castShadow = m.receiveShadow = true;
      parts.push(m);
    };
    if (kind === 'brazier') return this.addBrazier(x, z);
    if (kind === 'lever') return this.addLever(x, z);
    if (kind === 'gong') return this.addGong(x, z);
    if (kind === 'captive') return this.addCaptive(x, z);
    if (kind === 'barrel') {
      if (!kitPiece('barrel_small', 0.5, -0.12, -0.1)) box(0.5, 0.5, 0x6b4a2c);
      else if (hash(x, z, 6) > 0.4) kitPiece('barrel_small', 0.36, 0.24, 0.2);
    } else if (kind === 'crate') {
      if (!kitPiece('box_small', 0.55)) box(0.55, 0.55, 0x7a5a34);
      else if (hash(x, z, 7) > 0.55) kitPiece('box_small', 0.32, 0.04, -0.02, 0.55);
      else if (hash(x, z, 7) > 0.3 && this.candles.length < 6) {
        kitPiece('candle_lit', 0.3, 0.1, 0.08, 0.55);
        const light = new THREE.PointLight(0xffb060, 1, 2.6, 2);
        light.position.set(x + 0.1, 0.95, z + 0.08);
        this.group.add(light);
        this.candles.push({ light, seed: hash(x, z, 8) * 10, cell: null, x, z });
      }
    } else {
      if (!kitPiece('column', 0)) box(0.5, KIT_WALL * 1.5, 0x6f6862);
      else parts[0].scale.set(0.6, 1.1, 0.6); // 1.4 tall in the kit: about one and a half walls
    }
    this.group.add(...parts);
    const cell = this.addToCell(x, z, ...parts);
    for (const c of this.candles) c.cell ??= cell;
    if (kind === 'barrel' || kind === 'crate') (this.propParts ??= new Map()).set(key(x, z), parts);
    if (kind === 'barrel' || kind === 'crate') (this.propKinds ??= new Map()).set(key(x, z), kind);
    if (kind === 'column') {
      const meshes = [];
      for (const p of parts) p.traverse((o) => { if (o.isMesh) meshes.push(o); });
      this.walls.push({ x, z, meshes, opacity: 1 });
    }
  }

  /** Rules 9: an alarm gong, a bronze disc hung in a dark wooden frame. */
  addGong(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = Math.PI / 4; // its face toward the camera
    const wood = mat(0x3a2618);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.95, 0.07), wood);
      post.position.set(s * 0.36, 0.475, 0);
      g.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.08, 0.09), wood);
    beam.position.y = 0.95;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.035, 28), mat(0xb8892e, { metalness: 0.85, roughness: 0.35, emissive: 0x2a1a04 }));
    disc.rotation.x = Math.PI / 2;
    disc.position.y = 0.55;
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), mat(0xd8a848, { metalness: 0.9, roughness: 0.3 }));
    boss.scale.z = 0.4;
    boss.position.set(0, 0.55, 0.02);
    g.add(beam, disc, boss);
    g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    this.group.add(g);
    this.addToCell(x, z, g);
    this.gongDisc = disc;
  }

  /** Rules 9: the gong is struck: it shivers for a moment. */
  async strikeGong() {
    const d = this.gongDisc;
    if (!d) return;
    await tween(900, (t) => { d.rotation.z = Math.sin(t * Math.PI * 9) * 0.12 * (1 - t); });
    d.rotation.z = 0;
  }

  /** Rules 9: a prisoner in rags, chained to a post. Freed or dragged off, `removeProp` takes them away. */
  addCaptive(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = Math.PI / 4; // facing the camera, the post behind
    g.scale.setScalar(1.7); // a figure's height
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.9, 8), mat(0x4a3424));
    post.position.set(0, 0.45, -0.16);
    const rags = mat(0x8a7a5c);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.36, 10), rags);
    body.position.set(0, 0.2, 0);
    body.rotation.x = 0.15;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), mat(0xc49a7c));
    head.position.set(0, 0.47, 0.03);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x3a2a1e));
    hair.position.copy(head.position);
    const iron = mat(0x3b3b40, { metalness: 0.7, roughness: 0.45 });
    const chain = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.015, 6, 18), iron);
    chain.rotation.x = Math.PI / 2;
    chain.position.set(0, 0.3, -0.05);
    g.add(post, body, head, hair, chain);
    g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    this.group.add(g);
    this.addToCell(x, z, g);
    (this.propParts ??= new Map()).set(key(x, z), [g]);
  }

  /**
   * Rules 9: a secret door is found: its wall goes, the walls around it are drawn again to frame
   * a doorway, and a closed door stands there (the grid already has it).
   */
  revealSecret(x, z) {
    const k = key(x, z);
    if (this.doors.has(k)) return;
    const cell = this.cells.get(k);
    if (cell) {
      for (const o of cell.objects) this.group.remove(o);
      cell.objects = [];
      cell.mats = [];
    }
    this.walls = this.walls.filter((w) => w.x !== x || w.z !== z);
    if (this.kit) {
      this.addKitFloor(x, z);
      for (const [dx, dz] of DIRS4) this.redrawKitWall(x + dx, z + dz);
    } else {
      const tile = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 1), mat(0x4a4540));
      tile.position.set(x, -0.1, z);
      tile.receiveShadow = true;
      this.group.add(tile);
      this.addToCell(x, z, tile);
    }
    const d = this.grid.doors.get(k) ?? { x, z, open: false };
    this.doors.set(k, { ...this.addDoor(d), opened: d.open });
    for (const [dx, dz] of DIRS4) this.redoAO(x + dx, z + dz);
    this.fogDirty = true;
  }

  /** A kit wall tile drawn again (its neighbours changed), keeping whatever else stands in its cell. */
  redrawKitWall(x, z) {
    const k = key(x, z);
    const old = this.kitWalls?.get(k);
    if (!old || !this.grid.isWall(x, z)) return;
    const cell = this.cells.get(k);
    for (const p of old) {
      this.group.remove(p);
      if (cell) cell.objects = cell.objects.filter((o) => o !== p);
    }
    this.walls = this.walls.filter((w) => w.x !== x || w.z !== z);
    this.addKitWall(x, z);
  }

  /**
   * Rules 7: a barrel or crate smashed: it goes (removeProp) and leaves broken staves and boards
   * lying round its tile for the rest of the fight (drawn only).
   */
  smashProp(x, z) {
    const kind = this.propKinds?.get(key(x, z));
    this.removeProp(x, z);
    if (!this.canDebris(x, z)) return;
    const wood = kind === 'barrel' ? [0x7a5634, 0x5e4026, 0x8a6a44] : [0x8a6a44, 0x6e5232, 0x9a7a50];
    const y0 = liftAt(x, z);
    const pieces = [];
    const n = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const long = Math.random() < 0.6;
      const m = new THREE.Mesh(DEBRIS_GEO, mat(wood[i % wood.length], { roughness: 0.9 }));
      m.scale.set(long ? 0.05 : 0.09, 0.025, long ? 0.2 + Math.random() * 0.12 : 0.09);
      const a = Math.random() * Math.PI * 2;
      const d = 0.1 + Math.random() * 0.32;
      m.position.set(x + Math.cos(a) * d, y0 + 0.015 + Math.random() * 0.012, z + Math.sin(a) * d);
      m.rotation.set((Math.random() - 0.5) * 0.25, Math.random() * Math.PI, (Math.random() - 0.5) * 0.25);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      pieces.push(m);
    }
    if (kind === 'barrel') {
      // A hoop off the barrel.
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.012, 4, 18).rotateX(Math.PI / 2), mat(0x3a3634, { roughness: 0.5, metalness: 0.6 }));
      hoop.position.set(x + 0.12, y0 + 0.014, z - 0.08);
      hoop.rotation.z = 0.08;
      this.group.add(hoop);
      pieces.push(hoop);
    }
    this.addToCell(x, z, ...pieces);
    this.fogDirty = true;
  }

  /** Whether broken pieces can lie on (x, z): not over water, a chasm or a pit. */
  canDebris(x, z) {
    const k = key(x, z);
    return !this.grid.water?.has(k) && !this.grid.chasms?.has(k);
  }

  /** Rules 7: a barrel or crate smashed to pieces: it's gone, and so is a candle on it. */
  removeProp(x, z) {
    const k = key(x, z);
    const parts = this.propParts?.get(k);
    if (!parts) return;
    this.propParts.delete(k);
    const cell = this.cells.get(k);
    for (const p of parts) {
      this.group.remove(p);
      if (cell) cell.objects = cell.objects.filter((o) => o !== p);
    }
    this.candles = this.candles.filter((c) => {
      if (c.x !== x || c.z !== z) return true;
      this.group.remove(c.light);
      return false;
    });
    this.fogDirty = true;
  }

  /**
   * Rules 7: a thrown torch (a stick with a flame) or the Light cantrip (a glowing mote) on a
   * tile, with a point light reaching about as far as it lights.
   */
  addLamp(x, z, radius, spell = false) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    if (spell) {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff4c8 }));
      orb.position.y = 0.7;
      g.add(orb);
    } else {
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.42, 6), mat(0x5a3a20));
      stick.position.set(0, 0.05, 0);
      stick.rotation.z = Math.PI / 2.3;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 8), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
      flame.position.set(0.2, 0.16, 0);
      g.add(stick, flame);
    }
    const light = new THREE.PointLight(spell ? 0xfff0d0 : 0xffa050, spell ? 2.2 : 1.6, radius + 1.5, 2);
    light.position.set(x, spell ? 0.8 : 0.45, z);
    this.group.add(g, light);
    const cell = this.addToCell(x, z, g);
    (this.lamps ??= []).push({ g, light });
    if (!spell) this.motes.add(new THREE.Vector3(x + 0.2, 0.24, z), () => cell.f, { embers: 3, dust: 3, spread: 0.7 }); // a thrown torch
  }

  /** A brazier: an iron bowl of coals on a stem, lit, that a hero can tip over (tipBrazier). */
  addBrazier(x, z) {
    const iron = mat(0x2e2a28, { roughness: 0.55, metalness: 0.6 });
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const part = (geo, m, y) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.y = y;
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    part(new THREE.CylinderGeometry(0.2, 0.24, 0.06, 14), iron, 0.03);
    part(new THREE.CylinderGeometry(0.035, 0.05, 0.5, 8), iron, 0.3);
    part(new THREE.CylinderGeometry(0.27, 0.13, 0.2, 14), iron, 0.62);
    const coals = part(new THREE.CylinderGeometry(0.23, 0.23, 0.03, 14),
      new THREE.MeshStandardMaterial({ color: 0x5a1a08, emissive: 0xff5a14, emissiveIntensity: 1.6, roughness: 0.9 }), 0.71);
    coals.castShadow = false;
    const light = new THREE.PointLight(0xff7a2a, 3, 3.6, 2);
    light.position.set(0, 1.0, 0);
    g.add(light);
    g.userData.tile = { x, z };
    this.group.add(g);
    this.pickables.push(g);
    const cell = this.addToCell(x, z, g);
    const b = { g, light, coals, cell, lit: true, seed: hash(x, z, 9) * 10 };
    this.braziers.set(key(x, z), b);
    this.motes.add(new THREE.Vector3(x, 0.78, z), () => (b.lit ? cell.f : 0), { embers: 8, dust: 6, spread: 0.9 });
  }

  /**
   * The brazier at (x, z) goes over, away from (fromX, fromZ), and its fire goes out (the coals
   * on the floor are the fire layer). `instant` for a restored fight.
   */
  async tipBrazier(x, z, fromX, fromZ, instant = false) {
    const b = this.braziers.get(key(x, z));
    if (!b || !b.lit) return;
    b.lit = false;
    const dx = Math.sign(x - fromX);
    const dz = Math.sign(z - fromZ);
    const norm = Math.hypot(dx, dz) || 1;
    const fall = (t) => {
      b.g.rotation.z = -(dx / norm) * (Math.PI / 2) * t;
      b.g.rotation.x = (dz / norm) * (Math.PI / 2) * t;
      b.g.position.y = 0.2 * t; // the bowl's rim rests on the floor
      b.light.intensity = 3 * (1 - t);
      b.coals.material.emissiveIntensity = 1.6 * (1 - t);
    };
    if (instant) return fall(1);
    await tween(380, (t) => fall(t), (t) => t * t);
  }

  /** A lever on an iron post: thrown back when pulled (setGates). */
  addLever(x, z) {
    const iron = mat(0x2e2a28, { roughness: 0.55, metalness: 0.6 });
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.26), mat(0x7d766f));
    base.position.y = 0.15;
    base.castShadow = base.receiveShadow = true;
    g.add(base);
    const pivot = new THREE.Group();
    pivot.position.y = 0.3;
    pivot.rotation.x = -0.6;
    g.add(pivot);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8), iron);
    arm.position.y = 0.25;
    arm.castShadow = true;
    pivot.add(arm);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), mat(0x8a2a1a, { roughness: 0.5 }));
    knob.position.y = 0.5;
    pivot.add(knob);
    g.userData.tile = { x, z };
    this.group.add(g);
    this.pickables.push(g);
    this.addToCell(x, z, g);
    this.levers.set(key(x, z), pivot);
  }

  /** Iron bars in a stone frame, spanning the tile like a door; raised, they hang overhead. */
  addGate({ x, z, down }) {
    const across = (dx, dz) => this.grid.isWall(x + dx, z + dz) || this.grid.gates.has(key(x + dx, z + dz));
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    if (!(across(-1, 0) || across(1, 0))) g.rotation.y = Math.PI / 2;
    if (this.kit) g.scale.y = KIT_WALL / 0.78;
    const iron = mat(0x34302d, { roughness: 0.5, metalness: 0.7 });
    const bars = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.72, 6), iron);
      bar.position.set(-0.42 + i * 0.168, 0.36, 0);
      bar.castShadow = true;
      bars.add(bar);
    }
    for (const y of [0.12, 0.62]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1, 0.04, 0.05), iron);
      rail.position.y = y;
      bars.add(rail);
    }
    g.add(bars);
    this.group.add(g);
    this.addToCell(x, z, g);
    const gate = { bars, x, z };
    this.placeGate(gate, down ? 1 : 0);
    return gate;
  }

  /** `t` 1: down on the floor; 0: raised overhead, the tips of the bars just showing. */
  placeGate(gate, t) {
    gate.t = t;
    gate.bars.position.y = (1 - t) * 0.66;
  }

  /** Every portcullis drops (`down`) or rises, and the levers are thrown. `instant` for a restored fight. */
  async setGates(down, instant = false) {
    for (const pivot of this.levers.values()) pivot.rotation.x = down ? 0.6 : -0.6;
    const to = down ? 1 : 0;
    if (instant) return this.gates.forEach((g) => this.placeGate(g, to));
    keepAwake(800);
    const from = this.gates.map((g) => g.t);
    await tween(down ? 260 : 700, (t) => this.gates.forEach((g, i) => this.placeGate(g, from[i] + (to - from[i]) * t)),
      down ? (t) => t * t : easeOut);
  }

  // --- tile kit ------------------------------------------------------------------
  /** A floor tile: mostly plain, some cracked or overgrown, turned at random. */
  kitFloorPiece(x, z) {
    const r = hash(x, z);
    const name = r < 0.07 ? 'floor_tile_small_broken_A' : r < 0.13 ? 'floor_tile_small_broken_B'
      : r < 0.18 ? 'floor_tile_small_weeds_A' : 'floor_tile_small';
    const p = piece(name) ?? piece('floor_tile_small');
    p.scale.setScalar(0.5);
    p.position.set(x, -0.025, z);
    p.rotation.y = Math.floor(hash(x, z, 1) * 4) * (Math.PI / 2);
    return p;
  }

  addKitFloor(x, z) {
    const p = this.kitFloorPiece(x, z);
    this.group.add(p);
    this.addToCell(x, z, p);
  }

  /**
   * A wall tile becomes wall segments from its centre to each neighbouring wall (east and
   * south; the others reach in from their side), short stubs framing doors, and a pillar
   * at corners, junctions and lone wall tiles.
   */
  addKitWall(x, z) {
    const g = this.grid;
    const wallAt = (a, b) => g.inBounds(a, b) && g.isWall(a, b);
    const doorAt = (a, b) => g.doors.has(key(a, b));
    const sy = KIT_WALL / 4;
    const parts = [];
    const arm = (dx, dz, len = 1) => {
      const p = piece('wall_half');
      p.scale.set(0.5 * len, sy, 0.5);
      p.position.set(x, 0, z);
      p.rotation.y = dx > 0 ? 0 : dx < 0 ? Math.PI : dz > 0 ? -Math.PI / 2 : Math.PI / 2;
      parts.push(p);
    };
    if (wallAt(x + 1, z)) arm(1, 0);
    if (wallAt(x, z + 1)) arm(0, 1);
    const links = DIRS4.filter(([dx, dz]) => wallAt(x + dx, z + dz) || doorAt(x + dx, z + dz));
    for (const [dx, dz] of links) if (doorAt(x + dx, z + dz)) arm(dx, dz, 0.5);
    const straight = links.length === 2 && links[0][0] === -links[1][0] && links[0][1] === -links[1][1];
    if (!straight) {
      const pillar = piece('pillar');
      pillar.scale.set(0.34, sy * 1.04, 0.34);
      pillar.position.set(x, 0, z);
      parts.push(pillar);
    }
    // Floor shows around the wall's foot next to rooms.
    let open = false;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (g.inBounds(x + dx, z + dz) && !g.isWall(x + dx, z + dz)) open = true;
    const floor = open ? this.kitFloorPiece(x, z) : null;
    const all = floor ? [...parts, floor] : parts;
    this.group.add(...all);
    this.addToCell(x, z, ...all);
    (this.kitWalls ??= new Map()).set(key(x, z), all);
    const meshes = [];
    for (const p of parts) p.traverse((o) => { if (o.isMesh) meshes.push(o); });
    this.walls.push({ x, z, meshes, opacity: 1 });
  }

  /** A hanging banner on a wall facing the camera. */
  addBanner({ x, z, dx, dz }) {
    const b = piece('banner_red');
    if (!b) return;
    b.scale.set(0.42, KIT_WALL / 4, 0.5);
    // Hung from a pivot at its top edge, so it can swing out from the wall (render/life.js).
    const top = new THREE.Box3().setFromObject(b).max.y;
    b.position.set(0, -top, 0);
    const pivot = new THREE.Group();
    pivot.rotation.order = 'YXZ'; // the swing turns about the wall's own horizontal
    pivot.position.set(x, top, z);
    pivot.rotation.y = Math.atan2(dx, dz);
    pivot.add(b);
    this.group.add(pivot);
    this.addToCell(x, z, pivot);
    this.banners.push({ pivot, x: x + dx * 0.5, z: z + dz * 0.5, kick: 0, ph: Math.random() * 6.3 });
  }

  // --- props ------------------------------------------------------------------
  addTorch({ x, z, dx, dz }) {
    let holder;
    let pos;
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb066 }));
    if (this.kit && (holder = piece('torch_mounted'))) {
      // Mounted on the wall face (the kit's walls are half a tile thick).
      pos = new THREE.Vector3(x + dx * 0.25, 0.55, z + dz * 0.25);
      holder.scale.setScalar(0.5);
      holder.position.copy(pos);
      holder.rotation.y = Math.atan2(dx, dz);
      flame.position.copy(pos).add(new THREE.Vector3(dx * 0.26, 0.38, dz * 0.26));
    } else {
      holder = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.22, 6), mat(0x3a2a1c));
      pos = new THREE.Vector3(x + dx * 0.52, 0.72, z + dz * 0.52);
      holder.position.copy(pos);
      holder.rotation.set(dz * 0.5, 0, -dx * 0.5);
      flame.position.copy(pos).add(new THREE.Vector3(dx * 0.06, 0.15, dz * 0.06));
    }
    flame.scale.y = 1.5;
    const light = new THREE.PointLight(0xff8a3d, 6, 7, 1.6);
    light.position.copy(flame.position).add(new THREE.Vector3(dx * 0.3, 0.2, dz * 0.3));
    this.group.add(holder, flame, light);
    const cell = this.addToCell(x, z, holder, flame);
    this.torches.push({ light, seed: x * 7.3 + z * 3.1, cell, flame, home: light.position.clone() });
    this.motes.add(flame.position, () => cell.f);
  }

  /** Stone frame and a wooden door that swings open on its hinge. */
  addDoor({ x, z, open, barred }) {
    // Doors span between the walls on either side of them.
    const alongX = this.grid.isWall(x - 1, z) || this.grid.isWall(x + 1, z);
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    if (!alongX) g.rotation.y = Math.PI / 2;
    if (this.kit) g.scale.y = KIT_WALL / 0.78;
    this.group.add(g);
    const stone = mat(0x7d766f);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.3), stone);
      post.position.set(s * 0.47, 0.35, 0);
      post.castShadow = true;
      g.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.12, 0.32), stone);
    lintel.position.y = 0.72;
    g.add(lintel);
    const hinge = new THREE.Group();
    hinge.position.set(-0.41, 0, 0);
    g.add(hinge);
    const wood = mat(0x6b4524);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.64, 0.07), wood);
    panel.position.set(0.41, 0.32, 0);
    panel.castShadow = true;
    hinge.add(panel);
    for (const y of [0.15, 0.49]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.05, 0.08), mat(0x3b3b40, { metalness: 0.6, roughness: 0.5 }));
      band.position.set(0.41, y, 0);
      hinge.add(band);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.01, 6, 12), mat(0xb08a3a, { metalness: 0.8, roughness: 0.3 }));
    ring.position.set(0.7, 0.32, 0.05);
    hinge.add(ring);
    // Rules 8: the bar a hero drops across it, shown while it's barred.
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.11, 0.26), mat(0xa8763c)); // through the door: seen from either side
    bar.position.set(0, 0.36, 0);
    bar.castShadow = true;
    bar.visible = !!barred;
    g.add(bar);
    if (open) hinge.rotation.y = -1.7;
    this.addToCell(x, z, g);
    return { hinge, bar };
  }

  async openDoor(x, z) {
    const d = this.doors.get(key(x, z));
    if (!d || d.opened) return;
    d.opened = true;
    d.bar.visible = false;
    if (calm()) {
      await tween(300, (t) => { d.hinge.rotation.y = -1.7 * t; }, easeOut);
      return;
    }
    // It swings wide, knocks back off the wall a little and settles, raising dust.
    await tween(380, (t) => { d.hinge.rotation.y = -1.82 * t; }, easeOut);
    dustFx(this.stage.scene, { x, z }, { count: 8, size: 0.4, y: liftAt(x, z) });
    await tween(220, (t) => { d.hinge.rotation.y = -1.82 + 0.12 * Math.sin(t * Math.PI) + 0.12 * t; }, easeOut);
  }

  /** Rules 8: a hero swings the door shut and drops its bar. */
  async shutDoor(x, z) {
    const d = this.doors.get(key(x, z));
    if (!d) return;
    const from = d.hinge.rotation.y;
    d.opened = false;
    if (from) await tween(360, (t) => { d.hinge.rotation.y = from * (1 - t); }, easeOut);
    d.bar.visible = true;
  }

  /** The bar breaks (a monster forced the door). */
  breakBar(x, z) {
    const d = this.doors.get(key(x, z));
    if (d) d.bar.visible = false;
  }

  addChest({ x, z, opened, loot = [] }) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = Math.PI / 4;
    g.userData.tile = { x, z };
    this.pickables.push(g);
    this.group.add(g);
    // From the kit: the one heaped with coins when it holds a magic item.
    const rich = loot.some((l) => l !== 'potion');
    const model = this.kit ? piece(rich ? 'chest_gold' : 'chest') : null;
    if (model) {
      model.scale.setScalar(0.4);
      model.position.z = -0.14; // the model's pivot sits behind its middle
      g.add(model);
      const lid = model.getObjectByName(rich ? 'chest_gold_lid' : 'chest_lid');
      const shine = new THREE.PointLight(0xffc860, 0, 2, 2);
      shine.position.set(0, 0.45, 0);
      g.add(shine);
      if (opened) lid.rotation.x = -1.9;
      this.addToCell(x, z, g);
      return { g, lid, shine };
    }
    const wood = mat(0x7a4a24);
    const iron = mat(0x3d3a38, { metalness: 0.6, roughness: 0.5 });
    const gold = mat(0xd9aa3a, { metalness: 0.85, roughness: 0.3 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.4), wood);
    box.position.y = 0.15;
    box.castShadow = box.receiveShadow = true;
    g.add(box);
    for (const s of [-1, 1]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.31, 0.41), iron);
      band.position.set(s * 0.2, 0.15, 0);
      g.add(band);
    }
    const lid = new THREE.Group();
    lid.position.set(0, 0.3, -0.2);
    g.add(lid);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.6, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), wood);
    top.position.z = 0.2;
    top.castShadow = true;
    lid.add(top);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.03), gold);
    lock.position.set(0, 0.0, 0.41);
    lid.add(lock);
    const shine = new THREE.PointLight(0xffc860, 0, 2, 2);
    shine.position.set(0, 0.45, 0);
    g.add(shine);
    if (opened) lid.rotation.x = -1.9;
    this.addToCell(x, z, g);
    return { g, lid, shine };
  }

  /** The chest was a mimic: its prop goes, the monster's figure takes its place. */
  removeChest(x, z) {
    const c = this.chests.get(key(x, z));
    if (!c) return;
    this.chests.delete(key(x, z));
    this.group.remove(c.g);
    this.pickables = this.pickables.filter((p) => p !== c.g);
  }

  /**
   * A lair action shakes the room: the torches gutter and dust sifts down from the ceiling over
   * what the party can see, raising puffs where it lands. Reduced motion: only the guttering.
   */
  async lairShake(ms = 1500) {
    tween(ms, (t) => { this.torchDim = 1 - 0.55 * Math.sin(Math.PI * t) * (0.8 + 0.2 * Math.sin(t * 40)); }, linear)
      .then(() => { this.torchDim = 1; });
    if (calm()) return;
    const seen = [];
    for (const [k, cell] of this.cells) {
      const [x, z] = k.split(',').map(Number);
      if (cell.f > 0.6 && !this.grid.isWall(x, z) && !this.grid.chasms?.has(k)) seen.push([x, z]);
    }
    if (!seen.length) return;
    const spots = Array.from({ length: Math.min(14, seen.length) }, () => seen[Math.floor(Math.random() * seen.length)]);
    const n = spots.length * 6;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const grit = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xb8aa96, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false }));
    grit.frustumCulled = false;
    this.group.add(grit);
    const motes = Array.from({ length: n }, (_, i) => {
      const [x, z] = spots[Math.floor(i / 6)];
      return { x: x + (Math.random() - 0.5) * 0.7, z: z + (Math.random() - 0.5) * 0.7, floor: liftAt(x, z), at: Math.random() * 0.35, v: 0.8 + Math.random() * 0.5 };
    });
    spots.slice(0, 5).forEach(([x, z], i) => wait(500 + i * 90).then(() => dustFx(this.stage.scene, { x, z }, { count: 6, size: 0.4, y: liftAt(x, z) })));
    const pos = geo.attributes.position;
    await tween(ms, (t) => {
      motes.forEach((m, i) => {
        const k = Math.max(0, Math.min(1, (t - m.at) / (0.6 * m.v)));
        pos.setXYZ(i, m.x, 2.6 - (2.6 - m.floor) * k * k, m.z);
      });
      pos.needsUpdate = true;
      grit.material.opacity = 0.85 * Math.min(1, (1 - t) * 4);
    }, linear);
    this.group.remove(grit);
    geo.dispose();
    grit.material.dispose();
  }

  async openChest(x, z, { gold = false } = {}) {
    const c = this.chests.get(key(x, z));
    if (!c) return;
    if (gold) wait(250).then(() => glintFx(this.stage.scene, { x, z }, { y: liftAt(x, z) + 0.3 }));
    await tween(500, (t) => {
      c.lid.rotation.x = -1.9 * t;
      c.shine.intensity = Math.sin(t * Math.PI) * 6 + t * 1;
    }, easeOut);
    tween(1500, (t) => { c.shine.intensity = 1 - t; });
  }

  /** A stair well going down into darkness, lit up once the level is cleared. */
  addStairs({ x, z }) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    this.group.add(g);
    const pit = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.6, 0.98), mat(0x07060a));
    pit.position.y = -0.5;
    g.add(pit);
    const stone = [mat(0x5b524a), mat(0x4b433c)];
    for (let i = 0; i < 5; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.08, 0.19), stone[i % 2]);
      step.position.set(0, -0.04 - i * 0.08, 0.39 - i * 0.19);
      step.receiveShadow = true;
      g.add(step);
    }
    const rim = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.56, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2), mat(0x8a7a5a));
    rim.position.y = 0.005;
    rim.scale.setScalar(Math.SQRT2 * 0.9);
    g.add(rim);
    const light = new THREE.PointLight(0x7fb0ff, 0, 3, 1.5);
    light.position.y = 0.4;
    g.add(light);
    this.addToCell(x, z, g);
    return { light, lit: false };
  }

  /**
   * A flight of steps on a linked stair at (x, z): down into a dark well (`down`, on the upper
   * floor) or up into the wall (on the lower floor). It runs into a wall on the far side from the
   * camera, so the steps show, else toward the stair at its other end (`toward`).
   */
  addFlight({ x, z }, toward, down, grid) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const [dx, dz] = [[0, -1], [-1, 0]].find(([a, b]) => grid.isWall(x + a, z + b)) ?? [Math.sign(toward.x - x), Math.sign(toward.z - z)];
    g.rotation.y = Math.atan2(-dx, -dz);
    this.flights.set(key(x, z), { dx, dz, down });
    this.group.add(g);
    const stone = [mat(0x5b524a), mat(0x4b433c)];
    if (down) {
      const pit = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.6, 0.98), mat(0x07060a));
      pit.position.y = -0.5;
      g.add(pit);
    } else {
      const floor = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.1, 0.98), mat(0x2c2622));
      floor.position.y = -0.05;
      floor.receiveShadow = true;
      g.add(floor);
    }
    for (let i = 0; i < 5; i++) {
      const h = down ? 0.08 : 0.12 * (i + 1);
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.96, h, 0.19), stone[i % 2]);
      step.position.set(0, down ? -0.04 - i * 0.08 : h / 2, 0.39 - i * 0.19);
      step.castShadow = !down;
      step.receiveShadow = true;
      g.add(step);
    }
    this.addToCell(x, z, g);
  }

  /** The flight of steps on a linked stair: { dx, dz } toward its far end, and `down` for a well. */
  flightAt(x, z) {
    return this.flights?.get(key(x, z)) ?? null;
  }

  lightStairs() {
    if (this.stairs) this.stairs.lit = true;
  }

  /** Shows a revealed trap's pressure plate; with `sprung`, spikes shoot up. */
  async showTrap(trap) {
    const k = key(trap.x, trap.z);
    let t = this.traps.get(k);
    if (!t && trap.pit) t = this.addPit(trap, k);
    if (!t) {
      const g = new THREE.Group();
      g.position.set(trap.x, 0, trap.z);
      this.group.add(g);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.02, 0.7), mat(0x3a3430));
      plate.position.y = 0.01;
      const edge = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.46, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xff6a3a, transparent: true, opacity: 0.6, depthWrite: false }));
      edge.position.y = 0.022;
      g.add(plate, edge);
      const spikes = new THREE.Group();
      const steel = mat(0xb8bcc4, { metalness: 0.8, roughness: 0.3 });
      for (let i = 0; i < 9; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.32, 6), steel);
        spike.position.set(((i % 3) - 1) * 0.2, 0.16, (Math.floor(i / 3) - 1) * 0.2);
        spikes.add(spike);
      }
      spikes.position.y = -0.34;
      g.add(spikes);
      t = { g, edge, spikes, sprung: false, lo: -0.34 };
      const kitTrap = this.kit ? piece('floor_tile_big_spikes') : null;
      if (kitTrap) {
        // The kit's spike plate is two tiles wide: scale it to one; its spikes start sunk.
        g.remove(plate, spikes);
        kitTrap.scale.setScalar(0.25);
        kitTrap.position.y = 0.004;
        g.add(kitTrap);
        t.spikes = kitTrap.getObjectByName('spikes') ?? spikes;
        t.lo = -2.1;
        t.spikes.position.y = t.lo;
      }
      this.traps.set(k, t);
      const cell = this.addToCell(trap.x, trap.z, g);
      cell.applied = null; // apply the tile's current brightness to the new meshes
      this.fogDirty = true;
      t.cell = cell;
    }
    if (trap.rigged && !trap.sprung && !t.rigged) this.rigTrap(trap);
    if (t.pit) {
      if (trap.sprung && !t.sprung) { // the planks drop away
        t.sprung = true;
        await tween(220, (p) => { t.lid.position.y = 0.02 - p * 0.6; t.lid.rotation.z = p * 0.9; }, easeOut);
        t.lid.visible = false;
      }
      return;
    }
    if (trap.sprung && !t.sprung) {
      t.sprung = true;
      t.edge.material.color.set(0x888888);
      t.cell.mats.find((e) => e.m === t.edge.material)?.base.set(0x888888);
      await tween(110, (p) => { t.spikes.position.y = t.lo * (1 - p); }, easeOut);
    }
  }

  /** Rules 10: a pit trap: a black hole under rotten planks, its edge marked once found. */
  addPit(trap, k) {
    const g = new THREE.Group();
    g.position.set(trap.x, 0, trap.z);
    this.group.add(g);
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.78).rotateX(-Math.PI / 2), mat(0x080605, { roughness: 1 }));
    hole.position.y = 0.006;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.03, 0.76), mat(0x5a4632));
    lid.position.y = 0.02;
    const edge = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.46, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff6a3a, transparent: true, opacity: 0.6, depthWrite: false }));
    edge.position.y = 0.04;
    g.add(hole, lid, edge);
    const t = { g, edge, lid, pit: true, sprung: false };
    this.traps.set(k, t);
    const cell = this.addToCell(trap.x, trap.z, g);
    cell.applied = null;
    this.fogDirty = true;
    t.cell = cell;
    return t;
  }

  /** Rules 8: a disarmed trap, reset against the monsters: its edge turns from red to green. */
  rigTrap(trap) {
    const t = this.traps.get(key(trap.x, trap.z));
    if (!t || t.sprung) return;
    t.rigged = true;
    t.edge.material.color.set(0x6ad06a);
    t.cell?.mats.find((e) => e.m === t.edge.material)?.base.set(0x6ad06a);
  }

  /** Lower the spikes again after the victim has moved on. */
  async retractTrap(trap) {
    const t = this.traps.get(key(trap.x, trap.z));
    if (t && !t.pit) await tween(500, (p) => { t.spikes.position.y = t.lo * p; }, easeInOut);
  }

  /**
   * The rune circle of area spell `id` round tile `at` (`radius` tiles out), or none with no
   * `at`. Drawn under the figures, over the floor's tint.
   */
  setRunes(at, radius = 1, id = null) {
    if (!at) {
      this.runes.visible = false;
      return;
    }
    const size = (radius + 0.5) * 2;
    this.runes.scale.set(size, 1, size);
    this.runes.position.set(at.x, liftAt(at.x, at.z) + 0.02, at.z);
    this.runes.material.color.setHex(RUNE_COLORS[id] ?? 0xffd36b);
    this.runes.userData.alpha = 0.8;
    this.runes.visible = this.overlaysOn !== false;
  }

  /** A monster's area spell: its circle flares up where it will land, then the spell follows. */
  async flashRunes(at, radius, id) {
    this.setRunes(at, radius, id);
    keepAwake(700);
    await tween(calm() ? 350 : 550, (t) => {
      const s = (radius + 0.5) * 2 * (calm() ? 1 : 0.6 + 0.4 * easeOut(Math.min(1, t * 2)));
      this.runes.scale.set(s, 1, s);
      this.runes.userData.alpha = 0.9 * Math.min(1, t * 4);
    }, linear);
    this.setRunes(null);
  }

  clearHighlights() {
    this.setRunes(null);
    for (const l of this.layers) l.clear();
  }

  /** Show or hide the tile highlights and threats (not ice) without forgetting them: photo mode. */
  /** Reflections in the water on or off (reflect.js; with the Glow setting). */
  setReflections(on) {
    if (!on || !this.grid.water?.size) {
      this.mirror?.dispose();
      this.mirror = null;
      return;
    }
    if (this.mirror) return;
    const tiles = [...this.grid.water].map((k) => k.split(',').map(Number));
    const floor = [];
    const at = new THREE.Vector3();
    this.group.updateWorldMatrix(true, true);
    this.group.traverse((o) => { if (o.isMesh && o.getWorldPosition(at).y < 0.03) floor.push(o); });
    this.mirror = new WaterMirror(this.group, tiles, rippleMap(), this.stage.renderer, floor);
  }

  /** `unit` steps from tile `a` to `b`: it may leave footprints and kick what lies there. */
  tread(unit, a, b) {
    this.tracks.step(unit, a, b);
    if (!unit.flies) this.clutter?.kick(a, b);
  }

  showOverlays(on) {
    this.overlaysOn = on;
    if (!on) this.runes.visible = false;
    for (const l of [...this.layers, this.threatMelee, this.threatRanged, this.threatFar, this.spot, this.heard]) l.material.visible = on;
  }

  dispose() {
    this.group.traverse((o) => {
      o.geometry?.dispose();
      if (o.isMesh) o.material.dispose();
    });
    this.stage.tickers.delete(this.tick);
    this.riseId = -1;
    this.life?.dispose();
    this.tracks.dispose();
    this.mirror?.dispose();
    rising.clear();
    this.motes.dispose();
    this.wisps.dispose();
  }
}
