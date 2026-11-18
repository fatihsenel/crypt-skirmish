// Controller: wires the rules engine (game/) to the renderer (render/) and HUD (ui/).
// The engine resolves everything instantly; this file plays the results back as animations.

import './style.css';
import * as THREE from 'three';
import { Game } from './game/combat.js';
import { LEVELS, levelById } from './game/maps.js';
import { Grid } from './game/grid.js';
import {
  NODES, newCampaign, completeFight, takeRest, equip, unequip, serialize, parseSave,
} from './game/campaign.js';
import { nextMonsterStep } from './game/ai.js';
import { key, pathFrom, gridDistance } from './game/grid.js';
import { signed, abilityMod } from './game/dice.js';
import { SPELLS, ACTIONS, coneTiles, areaTiles, directionTo } from './game/abilities.js';
import { createStage } from './render/stage.js';
import { Board } from './render/board.js';
import { UnitView, shootProjectile, floatText } from './render/unitView.js';
import { preloadModels } from './render/gltfModels.js';
import { preloadDungeon } from './render/dungeonKit.js';
import { missileFx, coneFx, mistFx, shieldFx, healFx, alertFx, radiantFx, turnFx, raiseFx, fireballFx, hitFx, fireBurstFx, d20Fx } from './render/effects.js';
import { wait } from './render/tween.js';
import { Hud } from './ui/hud.js';
import { Camp } from './ui/camp.js';
import { ITEMS } from './game/items.js';
import { sfx } from './audio/sfx.js';

// All levels share one size, so the stage is set up once.
const stage = createStage(document.getElementById('stage'), {
  width: LEVELS[0].rows[0].length,
  height: LEVELS[0].rows.length,
});

// --- campaign & saves ---------------------------------------------------------
const SAVE_KEY = 'crypt-skirmish.save';
// Storage can be blocked (private windows, sandboxed previews); the game still runs.
// Test runs (?level=, __debug.level) never touch the save.
let saving = true;
function loadSave() {
  try { return parseSave(localStorage.getItem(SAVE_KEY)); } catch { return null; }
}
function writeSave(state) {
  if (!saving) return;
  try { localStorage.setItem(SAVE_KEY, serialize(state)); } catch { /* not saved */ }
}
function clearSave() {
  if (!saving) return;
  try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing to clear */ }
}

/** Campaign state as of the last camp (and the last save). A lost fight leaves it untouched. */
let campaign = null;
/** The map node being fought. */
let nodeId = null;

const hud = new Hud({
  onEndTurn: () => endHeroTurn(),
  onChoose: (choice) => choose(choice),
  onRestart: () => {
    sfx.ui();
    if (game?.over === 'victory') startCampaign(); // after the final room
    else newGame(); // retry this room with the party as it entered
  },
  onNext: () => leaveRoom(),
  onMap: () => {
    sfx.ui();
    showCamp(null);
  },
  onToggleSound: () => toggleSound(),
});

const camp = new Camp({
  onEnter: (id) => enterRoom(id),
  onEquip: (i, code) => {
    sfx.chest();
    campaign = equip(campaign, i, code);
    writeSave(campaign);
    camp.show(campaign);
  },
  onUnequip: (code, i) => {
    sfx.ui();
    campaign = unequip(campaign, code, i);
    writeSave(campaign);
    camp.show(campaign);
  },
  onNewCampaign: () => startCampaign(),
  onContinue: () => {
    sfx.ui();
    saving = true;
    campaign = loadSave() ?? newCampaign();
    showCamp(null);
  },
});

function startCampaign() {
  sfx.ui();
  saving = true;
  campaign = newCampaign();
  writeSave(campaign);
  showCamp(null);
}

function showCamp(report) {
  $banner.hidden = true;
  camp.show(campaign, report);
}

function enterRoom(id) {
  sfx.ui();
  if (NODES[id].kind === 'rest') {
    campaign = takeRest(campaign, id);
    writeSave(campaign);
    sfx.heal();
    showCamp({ rest: id });
    return;
  }
  camp.hide();
  nodeId = id;
  newGame();
}

/** After a won room: rest, XP, loot, save, then back to the map. */
function leaveRoom() {
  if (game?.over !== 'victory') return;
  sfx.ui();
  const { state, report } = completeFight(campaign, nodeId, game);
  campaign = state;
  writeSave(campaign);
  showCamp(report);
  if (report.levelUps.length) setTimeout(() => sfx.levelUp(), 250);
}

const $banner = document.getElementById('banner');

// Audio may only start after a user gesture.
const unlockAudio = () => sfx.unlock();
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

function toggleSound() {
  sfx.unlock();
  sfx.setMuted(!sfx.muted);
  hud.setSound(!sfx.muted);
}
hud.setSound(!sfx.muted);

let game;
let board;
let views = new Map();
let busy = false;
let ended = false;
/** null = default (click enemy to attack with best weapon, click tile to move),
 *  { kind: 'attack', attack } or { kind: 'spell', id } = targeting mode. */
