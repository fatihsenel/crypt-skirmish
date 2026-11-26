// Photo mode: the HUD goes, the camera turns, pans and zooms freely, and Save image keeps
// what's on screen as a PNG. Monster turns wait while it's on (whileAway in main.js), and
// Done (or Esc, or P) puts the camera back where it was.

import * as THREE from 'three';
import { keepAwake } from './render/tween.js';
import { saveImage } from './ui/runCard.js';
import { track, shareEvent } from './stats.js';
import { announce } from './ui/announce.js';

/**
 * `deps`: { canEnter() (a fight is on screen), board() (the Board, to hide its highlights),
 * views() (the unit views), focus() (the tile to turn about, or null), touch() (a finger: the share sheet saves) }.
 */
export function createPhotoMode(stage, deps) {
  const { camera, controls, renderer } = stage;
  const bar = document.getElementById('photo-bar');
  const saveBtn = document.getElementById('photo-save');
  const button = document.getElementById('photo-toggle');
  const waiting = new Set();
  let saved = null; // the camera and controls as they were
  let returnFocus = null;
  let marked = []; // unit views whose turn ring was showing

  const mode = {
    get active() { return !!saved; },
    /** Call `fn` once photo mode ends (or now, if it's off). */
    onLeave(fn) { if (saved) waiting.add(fn); else fn(); },
    enter,
    leave,
    toggle: () => (saved ? leave() : enter()),
  };

  function enter() {
    if (saved || !deps.canEnter()) return;
    saved = {
      position: camera.position.clone(), zoom: camera.zoom, target: controls.target.clone(), up: camera.up.clone(),
      frustum: [camera.left, camera.right, camera.top, camera.bottom], size: `${innerWidth}x${innerHeight}`,
      opts: {
        enableRotate: controls.enableRotate, minZoom: controls.minZoom, maxZoom: controls.maxZoom,
        mouseButtons: { ...controls.mouseButtons }, touches: { ...controls.touches },
        minPolarAngle: controls.minPolarAngle, maxPolarAngle: controls.maxPolarAngle,
      },
    };
    returnFocus = document.activeElement;
    Object.assign(controls, {
      enableRotate: true, minZoom: 0.4, maxZoom: 6,
      // The left button and one finger turn the view; the right button and two fingers pan.
      mouseButtons: { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN },
      touches: { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN },
      // From nearly overhead down to just above the floor.
      minPolarAngle: 0.1, maxPolarAngle: Math.PI * 0.46,
    });
    // The view is drawn off-centre to leave room for the HUD. With the HUD gone, centre it on
    // the figure whose turn it is (else the floor in the middle of the screen): the camera
    // turns about it.
    const at = deps.focus?.();
    let mid = at ? new THREE.Vector3(at.x, 0, at.z) : null;
    if (!mid) {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(0, 0), camera);
      mid = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    }
    if (mid) {
      camera.position.add(mid.clone().sub(controls.target));
      controls.target.copy(mid);
    }
    const halfW = (camera.right - camera.left) / 2;
    const halfH = (camera.top - camera.bottom) / 2;
    Object.assign(camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    camera.updateProjectionMatrix();
    controls.update();
    deps.board()?.showOverlays(false);
    // The gold whose-turn ring goes too (turns wait, so it's put back as it was).
    marked = [...(deps.views?.().values() ?? [])].filter((v) => v.marker.visible);
    for (const v of marked) v.marker.visible = false;
    document.body.classList.add('photo');
    stage.setEffects({ blur });
    bar.hidden = false;
    button?.setAttribute('aria-pressed', 'true');
    saveBtn.focus({ preventScroll: true });
    announce('Photo mode. Drag to turn the view, right-drag or two fingers to pan, scroll or pinch to zoom. Escape to leave.');
    keepAwake(300);
  }

  function leave() {
    if (!saved) return;
    const s = saved;
    saved = null;
    Object.assign(controls, s.opts);
    // Back to the view as it was. With damping off, one update spends what's left of the last
    // drag's glide; the next, after the reset, has nothing left to move.
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    camera.position.copy(s.position);
    camera.up.copy(s.up);
    camera.zoom = s.zoom;
    // The off-centre view again (fitted afresh if the window changed size meanwhile).
    if (s.size === `${innerWidth}x${innerHeight}`) [camera.left, camera.right, camera.top, camera.bottom] = s.frustum;
    else stage.fit();
    camera.updateProjectionMatrix();
    controls.target.copy(s.target);
    controls.update();
    controls.enableDamping = damping;
    deps.board()?.showOverlays(true);
    for (const v of marked) v.marker.visible = v.unit.alive;
    marked = [];
    document.body.classList.remove('photo');
    stage.setEffects({ blur: false });
    bar.hidden = true;
    button?.setAttribute('aria-pressed', 'false');
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    keepAwake(300);
    for (const fn of [...waiting]) fn();
    waiting.clear();
  }

  async function save() {
    // Drawn now and read straight back, before the browser clears the frame.
    stage.render();
    const blob = await new Promise((resolve) => renderer.domElement.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const label = saveBtn.textContent;
    try {
      const how = await saveImage(blob, `crypt-skirmish-${Date.now()}.png`, { touch: deps.touch() });
      if (how !== 'cancelled') {
        saveBtn.textContent = how === 'shared' ? 'Shared' : 'Saved';
        track(...shareEvent('photo', how === 'shared' ? 'share' : 'save'));
      }
    } catch {
      saveBtn.textContent = 'Couldn’t save';
    }
    setTimeout(() => { saveBtn.textContent = label; }, 2000);
  }

  // Depth of field: the figure in the middle sharp, nearer and farther things soft (render/post.js).
  let blur = true;
  const blurBtn = document.getElementById('photo-blur');
  const setBlur = (on) => {
    blur = on;
    blurBtn?.setAttribute('aria-pressed', String(on));
    if (saved) stage.setEffects({ blur });
  };
  blurBtn?.addEventListener('click', () => setBlur(!blur));

  saveBtn.addEventListener('click', save);
  document.getElementById('photo-done').addEventListener('click', leave);
  button?.addEventListener('click', () => mode.toggle());
  // While it's on, keys are photo mode's alone: P or Esc leaves, S saves.
  window.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement || ev.altKey || ev.metaKey || ev.ctrlKey) return;
    if (!saved) {
      if (ev.code === 'KeyP' && !ev.repeat && deps.canEnter()) {
        ev.preventDefault();
        enter();
      }
      return;
    }
    if (ev.code === 'Tab' || ((ev.code === 'Enter' || ev.code === 'Space') && ev.target instanceof HTMLButtonElement)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (ev.repeat) return;
    if (ev.code === 'Escape' || ev.code === 'KeyP') leave();
    else if (ev.code === 'KeyS') save();
    else if (ev.code === 'KeyB') setBlur(!blur);
  }, { capture: true });

  return mode;
}
