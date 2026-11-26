// Small signs of life in a room, drawn only (the rules never see them): banners and cobwebs
// that stir when someone passes, water dripping from the ceiling into pools, and now and then a
// rat scurrying along a wall in the part of the map out of sight. Reduced motion keeps all of
// it still: no drips, no rats, no swaying.

import * as THREE from 'three';
import { key } from '../game/grid.js';
import { calm } from './tween.js';

const PASS = 1.6; // how near (in tiles) a moving figure stirs a banner or a web
const REMEMBERED = 0.3; // the fog's level for explored tiles out of sight (board.js)
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

let webMap = null;
/** A corner cobweb: threads fanning from the top-left corner, crossed by sagging arcs. */
function web() {
  if (webMap) return webMap;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(235,235,240,0.75)';
  g.lineWidth = 1.2;
  const spokes = 7;
  for (let i = 0; i < spokes; i++) {
    const a = (i / (spokes - 1)) * (Math.PI / 2);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * 128, Math.sin(a) * 128);
    g.stroke();
  }
  for (let r = 22; r < 128; r += 19) {
    g.beginPath();
    for (let i = 0; i < spokes; i++) {
      const a = (i / (spokes - 1)) * (Math.PI / 2);
      const sag = i > 0 && i < spokes ? 0.9 : 1;
      const x = Math.cos(a) * r * sag;
      const y = Math.sin(a) * r * sag;
      if (i === 0) g.moveTo(x, y);
      else g.quadraticCurveTo(Math.cos(a - 0.13) * r * 0.8, Math.sin(a - 0.13) * r * 0.8, x, y);
    }
    g.stroke();
  }
  webMap = new THREE.CanvasTexture(c);
  return webMap;
}

/** A small rat: a body, a head and a tail, dark and drawn without light. */
function ratMesh() {
  const mat = new THREE.MeshBasicMaterial({ color: 0x0c0908, transparent: true, opacity: 0 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat);
  body.scale.set(1, 0.75, 1.7);
  body.position.y = 0.045;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 6).rotateX(Math.PI / 2), mat);
  head.position.set(0, 0.045, 0.1);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.008, 0.14, 4).rotateX(Math.PI / 2), mat);
  tail.position.set(0, 0.03, -0.14);
  g.add(body, head, tail);
  g.userData.mat = mat;
  g.visible = false;
  return g;
}

export class Life {
  /** `board` gives the grid, fog cells, banners, the group and the figures (fadeSources). */
  constructor(board, liftAt) {
    this.board = board;
    this.liftAt = liftAt;
    this.webs = [];
    this.drops = [];
    this.nextDrip = 1 + Math.random() * 2;
    this.nextRat = 6 + Math.random() * 8;
    this.rat = null;
    this.last = new WeakMap(); // figure position -> where it was last frame
    this.addWebs();
    this.water = [...board.grid.water ?? []].map((k) => k.split(',').map(Number));
  }

