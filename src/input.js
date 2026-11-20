// Board input helpers: which tile a pointer is on, where a figure stands on screen, the long
// press that shows a character card on a touch screen, and what a click on a tile asks for.

import * as THREE from 'three';
import { key, gridDistance } from './game/grid.js';
import { SPELLS } from './game/abilities.js';
import { unitRef, targetRef } from './game/replay.js';

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

/**
 * The tile under a pointer event, or null. Clicking a figure's body (or a chest) picks its
 * tile, even though it overlaps tiles behind it; the nearest object under the pointer wins.
 * Hidden things (monsters out of sight, chests in unexplored rooms) can't be picked.
 */
export function tileFromEvent(ev, { stage, views, board, game }) {
  const r = stage.dom.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, stage.camera);

  const figures = [...views.values()].filter((v) => v.unit.alive && v.group.visible).map((v) => v.group);
  const hitObj = raycaster.intersectObjects([...figures, ...board.pickables.filter((p) => p.visible)], true)[0];
  if (hitObj) {
    let o = hitObj.object;
    while (o && o.userData.unitId === undefined && !o.userData.tile) o = o.parent;
    if (o?.userData.tile) return { ...o.userData.tile };
    const u = game.units.find((x) => x.id === o?.userData.unitId);
    if (u) return { x: u.x, z: u.z };
  }

  const hit = raycaster.intersectObject(board.pickPlane)[0];
  if (!hit) return null;
  const x = Math.round(hit.point.x);
  const z = Math.round(hit.point.z);
  return game.grid.inBounds(x, z) && !game.grid.isWall(x, z) ? { x, z } : null;
}

/** Where a figure (its view `v`) stands on screen: from the top of its label down to its tile. */
export function figureRect(stage, u, v) {
  const label = v?.label.element.getBoundingClientRect();
  const p = new THREE.Vector3(u.x, 0, u.z).project(stage.camera);
  const box = stage.dom.getBoundingClientRect();
  const x = box.left + ((p.x + 1) / 2) * box.width;
  const y = box.top + ((1 - p.y) / 2) * box.height;
  const top = label?.height ? label.top : y - 60;
  const half = Math.max(24, (label?.width ?? 0) / 2);
  return new DOMRect(x - half, top, half * 2, y - top);
}

const LONG_PRESS = 450;

/**
 * On a touch screen a long press on a figure shows its character card: `target(ev)` names
 * the figure under a press (or null), `show(unit)` shows its card. `consume()` is true once
 * after a press that showed a card, so that press isn't taken for a tap.
 */
export function longPress(dom, { target, show }) {
  let press = null;
  let shown = false;
  const cancel = () => {
    if (press) clearTimeout(press.timer);
    press = null;
  };
  function start(ev) {
    cancel();
    shown = false;
    if (ev.pointerType === 'mouse') return;
    const who = target(ev);
    if (!who) return;
    press = { x: ev.clientX, y: ev.clientY, timer: setTimeout(() => {
      press = null;
      shown = true;
      show(who);
    }, LONG_PRESS) };
  }
  dom.addEventListener('pointermove', (ev) => {
    if (press && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 10) cancel();
  });
  for (const type of ['pointerup', 'pointercancel']) dom.addEventListener(type, cancel);
  return {
    start,
    consume() {
      const was = shown;
      shown = false;
      return was;
    },
  };
}

/** Spell targetings that pick a unit (or corpse) rather than a tile. */
export const UNIT_TARGETING = ['enemy', 'ally', 'corpse'];

/**
 * What a click on tile `t` asks the hero `u` to do, given what's `selected` (an attack, a
 * spell or a shove): { cmd } to carry out, { toast } to explain why not, or null for nothing.
 * `unitAt(x, z)` is the visible unit on a tile, `spellTarget(t, spell)` a spell's unit there.
 */
export function tileCommand(game, u, t, selected, { unitAt, spellTarget }) {
  const other = unitAt(t.x, t.z);

  if (selected?.kind === 'spell') {
    const id = selected.id;
    const s = SPELLS[id];
    const target = UNIT_TARGETING.includes(s.targeting) ? spellTarget(t, s) : t;
    if (!target) return { toast: `Click ${s.targeting === 'ally' ? 'an ally' : 'a target'}` };
    const why = game.spellProblem(u, id, target);
    return why ? { toast: why } : { cmd: { type: 'spell', id, ...targetRef(game, target) } };
  }

  if (selected?.kind === 'shove') {
    if (!other || other.team === u.team) return { toast: 'Click an enemy next to you' };
    const why = game.shoveProblem(u, other);
    return why ? { toast: why } : { cmd: { type: 'shove', target: unitRef(game, other) } };
  }

  if (other && other.team !== u.team) {
    const atk = selected?.attack ?? game.bestAttack(u, other);
    const why = game.attackProblem(u, other, atk ?? u.attacks[0]);
    if (!atk || why) return { toast: why ?? 'Cannot attack' };
    return { cmd: { type: 'attack', target: unitRef(game, other), attack: u.attacks.indexOf(atk) } };
  }

  if (game.grid.chests.has(key(t.x, t.z))) {
    const why = game.chestProblem(u, t.x, t.z);
    return why ? { toast: why } : { cmd: { type: 'chest', x: t.x, z: t.z } };
  }

  if (other === u) return null;
  const node = game.reachable(u).get(key(t.x, t.z));
  if (!node || !game.canEndOn(u, t.x, t.z)) {
    return gridDistance(u, t) > u.movesLeft ? { toast: 'Too far, not enough movement left' } : null;
  }
  return { cmd: { type: 'move', x: t.x, z: t.z } };
}
