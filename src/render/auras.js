// Conditions shown on the figure itself, drawn only: green bubbles off a poisoned figure, small
// flames on a burning one, frost glinting round a paralysed one (its pose held), stars circling a
// stunned one's head, a slow ring at a concentrating caster's feet and a shimmer when a Shield
// goes up. The tags over the name still say what each is. Reduced motion keeps them still.

import * as THREE from 'three';
import { calm } from './tween.js';

let bubbleMap = null;
/** A bubble: a thin bright rim and a glint. */
function bubble() {
  if (bubbleMap) return bubbleMap;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(16, 16, 12, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  g.arc(11, 11, 3, 0, Math.PI * 2);
  g.fill();
  bubbleMap = new THREE.CanvasTexture(c);
  return bubbleMap;
}

let flameMap = null;
/** A small flame: a teardrop, yellow at its root, orange at its edge. */
function flame() {
  if (flameMap) return flameMap;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 48;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 34, 1, 16, 30, 16);
  grad.addColorStop(0, 'rgba(255,240,170,1)');
  grad.addColorStop(0.45, 'rgba(255,150,40,0.95)');
  grad.addColorStop(1, 'rgba(220,60,10,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(16, 2);
  g.bezierCurveTo(22, 16, 29, 24, 29, 33);
  g.arc(16, 33, 13, 0, Math.PI);
  g.bezierCurveTo(3, 24, 10, 16, 16, 2);
  g.fill();
  flameMap = new THREE.CanvasTexture(c);
  return flameMap;
}

let starMap = null;
/** A four-pointed star (frost glints, a stunned figure's stars). */
function star() {
  if (starMap) return starMap;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,1)';
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 4 : 15;
    g.lineTo(16 + Math.cos(a) * r, 16 + Math.sin(a) * r);
  }
  g.fill();
  starMap = new THREE.CanvasTexture(c);
  return starMap;
}

let ringMap = null;
/** A dashed ring for concentration. */
function dashes() {
  if (ringMap) return ringMap;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 5;
  g.lineCap = 'round';
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    g.beginPath();
    g.arc(64, 64, 56, a, a + (Math.PI * 2) / n * 0.55);
    g.stroke();
  }
  g.lineWidth = 1.5;
  g.globalAlpha = 0.6;
  g.beginPath();
  g.arc(64, 64, 47, 0, Math.PI * 2);
  g.stroke();
  ringMap = new THREE.CanvasTexture(c);
  return ringMap;
}

const sprite = (map, color, additive = true) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map, color, transparent: true, opacity: 0, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  }));
  s.renderOrder = 2;
  return s;
};

