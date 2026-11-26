// Runes around a caster as a spell goes off, drawn only: a ring of glyphs spins up round them and
// a circle opens at their feet, coloured by the spell's school (fire and force orange, warding
// blue, conjuring teal, charms pink, illusions violet, the dead green, healing gold). Reduced
// motion keeps the ring still and lets it fade.

import * as THREE from 'three';
import { tween, calm } from './tween.js';

/** Each spell's school colour (SRD 5.1 schools; healing has its own gold). */
const SCHOOLS = {
  evocation: 0xff8a3a, abjuration: 0x7cc4ff, conjuration: 0x6fe0c0, enchantment: 0xff78c8,
  illusion: 0xb08cff, necromancy: 0x5ce88a, divination: 0xdfe6ff, healing: 0xffd76a,
};
const SPELL_SCHOOL = {
  magicMissile: 'evocation', burningHands: 'evocation', scorchingRay: 'evocation', fireball: 'evocation',
  lightningBolt: 'evocation', shatter: 'evocation', thunderwave: 'evocation', callLightning: 'conjuration',
  iceStorm: 'evocation', sacredFlame: 'evocation', hellishRebuke: 'evocation', spiritualWeapon: 'evocation',
  turnUndead: 'healing', cureWounds: 'healing', healingWord: 'healing', massHealingWord: 'healing', layOnHands: 'healing',
  shield: 'abjuration', shieldOfFaith: 'abjuration', deathWard: 'abjuration', counterspell: 'abjuration',
  mistyStep: 'conjuration', fogCloud: 'conjuration', grease: 'conjuration', entangle: 'conjuration',
  viciousMockery: 'enchantment', bardicInspiration: 'enchantment', hex: 'enchantment',
  fear: 'illusion', greaterInvisibility: 'illusion', dread: 'necromancy', animateDead: 'necromancy',
  huntersMark: 'divination',
};
/** The colour for a spell id, or a bolt's kind ('fire', 'necro', 'eldritch'). */
export function schoolColor(id) {
  if (id === 'fire') return SCHOOLS.evocation;
  if (id === 'necro') return SCHOOLS.necromancy;
  if (id === 'eldritch') return 0xc070ff;
  return SCHOOLS[SPELL_SCHOOL[id]] ?? SCHOOLS.abjuration;
}

const VARIANTS = 6;
let runeMaps = null;
/** A few runes: angular strokes on a 64 px canvas, white (tinted by the material). */
function runes() {
  if (runeMaps) return runeMaps;
  runeMaps = [];
  for (let v = 0; v < VARIANTS; v++) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    let s = 31 + v * 977;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = 5;
    g.lineCap = g.lineJoin = 'round';
    g.shadowColor = 'rgba(255,255,255,0.8)';
    g.shadowBlur = 6;
    g.beginPath();
    g.moveTo(32, 10);
    g.lineTo(32, 54); // the stem
    for (let i = 0; i < 3; i++) {
      const y = 14 + r() * 34;
      g.moveTo(32, y);
      g.lineTo(32 + (r() < 0.5 ? -1 : 1) * (10 + r() * 10), y + (r() - 0.5) * 22);
    }
    g.stroke();
    const t = new THREE.CanvasTexture(c);
    runeMaps.push(t);
  }
  return runeMaps;
}

let circleMap = null;
/** The circle at the caster's feet: two rings with runes between. */
function circle() {
  if (circleMap) return circleMap;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(128, 128, 118, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2;
  g.beginPath();
  g.arc(128, 128, 92, 0, Math.PI * 2);
  g.stroke();
  const maps = runes();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.save();
    g.translate(128 + Math.cos(a) * 105, 128 + Math.sin(a) * 105);
    g.rotate(a + Math.PI / 2);
    g.drawImage(maps[i % VARIANTS].image, -10, -10, 20, 20);
    g.restore();
  }
  circleMap = new THREE.CanvasTexture(c);
  return circleMap;
}

const CIRCLE_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

/**
 * Runes spin up round a caster standing at `at` (a Vector3, its feet) in `scene`, `height` tall,
 * in `color`. Not awaited: it plays out over about a second.
 */
export function castGlyphs(scene, at, height, color) {
  const still = calm();
  const group = new THREE.Group();
  group.position.copy(at);
  scene.add(group);
  const maps = runes();
  const n = 6;
  const sprites = [];
  for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: maps[(i + Math.floor(Math.random() * VARIANTS)) % VARIANTS], color, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    s.renderOrder = 3;
    s.userData.a = (i / n) * Math.PI * 2;
    group.add(s);
    sprites.push(s);
  }
  const ring = new THREE.Mesh(CIRCLE_GEO, new THREE.MeshBasicMaterial({
    map: circle(), color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  ring.position.y = 0.02;
  ring.renderOrder = 1;
  group.add(ring);
  const y0 = height * 0.35;
  tween(still ? 700 : 1100, (t) => {
    const k = Math.sin(Math.PI * Math.min(1, t * 1.15)); // in, hold, out
    const spin = still ? 0 : t * 2.6;
    const r = 0.42 + (still ? 0 : t * 0.12);
    for (const s of sprites) {
      const a = s.userData.a + spin;
      s.position.set(Math.cos(a) * r, y0 + (still ? 0 : t * height * 0.5) + Math.sin(a * 2 + t * 6) * (still ? 0 : 0.04), Math.sin(a) * r);
      s.scale.setScalar(0.27 + (still ? 0 : 0.07 * Math.sin(Math.PI * t)));
      s.material.opacity = 0.95 * k;
    }
    const grow = still ? 1 : 0.6 + 0.6 * Math.min(1, t * 2);
    ring.scale.set(1.3 * grow, 1, 1.3 * grow);
    ring.rotation.y = still ? 0 : -t * 1.2;
    ring.material.opacity = 0.85 * k;
  }).then(() => {
    scene.remove(group);
    for (const s of sprites) s.material.dispose(); // sprites share one geometry
    ring.material.dispose();
  });
}
