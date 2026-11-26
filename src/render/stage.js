// Renderer, isometric orthographic camera, lights and the render loop.

import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { calm, animating, onAnimate, keepAwake } from './tween.js';
import { keepSpellLights } from './lights.js';

export function createStage(container, { width, height }) {
  const center = new THREE.Vector3((width - 1) / 2, 0, (height - 1) / 2);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  // Phones have dense screens and small batteries: 1.5 device pixels per CSS pixel is sharp
  // enough there (the labels and HUD are HTML, at full sharpness) and draws half as many as 3.
  const coarse = matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // redrawn while something moves, see draw()
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  // HTML labels (HP bars, floating damage) drawn on top of the canvas.
  const labels = new CSS2DRenderer();
  labels.domElement.className = 'labels';
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0b10);
  // Soft image-based lighting so metal (armor, blades) has something to reflect.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  // True isometric: camera on the (1,1,1) diagonal -> 45° yaw, ~35.26° pitch.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  camera.position.copy(center).add(new THREE.Vector3(30, 30, 30));
  camera.lookAt(center);

  const controls = new MapControls(camera, renderer.domElement);
  controls.target.copy(center);
  controls.enableRotate = false;
  controls.enableDamping = true;
  controls.minZoom = 0.6;
  controls.maxZoom = 2.5;
  // Left click is reserved for the game; right-drag pans, wheel zooms.
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.update();

  // Lights
  const hemi = new THREE.HemisphereLight(0x9fb4ff, 0x2a1d12, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe0b5, 2.2);
  sun.position.copy(center).add(new THREE.Vector3(-6, 16, 9));
  sun.target.position.copy(center);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(coarse ? 1024 : 2048); // a third cheaper per frame on a phone
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 50 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  // Post-processing (post.js), loaded the first time Glow or photo mode's blur asks for it.
  // With neither on, frames are drawn as plainly as before.
  let post = null;
  let loading = null;
  const effects = { glow: false, blur: false };
  const setEffects = async (want) => {
    Object.assign(effects, want);
    if ((effects.glow || effects.blur) && !post) {
      loading ??= import('./post.js').then(({ createPost }) => {
        post = createPost(renderer, scene, camera);
        post.setSize(container.clientWidth, container.clientHeight);
      }).catch((e) => console.warn('Post-processing not loaded', e));
      await loading;
    }
    post?.set(effects);
    keepAwake(300);
  };
  /** Draws the scene once (also photo mode's Save image), with the effects that are on. */
  const render = () => {
    if (post && (effects.glow || effects.blur)) post.render(controls.target);
    else renderer.render(scene, camera);
  };

  // Room the HUD takes at the edges, in CSS px; replaced through setInsets.
  let insets = (w) => ({ top: 60, bottom: 120, right: w > 900 ? 310 : 0 });
  const fit = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const aspect = w / h;
    // Keep the board's diamond footprint inside the area not covered by HUD panels.
    const { top: topBar, bottom: bottomBar, right: sidePanel } = insets(w, h);
    const freeW = w - sidePanel;
    const freeH = Math.max(h * 0.35, h - topBar - bottomBar);
    const diag = (width + height) * Math.SQRT1_2;
    const needW = diag + 1;
    const needH = diag * 0.58 + 1.6;
    const view = Math.max((needH * h) / freeH, (needW * w) / freeW / aspect);
    const unitsPerPx = view / h;
    const shiftX = (sidePanel / 2) * unitsPerPx;
    const shiftY = ((bottomBar - topBar) / 2) * unitsPerPx;
    camera.left = (-view * aspect) / 2 + shiftX;
    camera.right = (view * aspect) / 2 + shiftX;
    camera.top = view / 2 - shiftY;
    camera.bottom = -view / 2 - shiftY;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    post?.setSize(w, h);
    labels.setSize(w, h);
    keepAwake(300); // a resized canvas is blank until it's drawn again
  };
  fit();
  window.addEventListener('resize', fit);

  const tickers = new Set();
  tickers.add(keepSpellLights(scene)); // the lights spells borrow (lights.js)

  // A room's mood (render/mood.js): the sky and ground light, the main light's colour and the
  // background, eased over a second when it changes. Colours only: no material recompiles.
  const mood = { from: null, to: null, t: 1 };
  const parts = () => [hemi.color, hemi.groundColor, sun.color, scene.background];
  const setMood = (m, { snap = false } = {}) => {
    mood.from = parts().map((c) => c.clone());
    mood.to = [m.sky, m.ground, m.sun, m.bg].map((c) => new THREE.Color(c));
    mood.t = snap ? 1 : 0;
    if (snap) parts().forEach((c, i) => c.copy(mood.to[i]));
    keepAwake(1200);
  };
  tickers.add((t, dt) => {
    if (mood.t >= 1) return;
    mood.t = Math.min(1, mood.t + dt);
    parts().forEach((c, i) => c.copy(mood.from[i]).lerp(mood.to[i], mood.t));
  });
  const clock = new THREE.Clock();
  // Screen shake: a decaying jitter added to the camera just for the render.
  let shakeAmp = 0;
  let shakeEnd = 0;
  let shakeLen = 1;
  const jitter = new THREE.Vector3();
  const shake = (amp = 0.25, ms = 350) => {
    if (calm()) return; // the system asks for less motion: no shaking
    shakeAmp = Math.max(shakeAmp * Math.max(0, (shakeEnd - clock.elapsedTime) / shakeLen), amp);
    shakeLen = ms / 1000;
    shakeEnd = clock.elapsedTime + shakeLen;
  };
  // Redrawing the shadows is over half of a frame's work. Every frame while something moves;
  // when all is still, every SHADOW_EVERY-th idle frame, so idle figures' shadows keep up.
  const SHADOW_EVERY = 4;
  let stillFrames = 0;
  const draw = (moving) => {
    renderer.shadowMap.needsUpdate = moving || ++stillFrames % SHADOW_EVERY === 0;
    const dt = clock.getDelta();
    const t = clock.elapsedTime;
    for (const fn of tickers) fn(t, dt);
    if (controls.update()) keepAwake(100); // still gliding after a pan or zoom
    const left = (shakeEnd - t) / shakeLen;
    if (left > 0) {
      keepAwake(50);
      const a = shakeAmp * left * left;
      jitter.set(Math.sin(t * 91) * a, Math.sin(t * 73 + 1) * a * 0.6, Math.sin(t * 67 + 2) * a);
      camera.position.add(jitter);
    }
    render();
    labels.render(scene, camera);
    declutter(labels.domElement);
    if (left > 0) camera.position.sub(jitter);
  };

  // Every frame while something moves (see animating in tween.js) or the player is touching,
  // pointing or pressing keys; otherwise IDLE_MS apart, enough for torchlight and breathing.
  // Hidden pages draw nothing (the browser stops animation frames).
  const IDLE_MS = 50;
  let looping = false;
  let timer = 0;
  const later = () => { timer = setTimeout(() => requestAnimationFrame(idle), IDLE_MS); };
  const idle = () => {
    if (looping) return;
    draw(false);
    if (animating()) start();
    else later();
  };
  // Frames drawn back to back while something moves, and their time: how smoothly this
  // device draws the board (main.js reports it once a visit, play stats).
  const perf = { frames: 0, seconds: 0 };
  let lastFrame = 0;
  const start = () => {
    if (looping) return;
    clearTimeout(timer);
    looping = true;
    lastFrame = 0;
    renderer.setAnimationLoop((now) => {
      if (lastFrame && now - lastFrame < 500) { perf.frames++; perf.seconds += (now - lastFrame) / 1000; }
      lastFrame = now;
      draw(true);
      if (animating()) return;
      renderer.setAnimationLoop(null);
      looping = false;
      later();
    });
  };
  onAnimate(start);
  const touched = () => keepAwake(1000);
  for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart', 'touchmove']) {
    window.addEventListener(type, touched, { capture: true, passive: true });
  }
  keepAwake(1000);

  /** `fn(width, height)` returns { top, bottom, right }: the px the HUD covers. Re-fits. */
  const setInsets = (fn) => {
    insets = fn;
    fit();
  };

  return { scene, camera, renderer, controls, tickers, shake, fit, setInsets, perf, render, setEffects, setMood, dom: renderer.domElement };
}

