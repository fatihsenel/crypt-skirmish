// Saving a fight mid-battle. A fight is its dice seed plus the list of commands the
// player gave; the monsters' turns follow from those. Replaying the commands on a fresh
// Game with the same seed rebuilds the fight exactly, without storing every unit field.
// Live play and replay both go through applyCommand and monsterTurn, so they make the
// same engine calls in the same order.

import { nextMonsterStep } from './ai.js';

/** A monster's turn ends after this many steps, whatever the AI still wants. */
const MONSTER_STEP_LIMIT = 12;

/** A random seed for a new fight. */
export const newSeed = () => (Math.random() * 2 ** 32) >>> 0;

/** A unit as saved: its index in game.units (unit ids differ from one page load to the next). */
export const unitRef = (game, unit) => game.units.indexOf(unit);

/** A spell's target as saved: a unit (or corpse) by index, a tile, or nothing. */
export function targetRef(game, target) {
  if (!target) return {};
  const i = game.units.indexOf(target);
  return i >= 0 ? { unit: i } : { x: target.x, z: target.z };
}

function spellTarget(game, cmd) {
  if (cmd.unit !== undefined) return game.units[cmd.unit];
  if (cmd.x !== undefined) return { x: cmd.x, z: cmd.z };
  return undefined;
}

const fail = (reason) => ({ ok: false, reason });

/**
 * Carry out one of the player's commands for the unit whose turn it is.
 * Commands: move {x, z}, attack {target, attack}, shove {target}, grapple {target}, help {target},
 * feed {target} (give a potion), chest {x, z}, brazier {x, z}, lever {x, z},
 * action {id, attack?, spell?} (attack or spell: Ready's pick),
 * spell {id, unit | x, z}, smite, rebuke, end. Returns the engine's result.
 */
export function applyCommand(game, cmd) {
  const u = game.current;
  if (!u || game.over) return fail('The battle is over');
  const unit = (i) => (Number.isInteger(i) ? game.units[i] : undefined);
  switch (cmd.type) {
    case 'move': {
      const r = game.move(u, cmd.x, cmd.z);
      return r ? { ok: true, ...r } : fail('Can’t move there');
    }
    case 'attack': {
      const target = unit(cmd.target);
      const attack = u.attacks[cmd.attack];
      if (!target || !attack) return fail('No such target');
      return game.attack(u, target, attack);
    }
    case 'shove': {
      const target = unit(cmd.target);
      return target ? game.shove(u, target) : fail('No such target');
    }
    case 'help': {
      const target = unit(cmd.target);
      return target ? game.help(u, target) : fail('No such target');
    }
    case 'chest':
      return game.openChest(u, cmd.x, cmd.z);
    case 'brazier':
      return game.tipBrazier(u, cmd.x, cmd.z);
    case 'lever':
      return game.pullLever(u, cmd.x, cmd.z);
    case 'action':
      return game.doAction(u, cmd.id, { attack: cmd.attack, spell: cmd.spell });
    case 'feed': {
      const target = unit(cmd.target);
      return target ? game.feedPotion(u, target) : fail('No such target');
    }
    case 'grapple': {
      const target = unit(cmd.target);
      return target ? game.grapple(u, target) : fail('No such target');
    }
    case 'spell':
      return game.castSpell(u, cmd.id, spellTarget(game, cmd));
    case 'smite':
      return game.toggleSmite(u);
    case 'rebuke':
      return game.toggleRebuke(u);
    case 'end':
      game.endTurn();
      return { ok: true };
    default:
      return fail(`Unknown command "${cmd.type}"`);
  }
}

function applyStep(game, unit, step) {
  switch (step.type) {
    case 'attack':
      return game.attack(unit, step.target, step.attack);
    case 'move': {
      const r = game.move(unit, step.x, step.z);
      return r ? { ok: true, ...r } : fail('Can’t move there');
    }
    case 'spell':
      return game.castSpell(unit, step.id, step.target);
    case 'bonus':
    case 'action':
      return game.doAction(unit, step.id);
    default:
      throw new Error(`monsterTurn: unknown step "${step.type}"`);
  }
}

/**
 * A monster's turn, one step at a time: yields { step, result } after each step is
 * resolved, so the caller can play it back. Does not end the turn.
 */
export function* monsterTurn(game, unit) {
  const memo = {};
  for (let guard = 0; guard < MONSTER_STEP_LIMIT && !game.over && unit.alive; guard++) {
    const step = nextMonsterStep(game, unit, memo);
    if (step.type === 'end') return;
    yield { step, result: applyStep(game, unit, step) };
  }
}

/** A hero cut down during their own action loses the rest of the turn. */
export function heroFell(game, unit) {
  if (game.over || unit.alive || game.current !== unit) return false;
  game.endTurn();
  return true;
}

/**
 * Start `game` (a fresh Game built with the saved seed and party) and replay `log` on it.
 * Stops at the first hero turn with no command left, or when the fight is decided.
 * Returns { ok, check } (check: fightCheck right after the last command, as saved),
 * or { ok: false, at } with the index of the command that failed.
 */
export function replayFight(game, log) {
  game.start();
  let i = 0;
  let check = null;
  while (!game.over) {
    const u = game.current;
    if (u.team !== 'heroes') {
      for (const s of monsterTurn(game, u)) void s;
      game.endTurn();
      continue;
    }
    if (i >= log.length) break;
    const cmd = log[i++];
    const r = applyCommand(game, cmd);
    if (!r?.ok) return { ok: false, at: i - 1 };
    check = fightCheck(game);
    if (cmd.type !== 'end') heroFell(game, u);
  }
  return i === log.length ? { ok: true, check } : { ok: false, at: i };
}

/** A short fingerprint of the fight, to tell whether a replay landed where the save was. */
export function fightCheck(game) {
  const text = `${game.round}.${game.turn}|` + game.units
    .map((u) => `${u.hp}${u.alive ? '' : 'x'}${u.x},${u.z}`)
    .join(';');
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
