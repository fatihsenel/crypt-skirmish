// Walls fading out of the way: instead of turning see-through (where their inner faces and seams
// show like glass), a faded wall stays solid and drops a share of its pixels in an ordered 4×4
// pattern, a screen door. It keeps its depth, so what is behind it sorts as it should.

const FRAG = `
uniform float uFade;
float ditherAt(vec2 p) {
  vec2 c = mod(floor(p), 4.0);
  int i = int(c.y) * 4 + int(c.x);
  float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return (m[i] + 0.5) / 16.0;
}
`;

/** Patches `material` once so its `uFade` (0 gone, 1 whole) drops pixels; returns the uniform. */
export function ditherable(material) {
  if (material.userData.fade) return material.userData.fade;
  const fade = { value: 1 };
  material.userData.fade = fade;
  const before = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    before?.call(material, shader, renderer);
    shader.uniforms.uFade = fade;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${FRAG}\nvoid main() {`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      if (uFade < 0.999 && ditherAt(gl_FragCoord.xy) >= uFade) discard;`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}|dither`;
  material.needsUpdate = true;
  return fade;
}
