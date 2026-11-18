// Spell and ability effects: short-lived meshes animated with tweens.

import * as THREE from 'three';
import { tween, wait, easeOut, linear } from './tween.js';

const glow = (color, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });

function dispose(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
}

/** One Magic Missile dart curving from caster to target. `i` varies the arc. */
export async function missileFx(scene, from, to, i = 0, total = 3) {
  const dart = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), glow(0xe8d4ff));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), glow(0x9b5cff, 0.45));
  dart.add(core, halo, new THREE.PointLight(0xa070ff, 3, 3, 1.5));
  const a = new THREE.Vector3(from.x, 0.95, from.z);
  const b = new THREE.Vector3(to.x, 0.65, to.z);
  // Each dart bends out sideways in its own direction.
  const side = new THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize();
  const spread = total > 1 ? (i / (total - 1) - 0.5) * 2 : 0;
  const ctrl = a.clone().lerp(b, 0.5).addScaledVector(side, spread * 1.3).add(new THREE.Vector3(0, 0.9, 0));
  const curve = new THREE.QuadraticBezierCurve3(a, ctrl, b);

  const trail = [];
  scene.add(dart);
  await tween(380 + a.distanceTo(b) * 25, (t) => {
    dart.position.copy(curve.getPoint(t));
    if (Math.random() < 0.7) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), glow(0xb48cff, 0.7));
      p.position.copy(dart.position);
      scene.add(p);
      trail.push(p);
    }
    for (const p of trail) {
      p.material.opacity *= 0.88;
      p.scale.multiplyScalar(0.93);
    }
  }, easeOut);
  scene.remove(dart);
  dispose(dart);
  // burst
  const burst = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), glow(0xc9a8ff, 0.9));
  burst.position.copy(b);
  scene.add(burst);
  tween(260, (t) => {
    burst.scale.setScalar(1 + t * 2);
    burst.material.opacity = 0.9 * (1 - t);
    for (const p of trail) p.material.opacity *= 0.8;
  }).then(() => {
    scene.remove(burst, ...trail);
    dispose(burst);
    trail.forEach(dispose);
  });
}

/** Burning Hands: flames roll outward across the cone tiles. */
export async function coneFx(scene, origin, tiles) {
  const group = new THREE.Group();
  scene.add(group);
  const light = new THREE.PointLight(0xff7a1a, 0, 6, 1.4);
  const center = tiles.reduce((c, t) => c.add(new THREE.Vector3(t.x, 0, t.z)), new THREE.Vector3())
    .divideScalar(Math.max(1, tiles.length));
  light.position.set(center.x, 0.8, center.z);
  group.add(light);

  const flames = [];
  for (const t of tiles) {
    const d = Math.hypot(t.x - origin.x, t.z - origin.z);
    for (let k = 0; k < 4; k++) {
      const color = [0xffd36b, 0xff9a3c, 0xff5a1a, 0xff7a1a][k];
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 7), glow(color, 0));
      m.position.set(t.x + (Math.random() - 0.5) * 0.6, 0.2, t.z + (Math.random() - 0.5) * 0.6);
      m.userData = { delay: d * 0.12 + Math.random() * 0.08, h: 0.6 + Math.random() * 0.7 };
      group.add(m);
      flames.push(m);
    }
  }
  await tween(900, (t) => {
    light.intensity = 9 * Math.sin(Math.min(1, t * 1.4) * Math.PI);
    for (const m of flames) {
      const lt = Math.min(1, Math.max(0, (t - m.userData.delay) / 0.55));
      const s = Math.sin(lt * Math.PI);
      m.scale.set(0.6 + s, m.userData.h * (0.3 + s * 1.4), 0.6 + s);
      m.position.y = 0.15 + lt * 0.5;
      m.material.opacity = s * 0.85;
    }
  }, linear);
  scene.remove(group);
  dispose(group);
}