let selected = null;
let hovered = null; // {x, z}
let pendingReveals = []; // traps spotted during a move, shown once the move has played out
let pendingAlerts = [];  // monsters that noticed the party, shown once the action has played out
let debugAutoplay = false; // __debug.autoplay(true): the monster AI plays the heroes too

const view = (u) => views.get(u.id);

// --- fog of war -----------------------------------------------------------------
// Vision follows the figures as drawn (a hero walking through a door reveals the room
// as they step in), not the engine's instant results.
let visible = new Set();   // tile keys the heroes see right now
let seenIds = new Set();   // monsters the heroes have laid eyes on this fight
let visionSig = '';

const tileOf = (v) => ({ x: Math.round(v.group.position.x), z: Math.round(v.group.position.z) });
const inView = (t) => visible.has(key(t.x, t.z));
/** Is this unit hidden from the heroes right now? */
const unseen = (u) => u.team === 'monsters' && !!view(u) && !inView(tileOf(view(u)));

function updateVision(force = false) {
  if (!game || !board) return;
  const grid = game.grid;
  if (game.over && ended) {
    // The fight is decided: lift the fog (the stairs, who was lurking where).
    if (visionSig === 'over') return;
    visionSig = 'over';
    visible = new Set();
    for (let z = 0; z < grid.height; z++) for (let x = 0; x < grid.width; x++) visible.add(key(x, z));
    board.setVision(visible);
    return;
  }
  const eyes = game.units.filter((u) => u.team === 'heroes' && u.alive && view(u)).map((u) => tileOf(view(u)));
  const doors = [...board.doors.values()].map((d) => (d.opened ? 1 : 0)).join('');
  const sig = eyes.map((e) => key(e.x, e.z)).join(';') + '|' + doors;
  if (sig === visionSig && !force) return;
  const first = !visionSig;
  visionSig = sig;
  const blocks = (x, z) => grid.isWall(x, z) || (grid.doors.has(key(x, z)) && !board.doors.get(key(x, z)).opened);
  visible = grid.visibleFrom(eyes, blocks);
  board.setVision(visible, { snap: first });
}

/** Every frame: hide monsters out of sight, notice new ones. */
stage.tickers.add(() => {
  if (!game || !board) return;
  updateVision();
  let spotted = false;
  for (const v of views.values()) {
    const u = v.unit;
    if (u.team !== 'monsters') continue;
    const t = tileOf(v);
    const show = u.alive ? inView(t) : board.isExplored(t.x, t.z);
    v.group.visible = show && !v.gone;
    if (show && u.alive && !seenIds.has(u.id)) {
      seenIds.add(u.id);
      spotted = true;
    }
  }
  if (spotted) hud.renderInitiative(game);
});

function addView(u) {
  const v = new UnitView(u, stage);
  views.set(u.id, v);
  stage.scene.add(v.group);
  return v;
}

// --- setup ----------------------------------------------------------------
function newGame() {
  if (board) {
    stage.scene.remove(board.group);
    board.dispose();
  }
  for (const v of views.values()) {
    v.dispose();
    stage.scene.remove(v.group);
  }

  const level = levelById(NODES[nodeId].level);
  game = new Game(level, { party: campaign.party });
  board = new Board(game.grid, stage);
  stage.scene.add(board.group);
  views = new Map();
  for (const u of game.units) addView(u);

  busy = false;
  ended = false;
  selected = null;
  pendingReveals = [];
  pendingAlerts = [];
  visionSig = '';
  seenIds = new Set();
  board.fadeSources = () => [...views.values()]
    .filter((v) => v.unit.alive && v.group.visible)
    .map((v) => v.group.position);
  updateVision();
  hud.unknown = (u) => u.team === 'monsters' && !seenIds.has(u.id);
  hud.hidden = (u) => unseen(u);
  hud.reset();
  hud.levelIntro(level, campaign.party.F.level);

  game.on('initiative', ({ order }) => {
    hud.log('<b>Roll for initiative!</b>', 'sys');
    sfx.dice();
    let lurking = 0;
    for (const u of order) {
      if (unseen(u)) {
        lurking++;
        continue;
      }
      hud.log(`<span class="${u.team}">${u.name}</span> <span class="dice">d20 ${u.initRoll} ${signed(u.initiative - u.initRoll)} = ${u.initiative}</span>`);
    }
    if (lurking) hud.log(`<span class="monsters">Something</span> stirs beyond your sight…`, 'sys');
  });
  game.on('round', ({ round }) => hud.log(`Round ${round}`, 'round'));
  game.on('turnStart', ({ unit }) => onTurnStart(unit));
  game.on('attack', (r) => hud.logAttack(r));
  game.on('spell', (r) => {
    if (unseen(r.caster)) hud.log('You hear chanting somewhere in the dark…', 'sys');
    else hud.logSpell(r);
  });
  game.on('action', (r) => { if (!unseen(r.unit)) hud.logAction(r); });
  game.on('death', ({ unit }) => {
    if (unseen(unit)) hud.log('Something falls in the dark.', 'death');
    else hud.log(`<span class="${unit.team}">${unit.name}</span> falls.`, 'death');
  });
  game.on('trap', (r) => {
    if (r.unit.team === 'monsters' && !inView(r.trap)) hud.log('A trap snaps shut somewhere in the dark.', 'sys');
    else hud.logTrap(r);
  });
  game.on('chest', (r) => hud.logChest(r));
  game.on('trapFound', (r) => pendingReveals.push(r));
  game.on('alert', (r) => pendingAlerts.push(r));

  game.start();
}

