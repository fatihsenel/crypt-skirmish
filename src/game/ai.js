// Monster brains. Personalities (set by `ai` in units.js):
//  brute       walks up and hits the weakest hero in reach; Dashes (or uses Aggressive)
//              when nothing is in reach.
//  skirmisher  prefers shooting from range, won't shoot at disadvantage if it can
//              step away first, uses Nimble Escape to slip out of melee, and
//              backs off after attacking ("shoot and scoot").
//  caster      a skirmisher that first raises any corpse it can reach (Animate Dead).
// Anything that knows Dread frightens the toughest melee hero it can see (a brute only
// when it can't reach melee this turn).
// Any monster that is Turned (Turn Undead) just flees.
// Monsters lose track of hidden heroes: they only target heroes they know about. With
// nobody in view, an alert monster hunts: it walks (Dashing if it must) to the nearest
// spot where a hidden hero was last seen and takes the Search action there.
//
// nextMonsterStep() returns one decision at a time so the controller can animate
// each step and re-plan from the new state.

import { key, pathFrom, gridDistance } from './grid.js';
import { PATROL_PACE } from './combat.js';

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
  for (const target of game.knownFoes(unit)) {
    for (const attack of unit.attacks) {
      if (game.attackProblem(self, target, attack)) continue;
      const mods = game.attackMods(self, target, attack);
      let score = 40 - target.hp + pref(attack);
      if (target.hp <= 4) score += 8; // likely kill
      if (mods.mode === 'adv') score += 4;
      if (mods.mode === 'dis') score -= 25;
      score -= game.coverBonus(self, target) * 5; // a barrel in the way
      if (!best || score > best.score) best = { target, attack, mods, score };
    }
  }
  return best;
}

/**
 * Tile to move to this turn, or null to stay put.
 * goal: 'attack' (find a tile to attack from), 'approach' (just get closer,
 * e.g. after Dashing), 'retreat' (back off after attacking), 'flee' (get as far
 * away as possible, when Turned) or 'search' (head for the tile `toward`).
 */
export function chooseMove(game, unit, goal = game.canAttack(unit) ? 'attack' : 'retreat', toward = null) {
  const foes = game.knownFoes(unit);
  if (unit.movesLeft <= 0) return null;
  if (goal === 'search' ? !toward : !foes.length) return null;
  const field = game.grid.distanceField(goal === 'search' ? [toward] : foes);
  const map = game.reachable(unit);
  const skirmisher = keepsDistance(unit);
  // Goblins that can still hide this turn like a spot every watching hero can't see into.
  const hideable = unit.features?.includes('nimbleHide') && !unit.bonusUsed && !unit.hidden;
  const heroes = hideable ? game.living('heroes') : [];
  const canHideAt = (node) => heroes.every((h) => !game.inSight(h, node) || game.coverBonus(h, node) > 0);

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
    } else if (goal === 'approach' || goal === 'search') {
      score += dist;
    } else if (goal === 'flee') {
      score -= Math.min(dist, 30) * 10;
    } else {
      // Skirmisher after attacking: get some distance, ideally 3+ tiles.
      score += Math.max(0, 4 - dist) * 20;
    }
    // Skirmishers like to end up with a barrel or crate between them and the heroes.
    if (skirmisher && foes.some((f) => game.coverBonus(f, node))) score -= 12;
    if (hideable && (goal === 'attack' || goal === 'retreat') && !nearFoe && canHideAt(node)) score -= 10;
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
 * A hero worth frightening with Dread right now, or null. Casters use it whenever they can;
 * a brute only when it can't get into melee this turn anyway. The biggest bruiser goes first.
 */
function dreadTarget(game, unit) {
  if (!unit.spells.includes('dread') || game.spellProblem(unit, 'dread')) return null;
  if (!keepsDistance(unit) && (game.isAdjacentToEnemy(unit) || meleeReachable(game, unit))) return null;
  const melee = (h) => (h.attacks[0].reach === 1 ? 100 : 0);
  return game.spellTargets(unit, 'dread').filter((h) => !h.hidden).sort((a, b) => melee(b) + b.maxHp - (melee(a) + a.maxHp))[0] ?? null;
}

/**
 * Where a patrolling monster walks this turn: up to PATROL_PACE tiles toward its next
 * waypoint (moving on to the following one when it gets there). Doesn't open doors.
 */
