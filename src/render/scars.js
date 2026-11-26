// Damage on the walls, drawn only: a blast of fire or lightning beside a wall blackens it with
// soot and cracks the stone, and a thunderclap (Shatter, Thunderwave) cracks it without the soot.
// Each is a decal on the wall's face, on the walls facing the camera (the others show their
// backs), dimmed with the fog of the floor tile in front of it. A second blast on the same face
// darkens it. They stay until the room is left.

import * as THREE from 'three';
import { key } from '../game/grid.js';

const VARIANTS = 3;
const MAX = 80;
const GEO = new THREE.PlaneGeometry(1, 1);
const FACES = [[-1, 0], [0, -1]]; // the walls at -x and -z of a floor tile face the camera

const maps = { soot: [], crack: [] };

/** A crack: a jagged line from a start point, splitting once or twice. */
function crack(g, x, y, angle, len, width, r) {
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(x, y);
  let a = angle;
  for (let s = 0; s < len; s += 9) {
    a += (r() - 0.5) * 0.9;
    x += Math.cos(a) * 9;
    y += Math.sin(a) * 9;
    g.lineTo(x, y);
    if (width > 1.4 && r() < 0.12) {
      g.stroke();
      crack(g, x, y, a + (r() < 0.5 ? -1 : 1) * (0.6 + r() * 0.5), (len - s) * 0.5, width * 0.6, r);
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(x, y);
    }
  }
  g.stroke();
}

/** Soot rising from the wall's foot with cracks through it, or the cracks alone. */
function texture(kind, v) {
  if (maps[kind][v]) return maps[kind][v];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  let seed = 7 + v * 131 + (kind === 'crack' ? 977 : 0);
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  if (kind === 'soot') {
    // Blotches, thickest low down where the fire licked the stone.
    for (let i = 0; i < 9; i++) {
      const x = 20 + r() * 88;
      const y = 70 + r() * 58;
      const rad = 28 + r() * 34;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
    }
    // Streaks where the smoke went up.
    for (let i = 0; i < 5; i++) {
      const x = 24 + r() * 80;
      const grad = g.createLinearGradient(0, 128, 0, 20 + r() * 40);
      grad.addColorStop(0, 'rgba(255,255,255,0.35)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(x - 4 - r() * 6, 0, 8 + r() * 10, 128);
    }
  }
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineCap = g.lineJoin = 'round';
  const n = kind === 'crack' ? 3 : 2;
  for (let i = 0; i < n; i++) {
    crack(g, 30 + r() * 68, 40 + r() * 60, r() * Math.PI * 2, 40 + r() * 40, 2.6, r);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  maps[kind][v] = t;
  return t;
}

export class Scars {
  /** `board` gives the grid, the group to draw into and its fog cells; `floorAt` a tile's floor height. */
  constructor(board, floorAt) {
    this.board = board;
    this.floorAt = floorAt;
    this.faces = new Map(); // `x,z,dx,dz` (the floor tile and the way to the wall) -> { mesh, wall }
  }

  /**
   * A blast over `tiles` ({x, z}): the walls beside them are scarred. `kind` is 'soot' (fire and
   * lightning, with cracks) or 'crack' (thunder alone); `strength` 0..1, a single bolt less.
   */
  blast(tiles, kind = 'soot', strength = 1) {
    const g = this.board.grid;
    const seen = new Set();
    for (const t of tiles) {
      const x = Math.round(t.x);
      const z = Math.round(t.z);
      if (!g.inBounds(x, z) || g.isWall(x, z) || seen.has(key(x, z))) continue;
      seen.add(key(x, z));
      for (const [dx, dz] of FACES) {
        const wx = x + dx;
        const wz = z + dz;
        if (!g.inBounds(wx, wz) || !g.isWall(wx, wz) || g.doors.has(key(wx, wz))) continue;
        this.scar(x, z, dx, dz, kind, strength);
      }
    }
    this.board.fogDirty = true;
  }

  scar(x, z, dx, dz, kind, strength) {
    const k = `${x},${z},${dx},${dz}`;
    const alpha = kind === 'soot' ? 0.5 + 0.38 * strength : 0.62 + 0.3 * strength;
    const old = this.faces.get(k);
    if (old) {
      // Blasted again: the stone darkens.
      const m = old.mesh.material;
      m.opacity = Math.min(0.95, m.opacity + alpha * 0.35);
      const cell = this.board.cells.get(key(x, z));
      if (cell) cell.applied = null;
      return;
    }
    const kit = !!this.board.kit;
    const face = (kit ? 0.75 : 0.5) - 0.012; // the wall's face, from the floor tile's middle
    const high = kit ? 0.92 : 0.5;
    const mesh = new THREE.Mesh(GEO, new THREE.MeshBasicMaterial({
      map: texture(kind, Math.floor(Math.random() * VARIANTS)), color: kind === 'soot' ? 0x0d0a08 : 0x0a0806,
      transparent: true, opacity: alpha, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    }));
    const base = this.floorAt(x, z) - (kit ? 0 : 0.05);
    mesh.scale.set(0.9 + Math.random() * 0.12, high, 1);
    if (Math.random() < 0.5) mesh.scale.x *= -1; // mirrored now and then
    mesh.rotation.y = dx ? Math.PI / 2 : 0; // facing +x or +z, back at the room
    mesh.position.set(x + dx * face + (dz ? (Math.random() - 0.5) * 0.1 : 0), base + high / 2, z + dz * face + (dx ? (Math.random() - 0.5) * 0.1 : 0));
    mesh.renderOrder = 1;
    this.board.group.add(mesh);
    this.board.addToCell(x, z, mesh);
    this.faces.set(k, { mesh, wall: key(x + dx, z + dz) });
    if (this.faces.size > MAX) this.remove(this.faces.keys().next().value);
  }

  /** The wall at (x, z) is gone (a secret door found): its scars go with it. */
  clear(x, z) {
    const w = key(x, z);
    for (const [k, f] of [...this.faces]) if (f.wall === w) this.remove(k);
  }

  remove(k) {
    const f = this.faces.get(k);
    if (!f) return;
    this.faces.delete(k);
    this.board.group.remove(f.mesh);
    const [x, z] = k.split(',');
    const cell = this.board.cells.get(`${x},${z}`);
    if (cell) {
      cell.objects = cell.objects.filter((o) => o !== f.mesh);
      cell.mats = cell.mats.filter(({ m }) => m !== f.mesh.material);
    }
    f.mesh.material.dispose();
  }
}
