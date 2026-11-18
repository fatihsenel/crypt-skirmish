// A unit on the board: its rigged model (models.js) on a miniature base,
// a name/HP label, and animations (idle, walk, melee swing, ranged/cast, death).

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { tween, easeOut, easeInOut, linear } from './tween.js';
import { buildModel } from './models.js';
import { buildGltfModel } from './gltfModels.js';
import { sfx } from '../audio/sfx.js';

const lerp = (a, b, t) => a + (b - a) * t;
const easeIn = (t) => t * t * t;

function buildBase(unit) {
  const base = new THREE.Group();
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.43, 0.07, 32),
    new THREE.MeshStandardMaterial({
      color: unit.team === 'heroes' ? 0xc9a24a : 0x8f2b2b,
      metalness: 0.45,
      roughness: 0.45,
    }),
  );
  rim.position.y = 0.035;
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(0.37, 0.37, 0.01, 32),
    new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.95 }),
  );
  top.position.y = 0.072;
  rim.receiveShadow = top.receiveShadow = true;
  rim.castShadow = true;
  base.add(rim, top);
  return base;
}

export class UnitView {
  constructor(unit, stage) {
    this.unit = unit;
    this.stage = stage;
    this.group = new THREE.Group();
    this.group.userData.unitId = unit.id;
    this.group.position.set(unit.x, 0, unit.z);

    this.base = buildBase(unit);
    this.group.add(this.base);

    // `figure` turns to face targets; `model.root` sits on top of the base.
    this.figure = new THREE.Group();
    this.figure.position.y = 0.075;
    // A rigged .glb figure where there is one, else the procedural miniature.
    this.model = buildGltfModel(unit) ?? buildModel(unit);
    this.rig = this.model.gltf ?? null;
    this.figure.add(this.model.root);
    this.group.add(this.figure);
    this.figure.rotation.y = unit.team === 'heroes' ? Math.PI / 4 : -Math.PI * 0.75;

    // animation state
    this.walking = false;
    this.phase = 0;
    this.armsBusy = false;
    this.seed = Math.random() * 10;
    this.tick = (t, dt) => this.animate(t, dt);
    stage.tickers.add(this.tick);

    const el = document.createElement('div');
    el.className = `unit-label ${unit.team}`;
    el.innerHTML = `<span class="tags"></span><span class="name"></span><span class="hpbar"><i></i></span>`;
    el.querySelector('.name').textContent = unit.name;
    this.label = new CSS2DObject(el);
    this.label.position.y = this.model.height + 0.2;
    this.group.add(this.label);
    this.updateHp();
    if (unit.corpse) this.layDead();
  }

  /** Corpses placed on the map start out lying on the floor, with no base or label. */
  layDead() {
    this.base.visible = false;
    this.label.visible = false;
    this.figure.rotation.y = this.unit.variant * 1.7;
    if (this.rig) this.rig.pose('dead');
    else this.deadPose(1);
    this.fadeMeshes(0.75);
  }

  deadPose(t) {
    const fig = this.model.root;
    if (this.model.dieAxis === 'z') fig.rotation.z = (Math.PI / 2) * t;
    else fig.rotation.x = -(Math.PI / 2) * t;
    fig.position.y = -0.05 * t;
  }

  /** Makes every mesh translucent (cloning materials so other figures are unaffected). */
  fadeMeshes(opacity) {
    if (!this.fadeList) {
      this.fadeList = [];
      this.group.traverse((o) => {
        if (o.isMesh) {
          o.material = o.material.clone();
          o.material.transparent = true;
          this.fadeList.push(o);
        }
        if (o.isLight) o.intensity = 0;
      });
    }
    for (const o of this.fadeList) o.material.opacity = opacity;
  }

  /** A body sinks away (a corpse that was raised as something else). */
  async vanish() {
    const start = this.fadeList?.[0]?.material.opacity ?? 1;
    await tween(600, (t) => {
      this.fadeMeshes(start * (1 - t));
      this.group.position.y = -0.15 * t;
    });
    this.gone = true;
    this.group.visible = false;
  }

  /** Clawing up out of the ground (Animate Dead). */
  async rise() {
    if (this.rig?.has('rise')) {
      this.label.visible = false;
      await this.rig.play('rise').done;
      this.label.visible = true;
      return;
    }
    const fig = this.model.root;
    this.label.visible = false;
    fig.position.y = -this.model.height;
    fig.rotation.x = -0.5;
    await tween(900, (t) => {
      fig.position.y = -this.model.height * (1 - t);
      fig.rotation.x = -0.5 * (1 - t) + Math.sin(t * Math.PI * 4) * 0.05 * (1 - t);
    }, easeOut);
    fig.position.y = 0;
    fig.rotation.x = 0;
    this.label.visible = true;
  }

