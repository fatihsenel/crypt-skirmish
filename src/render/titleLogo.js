// The 3D emblem: a skull over a crossed sword and staff in a crypt doorway, with mist on the
// steps. It replaces a still of itself once the skull has loaded, and only draws while it is on
// screen. The title has one, and the won-campaign screen another. Reduced motion holds it still.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { calm } from './tween.js';
import { sfx } from '../audio/sfx.js';

const BASE = `${import.meta.env.BASE_URL}models/skull/`;
const STILL = { yaw: -0.25, pitch: 0.05, jaw: 0.04 };
const easeIn = (x) => x * x * x;
// Set once the skull has been clicked: until then a faint glow pulses behind it as a hint.
const POKED_KEY = 'crypt-skirmish:skull-poked';
const poked = () => { try { return localStorage.getItem(POKED_KEY) === '1'; } catch { return true; } };

/**
 * Swap `img` (a still of the emblem, the same size) for the 3D logo once it has loaded. Keeps the image on any
 * failure and resolves to null then; otherwise to `{ poke(move?), glance() }`: poke plays the
 * next move (or the named one) with its sound, glance makes its eyes flare for a moment.
 * `hint`: pulse a glow until the skull is clicked.
 */
export async function mountTitleLogo(img, { className = 'title-logo', hint = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = className;
  canvas.setAttribute('aria-hidden', 'true');
  let R;
  try {
    R = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return null; // No WebGL: the still stays.
  }
  R.setClearColor(0x000000, 0);
  R.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const env = new THREE.PMREMGenerator(R).fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(30, 1.15, 0.1, 50);
  camera.position.set(0, -0.15, 11.8);
  camera.lookAt(0, -0.15, 0);

  const parts = buildScene(scene, env);
  try {
    await loadSkull(parts);
  } catch {
    R.dispose();
    return null;
  }

  img.replaceWith(canvas);
  canvas.addEventListener('webglcontextlost', () => { R.setAnimationLoop(null); canvas.replaceWith(img); });

  const coarse = matchMedia('(pointer: coarse)');
  const anim = animator(parts);
  // 30fps on phones and tablets; left alone for REST_MS (no pointer, key or move), 20fps, since
  // only the mist and the bob are moving then. Any touch brings it back.
  const REST_MS = 15000;
  let last = performance.now(), n = 0, stirred = last, stillDrawn = false, w = 0, h = 0;
  const stir = () => { stirred = performance.now(); };
  for (const type of ['pointermove', 'pointerdown', 'keydown']) addEventListener(type, stir, { passive: true });
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    if (++n % (now - stirred > REST_MS ? 3 : coarse.matches ? 2 : 1)) return;
    last = now;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (cw !== w || ch !== h) {
      w = cw; h = ch; stillDrawn = false;
      R.setPixelRatio(Math.min(devicePixelRatio, 2));
      R.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const still = calm();
    if (still && stillDrawn) return;
    anim(still ? 0 : dt, still);
    R.render(scene, camera);
    stillDrawn = still;
  };
  // Clicking the skull plays its next move; the pointer turns to a hand over it.
  const ray = new THREE.Raycaster(), at = new THREE.Vector2();
  const onSkull = (e) => {
    const r = canvas.getBoundingClientRect();
    at.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(at, camera);
    return ray.intersectObject(parts.skull, true).length > 0;
  };
  canvas.addEventListener('pointermove', (e) => { canvas.style.cursor = !calm() && onSkull(e) ? 'pointer' : ''; });
  anim.hint = hint && !poked();
  const poke = (move) => {
    stir();
    if (calm()) return;
    sfx.skull(anim.poke(move));
    if (anim.hint) {
      anim.hint = false;
      try { localStorage.setItem(POKED_KEY, '1'); } catch { /* the hint just comes back next visit */ }
    }
  };
  canvas.addEventListener('click', (e) => { if (onSkull(e)) poke(); });
  const glance = () => { stir(); if (!calm()) anim.glance(); };
  // The embers in its sockets follow the mouse around the page (and drift back when it leaves).
  // On a touch screen they look at each tap or drag, and drift back two seconds after.
  let lookBack = 0;
  const lookAt = (e) => {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    const cx = r.left + r.width * 0.5, cy = r.top + r.height * 0.42;
    anim.look.x = Math.max(-1, Math.min(1, (e.clientX - cx) / (innerWidth * 0.35)));
    anim.look.y = Math.max(-1, Math.min(1, (cy - e.clientY) / (innerHeight * 0.35)));
    if (e.pointerType === 'mouse') return;
    clearTimeout(lookBack);
    lookBack = setTimeout(() => { anim.look.x = anim.look.y = 0; }, 2000);
  };
  addEventListener('pointermove', lookAt);
  addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') lookAt(e); });
  document.documentElement.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') anim.look.x = anim.look.y = 0; // a finger leaving is just a lift
  });
  // Draw only while the title is showing.
  new IntersectionObserver(([e]) => {
    last = performance.now();
    R.setAnimationLoop(e.isIntersecting ? frame : null);
  }).observe(canvas);
  return { poke, glance };
}