function isHeroTurn() {
  return game && !game.over && !camp.open && game.current?.team === 'heroes';
}

/** The dungeon without anyone in it, behind the title screen. */
function showBackdrop() {
  board = new Board(new Grid(LEVELS[0].rows), stage);
  stage.scene.add(board.group);
}

function syncStatus() {
  flushAlerts();
  for (const v of views.values()) v.updateStatus();
}

const ALERT_TEXT = {
  sight: 'spots the party!',
  ally: 'is roused by a shout!',
  noise: 'hears the fighting!',
  hurt: 'is caught off guard!',
};

/** Monsters that just noticed the party: a "!" over each one in view, one log line. */
function flushAlerts() {
  if (!pendingAlerts.length) return;
  let hidden = 0;
  for (const { unit, cause } of pendingAlerts) {
    if (unseen(unit)) {
      hidden++;
      continue;
    }
    if (cause !== 'hurt') floatText(stage.scene, unit, '!', 'warn');
    hud.log(`<span class="monsters">${unit.name}</span> ${ALERT_TEXT[cause]}`, 'sys');
  }
  if (hidden) hud.log('Somewhere in the dark, something stirs.', 'sys');
  if (pendingAlerts.some((a) => !unseen(a.unit) && a.cause !== 'hurt')) sfx.alert();
  pendingAlerts = [];
}

/** Shows traps a hero spotted, after their move has finished playing. */
function flushReveals() {
  for (const r of pendingReveals) {
    hud.logTrapFound(r);
    board.showTrap(r.trap);
    sfx.discover();
    floatText(stage.scene, r.trap, 'Trap!', 'warn');
  }
  pendingReveals = [];
}

async function onTurnStart(unit) {
  flushReveals();
  for (const v of views.values()) v.setActive(v.unit === unit);
  selected = null;
  syncStatus();
  hud.renderInitiative(game);
  refresh();
  if (unit.team === 'heroes') sfx.turn();
  if (unit.team === 'monsters' || debugAutoplay) await runMonsterTurn(unit);
}

// --- highlights & HUD -------------------------------------------------------
/** Indices of path tiles where leaving provokes an opportunity attack. */
function provokingSteps(u, path) {
  const out = [];
  for (let i = 0; i < path.length - 1; i++) {
    if (game.provokers(u, [path[i], path[i + 1]]).length) out.push(path[i]);
  }
  return out;
}

function modsText(m) {
  if (m.mode === 'adv') return ` · advantage (${m.adv.join(', ')})`;
  if (m.mode === 'dis') return ` · disadvantage (${m.dis.join(', ')})`;
  return '';
}

function refresh() {
  hud.renderActionBar(game, { selected, busy });
  board.clearHighlights();
  const u = game.current;
  if (!u || game.over) return;
  if (!unseen(u)) board.active.set([u]);
  hud.hint('');
  if (!isHeroTurn() || busy) return;

  if (selected?.kind === 'spell') return refreshSpell(u, selected.id);

  const reach = game.reachable(u);
  board.reach.set(game.destinations(u).filter((t) => board.isExplored(t.x, t.z)));
  const atkOk = (f) => (selected ? !game.attackProblem(u, f, selected.attack) : game.bestAttack(u, f));
  board.targets.set(game.enemiesOf(u).filter((f) => !unseen(f) && atkOk(f)));

  if (!hovered) {
    if (selected) hud.hint(`${selected.attack.name}: click an enemy · Esc to cancel`);
    return;
  }
  board.hover.set([hovered]);
  const foe = visibleUnitAt(hovered.x, hovered.z);
  if (foe && foe.team !== u.team) {
    const atk = selected?.attack ?? game.bestAttack(u, foe);
    if (atk && !game.attackProblem(u, foe, atk)) {
      const m = game.attackMods(u, foe, atk);
      hud.hint(`${atk.name} → ${foe.name}: ${signed(game.toHitBonus(u, atk))} to hit vs AC ${game.acOf(foe)}, ${atk.damage} damage${modsText(m)}`);
    } else {
      hud.hint(`${foe.name}: ${game.attackProblem(u, foe, atk ?? u.attacks[0])}`);
    }
    return;
  }
  if (game.grid.chests.has(key(hovered.x, hovered.z))) {
    const why = game.chestProblem(u, hovered.x, hovered.z);
    hud.hint(why ?? 'Open the chest (free, once per turn)');
    return;
  }
  const node = reach.get(key(hovered.x, hovered.z));
  if (node && node.dist > 0 && game.canEndOn(u, hovered.x, hovered.z)) {
    const path = pathFrom(reach, hovered.x, hovered.z);
    board.path.set(path.slice(1));
    const danger = provokingSteps(u, path);
    board.danger.set(danger);
    const who = game.provokers(u, path).map((f) => f.name);
    hud.hint(`Move ${node.dist * 5} ft` + (who.length ? ` · provokes an opportunity attack from ${who.join(' and ')}` : ''));
  }
}