  // --- per-frame animation ----------------------------------------------------
  animate(t, dt) {
    if (this.rig) {
      this.rig.update(dt, this.walking);
      return;
    }
    if (!this.unit.alive) return;
    const m = this.model;
    const k = 1 - Math.exp(-dt * 14); // smoothing toward target pose
    if (this.walking) this.phase += dt * 13;
    const swing = this.walking ? Math.sin(this.phase) : 0;

    if (m.legL) {
      m.legL.rotation.x = lerp(m.legL.rotation.x, swing * 0.65, k);
      m.legR.rotation.x = lerp(m.legR.rotation.x, -swing * 0.65, k);
    }
    if (m.skirt) m.skirt.rotation.z = lerp(m.skirt.rotation.z, swing * 0.07, k);
    if (!this.armsBusy) {
      m.armL.rotation.x = lerp(m.armL.rotation.x, m.rest.armL - swing * 0.4, k);
      m.armR.rotation.x = lerp(m.armR.rotation.x, m.rest.armR + swing * 0.4, k);
    }
    const ts = t + this.seed;
    const breathe = Math.sin(ts * 2.2) * 0.008;
    const step = this.walking ? Math.abs(Math.sin(this.phase)) * 0.025 : 0;
    m.body.position.y = m.bodyY + breathe + step;
    m.idle?.(ts, this.walking);
  }

  updateHp() {
    const pct = Math.max(0, this.unit.hp / this.unit.maxHp) * 100;
    const bar = this.label.element.querySelector('.hpbar i');
    bar.style.width = `${pct}%`;
    bar.dataset.level = pct > 50 ? 'high' : pct > 25 ? 'mid' : 'low';
  }

  setActive(on) {
    this.label.element.classList.toggle('active', on);
  }

  /** Small status tags above the name (Dodging, Shield, Disengaged). */
  updateStatus() {
    const u = this.unit;
    const tags = [
      u.dodging && ['dodge', 'Dodging'],
      u.shielded && ['shield', 'Shield +5'],
      u.disengaged && ['disengage', 'Disengaged'],
      u.turned && ['turned', 'Turned'],
      u.unaware && ['unaware', 'Unaware'],
    ].filter(Boolean);
    this.label.element.querySelector('.tags').innerHTML =
      tags.map(([cls, text]) => `<i class="tag ${cls}">${text}</i>`).join('');
  }

  /** Spell-casting gesture: raise both arms, run `release`, lower them. */
  async cast(target, release) {
    if (target) await this.turnTowards(target.x, target.z);
    if (this.rig) {
      const { hit, done } = this.rig.play(target ? 'spell' : 'cast', { at: 0.4 });
      await hit;
      this.model.flare?.();
      await release?.();
      await done;
      return;
    }
    const { armR, armL, rest } = this.model;
    this.armsBusy = true;
    const r0 = armR.rotation.x;
    const l0 = armL.rotation.x;
    await tween(220, (t) => {
      armR.rotation.x = lerp(r0, -1.45, t);
      armL.rotation.x = lerp(l0, -1.25, t);
    }, easeOut);
    this.model.flare?.();
    await release?.();
    await tween(260, (t) => {
      armR.rotation.x = lerp(-1.45, rest.armR, t);
      armL.rotation.x = lerp(-1.25, rest.armL, t);
    });
    this.armsBusy = false;
  }

  /** Vanish, reappear at (x, z). */
  async teleport(x, z) {
    const fig = this.figure;
    const lbl = this.label;
    await tween(260, (t) => fig.scale.set(1 - t * 0.9, 1 + t * 0.6, 1 - t * 0.9), easeOut);
    this.group.visible = false;
    this.group.position.set(x, 0, z);
    await tween(120, () => {});
    this.group.visible = true;
    lbl.visible = true;
    await tween(300, (t) => fig.scale.set(0.1 + t * 0.9, 1.6 - t * 0.6, 0.1 + t * 0.9), easeOut);
    fig.scale.set(1, 1, 1);
  }

  faceTowards(x, z) {
    const dx = x - this.group.position.x;
    const dz = z - this.group.position.z;
    if (dx || dz) this.figure.rotation.y = Math.atan2(dx, dz);
  }

  /** Smoothly turn to face (x, z). */
  async turnTowards(x, z, ms = 140) {
    const dx = x - this.group.position.x;
    const dz = z - this.group.position.z;
    if (!dx && !dz) return;
    const from = this.figure.rotation.y;
    let to = Math.atan2(dx, dz);
    while (to - from > Math.PI) to -= Math.PI * 2;
    while (to - from < -Math.PI) to += Math.PI * 2;
    await tween(ms, (t) => { this.figure.rotation.y = lerp(from, to, t); });
  }