function buildScene(scene, env) {
  const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o });
  const stone = M(0x6a6070, { roughness: 0.95 }), dark = M(0x050308, { roughness: 1 });
  const gold = M(0xd9b45a, { metalness: 0.85, roughness: 0.3, envMap: env, envMapIntensity: 0.3 });
  const steel = M(0xdfe5ea, { metalness: 0.9, roughness: 0.2, envMap: env, envMapIntensity: 0.3 });
  const steelDark = M(0x9aa4ae, { metalness: 0.95, roughness: 0.35, envMap: env, envMapIntensity: 0.5 });
  const leather = M(0x3a2216, { roughness: 0.9 }), leatherDark = M(0x24140c, { roughness: 0.95 });
  const wood = M(0x5e3d26, { roughness: 0.88 });
  const glow = () => new THREE.MeshStandardMaterial({ color: 0x7fd4c0, emissive: 0x3fae98, emissiveIntensity: 1 });
  const add = (parent, geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const arch = (w, b, top) => {
    const s = new THREE.Shape();
    s.moveTo(-w, b); s.lineTo(-w, 0.6);
    s.quadraticCurveTo(-w, top - 0.5, 0, top);
    s.quadraticCurveTo(w, top - 0.5, w, 0.6);
    s.lineTo(w, b); s.lineTo(-w, b);
    return s;
  };
  const extrude = (shape, depth, bevel) => new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 40,
  });

  const G = new THREE.Group();
  scene.add(G);

  // The doorway: a stone arch with a gold rim and keystone, a dark way in, and three steps.
  const frame = arch(1.75, -2.3, 2.55);
  frame.holes = [new THREE.Path(arch(1.3, -2.3, 2.05).getPoints(60))];
  add(G, extrude(frame, 0.55, 0.06), stone, 0, 0, -0.3);
  const rim = arch(1.88, -2.36, 2.7);
  rim.holes = [new THREE.Path(arch(1.76, -2.36, 2.56).getPoints(60))];
  add(G, extrude(rim, 0.6, 0.03), gold, 0, 0, -0.32);
  add(G, new THREE.BoxGeometry(0.38, 0.42, 0.75), gold, 0, 2.2, -0.05);
  add(G, new THREE.ShapeGeometry(arch(1.3, -2.3, 2.05), 40), dark, 0, 0, -0.25);
  for (let i = 0; i < 3; i++) add(G, new THREE.BoxGeometry(2.6 - i * 0.45, 0.16, 0.5 - i * 0.12), stone, 0, -2.22 + i * 0.16, -i * 0.06);

  // The sword: a bevelled blade with fullers, a curved guard, a wrapped grip and a pommel.
  const sword = new THREE.Group();
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0, 2.6); bladeShape.lineTo(0.1, 2.22); bladeShape.lineTo(0.12, -0.95);
  bladeShape.lineTo(-0.12, -0.95); bladeShape.lineTo(-0.1, 2.22); bladeShape.lineTo(0, 2.6);
  const blade = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.035, bevelSegments: 2 });
  blade.translate(0, 0, -0.01);
  sword.add(new THREE.Mesh(blade, steel));
  for (const z of [-0.034, 0.034]) add(sword, new THREE.BoxGeometry(0.04, 2.7, 0.004), steelDark, 0, 0.55, z);
  const guard = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.55, -0.84, 0), new THREE.Vector3(0, -1.1, 0), new THREE.Vector3(0.55, -0.84, 0));
  sword.add(new THREE.Mesh(new THREE.TubeGeometry(guard, 32, 0.045, 10), gold));
  for (const x of [-0.55, 0.55]) add(sword, new THREE.SphereGeometry(0.07, 16, 12), gold, x, -0.84, 0);
  add(sword, new THREE.BoxGeometry(0.22, 0.16, 0.13), gold, 0, -1.0, 0);
  add(sword, new THREE.CylinderGeometry(0.055, 0.06, 0.56, 16), leather, 0, -1.36, 0);
  const wrap = new THREE.Curve();
  wrap.getPoint = (t, out = new THREE.Vector3()) => out.set(Math.cos(t * Math.PI * 14) * 0.06, -1.1 - t * 0.52, Math.sin(t * Math.PI * 14) * 0.06);
  sword.add(new THREE.Mesh(new THREE.TubeGeometry(wrap, 200, 0.013, 6), leatherDark));
  add(sword, new THREE.SphereGeometry(0.1, 20, 14), gold, 0, -1.72, 0).scale.set(1, 1.15, 0.75);
  add(sword, new THREE.ConeGeometry(0.04, 0.09, 12), gold, 0, -1.84, 0).rotation.z = Math.PI;
  sword.rotation.z = 0.7;
  sword.position.set(0, -0.1, 0.45);
  G.add(sword);

  // The staff: a knotted, slightly crooked shaft with leather bands and three prongs holding a crystal.
  const staff = new THREE.Group();
  const shaft = new THREE.CatmullRomCurve3([-2.1, -1.2, -0.3, 0.6, 1.4, 1.95]
    .map((y, i) => new THREE.Vector3(Math.sin(i * 1.7) * 0.035, y, Math.cos(i * 2.3) * 0.03)));
  const shaftGeo = new THREE.TubeGeometry(shaft, 120, 0.07, 12);
  const pos = shaftGeo.attributes.position, nrm = shaftGeo.attributes.normal, v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i); n.fromBufferAttribute(nrm, i);
    const a = Math.atan2(n.z, n.x);
    const bump = Math.sin(v.y * 7.3) * 0.008 + Math.sin(v.y * 19 + a * 3) * 0.006 + Math.max(0, Math.sin(v.y * 2.6 + 1)) ** 8 * 0.025;
    v.addScaledVector(n, bump);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  shaftGeo.computeVertexNormals();
  staff.add(new THREE.Mesh(shaftGeo, wood));
  for (const y of [0.35, -0.55]) add(staff, new THREE.CylinderGeometry(0.082, 0.082, 0.14, 16), leather, shaft.getPoint((y + 2.1) / 4.05).x, y, 0);
  add(staff, new THREE.CylinderGeometry(0.09, 0.08, 0.1, 16), gold, 0, 1.92, 0);
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3, c = Math.cos(a), s = Math.sin(a);
    const prong = new THREE.CatmullRomCurve3([[0.04, 1.95], [0.19, 2.14], [0.21, 2.38], [0.05, 2.6]].map(([r, y]) => new THREE.Vector3(c * r, y, s * r)));
    staff.add(new THREE.Mesh(new THREE.TubeGeometry(prong, 40, 0.026, 8), wood));
  }
  const crystal = new THREE.MeshStandardMaterial({
    color: 0x9fe8d8, emissive: 0x3fae98, emissiveIntensity: 1, roughness: 0.12, metalness: 0.1,
    flatShading: true, envMap: env, envMapIntensity: 0.8, transparent: true, opacity: 0.92,
  });
  const orb = add(staff, new THREE.IcosahedronGeometry(0.15, 0), crystal, 0, 2.3, 0);
  orb.scale.y = 1.35;
  staff.rotation.z = -0.7;
  staff.position.set(0, -0.1, 0.4);
  G.add(staff);

  // The skull (loaded later), with dark sockets and a small ember in each.
  const skull = new THREE.Group();
  skull.position.set(0, 0.25, 1.0);
  G.add(skull);
  const eyes = [];
  for (const side of [-1, 1]) {
    add(skull, new THREE.SphereGeometry(0.13, 24, 16), dark, side * 0.2, 0.06, 0.4).scale.set(1.1, 0.9, 0.5);
    eyes.push(add(skull, new THREE.SphereGeometry(0.016, 12, 8), glow(), side * 0.2, 0.05, 0.47));
  }

  scene.add(new THREE.HemisphereLight(0x9a8fb0, 0x1a1420, 1.6));
  const key = new THREE.DirectionalLight(0xb0c0ff, 1.2);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const torch = new THREE.PointLight(0xffc890, 38, 16, 2);
  torch.position.set(2.6, 1.6, 3.2);
  scene.add(torch);
  const cold = new THREE.PointLight(0x7fd4c0, 8, 6, 2);
  cold.position.set(0, -0.2, 0.2);
  scene.add(cold);

  // Mist on the steps and teal wisps rising out of it, from one soft round sprite.
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const puff = new THREE.CanvasTexture(c);
  puff.colorSpace = THREE.SRGBColorSpace;
  const sprite = (color, extra) => new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color, transparent: true, depthWrite: false, opacity: 0, ...extra }));
  const mist = Array.from({ length: 26 }, () => {
    const m = sprite(0x8fa4a8);
    m.userData = { seed: Math.random() * 100, speed: 0.12 + Math.random() * 0.18, size: 0.9 + Math.random() * 1.0, x: Math.random() * 6 - 3 };
    G.add(m);
    return m;
  });
  const wisps = Array.from({ length: 14 }, () => {
    const w = sprite(0x7fffe0, { blending: THREE.AdditiveBlending });
    w.userData = { life: Math.random(), speed: 0.12 + Math.random() * 0.12, r: 0.3 + Math.random() * 0.9, a: Math.random() * 6.28 };
    G.add(w);
    return w;
  });

  // The hint: a faint glow behind the skull until it's first clicked.
  const halo = sprite(0x7fffe0, { blending: THREE.AdditiveBlending });
  halo.position.set(0, -0.05, -0.4);
  halo.scale.setScalar(2.4);
  skull.add(halo);

  return { G, skull, eyes, orb, torch, cold, mist, wisps, halo, jaw: null };
}

