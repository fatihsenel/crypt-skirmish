// Rigged .glb characters: KayKit packs by Kay Lousberg (CC0) for the heroes and the undead,
// Quaternius models (CC0) for the orc and the giant rats.
// Each model ships every weapon as a mesh on the hand bones; we keep the weapons a unit
// uses and drive its clips through an AnimationMixer. The packs come with ~80 clips per
// model; scripts/trim-models.js strips the files down to the clips in modelSpecs.js.
// A model that fails to load falls back to the unit's procedural figure.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { SPECS, DEFAULT_CLIPS } from './modelSpecs.js';
import { playback, keepAwake } from './tween.js';

const BASE = `${import.meta.env.BASE_URL}models/`;

const loaded = new Map(); // file -> gltf
const loading = new Map(); // file -> promise, so each file is fetched once
const settled = new Set(); // files that loaded or gave up
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); // see scripts/compress-models.js

/**
 * Load these model files (each only once, however often it's asked for). Never rejects:
 * a model that fails just isn't used, and its units get the built-in figure.
 */
export function loadModels(files) {
  return Promise.all(files.map((f) => {
    if (!loading.has(f)) {
      loading.set(f, loader.loadAsync(`${BASE}${f}.glb`)
        .then((g) => { loaded.set(f, g); })
        .catch((e) => console.warn(`Model ${f} not loaded, using the built-in figure`, e))
        .finally(() => settled.add(f)));
    }
    return loading.get(f);
  }));
}

/** True once every one of these files has loaded or given up. */
export const modelsSettled = (files) => files.every((f) => settled.has(f));

const specFor = (unit) => (unit.code === 's' && unit.name.startsWith('Risen') ? SPECS.risen : SPECS[unit.code]);

/** Bone-tied weapons for the skeletons, built in the model's own units (blade along +Y). */
function skeletonBlade() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x8d8a80, metalness: 0.6, roughness: 0.55 });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.15, 0.04), steel);
  blade.position.y = 0.75;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.07, 0.1), new THREE.MeshStandardMaterial({ color: 0x4a3b2a }));
  guard.position.y = 0.16;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 6), guard.material);
  grip.position.y = 0;
  g.add(blade, guard, grip);
  return g;
}

/**
 * Long pointed ears poking out of the sides of the head (the goblins wear the rogue's hood).
 * Built in the unscaled model's space around the head mesh, then handed to the head bone so
 * they follow every nod and swing.
 */
function addEars(scene, { mesh, color }) {
  const head = scene.getObjectByName('head');
  const skull = scene.getObjectByName(mesh);
  if (!head || !skull) return;
  const box = new THREE.Box3().setFromObject(skull);
  const size = box.getSize(new THREE.Vector3());
  const mid = box.getCenter(new THREE.Vector3());
  const skin = new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true });
  const len = size.x * 0.65;
  for (const side of [-1, 1]) {
    // A flattened four-sided cone, tip outward and a little up and back.
    const geo = new THREE.ConeGeometry(size.y * 0.13, len, 4);
    geo.translate(0, len / 2, 0);
    geo.scale(1, 1, 0.45);
    const ear = new THREE.Mesh(geo, skin);
    ear.castShadow = true;
    ear.position.set(mid.x + side * size.x * 0.4, mid.y - size.y * 0.08, mid.z - size.z * 0.05);
    ear.rotation.set(-0.25, 0, -side * (Math.PI / 2 - 0.45));
    scene.add(ear);
    ear.updateMatrixWorld(true);
    head.attach(ear);
  }
}

const recolored = new Map(); // atlas uuid + recipe -> texture

/**
 * The model's texture atlas with its green cloth turned another hue (a colour multiply can
 * only darken green). Pixels whose hue is green (or within `from`, in degrees) get `hue`,
 * their saturation and lightness scaled by `sat` and `light`; skin, leather and steel are
 * left alone.
 */
function recolorMap(map, { hue, sat = 1, light = 1, from = [70, 170] }) {
  const key = `${map.uuid}:${hue}:${sat}:${light}:${from}`;
  if (recolored.has(key)) return recolored.get(key);
  const { width: w, height: h } = map.image;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(map.image, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const c = new THREE.Color();
  const hsl = {};
  for (let i = 0; i < img.data.length; i += 4) {
    const d = img.data;
    c.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
    c.getHSL(hsl);
    if (hsl.h < from[0] / 360 || hsl.h > from[1] / 360 || hsl.s < 0.15) continue;
    c.setHSL(hue / 360, Math.min(1, hsl.s * sat), Math.min(1, hsl.l * light));
    d[i] = c.r * 255;
    d[i + 1] = c.g * 255;
    d[i + 2] = c.b * 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = map.clone();
  tex.source = new THREE.Source(canvas);
  tex.needsUpdate = true;
  recolored.set(key, tex);
  return tex;
}

function necroStaff() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 2.2, 7),
    new THREE.MeshStandardMaterial({ color: 0x2c2420, roughness: 0.9 }));
  shaft.position.y = 0.2;
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0x40ff80, emissive: 0x30ff70, emissiveIntensity: 2 }));
  orb.position.y = 1.4;
  g.add(shaft, orb);
  return { g, orb };
}

/**
 * A ready-to-place figure for `unit`, or null if this unit has no .glb (or it failed to load).
 * Returns { root, height, gltf: rig } where rig plays clips (see GltfRig).
 */
