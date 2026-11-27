// A thin rim of light round each figure's silhouette, cool for heroes and warm for foes, so a
// figure stands off the floor at any zoom; and a soft contact shadow under its base. Drawn only.
// The rim is a Fresnel term added to the material's emission, kept dim enough (RIM) that the
// glow's bloom never catches it.

import * as THREE from 'three';

const RIM = 0.32;
const COLORS = { heroes: 0x8ab8ff, monsters: 0xffa070 };

/** Gives a lit `material` its team's rim (patched once; other patches chain after it). */
export function rimLight(material, team) {
  if (material.userData.rim || !material.isMeshStandardMaterial && !material.isMeshLambertMaterial && !material.isMeshPhongMaterial) return;
  const color = new THREE.Color(COLORS[team] ?? COLORS.monsters).multiplyScalar(RIM);
  material.userData.rim = { value: color };
  const before = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    before?.call(material, shader, renderer);
    shader.uniforms.uRim = material.userData.rim;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec3 rimView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
        float rimF = 1.0 - clamp(abs(dot(normal, rimView)), 0.0, 1.0);
        totalEmissiveRadiance += uRim * rimF * rimF * rimF;
      }`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}|rim`;
  material.needsUpdate = true;
}

let shadowMap = null;
function shadowTexture() {
  if (shadowMap) return shadowMap;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 14, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  shadowMap = new THREE.CanvasTexture(c);
  return shadowMap;
}
const SHADOW_GEO = new THREE.PlaneGeometry(1.05, 1.05).rotateX(-Math.PI / 2);

/** A dark soft disc on the floor under a figure's base. */
export function contactShadow() {
  const mesh = new THREE.Mesh(SHADOW_GEO, new THREE.MeshBasicMaterial({
    map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.55,
    polygonOffset: true, polygonOffsetFactor: -4,
  }));
  mesh.position.y = 0.013;
  mesh.renderOrder = 1;
  mesh.raycast = () => {};
  mesh.userData.outline = true; // not one of the figure's own meshes (flash, dissolve)
  return mesh;
}
