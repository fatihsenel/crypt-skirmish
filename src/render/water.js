// Water that answers: light thrown off the pools wavers over them and the floor around them
// (caustics), and a figure wading through leaves rings spreading out and a splash at each step.
// Drawn only. The caustics are one mesh over every pool and its shore, each corner dimmed by its
// tile's fog (a vertex attribute, like reflect.js), so a pool not yet seen gives nothing away; the
// pattern is worked out in the shader, no texture. Reduced motion stills the light and leaves
// out the rings and splashes.

import * as THREE from 'three';
import { key } from '../game/grid.js';
import { calm, tween, wait, linear, easeOut } from './tween.js';

const Y = 0.045; // over the water sheet (0.035)
const REACH = 0.9; // how far onto the floor the light plays, in tiles

const VERT = /* glsl */`
  attribute float fog;
  attribute float lit;
  varying vec2 vXZ;
  varying float vA;
  void main() {
    vXZ = position.xz;
    vA = fog * lit;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// Water caustics: the bright web of light a rippling surface throws, as the edges between
// drifting cells (two layers at different scales, so the web shifts and never repeats).
const FRAG = /* glsl */`
  uniform float time;
  uniform vec3 color;
  varying vec2 vXZ;
  varying float vA;
  vec2 hash2(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
  }
  float web(vec2 p, float t) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = 0.5 + 0.38 * sin(t + 6.2831 * hash2(i + g));
        float d = length(g + o - f);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
      }
    }
    return 1.0 - smoothstep(0.0, 0.09, d2 - d1);
  }
  void main() {
    if (vA < 0.004) discard;
    // Where the two webs cross the light gathers brightest.
    float a = web(vXZ * 2.2, time * 0.9);
    float b = web(vXZ * 3.3 + 7.3, time * 1.25);
    float k = min(a * 0.55 + b * 0.35 + a * b * 0.9, 1.0);
    gl_FragColor = vec4(color * k * vA, 1.0);
    #include <colorspace_fragment>
  }`;

export class Water {
  /** `board`: the Board (its grid, cells and group); `lift(x, z)`: the floor's height there. */
  constructor(board, lift) {
    this.board = board;
    this.lift = lift;
    this.group = new THREE.Group();
    board.group.add(this.group);
    const water = board.grid.water ?? new Set();
    this.wet = water;
    this.rings = [];
    if (!water.size) return;
    const pools = [...water].map((k) => k.split(',').map(Number));
    // Every tile the light reaches: the pools and the floor about them.
    const tiles = new Map();
    const reach = Math.ceil(REACH);
    for (const [px, pz] of pools) {
      for (let dx = -reach; dx <= reach; dx++) {
        for (let dz = -reach; dz <= reach; dz++) {
          const x = px + dx;
          const z = pz + dz;
          const k = key(x, z);
          if (tiles.has(k) || board.grid.isWall(x, z) || board.grid.chasms.has(k)) continue;
          tiles.set(k, [x, z]);
        }
      }
    }
    // How lit a corner is: full over the water, fading over REACH tiles of floor.
    const lit = (x, z) => {
      let d = Infinity;
      for (const [px, pz] of pools) d = Math.min(d, Math.max(Math.abs(x - px), Math.abs(z - pz)) - 0.5);
      return d <= 0 ? 0.8 : 0.35 * Math.max(0, 1 - d / REACH) ** 2;
    };
    const pos = [];
    const lits = [];
    const idx = [];
    this.tiles = [...tiles.values()];
    this.tiles.forEach(([x, z], i) => {
      const y = Y + lift(x, z);
      for (const [cx, cz] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
        pos.push(x + cx, y, z + cz);
        lits.push(lit(x + cx, z + cz));
      }
      const o = i * 4;
      idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('lit', new THREE.Float32BufferAttribute(lits, 1));
    geo.setAttribute('fog', new THREE.Float32BufferAttribute(new Float32Array(this.tiles.length * 4), 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    this.light = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { time: { value: 0 }, color: { value: new THREE.Color(0x6f8f88).multiplyScalar(0.5) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }));
    this.light.raycast = () => {};
    this.light.renderOrder = 1;
    this.group.add(this.light);
  }

  /** Is tile (x, z) water? */
  isWet(x, z) {
    return this.wet.has(key(Math.round(x), Math.round(z)));
  }

  /** A figure steps from `a` to `b`: in water, rings spread from where it treads and a little splashes up. */
  step(unit, a, b) {
    if (calm() || unit.flies || !this.isWet(b.x, b.z)) return;
    const f = this.board.cells.get(key(b.x, b.z))?.f ?? 0;
    if (f < 0.3) return; // unseen: no rings to give it away
    // Half way there the foot comes down; another ring as it lands on the tile.
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    if (this.isWet(a.x, a.z)) this.ring(mid, 0);
    this.ring(b, 140);
    this.splash(b, 140);
  }

  ring(at, delay) {
    if (this.rings.length > 10) return;
    const geo = new THREE.RingGeometry(0.62, 0.7, 32).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xbfd2d6, transparent: true, opacity: 0, depthWrite: false }));
    m.raycast = () => {};
    m.position.set(at.x + (Math.random() - 0.5) * 0.1, 0.05 + this.lift(at.x, at.z), at.z + (Math.random() - 0.5) * 0.1);
    m.scale.setScalar(0.05);
    m.renderOrder = 3; // over the water sheet, which is see-through too
    this.group.add(m);
    this.rings.push(m);
    const second = m.clone();
    second.material = m.material.clone();
    this.group.add(second);
    const life = 1100;
    wait(delay).then(() => {
      tween(life, (t) => {
        const e = 1 - (1 - t) ** 2;
        m.scale.setScalar(0.08 + e * 0.75);
        m.material.opacity = 0.42 * (1 - t) * Math.min(1, t * 8);
        const t2 = Math.max(0, t - 0.22) / 0.78;
        second.scale.setScalar(0.05 + (1 - (1 - t2) ** 2) * 0.5);
        second.material.opacity = 0.3 * (1 - t2) * Math.min(1, t2 * 8);
      }, linear).then(() => {
        for (const r of [m, second]) {
          r.removeFromParent();
          r.material.dispose();
        }
        geo.dispose();
        this.rings.splice(this.rings.indexOf(m), 1);
      });
    });
  }

  splash(at, delay) {
    wait(delay).then(() => {
      const g = new THREE.Group();
      g.position.set(at.x, 0.06 + this.lift(at.x, at.z), at.z);
      this.group.add(g);
      const drops = [];
      for (let i = 0; i < 7; i++) {
        const d = new THREE.Mesh(DROP, new THREE.MeshBasicMaterial({ color: 0xd4e2e6, transparent: true, opacity: 0.75, depthWrite: false }));
        const a = Math.random() * Math.PI * 2;
        const s = 0.6 + Math.random() * 0.8;
        d.userData.v = new THREE.Vector3(Math.cos(a) * 0.7 * s, 1.4 + Math.random() * 1.0, Math.sin(a) * 0.7 * s);
        d.scale.setScalar(0.5 + Math.random() * 0.6);
        g.add(d);
        drops.push(d);
      }
      let last = 0;
      tween(520, (t) => {
        const dt = (t - last) * 0.52;
        last = t;
        for (const d of drops) {
          d.userData.v.y -= 9.8 * dt;
          d.position.addScaledVector(d.userData.v, dt);
          d.visible = d.position.y > -0.01;
          d.material.opacity = 0.75 * (1 - t);
        }
      }, easeOut).then(() => {
        g.removeFromParent();
        for (const d of drops) d.material.dispose();
      });
    });
  }

  /** Each frame: the light wavers, dimmed by each tile's fog. */
  tick(t) {
    if (!this.light) return;
    if (!calm()) this.light.material.uniforms.time.value = t;
    const fog = this.light.geometry.attributes.fog;
    let changed = false;
    this.tiles.forEach(([x, z], i) => {
      const f = this.board.cells.get(key(x, z))?.f ?? 0;
      if (fog.array[i * 4] === f) return;
      fog.array.fill(f, i * 4, i * 4 + 4);
      changed = true;
    });
    if (changed) fog.needsUpdate = true;
    this.light.visible = fog.array.some((f) => f > 0.01);
  }
}

const DROP = new THREE.SphereGeometry(0.018, 5, 4);
