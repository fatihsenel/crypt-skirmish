// Outlines on figures: a thin warm rim on the hovered one and a red rim on each foe in reach,
// so a figure reads against a busy floor. An inverted hull: each of the figure's meshes gets a
// back-faced copy pushed out along its normals in view space, so the rim is the same width on
// every model whatever its scale (and follows a rigged figure's bones). Unlit and below white,
// so it reads the same with Glow off and doesn't bloom. Only the few outlined figures carry one.

import * as THREE from 'three';

const KINDS = {
  hover: { color: 0xf0d48a, width: 0.03 },
  target: { color: 0xd83030, width: 0.03 },
};
const mats = new Map();

function material(kind) {
  if (mats.has(kind)) return mats.get(kind);
  const { color, width } = KINDS[kind];
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, toneMapped: false, fog: false });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.outlineWidth = { value: width };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float outlineWidth;\nvoid main() {')
      .replace('#include <project_vertex>', `#include <project_vertex>
  {
  #ifdef USE_SKINNING
    vec3 outlineN = objectNormal;
  #else
    vec3 outlineN = normal;
  #endif
    mvPosition.xyz += normalize(normalMatrix * outlineN) * outlineWidth;
    gl_Position = projectionMatrix * mvPosition;
  }`);
  };
  m.customProgramCacheKey = () => 'outline';
  mats.set(kind, m);
  return m;
}

/** Puts a `kind` outline on every solid mesh under `root`; returns the hulls to take off later. */
export function addOutline(root, kind) {
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh && !o.userData.outline && o.visible && !o.material.transparent && o.geometry.attributes.normal) meshes.push(o);
  });
  return meshes.map((o) => {
    let h;
    if (o.isSkinnedMesh) {
      h = new THREE.SkinnedMesh(o.geometry, material(kind));
      h.bind(o.skeleton, o.bindMatrix);
      h.bindMode = o.bindMode;
    } else {
      h = new THREE.Mesh(o.geometry, material(kind));
    }
    h.userData.outline = true;
    h.castShadow = h.receiveShadow = false;
    h.frustumCulled = o.frustumCulled;
    h.raycast = () => {};
    o.add(h);
    return h;
  });
}

export function removeOutline(hulls) {
  for (const h of hulls) h.removeFromParent();
}