/** Silvery mist swirl used for Misty Step (at both ends). */
export async function mistFx(scene, at) {
  const group = new THREE.Group();
  group.position.set(at.x, 0, at.z);
  scene.add(group);
  const puffs = Array.from({ length: 22 }, () => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), glow(0xcfd8ff, 0));
    const a = Math.random() * Math.PI * 2;
    m.userData = { a, r: 0.15 + Math.random() * 0.25, y: Math.random() * 0.9, spin: 2 + Math.random() * 2 };
    group.add(m);
    return m;
  });
  await tween(800, (t) => {
    for (const m of puffs) {
      const { a, r, y, spin } = m.userData;
      const ang = a + t * spin;
      const rr = r + t * 0.45;
      m.position.set(Math.cos(ang) * rr, 0.1 + y + t * 0.4, Math.sin(ang) * rr);
      m.scale.setScalar(1 + t * 1.6);
      m.material.opacity = Math.sin(t * Math.PI) * 0.45;
    }
  }, linear);
  scene.remove(group);
  dispose(group);
}

/** Shield: a shimmering dome that flashes up around the unit. */
export async function shieldFx(scene, at) {
  const dome = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.6, 1),
    new THREE.MeshBasicMaterial({ color: 0x8fd0ff, wireframe: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  const fill = new THREE.Mesh(new THREE.SphereGeometry(0.58, 20, 14), glow(0x5aa8ff, 0));
  dome.add(fill);
  dome.position.set(at.x, 0.55, at.z);
  scene.add(dome);
  await tween(650, (t) => {
    const s = t < 0.25 ? t / 0.25 : 1;
    dome.scale.setScalar(0.6 + s * 0.45);
    dome.rotation.y = t * 1.5;
    const o = t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75;
    dome.material.opacity = o * 0.9;
    fill.material.opacity = o * 0.25;
  }, linear);
  scene.remove(dome);
  dispose(dome);
}

/** Second Wind: green motes rising around the unit. */
export async function healFx(scene, at) {
  const group = new THREE.Group();
  group.position.set(at.x, 0, at.z);
  scene.add(group);
  const motes = Array.from({ length: 16 }, (_, i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), glow(0x7dff9a, 0));
    m.userData = { a: (i / 16) * Math.PI * 2, d: Math.random() * 0.3 };
    group.add(m);
    return m;
  });
  const light = new THREE.PointLight(0x6dff8a, 0, 3, 1.5);
  light.position.y = 0.6;
  group.add(light);
  await tween(1000, (t) => {
    light.intensity = Math.sin(t * Math.PI) * 3;
    for (const m of motes) {
      const lt = Math.min(1, Math.max(0, (t - m.userData.d) / 0.7));
      const ang = m.userData.a + lt * 2;
      m.position.set(Math.cos(ang) * 0.35, 0.1 + lt * 1.2, Math.sin(ang) * 0.35);
      m.material.opacity = Math.sin(lt * Math.PI);
    }
  }, linear);
  scene.remove(group);
  dispose(group);
}

/** Brief "!" flash over a unit taking an opportunity attack. */
export async function alertFx(scene, at) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.46, 32).rotateX(-Math.PI / 2), glow(0xff4a3a, 0));
  ring.position.set(at.x, 0.03, at.z);
  scene.add(ring);
  await tween(420, (t) => {
    ring.scale.setScalar(1 + t * 0.6);
    ring.material.opacity = Math.sin(t * Math.PI);
  });
  scene.remove(ring);
  dispose(ring);
}

/** Sacred Flame: a column of golden fire falling onto the target. */
export async function radiantFx(scene, at) {
  const group = new THREE.Group();
  group.position.set(at.x, 0, at.z);
  scene.add(group);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 3, 20, 1, true), glow(0xffd76b, 0));
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3, 12, 1, true), glow(0xfff6d0, 0));
  column.position.y = core.position.y = 1.5;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.45, 32).rotateX(-Math.PI / 2), glow(0xffc040, 0));
  ring.position.y = 0.03;
  const light = new THREE.PointLight(0xffd070, 0, 4, 1.5);
  light.position.y = 0.8;
  group.add(column, core, ring, light);
  await tween(750, (t) => {
    const drop = Math.min(1, t / 0.25); // falls from the sky
    column.scale.set(1, drop, 1);
    core.scale.set(1, drop, 1);
    column.position.y = core.position.y = 3 - 1.5 * drop;
    const o = t < 0.25 ? drop : 1 - (t - 0.25) / 0.75;
    column.material.opacity = o * 0.45;
    core.material.opacity = o * 0.9;
    ring.material.opacity = o * 0.8;
    ring.scale.setScalar(1 + t * 1.2);
    light.intensity = o * 8;
  }, linear);
  scene.remove(group);
  dispose(group);
}