/** Each kind: how to make its parts and how to move them (`k` 0..1 how far it has faded in). */
const KINDS = {
  poisoned: {
    make: () => Array.from({ length: 6 }, (_, i) => Object.assign(sprite(bubble(), 0x8ee05a, false), { userData: { ph: i / 6, a: (i / 6) * Math.PI * 2 + Math.random() * 0.5, r: 0.3 + Math.random() * 0.1 } })),
    move(parts, t, h, k, still) {
      for (const s of parts) {
        const { ph, a, r } = s.userData;
        const p = still ? 0.5 : (t * 0.45 + ph) % 1;
        s.position.set(Math.cos(a) * r, 0.25 + p * h * 0.8, Math.sin(a) * r);
        s.scale.setScalar(0.12 + p * 0.07);
        s.material.opacity = k * 0.95 * Math.sin(Math.PI * p);
      }
    },
  },
  burning: {
    make: () => Array.from({ length: 10 }, (_, i) => Object.assign(sprite(flame(), i % 2 ? 0xffd0a0 : 0xffffff, false), { userData: { ph: i / 10, a: (i / 10) * Math.PI * 2, r: 0.26 + Math.random() * 0.08 } })),
    move(parts, t, h, k, still) {
      for (const s of parts) {
        const { ph, a, r } = s.userData;
        const p = still ? 0.35 : (t * 1.4 + ph) % 1;
        s.position.set(Math.cos(a + t * 0.6) * r * (1 - p * 0.5), 0.15 + p * h * 0.75, Math.sin(a + t * 0.6) * r * (1 - p * 0.5));
        s.scale.set(0.24 * (1 - p * 0.55), 0.38 * (1 - p * 0.45), 1);
        s.material.opacity = k * 0.9 * Math.sin(Math.PI * Math.min(1, p * 1.3));
      }
    },
  },
  frozen: {
    make: () => Array.from({ length: 7 }, (_, i) => Object.assign(sprite(star(), 0xbfe4ff), { userData: { ph: i * 0.9, a: (i / 7) * Math.PI * 2, y: 0.2 + (i % 4) * 0.18, r: 0.32 + (i % 3) * 0.05 } })),
    move(parts, t, h, k, still) {
      for (const s of parts) {
        const { ph, a, y, r } = s.userData;
        s.position.set(Math.cos(a) * r, y * h * 1.1, Math.sin(a) * r);
        const tw = still ? 0.7 : Math.max(0, Math.sin(t * 2.2 + ph));
        s.scale.setScalar(0.08 + 0.07 * tw);
        s.material.opacity = k * (0.25 + 0.5 * tw);
      }
    },
  },
  stunned: {
    make: () => Array.from({ length: 3 }, (_, i) => Object.assign(sprite(star(), 0xffd84a, false), { userData: { a: (i / 3) * Math.PI * 2 } })),
    move(parts, t, h, k, still) {
      for (const s of parts) {
        const a = s.userData.a + (still ? 0 : t * 3);
        s.position.set(Math.cos(a) * 0.26, h + 0.22 + Math.sin(a * 2) * 0.03, Math.sin(a) * 0.26);
        s.scale.setScalar(0.17);
        s.material.opacity = k * 0.95;
      }
    },
  },
  focus: {
    make: () => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
        map: dashes(), color: 0x9fb8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      m.position.y = 0.016;
      m.renderOrder = 1;
      return [m];
    },
    move([m], t, h, k, still) {
      m.rotation.y = still ? 0 : t * 0.5;
      m.material.opacity = k * (still ? 0.6 : 0.5 + 0.1 * Math.sin(t * 2));
    },
  },
  shield: {
    make: () => {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), new THREE.MeshBasicMaterial({
        color: 0x8fd4ff, wireframe: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      m.userData.born = null;
      return [m];
    },
    move([m], t, h, k, still) {
      m.userData.born ??= t;
      const age = t - m.userData.born;
      m.position.y = h * 0.5;
      m.scale.set(1, h / 1.1 + 0.2, 1);
      // A flare as it goes up, then a faint shimmer while it lasts.
      const flare = still ? 0 : Math.max(0, 1 - age / 0.6);
      m.rotation.y = still ? 0 : t * 0.3;
      m.material.opacity = k * (0.06 + 0.3 * flare + (still ? 0 : 0.025 * Math.sin(t * 5)));
    },
  },
};

export class Auras {
  /** `parent` is what the parts hang on (the figure's `raise`); `height` the figure's. */
  constructor(parent, height) {
    this.parent = parent;
    this.height = height;
    this.live = new Map(); // kind -> { parts, k, want }
  }

  /** Which kinds are on now: { poisoned, burning, frozen, stunned, focus, shield }. */
  set(on) {
    for (const kind of Object.keys(KINDS)) {
      const want = !!on[kind];
      const a = this.live.get(kind);
      if (want && !a) {
        const parts = KINDS[kind].make();
        this.parent.add(...parts);
        this.live.set(kind, { parts, k: 0, want: true });
      } else if (a) a.want = want;
    }
  }

  get busy() {
    return this.live.size > 0;
  }

  tick(t, dt, visible) {
    const still = calm();
    for (const [kind, a] of this.live) {
      a.k = Math.max(0, Math.min(1, a.k + (a.want && visible ? dt : -dt) * 4));
      if (!a.want && a.k <= 0) {
        this.drop(a);
        this.live.delete(kind);
        continue;
      }
      KINDS[kind].move(a.parts, t, this.height, a.k, still);
    }
  }

  drop(a) {
    for (const p of a.parts) {
      p.removeFromParent();
      if (!p.isSprite) p.geometry.dispose(); // sprites share one geometry
      p.material.dispose();
    }
  }

  dispose() {
    for (const a of this.live.values()) this.drop(a);
    this.live.clear();
  }
}