async function loadSkull(parts) {
  const tl = new THREE.TextureLoader();
  const [{ scene: obj }, map, normalMap, aoMap] = await Promise.all([
    new GLTFLoader().loadAsync(`${BASE}skull.glb`), // from the scan's OBJ: scripts/skull-glb.mjs
    tl.loadAsync(`${BASE}color.jpg`), tl.loadAsync(`${BASE}normal.jpg`), tl.loadAsync(`${BASE}ao.jpg`),
  ]);
  map.colorSpace = THREE.SRGBColorSpace;
  const bone = new THREE.MeshStandardMaterial({ map, normalMap, aoMap, roughness: 0.75, metalness: 0, color: 0xe4e2dc });
  // The scan's texture is peach: keep its detail but drain most of the colour, toward old bone.
  bone.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * vec3(1.03, 1.0, 0.88), 0.8);`);
  };
  obj.traverse((m) => {
    if (!m.isMesh) return;
    m.material = bone;
    m.geometry.setAttribute('uv1', m.geometry.attributes.uv);
  });
  const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3());
  obj.position.sub(box.getCenter(new THREE.Vector3()));
  // The jaw and lower teeth are their own object, hinged just in front of the ears.
  const jawMesh = obj.getObjectByName('Jaw');
  if (jawMesh) {
    parts.jaw = new THREE.Group();
    parts.jaw.position.set(0, -0.76, -0.1);
    obj.add(parts.jaw);
    parts.jaw.add(jawMesh);
    jawMesh.position.set(0, 0.76, 0.1);
  }
  const holder = new THREE.Group();
  holder.add(obj);
  holder.scale.setScalar(1.45 / Math.max(size.x, size.y, size.z));
  parts.skull.add(holder);
}

/** Returns `(dt, still)` that poses everything for the next frame. */
function animator({ G, skull, eyes, orb, torch, cold, mist, wisps, halo, jaw }) {
  let t = 0;
  // Now and then: a chatter, a slow gape, a cocked head, or the torch guttering. A click adds
  // a laugh and a lunge, and plays the moves in turn.
  const ev = { chatter: 0, gape: 0, twitch: 0, tilt: 0, flare: 0, gutter: 0, laugh: 0, lunge: 0, glance: 0, next: 2.5 };
  const since = (at) => (at ? t - at : 99);
  const schedule = () => {
    const r = Math.random();
    if (r < 0.3) ev.chatter = ev.flare = t;
    else if (r < 0.55) ev.gape = t;
    else if (r < 0.8) { ev.twitch = t; ev.tilt = (Math.random() < 0.5 ? -1 : 1) * (0.18 + Math.random() * 0.12); }
    else ev.gutter = ev.flare = t;
    ev.next = t + 2.5 + Math.random() * 3.5;
  };

  const MOVES = ['gape', 'chatter', 'twitch', 'laugh', 'lunge', 'gutter'];
  let move = 0;
  const gaze = { x: 0, y: 0 }; // where the eyes look now, easing towards pose.look

  const pose = (dt, still) => {
    t += dt;
    if (!still && t > ev.next) schedule();
    G.rotation.set(STILL.pitch, STILL.yaw, 0); // the doorway holds one angle; only what's in it moves

    // The jaw: a creaking gape (open, hold, snap shut) or a burst of chattering.
    const g = since(ev.gape), c = since(ev.chatter);
    let open = 0.02 + 0.02 * Math.sin(t * 0.7);
    if (g < 2.4) open = g < 1.2 ? 0.42 * Math.sin((g / 1.2) * Math.PI / 2) : g < 1.9 ? 0.42 : 0.42 * (1 - (g - 1.9) / 0.5) ** 3;
    if (c < 1.1) open = 0.06 + 0.12 * Math.abs(Math.sin(c * 26)) * (1 - c / 1.1);
    // A laugh: the head tips back and the jaw cackles. A lunge: it lurches out at you, mouth open.
    const l = since(ev.laugh), lu = since(ev.lunge);
    const back = l < 1.8 ? Math.sin((l / 1.8) * Math.PI) : 0;
    if (l < 1.8) open = 0.1 + 0.2 * Math.abs(Math.sin(l * 20)) * back;
    const lurch = lu < 1.5 ? (lu < 0.18 ? lu / 0.18 : lu < 0.7 ? 1 : 1 - easeIn((lu - 0.7) / 0.8)) : 0;
    if (lu < 1.5) open = Math.max(open, 0.38 * lurch);
    if (jaw) jaw.rotation.x = still ? STILL.jaw : open;

    // The skull bobs, and sometimes cocks its head sharply and eases back.
    const w = since(ev.twitch);
    const cock = w < 2.5 ? ev.tilt * (w < 0.08 ? w / 0.08 : Math.exp(-(w - 0.08) * 1.6)) : 0;
    skull.rotation.z = still ? 0 : cock + Math.sin(t * 0.8) * 0.03;
    skull.rotation.x = still ? 0 : -Math.abs(cock) * 0.4 + Math.sin(t * 0.6) * 0.04 - back * 0.35;
    skull.position.y = 0.25 + (still ? 0 : Math.sin(t * 1.1) * 0.04 + back * 0.06 * Math.abs(Math.sin(l * 20)));
    skull.position.z = 1.0 + (still ? 0 : lurch * 1.4);

    // The torch flickers and sometimes gutters almost out.
    const u = since(ev.gutter);
    const gutter = u < 0.9 ? 0.25 + 0.75 * Math.min(1, Math.abs(u - 0.35) / 0.35) : 1;
    torch.intensity = still ? 40 : (38 + Math.sin(t * 13) * 3 + Math.sin(t * 7.3) * 4 + Math.random() * 3) * gutter;

    // The eyes and the crystal pulse, and flare with the chatter and in the dark.
    const f = since(ev.flare), gl = since(ev.glance);
    const flare = still ? 0 : (f < 1.4 ? Math.exp(-f * 2.5) * 3 : lurch * 2.5) + (gl < 1.2 ? Math.exp(-gl * 3) * 2.2 : 0);
    const p = still ? 1 : 0.65 + 0.35 * Math.sin(t * 2);
    cold.intensity = 8 * p + flare * 10;
    const ease = still ? 1 : Math.min(1, dt * 5);
    gaze.x += ((still ? 0 : pose.look.x) - gaze.x) * ease;
    gaze.y += ((still ? 0 : pose.look.y) - gaze.y) * ease;
    for (const e of eyes) {
      e.material.emissiveIntensity = 0.3 + 0.5 * p + flare * 2;
      e.scale.setScalar(1 + flare * 0.6);
      e.userData.x ??= e.position.x;
      e.position.x = e.userData.x + gaze.x * 0.065;
      e.position.y = 0.05 + gaze.y * 0.045;
    }
    orb.material.emissiveIntensity = 0.5 + 0.6 * p + flare;
    halo.material.opacity = pose.hint && !still ? 0.6 * Math.max(0, Math.sin(t * 1.6)) ** 2 : 0;

    for (const m of mist) {
      const d = m.userData, x = ((d.x + t * d.speed + 3.2) % 6.4) - 3.2;
      m.position.set(x, -2.0 + Math.sin(t * 0.5 + d.seed) * 0.15, 1.0 + Math.sin(d.seed) * 0.6);
      m.scale.setScalar(d.size * (1 + 0.15 * Math.sin(t * 0.7 + d.seed)));
      m.material.opacity = 0.34 * Math.min(1, (3.2 - Math.abs(x)) / 1.2);
    }
    for (const s of wisps) {
      const d = s.userData;
      d.life += dt * d.speed;
      if (d.life > 1) Object.assign(d, { life: 0, r: 0.3 + Math.random() * 0.9, a: Math.random() * 6.28 });
      const a = d.a + d.life * 4;
      s.position.set(Math.cos(a) * d.r * (1 - d.life * 0.5), -2.0 + d.life * 3.6, 0.5 + Math.sin(a) * 0.4);
      s.scale.setScalar(0.09 + 0.06 * Math.sin(d.life * Math.PI));
      s.material.opacity = 0.7 * Math.sin(d.life * Math.PI);
    }
  };

  pose.hint = false;
  pose.look = { x: 0, y: 0 }; // the pointer, -1 to 1 each way from the skull
  /** A short, soft flare of the eyes (the pointer or focus reaching a title button). */
  pose.glance = () => { if (since(ev.glance) > 0.5) ev.glance = t; };
  /** Play the next move (or `name`) now, hold off the random ones for a moment, and return its name. */
  pose.poke = (name) => {
    if (!MOVES.includes(name)) name = MOVES[move++ % MOVES.length];
    ev[name] = t;
    if (name === 'twitch') ev.tilt = (move % 4 < 2 ? -1 : 1) * 0.28;
    if (name === 'chatter' || name === 'gutter' || name === 'laugh') ev.flare = t;
    ev.next = t + 4;
    return name;
  };
  return pose;
}