const UNIT_TARGETING = ['enemy', 'ally', 'corpse'];

/** The unit on a tile, unless it's a monster lurking out of sight. */
function visibleUnitAt(x, z) {
  const u = game.unitAt(x, z);
  return u && !unseen(u) ? u : null;
}

/** The unit (or corpse) a unit-targeted spell would hit on tile t. */
function spellTargetAt(t, s) {
  if (!t) return null;
  if (s.targeting === 'corpse') return game.corpses().find((c) => c.x === t.x && c.z === t.z) ?? null;
  return visibleUnitAt(t.x, t.z);
}

/** One-line preview of what a unit-targeted spell will do to `t`. */
function spellPreview(u, id, t) {
  const s = SPELLS[id];
  switch (id) {
    case 'magicMissile':
      return `Magic Missile → ${t.name}: 3 darts × 1d4+1, never misses`;
    case 'sacredFlame':
      return `Sacred Flame → ${t.name}: ${s.damage} radiant, DEX save DC ${game.spellDC(u)} negates (their DEX ${signed(abilityMod(t.stats.dex))})`;
    case 'cureWounds':
    case 'healingWord': {
      const [n, d] = s.heal;
      return `${s.name} → ${t === u ? 'yourself' : t.name}: heal ${n}d${d}${signed(abilityMod(u.stats[u.castStat]))} (HP ${t.hp}/${t.maxHp})`;
    }
    default:
      return `${s.name} → ${t.name}`;
  }
}

function refreshSpell(u, id) {
  const s = SPELLS[id];
  switch (s.targeting) {
    case 'enemy':
    case 'ally':
    case 'corpse': {
      const layer = s.targeting === 'ally' ? board.allies : board.targets;
      layer.set(game.spellTargets(u, id).filter((t) => !unseen(t)));
      const t = spellTargetAt(hovered, s);
      if (t) {
        board.hover.set([hovered]);
        const why = game.spellProblem(u, id, t);
        hud.hint(why ? `${t.name}: ${why}` : spellPreview(u, id, t));
      } else {
        const what = { enemy: 'an enemy', ally: 'an ally or yourself', corpse: 'a corpse' }[s.targeting];
        hud.hint(`${s.name}: click ${what} · Esc to cancel`);
      }
      break;
    }
    case 'cone': {
      if (!hovered || (hovered.x === u.x && hovered.z === u.z)) {
        hud.hint(`${s.name}: point the cone with the mouse, click to cast · Esc to cancel`);
        return;
      }
      const tiles = coneTiles(game.grid, u, directionTo(u, hovered), s.range);
      board.cone.set(tiles);
      const caught = tiles.map((t) => visibleUnitAt(t.x, t.z)).filter(Boolean);
      const allies = caught.filter((c) => c.team === u.team);
      const foes = caught.filter((c) => c.team !== u.team);
      hud.hint(
        `${s.name}: ${s.damage} fire, DEX save DC ${game.spellDC(u)} for half · ` +
          (foes.length ? `hits ${foes.map((f) => f.name).join(', ')}` : 'no enemies in the cone') +
          (allies.length ? ` · ⚠ also burns ${allies.map((a) => a.name).join(', ')}!` : ''),
      );
      break;
    }
    case 'area': {
      if (!hovered) {
        hud.hint(`${s.name}: pick the point of the blast · Esc to cancel`);
        return;
      }
      const why = game.spellProblem(u, id, hovered);
      if (why) {
        hud.hint(`${s.name}: ${why}`);
        return;
      }
      const tiles = areaTiles(game.grid, hovered, s.radius);
      board.cone.set(tiles);
      board.hover.set([hovered]);
      const caught = tiles.map((t) => visibleUnitAt(t.x, t.z)).filter(Boolean);
      const allies = caught.filter((c) => c.team === u.team);
      const foes = caught.filter((c) => c.team !== u.team);
      hud.hint(
        `${s.name}: ${s.damage} fire in ${s.radius * 5} ft, DEX save DC ${game.spellDC(u)} for half · ` +
          (foes.length ? `hits ${foes.map((f) => f.name).join(', ')}` : 'no enemies caught') +
          (allies.length ? ` · ⚠ also burns ${allies.map((a) => a.name).join(', ')}!` : ''),
      );
      break;
    }
    case 'tile': {
      board.teleport.set(game.teleportTiles(u));
      if (hovered) {
        const ok = !game.spellProblem(u, id, hovered);
        if (ok) board.hover.set([hovered]);
        hud.hint(ok ? `${s.name}: teleport here (bonus action)` : 'Pick an empty spot you can see within 30 ft');
      } else {
        hud.hint(`${s.name}: click a purple tile · Esc to cancel`);
      }
      break;
    }
    default:
      hud.hint('');
  }
}

