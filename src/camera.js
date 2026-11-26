// The camera: framing the board in the room the HUD leaves free, and every move it makes in a
// fight (gliding to a figure off screen on a phone, easing in for a named foe or the last
// blow, tipping on the stairs, peeking at the other floor). The camera keeps the board clear
// of the panels as they are actually laid out, which matters on a phone, where the action bar
// can be twice its desktop height. A newer pan always takes over from an older one (`panTween`).

import * as THREE from 'three';
import { key } from './game/grid.js';
import { wait, tween, playback, calm, keepAwake } from './render/tween.js';
import { otherFloor } from './input.js';
import { announce } from './ui/announce.js';

/**
 * `stage` and `hud`, and as functions `game()`, `board()` and `photo()` (the photo mode, made
 * later). `floorButton` is the Floor toggle (rooms on two floors).
 */
export function createCamera({ stage, hud, game, board, photo, floorButton }) {
  const $actionbar = document.getElementById('actionbar');
  let barRoom = 0; // the tallest action bar since the window last changed size
  let framedFor = '';
  const LOG_WIDTH = 290; // #log's width in styles/hud.css
  function hudInsets(w, h) {
    if (framedFor !== `${w}x${h}`) {
      framedFor = `${w}x${h}`;
      barRoom = 0;
    }
    const bar = $actionbar.getBoundingClientRect();
    if (bar.height) barRoom = Math.max(barRoom, h - bar.top);
    const top = document.getElementById('initiative').getBoundingClientRect().bottom;
    const log = document.getElementById('log');
    const beside = getComputedStyle(log).display !== 'none' && !hud.logOpen; // folded or not, so the board never jumps
    return {
      top: Math.max(56, top + 6),
      bottom: Math.max(80, barRoom + 6),
      right: beside ? w - log.getBoundingClientRect().right + LOG_WIDTH * (parseFloat(getComputedStyle(log).zoom) || 1) : 0, // its open width, even folded
    };
  }
  stage.setInsets(hudInsets);
  // A taller action bar (a hero with more to choose from) moves the board up, once.
  new ResizeObserver(() => {
    const h = window.innerHeight;
    if (h - $actionbar.getBoundingClientRect().top > barRoom + 4) stage.fit();
  }).observe($actionbar);

  /** On a phone the whole crypt is small: start zoomed in on the party (pinch and drag from there). */
  function frameParty() {
    if (Math.min(window.innerWidth, window.innerHeight) >= 600) return;
    const heroes = game().living('heroes');
    if (!heroes.length) return;
    const x = heroes.reduce((a, u) => a + u.x, 0) / heroes.length;
    const z = heroes.reduce((a, u) => a + u.z, 0) / heroes.length;
    lookAt(x, z, 2);
    // The initiative and action bars lay out over the next frames and refit the camera, which
    // can leave the party under the action bar: frame again once they have, unless a pan
    // (keepInView) has taken over by then.
    const ticket = panTween;
    const settle = (n) => requestAnimationFrame(() => {
      if (ticket !== panTween) return;
      if (n) settle(n - 1);
      else lookAt(x, z, stage.camera.zoom);
    });
    settle(3);
  }

  const raycaster = new THREE.Raycaster(); // finding the ground under a point of the screen

  /** Centre the view on a tile at a zoom level, in the middle of the area the HUD leaves free. */
  function lookAt(x, z, zoom) {
    const cam = stage.camera;
    cam.zoom = zoom;
    cam.updateProjectionMatrix();
    const shift = shiftTo(x, z);
    if (!shift) return;
    stage.controls.target.add(shift);
    cam.position.add(shift);
    keepAwake(100);
  }

  /** How far the camera must slide over the ground to put a tile in the middle of the free area. */
  function shiftTo(x, z) {
    const cam = stage.camera;
    cam.updateMatrixWorld();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const { top, bottom, right } = hudInsets(w, h);
    // Where the free area's middle is on the ground, and how far the tile is from it.
    const ndc = new THREE.Vector2(((w - right) / 2 / w) * 2 - 1, -(((top + h - bottom) / 2) / h) * 2 + 1);
    raycaster.setFromCamera(ndc, cam);
    const ground = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ground)) return null;
    return new THREE.Vector3(x, 0, z).sub(ground);
  }

  /**
   * On a phone only part of the crypt is on screen: when a unit near or past the edge of the
   * free area (between the initiative bar and the action bar) takes its turn, glide the camera
   * to centre it. Zoom stays put, and so does any pan the player made while the unit is in view.
   */
  let panTween = 0;
  function keepInView(unit) {
    if (Math.min(window.innerWidth, window.innerHeight) >= 600) return;
    const cam = stage.camera;
    cam.updateMatrixWorld(); // it may have moved since the last frame drew
    const w = window.innerWidth;
    const h = window.innerHeight;
    const { top, bottom, right } = hudInsets(w, h);
    const p = new THREE.Vector3(unit.x, 0, unit.z).project(cam);
    const sx = ((p.x + 1) / 2) * w;
    const sy = ((1 - p.y) / 2) * h;
    const mx = Math.min(70, (w - right) * 0.2);
    const my = Math.min(70, (h - top - bottom) * 0.2);
    const inside = sx >= mx && sx <= w - right - mx && sy >= top + my && sy <= h - bottom - my;
    if (inside) return;
    // Bring it to the middle of the free area (an edge would tuck it under the HUD buttons).
    const dx = sx - (w - right) / 2;
    const dy = sy - (top + h - bottom) / 2;
    // Turn that nudge into a ground-plane shift: where would the unit's screen point land?
    const toGround = (x, y) => {
      raycaster.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), cam);
      const g = new THREE.Vector3();
      return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), g) ? g : null;
    };
    const from = toGround(sx - dx, sy - dy);
    const to = toGround(sx, sy);
    if (!from || !to) return;
    glide(to.sub(from));
  }

  /** Slide the camera over the ground by `shift`, in 350 ms (at once with reduced motion). */
  function glide(shift) {
    const cam = stage.camera;
    const ticket = ++panTween;
    if (calm()) { // reduced motion: jump there
      stage.controls.target.add(shift);
      cam.position.add(shift);
      keepAwake(100);
      return;
    }
    const start = performance.now();
    keepAwake(450);
    let done = 0;
    const step = (now) => {
      if (ticket !== panTween) return; // a newer pan took over
      const t = Math.min(1, (now - start) / 350);
      const eased = 1 - (1 - t) ** 3;
      const d = shift.clone().multiplyScalar(eased - done);
      done = eased;
      stage.controls.target.add(d);
      cam.position.add(d);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Where the camera is now, to come back to after a close-up. */
  function cameraShot() {
    return { target: stage.controls.target.clone(), pos: stage.camera.position.clone(), zoom: stage.camera.zoom };
  }

  /**
   * Ease the camera over `ms` to `to`: a tile ({ x, z }, centred in the free area) at `zoom`,
   * or a shot from cameraShot(). A newer pan (glide, keepInView) takes over from it. Resolves
   * when it's there or was taken over.
   */
  function easeCamera(to, zoom, ms) {
    const cam = stage.camera;
    const ticket = ++panTween;
    const z0 = cam.zoom;
    let shift;
    if (to.target) {
      shift = to.target.clone().sub(stage.controls.target);
      zoom = to.zoom;
    } else {
      cam.zoom = zoom; // where the tile must go depends on the zoom (the HUD's insets)
      cam.updateProjectionMatrix();
      shift = shiftTo(to.x, to.z) ?? new THREE.Vector3();
      cam.zoom = z0;
      cam.updateProjectionMatrix();
    }
    const start = performance.now();
    let done = 0;
    return new Promise((resolve) => {
      const step = (now) => {
        if (ticket !== panTween) return resolve();
        const t = Math.min(1, (now - start) / ms);
        const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
        const d = shift.clone().multiplyScalar(e - done);
        done = e;
        stage.controls.target.add(d);
        cam.position.add(d);
        cam.zoom = z0 + (zoom - z0) * e;
        cam.updateProjectionMatrix();
        keepAwake(100);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  /**
   * A named foe first seen: the camera sweeps in on it while it speaks, holds, and goes back.
   * Not under reduced motion, in photo mode or while the page is hidden.
   */
  async function bossSweep(u) {
    if (calm() || photo().active || document.hidden) return;
    const back = cameraShot();
    const g = game();
    await easeCamera(u, Math.min(stage.controls.maxZoom, Math.max(back.zoom * 1.4, 1.5)), 700);
    await wait(1300);
    if (game() !== g || photo().active) return;
    await easeCamera(back, back.zoom, 650);
  }

  /**
   * A figure in sight takes the stairs (`step`, over about `ms`): the camera tips to look down
   * the stairwell going down (or lower going up) and leans in, and comes back as it arrives; for
   * a hero it glides along to where they come out. Not under reduced motion, in photo mode or
   * while the page is hidden. A newer pan takes over from it.
   */
  async function stairCamera(step, unit, ms) {
    if (calm() || photo().active || document.hidden) return;
    const cam = stage.camera;
    const ticket = ++panTween;
    const target0 = stage.controls.target.clone();
    const shift = unit.team === 'heroes' ? shiftTo(step.to.x, step.to.z) ?? new THREE.Vector3() : new THREE.Vector3();
    const orbit = new THREE.Spherical().setFromVector3(cam.position.clone().sub(target0));
    const phi0 = orbit.phi;
    const tilt = step.down ? -0.17 : 0.1; // less phi looks more from above
    const z0 = cam.zoom;
    const zoom = Math.min(stage.controls.maxZoom, z0 * 1.12);
    const at = new THREE.Vector3();
    let level = false;
    /** Upright and at its zoom again, round wherever the camera looks now. */
    const settle = () => {
      level = true;
      orbit.phi = phi0;
      cam.position.copy(stage.controls.target).add(new THREE.Vector3().setFromSpherical(orbit));
      cam.zoom = z0;
      cam.updateProjectionMatrix();
      keepAwake(100);
    };
    await tween(ms + 500, (t) => {
      if (ticket !== panTween) { // a newer pan took over: it keeps its way, but not the tilt
        if (!level) settle();
        return;
      }
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      const bump = Math.sin(Math.PI * Math.min(1, t * 1.05)); // in, and back by the end
      at.copy(target0).addScaledVector(shift, e);
      orbit.phi = Math.max(0.05, phi0 + tilt * bump);
      stage.controls.target.copy(at);
      cam.position.copy(at).add(new THREE.Vector3().setFromSpherical(orbit));
      cam.zoom = z0 + (zoom - z0) * bump;
      cam.updateProjectionMatrix();
      keepAwake(100);
    });
    if (level) return;
    if (ticket === panTween) stage.controls.target.copy(target0).add(shift);
    settle();
  }

  /**
   * The fight's last blow: the camera closes in on the foe and the blow plays slowly. Returns
   * its two ends (`landed`: the speed back, `back`: the camera back), or null when it doesn't
   * happen.
   */
  function lastBlow(at) {
    if (calm() || photo().active || document.hidden) return null;
    const back = cameraShot();
    const rate = playback.rate;
    playback.rate = rate * 0.4;
    easeCamera(at, Math.min(stage.controls.maxZoom, Math.max(back.zoom * 1.6, 1.8)), 450);
    return {
      /** After the blow lands: a beat more, slowly, then the speed comes back. */
      landed: async () => {
        await wait(300);
        playback.rate = rate;
      },
      /** Once the foe is down: the camera goes back. */
      back: () => easeCamera(back, back.zoom, 600),
    };
  }

  /**
   * V (or a press of the right stick), in a room on two floors: the camera glides to the far end
   * of the stair nearest the hero whose turn it is, to look down (or up) it; V again glides back
   * to where it was. The fog stays as it is: only what the party has seen shows there.
   */
  let peek = null; // { unit, target }: who looked, and where the camera was before
  floorButton.addEventListener('click', () => peekFloor());
  function setPeek(p) {
    peek = p;
    floorButton.setAttribute('aria-pressed', String(!!p));
  }
  function peekFloor() {
    if (!game() || !board()) return;
    const hero = game().current?.team === 'heroes' ? game().current : game().living('heroes')[0];
    if (!hero) return;
    if (peek?.unit === hero) {
      glide(peek.target.clone().sub(stage.controls.target));
      setPeek(null);
      announce(`Back to ${hero.name}.`);
      return;
    }
    const there = otherFloor(game().grid, hero);
    if (!there) {
      announce('This room has one floor.');
      return;
    }
    const shift = shiftTo(there.x, there.z);
    if (!shift) return;
    setPeek({ unit: hero, target: stage.controls.target.clone() });
    glide(shift);
    const hall = there.lower ? 'the lower hall' : 'the hall above';
    announce(`Looking ${there.lower ? 'down' : 'up'} the stairs at ${hall}` +
      (board().explored.has(key(there.x, there.z)) ? '' : `, still dark: stand on the stair to see ${there.lower ? 'down' : 'up'} it`) +
      `. ${hud.touch ? 'Floor' : 'V'} again to look back.`);
  }

  return {
    hudInsets, frameParty,
    /** The action bar's height changed (the Text size): measure it afresh, smaller too. */
    remeasure: () => { framedFor = ''; },
    lookAt, keepInView, bossSweep, stairCamera, lastBlow, peekFloor, setPeek,
  };
}
