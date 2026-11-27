// Many small meshes made of a few materials (a chain's links, a lamp's parts) drawn as one mesh
// a material: each is a draw call of its own otherwise, and again in the shadow pass and the
// Glow's depth pass. `mergeMeshes(group)` bakes every mesh under `group` into the group's own
// frame and joins those that look the same (same kind of material, colours, map, opacity) and
// carry the same attributes. A mesh whose material uses vertex colours but has none gets white,
// with `userData.alpha` (else 1) as its alpha, so links fading into the dark can share one
// material. Call it before the group goes into a cell (Board.addToCell clones the materials).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const hex = (c) => (c ? c.getHex() : '');

function look(m) {
  return [m.type, hex(m.color), hex(m.emissive), m.emissiveIntensity, m.metalness, m.roughness, m.transparent, m.opacity,
    m.vertexColors, m.map?.uuid, m.side, m.depthWrite, m.blending, m.toneMapped].join('|');
}

/** Merges the meshes under `group` (in place); returns the merged meshes. */
export function mergeMeshes(group) {
  group.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const sets = new Map();
  const meshes = [];
  group.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !Array.isArray(o.material)) meshes.push(o);
  });
  for (const o of meshes) {
    let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    if (o.material.vertexColors && !geo.attributes.color) {
      const a = o.userData.alpha ?? 1;
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 4).map((_, i) => (i % 4 === 3 ? a : 1)), 4));
    }
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) geo.deleteAttribute(name);
    geo.morphAttributes = {};
    geo.clearGroups();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, o.matrixWorld));
    const attrs = Object.keys(geo.attributes).sort().map((n) => `${n}${geo.attributes[n].itemSize}`).join(',');
    const k = `${look(o.material)}#${attrs}`;
    if (!sets.has(k)) sets.set(k, { material: o.material, geos: [], shadow: false, order: o.renderOrder });
    const s = sets.get(k);
    s.geos.push(geo);
    s.shadow ||= o.castShadow;
  }
  // Out with the parts (leaving any group that holds something else, a light say).
  for (const o of meshes) o.removeFromParent();
  const prune = (g) => {
    for (const c of [...g.children]) {
      prune(c);
      if (c.isGroup && !c.children.length) c.removeFromParent();
      else if (c.type === 'Object3D' && !c.children.length) c.removeFromParent();
    }
  };
  prune(group);
  const out = [];
  for (const s of sets.values()) {
    const geo = s.geos.length === 1 ? s.geos[0] : mergeGeometries(s.geos);
    if (!geo) continue;
    const m = new THREE.Mesh(geo, s.material);
    m.castShadow = s.shadow;
    m.renderOrder = s.order;
    m.raycast = () => {};
    group.add(m);
    out.push(m);
  }
  return out;
}