// --- animation of resolved results ----------------------------------------
/**
 * Plays back an attack the engine already resolved.
 * `at` overrides the target's position (opportunity attacks happen mid-move).
 */
async function animateAttack(r, at = r.target) {
  const { attacker, target, attack } = r;
  const av = view(attacker);
  const tv = view(target);
  const pos = { x: at.x, z: at.z };
  let reaction = null;
  // Natural 20s and 1s get the die thrown on screen.
  if ((r.d20 === 20 || r.d20 === 1) && !unseen(attacker)) {
    sfx.dice();
    await d20Fx(stage.scene, attacker, r.d20);
  }
  const onImpact = () => {
    if (attack.projectile === 'fire') fireBurstFx(stage.scene, pos);
    if (r.shielded) {
      sfx.shield();
      shieldFx(stage.scene, pos);
      floatText(stage.scene, pos, 'Shield!', 'spell');
      tv.updateStatus();
      hud.renderActionBar(game, { selected, busy });
    } else if (r.hit) {
      sfx.hit(target.code, { crit: r.crit, fire: attack.projectile === 'fire' });
      hitFx(stage.scene, { ...pos, undead: target.undead }, attacker, { crit: r.crit });
      if (r.crit) stage.shake(0.3, 420);
      if (r.uncanny) floatText(stage.scene, { x: pos.x, z: pos.z - 0.6 }, 'Uncanny Dodge ½', 'spell');
      floatText(stage.scene, pos, r.crit ? `CRIT −${r.damage}` : `−${r.damage}`, r.crit ? 'crit' : 'dmg');
      tv.updateHp();
      reaction = damageReaction(target);
    } else {
      sfx.miss();
      floatText(stage.scene, pos, 'Miss', 'miss');
    }
  };
  if (attack.projectile) {
    await av.shoot(pos, attack.projectile, () => shootProjectile(stage.scene, attacker, pos, attack.projectile), onImpact);
  } else {
    await av.swing(pos, onImpact);
  }
  await reaction;
  hud.renderInitiative(game);
}

function damageReaction(unit) {
  const v = view(unit);
  v.updateHp();
  if (unit.alive) return v.flinch();
  sfx.death(unit.code);
  return v.die();
}

async function animateSteps(unit, steps) {
  for (const step of steps) {
    if (!view(unit)) return; // the game was replaced mid-animation
    switch (step.type) {
      case 'walk': {
        // Out of sight, a monster just arrives where it comes into view (or its end tile).
        let path = step.path;
        if (unit.team === 'monsters') {
          const first = path.findIndex((t) => inView(t));
          const from = first < 0 ? path.length - 1 : Math.max(0, first - 1);
          if (from > 0) {
            view(unit).group.position.set(path[from].x, 0, path[from].z);
            view(unit).faceTowards(path[from].x * 2 - path[from - 1].x, path[from].z * 2 - path[from - 1].z);
            path = path.slice(from);
          }
        }
        await view(unit).moveAlong(path);
        break;
      }
      case 'door':
        await view(unit).turnTowards(step.x, step.z);
        sfx.door();
        await board.openDoor(step.x, step.z);
        break;
      case 'opportunity': {
        const r = step.result;
        sfx.alert();
        alertFx(stage.scene, step.at);
        floatText(stage.scene, r.attacker, 'Opportunity!', 'warn');
        await wait(250);
        await animateAttack(r, step.at);
        break;
      }
      case 'trap': {
        const r = step.result;
        sfx.trap();
        if (unseen(unit)) {
          view(unit).updateHp();
          if (!unit.alive) view(unit).die();
          break;
        }
        await board.showTrap(r.trap);
        floatText(stage.scene, r.unit, r.success ? `Save −${r.damage}` : `Trap −${r.damage}`, 'crit');
        hitFx(stage.scene, r.unit);
        await damageReaction(r.unit);
        board.retractTrap(r.trap);
        hud.renderInitiative(game);
        break;
      }
      default:
        throw new Error(`animateSteps: unknown step "${step.type}"`);
    }
  }
}

async function moveUnit(unit, x, z) {
  const r = game.move(unit, x, z);
  if (!r) return null;
  await animateSteps(unit, r.steps);
  flushReveals();
  syncStatus();
  return r;
}

