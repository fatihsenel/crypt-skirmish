// Haze and light shafts, drawn only. A slow mist drifts in two layers down every chasm shaft and
// low over the lower hall's floor; with the Glow setting, a soft shaft of light leans out from
// each torch and rises over each lit brazier, flickering with its flame. Under calm() the mist
// holds still and the shafts stay steady.

import * as THREE from 'three';
import { calm } from './tween.js';

let mistTex = null;
let shaftTex = null;

/** Soft cloudy noise that tiles: blurred blobs on a transparent canvas. */
function mistTexture() {
  if (mistTex) return mistTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  let s = 1234567;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 46; i++) {
    const x = rnd() * 128;
    const y = rnd() * 128;
    const r = 10 + rnd() * 26;
    for (const [ox, oy] of [[0, 0], [128, 0], [-128, 0], [0, 128], [0, -128]]) { // wraps at the edges
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, `rgba(255,255,255,${0.16 + rnd() * 0.12})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  mistTex = new THREE.CanvasTexture(c);
  mistTex.wrapS = mistTex.wrapT = THREE.RepeatWrapping;
  return mistTex;
}

/** A shaft of light: bright at its source, fading along its length and toward its sides. */
function shaftTexture() {
  if (shaftTex) return shaftTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(64, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 64; x++) {
      const along = y / 127; // 0 at the source
      const across = Math.abs(x - 31.5) / 31.5;
      const width = 0.35 + along * 0.65; // it widens as it goes
      const side = Math.max(0, 1 - across / width);
      const a = Math.max(0, Math.pow(side, 1.6)) * Math.max(0, Math.pow(1 - along, 1.3));
      const i = (y * 64 + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 200;
      img.data[i + 2] = 140;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  shaftTex = new THREE.CanvasTexture(c);
  shaftTex.colorSpace = THREE.SRGBColorSpace;
  return shaftTex;
}

const MIST_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const SHAFT_GEO = new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0); // hangs from its top edge

export class Haze {
  /** `board` gives the grid, its cells (fog) and the group to draw into. */
  constructor(board) {
    this.board = board;
    this.layers = [];
    this.mists = []; // { mesh, k, base }
    this.shafts = []; // { mesh, cell, seed, base }
    const tex = mistTexture();
    // Two layers of one texture, drifting different ways (each its own copy of the offsets).
    for (const [drift, color] of [[[0.012, 0.007], 0x8a8f9c], [[-0.008, 0.011], 0x6d7280]]) {
      const map = tex.clone();
      map.needsUpdate = true;
      this.layers.push({ map, drift });
      this.layers.at(-1).material = new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity: 0.55, depthWrite: false, fog: false });
    }
    const g = board.grid;
    for (const k of g.chasms) this.addMist(k, [-0.28, -0.6], 0.8);
    for (const k of g.lower ?? []) if (!g.chasms.has(k)) this.addMist(k, [0.06], 0.22);
  }

  /** Mist on tile `k` at each height in `ys`, at `strength` (0-1). A broken crack's shaft adds one. */
  addMist(k, ys, strength) {
    const [x, z] = k.split(',').map(Number);
    ys.forEach((y, i) => {
      const layer = this.layers[i % this.layers.length];
      const mesh = new THREE.Mesh(MIST_GEO, layer.material.clone());
      mesh.position.set(x, y, z);
      mesh.renderOrder = 2;
      mesh.userData.uv = [x, z]; // each tile samples its own part of the cloud, so neighbours join up
      mesh.raycast = () => {};
      this.board.group.add(mesh);
      this.mists.push({ mesh, k, base: strength * mesh.material.opacity });
    });
    this.applyUV();
  }

  /** The mist's texture spans tiles: shift each tile's UVs to its place in the cloud. */
  applyUV() {
    for (const { mesh } of this.mists) {
      if (mesh.geometry !== MIST_GEO) continue;
      const geo = MIST_GEO.clone();
      const [x, z] = mesh.userData.uv;
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + x) / 3, (uv.getY(i) - z) / 3);
      mesh.geometry = geo;
    }
  }

  /** Shafts of light at the torches and braziers, on (with the Glow setting) or off. */
  setShafts(on) {
    for (const s of this.shafts) {
      this.board.group.remove(s.mesh);
      s.mesh.material.dispose();
    }
    this.shafts = [];
    if (!on) return;
    const add = (pos, cell, seed, { w, h, tilt, yaw, base, lit, faces = false }) => {
      const mesh = new THREE.Mesh(SHAFT_GEO, new THREE.MeshBasicMaterial({
        map: shaftTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      }));
      mesh.position.copy(pos);
      mesh.scale.set(w, h, 1);
      mesh.rotation.set(tilt, yaw, 0, 'YXZ');
      mesh.renderOrder = 4;
      mesh.raycast = () => {};
      this.board.group.add(mesh);
      this.shafts.push({ mesh, cell, seed, base, lit, faces }); // `faces`: turns to the view
    };
    for (const t of this.board.torches) {
      const out = t.home.clone().sub(t.flame.position).setY(0).normalize(); // away from the wall
      // Down and out from the flame, onto the floor in front of the wall, seen edge-on to the camera.
      add(t.flame.position.clone().add(new THREE.Vector3(0, 0.05, 0)), t.cell, t.seed, {
        w: 0.9, h: 1.05, tilt: 0.55, yaw: Math.atan2(out.x, out.z) + Math.PI, base: 0.4, lit: () => true,
      });
    }
    for (const b of this.board.braziers.values()) {
      const at = b.g.position.clone().add(new THREE.Vector3(0, 0.74, 0));
      // A column of heat and light rising over the coals (turned over, it stands up from them).
      add(at, b.cell, b.seed, {
        w: 0.7, h: 0.9, tilt: Math.PI, yaw: Math.PI / 4, base: 0.3, lit: () => b.lit, faces: true,
      });
    }
  }

  tick(t) {
    const still = calm();
    if (!still) for (const { map, drift } of this.layers) map.offset.set(t * drift[0], t * drift[1]);
    for (const m of this.mists) {
      const f = this.board.cells.get(m.k)?.f ?? 0;
      m.mesh.material.opacity = m.base * f;
      m.mesh.visible = f > 0.01;
    }
    const view = this.board.stage?.view?.();
    for (const s of this.shafts) {
      if (s.faces && view) s.mesh.rotation.y = Math.atan2(view.x, view.z); // a column faces the camera
      const flicker = still ? 1 : 0.85 + 0.1 * Math.sin(t * 9 + s.seed) + 0.05 * Math.sin(t * 23 + s.seed * 2);
      s.mesh.material.opacity = s.lit() ? s.base * flicker * s.cell.f * this.board.torchDim : 0;
      s.mesh.visible = s.mesh.material.opacity > 0.005;
    }
  }
}