  /** Cobwebs high in a few corners facing the camera (walls on the -x and -z sides). */
  addWebs() {
    const { grid, group } = this.board;
    const spots = [];
    for (let z = 1; z < grid.height; z++) {
      for (let x = 1; x < grid.width; x++) {
        if (grid.isWall(x, z) || !grid.isWall(x - 1, z) || !grid.isWall(x, z - 1)) continue;
        if (grid.links?.has(key(x, z)) || grid.chasms?.has(key(x, z))) continue;
        spots.push({ x, z });
      }
    }
    // A few of them, not all: about two in five, at most eight a room.
    const pick = spots.filter(() => Math.random() < 0.4).slice(0, 8);
    for (const { x, z } of pick) {
      const size = 0.45 + Math.random() * 0.25;
      const pivot = new THREE.Group();
      pivot.position.set(x - 0.5, this.liftAt(x, z) + 0.97, z - 0.5);
      // A triangle spanning the corner, from the top of one wall face to the other's.
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, size, -size * 0.55, 0.01, 0.01, -size * 0.55, size], 3));
      // UVs map the texture's top-left (the threads' root) to the corner.
      geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0], 2));
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: web(), transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide,
      }));
      pivot.add(mesh);
      group.add(pivot);
      this.board.addToCell(x, z, pivot);
      this.webs.push({ pivot, x, z, kick: 0, ph: Math.random() * 6.3 });
    }
  }

  /** Figures that moved since last frame, as {x, z}. */
  movers() {
    const out = [];
    for (const p of this.board.fadeSources?.() ?? []) {
      const was = this.last.get(p);
      if (was && (Math.abs(was.x - p.x) > 0.002 || Math.abs(was.z - p.z) > 0.002)) out.push(p);
      this.last.set(p, { x: p.x, z: p.z });
    }
    return out;
  }

  /** How strongly something at (x, z) is stirred by the figures moving past. */
  stir(movers, x, z) {
    let s = 0;
    for (const p of movers) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < PASS) s = Math.max(s, 1 - d / PASS);
    }
    return s;
  }

  tick(t, dt) {
    if (calm()) {
      for (const b of this.board.banners) b.pivot.rotation.x = 0;
      for (const w of this.webs) w.pivot.rotation.set(0, 0, 0);
      if (this.rat) this.rat.mesh.visible = false;
      return;
    }
    const movers = this.movers();
    const decay = Math.exp(-dt * 1.4);
    for (const b of this.board.banners) {
      b.kick = Math.max(b.kick * decay, this.stir(movers, b.x, b.z));
      // Hanging still but for a draught, swinging out from the wall when someone passes.
      const amp = 0.012 + 0.14 * b.kick;
      b.pivot.rotation.x = -amp * (0.5 + 0.5 * Math.sin(t * 2.6 + b.ph));
    }
    for (const w of this.webs) {
      w.kick = Math.max(w.kick * decay, this.stir(movers, w.x, w.z));
      const a = (0.02 + 0.12 * w.kick) * Math.sin(t * 3.1 + w.ph);
      w.pivot.rotation.set(a, 0, -a);
    }
    this.tickDrips(t, dt);
    this.tickRat(t, dt);
  }

  /** Water dripping from the ceiling into a pool in sight: a falling bead, then a ring. */
  tickDrips(t, dt) {
    const { cells, group } = this.board;
    this.nextDrip -= dt;
    if (this.nextDrip <= 0 && this.water.length) {
      this.nextDrip = 0.9 + Math.random() * 1.8;
      const [x, z] = this.water[Math.floor(Math.random() * this.water.length)];
      if ((cells.get(key(x, z))?.f ?? 0) > 0.6) {
        const bead = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), new THREE.MeshBasicMaterial({ color: 0xa8d0e4, transparent: true, opacity: 0.8 }));
        bead.scale.set(1, 2.2, 1);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xc8e4f0, transparent: true, opacity: 0, depthWrite: false }));
        const ox = x + (Math.random() - 0.5) * 0.6;
        const oz = z + (Math.random() - 0.5) * 0.6;
        const floor = this.liftAt(x, z) + 0.045;
        bead.position.set(ox, 1.5, oz);
        ring.position.set(ox, floor, oz);
        ring.visible = false;
        group.add(bead, ring);
        this.drops.push({ bead, ring, born: t, floor });
      }
    }
    const FALL = 0.5;
    const SPREAD = 0.9;
    this.drops = this.drops.filter((d) => {
      const age = t - d.born;
      if (age < FALL) {
        const k = age / FALL;
        d.bead.position.y = 1.5 - (1.5 - d.floor) * k * k;
        return true;
      }
      d.bead.visible = false;
      d.ring.visible = true;
      const k = (age - FALL) / SPREAD;
      if (k >= 1) {
        group.remove(d.bead, d.ring);
        for (const m of [d.bead, d.ring]) { m.geometry.dispose(); m.material.dispose(); }
        return false;
      }
      d.ring.scale.setScalar(0.05 + 0.3 * k);
      d.ring.material.opacity = 0.55 * (1 - k);
      return true;
    });
  }

  /**
   * Now and then a rat runs along the foot of a wall where the heroes can't see now (explored,
   * out of sight), three tiles, and is gone.
   */
  tickRat(t, dt) {
    const { grid, cells, group } = this.board;
    if (this.rat) {
      const r = this.rat;
      const k = (t - r.born) / r.time;
      if (k >= 1) {
        r.mesh.visible = false;
        this.rat = null;
        return;
      }
      const x = r.from.x + (r.to.x - r.from.x) * k;
      const z = r.from.z + (r.to.z - r.from.z) * k;
      const f = cells.get(key(Math.round(x), Math.round(z)))?.f ?? 0;
      // Only where it's still out of sight: a rat in plain view would pass for a foe.
      const fade = Math.min(1, k * 6, (1 - k) * 6);
      r.mesh.userData.mat.opacity = f <= REMEMBERED + 0.05 ? fade * 0.9 : 0;
      r.mesh.position.set(x, this.liftAt(x, z) + Math.abs(Math.sin(t * 40)) * 0.008, z);
      return;
    }
    this.nextRat -= dt;
    if (this.nextRat > 0) return;
    this.nextRat = 8 + Math.random() * 12;
    // A run of three floor tiles out of sight along a wall.
    const out = (x, z) => !grid.isWall(x, z) && cells.get(key(x, z))?.target === REMEMBERED && !grid.water?.has(key(x, z));
    const runs = [];
    for (const [k, cell] of cells) {
      if (cell.target !== REMEMBERED) continue;
      const [x, z] = k.split(',').map(Number);
      if (!out(x, z)) continue;
      for (const [dx, dz] of DIRS4) {
        if (!grid.isWall(x - dz, z + dx) && !grid.isWall(x + dz, z - dx)) continue; // a wall alongside
        if (out(x + dx, z + dz) && out(x + 2 * dx, z + 2 * dz)) runs.push({ x, z, dx, dz });
      }
    }
    if (!runs.length) return;
    const run = runs[Math.floor(Math.random() * runs.length)];
    if (!this.ratMesh) {
      this.ratMesh = ratMesh();
      group.add(this.ratMesh);
    }
    // Hugging the wall: shifted toward it.
    const side = grid.isWall(run.x - run.dz, run.z + run.dx) ? 1 : -1;
    const sx = -run.dz * side * 0.32;
    const sz = run.dx * side * 0.32;
    const mesh = this.ratMesh;
    mesh.visible = true;
    mesh.rotation.y = Math.atan2(run.dx, run.dz);
    this.rat = {
      mesh, born: t, time: 1.1 + Math.random() * 0.4,
      from: { x: run.x + sx - run.dx * 0.4, z: run.z + sz - run.dz * 0.4 },
      to: { x: run.x + 2 * run.dx + sx + run.dx * 0.4, z: run.z + 2 * run.dz + sz + run.dz * 0.4 },
    };
  }

  dispose() {
    for (const d of this.drops) for (const m of [d.bead, d.ring]) { m.geometry.dispose(); m.material.dispose(); }
    this.drops = [];
  }
}