async function openChest(unit, x, z) {
  const r = game.openChest(unit, x, z);
  if (!r.ok) {
    hud.toast(r.reason);
    return r;
  }
  await view(unit).turnTowards(x, z);
  sfx.chest();
  await board.openChest(x, z);
  const n = r.loot.filter((l) => l === 'potion').length;
  const items = r.loot.filter((l) => l !== 'potion').map((l) => ITEMS[l].name);
  const text = [...(n ? [`+${n} potion${n > 1 ? 's' : ''}`] : []), ...items].join(' · ');
  if (items.length) sfx.discover();
  floatText(stage.scene, { x, z }, text || 'Empty', 'heal');
  await wait(300);
  return r;
}

async function attackUnit(attacker, target, attack) {
  const r = game.attack(attacker, target, attack);
  if (!r.ok) {
    hud.toast(r.reason);
    return r;
  }
  await animateAttack(r);
  return r;
}

async function doAction(unit, id) {
  const r = game.doAction(unit, id);
  if (!r.ok) {
    hud.toast(r.reason);
    return r;
  }
  const v = view(unit);
  switch (id) {
    case 'secondWind':
    case 'potion':
      if (id === 'potion') sfx.potion();
      else sfx.heal();
      floatText(stage.scene, unit, `+${r.healed}`, 'heal');
      v.updateHp();
      await healFx(stage.scene, unit);
      break;
    case 'turnUndead':
      sfx.turnUndead();
      await v.cast(null, () => turnFx(stage.scene, unit, ACTIONS.turnUndead.range));
      for (const s of r.saves) {
        floatText(stage.scene, s.unit, s.success ? 'Resists' : s.destroyed ? 'Destroyed!' : 'Turned!', s.success ? 'miss' : s.destroyed ? 'crit' : 'spell');
        view(s.unit).updateStatus();
      }
      await Promise.all(r.saves.filter((s) => s.destroyed).map((s) => damageReaction(s.unit)));
      await wait(500);
      break;
    case 'aggressive':
      sfx.roar();
      if (!unseen(unit)) floatText(stage.scene, unit, 'Charge!', 'warn');
      await wait(500);
      break;
    default: // dash, dodge, disengage and their bonus-action versions
      sfx.maneuver();
      if (!unseen(unit)) floatText(stage.scene, unit, r.name, 'spell');
      v.updateStatus();
      await wait(450);
  }
  hud.renderInitiative(game);
  return r;
}

async function castSpell(caster, id, target) {
  const r = game.castSpell(caster, id, target);
  if (!r.ok) {
    hud.toast(r.reason);
    return r;
  }
  const cv = view(caster);
  if (unseen(caster) && id === 'animateDead') {
    // Raised out of sight: no show, the risen one is simply there when you find it.
    sfx.raise();
    view(r.corpse).vanish();
    addView(r.risen);
    await wait(300);
    hud.renderInitiative(game);
    return r;
  }
  switch (id) {
    case 'magicMissile':
      await cv.cast(r.target, async () => {
        sfx.cast();
        await Promise.all(r.darts.map(async (dmg, i) => {
          await wait(i * 120);
          sfx.missile(i);
          await missileFx(stage.scene, caster, r.target, i, r.darts.length);
          sfx.missileHit();
          floatText(stage.scene, r.target, `−${dmg}`, 'dmg');
          hitFx(stage.scene, r.target, caster);
        }));
      });
      await damageReaction(r.target);
      break;
    case 'burningHands': {
      const aim = { x: caster.x + r.dir.x, z: caster.z + r.dir.z };
      await cv.cast(aim, async () => {
        sfx.fireCone();
        await coneFx(stage.scene, caster, r.tiles);
      });
      await Promise.all(r.saves.map((s) => {
        floatText(stage.scene, s.unit, s.success ? `Save −${s.damage}` : `−${s.damage}`, 'crit');
        if (s.damage) hitFx(stage.scene, s.unit);
        return damageReaction(s.unit);
      }));
      break;
    }
    case 'fireball':
      await cv.cast(r.center, async () => {
        sfx.fireballLaunch();
        await fireballFx(stage.scene, caster, r.center, r.tiles, () => {
          sfx.explosion();
          stage.shake(0.45, 650);
        });
      });
      await Promise.all(r.saves.map((s) => {
        floatText(stage.scene, s.unit, s.success ? `Save −${s.damage}` : `−${s.damage}`, 'crit');
        if (s.damage) hitFx(stage.scene, s.unit);
        return damageReaction(s.unit);
      }));
      break;
    case 'massHealingWord':
      await cv.cast(null, async () => {
        sfx.heal();
        await Promise.all(r.heals.map(async (h) => {
          floatText(stage.scene, h.unit, `+${h.healed}`, 'heal');
          view(h.unit).updateHp();
          await healFx(stage.scene, h.unit);
        }));
      });
      break;
    case 'mistyStep':
      sfx.teleport();
      await cv.cast(null, async () => {
        mistFx(stage.scene, r.from);
        await cv.teleport(r.to.x, r.to.z);
        mistFx(stage.scene, r.to);
      });
      break;
    case 'sacredFlame':
      await cv.cast(r.target, async () => {
        sfx.radiant();
        await radiantFx(stage.scene, r.target);
      });
      if (r.damage) {
        sfx.hit(r.target.code);
        floatText(stage.scene, r.target, `−${r.damage}`, 'dmg');
        hitFx(stage.scene, r.target);
        await damageReaction(r.target);
      } else {
        floatText(stage.scene, r.target, 'Save', 'miss');
      }
      break;
    case 'cureWounds':
    case 'healingWord':
      await cv.cast(r.target === caster ? null : r.target, async () => {
        sfx.heal();
        floatText(stage.scene, r.target, `+${r.healed}`, 'heal');
        view(r.target).updateHp();
        await healFx(stage.scene, r.target);
      });
      break;
    case 'animateDead':
      await cv.cast(r.corpse, async () => {
        sfx.raise();
        const fx = raiseFx(stage.scene, r.corpse);
        await wait(450);
        view(r.corpse).vanish();
        await addView(r.risen).rise();
        await fx;
      });
      break;
    default:
      throw new Error(`castSpell: no animation for "${id}"`);
  }
  hud.renderInitiative(game);
  return r;
}

