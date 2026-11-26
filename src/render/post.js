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

export function createPost(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  composer.addPass(bloom);
  // The camera is orthographic: depth is linear, and the shader must be told.
  const bokeh = new BokehPass(scene, camera, { focus: 50, aperture: 0.0035, maxblur: 0.009 });
  bokeh.materialBokeh.defines.PERSPECTIVE_CAMERA = 0;
  bokeh.materialBokeh.needsUpdate = true;
  composer.addPass(bokeh);
  composer.addPass(new OutputPass());

  const plain = scene.background;
  let toned = plain?.isColor ? untoned(plain) : plain;
  let tonedFor = plain?.isColor ? plain.getHex() : null; // a room's mood can change the colour
  const toTarget = new THREE.Vector3();
  const look = new THREE.Vector3();
  return {
    /** Which effects to draw. */
    set({ glow, blur }) {
      bloom.enabled = glow;
      bokeh.enabled = blur;
    },
    /** In CSS px, with the renderer's pixel ratio. */
    setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
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
      scene.background = toned;
      composer.render();
      scene.background = plain;
    },
  };
}
