// Loose bits on the floor, drawn only: pebbles, old bones and shards of broken pots. A figure
// walking through kicks them aside and a blast throws them out; they roll, slow and stop, and
// stay where they end up until the room is left. Each kind is one instanced mesh, every piece
// dimmed by the fog of the tile it lies on. Reduced motion leaves them where they lie.

import * as THREE from 'three';
import { key } from '../game/grid.js';
import { calm, keepAwake } from './tween.js';

const KINDS = {
  pebble: { geo: () => new THREE.DodecahedronGeometry(0.055, 0).scale(1, 0.7, 1), color: 0x54504b, lift: 0.032, roll: true },
  bone: {
    geo: () => new THREE.CapsuleGeometry(0.022, 0.2, 2, 6).rotateZ(Math.PI / 2), // lying along x
    color: 0xb8ad94, lift: 0.022, roll: true,
  },
  shard: {
    geo: () => new THREE.CylinderGeometry(0.11, 0.1, 0.08, 8, 1, true, 0, 1.8),
    color: 0x84462b, lift: 0.04, roll: false, side: THREE.DoubleSide,
  },
};
const CHANCE = 0.13; // of a floor tile having a little heap
const DRAG = 3.2; // how fast a rolling piece slows
const REACH = 0.48; // how near a step a piece must be to be kicked

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const one = new THREE.Vector3(1, 1, 1);
const none = new THREE.Vector3(0, 0, 0);
const at = new THREE.Vector3();
const col = new THREE.Color();

