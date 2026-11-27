// Cut stone for raised ground (rules 11 ledges, rules 12 heights): canvas textures made once,
// a course of staggered blocks a step on the sides and worn flags on top, and a block geometry
// whose vertex colours darken toward its foot (damp, a little moss) and lighten at the lip.

import * as THREE from 'three';

let sideTex = null;
let topTex = null;

/** A small fixed PRNG, so the stone looks the same on every load. */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Blocks in rows, each a slightly different grey-brown, with dark mortar and a few chips. */
function blocks(ctx, w, h, rows, perRow, rnd, { base = [94, 85, 76], mortar = '#2b2621', stagger = true } = {}) {
  ctx.fillStyle = mortar;
  ctx.fillRect(0, 0, w, h);
  const rh = h / rows;
  for (let r = 0; r < rows; r++) {
    const bw = w / perRow;
    const off = stagger && r % 2 ? bw / 2 : 0;
    for (let i = -1; i < perRow + 1; i++) {
      const x0 = i * bw + off + 2;
      const y0 = r * rh + 2;
      const v = 0.82 + rnd() * 0.3;
      const [cr, cg, cb] = base.map((c) => Math.round(c * v));
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      ctx.fillRect(x0, y0, bw - 4, rh - 4);
      // A lighter top edge and a darker foot: each block reads as cut, not painted.
      ctx.fillStyle = 'rgba(255,240,220,0.10)';
      ctx.fillRect(x0, y0, bw - 4, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x0, y0 + rh - 7, bw - 4, 3);
      // Grain and chips.
      for (let n = 0; n < 14; n++) {
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.06)';
        ctx.fillRect(x0 + rnd() * (bw - 8), y0 + rnd() * (rh - 8), 1 + rnd() * 4, 1 + rnd() * 2);
      }
      if (rnd() < 0.35) { // a chipped corner
        ctx.fillStyle = mortar;
        const cx = rnd() < 0.5 ? x0 : x0 + bw - 9;
        ctx.beginPath();
        ctx.moveTo(cx, y0);
        ctx.lineTo(cx + 5 + rnd() * 4, y0);
        ctx.lineTo(cx, y0 + 4 + rnd() * 4);
        ctx.fill();
      }
    }
  }
}

function texture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** The side of one step: two courses of staggered blocks (repeated a step at a time). */
export function stoneSide() {
  if (!sideTex) {
    const c = canvas(256, 80);
    blocks(c.getContext('2d'), 256, 80, 2, 3, prng(7));
    sideTex = texture(c);
  }
  return sideTex;
}

/** The top of a raised tile: four worn flags with a darker rim at the lip. */
export function stoneTop() {
  if (!topTex) {
    const c = canvas(256, 256);
    const ctx = c.getContext('2d');
    blocks(ctx, 256, 256, 2, 2, prng(11), { base: [104, 95, 84], stagger: false });
    // Worn smooth toward the middle, where feet go.
    const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 150);
    g.addColorStop(0, 'rgba(255,245,230,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(20,16,12,0.55)';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 250, 250);
    topTex = texture(c);
  }
  return topTex;
}

/**
 * A raised block `tall` high in `steps` courses: its side UVs run a texture repeat a step, and
 * its vertex colours go from damp and mossy at the foot to a pale worn lip at the top.
 */
export function stoneBlock(tall, steps) {
  const geo = new THREE.BoxGeometry(0.99, tall, 0.99, 1, Math.max(2, steps * 3), 1);
  const uv = geo.attributes.uv;
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + tall / 2) / tall; // 0 at the foot, 1 at the top
    const side = Math.abs(geo.attributes.normal.getY(i)) < 0.5;
    if (side) uv.setY(i, uv.getY(i) * steps);
    const foot = Math.max(0, 1 - t * 3); // the lowest third
    const lip = t > 0.97 ? 1 : 0;
    colors[i * 3] = 0.62 + t * 0.38 - foot * 0.08 + lip * 0.08;
    colors[i * 3 + 1] = 0.62 + t * 0.38 + foot * 0.03 + lip * 0.08; // a hint of green low down
    colors[i * 3 + 2] = 0.6 + t * 0.4 - foot * 0.1 + lip * 0.06;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}
