// A unit on the board: its rigged model (models.js) on a miniature base,
// a name/HP label, and animations (idle, walk, melee swing, ranged/cast, death).

import * as THREE from 'three';
import { addOutline, removeOutline } from './outline.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { tween, wait, easeOut, easeInOut, linear, calm, keepAwake } from './tween.js';
import { buildModel } from './models.js';
import { buildGltfModel } from './gltfModels.js';
import { sfx } from '../audio/sfx.js';
import { voices } from '../audio/voices.js';
import { liftAt } from './board.js';
import { dissolvable, edgeColor } from './dissolve.js';
import { SpellLight } from './lights.js';
import { slashFx, dustFx } from './effects.js';
import { Auras } from './auras.js';
import { castGlyphs, schoolColor } from './glyphs.js';

const lerp = (a, b, t) => a + (b - a) * t;
const WHITE = new THREE.Color(0xffffff);
// A slain monster's body: this much burned away (dissolve.js), and this opaque. A fallen
// hero only fades (they can get up again), to HERO_BODY.
const BODY_GONE = 0.45;
const BODY = 0.6;
const HERO_BODY = 0.4;
/** Gives a mesh a material of its own, once. */
const own = (o) => {
  if (!o.userData.ownMat) {
    o.material = o.material.clone();
    o.userData.ownMat = true;
  }
  return o;
};
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
  if (unit.elite) { // New Game+ elite: a gold band around the base
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.44, 0.04, 10, 48).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xffd36b, emissive: 0xb07a20, emissiveIntensity: 0.9, metalness: 0.6, roughness: 0.3 }),
    );
    band.position.y = 0.075;
    band.name = 'elite-band';
    base.add(band);
  }
  return base;
}

/** The whose-turn-is-it marker: a bright gold ring on the floor with a pulsing halo. */
function buildMarker() {
  const glow = (opacity) => new THREE.MeshBasicMaterial({
    color: 0xffd36b, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.52, 48).rotateX(-Math.PI / 2), glow(0.95));
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.62, 48).rotateX(-Math.PI / 2), glow(0.35));
  ring.position.y = 0.015;
  halo.position.y = 0.014;
  g.add(ring, halo);
  g.userData.halo = halo;
  g.visible = false;
  return g;
}

export class UnitView {
  constructor(unit, stage) {
    this.unit = unit;
    this.stage = stage;
    this.group = new THREE.Group();
    this.group.userData.unitId = unit.id;
    this.group.position.set(unit.x, 0, unit.z);

    // `raise` lifts the figure onto a ledge (rules 11); `group` itself drops it into pits and chasms.
    this.raise = new THREE.Group();
    this.raise.position.y = liftAt(unit.x, unit.z);
    this.group.add(this.raise);
    this.base = buildBase(unit);
    this.marker = buildMarker();
    this.raise.add(this.base, this.marker);

    // `figure` turns to face targets; `model.root` sits on top of the base.
    this.figure = new THREE.Group();
    this.figure.position.y = 0.075;
    // A rigged .glb figure where there is one, else the procedural miniature.
    this.model = buildGltfModel(unit) ?? buildModel(unit);
    this.rig = this.model.gltf ?? null;
    // `tilt` lays the figure down while it is prone.
    this.tilt = new THREE.Group();
    this.tilt.add(this.model.root);
    // `lean` stoops a badly hurt figure (below half HP) and sways it (below a quarter).
    // It also turns the figure's gaze a little (idle glances, a look toward a nearby blow).
    this.lean = new THREE.Group();
    this.lean.rotation.order = 'YXZ';
    this.lean.add(this.tilt);
    this.figure.add(this.lean);
    this.hurt = 0; // 0 unhurt, 1 below half, 2 below a quarter (from the bar as drawn)
    this.hurtGlow = null;
    this.prone = false;
    this.auras = new Auras(this.raise, this.model.height); // conditions drawn on the figure
    this.held = false; // paralysed or turned to stone: the pose holds
    this.gaze = { yaw: 0, roll: 0, until: 0, next: 3 + Math.random() * 6 };
    this.raise.add(this.figure);
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
    el.innerHTML = `<span class="tags"></span><span class="name"></span><span class="hpbar"><i></i><b></b><s class="may"></s><s class="sure"></s></span>`;
    el.querySelector('.name').textContent = unit.name;
    this.label = new CSS2DObject(el);
    this.label.position.y = this.model.height + 0.2;
    this.raise.add(this.label);
    this.updateHp();
    if (unit.corpse) this.layDead();
  }

