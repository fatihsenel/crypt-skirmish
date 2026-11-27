// Things hanging from the dark above the room, drawn only: chains with a hook, a broken iron
// chandelier on three chains, roots trailing down and torn sheets of web. They start high in the
// dark (fading out the higher they reach, so they're lost in it) and end well over the figures'
// heads. Each belongs to the floor tile under it (Board.addToCell): dark until seen, rising with
// the room. One that would hide a figure on screen fades like a wall in front (ditherable), and
// they sway a little unless motion is reduced. Placement is fixed by the tile.

import * as THREE from 'three';
import { key } from '../game/grid.js';
import { ditherable } from './dither.js';
import { calm } from './tween.js';
import { mergeMeshes } from './merge.js';

const TOP = 3.4; // where they come out of the dark
const FADED = 0.22;
const MAX = 6;

function hash(x, z, salt) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(salt | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** How much shows of something at height `y`: lost in the dark toward the top. */
const lit = (y) => Math.max(0, Math.min(1, (TOP - 0.2 - y) / 1.3)) ** 1.4;

const LINK = new THREE.TorusGeometry(0.05, 0.014, 5, 10);
const IRON = 0x4a4744;
const iron = (y) => new THREE.MeshStandardMaterial({ color: IRON, metalness: 0.65, roughness: 0.5, transparent: lit(y) < 1, opacity: lit(y) });

/** A chain from the top down to `bottom`, at (dx, dz) from the group's middle. */
function chain(g, bottom, dx = 0, dz = 0, step = 0.085) {
  const n = Math.floor((TOP - bottom) / step);
  for (let i = 0; i < n; i++) {
    const y = TOP - i * step;
    const l = new THREE.Mesh(LINK, iron(y));
    l.position.set(dx, y, dz);
    l.rotation.set(0, i % 2 ? Math.PI / 2 : 0, Math.PI / 2);
    g.add(l);
  }
}

function addChain(g, x, z) {
  const bottom = 1.7 + hash(x, z, 3) * 0.6;
  chain(g, bottom);
  // A hook at the end.
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 6, 14, Math.PI * 1.4), iron(bottom));
  hook.position.set(0, bottom - 0.08, 0);
  hook.rotation.z = Math.PI * 0.8;
  g.add(hook);
}

function addChandelier(g, x, z) {
  const y = 1.95 + hash(x, z, 5) * 0.3;
  const ring = new THREE.Group();
  ring.position.y = y;
  ring.rotation.set(0.28, hash(x, z, 6) * Math.PI, 0.12); // hanging askew, one chain broken
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 6, 28), iron(y));
  hoop.rotation.x = Math.PI / 2;
  ring.add(hoop);
  const wax = new THREE.MeshStandardMaterial({ color: 0xd8ccae, roughness: 0.9 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.03, 0.04, 8), iron(y));
    cup.position.set(Math.cos(a) * 0.42, 0.03, Math.sin(a) * 0.42);
    ring.add(cup);
    if (hash(x + i, z, 7) < 0.6) {
      const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.05 + hash(x, z + i, 8) * 0.08, 7), wax);
      stub.position.set(cup.position.x, 0.08, cup.position.z);
      ring.add(stub);
    }
  }
  g.add(ring);
  // Two chains still holding it; the third hangs loose.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + ring.rotation.y;
    const p = new THREE.Vector3(Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42).applyEuler(ring.rotation);
    if (i === 2) chain(g, y + 0.5, p.x * 0.5, p.z * 0.5);
    else {
      // Slanting in toward the hook above the middle: links along the line.
      const from = new THREE.Vector3(p.x, y + p.y, p.z);
      const to = new THREE.Vector3(0, y + 0.9, 0);
      const n = Math.ceil(from.distanceTo(to) / 0.085);
      for (let j = 0; j < n; j++) {
        const q = from.clone().lerp(to, j / n);
        const l = new THREE.Mesh(LINK, iron(q.y));
        l.position.copy(q);
        l.lookAt(to);
        l.rotateY(Math.PI / 2);
        if (j % 2) l.rotateX(Math.PI / 2);
        g.add(l);
      }
    }
  }
  chain(g, y + 0.9);
}

function addRoots(g, x, z) {
  const n = 3 + Math.floor(hash(x, z, 9) * 3);
  for (let i = 0; i < n; i++) {
    const ox = (hash(x, z, 10 + i) - 0.5) * 0.6;
    const oz = (hash(x, z, 20 + i) - 0.5) * 0.6;
    const bottom = 1.6 + hash(x, z, 30 + i) * 0.8;
    const pts = [];
    for (let j = 0; j <= 6; j++) {
      const y = TOP - (j / 6) * (TOP - bottom);
      pts.push(new THREE.Vector3(ox + Math.sin(j * 1.3 + i) * 0.06, y, oz + Math.cos(j * 1.1 + i * 2) * 0.06));
    }
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.03 + hash(x, z, 40 + i) * 0.025, 5);
    // Fading out toward the top, through the vertex colours' alpha.
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 4);
    for (let v = 0; v < pos.count; v++) col.set([1, 1, 1, lit(pos.getY(v))], v * 4);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 1, vertexColors: true, transparent: true })));
  }
}

