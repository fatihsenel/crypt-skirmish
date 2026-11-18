// Rules engine: initiative, turns, movement, attacks, actions, spells and map
// features (doors, traps, chests). Knows nothing about three.js; the controller
// animates the results it returns.

import { rollDice, rollExpr, abilityMod } from './dice.js';
import { Grid, key, gridDistance, pathFrom } from './grid.js';
import { createUnit, applyLevel, TEMPLATES } from './units.js';
import { applyItems } from './items.js';
import { ACTIONS, STANDARD_ACTIONS, SPELLS, coneTiles, areaTiles, directionTo } from './abilities.js';

export const TRAP_DC = 13;
export const TRAP_DAMAGE = '2d6';

// Monster senses, in tiles (5 ft). In the dim crypt, monsters spot heroes within 40 ft
// (a Skulker only within 15 ft), hear fighting 40 ft away by walking distance (sound gets
// through doors), and an alarmed monster shouts to friends it can see within 20 ft.
export const SIGHT = 8;
export const SKULK_SIGHT = 3;
export const NOISE = 5;
/** Extra tiles a closed door adds to how far a sound has to travel. */
export const DOOR_MUFFLE = 2;
export const SHOUT = 4;

/** Hero fields carried from one level to the next. Level and items rebuild the rest. */
const CARRY = ['level', 'items', 'hp', 'alive', 'slots', 'potions'];

/** Weapon attacks (not spell attacks like Fire Bolt) benefit from +1 weapons. */
export const isWeapon = (attack) => attack.stat === 'str' || attack.stat === 'dex';

export class Game {
  /**
   * @param level  ASCII rows, or { rows, loot } where loot lists the contents of
   *               each '$' chest in reading order, e.g. [['potion'], ['potion', 'potion']]
   * @param party  hero state from the previous level, keyed by unit code
   */
  /** senses: false makes every monster aware from the start (the old behaviour). */
  constructor(level, { rng = Math.random, party = null, senses = true } = {}) {
    const rows = Array.isArray(level) ? level : level.rows;
    this.rng = rng;
    this.listeners = {};
    this.grid = new Grid(rows);
    [...this.grid.chests.values()].forEach((c, i) => { c.loot = [...(level.loot?.[i] ?? ['potion'])]; });

    const all = [...this.grid.spawns, ...this.grid.corpses];
    const totals = {};
    for (const s of all) totals[s.code] = (totals[s.code] || 0) + 1;
    const seen = {};
    const make = (s) => {
      seen[s.code] = (seen[s.code] || 0) + 1;
      return createUnit(s.code, s.x, s.z, seen[s.code], totals[s.code]);
    };
    this.units = this.grid.spawns.map(make);
    for (const c of this.grid.corpses) {
      const u = make(c);
      Object.assign(u, { alive: false, hp: 0, corpse: true, name: `Dead ${u.cls}` });
      this.units.push(u);
    }
    if (party) {
      for (const u of this.units) {
        const saved = party[u.code];
        if (u.team !== 'heroes' || !saved) continue;
        if (saved.level) applyLevel(u, saved.level);
        applyItems(u, saved.items);
        for (const f of ['hp', 'alive', 'slots', 'potions']) {
          if (saved[f] !== undefined) u[f] = structuredClone(saved[f]);
        }
        if (!u.alive) Object.assign(u, { alive: true, hp: 1 }); // carried out by the party
      }
    }

    // Monsters start out unaware of the party (see updateAwareness).
    if (senses) for (const u of this.units) if (u.team === 'monsters' && u.alive) u.unaware = true;

    this.order = [];
    this.turn = -1;
    this.round = 0;
    this.over = null; // 'victory' | 'defeat'
    this.found = [];  // non-potion loot taken from chests, for the party's pack
  }

  /** XP for every monster slain in this fight (risen dead included, old corpses not). */
  xpEarned() {
    return this.units
      .filter((u) => u.team === 'monsters' && !u.alive && !u.corpse)
      .reduce((sum, u) => sum + (TEMPLATES[u.code].xp ?? 0), 0);
  }

  /** Snapshot of the heroes to pass into the next level's Game. */
  partyState() {
    const out = {};
    for (const u of this.units) {
      if (u.team === 'heroes' && !u.corpse && !(u.code in out)) {
        out[u.code] = structuredClone(Object.fromEntries(CARRY.map((f) => [f, u[f]])));
      }
    }
    return out;
  }

  // --- events -------------------------------------------------------------
  on(type, fn) {
    (this.listeners[type] ??= []).push(fn);
    return this;
  }

  emit(type, data) {
    for (const fn of this.listeners[type] || []) fn(data);
  }

