// Spell light: a bolt or a blast lights the walls and figures around it. Adding a PointLight to
// the scene and taking it away again changes the light count, and every lit material then
// recompiles its shader (a hitch, worst on a phone, on the first cast). So the scene keeps a few
// point lights for good, dark until wanted, and an effect makes a SpellLight instead: a stand-in
// with the same fields (color, intensity, distance, decay, position) that it adds to its group
// and animates as before. Each frame the brightest stand-ins still in the scene lend their
// values and world position to the kept lights.

import * as THREE from 'three';

const POOL = 4;
const pool = [];
const live = new Set(); // SpellLights made and not yet found gone
let root = null;
const at = new THREE.Vector3();

export class SpellLight extends THREE.Object3D {
  constructor(color = 0xffffff, intensity = 1, distance = 0, decay = 2) {
    super();
    this.color = new THREE.Color(color);
    this.intensity = intensity;
    this.distance = distance;
    this.decay = decay;
    this.born = performance.now();
    live.add(this);
  }
}

/** Whether `o` hangs (through its parents) from the scene. */
function inScene(o) {
  while (o.parent) o = o.parent;
  return o === root;
}

/** Puts the kept lights in `scene`; returns the ticker that drives them (stage.tickers). */
export function keepSpellLights(scene) {
  root = scene;
  for (let i = 0; i < POOL; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 1, 2);
    scene.add(l);
    pool.push(l);
  }
  return () => {
    const lit = [];
    for (const s of live) {
      if (inScene(s)) lit.push(s);
      else if (performance.now() - s.born > 1000) live.delete(s); // its effect is over
    }
    lit.sort((a, b) => b.intensity - a.intensity);
    pool.forEach((l, i) => {
      const s = lit[i];
      if (!s || s.intensity <= 0) {
        l.intensity = 0;
        return;
      }
      l.color.copy(s.color);
      l.intensity = s.intensity;
      l.distance = s.distance;
      l.decay = s.decay;
      l.position.copy(s.getWorldPosition(at));
    });
  };
}