/** Shows the end banner once the game is decided. Returns true if over. */
async function checkGameOver() {
  if (!game.over) return false;
  if (ended) return true;
  ended = true;
  await wait(400);
  board.clearHighlights();
  hud.renderActionBar(game, { selected: null, busy: false });
  const level = levelById(NODES[nodeId].level);
  const final = !!level.final;
  if (game.over === 'victory') {
    sfx.victory();
    if (!final) {
      board.lightStairs();
      setTimeout(() => sfx.stairs(), 900);
    } else {
      // The campaign is won: record it, and the next visit starts fresh.
      campaign = completeFight(campaign, nodeId, game).state;
      clearSave();
    }
  } else {
    sfx.defeat();
  }
  hud.banner(game.over, { round: game.round, level: level.name, final, xp: game.xpEarned() });
  return true;
}

// --- turns ------------------------------------------------------------------
async function runMonsterTurn(unit) {
  const g = game; // a restart or level change mid-turn abandons this turn
  busy = true;
  refresh();
  // Monsters out of sight act quickly: nothing to watch.
  const pace = (ms) => wait(unit.team === 'monsters' && (unseen(unit) || unit.unaware) ? ms / 4 : ms);
  await pace(450);

  const memo = {};
  for (let guard = 0; guard < 12 && game === g && !g.over && unit.alive; guard++) {
    const step = nextMonsterStep(game, unit, memo);
    if (step.type === 'end') break;
    switch (step.type) {
      case 'attack':
        await attackUnit(unit, step.target, step.attack);
        break;
      case 'move':
        await moveUnit(unit, step.x, step.z);
        break;
      case 'spell':
        await castSpell(unit, step.id, step.target);
        break;
      case 'bonus':
      case 'action':
        await doAction(unit, step.id);
        break;
      default:
        throw new Error(`runMonsterTurn: unknown step "${step.type}"`);
    }
    if (game !== g) return;
    syncStatus();
    hud.renderActionBar(game, { selected, busy });
    await pace(180);
  }

  if (game !== g || await checkGameOver()) return;
  await pace(300);
  if (game !== g) return;
  busy = false;
  game.endTurn();
}

function endHeroTurn() {
  if (!isHeroTurn() || busy) return;
  game.endTurn();
}

/** Run a hero's action with input locked, then tidy up. */
async function heroDoes(fn) {
  const u = game.current;
  busy = true;
  selected = null;
  refresh();
  await fn();
  syncStatus();
  if (await checkGameOver()) return;
  busy = false;
  if (!u.alive) {
    // Cut down by an opportunity attack mid-move.
    await wait(500);
    game.endTurn();
    return;
  }
  refresh();
}

function choose(choice) {
  if (!isHeroTurn() || busy) return;
  sfx.ui();
  const u = game.current;
  if (choice.kind === 'action') {
    heroDoes(() => doAction(u, choice.id));
    return;
  }
  if (choice.kind === 'spell' && SPELLS[choice.id].targeting === 'self') {
    heroDoes(() => castSpell(u, choice.id));
    return;
  }
  const same = selected?.kind === choice.kind
    && (choice.kind === 'attack' ? selected.attack === choice.attack : selected.id === choice.id);
  selected = same ? null : choice;
  refresh();
}

// --- input ----------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function tileFromEvent(ev) {
  const r = stage.dom.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, stage.camera);

  // Clicking a figure's body (or a chest) selects its tile, even though it overlaps
  // tiles behind it. The nearest object under the mouse wins.
  // Hidden things (monsters out of sight, chests in unexplored rooms) can't be picked.
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