/** Lightning Bolt: a jagged white-blue bolt down the line, flickering, then gone. */
export async function lightningFx(scene, from, tiles) {
  const end = tiles.at(-1) ?? from;
  const a = new THREE.Vector3(from.x, 0.8, from.z);
  const b = new THREE.Vector3(end.x, 0.7, end.z);
  const len = Math.max(1, a.distanceTo(b));
  const side = new THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize();
  const group = new THREE.Group();
  scene.add(group);
  const lights = [0.25, 0.6, 0.95].map((f) => {
    const l = new THREE.PointLight(0x9ccaff, 0, 6, 1.4);
    l.position.copy(a).lerp(b, f);
    group.add(l);
    return l;
  });
  // A fresh jagged path for each flicker.
  const bolt = () => {
    const pts = [];
    const n = Math.max(4, Math.round(len * 2));
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      if (i && i < n) p.addScaledVector(side, (Math.random() - 0.5) * 0.45).y += (Math.random() - 0.5) * 0.3;
      pts.push(p);
    }
    const path = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
    const core = new THREE.Mesh(new THREE.TubeGeometry(path, n * 4, 0.035, 5), glow(0xffffff, 1));
    const halo = new THREE.Mesh(new THREE.TubeGeometry(path, n * 4, 0.13, 6), glow(0x6aa8ff, 0.5));
    const g = new THREE.Group();
    g.add(core, halo);
    return g;
  };
  let current = null;
  let flicks = 0;
  await tween(650, (t) => {
    const want = Math.min(3, Math.floor(t * 9)); // three flickers, then fade
    if (!current || want > flicks) {
      if (current) { group.remove(current); dispose(current); }
      current = bolt();
      group.add(current);
      flicks = want;
    }
    const o = t < 0.35 ? 1 : 1 - (t - 0.35) / 0.65;
    current.children[0].material.opacity = o * (0.7 + Math.random() * 0.3);
    current.children[1].material.opacity = o * 0.5;
    for (const l of lights) l.intensity = o * (6 + Math.random() * 6);
  }, linear);
  scene.remove(group);
  dispose(group);
}

/**
 * Spiritual Weapon: a floating spectral mace that stays on the board for the fight.
 * Returns { group, flyTo(to), strike(), remove() }.
 */
export function spiritWeapon(scene, at) {
  const group = new THREE.Group();
  const mace = new THREE.Group();
  const gold = () => glow(0xffd76b, 0.85);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.55, 8), gold());
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), glow(0xfff1c0, 0.95));
  head.position.y = 0.32;
  for (let i = 0; i < 4; i++) {
    const fl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.12), gold());
    fl.position.y = 0.32;
    fl.rotation.y = (i * Math.PI) / 4;
    mace.add(fl);
  }
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), glow(0xffc84a, 0.18));
  halo.position.y = 0.3;
  mace.add(handle, head, halo);
  mace.rotation.z = 0.35;
  group.add(mace, new THREE.PointLight(0xffd070, 2.5, 3, 1.6));
  group.position.set(at.x, 0.9, at.z);
  scene.add(group);
  const bob = setInterval(() => {
    group.position.y = 0.9 + Math.sin(performance.now() / 380) * 0.06;
    mace.rotation.y += 0.04;
  }, 33);
  return {
    group,
    async flyTo(to) {
      const from = group.position.clone();
      await tween(320 + from.distanceTo(new THREE.Vector3(to.x, 0.9, to.z)) * 40, (t) => {
        group.position.x = from.x + (to.x - from.x) * t;
        group.position.z = from.z + (to.z - from.z) * t;
      }, easeOut);
    },
    async strike(toward) {
      // Swing down through the foe and back up.
      await tween(160, (t) => { mace.rotation.z = 0.35 - t * 1.9; }, easeOut);
      await tween(220, (t) => { mace.rotation.z = -1.55 + t * 1.9; });
    },
    remove() {
      clearInterval(bob);
      scene.remove(group);
      dispose(group);
    },
  };
}