  // --- queries ------------------------------------------------------------
  get current() {
    return this.order[this.turn];
  }

  living(team) {
    return this.units.filter((u) => u.alive && (!team || u.team === team));
  }

  enemiesOf(unit) {
    return this.units.filter((u) => u.alive && u.team !== unit.team);
  }

  alliesOf(unit) {
    return this.units.filter((u) => u.alive && u.team === unit.team && u.id !== unit.id);
  }

  unitAt(x, z) {
    return this.units.find((u) => u.alive && u.x === x && u.z === z);
  }

  /** Dead bodies that can still be raised. */
  corpses() {
    return this.units.filter((u) => !u.alive && !u.raised);
  }

  toHitBonus(unit, attack) {
    return abilityMod(unit.stats[attack.stat]) + unit.prof + (isWeapon(attack) ? unit.weaponBonus ?? 0 : 0);
  }

  /** Flat damage bonus added to an attack's dice. */
  damageBonus(unit, attack) {
    if (attack.addMod === false) return 0;
    return abilityMod(unit.stats[attack.stat]) + (isWeapon(attack) ? unit.weaponBonus ?? 0 : 0);
  }

  acOf(unit) {
    return unit.ac + (unit.acBonus ?? 0) + (unit.shielded ? 5 : 0);
  }

  /** Roll a saving throw: d20 + ability modifier + item bonuses. */
  save(unit, stat, dc) {
    const d20 = rollDice(1, 20, this.rng).total;
    const total = d20 + abilityMod(unit.stats[stat]) + (unit.saveBonus ?? 0);
    return { unit, d20, total, success: total >= dc };
  }

  spellDC(unit) {
    return 8 + unit.prof + abilityMod(unit.stats[unit.castStat ?? 'int']);
  }

  isAdjacentToEnemy(unit) {
    return this.enemiesOf(unit).some((e) => gridDistance(e, unit) <= 1);
  }

  /** Can still attack this turn (Multiattack allows follow-up attacks). */
  canAttack(unit) {
    return !unit.actionUsed || unit.attacksLeft > 0;
  }

  // --- senses ---------------------------------------------------------------
  /** Can monster `m` spot hero `h` from where they stand? (sight works both ways) */
  notices(m, h) {
    const range = h.passives.includes('skulker') ? SKULK_SIGHT : SIGHT;
    return h.alive && gridDistance(m, h) <= range
      && (this.grid.lineOfSight(m.x, m.z, h.x, h.z) || this.grid.lineOfSight(h.x, h.z, m.x, m.z));
  }

  /** An unaware monster becomes aware; if it saw or was hurt, it shouts to friends in view. */
  alert(m, cause) {
    if (!m.unaware || !m.alive) return;
    m.unaware = false;
    this.emit('alert', { unit: m, cause });
    if (cause === 'noise') return;
    for (const o of this.living('monsters')) {
      if (o.unaware && gridDistance(o, m) <= SHOUT && this.grid.lineOfSight(o.x, o.z, m.x, m.z)) this.alert(o, 'ally');
    }
  }

  /** Every unaware monster looks around. */
  updateAwareness() {
    const heroes = this.living('heroes');
    for (const m of this.living('monsters')) {
      if (m.unaware && heroes.some((h) => this.notices(m, h))) this.alert(m, 'sight');
    }
  }

  /** A noise at `at` wakes unaware monsters within `range` tiles of walking distance. */
  noise(at, range = NOISE) {
    if (!this.living('monsters').some((m) => m.unaware)) return;
    const dist = this.soundField(at, range);
    for (const m of this.living('monsters')) {
      if (m.unaware && (dist.get(key(m.x, m.z)) ?? Infinity) <= range) this.alert(m, 'noise');
    }
  }

  /** How far sound travels to each tile: walking steps, plus DOOR_MUFFLE per closed door. */
  soundField(at, range) {
    const dist = new Map([[key(at.x, at.z), 0]]);
    const open = [[at.x, at.z, 0]];
    while (open.length) {
      open.sort((a, b) => a[2] - b[2]);
      const [x, z, d] = open.shift();
      if (d > (dist.get(key(x, z)) ?? Infinity)) continue;
      for (const [nx, nz] of this.grid.neighbors(x, z)) {
        const door = this.grid.doors.get(key(nx, nz));
        const nd = d + 1 + (door && !door.open ? DOOR_MUFFLE : 0);
        if (nd > range || nd >= (dist.get(key(nx, nz)) ?? Infinity)) continue;
        dist.set(key(nx, nz), nd);
        open.push([nx, nz, nd]);
      }
    }
    return dist;
  }