let webMap = null;
/** A torn sheet of web: threads hanging down, joined by sagging strands, ragged at the foot. */
function webSheet() {
  if (webMap) return webMap;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  let s = 3;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  g.strokeStyle = 'rgba(230,230,236,0.7)';
  for (let i = 0; i < 7; i++) {
    const x = 4 + i * 9 + r() * 4;
    g.lineWidth = 0.8 + r();
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + (r() - 0.5) * 8, 140 + r() * 110);
    g.stroke();
  }
  for (let y = 10; y < 200; y += 12 + r() * 14) {
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(0, y);
    g.quadraticCurveTo(32, y + 8 + r() * 10, 64, y + (r() - 0.5) * 6);
    g.stroke();
  }
  // Fade out toward the top, into the dark.
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createLinearGradient(0, 0, 0, 256);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(0.35, 'rgba(0,0,0,1)');
  g.fillStyle = fade;
  g.fillRect(0, 0, 64, 256);
  webMap = new THREE.CanvasTexture(c);
  return webMap;
}

function addWeb(g, x, z) {
  const bottom = 1.7 + hash(x, z, 50) * 0.4;
  for (let i = 0; i < 2; i++) {
    const h = TOP - bottom;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.55, h), new THREE.MeshBasicMaterial({ map: webSheet(), transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.55 }));
    m.position.set((i - 0.5) * 0.2, bottom + h / 2, 0);
    m.rotation.y = hash(x, z, 51) * Math.PI + i * 1.2;
    g.add(m);
  }
}

const KINDS = [addChain, addChandelier, addRoots, addWeb];

export class Hangings {
  constructor(board) {
    this.board = board;
    this.items = [];
    const grid = board.grid;
    const spots = [];
    for (let z = 1; z < grid.height - 1; z++) {
      for (let x = 1; x < grid.width - 1; x++) {
        const k = key(x, z);
        if (grid.isWall(x, z) || grid.doors.has(k) || hash(x, z, 1) > 0.09) continue;
        if (spots.some((s) => Math.abs(s.x - x) + Math.abs(s.z - z) < 5)) continue;
        spots.push({ x, z });
        if (spots.length === MAX) break;
      }
      if (spots.length === MAX) break;
    }
    for (const { x, z } of spots) {
      // Swinging from where it comes out of the dark: a pivot up there, the piece hung below it.
      const g = new THREE.Group();
      g.position.set(x + (hash(x, z, 2) - 0.5) * 0.4, TOP, z + (hash(x, z, 4) - 0.5) * 0.4);
      const body = new THREE.Group();
      body.position.y = -TOP;
      g.add(body);
      KINDS[Math.floor(hash(x, z, 11) * KINDS.length)](body, x, z);
      // The iron as two materials of its own (it fades on its own): solid, and fading into the
      // dark through its vertices' alpha; then one mesh a material (merge.js).
      const solid = new THREE.MeshStandardMaterial({ color: IRON, metalness: 0.65, roughness: 0.5 });
      const fading = solid.clone();
      fading.vertexColors = true;
      fading.transparent = true;
      body.traverse((o) => {
        if (!o.isMesh || o.material.color?.getHex() !== IRON || o.material.vertexColors) return;
        if (o.material.transparent) o.userData.alpha = o.material.opacity;
        o.material = o.material.transparent ? fading : solid;
      });
      const meshes = mergeMeshes(body);
      for (const o of meshes) o.castShadow = !o.material.transparent; // the solid iron's shadow on the floor shows how high it hangs
      board.group.add(g);
      board.addToCell(x, z, g);
      const box = new THREE.Box3().setFromObject(g);
      this.items.push({ g, meshes, low: box.min.y, x: g.position.x, z: g.position.z, opacity: 1, ph: hash(x, z, 12) * 6.3 });
    }
  }

  /** Sway, and fade any that would cover a figure on screen. */
  tick(t, dt, camera, figures) {
    const still = calm();
    const k = Math.min(1, dt * 8);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const p = new THREE.Vector3();
    const near = figures.map((f) => p.set(f.x, f.y + 0.5, f.z).project(camera).clone());
    let moving = false;
    for (const it of this.items) {
      if (!still) {
        it.g.rotation.x = Math.sin(t * 0.7 + it.ph) * 0.02;
        it.g.rotation.z = Math.cos(t * 0.6 + it.ph) * 0.02;
      }
      // On screen: the line from its foot to the top, and how close a figure comes to it.
      a.set(it.x, it.low, it.z).project(camera);
      b.set(it.x, TOP, it.z).project(camera);
      const reach = p.set(it.x, it.low + 0.6, it.z).project(camera).distanceTo(a); // half a figure, on screen
      let hides = false;
      for (const f of near) {
        const along = Math.max(0, Math.min(1, ((f.x - a.x) * (b.x - a.x) + (f.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1)));
        const dx = f.x - (a.x + (b.x - a.x) * along);
        const dy = f.y - (a.y + (b.y - a.y) * along);
        if (Math.hypot(dx, dy) < reach) {
          hides = true;
          break;
        }
      }
      const target = hides ? FADED : 1;
      if (Math.abs(it.opacity - target) < 0.005) continue;
      it.opacity += (target - it.opacity) * k;
      if (Math.abs(it.opacity - target) < 0.01) it.opacity = target;
      else moving = true;
      for (const m of it.meshes) ditherable(m.material).value = it.opacity;
    }
    return moving;
  }
}