  // --- actions --------------------------------------------------------------
  async moveAlong(path) {
    this.walking = true;
    for (let i = 1; i < path.length; i++) {
      const from = this.group.position.clone();
      const to = new THREE.Vector3(path[i].x, 0, path[i].z);
      this.faceTowards(to.x, to.z);
      sfx.step(this.unit.code);
      const ms = from.distanceTo(to) > 1.1 ? 270 : 210; // diagonals take a bit longer
      await tween(ms, (t) => this.group.position.lerpVectors(from, to, t), linear);
    }
    this.walking = false;
  }

  /** Melee: wind up overhead, step in and strike, recover. */
  async swing(target, onImpact) {
    if (this.model.bite) return this.bite(target, onImpact);
    await this.turnTowards(target.x, target.z);
    if (this.rig) {
      const { hit, done } = this.rig.play('melee', { at: 0.45, speed: 1.15 });
      setTimeout(() => sfx.whoosh(this.unit.code === 'F'), 180);
      await hit;
      onImpact?.();
      await done;
      return;
    }
    const { armR, armL, rest } = this.model;
    this.armsBusy = true;
    const home = this.group.position.clone();
    const dir = new THREE.Vector3(target.x - home.x, 0, target.z - home.z).normalize().multiplyScalar(0.32);
    const startR = armR.rotation.x;

    await tween(190, (t) => {
      armR.rotation.x = lerp(startR, -2.9, t);
      armL.rotation.x = lerp(rest.armL, rest.armL - 0.3, t);
    }, easeOut);
    sfx.whoosh(this.unit.code === 'F');
    await tween(120, (t) => {
      armR.rotation.x = lerp(-2.9, -0.25, t);
      this.group.position.copy(home).addScaledVector(dir, t);
    }, easeIn);
    onImpact?.();
    await tween(240, (t) => {
      armR.rotation.x = lerp(-0.25, rest.armR, t);
      armL.rotation.x = lerp(rest.armL - 0.3, rest.armL, t);
      this.group.position.copy(home).addScaledVector(dir, 1 - t);
    }, easeInOut);
    this.armsBusy = false;
  }

  /** Quadruped attack: crouch, lunge with the head, snap back. */
  async bite(target, onImpact) {
    await this.turnTowards(target.x, target.z);
    const { head, body } = this.model;
    const home = this.group.position.clone();
    const dir = new THREE.Vector3(target.x - home.x, 0, target.z - home.z).normalize().multiplyScalar(0.4);
    sfx.squeak();
    await tween(160, (t) => {
      body.rotation.x = 0.15 * t;
      this.group.position.copy(home).addScaledVector(dir, -0.25 * t);
    }, easeOut);
    await tween(110, (t) => {
      body.rotation.x = 0.15 - 0.35 * t;
      head.rotation.x = 0.5 * t;
      this.group.position.copy(home).addScaledVector(dir, -0.25 + 1.25 * t);
    }, easeIn);
    onImpact?.();
    await tween(240, (t) => {
      body.rotation.x = -0.2 * (1 - t);
      head.rotation.x = 0.5 * (1 - t);
      this.group.position.copy(home).addScaledVector(dir, 1 - t);
    }, easeInOut);
  }

  /**
   * Ranged / spell: raise arms, run `release` (the projectile flight), then recover.
   * kind: 'fire' / 'necro' (cast), 'javelin' (overarm throw), 'arrow' (draw a bow)
   */
  async shoot(target, kind, release, onImpact) {
    await this.turnTowards(target.x, target.z);
    if (this.rig) {
      const spell = kind === 'fire' || kind === 'necro';
      if (kind === 'fire') sfx.cast();
      if (kind === 'necro') sfx.necro();
      if (kind === 'arrow') this.rig.drawRanged(true);
      const { hit, done } = this.rig.play(spell ? 'spell' : kind, { at: 0.45 });
      await hit;
      if (spell) this.model.flare?.();
      if (kind === 'arrow') sfx.bow();
      if (kind === 'javelin') sfx.whoosh(true);
      await release();
      onImpact?.();
      await done;
      if (kind === 'arrow') this.rig.drawRanged(false);
      return;
    }
    const { armR, armL, rest } = this.model;
    this.armsBusy = true;
    const poseR = kind === 'javelin' ? -2.8 : kind === 'arrow' ? -1.5 : -1.35;
    const spell = kind === 'fire' || kind === 'necro';
    const poseL = kind === 'arrow' ? -1.6 : spell ? -0.9 : rest.armL;
    const r0 = armR.rotation.x;
    const l0 = armL.rotation.x;
    if (kind === 'fire') sfx.cast();
    if (kind === 'necro') sfx.necro();
    await tween(220, (t) => {
      armR.rotation.x = lerp(r0, poseR, t);
      armL.rotation.x = lerp(l0, poseL, t);
    }, easeOut);
    if (spell) this.model.flare?.();
    if (kind === 'arrow') sfx.bow();
    if (kind === 'javelin') {
      sfx.whoosh(true);
      await tween(90, (t) => { armR.rotation.x = lerp(-2.8, -1.0, t); }, easeIn);
    }
    await release();
    onImpact?.();
    const r1 = armR.rotation.x;
    await tween(260, (t) => {
      armR.rotation.x = lerp(r1, rest.armR, t);
      armL.rotation.x = lerp(poseL, rest.armL, t);
    });
    this.armsBusy = false;
  }