  // --- turn flow ----------------------------------------------------------
  start() {
    for (const u of this.living()) {
      u.initRoll = rollDice(1, 20, this.rng).total;
      u.initiative = u.initRoll + abilityMod(u.stats.dex);
    }
    this.order = this.living().sort(
      (a, b) => b.initiative - a.initiative || b.stats.dex - a.stats.dex,
    );
    this.emit('initiative', { order: this.order });
    this.round = 1;
    this.turn = 0;
    this.emit('round', { round: 1 });
    this.revealTraps();
    this.updateAwareness();
    this.beginTurn();
  }

  beginTurn() {
    const u = this.current;
    Object.assign(u, {
      movesLeft: u.speed,
      actionUsed: false,
      bonusUsed: false,
      reactionUsed: false,
      dodging: false,
      disengaged: false,
      shielded: false,
      attacksLeft: 0,
      sneakUsed: false,
      interacted: false,
    });
    this.updateAwareness();
    this.emit('turnStart', { unit: u });
  }

  endTurn() {
    if (this.over) return;
    const u = this.current;
    if (u.turned > 0) u.turned--;
    this.emit('turnEnd', { unit: u });
    do {
      this.turn++;
      if (this.turn >= this.order.length) {
        this.turn = 0;
        this.round++;
        this.emit('round', { round: this.round });
      }
    } while (!this.current.alive);
    this.beginTurn();
  }

  /** Add a unit mid-fight, acting right after `after` in the initiative order. */
  addUnit(unit, after) {
    this.units.push(unit);
    const i = this.order.indexOf(after);
    const at = i < 0 ? this.order.length : i + 1;
    this.order.splice(at, 0, unit);
    if (at <= this.turn) this.turn++;
    unit.initiative = after?.initiative ?? 0;
  }

  // --- damage & healing -----------------------------------------------------
  applyDamage(target, amount, source) {
    this.alert(target, 'hurt');
    target.hp = Math.max(0, target.hp - amount);
    if (amount > 0) target.turned = 0; // damage breaks Turn Undead
    if (target.hp <= 0 && target.alive) {
      target.alive = false;
      this.emit('death', { unit: target, source });
      this.checkEnd();
    }
  }

  heal(target, amount) {
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    return target.hp - before;
  }

  checkEnd() {
    if (this.over) return;
    if (!this.living('monsters').length) this.over = 'victory';
    else if (!this.living('heroes').length) this.over = 'defeat';
    if (this.over) this.emit('gameOver', { result: this.over });
  }

  // --- movement -----------------------------------------------------------
  // You may move through allies but not through enemies (5e). Heroes avoid traps they know about.
  passableFor(unit) {
    return (x, z) => {
      const o = this.unitAt(x, z);
      if (o && o.team !== unit.team) return false;
      if (unit.team === 'heroes') {
        const t = this.grid.traps.get(key(x, z));
        if (t && t.revealed && !t.sprung) return false;
      }
      return true;
    };
  }

  canEndOn(unit, x, z) {
    const o = this.unitAt(x, z);
    return !o || o === unit;
  }

  reachable(unit) {
    return this.grid.flood(unit.x, unit.z, unit.movesLeft, this.passableFor(unit));
  }

  /** Tiles the unit could end its move on (excludes its own tile). */
  destinations(unit) {
    return [...this.reachable(unit).values()].filter(
      (n) => n.dist > 0 && this.canEndOn(unit, n.x, n.z),
    );
  }

  /** The single rule for who gets an opportunity attack when `mover` steps from → to. */
  canOpportunityAttack(foe, mover, from, to) {
    return foe.alive && foe.team !== mover.team && !mover.disengaged && !foe.reactionUsed && !foe.unaware
      && !foe.turned && foe.attacks.some((a) => a.reach === 1)
      && gridDistance(foe, from) <= 1 && gridDistance(foe, to) > 1;
  }

  /** Enemies that would get an opportunity attack if `unit` walked `path`. */
  provokers(unit, path) {
    const out = new Set();
    for (let i = 0; i < path.length - 1; i++) {
      for (const foe of this.enemiesOf(unit)) {
        if (this.canOpportunityAttack(foe, unit, path[i], path[i + 1])) out.add(foe);
      }
    }
    return [...out];
  }