/** Turn Undead: a golden ring of holy light sweeping outward. */
export async function turnFx(scene, at, radius) {
  const group = new THREE.Group();
  group.position.set(at.x, 0, at.z);
  scene.add(group);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64).rotateX(-Math.PI / 2), glow(0xffe08a, 0));
  ring.position.y = 0.04;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.5, 48, 1, true), glow(0xffd060, 0));
  wall.position.y = 0.25;
  const light = new THREE.PointLight(0xffd070, 0, radius + 2, 1.2);
  light.position.y = 1;
  group.add(ring, wall, light);
  await tween(1000, (t) => {
    const r = 0.3 + t * radius;
    ring.scale.setScalar(r);
    wall.scale.set(r, 1 - t * 0.7, r);
    const o = Math.sin(Math.min(1, t * 1.2) * Math.PI);
    ring.material.opacity = o * 0.9;
    wall.material.opacity = o * 0.3;
    light.intensity = o * 6;
  }, easeOut);
  scene.remove(group);
  dispose(group);
}

/** Animate Dead: green wisps spiralling down into a corpse. */
export async function raiseFx(scene, at) {
  const group = new THREE.Group();
  group.position.set(at.x, 0, at.z);
  scene.add(group);
  const wisps = Array.from({ length: 24 }, (_, i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), glow(i % 3 ? 0x60ff90 : 0xd0ffe0, 0));
    m.userData = { a: (i / 24) * Math.PI * 2, d: Math.random() * 0.25 };
    group.add(m);
    return m;
  });
  const sigil = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 6).rotateX(-Math.PI / 2), glow(0x40ff70, 0));
  sigil.position.y = 0.03;
  const light = new THREE.PointLight(0x40ff70, 0, 4, 1.5);
  light.position.y = 0.5;
  group.add(sigil, light);
  await tween(1100, (t) => {
    const o = Math.sin(t * Math.PI);
    light.intensity = o * 6;
    sigil.material.opacity = o * 0.9;
    sigil.rotation.y = t * 3;
    for (const m of wisps) {
      const lt = Math.min(1, Math.max(0, (t - m.userData.d) / 0.75));
      const ang = m.userData.a - lt * 5;
      const r = 0.7 * (1 - lt) + 0.05;
      m.position.set(Math.cos(ang) * r, 1.4 * (1 - lt) + 0.05, Math.sin(ang) * r);
      m.material.opacity = Math.sin(lt * Math.PI);
    }
  }, linear);
  scene.remove(group);
  dispose(group);
}

