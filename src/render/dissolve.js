// A figure burning away: fragments under a noise threshold are dropped, and a glowing rim runs
// along the edge. Patched into a figure's own materials (UnitView.ownMeshes), so the shader
// is shared by every dissolving figure and costs nothing until one dies.

import * as THREE from 'three';

const NOISE = /* glsl */ `
uniform float uDissolve;
uniform float uDissolveGlow;
uniform vec3 uDissolveEdge;
varying vec3 vDissolvePos;
float dHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float dNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dHash(i), dHash(i + vec3(1, 0, 0)), f.x), mix(dHash(i + vec3(0, 1, 0)), dHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(dHash(i + vec3(0, 0, 1)), dHash(i + vec3(1, 0, 1)), f.x), mix(dHash(i + vec3(0, 1, 1)), dHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

/** The rim's colour for a dying figure: pale blue for the undead, green for oozes, else embers. */
export function edgeColor(unit) {
  if (unit.undead) return 0x7fd4ff;
  if (unit.code === 'j' || unit.code === 'i') return 0x8cff5a;
  return 0xff6a14;
}

const uniforms = new WeakMap(); // material -> its uniforms

/**
 * Lets `material` dissolve; returns its uniforms ({ amount, glow, edge }, each `.value`).
 * amount 0 is whole and 1 is gone; glow scales the rim.
 */
export function dissolvable(material, color) {
  let u = uniforms.get(material);
  if (u) return u;
  u = { amount: { value: 0 }, glow: { value: 1 }, edge: { value: new THREE.Color(color) } };
  uniforms.set(material, u);
  const before = material.onBeforeCompile; // a rim light (rim.js) chains on
  material.onBeforeCompile = (shader, renderer) => {
    before?.call(material, shader, renderer);
    shader.uniforms.uDissolve = u.amount;
    shader.uniforms.uDissolveGlow = u.glow;
    shader.uniforms.uDissolveEdge = u.edge;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDissolvePos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvDissolvePos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    const rim = 'float dn = dNoise(vDissolvePos * 9.0) * 0.65 + dNoise(vDissolvePos * 23.0) * 0.35;\n'
      + 'if (uDissolve > 0.0 && dn < uDissolve) discard;\n'
      + 'float dRim = uDissolve > 0.0 ? (1.0 - smoothstep(uDissolve, uDissolve + 0.06, dn)) * uDissolveGlow : 0.0;\n';
    let frag = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${rim}`);
    frag = frag.includes('#include <emissivemap_fragment>')
      ? frag.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uDissolveEdge * dRim * 4.0;')
      : frag.replace('#include <opaque_fragment>', 'outgoingLight += uDissolveEdge * dRim * 2.0;\n#include <opaque_fragment>');
    shader.fragmentShader = frag;
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}|dissolve`;
  material.needsUpdate = true;
  return u;
}
