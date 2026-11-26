// Footprints, drawn only: a figure that waded through water leaves wet prints for a few steps,
// one that walked through blood (or an ooze's puddle) leaves red (or green) ones. Wet prints dry
// over a couple of turns, blood over a few more (`age`, once a turn). Fliers and oozes leave none.

import * as THREE from 'three';
import { key } from '../game/grid.js';
import { tween } from './tween.js';

const MAX = 120;
const GEO = new THREE.PlaneGeometry(0.17, 0.3).rotateX(-Math.PI / 2);

// What each kind of print looks like, how many steps a figure keeps leaving them and for how
// many turns they last.
const KINDS = {
  wet: { color: 0x020406, alpha: 0.62, steps: 4, turns: 2 },
  blood: { color: 0x5c0609, alpha: 0.85, steps: 5, turns: 5 },
  ooze: { color: 0x3f7a1c, alpha: 0.75, steps: 4, turns: 4 },
};

let soleMap = null;
/** A sole: the ball of the foot and the heel, soft edged. */
function sole() {
  if (soleMap) return soleMap;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 64;
  const g = c.getContext('2d');
  const blot = (x, y, rx, ry) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.save();
    g.translate(x, y);
    g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
    g.translate(-x, -y);
    g.beginPath();
    g.arc(x, y, Math.max(rx, ry), 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  blot(16, 20, 12, 17); // the ball (toward -z of the plane, the way the foot points)
  blot(16, 48, 9, 11); // the heel
  soleMap = new THREE.CanvasTexture(c);
  return soleMap;
}

export class Tracks {
  /** `board` gives the grid, the group to draw into, its fog cells and its marks. */
  constructor(board, liftAt) {
    this.board = board;
    this.liftAt = liftAt;
    this.prints = []; // { mesh, k, left, turns, alpha }, oldest first
    this.feet = new Map(); // unit -> { kind, steps, left (which foot) }
  }

  /** Whether `unit` leaves prints at all. */
  static walks(unit) {
    return !unit.flies && unit.code !== 'j' && unit.code !== 'i' && unit.code !== 'c';
  }

  /**
   * `unit` steps from tile `a` to tile `b`: what it walked through now sticks to its feet, and
   * what was on them is left along the way.
   */
  step(unit, a, b) {
    if (!Tracks.walks(unit)) return;
    const grid = this.board.grid;
    const bk = key(Math.round(b.x), Math.round(b.z));
    const ak = key(Math.round(a.x), Math.round(a.z));
    let feet = this.feet.get(unit);
    // Leaving the water or a puddle, it carries some along.
    if (grid.water?.has(ak) && !grid.water.has(bk)) feet = { kind: 'wet', steps: KINDS.wet.steps, left: false };
    const mark = this.board.marks?.byTile.get(ak)?.userData.kind;
    if ((mark === 'blood' || mark === 'ooze') && this.board.marks.byTile.get(bk)?.userData.kind !== mark) {
      feet = { kind: mark, steps: KINDS[mark].steps, left: false };
    }
    if (grid.water?.has(bk)) feet = null; // the water washes them clean
    if (!feet || feet.steps <= 0) {
      this.feet.delete(unit);
      return;
    }
    this.feet.set(unit, feet);
    // Two prints a step, left and right of the line walked.
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const heading = Math.atan2(dx, dz);
    for (const t of [0.3, 0.8]) {
      feet.left = !feet.left;
      const side = (feet.left ? -1 : 1) * 0.1;
      const x = a.x + dx * t + (dz / len) * side;
      const z = a.z + dz * t - (dx / len) * side;
      this.add(feet.kind, x, z, heading, feet.steps / KINDS[feet.kind].steps);
    }
    feet.steps -= 1;
  }

  add(kind, x, z, heading, strength) {
    const tx = Math.round(x);
    const tz = Math.round(z);
    if (!this.board.marks?.canMark(tx, tz)) return;
    const spec = KINDS[kind];
    const alpha = spec.alpha * (0.45 + 0.55 * strength); // fainter as the feet dry
    const mesh = new THREE.Mesh(GEO, new THREE.MeshBasicMaterial({
      map: sole(), color: spec.color, transparent: true, opacity: alpha, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3,
    }));
    mesh.rotation.y = heading + Math.PI; // the plane's -z (the ball) the way it walked
    mesh.position.set(x, this.liftAt(tx, tz) + 0.009, z);
    mesh.renderOrder = -1;
    this.board.group.add(mesh);
    this.board.addToCell(tx, tz, mesh);
    this.board.fogDirty = true;
    this.prints.push({ mesh, k: key(tx, tz), left: spec.turns, turns: spec.turns, alpha });
    if (this.prints.length > MAX) this.remove(this.prints[0]);
  }

  /** A turn has passed: prints dry and fade, and go once they're gone. */
  age() {
    for (const p of [...this.prints]) {
      p.left -= 1;
      if (p.left <= 0) {
        const m = p.mesh.material;
        const from = m.opacity;
        tween(600, (t) => { m.opacity = from * (1 - t); }).then(() => this.remove(p));
      } else {
        const m = p.mesh.material;
        const from = m.opacity;
        const to = p.alpha * (p.left / p.turns);
        tween(600, (t) => { m.opacity = from + (to - from) * t; });
      }
    }
  }

  remove(p) {
    const i = this.prints.indexOf(p);
    if (i < 0) return;
    this.prints.splice(i, 1);
    this.board.group.remove(p.mesh);
    const cell = this.board.cells.get(p.k);
    if (cell) {
      cell.objects = cell.objects.filter((o) => o !== p.mesh);
      cell.mats = cell.mats.filter(({ m }) => m !== p.mesh.material);
    }
    p.mesh.material.dispose();
  }

  dispose() {
    for (const p of [...this.prints]) this.remove(p);
    this.feet.clear();
  }
}