/** Fireball: a bead of fire arcs to the point, then a blast fills the radius. */
export async function fireballFx(scene, from, center, tiles, onBoom) {
  const bead = new THREE.Group();
  bead.add(
    new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), glow(0xfff0b0)),
    new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), glow(0xff7a1a, 0.6)),
    new THREE.PointLight(0xff8a2a, 4, 4, 1.4),
  );
  const a = new THREE.Vector3(from.x, 1, from.z);
  const b = new THREE.Vector3(center.x, 0.5, center.z);
  const ctrl = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 1.6 + a.distanceTo(b) * 0.15, 0));
  const curve = new THREE.QuadraticBezierCurve3(a, ctrl, b);
  scene.add(bead);
  await tween(420 + a.distanceTo(b) * 30, (t) => bead.position.copy(curve.getPoint(t)), linear);
  scene.remove(bead);
  dispose(bead);
  onBoom?.();

  const group = new THREE.Group();
  scene.add(group);
  const light = new THREE.PointLight(0xff7a1a, 0, 14, 1.2);
  light.position.set(center.x, 1.2, center.z);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), glow(0xffa040, 0.85));
  const core = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), glow(0xfff2c0, 1));
  ball.position.set(center.x, 0.4, center.z);
  core.position.copy(ball.position);
  group.add(light, ball, core);

  const flames = tiles.map((t) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 7), glow([0xffd36b, 0xff9a3c, 0xff5a1a][(t.x + t.z) % 3], 0));
    m.position.set(t.x + (Math.random() - 0.5) * 0.4, 0.2, t.z + (Math.random() - 0.5) * 0.4);
    m.userData = { delay: Math.hypot(t.x - center.x, t.z - center.z) * 0.05, h: 0.8 + Math.random() };
    group.add(m);
    return m;
  });
  const radius = tiles.reduce((r, t) => Math.max(r, Math.hypot(t.x - center.x, t.z - center.z)), 1);
  await tween(1100, (t) => {
    light.intensity = 30 * Math.sin(Math.min(1, t * 1.6) * Math.PI);
    const grow = easeOut(Math.min(1, t * 2.2));
    ball.scale.setScalar(0.2 + grow * radius * 0.9);
    ball.material.opacity = 0.75 * (1 - t);
    core.scale.setScalar(0.2 + grow * radius * 0.45);
    core.material.opacity = Math.max(0, 1 - t * 2.2);
    for (const m of flames) {
      const lt = Math.min(1, Math.max(0, (t - m.userData.delay) / 0.6));
      const s = Math.sin(lt * Math.PI);
      m.scale.set(0.6 + s, m.userData.h * (0.3 + s * 1.4), 0.6 + s);
      m.position.y = 0.15 + lt * 0.6;
      m.material.opacity = s * 0.9;
    }
  }, linear);
  scene.remove(group);
  dispose(group);
}

// --- impact particles -----------------------------------------------------------
const chipGeo = new THREE.BoxGeometry(1, 1, 1);

/**
 * A spray of small chips flying out and falling under gravity.
 * opts: color(s), count, speed, size, y (height), glowing (additive, for sparks/embers),
 * dir: {x, z} to bias the spray away from the attacker.
 */
export function burstFx(scene, at, {
  colors = [0xb01818], count = 14, speed = 2.6, size = 0.05, y = 0.65, glowing = false, dir = null, life = 650,
} = {}) {
  const group = new THREE.Group();
  scene.add(group);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const color = colors[i % colors.length];
    const m = new THREE.Mesh(chipGeo, glowing ? glow(color, 1)
      : new THREE.MeshStandardMaterial({ color, roughness: 0.6, transparent: true }));
    const s = size * (0.6 + Math.random() * 0.8);
    m.scale.set(s, s, s);
    m.position.set(at.x, y, at.z);
    const a = Math.random() * Math.PI * 2;
    const v = new THREE.Vector3(Math.cos(a), 0.6 + Math.random() * 1.1, Math.sin(a)).multiplyScalar(speed * (0.4 + Math.random() * 0.6));
    if (dir) v.add(new THREE.Vector3(dir.x, 0, dir.z).normalize().multiplyScalar(speed * 0.7));
    m.userData.v = v;
    m.userData.spin = new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(12);
    group.add(m);
    parts.push(m);
  }
  let last = 0;
  return tween(life, (t) => {
    const dt = (t - last) * (life / 1000);
    last = t;
    for (const m of parts) {
      const { v, spin } = m.userData;
      v.y -= 9.8 * dt;
      m.position.addScaledVector(v, dt);
      if (m.position.y < 0.02) {
        m.position.y = 0.02;
        v.set(v.x * 0.4, 0, v.z * 0.4); // lands and skids
      } else {
        m.rotation.x += spin.x * dt;
        m.rotation.y += spin.y * dt;
      }
      m.material.opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    }
  }, linear).then(() => {
    scene.remove(group);
    parts.forEach((m) => m.material.dispose());
  });
}

/** What spills out when a creature is hit: blood, or bone chips for the undead. */
export function hitFx(scene, target, from, { crit = false } = {}) {
  const dir = from ? { x: target.x - from.x, z: target.z - from.z } : null;
  const n = crit ? 26 : 14;
  if (target.undead) {
    return burstFx(scene, target, { colors: [0xe8e0c8, 0xcfc6ad, 0xa89f88], count: n, size: 0.06, dir, speed: 2.8 });
  }
  return burstFx(scene, target, { colors: [0x9a0f12, 0x6e0a0c, 0xc21d1d], count: n, size: 0.045, dir });
}