  /** Corpses placed on the map start out lying on the floor, with no base or label. */
  layDead() {
    this.down = true;
    this.base.visible = false;
    this.label.visible = false;
    this.figure.rotation.y = this.unit.variant * 1.7;
    if (this.rig) this.rig.pose('dead');
    else this.deadPose(1);
    this.fadeMeshes(0.75);
  }

  /** Already dead when the view is made (a restored fight): no fall, just the body. */
  restoreDead() {
    if (this.unit.raised) {
      this.gone = true;
      this.group.visible = false;
      return;
    }
    if (this.unit.corpse) return; // laid out in the constructor
    this.down = true;
    this.label.visible = false;
    if (this.rig) this.rig.pose('dead');
    else this.deadPose(1);
    if (this.unit.team === 'heroes') return this.fadeMeshes(HERO_BODY);
    this.setDissolve(BODY_GONE, 0);
    this.fadeMeshes(BODY);
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
        if (o.isMesh && !o.userData.outline) {
          own(o);
          o.material.transparent = true;
          this.fadeList.push(o);
        }
        if (o.isLight) (this.fadeLights ??= []).push([o, o.intensity]);
      });
    }
    for (const o of this.fadeList) o.material.opacity = opacity;
    for (const [o, lit] of this.fadeLights ?? []) o.intensity = opacity >= 1 ? lit : 0; // back on once whole (off the stairs)
  }

  /** The figure's meshes, each with a material of its own (a flash or a dissolve touches only this figure). */
  ownMeshes() {
    if (!this.owned) {
      this.owned = [];
      this.model.root.traverse((o) => {
        if (o.isMesh && !o.userData.outline && !Array.isArray(o.material)) this.owned.push(own(o));
      });
    }
    return this.owned;
  }

  /**
   * Struck: the figure flashes white for a moment and both figures' clips pause briefly (a
   * hit-stop). Dim and short, so a flurry of hits doesn't strobe; fainter and with no pause
   * under reduced motion.
   */
  impact(crit, attacker) {
    const still = calm();
    const peak = still ? 0.15 : crit ? 0.45 : 0.32;
    const lit = this.ownMeshes().map((o) => o.material).filter((m) => m.emissive);
    for (const m of lit) m.userData.glow ??= { c: m.emissive.clone(), i: m.emissiveIntensity };
    const id = (this.flashId = (this.flashId ?? 0) + 1);
    tween(170, (t) => {
      if (id !== this.flashId) return; // a newer hit took over
      for (const m of lit) {
        const { c, i } = m.userData.glow;
        if (t >= 1) {
          m.emissive.copy(c);
          m.emissiveIntensity = i;
        } else {
          m.emissive.copy(c).lerp(WHITE, peak * (1 - t));
          m.emissiveIntensity = Math.max(i, 1);
        }
      }
    }, linear);
    if (still) return;
    const ms = crit ? 90 : 60;
    this.rig?.freeze(ms);
    attacker?.rig?.freeze(ms);
  }

  /** How far the figure has burned away (0 whole, 1 gone) and how bright the burning rim is. */
  setDissolve(amount, glow = 1) {
    const color = edgeColor(this.unit);
    for (const o of this.ownMeshes()) {
      const u = dissolvable(o.material, color);
      u.amount.value = amount;
      u.glow.value = glow;
      o.userData.castShadow ??= o.castShadow;
      o.castShadow = amount > 0 ? false : o.userData.castShadow; // holes would still cast a whole shadow
    }
    this.dissolved = amount;
  }

  /** A slain monster burns partly away, its rim glowing, then cooling. */
  async burnAway() {
    await tween(900, (t) => {
      this.setDissolve(BODY_GONE * t);
      this.fadeMeshes(1 - t * (1 - BODY));
    }, linear);
    await tween(450, (t) => this.setDissolve(BODY_GONE, 1 - t), linear);
  }

  /** A body sinks away (a corpse that was raised as something else). */
  async vanish() {
    const start = this.fadeList?.[0]?.material.opacity ?? 1;
    const from = this.dissolved ?? 0;
    const burns = this.unit.team !== 'heroes';
    await tween(burns ? 800 : 600, (t) => {
      if (burns) this.setDissolve(from + (1 - from) * t);
      this.fadeMeshes(start * (1 - (burns ? t * t : t)));
      this.group.position.y = -0.15 * t;
    });
    this.gone = true;
    this.group.visible = false;
  }

  /** Pushed: a stagger back onto (x, z), facing whoever pushed. */
  async shoved(x, z) {
    const from = this.group.position.clone();
    const to = new THREE.Vector3(x, 0, z);
    await tween(260, (t) => this.group.position.lerpVectors(from, to, t), easeOut);
    this.dust({ x: to.x - from.x, z: to.z - from.z });
  }

  /** A melee swing's trail across the figure's front (render/effects.js). */
  trail(target, crit = false) {
    const p = this.group.position;
    slashFx(this.stage.scene, { x: p.x, y: this.raise.position.y, z: p.z }, target, {
      crit,
      y: Math.min(0.75, this.model.height * 0.55), flip: Math.random() < 0.35,
    });
  }

  /** Dust kicked up round the figure's feet: knocked down, shoved, landing. */
  dust(dir = null, opts = {}) {
    if (!this.group.visible || this.gone) return;
    const p = this.group.position;
    dustFx(this.stage.scene, p, { dir, y: this.raise.position.y + Math.max(0, p.y), ...opts });
  }

  /** Over a chasm's edge: a drop into the dark, and gone. */
  async plunge() {
    this.down = true;
    this.label.visible = false;
    this.marker.visible = false;
    this.base.visible = false;
    const fig = this.figure;
    await tween(650, (t) => {
      this.group.position.y = -3.2 * t * t;
      fig.rotation.x = -1.2 * t;
      this.fadeMeshes(1 - t);
    }, easeIn);
    this.gone = true;
    this.group.visible = false;
  }

  /**
   * Down (or up) a stair to the room's other floor: the figure sinks out of sight on the stair at
   * `from`, then climbs into view on the one at `to`. Reduced motion: a fade out and in, in place.
   */
  /**
   * Down (or up) a flight of steps to its linked stair on the other floor: the figure walks along
   * `out`'s steps, sinking into the well or climbing out of sight, then comes along `back`'s steps
   * onto the far stair. Each is the board's flight there ({ dx, dz, down }). `onEnd(at)` fires as
   * the figure leaves the first stair and as it reaches the second (dust, a sound). Calm motion
   * keeps a fade in place.
   */
  async takeStairs(from, to, out, back, onEnd = () => {}, { tumble = false } = {}) {
    const shown = [this.label, this.marker, this.base].map((o) => o.visible);
    const full = this.ghost ? 0.35 : 1;
    this.label.visible = this.marker.visible = this.base.visible = false;
    const still = calm();
    const span = 0.42; // how far along the steps the figure goes before it's out of sight
    const height = (f) => (f?.down ? -0.5 : 0.6); // the well's bottom, or the top of the steps
    // A staircase, not a ramp: each of four treads is a small lift and a flat stride.
    const treads = (t) => { const n = 4, i = Math.min(n - 1, Math.floor(t * n)); return (i + easeInOut(Math.min(1, t * n - i))) / n; };
    this.walking = !still && !tumble;
    const pace = tumble ? 0.6 : 1; // pushed: quicker, and head over heels
    const roll = (t) => { if (tumble && !still) this.figure.rotation.x = t * Math.PI * 2; };
    if (out) this.faceTowards(from.x + out.dx, from.z + out.dz);
    onEnd(from);
    await tween(still ? 380 : 620 * pace, (t) => {
      roll(t / 2);
      if (!still && out) {
        const s = treads(t);
        this.group.position.set(from.x + out.dx * span * s, height(out) * s, from.z + out.dz * span * s);
      }
      this.fadeMeshes(full * Math.min(1, 2 - 2 * t)); // gone over the second half
    }, linear);
    if (!still) sfx.step(this.unit.code);
    await wait(still ? 120 : 220 * pace);
    if (back) this.figure.rotation.y = Math.atan2(-back.dx, -back.dz); // coming off the steps
    this.group.position.set(to.x + (still || !back ? 0 : back.dx * span), still || !back ? 0 : height(back), to.z + (still || !back ? 0 : back.dz * span));
    await tween(still ? 380 : 620 * pace, (t) => {
      roll(0.5 + t / 2);
      if (!still && back) {
        const s = 1 - treads(t);
        this.group.position.set(to.x + back.dx * span * s, height(back) * s, to.z + back.dz * span * s);
      }
      this.fadeMeshes(full * Math.min(1, 2 * t)); // seen within the first half
    }, linear);
    this.group.position.set(to.x, 0, to.z);
    this.figure.rotation.x = 0;
    this.fadeMeshes(full);
    this.walking = false;
    onEnd(to);
    [this.label.visible, this.marker.visible, this.base.visible] = shown;
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
    this.t = t;
    const lift = liftAt(this.group.position.x, this.group.position.z);
    if (this.raise.position.y !== lift) {
      const y = this.raise.position.y + (lift - this.raise.position.y) * Math.min(1, dt * 16);
      this.raise.position.y = Math.abs(lift - y) < 0.004 ? lift : y;
    }
    if (this.marker.visible) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 4);
      this.marker.userData.halo.scale.setScalar(1 + pulse * 0.12);
      this.marker.userData.halo.material.opacity = 0.2 + pulse * 0.35;
    }
    this.animateHurt(t, dt);
    if (this.torch) this.animateTorch(t, dt);
    if (this.auras.busy) this.auras.tick(t, dt, this.group.visible && !this.ghost && !this.gone);
    if (this.rig) {
      // A badly hurt figure's walk drags.
      this.rig.update(this.walking && this.hurt ? dt * (this.hurt === 2 ? 0.7 : 0.82) : dt, this.walking);
      return;
    }
    if (!this.unit.alive || this.held) return;
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

  /**
   * Wounds: below half HP the figure stoops; below a quarter it also sways and a faint red glow
   * pulses at its feet. Eased in and out; reduced motion keeps the stoop and a steady glow.
   */
  animateHurt(t, dt) {
    const down = this.prone || !this.unit.alive || this.down;
    const level = down ? 0 : this.hurt;
    const still = calm();
    const k = 1 - Math.exp(-dt * 6);
    const stoop = level ? (level === 2 ? 0.3 : 0.18) : 0;
    const sway = level === 2 && !still ? Math.sin((t + this.seed) * 2.1) * 0.07 : 0;
    const { yaw, roll } = this.idle(t, dt, down || still);
    this.lean.rotation.x += (stoop - this.lean.rotation.x) * k;
    this.lean.rotation.z += (sway + roll - this.lean.rotation.z) * k;
    this.lean.rotation.y += (yaw - this.lean.rotation.y) * (1 - Math.exp(-dt * 5));
    if (level === 2 && !this.hurtGlow) {
      this.hurtGlow = new THREE.Mesh(
        new THREE.RingGeometry(0.4, 0.66, 40).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xd02020, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
      );
      this.hurtGlow.position.y = 0.012;
      this.hurtGlow.renderOrder = 1;
      this.raise.add(this.hurtGlow);
    }
    if (this.hurtGlow) {
      const want = level === 2 && this.group.visible && !this.ghost ? (still ? 0.45 : 0.25 + 0.35 * (0.5 + 0.5 * Math.sin((t + this.seed) * 3.2))) : 0;
      const m = this.hurtGlow.material;
      m.opacity += (want - m.opacity) * k;
      this.hurtGlow.visible = m.opacity > 0.005;
    }
  }

  /**
   * A figure waiting its turn now and then looks aside or shifts its weight; a glance (a blow
   * landing nearby) turns it toward the noise for a moment. Nothing while it moves, acts, lies
   * down or is held, nor under reduced motion. Returns the yaw and roll to ease toward.
   */
  idle(t, dt, off) {
    const g = this.gaze;
    if (off || this.held || this.walking || this.armsBusy || this.marker.visible || !this.unit.alive) {
      g.until = 0;
      return { yaw: 0, roll: 0 };
    }
    if (t < g.until) return g;
    g.yaw = g.roll = 0;
    g.next -= dt;
    if (g.next <= 0) {
      g.next = 4 + Math.random() * 7;
      if (Math.random() < 0.6) g.yaw = (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.25);
      else g.roll = (Math.random() < 0.5 ? -1 : 1) * 0.05;
      g.until = t + 1 + Math.random() * 0.8;
    }
    return g;
  }

  /** Look toward (x, z) for a moment: a blow or a blast nearby. */
  glance(x, z) {
    const t = this.t ?? 0;
    if (calm() || this.held || this.walking || this.armsBusy || !this.unit.alive || this.prone) return;
    const dx = x - this.group.position.x;
    const dz = z - this.group.position.z;
    if (!dx && !dz) return;
    let d = Math.atan2(dx, dz) - this.figure.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.gaze.yaw = Math.max(-0.7, Math.min(0.7, d));
    this.gaze.roll = 0;
    this.gaze.until = t + 1.1;
    this.gaze.next = 3 + Math.random() * 4;
    keepAwake(400);
  }

  /**
   * A hero's torch in a dark room: a warm light over the figure, flickering, lit while `near`
   * (x, z) says dark lies close and the hero stands. One per hero for the whole fight, so the
   * scene's light count doesn't change (a change recompiles every lit material).
   */
  carryTorch(near, reach) {
    this.torch = new THREE.PointLight(0xffa860, 0, reach, 1.6);
    this.torch.position.set(0.15, 0.95, 0.1);
    this.torch.userData.near = near;
    this.raise.add(this.torch);
  }

  animateTorch(t, dt) {
    const l = this.torch;
    const p = this.group.position;
    const on = this.unit.alive && !this.down && !this.gone && this.group.visible && l.userData.near(Math.round(p.x), Math.round(p.z));
    const flicker = calm() ? 1 : 0.88 + 0.08 * Math.sin((t + this.seed) * 11) + 0.04 * Math.sin((t + this.seed) * 23.7);
    const want = on ? 2.6 * flicker : 0;
    l.intensity += (want - l.intensity) * (1 - Math.exp(-dt * (on ? 10 : 4)));
  }

  /** The elite is first seen: its band swells and flares, then settles. */
  flashElite() {
    const band = this.base.getObjectByName('elite-band');
    if (!band) return Promise.resolve();
    return tween(900, (t) => {
      const k = Math.sin(t * Math.PI); // 0 → 1 → 0
      band.scale.setScalar(1 + 0.3 * k);
      band.material.emissiveIntensity = 0.9 + 2.5 * k;
    }, linear);
  }

  updateHp() {
    const pct = Math.max(0, this.unit.hp / this.unit.maxHp) * 100;
    const bar = this.label.element.querySelector('.hpbar i');
    bar.style.width = `${pct}%`;
    bar.dataset.level = pct > 50 ? 'high' : pct > 25 ? 'mid' : 'low';
    this.hurt = !this.unit.alive || pct <= 0 ? 0 : pct < 25 ? 2 : pct < 50 ? 1 : 0;
    // Temporary HP: a pale band laid over the bar, as a share of max HP.
    const temp = this.label.element.querySelector('.hpbar b');
    temp.style.width = `${Math.min(100, ((this.unit.tempHp ?? 0) / this.unit.maxHp) * 100)}%`;
  }

  /**
   * The hovered attack's damage on the bar: `sure` (its lowest roll) and `may` (up to its
   * highest) shaded off the end, after any temporary HP soaks it; a skull when even the lowest
   * roll would drop the figure. `null` clears it.
   */
  previewDamage(range) {
    const el = this.label.element;
    const [may, sure] = el.querySelectorAll('.hpbar s');
    const u = this.unit;
    const band = (node, dmg) => {
      const lost = range ? Math.min(u.hp, Math.max(0, dmg - (u.tempHp ?? 0))) : 0;
      node.style.left = `${((u.hp - lost) / u.maxHp) * 100}%`;
      node.style.width = `${(lost / u.maxHp) * 100}%`;
    };
    band(may, range?.max ?? 0);
    band(sure, range?.min ?? 0);
    el.classList.toggle('lethal', !!range && range.min - (u.tempHp ?? 0) >= u.hp);
  }

  setActive(on) {
    this.label.element.classList.toggle('active', on);
    this.marker.visible = on && this.unit.alive;
  }

  /** Small status tags above the name (Dodging, Ready, Shield, Disengaged). */
  updateStatus() {
    const u = this.unit;
    const tags = [
      u.dodging && ['dodge', 'Dodging'],
      u.readied && u.alive && ['ready', 'Ready'],
      u.helped?.alive && u.alive && ['helped', 'Distracted'],
      u.owlHelp && !u.helped && u.alive && ['helped', 'Owl'],
      u.grappledBy && u.alive && ['grappled', 'Grappled'],
      u.shielded && ['shield', 'Shield +5'],
      u.disengaged && ['disengage', 'Disengaged'],
      u.turned && ['turned', u.routed ? 'Fleeing' : 'Turned'],
      u.conditions?.prone && ['prone', 'Prone'],
      u.conditions?.poisoned && ['poisoned', 'Poisoned'],
      u.conditions?.frightened && ['frightened', 'Frightened'],
      u.conditions?.engulfed && ['restrained', 'Engulfed'],
      u.conditions?.restrained && !u.conditions.engulfed && ['restrained', u.conditions.restrained.by?.code === 'D' ? 'Entangled' : u.conditions.restrained.by?.lair === 'hands' ? 'Grasped' : 'Webbed'],
      u.conditions?.pit && ['prone', 'In a pit'],
      u.conditions?.stunned && ['stunned', 'Stunned'],
      u.conditions?.petrified && ['petrified', 'Petrified'],
      u.conditions?.burning && ['burning', 'Burning'],
      u.raging && u.alive && ['raging', 'Raging'],
      u.reckless && u.alive && ['reckless', 'Reckless'],
      u.quickened && u.alive && ['rebuke', 'Quickened'],
      u.stunArmed && u.alive && ['ready', 'Stunning Strike'],
      u.conditions?.rotting && ['rotting', 'Rotting'],
      u.conditions?.mocked && ['mocked', 'Mocked'],
      u.conditions?.paralyzed && ['paralyzed', 'Paralysed'],
      u.inspired && u.alive && ['inspired', `Inspired d${u.inspired.die}`],
      u.invisibleFrom && u.alive && ['invisible', 'Invisible'],
      u.marked && u.alive && (u.marked === 'hex' ? ['marked hexed', 'Hexed'] : ['marked', 'Marked']),
      u.rebukeArmed && u.alive && ['rebuke', 'Rebuke'],
      u.concentrating && u.alive && ['focus', 'Concentrating'],
      u.deathWard && u.alive && ['ward', u.elite === 'relentless' ? 'Relentless' : 'Warded'],
      // A hero's own Stealth roll is theirs to see; a goblin's isn't.
      u.hidden && ['hidden', u.team === 'heroes' ? `Hidden · ${u.hidden}` : 'Hidden'],
      u.asleep ? ['asleep', 'Asleep'] : u.patrol && u.unaware ? ['unaware', 'Patrolling'] : u.unaware && ['unaware', 'Unaware'],
    ].filter(Boolean);
    this.label.element.querySelector('.tags').innerHTML =
      tags.map(([cls, text]) => `<i class="tag ${cls}">${text}</i>`).join('');
    this.setProne(!!u.conditions?.prone && u.alive);
    const c = u.alive ? u.conditions ?? {} : {};
    this.auras.set({
      poisoned: c.poisoned || c.rotting, burning: c.burning, frozen: c.paralyzed || c.petrified,
      stunned: c.stunned, focus: u.alive && u.concentrating, shield: u.alive && u.shielded,
    });
    this.held = !!(c.paralyzed || c.petrified);
    if (this.rig) this.rig.held = this.held;
    if (!this.gone) this.setGhost(u.alive && (u.team === 'monsters' ? !!u.hidden : !!u.invisibleFrom));
  }

  /** An outline round the figure: 'hover', 'target' or null (render/outline.js). */
  setOutline(kind) {
    if (kind === (this.outline ?? null)) return;
    if (this.hulls) removeOutline(this.hulls);
    this.hulls = kind ? addOutline(this.model.root, kind) : null;
    this.outline = kind;
  }

  /** A hidden monster: a faint shape where the heroes saw it duck down. */
  setGhost(on) {
    if (on === !!this.ghost) return;
    this.ghost = on;
    this.fadeMeshes(on ? 0.35 : 1);
  }

  /** Knocked down / back on its feet: tip the figure over onto its back (rats onto a side). */
  setProne(on) {
    if (on === this.prone) return;
    this.prone = on;
    if (on) wait(200).then(() => this.dust(null, { count: 8, size: 0.42 }));
    const axis = this.model.dieAxis === 'z' ? 'z' : 'x';
    const down = axis === 'z' ? 1.25 : -1.2;
    const from = this.tilt.rotation[axis];
    const to = on ? down : 0;
    tween(on ? 260 : 380, (t) => {
      this.tilt.rotation[axis] = lerp(from, to, t);
      this.tilt.position.y = (on ? t : 1 - t) * 0.12;
    }, on ? easeIn : easeOut);
  }

  /** Spell-casting gesture: raise both arms, run `release`, lower them. */
  async cast(target, release) {
    this.cry('cast');
    if (target) await this.turnTowards(target.x, target.z);
    this.glyphs(this.school);
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

  /** Runes spin up round the figure in the colour of `spell`'s school (glyphs.js), if it's seen. */
  glyphs(spell) {
    if (!this.group.visible || !this.group.parent) return;
    castGlyphs(this.group.parent, this.group.position, this.model.height, schoolColor(spell));
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
  /** Walks the path; `onStep(from, to)` hears each step as it begins (footprints, clutter). */
  async moveAlong(path, onStep) {
    this.walking = true;
    for (let i = 1; i < path.length; i++) {
      const from = this.group.position.clone();
      const to = new THREE.Vector3(path[i].x, 0, path[i].z);
      this.faceTowards(to.x, to.z);
      sfx.step(this.unit.code);
      onStep?.(path[i - 1], path[i]);
      const ms = from.distanceTo(to) > 1.1 ? 270 : 210; // diagonals take a bit longer
      await tween(ms, (t) => this.group.position.lerpVectors(from, to, t), linear);
    }
    this.walking = false;
  }

  /**
   * A bark for this unit (see audio/voices.js), only while it can be seen. An attack by a
   * monster without a voice of its own keeps its old cry (squeak, hiss, groan...).
   */
  cry(kind) {
    if (!this.group.visible) return;
    if (!voices.bark(this.unit, kind) && kind === 'attack') sfx.voice(this.unit.code);
  }

  /** Melee: wind up overhead, step in and strike, recover. */
  async swing(target, onImpact, { crit = false } = {}) {
    if (this.model.bite) return this.bite(target, onImpact);
    this.cry('attack');
    await this.turnTowards(target.x, target.z);
    if (this.rig) {
      const { hit, done } = this.rig.play('melee', { at: 0.45, speed: 1.15 });
      wait(180).then(() => sfx.whoosh(this.unit.code === 'F' || this.unit.code === 'P'));
      wait(150).then(() => this.trail(target, crit));
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
    sfx.whoosh(this.unit.code === 'F' || this.unit.code === 'P');
    this.trail(target, crit);
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
    this.cry('attack');
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
    this.cry(SPELL_BOLTS.includes(kind) ? 'cast' : 'attack'); // Fire Bolt, Chill Touch: an incantation
    await this.turnTowards(target.x, target.z);
    if (SPELL_BOLTS.includes(kind)) this.glyphs(kind);
    if (this.rig) {
      const spell = SPELL_BOLTS.includes(kind);
      if (kind === 'fire' || kind === 'eldritch') sfx.cast();
      if (kind === 'necro') sfx.necro();
      if (kind === 'arrow') this.rig.drawRanged(true);
      const { hit, done } = this.rig.play(spell ? 'spell' : kind === 'web' ? 'melee' : kind, { at: 0.45 });
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
    const spell = SPELL_BOLTS.includes(kind);
    const poseL = kind === 'arrow' ? -1.6 : spell ? -0.9 : rest.armL;
    const r0 = armR.rotation.x;
    const l0 = armL.rotation.x;
    if (kind === 'fire' || kind === 'eldritch') sfx.cast();
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
    this.down = true;
    this.label.visible = false;
    this.marker.visible = false;
    this.walking = false;
    this.prone = false;
    this.tilt.rotation.set(0, 0, 0);
    this.tilt.position.y = 0;
    if (this.rig) await this.rig.play('die', { hold: true }).done;
    else {
      await tween(550, (t) => this.deadPose(t), easeIn);
      // little bounce on impact
      await tween(160, (t) => this.deadPose(1 - Math.sin(t * Math.PI) * 0.05));
    }
    if (this.unit.team !== 'heroes') return this.burnAway();
    await tween(700, (t) => this.fadeMeshes(1 - t * (1 - HERO_BODY)));
  }

  /** A dying hero healed (or rallying on a 20) gets back up. */
  async getUp() {
    if (!this.down) return;
    this.down = false;
    if (this.dissolved) this.setDissolve(0);
    this.fadeMeshes(1);
    this.label.visible = true;
    if (this.rig) {
      this.rig.holdLast = false;
      await this.rig.play('rise').done;
    } else await tween(500, (t) => this.deadPose(1 - t), easeOut);
    this.updateHp();
    this.updateStatus();
  }

  dispose() {
    this.stage.tickers.delete(this.tick);
    this.rig?.mixer.stopAllAction();
    this.auras.dispose();
    // CSS2DObject removes its DOM element only when removed directly.
    this.label.removeFromParent();
  }
}

/** Projectiles thrown by a spell (cast pose and glow rather than a bow or a throw). */
const SPELL_BOLTS = ['fire', 'necro', 'eldritch'];

/**
 * Projectile flight between two units. kind: 'fire' | 'necro' | 'eldritch' | 'arrow' | 'javelin' | 'web'.
 * `missed(mesh, a, b)`, for an arrow or javelin that missed, takes the shaft over at the end of its
 * flight (it flies on and sticks: render/arrows.js) instead of it vanishing.
 */
export async function shootProjectile(scene, from, to, kind, { missed } = {}) {
  let mesh;
  const bolt = SPELL_BOLTS.includes(kind) || kind === 'web';
  if (kind === 'web') {
    // a wad of grey-white silk
    mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0),
      new THREE.MeshBasicMaterial({ color: 0xe8e4d8, wireframe: true }));
    mesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xf4f0e4, transparent: true, opacity: 0.6 })));
  } else if (bolt) {
    const color = kind === 'fire' ? 0xff7a1a : kind === 'eldritch' ? 0xd060ff : 0x50ff80;
    mesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), new THREE.MeshBasicMaterial({ color }));
    if (kind === 'eldritch') {
      // a crackling beam-head: a violet core in a dark shroud
      mesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0x4a1060, transparent: true, opacity: 0.5, depthWrite: false })));
    }
    if (kind === 'necro') {
      // a ghostly skeletal hand: a pale core inside a green halo
      mesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0x20c050, transparent: true, opacity: 0.35, depthWrite: false })));
    }
    mesh.add(new SpellLight(color, 7, 6, 1.4)); // lights the walls it passes
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
    mesh.userData.reach = shaftLen / 2 + 0.08; // from its middle to the tip
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
  if (missed && !bolt) missed(mesh, a, b);
  else scene.remove(mesh);
}

/** Rising text above a unit (damage numbers, "Miss", etc). */
export function floatText(scene, at, text, cls) {
  const el = document.createElement('div');
  el.className = `float-text ${cls}`;
  el.textContent = text;
  const obj = new CSS2DObject(el);
  obj.position.set(at.x, 1.4, at.z);
  scene.add(obj);
  const still = calm();
  tween(1100, (t) => {
    obj.position.y = 1.4 + (still ? 0.3 : t * 0.9); // reduced motion: fades in place
    el.style.opacity = String(t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
  }, easeOut).then(() => scene.remove(obj));
}
