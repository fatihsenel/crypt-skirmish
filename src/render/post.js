// Post-processing, loaded only when it's wanted (stage.js imports this file on demand): a bloom
// that makes what burns bright glow (the Glow setting), and photo mode's depth of field. The
// scene is drawn into a multisampled half-float target, so edges stay smooth and light above
// white survives until OutputPass tone-maps it as the plain render would.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

// Bloom: only light well above white glows (flames, coals, spell bolts, a burning rim), not the
// lit floor or the highlights.
const BLOOM = { strength: 0.75, radius: 0.5, threshold: 0.72 };

// The plain render clears to the background colour as it is; here it is drawn into the target
// and tone-mapped with everything else, which would darken it to black. So the background is
// swapped for the colour that ACES (as three.js applies it, ShaderChunk tonemapping_pars) maps
// back onto the plain one.
const ACES_IN = [[0.59719, 0.076, 0.0284], [0.35458, 0.90834, 0.13383], [0.04823, 0.01566, 0.83777]];
const ACES_OUT = [[1.60475, -0.10208, -0.00327], [-0.53108, 1.10813, -0.07276], [-0.07367, -0.00605, 1.07602]];
const mul = (m, v) => [0, 1, 2].map((i) => m[0][i] * v[0] + m[1][i] * v[1] + m[2][i] * v[2]);
const rrt = (x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081);
const aces = (c) => mul(ACES_OUT, mul(ACES_IN, c.map((x) => x / 0.6)).map(rrt)).map((x) => Math.min(1, Math.max(0, x)));
function untoned(color) {
  const want = color.toArray();
  let c = [...want];
  for (let i = 0; i < 80; i++) {
    const got = aces(c);
    c = c.map((x, k) => Math.max(0, x + (want[k] - got[k]) * 4));
  }
  return new THREE.Color().fromArray(c);
}

// An act's colour grade (mood.js `grade`), on the finished image: a tint, saturation and
// contrast about mid-grey, with the shadows leaning toward the tint a little more than the lights.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    tint: { value: new THREE.Vector3(1, 1, 1) },
    sat: { value: 1 },
    contrast: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec3 tint; uniform float sat; uniform float contrast; varying vec2 vUv;
    void main() {
      vec4 t = texture2D(tDiffuse, vUv);
      vec3 c = t.rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, sat);
      c = (c - 0.5) * contrast + 0.5;
      c *= mix(tint * tint, tint, clamp(l * 2.0, 0.0, 1.0)); // the shadows take more of it
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), t.a);
    }`,
};
const NO_GRADE = { tint: [1, 1, 1], sat: 1, contrast: 1 };

// A tilt-shift: the top and bottom of the screen blur a little, so the board reads as a tabletop
// miniature. Two passes (across, then down), the blur growing past a sharp band round FOCUS.
const TILT = { focus: 0.52, band: 0.2, px: 2.2 };
const TiltShader = {
  uniforms: { tDiffuse: { value: null }, step: { value: new THREE.Vector2() }, focus: { value: TILT.focus }, band: { value: TILT.band } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 step; uniform float focus; uniform float band; varying vec2 vUv;
    void main() {
      float amount = smoothstep(band, 0.5, abs(vUv.y - focus));
      if (amount < 0.002) { gl_FragColor = texture2D(tDiffuse, vUv); return; } // the sharp middle: one tap, not nine
      vec2 d = step * amount;
      vec4 sum = texture2D(tDiffuse, vUv) * 0.1633;
      sum += (texture2D(tDiffuse, vUv - d) + texture2D(tDiffuse, vUv + d)) * 0.1531;
      sum += (texture2D(tDiffuse, vUv - 2.0 * d) + texture2D(tDiffuse, vUv + 2.0 * d)) * 0.12245;
      sum += (texture2D(tDiffuse, vUv - 3.0 * d) + texture2D(tDiffuse, vUv + 3.0 * d)) * 0.0918;
      sum += (texture2D(tDiffuse, vUv - 4.0 * d) + texture2D(tDiffuse, vUv + 4.0 * d)) * 0.051;
      gl_FragColor = sum;
    }`,
};