/**
 * Keep figure labels from piling up when units crowd together. The active unit's label and
 * the ones nearer the viewer (lower on screen) stay put; any label that would cover one
 * takes the shortest move up or sideways that clears it, so a crowd spreads out rather
 * than stacking into a tower.
 */
const nudged = new WeakMap(); // label element -> [dx, dy] px it is moved by
const SIDEWAYS = 70; // the furthest a label slides left or right of its figure
function declutter(root) {
  const items = [];
  for (const el of root.querySelectorAll('.unit-label')) {
    if (el.style.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const [ox, oy] = nudged.get(el) ?? [0, 0];
    items.push({ el, ox, oy, l: r.left - ox, r: r.right - ox, t: r.top - oy, b: r.bottom - oy, active: el.classList.contains('active') });
  }
  items.sort((a, b) => (b.active - a.active) || (b.b - a.b));
  const placed = [];
  const hitAt = (it, dx, dy) => placed.find((p) =>
    it.l + dx < p.r - 2 && it.r + dx > p.l + 2 && it.t + dy < p.b && it.b + dy > p.t);
  for (const it of items) {
    // Search moves from the spot it would have; each collision suggests up, left or right.
    let best = null;
    const queue = [[0, 0]];
    const seen = new Set();
    for (let n = 0; n < 40 && queue.length; n++) {
      queue.sort((a, b) => cost(a) - cost(b));
      const [dx, dy] = queue.shift();
      if (seen.has(`${dx},${dy}`)) continue;
      seen.add(`${dx},${dy}`);
      if (best && cost([dx, dy]) >= cost(best)) break;
      const hit = hitAt(it, dx, dy);
      if (!hit) { best = [dx, dy]; break; }
      queue.push([dx, hit.t - it.b - 1]);
      if (Math.abs(hit.l - it.r - 1) <= SIDEWAYS) queue.push([hit.l - it.r - 1, dy]);
      if (Math.abs(hit.r - it.l + 1) <= SIDEWAYS) queue.push([hit.r - it.l + 1, dy]);
    }
    const [dx, dy] = best ?? [0, 0];
    placed.push({ l: it.l + dx, r: it.r + dx, t: it.t + dy, b: it.b + dy });
    if (Math.abs(dx - it.ox) > 0.5 || Math.abs(dy - it.oy) > 0.5) {
      nudged.set(it.el, [dx, dy]);
      it.el.style.translate = dx || dy ? `${dx}px ${dy}px` : '';
    }
  }
}
/** Sideways moves cost a little more than lifting, so labels stay close above their figure. */
const cost = ([dx, dy]) => Math.abs(dx) * 1.3 + Math.abs(dy);