  async flinch() {
    if (this.rig) return this.rig.play('hit', { at: 1, speed: 1.3 }).done;
    const fig = this.model.root;
    await tween(260, (t) => {
      fig.rotation.x = -Math.sin(t * Math.PI) * 0.25;
      fig.position.x = Math.sin(t * Math.PI * 6) * 0.04 * (1 - t);
    }, linear);
    fig.rotation.x = 0;
    fig.position.x = 0;
  }

  async die() {
    this.label.visible = false;
    this.walking = false;
    if (this.rig) {
      await this.rig.play('die', { hold: true }).done;
      await tween(700, (t) => this.fadeMeshes(1 - t * 0.6));
      return;
    }
    await tween(550, (t) => this.deadPose(t), easeIn);
    // little bounce on impact
    await tween(160, (t) => this.deadPose(1 - Math.sin(t * Math.PI) * 0.05));
    await tween(700, (t) => this.fadeMeshes(1 - t * 0.6));
  }

  dispose() {
    this.stage.tickers.delete(this.tick);
    this.rig?.mixer.stopAllAction();
    // CSS2DObject removes its DOM element only when removed directly.
    this.group.remove(this.label);
  }
}

/** Projectile flight between two units. kind: 'fire' | 'necro' | 'arrow' | 'javelin' */
export async function shootProjectile(scene, from, to, kind) {
  let mesh;
  const bolt = kind === 'fire' || kind === 'necro';
  if (bolt) {
    const color = kind === 'fire' ? 0xff7a1a : 0x50ff80;
    mesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), new THREE.MeshBasicMaterial({ color }));
    if (kind === 'necro') {
      // a ghostly skeletal hand: a pale core inside a green halo
      mesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0x20c050, transparent: true, opacity: 0.35, depthWrite: false })));
    }
    mesh.add(new THREE.PointLight(color, 4, 4, 1.5));
  } else {
    mesh = new THREE.Group();
    const shaftLen = kind === 'arrow' ? 0.45 : 0.75;
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, shaftLen, 6).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: kind === 'arrow' ? 0x8a6a45 : 0x6b4a2b }),
    );
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.025, 0.08, 6).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xb0b4bb, metalness: 0.7 }),
    );
    tip.position.z = shaftLen / 2 + 0.04;
    mesh.add(shaft, tip);
  }
  const a = new THREE.Vector3(from.x, 0.8, from.z);
  const b = new THREE.Vector3(to.x, 0.6, to.z);
  const dist = a.distanceTo(b);
  const arc = bolt ? 0.15 : dist * 0.07;
  mesh.position.copy(a);
  scene.add(mesh);
  const prev = a.clone();
  await tween(Math.min(650, 140 + dist * 55), (t) => {
    mesh.position.lerpVectors(a, b, t);
    mesh.position.y += Math.sin(Math.PI * t) * arc;
    if (!mesh.position.equals(prev)) mesh.lookAt(mesh.position.clone().add(mesh.position.clone().sub(prev)));
    prev.copy(mesh.position);
  }, linear);
  scene.remove(mesh);
}

/** Rising text above a unit (damage numbers, "Miss", etc). */
export function floatText(scene, at, text, cls) {
  const el = document.createElement('div');
  el.className = `float-text ${cls}`;
  el.textContent = text;
  const obj = new CSS2DObject(el);
  obj.position.set(at.x, 1.4, at.z);
  scene.add(obj);
  tween(1100, (t) => {
    obj.position.y = 1.4 + t * 0.9;
    el.style.opacity = String(t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
  }, easeOut).then(() => scene.remove(obj));
}