// Spells that shake the air: a shockwave ring bending the picture as it spreads (Thunderwave,
// Shatter, a fireball's blast) and a heat shimmer wobbling over flames. Up to WARPS at once, each
// (x, y in uv, age 0-1, kind 0 ring / 1 heat) with its radius in screen heights.
const WARPS = 4;
const WarpShader = {
  uniforms: {
    tDiffuse: { value: null },
    waves: { value: Array.from({ length: WARPS }, () => new THREE.Vector4(0, 0, 1, 0)) },
    radii: { value: new Array(WARPS).fill(0) },
    aspect: { value: 1 },
    time: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec4 waves[${WARPS}]; uniform float radii[${WARPS}]; uniform float aspect; uniform float time;
    varying vec2 vUv;
    void main() {
      vec2 off = vec2(0.0);
      for (int i = 0; i < ${WARPS}; i++) {
        vec4 w = waves[i];
        if (w.z >= 1.0) continue;
        vec2 d = (vUv - w.xy) * vec2(aspect, 1.0);
        float dist = length(d);
        float R = radii[i];
        if (w.w < 0.5) {
          float r = R * w.z;
          float band = R * 0.12;
          float k = smoothstep(band, 0.0, abs(dist - r)) * (1.0 - w.z);
          off += (dist > 0.0001 ? d / dist : vec2(0.0)) * k * 0.012 * sign(dist - r + 0.0001);
        } else {
          float k = smoothstep(R, R * 0.4, dist) * (1.0 - w.z) * min(1.0, w.z * 6.0);
          off += vec2(sin(vUv.y * 90.0 + time * 9.0), cos(vUv.x * 70.0 - time * 7.0)) * k * 0.0025;
        }
      }
      off.x /= aspect;
      gl_FragColor = texture2D(tDiffuse, vUv + off);
    }`,
};

// Ambient occlusion (GTAO): soft shade where wall meets floor, round the feet of figures and
// props and under ledges. Only with the Glow setting and never on a touch screen (it draws the
// scene a second time). Decals, mist, shafts, the fog's veils and sprites like smoke and dust
// (transparent, no depth) are left out of its depth pass, so they cast no shade.
const AO = { radius: 0.55, distanceExponent: 1.6, thickness: 1.2, scale: 1.1, samples: 12 };
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

let dense = () => false; // set by createPost: the renderer's pixel ratio is 1.5 or more

function aoPass(scene, camera, w, h) {
  const pass = new GTAOPass(scene, camera, w, h, undefined, AO);
  pass.blendIntensity = 0.7;
  // On a sharp screen (2 pixels a point and up) the shade is worked out at half size: soft
  // anyway, and the pass costs a quarter.
  const fit = pass.setSize.bind(pass);
  pass.setSize = (w, h) => (dense() ? fit(Math.ceil(w / 2), Math.ceil(h / 2)) : fit(w, h));
  const hide = pass._overrideVisibility.bind(pass);
  pass._overrideVisibility = function () {
    hide();
    scene.traverse((o) => {
      if (!o.visible || !(o.isMesh || o.isSprite) || Array.isArray(o.material)) return;
      if (o.material.transparent && !o.material.depthWrite) {
        o.visible = false;
        this._visibilityCache.push(o);
      }
    });
  };
  return pass;
}

export function createPost(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  dense = () => renderer.getPixelRatio() >= 1.5;
  // Multisampled edges, but not on a sharp screen: its pixels are small enough, and four samples
  // of a frame that size cost more than the ambient shade.
  const samples = () => (renderer.getPixelRatio() >= 2 ? 0 : 4);
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: samples() });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const ao = aoPass(scene, camera, size.x, size.y);
  ao.setSize(size.x, size.y);
  composer.addPass(ao);
  const warp = new ShaderPass(WarpShader);
  warp.enabled = false;
  composer.addPass(warp);
  const warps = []; // { at: Vector3, kind, radius, start, ms }
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  composer.addPass(bloom);
  // The camera is orthographic: depth is linear, and the shader must be told.
  const bokeh = new BokehPass(scene, camera, { focus: 50, aperture: 0.0035, maxblur: 0.009 });
  bokeh.materialBokeh.defines.PERSPECTIVE_CAMERA = 0;
  bokeh.materialBokeh.needsUpdate = true;
  composer.addPass(bokeh);
  const tiltX = new ShaderPass(TiltShader);
  const tiltY = new ShaderPass(TiltShader);
  composer.addPass(tiltX);
  composer.addPass(tiltY);
  const tiltSize = (w, h) => {
    tiltX.uniforms.step.value.set(TILT.px / w, 0);
    tiltY.uniforms.step.value.set(0, TILT.px / h);
  };
  tiltSize(size.x, size.y);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  const want = { tint: new THREE.Vector3(1, 1, 1), sat: 1, contrast: 1 };

  const plain = scene.background;
  let toned = plain?.isColor ? untoned(plain) : plain;
  let tonedFor = plain?.isColor ? plain.getHex() : null; // a room's mood can change the colour
  const toTarget = new THREE.Vector3();
  const look = new THREE.Vector3();
  return {
    /** Which effects to draw. */
    set({ glow, blur }) {
      bloom.enabled = glow;
      ao.enabled = glow && !coarse;
      bokeh.enabled = blur;
      tiltX.enabled = tiltY.enabled = glow && !blur; // photo mode's depth of field takes over
      grade.enabled = glow; // the grade goes with the Glow setting (photo mode's blur alone stays ungraded)
    },
    /** The act's colour grade ({ tint, sat, contrast }, or none), eased in over about a second. */
    setGrade(g = NO_GRADE, { snap = false } = {}) {
      want.tint.fromArray(g.tint);
      want.sat = g.sat;
      want.contrast = g.contrast;
      if (snap) {
        grade.uniforms.tint.value.copy(want.tint);
        grade.uniforms.sat.value = want.sat;
        grade.uniforms.contrast.value = want.contrast;
      }
    },
    /** Still easing toward the grade (the stage keeps drawing while it does). */
    grading() {
      return grade.uniforms.tint.value.distanceTo(want.tint) > 0.002 || Math.abs(grade.uniforms.sat.value - want.sat) > 0.002;
    },
    /** A shockwave ('ring') or heat shimmer ('heat') at a point on the board, `radius` in tiles. */
    warp(at, kind, { radius = 2, ms = 700 } = {}) {
      warps.push({ at: new THREE.Vector3(at.x, at.y ?? 0.4, at.z), kind, radius, start: performance.now(), ms });
      if (warps.length > WARPS) warps.shift();
    },
    /** In CSS px, with the renderer's pixel ratio. */
    setSize(w, h) {
      const n = samples();
      for (const t of [composer.renderTarget1, composer.renderTarget2]) {
        if (t.samples === n) continue;
        t.samples = n;
        t.dispose();
      }
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      tiltSize(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    },
    /** Draws a frame; the depth of field focuses on `focusAt` (a point, e.g. the camera's target). */
    render(focusAt) {
      if (bokeh.enabled) {
        camera.getWorldDirection(look);
        bokeh.uniforms.focus.value = toTarget.copy(focusAt).sub(camera.position).dot(look);
        bokeh.uniforms.aspect.value = (camera.right - camera.left) / (camera.top - camera.bottom);
        bokeh.uniforms.nearClip.value = camera.near;
        bokeh.uniforms.farClip.value = camera.far;
      }
      if (plain?.isColor && plain.getHex() !== tonedFor) {
        toned = untoned(plain);
        tonedFor = plain.getHex();
      }
      const u = grade.uniforms;
      u.tint.value.lerp(want.tint, 0.06);
      u.sat.value += (want.sat - u.sat.value) * 0.06;
      u.contrast.value += (want.contrast - u.contrast.value) * 0.06;
      const now = performance.now();
      for (let i = warps.length - 1; i >= 0; i--) if (now - warps[i].start > warps[i].ms) warps.splice(i, 1);
      warp.enabled = bloom.enabled && warps.length > 0;
      if (warp.enabled) {
        const wu = warp.uniforms;
        const height = (camera.top - camera.bottom) / camera.zoom;
        wu.aspect.value = (camera.right - camera.left) / (camera.top - camera.bottom);
        wu.time.value = now / 1000;
        for (let i = 0; i < WARPS; i++) {
          const w = warps[i];
          if (!w) {
            wu.waves.value[i].z = 1;
            continue;
          }
          const p = toTarget.copy(w.at).project(camera);
          wu.waves.value[i].set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, Math.min(0.999, (now - w.start) / w.ms), w.kind === 'heat' ? 1 : 0);
          wu.radii.value[i] = (w.radius * 0.8) / height;
        }
      }
      scene.background = toned;
      composer.render();
      scene.background = plain;
    },
  };
}
