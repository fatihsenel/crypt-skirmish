// Reflections in shallow water, drawn only: torch flames, braziers and figures show faintly
// upside down in the pools, rippling with the water. One mirror (three's Reflector) over every
// water tile at once, its picture added to the dark water, each tile dimmed by its fog (a
// tile not yet seen shows nothing). It draws the scene a second time, small, so it's only on
// with the Glow setting (`setReflections` from main.js).

import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { calm } from './tween.js';

const Y = 0.06; // over the water sheet (0.035) and the floor tiles' raised edges, so they aren't mirrored
const SCALE = 0.5; // of the canvas's size

const SHADER = {
  name: 'WaterReflection',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    tRipple: { value: null },
    time: { value: 0 },
    strength: { value: 0.55 },
  },
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix;
    attribute float fog;
    varying vec4 vUv;
    varying vec2 vXZ;
    varying float vFog;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vXZ = vec2(position.x, -position.y);
      vFog = fog;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tRipple;
    uniform float time;
    uniform float strength;
    varying vec4 vUv;
    varying vec2 vXZ;
    varying float vFog;
    void main() {
      // The ripples' normals bend the picture a little, two layers drifting apart.
      vec2 n = texture2D(tRipple, vXZ * 0.9 + vec2(time * 0.025, time * 0.016)).xy * 2.0 - 1.0;
      n += texture2D(tRipple, vXZ * 0.6 - vec2(time * 0.018, time * 0.011)).yx * 2.0 - 1.0;
      vec4 uv = vUv;
      uv.xy += n * 0.0035 * uv.w;
      vec3 c = texture2DProj(tDiffuse, uv).rgb;
      c = min(c, vec3(1.0)); // keep it under the glow's threshold, and no NaN
      gl_FragColor = vec4(max(c, vec3(0.0)) * strength * vFog, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export class WaterMirror {
  /**
   * One mirror over `tiles` ([x, z] pairs), rippled by `ripple` (the water's normal map).
   * `floor` lists the floor's meshes, left out of the picture: their bevelled edges stand a
   * little over the water and would show as bright seams.
   */
  constructor(parent, tiles, ripple, renderer, floor) {
    // The quads lie in the mirror's own xy plane; it's turned flat, so its y is the world's -z.
    const pos = [];
    const idx = [];
    tiles.forEach(([x, z], i) => {
      pos.push(x - 0.5, -(z - 0.5), 0, x + 0.5, -(z - 0.5), 0, x + 0.5, -(z + 0.5), 0, x - 0.5, -(z + 0.5), 0);
      const o = i * 4;
      idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('fog', new THREE.Float32BufferAttribute(new Float32Array(tiles.length * 4), 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    this.tiles = tiles;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2()).multiplyScalar(SCALE);
    this.mesh = new Reflector(geo, {
      shader: SHADER, clipBias: 0.01, multisample: 0,
      textureWidth: Math.max(64, Math.round(size.x)), textureHeight: Math.max(64, Math.round(size.y)),
    });
    const m = this.mesh.material;
    m.uniforms.tRipple.value = ripple;
    m.transparent = true;
    m.depthWrite = false;
    m.blending = THREE.AdditiveBlending;
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = Y;
    this.mesh.renderOrder = 0;
    // Drawn once a frame at most, whatever else renders the scene (the blur's depth, say).
    const draw = this.mesh.onBeforeRender;
    this.fresh = true;
    this.mesh.onBeforeRender = (...a) => {
      if (!this.fresh) return;
      this.fresh = false;
      const shown = floor.filter((o) => o.visible);
      for (const o of shown) o.visible = false;
      draw.apply(this.mesh, a);
      for (const o of shown) o.visible = true;
    };
    parent.add(this.mesh);
  }

  /** Each frame: `fogAt(x, z)` is that tile's fog (0 unseen .. 1 in sight). */
  tick(t, fogAt) {
    this.fresh = true;
    if (!calm()) this.mesh.material.uniforms.time.value = t;
    const fog = this.mesh.geometry.attributes.fog;
    let changed = false;
    this.tiles.forEach(([x, z], i) => {
      const f = fogAt(x, z);
      if (fog.array[i * 4] === f) return;
      fog.array.fill(f, i * 4, i * 4 + 4);
      changed = true;
    });
    if (changed) fog.needsUpdate = true;
    this.mesh.visible = fog.array.some((f) => f > 0.01);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}