  /**
   * Move along the shortest path. Along the way: closed doors swing open, hidden
   * traps spring on heroes, and leaving an enemy's reach provokes opportunity attacks.
   * Returns { steps, path, interrupted? } where steps is a list of
   *   { type: 'walk', path }  { type: 'door', x, z }
   *   { type: 'opportunity', result, at }  { type: 'trap', result }
   * for the controller to animate in order; or null if the move is illegal.
   */
  move(unit, x, z) {
    if (this.over || unit !== this.current) return null;
    const map = this.reachable(unit);
    const node = map.get(key(x, z));
    if (!node || node.dist === 0 || !this.canEndOn(unit, x, z)) return null;
    const path = pathFrom(map, x, z);

    const steps = [];
    let walked = [path[0]];
    const flush = (from) => {
      if (walked.length > 1) steps.push({ type: 'walk', path: walked });
      walked = [from];
    };
    const stop = (i) => {
      flush(path[i]);
      unit.movesLeft -= i;
      this.emit('move', { unit, path: path.slice(0, i + 1) });
      return { steps, path: path.slice(0, i + 1), interrupted: true };
    };

    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      for (const foe of this.enemiesOf(unit)) {
        if (!this.canOpportunityAttack(foe, unit, from, to)) continue;
        flush(from);
        unit.x = from.x;
        unit.z = from.z;
        const atk = foe.attacks.find((a) => a.reach === 1);
        const result = this.attack(foe, unit, atk, { opportunity: true });
        steps.push({ type: 'opportunity', result, at: { x: from.x, z: from.z } });
        if (!unit.alive || this.over) return stop(i);
      }
      const door = this.grid.closedDoorAt(to.x, to.z);
      if (door) {
        flush(from);
        door.open = true;
        steps.push({ type: 'door', x: to.x, z: to.z });
        this.emit('door', { unit, x: to.x, z: to.z });
      }
      walked.push(to);
      const trap = this.grid.traps.get(key(to.x, to.z));
      if (trap && !trap.sprung && unit.team === 'heroes') {
        flush(to);
        unit.x = to.x;
        unit.z = to.z;
        const result = this.springTrap(trap, unit);
        steps.push({ type: 'trap', result });
        if (!unit.alive || this.over) return stop(i + 1);
      }
    }
    flush(path[path.length - 1]);
    unit.movesLeft -= node.dist;
    unit.x = x;
    unit.z = z;
    this.emit('move', { unit, path });
    this.revealTraps();
    // A door creaks open: anything close by hears it.
    for (const st of steps) if (st.type === 'door') this.noise(st, 3);
    this.updateAwareness();
    return { steps, path };
  }

  springTrap(trap, unit) {
    trap.sprung = true;
    trap.revealed = true;
    const { d20, total, success } = this.save(unit, 'dex', TRAP_DC);
    const roll = rollExpr(TRAP_DAMAGE, { rng: this.rng });
    const damage = success ? Math.floor(roll.total / 2) : roll.total;
    const result = { trap, unit, d20, total, dc: TRAP_DC, success, roll, damage };
    this.emit('trap', result);
    this.applyDamage(unit, damage, null);
    return result;
  }

  /** Heroes with Keen Eyes spot hidden traps within 2 tiles they can see. */
  revealTraps() {
    const found = [];
    for (const u of this.living('heroes')) {
      if (!u.passives.includes('trapSense')) continue;
      for (const t of this.grid.traps.values()) {
        if (t.revealed || gridDistance(u, t) > 2) continue;
        if (!this.grid.lineOfSight(u.x, u.z, t.x, t.z)) continue;
        t.revealed = true;
        found.push(t);
        this.emit('trapFound', { trap: t, unit: u });
      }
    }
    return found;
  }

  // --- object interaction -----------------------------------------------------
  chestProblem(unit, x, z) {
    const c = this.grid.chests.get(key(x, z));
    if (!c) return 'Nothing to open here';
    if (unit.team !== 'heroes') return 'Only heroes loot chests';
    if (c.opened) return 'The chest is empty';
    if (gridDistance(unit, c) > 1) return 'Move next to the chest to open it';
    if (unit.interacted) return 'Already interacted with something this turn';
    return null;
  }

  /** Free object interaction: open an adjacent chest and take what's inside. */
  openChest(unit, x, z) {
    const problem = this.chestProblem(unit, x, z);
    if (problem) return { ok: false, reason: problem };
    const c = this.grid.chests.get(key(x, z));
    c.opened = true;
    unit.interacted = true;
    const loot = c.loot.splice(0);
    for (const item of loot) {
      if (item === 'potion') unit.potions++;
      else this.found.push(item);
    }
    const result = { ok: true, unit, chest: c, loot };
    this.emit('chest', result);
    return result;
  }

  // --- attacks ------------------------------------------------------------
  /** Returns a reason string if the attack is not allowed, else null. */
  attackProblem(attacker, target, attack, { opportunity = false } = {}) {
    if (this.over) return 'The battle is over';
    if (opportunity ? attacker.reactionUsed : !this.canAttack(attacker)) {
      return opportunity ? 'Reaction already used' : 'Action already used this turn';
    }
    if (!opportunity && attacker.turned) return 'Turned: can only flee';
    if (!target?.alive) return 'No valid target';
    if (target.team === attacker.team) return 'That is an ally';
    const d = gridDistance(attacker, target);
    if (d > attack.reach) return `Out of range (${d * 5} ft, ${attack.name} reaches ${attack.reach * 5} ft)`;
    if (d > 1 && !this.grid.lineOfSight(attacker.x, attacker.z, target.x, target.z)) {
      return 'No line of sight';
    }
    return null;
  }

  /** First listed attack that can legally hit the target, or null. */
  bestAttack(attacker, target) {
    return attacker.attacks.find((a) => !this.attackProblem(attacker, target, a)) ?? null;
  }

  /** An ally of the attacker stands on the opposite side of the target. */
  isFlanking(attacker, target) {
    if (gridDistance(attacker, target) !== 1) return false;
    const ox = target.x - (attacker.x - target.x);
    const oz = target.z - (attacker.z - target.z);
    return this.alliesOf(attacker).some((a) => a.x === ox && a.z === oz);
  }

  /** Another ally of the attacker is right next to the target. */
  allyNextTo(attacker, target) {
    return this.alliesOf(attacker).some((a) => gridDistance(a, target) <= 1);
  }

  /** Advantage / disadvantage sources for an attack. They cancel out (5e). */
  attackMods(attacker, target, attack, { opportunity = false } = {}) {
    const adv = [];
    const dis = [];
    if (attack.reach > 1 && this.isAdjacentToEnemy(attacker)) dis.push('enemy adjacent');
    if (target.dodging) dis.push('target is dodging');
    if (attacker.multiattack && attacker.actionUsed && !opportunity) dis.push('second attack');
    if (attack.reach === 1 && this.isFlanking(attacker, target)) adv.push('flanking');
    if (attacker.passives.includes('packTactics') && this.allyNextTo(attacker, target)) adv.push('pack tactics');
    if (target.turned) adv.push('target is fleeing');
    if (target.unaware) adv.push('unaware');
    const mode = adv.length && !dis.length ? 'adv' : dis.length && !adv.length ? 'dis' : 'normal';
    return { adv, dis, mode };
  }

  rollD20(mode) {
    const a = rollDice(1, 20, this.rng).total;
    if (mode === 'normal') return { d20: a, rolls: [a] };
    const b = rollDice(1, 20, this.rng).total;
    return { d20: mode === 'adv' ? Math.max(a, b) : Math.min(a, b), rolls: [a, b] };
  }

  /** Sneak Attack applies: once per turn, with advantage or an ally next to the target. */
  canSneak(attacker, target, mods) {
    if (!attacker.passives.includes('sneakAttack') || attacker.sneakUsed) return false;
    return mods.mode === 'adv' || (mods.mode === 'normal' && this.allyNextTo(attacker, target));
  }

  attack(attacker, target, attack, { opportunity = false } = {}) {
    const problem = this.attackProblem(attacker, target, attack, { opportunity });
    if (problem) return { ok: false, reason: problem };

    const mods = this.attackMods(attacker, target, attack, { opportunity });
    if (opportunity) {
      attacker.reactionUsed = true;
    } else if (!attacker.actionUsed) {
      attacker.actionUsed = true;
      attacker.attacksLeft = (attacker.multiattack ?? attacker.extraAttack ?? 1) - 1;
    } else {
      attacker.attacksLeft--;
    }

    const { d20, rolls } = this.rollD20(mods.mode);
    const toHit = this.toHitBonus(attacker, attack);
    const total = d20 + toHit;
    const crit = d20 === 20;
    const fumble = d20 === 1;
    let hit = crit || (!fumble && total >= this.acOf(target));

    // Shield: a reaction that turns a would-be hit into a miss.
    let shielded = false;
    let shieldSlot = null;
    if (hit && !crit && this.canShield(target) && total < this.acOf(target) + 5) {
      shieldSlot = this.castShield(target);
      shielded = true;
      hit = false;
    }

    let damage = 0;
    let damageRoll = null;
    let sneak = null;
    if (hit) {
      damageRoll = rollExpr(attack.damage, { crit, rng: this.rng });
      damage = Math.max(1, damageRoll.total + this.damageBonus(attacker, attack));
      if (this.canSneak(attacker, target, mods)) {
        attacker.sneakUsed = true;
        sneak = rollExpr(`${attacker.sneakDice ?? 2}d6`, { crit, rng: this.rng });
        damage += sneak.total;
      }
    }

    // Uncanny Dodge: a reaction that halves an attack's damage. Saved for hits that matter.
    let uncanny = false;
    if (hit && this.canUncannyDodge(target) && (damage >= 6 || damage >= target.hp)) {
      target.reactionUsed = true;
      uncanny = true;
      damage = Math.floor(damage / 2);
    }

    const result = {
      ok: true, kind: 'attack', attacker, target, attack, opportunity,
      d20, rolls, mods, toHit, total, ac: this.acOf(target),
      hit, crit, fumble, shielded, damage, damageRoll, sneak, uncanny,
    };
    this.emit('attack', result);
    if (shielded) {
      this.emit('spell', { ok: true, kind: 'spell', id: 'shield', spell: SPELLS.shield, caster: target, slot: shieldSlot });
    }
    if (hit) this.applyDamage(target, damage, attacker);
    this.alert(target, 'hurt'); // a miss gives you away too
    this.noise(attacker);
    return result;
  }

  canUncannyDodge(unit) {
    return unit.alive && unit.passives.includes('uncannyDodge') && !unit.reactionUsed;
  }

  // --- actions --------------------------------------------------------------
  /** Action ids this unit can choose from (standard actions, its features, items). */
  actionsFor(unit) {
    const list = [...STANDARD_ACTIONS, ...unit.features];
    if (unit.potions > 0) list.push('potion');
    return list;
  }

  /** Undead within Turn Undead range that the cleric can see. */
  turnTargets(unit) {
    return this.enemiesOf(unit).filter((e) => e.undead && gridDistance(e, unit) <= ACTIONS.turnUndead.range
      && this.grid.lineOfSight(unit.x, unit.z, e.x, e.z));
  }

  actionProblem(unit, id) {
    const def = ACTIONS[id];
    if (!def || !this.actionsFor(unit).includes(id)) return 'Unknown action';
    if (this.over) return 'The battle is over';
    if (def.time === 'action' && unit.actionUsed) return 'Action already used this turn';
    if (def.time === 'bonus' && unit.bonusUsed) return 'Bonus action already used this turn';
    if (id === 'secondWind') {
      if (unit.secondWindUsed) return 'Already used this fight';
      if (unit.hp >= unit.maxHp) return 'Already at full HP';
    }
    if (id === 'potion' && unit.hp >= unit.maxHp) return 'Already at full HP';
    if (id === 'turnUndead') {
      if (unit.channelUsed) return 'Already used this fight';
      if (!this.turnTargets(unit).length) return 'No undead within 30 ft';
    }
    if (['disengage', 'nimbleEscape', 'cunningDisengage'].includes(id) && unit.disengaged) return 'Already disengaged';
    if (unit.turned && !['dash', 'dodge', 'disengage', 'nimbleEscape'].includes(id)) return 'Turned: can only flee';
    return null;
  }

  doAction(unit, id) {
    const problem = this.actionProblem(unit, id);
    if (problem) return { ok: false, reason: problem };
    const def = ACTIONS[id];
    if (def.time === 'action') unit.actionUsed = true;
    else unit.bonusUsed = true;

    const result = { ok: true, kind: 'action', unit, id, name: def.name };
    switch (id) {
      case 'dash':
      case 'cunningDash':
      case 'aggressive':
        unit.movesLeft += unit.speed;
        break;
      case 'dodge':
        unit.dodging = true;
        break;
      case 'disengage':
      case 'nimbleEscape':
      case 'cunningDisengage':
        unit.disengaged = true;
        break;
      case 'secondWind':
        unit.secondWindUsed = true;
        result.roll = rollExpr(`1d10+${unit.level ?? 1}`, { rng: this.rng });
        result.healed = this.heal(unit, result.roll.total);
        break;
      case 'potion':
        unit.potions--;
        result.roll = rollExpr('2d4+2', { rng: this.rng });
        result.healed = this.heal(unit, result.roll.total);
        break;
      case 'turnUndead': {
        unit.channelUsed = true;
        const dc = this.spellDC(unit);
        result.dc = dc;
        result.saves = this.turnTargets(unit).map((v) => {
          const s = this.save(v, 'wis', dc);
          if (!s.success) v.turned = 2;
          // Destroy Undead: weak undead that fail are destroyed outright.
          s.destroyed = !s.success && unit.destroyUndead != null && (v.cr ?? 99) <= unit.destroyUndead;
          return s;
        });
        break;
      }
    }
    this.emit('action', result);
    for (const s of result.saves ?? []) if (s.destroyed) this.applyDamage(s.unit, s.unit.hp, unit);
    return result;
  }

  // --- spells ---------------------------------------------------------------
  hasSlot(unit, level) {
    if (level === 0) return true; // cantrip
    return Object.entries(unit.slots).some(([l, n]) => Number(l) >= level && n > 0);
  }

  /** Spend the lowest available slot of at least `level`; returns the slot level used. */
  spendSlot(unit, level) {
    if (level === 0) return 0;
    const l = Object.keys(unit.slots).map(Number).sort((a, b) => a - b)
      .find((s) => s >= level && unit.slots[s] > 0);
    unit.slots[l]--;
    return l;
  }

  canShield(unit) {
    return unit.alive && unit.autoShield && unit.spells.includes('shield')
      && !unit.reactionUsed && this.hasSlot(unit, 1);
  }

  /** Spends the reaction and a slot; returns the slot level. The caller emits the event. */
  castShield(unit) {
    unit.reactionUsed = true;
    unit.shielded = true;
    return this.spendSlot(unit, 1);
  }

  /** Valid Misty Step destinations. */
  teleportTiles(unit, range = SPELLS.mistyStep.range) {
    const out = [];
    for (let z = unit.z - range; z <= unit.z + range; z++) {
      for (let x = unit.x - range; x <= unit.x + range; x++) {
        if (x === unit.x && z === unit.z) continue;
        if (this.grid.isSolid(x, z) || this.grid.blocksSight(x, z) || this.unitAt(x, z)) continue;
        if (!this.grid.lineOfSight(unit.x, unit.z, x, z)) continue;
        out.push({ x, z });
      }
    }
    return out;
  }

  /** DEX saves for everyone caught in an area: half damage on a success. */
  areaSaves(victims, dc, damage) {
    return victims.map((v) => {
      const s = this.save(v, 'dex', dc);
      return { ...s, damage: s.success ? Math.floor(damage / 2) : damage };
    });
  }

  /** Mass Healing Word: up to six hurt allies (or self) within range and sight. */
  massHealTargets(caster) {
    const s = SPELLS.massHealingWord;
    return this.living(caster.team)
      .filter((t) => t.hp < t.maxHp && gridDistance(caster, t) <= s.range
        && this.grid.lineOfSight(caster.x, caster.z, t.x, t.z))
      .slice(0, 6);
  }

  /** Valid targets for a unit-targeted spell ('enemy' / 'ally' / 'corpse'). */
  spellTargets(caster, id) {
    const s = SPELLS[id];
    const pool = s.targeting === 'enemy' ? this.enemiesOf(caster)
      : s.targeting === 'ally' ? this.living(caster.team)
        : s.targeting === 'corpse' ? this.corpses() : [];
    return pool.filter((t) => !this.spellProblem(caster, id, t));
  }

  spellProblem(caster, id, target) {
    const s = SPELLS[id];
    if (!s || !caster.spells.includes(id)) return 'Unknown spell';
    if (this.over) return 'The battle is over';
    if (s.time === 'reaction') return 'Cast automatically as a reaction';
    if (caster.turned) return 'Turned: can only flee';
    if (s.time === 'action' && caster.actionUsed) return 'Action already used this turn';
    if (s.time === 'bonus' && caster.bonusUsed) return 'Bonus action already used this turn';
    if (!this.hasSlot(caster, s.level)) return `No level ${s.level}+ spell slots left`;
    if (s.targeting === 'self') {
      if (id === 'massHealingWord' && !this.massHealTargets(caster).length) return 'No one nearby is hurt';
      return null;
    }
    if (!target) return null; // only checking whether the spell is castable at all

    const inRange = (t) => gridDistance(caster, t) <= s.range
      && (gridDistance(caster, t) <= 1 || this.grid.lineOfSight(caster.x, caster.z, t.x, t.z));
    switch (s.targeting) {
      case 'enemy':
        if (!target.alive || target.team === caster.team) return 'Choose an enemy';
        if (!inRange(target)) return `Out of range or not in sight (${s.range * 5} ft)`;
        break;
      case 'ally':
        if (!target.alive || target.team !== caster.team) return 'Choose an ally (or yourself)';
        if (target.hp >= target.maxHp) return `${target.name} is unhurt`;
        if (!inRange(target)) return s.range === 1 ? 'Must touch: stand next to them' : `Out of range (${s.range * 5} ft)`;
        break;
      case 'corpse':
        if (target.alive || target.raised) return 'Choose a corpse';
        if (this.unitAt(target.x, target.z)) return 'Someone is standing on it';
        if (!inRange(target)) return `Out of range (${s.range * 5} ft)`;
        break;
      case 'tile':
        if (!this.teleportTiles(caster, s.range).some((t) => t.x === target.x && t.z === target.z)) {
          return 'Pick an empty spot you can see within 30 ft';
        }
        break;
      case 'cone':
        if (target.x === caster.x && target.z === caster.z) return 'Pick a direction';
        break;
      case 'area':
        if (!this.grid.inBounds(target.x, target.z) || this.grid.blocksSight(target.x, target.z)) return 'Pick a floor tile';
        if (gridDistance(caster, target) > s.range
            || !this.grid.lineOfSight(caster.x, caster.z, target.x, target.z)) return 'Pick a spot you can see';
        break;
    }
    return null;
  }

  castSpell(caster, id, target) {
    const problem = this.spellProblem(caster, id, target);
    if (problem) return { ok: false, reason: problem };
    const spell = SPELLS[id];
    if (spell.time === 'action') caster.actionUsed = true;
    else caster.bonusUsed = true;
    const slot = this.spendSlot(caster, spell.level);
    const upcast = Math.max(0, slot - spell.level);
    const result = { ok: true, kind: 'spell', id, spell, caster, slot };

    switch (id) {
      case 'magicMissile': {
        // All darts go to one target here (5e lets you split them).
        result.target = target;
        result.darts = Array.from({ length: spell.darts + upcast }, () => rollExpr(spell.damage, { rng: this.rng }).total);
        result.damage = result.darts.reduce((a, b) => a + b, 0);
        this.emit('spell', result);
        this.applyDamage(target, result.damage, caster);
        break;
      }
      case 'burningHands': {
        const dir = directionTo(caster, target);
        const tiles = coneTiles(this.grid, caster, dir, spell.range);
        const roll = rollExpr(`${3 + upcast}d6`, { rng: this.rng });
        const dc = this.spellDC(caster);
        const victims = tiles.map((t) => this.unitAt(t.x, t.z)).filter(Boolean);
        Object.assign(result, { dir, tiles, roll, dc });
        result.saves = this.areaSaves(victims, dc, roll.total);
        this.emit('spell', result);
        for (const s of result.saves) this.applyDamage(s.unit, s.damage, caster);
        break;
      }
      case 'fireball': {
        const tiles = areaTiles(this.grid, target, spell.radius);
        const roll = rollExpr(`${8 + upcast}d6`, { rng: this.rng });
        const dc = this.spellDC(caster);
        const victims = tiles.map((t) => this.unitAt(t.x, t.z)).filter(Boolean);
        Object.assign(result, { center: { x: target.x, z: target.z }, tiles, roll, dc });
        result.saves = this.areaSaves(victims, dc, roll.total);
        this.emit('spell', result);
        for (const s of result.saves) this.applyDamage(s.unit, s.damage, caster);
        break;
      }
      case 'massHealingWord': {
        const mod = abilityMod(caster.stats[caster.castStat]);
        result.heals = this.massHealTargets(caster).map((t) => {
          const roll = rollExpr(`${1 + upcast}d4+${mod}`, { rng: this.rng });
          return { unit: t, roll, healed: this.heal(t, roll.total) };
        });
        this.emit('spell', result);
        break;
      }
      case 'sacredFlame': {
        const dc = this.spellDC(caster);
        const { d20, total, success } = this.save(target, 'dex', dc);
        const roll = rollExpr(spell.damage, { rng: this.rng });
        Object.assign(result, { target, dc, save: { d20, total, success }, roll, damage: success ? 0 : roll.total });
        this.emit('spell', result);
        if (result.damage) this.applyDamage(target, result.damage, caster);
        break;
      }
      case 'cureWounds':
      case 'healingWord': {
        const [n, sides] = spell.heal;
        result.roll = rollExpr(`${n + upcast}d${sides}+${abilityMod(caster.stats[caster.castStat])}`, { rng: this.rng });
        result.target = target;
        result.healed = this.heal(target, result.roll.total);
        this.emit('spell', result);
        break;
      }
      case 'mistyStep': {
        result.from = { x: caster.x, z: caster.z };
        result.to = { x: target.x, z: target.z };
        caster.x = target.x;
        caster.z = target.z;
        this.emit('spell', result);
        break;
      }
      case 'animateDead': {
        target.raised = true;
        const risen = createUnit('s', target.x, target.z);
        risen.name = `Risen ${target.cls}`;
        risen.team = caster.team;
        result.corpse = target;
        result.risen = risen;
        this.addUnit(risen, caster);
        this.emit('spell', result);
        break;
      }
      default:
        throw new Error(`castSpell: no rules for "${id}"`);
    }
    if (id !== 'mistyStep') {
      if (result.target?.team) this.alert(result.target, 'hurt');
      this.noise(caster, spell.level >= 3 ? NOISE + 3 : NOISE);
    }
    this.updateAwareness();
    return result;
  }
}