export class Clutter {
  /** `board` gives the grid, its fog cells and the group to draw into; `liftAt` the floor's height. */
  constructor(board, liftAt) {
    this.board = board;
    this.liftAt = liftAt;
    const g = board.grid;
    const blocked = (x, z) => {
      const k = key(x, z);
      return !g.inBounds(x, z) || g.isWall(x, z) || g.water?.has(k) || g.chasms?.has(k) || g.links?.has(k)
        || g.doors?.has(k) || g.props?.has(k) || g.chests?.has(k) || g.gates?.has(k)
        || g.stairs?.some((s) => s.x === x && s.z === z);
    };
    this.blocked = blocked;
    this.pieces = [];
    for (let z = 0; z < g.height; z++) {
      for (let x = 0; x < g.width; x++) {
        if (blocked(x, z) || Math.random() > CHANCE) continue;
        const n = 3 + Math.floor(Math.random() * 4);
        const cx = (Math.random() - 0.5) * 0.4;
        const cz = (Math.random() - 0.5) * 0.4;
        for (let i = 0; i < n; i++) {
          const r = Math.random();
          const kind = r < 0.5 ? 'pebble' : r < 0.78 ? 'bone' : 'shard';
          this.pieces.push({
            kind, x: x + cx + (Math.random() - 0.5) * 0.3, z: z + cz + (Math.random() - 0.5) * 0.3,
            yaw: Math.random() * Math.PI * 2, roll: Math.random() * Math.PI * 2,
            scale: 0.75 + Math.random() * 0.5, vx: 0, vz: 0, f: -1, y: NaN,
          });
        }
      }
    }
    this.meshes = {};
    for (const [kind, spec] of Object.entries(KINDS)) {
      const list = this.pieces.filter((p) => p.kind === kind);
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(spec.geo(), new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.85, side: spec.side ?? THREE.FrontSide,
      }), list.length);
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // the pieces roll; the board is always in view anyway
      list.forEach((p, i) => { p.mesh = mesh; p.i = i; p.base = new THREE.Color(spec.color).multiplyScalar(0.8 + Math.random() * 0.35); });
      mesh.setColorAt(0, col.set(0)); // makes the instance colours
      board.group.add(mesh);
      this.meshes[kind] = mesh;
    }
    this.moving = false;
  }

  /** A figure steps from tile `a` to `b`: pieces near where it treads are kicked ahead and aside. */
  kick(a, b) {
    if (calm()) return;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    for (const p of this.pieces) {
      // The nearest point of the step to the piece.
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (len * len)));
      const nx = p.x - (a.x + dx * t);
      const nz = p.z - (a.z + dz * t);
      const d = Math.hypot(nx, nz);
      if (d > REACH) continue;
      const push = (1 - d / REACH) * (0.9 + Math.random() * 0.6);
      const side = d > 0.001 ? 1 / d : 0;
      p.vx += (nx * side * 0.9 + (dx / len) * 0.5) * push * 1.6;
      p.vz += (nz * side * 0.9 + (dz / len) * 0.5) * push * 1.6;
      p.delay = t * 0.2; // kicked as the foot gets there
      this.moving = true;
    }
  }

  /** A blast over `tiles`: what lies there and next to it is thrown out from their middle. */
  blast(tiles) {
    if (calm() || !tiles.length) return;
    const cx = tiles.reduce((s, t) => s + t.x, 0) / tiles.length;
    const cz = tiles.reduce((s, t) => s + t.z, 0) / tiles.length;
    const span = Math.max(1, ...tiles.map((t) => Math.hypot(t.x - cx, t.z - cz))) + 1;
    for (const p of this.pieces) {
      const nx = p.x - cx;
      const nz = p.z - cz;
      const d = Math.hypot(nx, nz);
      if (d > span) continue;
      const push = (1 - d / span) * 3.2 + 0.5;
      const a = d > 0.01 ? Math.atan2(nz, nx) : Math.random() * Math.PI * 2;
      p.vx += Math.cos(a) * push * (0.7 + Math.random() * 0.6);
      p.vz += Math.sin(a) * push * (0.7 + Math.random() * 0.6);
      p.delay = d * 0.04;
      this.moving = true;
    }
  }

  tick(dt) {
    const cells = this.board.cells;
    dt = Math.min(dt, 0.05);
    let moving = false;
    for (const p of this.pieces) {
      let dirty = false;
      if (p.vx || p.vz) {
        if (p.delay > 0) {
          p.delay -= dt;
          moving = true;
        } else {
          const nx = p.x + p.vx * dt;
          const nz = p.z + p.vz * dt;
          // Walls and the water stop it: it bounces back off them.
          if (this.blocked(Math.round(nx), Math.round(p.z))) p.vx *= -0.4;
          else p.x = nx;
          if (this.blocked(Math.round(p.x), Math.round(nz))) p.vz *= -0.4;
          else p.z = nz;
          const speed = Math.hypot(p.vx, p.vz);
          if (KINDS[p.kind].roll) p.roll += speed * dt * 18;
          p.yaw += (p.kind === 'shard' ? speed * dt * 4 : 0);
          const slow = Math.exp(-DRAG * dt);
          p.vx *= slow;
          p.vz *= slow;
          if (speed < 0.03) p.vx = p.vz = 0;
          else moving = true;
          dirty = true;
        }
      }
      const tx = Math.round(p.x);
      const tz = Math.round(p.z);
      const f = cells.get(key(tx, tz))?.f ?? 0;
      const y = this.liftAt(tx, tz) + KINDS[p.kind].lift * p.scale;
      if (f !== p.f) {
        p.f = f;
        p.mesh.setColorAt(p.i, col.copy(p.base).multiplyScalar(f));
        p.mesh.instanceColor.needsUpdate = true;
        dirty = true;
      }
      if (y !== p.y) {
        p.y = y;
        dirty = true;
      }
      if (!dirty) continue;
      // A rolling piece turns about the axis across its way; a bone lies along its yaw.
      e.set(0, p.yaw, 0, 'YXZ');
      if (KINDS[p.kind].roll) e.x = p.roll;
      q.setFromEuler(e);
      at.set(p.x, p.y, p.z);
      m4.compose(at, q, f > 0.005 ? one.clone().multiplyScalar(p.scale) : none);
      p.mesh.setMatrixAt(p.i, m4);
      p.mesh.instanceMatrix.needsUpdate = true;
    }
    if (moving) keepAwake(100);
    this.moving = moving;
  }
}