stage.dom.addEventListener('pointermove', (ev) => {
  const t = tileFromEvent(ev);
  if (t?.x === hovered?.x && t?.z === hovered?.z) return;
  hovered = t;
  if (isHeroTurn() && !busy) refresh();
});

stage.dom.addEventListener('pointerleave', () => {
  hovered = null;
  if (isHeroTurn() && !busy) refresh();
});

stage.dom.addEventListener('click', (ev) => {
  if (!isHeroTurn() || busy) return;
  const t = tileFromEvent(ev);
  if (!t) return;
  const u = game.current;
  const other = visibleUnitAt(t.x, t.z);

  if (selected?.kind === 'spell') {
    const id = selected.id;
    const s = SPELLS[id];
    const target = UNIT_TARGETING.includes(s.targeting) ? spellTargetAt(t, s) : t;
    if (!target) {
      hud.toast(`Click ${s.targeting === 'ally' ? 'an ally' : 'a target'}`);
      return;
    }
    const why = game.spellProblem(u, id, target);
    if (why) {
      hud.toast(why);
      return;
    }
    heroDoes(() => castSpell(u, id, target));
    return;
  }

  if (other && other.team !== u.team) {
    const atk = selected?.attack ?? game.bestAttack(u, other);
    const why = game.attackProblem(u, other, atk ?? u.attacks[0]);
    if (!atk || why) {
      hud.toast(why ?? 'Cannot attack');
      return;
    }
    heroDoes(() => attackUnit(u, other, atk));
    return;
  }

  if (game.grid.chests.has(key(t.x, t.z))) {
    const why = game.chestProblem(u, t.x, t.z);
    if (why) {
      hud.toast(why);
      return;
    }
    heroDoes(() => openChest(u, t.x, t.z));
    return;
  }

  if (other === u) return;
  const node = game.reachable(u).get(key(t.x, t.z));
  if (!node || !game.canEndOn(u, t.x, t.z)) {
    if (gridDistance(u, t) > u.movesLeft) hud.toast('Too far, not enough movement left');
    return;
  }
  heroDoes(() => moveUnit(u, t.x, t.z));
});

window.addEventListener('keydown', (ev) => {
  if (ev.code === 'Space' || ev.code === 'Enter') {
    if (ev.target instanceof HTMLButtonElement) return;
    ev.preventDefault();
    endHeroTurn();
  }
  if (ev.code === 'KeyM') toggleSound();
  if (ev.code === 'Escape') {
    selected = null;
    if (isHeroTurn() && !busy) refresh();
  }
});

// ?level=3 jumps straight into a room with a fresh party (handy for testing).
// The .glb figures load first; any that fail fall back to the built-in miniatures.
showBackdrop();
Promise.all([preloadModels(), preloadDungeon()]).then(() => {
  // rebuild the backdrop from the tile kit now that it's here
  if (!game) {
    stage.scene.remove(board.group);
    board.dispose();
    showBackdrop();
  }
  const levelParam = Number(new URLSearchParams(location.search).get('level'));
  if (levelParam >= 1 && levelParam <= LEVELS.length) {
    saving = false;
    campaign = newCampaign();
    nodeId = LEVELS[levelParam - 1].id;
    newGame();
  } else {
    camp.showTitle(loadSave());
  }
});

// Handy for debugging in the console.
window.__debug = {
  game: () => game,
  views: () => views,
  stage,
  sfx,
  /** The controller's animated actions, for scripted play-testing. */
  act: { moveUnit, attackUnit, castSpell, doAction, openChest },
  autoplay(on = true) {
    debugAutoplay = on;
    if (on && isHeroTurn() && !busy) runMonsterTurn(game.current);
  },
  /** Jump into a room with a fresh party (no save), e.g. __debug.level(4). */
  level(n) {
    camp.hide();
    saving = false;
    campaign = newCampaign();
    nodeId = LEVELS[Math.min(LEVELS.length, Math.max(1, n)) - 1].id;
    newGame();
  },
  campaign: () => campaign,
  /** Win the current fight on the spot. */
  win() {
    for (const u of game.living('monsters')) {
      game.applyDamage(u, u.hp, null);
      damageReaction(u);
    }
    checkGameOver();
  },
  /** Lose the current fight on the spot. */
  lose() {
    for (const u of game.living('heroes')) {
      game.applyDamage(u, u.hp, null);
      damageReaction(u);
    }
    checkGameOver();
  },
  /** Zoom the camera onto a tile, e.g. __debug.focus(11, 2, 3). */
  focus(x, z, zoom = 2.5) {
    const shift = new THREE.Vector3(x, 0, z).sub(stage.controls.target);
    stage.controls.target.add(shift);
    stage.camera.position.add(shift);
    stage.camera.zoom = zoom;
    stage.camera.updateProjectionMatrix();
  },
  /** Screen position (CSS px) of a tile, useful for scripted play-testing. */
  tileToScreen(x, z) {
    const v = new THREE.Vector3(x, 0, z).project(stage.camera);
    const r = stage.dom.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  },
};
