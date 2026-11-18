// Dungeon tiles and props (KayKit Dungeon Remastered by Kay Lousberg, CC0).
// The pack works on 2-unit floor tiles; our grid tiles are 1 unit, so pieces are scaled
// by half. If the files fail to load, the board falls back to its plain box walls.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = `${import.meta.env.BASE_URL}models/dungeon/`;

const FILES = [
  'floor_tile_small', 'floor_tile_small_broken_A', 'floor_tile_small_broken_B',
  'floor_tile_small_weeds_A',
  'wall_half', 'pillar', 'torch_mounted', 'chest', 'chest_gold', 'floor_tile_big_spikes',
  'banner_red', 'barrel_small', 'box_small', 'column', 'candle_lit',
];

const SHADE = { floor: 0.55, wall: 0.78, pillar: 0.78 };

const pieces = new Map();

export function preloadDungeon(onProgress) {
  const loader = new GLTFLoader();
  let done = 0;
  const tick = () => onProgress?.(++done, FILES.length);
  onProgress?.(0, FILES.length);
  return Promise.all(FILES.map((f) => loader.loadAsync(`${BASE}${f}.glb`)
    .then((g) => {
      // The pack is bright and cheerful; dim it to crypt stone (floors most, so the
      // tile highlights stand out on them).
      const shade = SHADE[f.split('_')[0]] ?? 0.85;
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = o.receiveShadow = true;
        o.material = o.material.clone();
        o.material.color.multiplyScalar(shade);
      });
      pieces.set(f, g.scene);
    })
    .catch((e) => console.warn(`Dungeon piece ${f} not loaded`, e))
    .finally(tick)));
}

/** True once the pieces the board needs are all here. */
export const kitReady = () => ['floor_tile_small', 'wall_half', 'pillar'].every((f) => pieces.has(f));

/** A fresh copy of a piece (geometry is shared; the board clones materials per tile). */
export function piece(name) {
  return pieces.get(name)?.clone(true) ?? null;
}
