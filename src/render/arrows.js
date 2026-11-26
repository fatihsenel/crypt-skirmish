// Arrows and javelins that miss, drawn only: the shot flies on past its mark, dropping as it
// goes, and sticks where it strikes: in a wall, a closed door (it swings with the door), a
// barrel, crate or column, or the floor. Over water or a chasm it's lost. Stuck shafts stay for
// the rest of the fight, dimmed with their tile's fog, and go with a smashed prop or a wall that
// opens. Reduced motion keeps the flight but not the quiver as it strikes.

import * as THREE from 'three';
import { key } from '../game/grid.js';
import { tween, linear, calm } from './tween.js';

const MAX = 40;
const STEP = 0.04; // tiles, along the way it flies
const FAR = 7; // tiles past the mark before it gives out
const MS_PER_TILE = 55; // as fast as it flew (shootProjectile)
const DROP = 0.028; // its fall: y drops by DROP·s² + SLOPE·s
const SLOPE = 0.02;
const BITE = 0.08; // how deep the tip goes in

const v = new THREE.Vector3();

export class Arrows {
  /** `board` gives the grid, the group to draw into, its doors and fog cells; `floorAt` a tile's floor height. */
  constructor(board, floorAt) {
    this.board = board;
    this.floorAt = floorAt;
    this.stuck = []; // { mesh, at (the tile struck), cell }, oldest first
  }

  /**
   * Where a shot flying on from `b` (a Vector3) the way it came from `a` comes to rest:
   * { s (tiles flown), kind: 'wall' | 'door' | 'prop' | 'floor' | 'lost', at, cell, door }.
   */
  path(a, b) {
    const g = this.board.grid;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const wall = this.board.kit ? 0.27 : 0.5; // half a wall's thickness
    let last = key(Math.round(b.x), Math.round(b.z));
    for (let s = STEP; s <= FAR; s += STEP) {
      const x = b.x + ux * s;
      const z = b.z + uz * s;
      const y = b.y - DROP * s * s - SLOPE * s;
      const tx = Math.round(x);
      const tz = Math.round(z);
      const k = key(tx, tz);
      const hit = (kind, extra = {}) => ({ s, kind, at: k, cell: last, ux, uz, ...extra });
      if (!g.inBounds(tx, tz)) return hit('lost');
      const door = this.board.doors?.get(k);
      if (door && !door.opened) {
        const alongX = g.isWall(tx - 1, tz) || g.isWall(tx + 1, tz);
        if (Math.abs(alongX ? z - tz : x - tx) < 0.05) return hit('door', { door, cell: k });
        continue;
      }
      if (g.isWall(tx, tz) && !door) {
        // A kit wall is thin, but reaches across its tile toward the walls it joins.
        const reachX = g.isWall(x > tx ? tx + 1 : tx - 1, tz) ? 0.5 : wall;
        const reachZ = g.isWall(tx, z > tz ? tz + 1 : tz - 1) ? 0.5 : wall;
        if (Math.abs(x - tx) < reachX && Math.abs(z - tz) < reachZ) return hit('wall');
        continue;
      }
      const prop = g.props?.get(k);
      if (prop && (prop.cover === 'full' || this.board.propParts?.has(k))) {
        const tall = prop.cover === 'full' ? 2 : 0.5;
        if (Math.hypot(x - tx, z - tz) < 0.28 && y < this.floorAt(tx, tz) + tall) return hit('prop', { cell: k });
      }
      if (y <= this.floorAt(tx, tz) + 0.02) {
        if (g.water?.has(k) || g.chasms?.has(k) || g.links?.has(k)) return hit('lost');
        return hit('floor', { cell: k });
      }
      last = k;
    }
    return { s: FAR, kind: 'lost', ux, uz };
  }

  /**
   * A missed shot, `mesh` (in `scene`, its shaft along its z, `userData.reach` from its middle to
   * its tip), flew from `a` to `b`: it flies on and sticks. Not awaited.
   */
  fly(scene, mesh, a, b) {
    const p = this.path(a, b);
    const reach = mesh.userData.reach ?? 0.3;
    const at = (s) => v.set(b.x + p.ux * s, b.y - DROP * s * s - SLOPE * s, b.z + p.uz * s);
    const aim = (s) => {
      // Pointing the way it flies; into the floor it dips steeply, as if it dropped in.
      const dy = p.kind === 'floor' && s >= p.s ? -0.75 : -2 * DROP * s - SLOPE;
      const pos = at(s).clone();
      mesh.position.copy(pos);
      mesh.lookAt(pos.x + p.ux, pos.y + dy, pos.z + p.uz);
    };
    const end = Math.max(0, p.s - (reach - BITE) / (p.kind === 'floor' ? 1.25 : 1));
    tween(Math.max(60, end * MS_PER_TILE), (t) => aim(end * t), linear).then(() => {
      if (p.kind === 'lost') {
        scene.remove(mesh);
        dispose(mesh);
        return;
      }
      aim(end);
      if (p.kind === 'floor') {
        // The tip in the floor, the shaft standing up out of it.
        const ground = this.floorAt(Math.round(mesh.position.x), Math.round(mesh.position.z));
        mesh.position.y = ground + Math.sin(0.64) * (reach - BITE);
      }
      this.keep(mesh, p);
    });
  }

  keep(mesh, p) {
    // Its own copies of the materials go to the fog cell; the first ones aren't needed.
    const firsts = [];
    mesh.traverse((o) => { if (o.isMesh) firsts.push(o.material); });
    if (p.kind === 'door') p.door.hinge.attach(mesh); // swings with it
    else this.board.group.attach(mesh);
    const [cx, cz] = p.cell.split(',').map(Number);
    this.board.addToCell(cx, cz, mesh);
    for (const m of firsts) m.dispose();
    this.board.fogDirty = true;
    const rec = { mesh, at: p.at, cell: p.cell };
    this.stuck.push(rec);
    if (this.stuck.length > MAX) this.remove(this.stuck[0]);
    if (calm()) return;
    // It quivers as it strikes.
    const rest = mesh.quaternion.clone();
    const axis = new THREE.Vector3(1, 0, 0);
    tween(420, (t) => {
      mesh.quaternion.copy(rest);
      mesh.rotateOnAxis(axis, Math.sin(t * Math.PI * 7) * 0.09 * (1 - t));
    }, linear).then(() => mesh.quaternion.copy(rest));
  }

  /** What stood at (x, z) is gone (a prop smashed, a wall opened): the shafts in it fall away. */
  clear(x, z) {
    const k = key(x, z);
    for (const r of this.stuck.filter((s) => s.at === k)) this.remove(r);
  }

  remove(r) {
    const i = this.stuck.indexOf(r);
    if (i < 0) return;
    this.stuck.splice(i, 1);
    r.mesh.removeFromParent();
    const cell = this.board.cells.get(r.cell);
    if (cell) {
      const mats = new Set();
      r.mesh.traverse((o) => { if (o.isMesh) mats.add(o.material); });
      cell.objects = cell.objects.filter((o) => o !== r.mesh);
      cell.mats = cell.mats.filter(({ m }) => !mats.has(m));
    }
    dispose(r.mesh);
  }
}

function dispose(mesh) {
  mesh.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    o.material.dispose();
  });
}
