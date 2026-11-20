// Board input: the mouse, touch (tap to preview, tap again to act; hold a figure for its
// card) and the keyboard (an arrow-key cursor, Enter to pick and Enter again to act, and the
// shortcut keys). main.js owns the fight; this turns input into its calls.

import * as THREE from 'three';
import { key } from './game/grid.js';
import { tileFromEvent, figureRect, longPress, tileCommand, stepTile, ARROWS, tileSummary, enterStep } from './input.js';
import { replayKey } from './ui/replayBar.js';
import { announce } from './ui/announce.js';

/**
 * `deps`: the stage, HUD, threat zones, help panel and camp; getters for the fight's state
 * (game, board, views, busy, replay, hovered, selected) and setters for the last two; and main's
 * actions (refresh, heroCommand, endHeroTurn, undoMove, endReplay, keepInView, the sound
 * toggles, visibleUnitAt, spellTargetAt). Returns { touching, unitRect }.
 */
export function createControls(deps) {
  const { stage, hud, threats, helpBox } = deps;
  const game = () => deps.game();
  const heroTurn = () => deps.isHeroTurn() && !deps.busy();
  const hovered = () => deps.hovered();
  const view = (u) => deps.views().get(u.id);

  const pickTile = (ev) => tileFromEvent(ev, { stage, views: deps.views(), board: deps.board(), game: game() });
  const unitRect = (u) => figureRect(stage, u, view(u));

  // A finger has no hover: the first tap on a tile shows what would happen there (the path,
  // the odds, the blast), and a second tap on the same tile does it. Dragging pans the view.
  let touching = matchMedia('(hover: none)').matches; // the last pointer was a finger or pen
  hud.touch = touching;
  document.body.classList.toggle('touch', touching);
  let downAt = null;
  window.addEventListener('pointerdown', (ev) => {
    const touch = ev.pointerType !== 'mouse';
    if (touch === touching) return;
    touching = hud.touch = touch;
    document.body.classList.toggle('touch', touch);
    if (heroTurn()) deps.refresh(); // hints say "tap" now
  }, { capture: true });
  stage.dom.addEventListener('pointerdown', (ev) => {
    downAt = { x: ev.clientX, y: ev.clientY };
    press.start(ev);
  });

  // On a touch screen a long press on a figure shows its character card (a tap previews and
  // acts, as before). The press that showed the card isn't a tap.
  const press = longPress(stage.dom, {
    target: (ev) => {
      if (!game() || game().over) return null;
      const t = pickTile(ev);
      return t && deps.visibleUnitAt(t.x, t.z);
    },
    show: (who) => hud.showUnitCard(game(), who, unitRect(who)),
  });
  stage.dom.addEventListener('contextmenu', (ev) => ev.pointerType !== 'mouse' && touching && ev.preventDefault());

  stage.dom.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    putCursorAway(); // the mouse has the cursor again
    const t = pickTile(ev);
    if (t?.x === hovered()?.x && t?.z === hovered()?.z) return;
    deps.setHovered(t);
    // The character card for a figure the mouse rests on, whoever's turn it is.
    const who = game() && t && !game().over ? deps.visibleUnitAt(t.x, t.z) : null;
    hud.hoverUnit(game(), who, () => unitRect(who));
    if (heroTurn()) deps.refresh();
  });

  stage.dom.addEventListener('pointerleave', (ev) => {
    if (ev.pointerType !== 'mouse') return; // a lifted finger leaves its preview up
    deps.setHovered(null);
    hud.hoverUnit(game(), null);
    if (heroTurn()) deps.refresh();
  });
  for (const type of ['pointerdown', 'wheel']) {
    stage.dom.addEventListener(type, (ev) => ev.pointerType !== 'touch' && hud.hoverUnit(game(), null), { passive: true });
  }

  stage.dom.addEventListener('click', (ev) => {
    if (press.consume()) return; // the long press that showed a card
    if (!heroTurn()) return;
    if (downAt && Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 10) return; // a drag
    const t = pickTile(ev);
    if (!t) return;
    if (touching && (t.x !== hovered()?.x || t.z !== hovered()?.z)) {
      deps.setHovered(t);
      deps.refresh();
      return;
    }
    act(t);
  });

  /** What a click on tile `t` asks for (see tileCommand). */
  const commandAt = (t) => tileCommand(game(), game().current, t, deps.selected(),
    { unitAt: deps.visibleUnitAt, spellTarget: deps.spellTargetAt });

  /** What a click (or Enter on the keyboard cursor) on tile `t` does: act, or say why not. */
  function act(t) {
    const r = commandAt(t);
    if (r?.toast) hud.toast(r.toast); // #toast is a status region: it's read out too
    else if (r?.cmd) deps.heroCommand(r.cmd);
  }

  // The keyboard cursor: the arrow keys move the hovered tile (starting on the hero whose turn
  // it is) and show what a click there would do; Enter picks the tile and Enter again does it.
  // The mouse takes it back. hud.keys tells the hints to say Enter rather than click.
  let armed = null; // the tile key Enter picked
  const screenOf = (x, z) => {
    const v = new THREE.Vector3(x, 0, z).project(stage.camera);
    return { x: v.x, y: -v.y * (stage.dom.clientHeight / Math.max(1, stage.dom.clientWidth)) };
  };
  /** Show the cursor's tile, and read out what's there and what Enter would do. */
  function showCursor() {
    const t = hovered();
    const who = deps.visibleUnitAt(t.x, t.z);
    hud.hoverUnit(game(), who, () => unitRect(who));
    hud.armed = armed === key(t.x, t.z);
    if (heroTurn()) deps.refresh();
    else deps.board().hover.set([t]);
    const where = tileSummary(game(), t, { unitAt: deps.visibleUnitAt, explored: (x, z) => deps.board().isExplored(x, z) });
    announce([where, hud.hintText()].filter(Boolean).join('. '));
  }
  function moveCursor(dir) {
    const g = game();
    const hero = g.current?.team === 'heroes' ? g.current : g.living('heroes')[0];
    if (!hero) return;
    const t = hud.keys && hovered() ? stepTile(g.grid, hovered(), dir, screenOf) : { x: hero.x, z: hero.z };
    deps.setHovered(t);
    hud.keys = true;
    armed = null;
    deps.keepInView(t); // a phone with a keyboard: don't let it walk off screen
    showCursor();
  }
  function enter() {
    const t = hovered();
    if (!heroTurn()) return;
    if (enterStep(armed, t, commandAt(t)) === 'arm') {
      armed = key(t.x, t.z);
      showCursor();
      return;
    }
    armed = null;
    hud.armed = false;
    act(t);
  }
  function putCursorAway() {
    if (!hud.keys) return;
    hud.keys = hud.armed = false;
    armed = null;
  }

  const boardKeys = () => game() && deps.board() && !game().over && !deps.replay() && !deps.camp.open;
  window.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement) return; // typing a hero's name
    const replay = deps.replay();
    if (replay && replayKey(replay, ev, game()?.round ?? 0, deps.endReplay)) return;
    if (ARROWS[ev.code] && boardKeys() && !ev.altKey && !ev.metaKey && !ev.ctrlKey) {
      if (ev.target.closest?.('#settings, #log, #help, .overlay')) return; // scrolling or picking there
      ev.preventDefault();
      moveCursor(ARROWS[ev.code]);
      return;
    }
    if (ev.code === 'Space' || ev.code === 'Enter') {
      if (ev.target instanceof HTMLButtonElement || ev.target instanceof HTMLElement && ev.target.closest('summary')) return;
      ev.preventDefault();
      if (ev.repeat) return; // a held key doesn't end turn after turn
      // Enter works the keyboard cursor's tile; Space (or Enter without the cursor) ends the turn.
      if (ev.code === 'Enter' && hud.keys && hovered()) enter();
      else deps.endHeroTurn();
    }
    if (ev.code === 'KeyZ' && !ev.altKey) {
      ev.preventDefault();
      deps.undoMove();
    }
    if (ev.code === 'KeyT') threats.toggle();
    if (ev.code === 'KeyM') deps.toggleSound();
    if (ev.code === 'KeyN') deps.toggleMusic();
    if (ev.code === 'KeyH' || ev.key === '?') helpBox.open = !helpBox.open;
    if (ev.code === 'KeyL' && game()) hud.toggleLog();
    if (ev.code === 'Escape') {
      if (armed) { // un-pick the tile, keep the cursor and the attack or spell
        armed = null;
        hud.armed = false;
        if (heroTurn()) deps.refresh();
        return;
      }
      if (!deps.selected() && hud.keys) { // nothing to cancel: put the keyboard cursor away
        putCursorAway();
        deps.setHovered(null);
        hud.hoverUnit(game(), null);
      }
      deps.setSelected(null);
      if (heroTurn()) deps.refresh();
      else deps.board()?.hover.clear();
    }
  });

  return {
    get touching() { return touching; },
    unitRect,
    /** Forget a picked tile (a new turn, an action taken): Enter picks afresh. */
    disarm() { armed = null; hud.armed = false; },
  };
}