export function patrolStep(game, unit) {
  const { patrol } = unit;
  for (let tries = 0; tries < patrol.route.length; tries++) {
    const wp = patrol.route[patrol.next];
    if (wp.x === unit.x && wp.z === unit.z) {
      patrol.next = (patrol.next + 1) % patrol.route.length;
      continue;
    }
    const toWp = game.grid.distanceField([wp]);
    const here = toWp.get(key(unit.x, unit.z)) ?? Infinity;
    let best = null;
    const map = game.reachable(unit);
    for (const n of map.values()) {
      if (n.dist === 0 || n.dist > PATROL_PACE || !game.canEndOn(unit, n.x, n.z)) continue;
      const path = pathFrom(map, n.x, n.z);
      if (path.some((p) => game.grid.closedDoorAt(p.x, p.z))) continue;
      const d = toWp.get(key(n.x, n.z)) ?? Infinity;
      if (d < here && (!best || d < best.d || (d === best.d && n.dist < best.n.dist))) best = { n, d };
    }
    if (!best) return null; // blocked (someone in the way): wait a turn
    if (best.d === 0) patrol.next = (patrol.next + 1) % patrol.route.length;
    return { x: best.n.x, z: best.n.z };
  }
  return null;
}

/**
 * The nearest (by walking) spot to look for a hidden enemy, or null. Monsters go where they
 * last saw a hero; heroes saw the goblin duck behind its barrel, so they go there.
 */
function searchSpot(game, unit) {
  const hiddenFoes = game.enemiesOf(unit).filter((e) => e.hidden);
  const spots = unit.team === 'monsters'
    ? hiddenFoes.filter((h) => h.lastSeen).map((h) => h.lastSeen)
    : hiddenFoes.map((m) => ({ x: m.x, z: m.z }));
  if (!spots.length) return null;
  const field = game.grid.distanceField([unit]);
  let best = null;
  for (const s of spots) {
    const d = field.get(key(s.x, s.z)) ?? gridDistance(unit, s) + 50;
    if (!best || d < best.d) best = { s, d };
  }
  return best.s;
}

/**
 * No hero in view: walk to where a hidden one was last seen and Search there.
 * Arriving clears that lead, so the next monster doesn't search the same empty corner.
 */
function huntStep(game, unit, memo) {
  const spot = searchSpot(game, unit);
  const arrived = spot && gridDistance(unit, spot) <= 1;
  if (arrived && unit.team === 'monsters') {
    for (const h of game.living('heroes')) {
      if (h.lastSeen && h.lastSeen.x === spot.x && h.lastSeen.z === spot.z) h.lastSeen = null;
    }
  }
  if (spot && !arrived && !memo.moved) {
    memo.moved = true;
    const dest = chooseMove(game, unit, 'search', spot);
    if (dest) return { type: 'move', ...dest };
  }
  if (!unit.actionUsed) {
    // Still far off: Dash to close in, otherwise look around.
    if (spot && !arrived && !memo.dashed && !game.actionProblem(unit, 'dash')) {
      memo.dashed = true;
      memo.moved = false;
      return { type: 'action', id: 'dash' };
    }
    const hidden = game.enemiesOf(unit).some((h) => h.hidden);
    if (hidden && !game.actionProblem(unit, 'search')) return { type: 'action', id: 'search' };
  }
  return endStep(game, unit);
}

/**
 * The turn is over: a goblin with its bonus action left ducks out of sight (Nimble Escape)
 * if it has a wall or a barrel between it and every hero who can see it.
 */
function endStep(game, unit) {
  if (unit.features?.includes('nimbleHide') && !unit.hidden && !game.actionProblem(unit, 'nimbleHide')) {
    return { type: 'bonus', id: 'nimbleHide' };
  }
  return { type: 'end' };
}

/**
 * Next thing the monster should do. `memo` persists across calls within one turn
 * (start with {}). Returns one of
 *   { type: 'bonus', id }   { type: 'action', id }   { type: 'spell', id, target }
 *   { type: 'attack', target, attack }   { type: 'move', x, z }   { type: 'end' }
 */
export function nextMonsterStep(game, unit, memo) {
  if (game.over || !unit.alive) return { type: 'end' };
  if (unit.unaware) {
    // Hasn't noticed the party yet: stands guard, sleeps, or walks its beat.
    if (unit.patrol && !memo.moved) {
      memo.moved = true;
      const dest = patrolStep(game, unit);
      if (dest) return { type: 'move', ...dest };
    }
    return { type: 'end' };
  }
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

  const scared = !unit.actionUsed && dreadTarget(game, unit);
  if (scared) return { type: 'spell', id: 'dread', target: scared };

  if (!game.knownFoes(unit).length) return huntStep(game, unit, memo);

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
  return endStep(game, unit);
}
