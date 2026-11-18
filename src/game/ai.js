// Monster brains. Personalities (set by `ai` in units.js):
//  brute       walks up and hits the weakest hero in reach; Dashes (or uses Aggressive)
//              when nothing is in reach.
//  skirmisher  prefers shooting from range, won't shoot at disadvantage if it can
//              step away first, uses Nimble Escape to slip out of melee, and
//              backs off after attacking ("shoot and scoot").
//  caster      a skirmisher that first raises any corpse it can reach (Animate Dead).
// Any monster that is Turned (Turn Undead) just flees.
//
// nextMonsterStep() returns one decision at a time so the controller can animate
// each step and re-plan from the new state.

import { key, pathFrom, gridDistance } from './grid.js';

const keepsDistance = (unit) => unit.ai === 'skirmisher' || unit.ai === 'caster';

const attackPrefs = {
  brute: (attack) => (attack.reach === 1 ? 6 : 0),
  ranged: (attack) => (attack.reach > 1 ? 6 : 0),
};

/**
 * Best attack available if `unit` stood at `at` (defaults to where it is).
 * Returns { target, attack, mods, score } or null.
 */
export function chooseAttack(game, unit, at = unit) {
  const self = { ...unit, x: at.x, z: at.z };
  const pref = keepsDistance(unit) ? attackPrefs.ranged : attackPrefs.brute;
  let best = null;
  for (const target of game.enemiesOf(unit)) {
    for (const attack of unit.attacks) {
      if (game.attackProblem(self, target, attack)) continue;
      const mods = game.attackMods(self, target, attack);
      let score = 40 - target.hp + pref(attack);
      if (target.hp <= 4) score += 8; // likely kill
      if (mods.mode === 'adv') score += 4;
      if (mods.mode === 'dis') score -= 25;
      if (!best || score > best.score) best = { target, attack, mods, score };
    }
  }
  return best;
}

/**
 * Tile to move to this turn, or null to stay put.
 * goal: 'attack' (find a tile to attack from), 'approach' (just get closer,
 * e.g. after Dashing), 'retreat' (back off after attacking) or 'flee' (get as far
 * away as possible, when Turned).
 */
export function chooseMove(game, unit, goal = game.canAttack(unit) ? 'attack' : 'retreat') {
  const foes = game.enemiesOf(unit);
  if (!foes.length || unit.movesLeft <= 0) return null;
  const field = game.grid.distanceField(foes);
  const map = game.reachable(unit);
  const skirmisher = keepsDistance(unit);

  // A brute that already struck stays put; walking away only invites a blade.
  if (goal === 'retreat' && !skirmisher) return null;

  let best = null;
  let bestScore = Infinity;
  for (const node of map.values()) {
    if (!game.canEndOn(unit, node.x, node.z)) continue;
    const path = pathFrom(map, node.x, node.z);
    const provoked = game.provokers(unit, path).length;
    const dist = field.get(key(node.x, node.z)) ?? 99;
    const nearFoe = foes.some((f) => gridDistance(f, node) <= 1);

    let score = provoked * 400 + node.dist * 0.01;
    if (goal === 'attack') {
      const option = chooseAttack(game, unit, node);
      if (option) {
        score -= 1000 + option.score;
        if (skirmisher) score -= Math.min(dist, 5) * 2; // shoot from a safer distance
      } else {
        score += dist; // close the distance
      }
      if (skirmisher && nearFoe) score += 30;
    } else if (goal === 'approach') {
      score += dist;
    } else if (goal === 'flee') {
      score -= Math.min(dist, 30) * 10;
    } else {
      // Skirmisher after attacking: get some distance, ideally 3+ tiles.
      score += Math.max(0, 4 - dist) * 20;
    }
    if (score < bestScore) {
      bestScore = score;
      best = node;
    }
  }
  if (!best || best.dist === 0) return null;
  return { x: best.x, z: best.z };
}

/** Could reach a tile this turn (with current movement) to make a melee attack. */
function meleeReachable(game, unit) {
  const dest = chooseMove(game, unit, 'attack');
  const at = dest ?? unit;
  return chooseAttack(game, unit, at)?.attack.reach === 1;
}

/** A corpse the unit could raise right now, or null. */
function corpseToRaise(game, unit) {
  if (!unit.spells.includes('animateDead') || game.spellProblem(unit, 'animateDead')) return null;
  return game.spellTargets(unit, 'animateDead')[0] ?? null;
}

/**
 * Next thing the monster should do. `memo` persists across calls within one turn
 * (start with {}). Returns one of
 *   { type: 'bonus', id }   { type: 'action', id }   { type: 'spell', id, target }
 *   { type: 'attack', target, attack }   { type: 'move', x, z }   { type: 'end' }
 */
export function nextMonsterStep(game, unit, memo) {
  if (game.over || !unit.alive) return { type: 'end' };
  if (unit.unaware) return { type: 'end' }; // hasn't noticed the party yet
  const adjacent = game.isAdjacentToEnemy(unit);

  if (unit.turned) {
    if (!memo.moved) {
      memo.moved = true;
      const dest = chooseMove(game, unit, 'flee');
      if (dest) return { type: 'move', ...dest };
    }
    if (!memo.dashed && !game.actionProblem(unit, 'dash')) {
      memo.dashed = true;
      memo.moved = false;
      return { type: 'action', id: 'dash' };
    }
    return { type: 'end' };
  }

  const corpse = corpseToRaise(game, unit);
  if (corpse) return { type: 'spell', id: 'animateDead', target: corpse };

  const plan = game.canAttack(unit) ? chooseAttack(game, unit) : null;

  // Goblins slip out of melee before anything else.
  if (keepsDistance(unit) && adjacent && !memo.moved
      && !game.actionProblem(unit, 'nimbleEscape')) {
    return { type: 'bonus', id: 'nimbleEscape' };
  }

  // Orcs charge: a bonus-action dash when melee is out of reach.
  if (!memo.moved && !adjacent && game.canAttack(unit) && !game.actionProblem(unit, 'aggressive')
      && !meleeReachable(game, unit)) {
    return { type: 'bonus', id: 'aggressive' };
  }

  // Attack now, unless the monster could first step somewhere better.
  let repositionFirst = false;
  if (plan && !memo.moved) {
    if (keepsDistance(unit)) {
      repositionFirst = unit.disengaged || plan.mods.mode === 'dis';
    } else if (plan.attack.reach > 1) {
      // Brutes would rather walk up and swing than shoot.
      repositionFirst = meleeReachable(game, unit);
    }
  }
  if (plan && !repositionFirst) {
    return { type: 'attack', target: plan.target, attack: plan.attack };
  }

  if (!memo.moved) {
    memo.moved = true;
    const goal = game.canAttack(unit) ? 'attack' : memo.dashed ? 'approach' : 'retreat';
    const dest = chooseMove(game, unit, goal);
    if (dest) return { type: 'move', ...dest };
    return nextMonsterStep(game, unit, memo);
  }

  if (!unit.actionUsed) {
    // Nothing to hit even after moving: run, or brace if cornered.
    if (!memo.dashed && !adjacent) {
      memo.dashed = true;
      memo.moved = false;
      return { type: 'action', id: 'dash' };
    }
    if (adjacent) return { type: 'action', id: 'dodge' };
  }
  return { type: 'end' };
}