/** A fire bolt bursting: a flash, a ring of flame and a shower of embers. */
export async function fireBurstFx(scene, at) {
  const group = new THREE.Group();
  group.position.set(at.x, 0.6, at.z);
  scene.add(group);
  const light = new THREE.PointLight(0xff7a1a, 14, 5, 1.5);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), glow(0xffd080, 0.9));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 6, 24).rotateX(Math.PI / 2), glow(0xff6a1a, 0.8));
  group.add(light, flash, ring);
  burstFx(scene, at, { colors: [0xffd36b, 0xff8a2a, 0xff5a1a], count: 22, speed: 3.2, size: 0.04, glowing: true, y: 0.6, life: 750 });
  await tween(420, (t) => {
    flash.scale.setScalar(1 + t * 2.2);
    flash.material.opacity = 0.9 * (1 - t);
    ring.scale.setScalar(1 + t * 3);
    ring.material.opacity = 0.8 * (1 - t);
    light.intensity = 14 * (1 - t);
  }, easeOut);
  scene.remove(group);
  dispose(group);
}

// --- the d20 --------------------------------------------------------------------
/** A die face number drawn on a canvas, for the label on top of the d20. */
function numberSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = 'bold 84px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText(text, 64, 68);
  g.fillStyle = color;
  g.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.renderOrder = 10;
  return s;
}

/**
 * A d20 thrown up over `at`, tumbling, landing on `value`. A 20 lands gold, a 1 blood red.
 * Resolves once the die has landed (it lingers a moment, then fades on its own).
 */
export async function d20Fx(scene, at, value) {
  const nat20 = value === 20;
  const group = new THREE.Group();
  group.position.set(at.x, 0, at.z);
  scene.add(group);
  const die = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.42, 0),
    new THREE.MeshStandardMaterial({
      color: nat20 ? 0xe2b649 : 0x8a1a1a,
      emissive: nat20 ? 0x6a4400 : 0x501010,
      metalness: 0.35, roughness: 0.35, flatShading: true, transparent: true,
    }),
  );
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(die.geometry),
    new THREE.LineBasicMaterial({ color: nat20 ? 0xfff2c0 : 0xff9090, transparent: true }));
  die.add(edges);
  const light = new THREE.PointLight(nat20 ? 0xffd36b : 0xff3030, 0, 3, 1.5);
  light.position.y = 1.4;
  group.add(die, light);

  // Thrown from the side, up, and down with two small bounces.
  const spin = new THREE.Vector3(9 + Math.random() * 4, 7 + Math.random() * 4, 5);
  const start = new THREE.Vector3(-0.7, 1.2, 0.5);
  await tween(900, (t) => {
    const bounce = t < 0.55 ? Math.sin((t / 0.55) * Math.PI) * 1.3
      : t < 0.8 ? Math.sin(((t - 0.55) / 0.25) * Math.PI) * 0.35
        : Math.sin(((t - 0.8) / 0.2) * Math.PI) * 0.1;
    die.position.set(start.x * (1 - t), 2.1 + bounce * 0.8 + (1 - t) * 0.3, start.z * (1 - t));
    const slow = 1 - t;
    die.rotation.set(spin.x * slow * slow, spin.y * slow * slow, spin.z * slow * slow);
    light.intensity = t * 5;
  }, linear);

  const num = numberSprite(String(value), nat20 ? '#ffe9a8' : '#ff8a8a');
  num.position.set(0, 2.95, 0);
  num.scale.setScalar(0.9);
  group.add(num);
  tween(300, (t) => num.scale.setScalar(0.9 + Math.sin(t * Math.PI) * 0.4 + t * 0.1), easeOut);

  // Linger, then fade away.
  tween(1300, (t) => {
    const fade = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    die.material.opacity = fade;
    edges.material.opacity = fade;
    num.material.opacity = fade;
    light.intensity = 5 * fade;
    die.rotation.y += 0.01;
  }).then(() => {
    scene.remove(group);
    num.material.map.dispose();
    dispose(group);
  });
  await wait(250);
}
