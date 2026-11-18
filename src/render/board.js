// Dungeon geometry plus tile highlight layers.

import * as THREE from 'three';
import { key } from '../game/grid.js';
import { tween, easeOut, easeInOut } from './tween.js';
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
    tiles.forEach((t, i) => {
      let m = this.meshes[i];
      if (!m) {
        m = new THREE.Mesh(this.geometry, this.material);
        m.renderOrder = 2;
        this.parent.add(m);
        this.meshes.push(m);
      }
      m.position.set(t.x, this.y, t.z);
      m.visible = true;
    });
    for (let i = tiles.length; i < this.meshes.length; i++) this.meshes[i].visible = false;
  }

  clear() {
    this.set([]);
  }
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

const overlay = (color, opacity) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });

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
          else if (!grid.stairs.some((s) => s.x === x && s.z === z)) this.addKitFloor(x, z);
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
        } else if (!grid.stairs.some((s) => s.x === x && s.z === z)) {
          const tile = new THREE.Mesh(floorGeo, floorMats[(x + z) % 2]);
          tile.position.set(x, -0.1, z);
          tile.receiveShadow = true;
          this.group.add(tile);
          this.addToCell(x, z, tile);
        }
      }
    }

    this.torches = [];
    const torches = torchSpots(grid);
    for (const spot of torches) this.addTorch(spot);
    if (this.kit) for (const spot of bannerSpots(grid, torches)) this.addBanner(spot);

    this.doors = new Map();
    for (const d of grid.doors.values()) this.doors.set(key(d.x, d.z), { ...this.addDoor(d), opened: d.open });
    this.candles = [];
    for (const p of grid.props.values()) this.addProp(p);
    this.chests = new Map();
    this.pickables = []; // props the mouse can click (chests), tagged with userData.tile
    for (const c of grid.chests.values()) this.chests.set(key(c.x, c.z), this.addChest(c));
    this.traps = new Map();
    for (const s of grid.stairs) this.stairs = this.addStairs(s);

    this.tick = (t, dt) => {
      if (this.fogDirty) this.tickFog(dt);
      if (this.fadeSources) this.tickFade(dt);
      for (const { light, seed, cell } of this.torches) {
        light.intensity = (5.5 + Math.sin(t * 9 + seed) * 0.6 + Math.sin(t * 23 + seed * 2) * 0.4) * cell.f;
      }
      for (const { light, seed, cell } of this.candles) {
        light.intensity = (1.1 + Math.sin(t * 11 + seed) * 0.15) * cell.f;
      }
      if (this.stairs?.lit) this.stairs.light.intensity = 3 + Math.sin(t * 3) * 0.8;
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
  }

  // --- fog of war & wall fading ----------------------------------------------
  /** Registers objects standing on a tile, giving each mesh its own material. */
  addToCell(x, z, ...objects) {
    const k = key(x, z);
    let cell = this.cells.get(k);
    if (!cell) {
      cell = { objects: [], mats: [], f: 1, target: 1 };
      this.cells.set(k, cell);
    }
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
  setVision(visible, { snap = false } = {}) {
    for (const k of visible) this.explored.add(k);
    for (const [k, cell] of this.cells) {
      cell.target = visible.has(k) ? 1 : this.explored.has(k) ? REMEMBERED : 0;
      if (snap) cell.f = cell.target;
    }
    this.fogDirty = true;
    if (snap) this.tickFog(0);
  }

  isExplored(x, z) {
    return this.explored.has(key(x, z));
  }

  tickFog(dt) {
    let moving = false;
    const k = Math.min(1, dt * 5);
    for (const cell of this.cells.values()) {
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
        this.candles.push({ light, seed: hash(x, z, 8) * 10, cell: null });
      }
    } else {
      if (!kitPiece('column', 0)) box(0.5, KIT_WALL * 1.5, 0x6f6862);
      else parts[0].scale.set(0.6, 1.1, 0.6); // 1.4 tall in the kit: about one and a half walls
    }
    this.group.add(...parts);
    const cell = this.addToCell(x, z, ...parts);
    for (const c of this.candles) c.cell ??= cell;
    if (kind === 'column') {
      const meshes = [];
      for (const p of parts) p.traverse((o) => { if (o.isMesh) meshes.push(o); });
      this.walls.push({ x, z, meshes, opacity: 1 });
    }
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
    const meshes = [];
    for (const p of parts) p.traverse((o) => { if (o.isMesh) meshes.push(o); });
    this.walls.push({ x, z, meshes, opacity: 1 });
  }

  /** A hanging banner on a wall facing the camera. */
  addBanner({ x, z, dx, dz }) {
    const b = piece('banner_red');
    if (!b) return;
    b.scale.set(0.42, KIT_WALL / 4, 0.5);
    b.position.set(x, 0, z);
    b.rotation.y = Math.atan2(dx, dz);
    this.group.add(b);
    this.addToCell(x, z, b);
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
    this.torches.push({ light, seed: x * 7.3 + z * 3.1, cell });
  }

  /** Stone frame and a wooden door that swings open on its hinge. */
  addDoor({ x, z, open }) {
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
    if (open) hinge.rotation.y = -1.7;
    this.addToCell(x, z, g);
    return { hinge };
  }

  async openDoor(x, z) {
    const d = this.doors.get(key(x, z));
    if (!d || d.opened) return;
    d.opened = true;
    await tween(420, (t) => { d.hinge.rotation.y = -1.7 * t; }, easeOut);
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

  async openChest(x, z) {
    const c = this.chests.get(key(x, z));
    if (!c) return;
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

  lightStairs() {
    if (this.stairs) this.stairs.lit = true;
  }

  /** Shows a revealed trap's pressure plate; with `sprung`, spikes shoot up. */
  async showTrap(trap) {
    const k = key(trap.x, trap.z);
    let t = this.traps.get(k);
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
    if (trap.sprung && !t.sprung) {
      t.sprung = true;
      t.edge.material.color.set(0x888888);
      t.cell.mats.find((e) => e.m === t.edge.material)?.base.set(0x888888);
      await tween(110, (p) => { t.spikes.position.y = t.lo * (1 - p); }, easeOut);
    }
  }

  /** Lower the spikes again after the victim has moved on. */
  async retractTrap(trap) {
    const t = this.traps.get(key(trap.x, trap.z));
    if (t) await tween(500, (p) => { t.spikes.position.y = t.lo * p; }, easeInOut);
  }

  clearHighlights() {
    for (const l of this.layers) l.clear();
  }

  dispose() {
    this.group.traverse((o) => {
      o.geometry?.dispose();
      if (o.isMesh) o.material.dispose();
    });
    this.stage.tickers.delete(this.tick);
  }
}