export function buildGltfModel(unit) {
  const spec = specFor(unit);
  const src = spec && loaded.get(spec.file);
  if (!src) return null;

  const scene = cloneSkinned(src.scene);
  const show = new Set([...(spec.show ?? []), ...(spec.ranged ?? [])]);
  const props = [];
  const ranged = [];
  const melee = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    // Weapons and props hang off the hand slots; hats and helmets stay.
    if (!o.isSkinnedMesh && o.parent?.name.startsWith('handslot')) {
      props.push(o);
      o.visible = show.has(o.name);
      if (spec.ranged?.includes(o.name)) {
        o.visible = false;
        ranged.push(o);
      } else if (o.visible) melee.push(o);
    }
    if (spec.hide?.includes(o.name)) o.visible = false;
    if (spec.tint || spec.recolor || spec.ghost) o.material = o.material.clone();
    if (spec.tint) o.material.color.multiply(new THREE.Color(spec.tint));
    if (spec.ghost) { // see-through and faintly glowing (specters, the banshee)
      Object.assign(o.material, { transparent: true, opacity: spec.ghost, depthWrite: false });
      o.material.emissive?.set(spec.tint ?? 0xffffff);
      if (o.material.emissive) o.material.emissiveIntensity = 0.35;
    }
    if (spec.recolor && o.material.map) o.material.map = recolorMap(o.material.map, spec.recolor);
  });

  let flare = null;
  const hand = scene.getObjectByName('handslotr') ?? scene.getObjectByName('handslot.r');
  if (spec.blade && hand) hand.add(skeletonBlade());
  if (spec.staff && hand) {
    const { g, orb } = necroStaff();
    hand.add(g);
    flare = () => {
      orb.material.emissiveIntensity = 8;
      setTimeout(() => { orb.material.emissiveIntensity = 2; }, 700);
    };
  }

  // Scale to the miniature's height (the packs are about 2.4 units tall).
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  scene.traverse((o) => {
    if (o.isMesh && !o.parent?.name.startsWith('handslot')) box.expandByObject(o);
  });
  if (spec.ears) addEars(scene, spec.ears);
  const s = spec.height / (box.max.y - box.min.y);
  scene.scale.setScalar(s);
  scene.position.y = -box.min.y * s;

  const root = new THREE.Group();
  root.add(scene);
  const rig = new GltfRig(scene, src.animations, { ...DEFAULT_CLIPS, ...spec.clips }, { ranged, melee });
  return { root, height: spec.height, gltf: rig, flare, dieAxis: spec.quadruped ? 'z' : undefined };
}

/** Plays clips on one figure: a looping base (idle / walk) and one-shot actions on top. */
export class GltfRig {
  constructor(scene, animations, names, weapons) {
    this.mixer = new THREE.AnimationMixer(scene);
    // Quaternius clips carry their armature as a prefix ("RatArmature|Rat_Walk").
    this.clips = new Map(animations.map((c) => [c.name.split('|').pop(), c]));
    this.names = names;
    this.weapons = weapons;
    this.base = null;     // current looping action
    this.oneShot = null;  // current one-shot action, if any
    this.holdLast = false; // a death pose stays put
  }

  has(kind) {
    return this.clips.has(this.names[kind]);
  }

  action(kind) {
    const clip = this.clips.get(this.names[kind]);
    return clip ? this.mixer.clipAction(clip) : null;
  }

  /** Keep the looping base in step with walking / standing. */
  update(dt, walking) {
    if (!this.oneShot && !this.holdLast) {
      const want = this.action(walking ? 'walk' : 'idle');
      if (want && want !== this.base) {
        want.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.15).play();
        want.timeScale = walking ? 1.25 : 1;
        this.base?.fadeOut(0.15);
        this.base = want;
      }
    }
    this.mixer.update(dt * playback.rate); // sped up with monster turns
  }

  /**
   * Play a one-shot clip. `at` (0..1) resolves `hit` at that point of the clip (the moment
   * a blow lands or a spell leaves the hand); `done` resolves when it has finished.
   */
  play(kind, { at = 0.5, speed = 1, hold = false } = {}) {
    const a = this.action(kind);
    if (!a) return { hit: Promise.resolve(), done: Promise.resolve() };
    // The mixer already runs at playback.rate; the timers below must keep pace with it.
    const len = (a.getClip().duration / speed / playback.rate) * 1000;
    keepAwake(len + 300);
    this.oneShot?.fadeOut(0.1);
    a.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.1).play();
    a.clampWhenFinished = true;
    a.timeScale = speed;
    this.base?.fadeOut(0.1);
    this.base = null;
    this.oneShot = a;
    if (hold) this.holdLast = true;
    const hit = new Promise((r) => setTimeout(r, len * at));
    const done = new Promise((r) => setTimeout(r, len)).then(() => {
      if (this.oneShot === a && !hold) {
        this.oneShot = null; // update() fades the base loop back in
        a.fadeOut(0.2);
      }
    });
    return { hit, done };
  }

  /** Jump straight to the end of a clip (corpses already lying on the floor). */
  pose(kind) {
    const a = this.action(kind);
    if (!a) return;
    this.base?.stop();
    a.reset().setLoop(THREE.LoopOnce, 1).play();
    a.clampWhenFinished = true;
    a.time = a.getClip().duration;
    this.oneShot = a;
    this.holdLast = true;
    this.mixer.update(0);
  }

  /** Swap the melee weapons for the ranged ones while shooting. */
  drawRanged(on) {
    if (!this.weapons.ranged.length) return;
    for (const o of this.weapons.ranged) o.visible = on;
    for (const o of this.weapons.melee) o.visible = !on;
  }
}
