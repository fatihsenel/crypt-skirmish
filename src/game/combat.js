// Rules engine: initiative, turns, movement, attacks, actions, spells and map
// features (doors, traps, chests). Knows nothing about three.js; the controller
// animates the results it returns.

import { rollDice, rollExpr, abilityMod } from './dice.js';
import { Grid, key, gridDistance, pathFrom } from './grid.js';
import { createUnit, applyLevel, classOf, TEMPLATES } from './units.js';
import { applyItems } from './items.js';
import { ACTIONS, STANDARD_ACTIONS, SPELLS, coneTiles, lineTiles, areaTiles, directionTo } from './abilities.js';

export const TRAP_DC = 13;
export const TRAP_DAMAGE = '2d6';

// Monster senses, in tiles (5 ft). In the dim crypt, unaware monsters spot heroes within
// 40 ft (a Skulker only within 15 ft; a hidden hero only if their passive Perception beats
// the Stealth roll, or from right next to them). They hear fighting 25 ft away by walking
// distance (a closed door muffles it), sleepers only much closer. A monster that spots you
// or is hurt shouts to friends it can see within 20 ft; they don't pass the alarm on.
export const SIGHT = 8;
export const SKULK_SIGHT = 3;
export const NOISE = 5;
/** Extra tiles a closed door adds to how far a sound has to travel. */
export const DOOR_MUFFLE = 2;
export const SHOUT = 4;
/** A sleeping monster only wakes to noise this many tiles closer than the noise's range. */
export const SLEEP_DEPTH = 3;
/** Unaware patrols walk their beat at this many tiles per turn. */
export const PATROL_PACE = 3;

// Conditions (SRD 5.1), kept in unit.conditions as { name: { turns, by } }:
//   prone       melee attacks against it have advantage, ranged ones disadvantage; its own
//               attacks have disadvantage. It stands up at the start of its turn for half
//               its movement.
//   poisoned    disadvantage on attack rolls and ability checks (Stealth).
//   frightened  disadvantage on attack rolls while it can see the source of its fear, and it
//               can't willingly move closer to it. A WIS save at the end of each turn ends it.
//   restrained  speed 0; attacks against it have advantage, its own attacks and DEX saves
//               disadvantage (a spider's web).
// `turns` counts the victim's own turns: it ticks down at the end of each of them.
export const CONDITIONS = ['prone', 'poisoned', 'frightened', 'restrained', 'rotting'];
/** Conditions that simply run out after their `turns`. */
/** Evasion (a rogue's): no damage on a made DEX save for half, half on a failed one. */
const hasEvasion = (unit) => !!unit.passives?.includes('evasion');
const dexSaveDamage = (unit, success, damage) => (hasEvasion(unit)
  ? (success ? 0 : Math.floor(damage / 2))
  : (success ? Math.floor(damage / 2) : damage));

const TIMED = ['poisoned', 'frightened', 'restrained', 'rotting'];

/** Hero fields carried from one level to the next. Level and items rebuild the rest. */
const CARRY = ['level', 'items', 'hp', 'alive', 'slots', 'potions', 'layOnHands'];

/** Weapon attacks (not spell attacks like Fire Bolt) benefit from +1 weapons. */
export const isWeapon = (attack) => attack.stat === 'str' || attack.stat === 'dex';
/** A melee weapon attack (not a thrown javelin): what Dueling and Divine Smite need. */
export const isMelee = (attack) => isWeapon(attack) && attack.reach === 1;

export class Game {
  /**
   * @param level  ASCII rows, or { rows, loot, asleep, patrols } where loot lists the
   *               contents of each '$' chest in reading order, e.g. [['potion'], ['potion', 'potion']],
   *               asleep lists the monsters asleep at the start by tile ('x,z'), and patrols
   *               maps a monster's tile to the waypoints of its beat, e.g. { '13,5': [[9,2]] }
   * @param party  hero state from the previous level, keyed by hero slot (F W R C)
   */
  /** senses: false makes every monster aware from the start (the old behaviour). */
  constructor(level, { rng = Math.random, party = null, senses = true, difficulty = null } = {}) {
    const rows = Array.isArray(level) ? level : level.rows;
    // Every die rolled and every event (but a plain step) is counted, so a move that rolled
    // nothing and set nothing off can be taken back exactly (see undoMove).
    this.rolls = 0;
    this.events = 0;
    this.rng = () => { this.rolls++; return rng(); };
    this.listeners = {};
    this.grid = new Grid(rows);
    [...this.grid.chests.values()].forEach((c, i) => {
      c.loot = [...(level.loot?.[i] ?? ['potion'])];
      // A mimic waits as a chest until someone tries to open it (see openChest).
      if (level.mimics?.includes(key(c.x, c.z))) {
        c.mimic = true;
        c.loot = [];
      }
    });

    // Hard leaves a few monsters out of its worst rooms (level.thinned, by tile).
    if (difficulty?.thin && level.thinned) {
      this.grid.spawns = this.grid.spawns.filter((s) => !level.thinned.includes(key(s.x, s.z)));
    }
    const all = [...this.grid.spawns, ...this.grid.corpses];
    const totals = {};
    for (const s of all) totals[s.code] = (totals[s.code] || 0) + 1;
    const seen = {};
    const make = (s) => {
      seen[s.code] = (seen[s.code] || 0) + 1;
      // A hero slot may be played by another class (party record `cls`).
      const u = createUnit(party?.[s.code] ? classOf(s.code, party[s.code]) : s.code, s.x, s.z, seen[s.code], totals[s.code]);
      u.slot = s.code;
      return u;
    };
    this.difficulty = difficulty; // { hp, bonus } from DIFFICULTIES, or null for as written
    this.units = this.grid.spawns.map(make);
    for (const u of this.units) this.toughen(u);
    for (const c of this.grid.corpses) {
      const u = make(c);
      Object.assign(u, { alive: false, hp: 0, corpse: true, name: `Dead ${u.cls}` });
      this.units.push(u);
    }
    if (party) {
      for (const u of this.units) {
        const saved = party[u.slot];
        if (u.team !== 'heroes' || !saved) continue;
        if (saved.level) applyLevel(u, saved.level);
        if (saved.name) u.name = saved.name;
        applyItems(u, saved.items);
        for (const f of ['hp', 'alive', 'slots', 'potions', 'layOnHands']) {
          if (saved[f] !== undefined) u[f] = structuredClone(saved[f]);
        }
        if (!u.alive) Object.assign(u, { alive: true, hp: 1 }); // carried out by the party
        u.hp = Math.min(u.hp, u.maxHp); // an Amulet of Health handed back at camp
      }
    }

    // Monsters start out unaware of the party (see updateAwareness).
    if (senses) {
      for (const u of this.units) {
        if (u.team !== 'monsters' || !u.alive) continue;
        u.unaware = true;
        const at = key(u.x, u.z);
        if (level.asleep?.includes(at)) u.asleep = true;
        const beat = level.patrols?.[at];
        if (beat && !u.asleep) u.patrol = { route: [{ x: u.x, z: u.z }, ...beat.map(([x, z]) => ({ x, z }))], next: 1 };
      }
    }

    this.order = [];
    this.turn = -1;
    this.round = 0;
    this.over = null; // 'victory' | 'defeat'
    this.found = [];  // non-potion loot taken from chests, for the party's pack
    this.ice = []; // Ice Storm ground: { by, turns, tiles } (see addIce)
    this.stats = {};  // per hero slot: { damage, kills, crits, healing, downed } (for the run's ending)
    this.blows = [];  // every hit a hero took: { round, to, by, byId, kind, how, damage, down } (for a lost fight's recap)
    this.cause = null; // what is dealing damage right now: an attack's or spell's name, or 'a trap'
  }

  /** The tally for a hero, or null for monsters. */
  tally(unit) {
    if (unit?.team !== 'heroes' || !unit.slot) return null;
    return (this.stats[unit.slot] ??= { damage: 0, kills: 0, crits: 0, healing: 0, downed: 0 });
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
      if (u.team === 'heroes' && !u.corpse && !(u.slot in out)) {
        out[u.slot] = structuredClone(Object.fromEntries(CARRY.map((f) => [f, u[f]])));
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
    if (type !== 'move') this.events++;
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

  /** Enemies whose whereabouts `unit` knows: monsters lose track of hidden heroes. */
  knownFoes(unit) {
    return this.enemiesOf(unit).filter((e) => !e.hidden);
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
    const archery = unit.passives?.includes('archery') && isWeapon(attack) && !isMelee(attack) ? 1 : 0; // SRD +2, halved for balance
    return abilityMod(unit.stats[attack.stat]) + unit.prof + (isWeapon(attack) ? unit.weaponBonus ?? 0 : 0) + archery;
  }

  /** Flat damage bonus added to an attack's dice. */
  damageBonus(unit, attack) {
    if (attack.addMod === false) return 0;
    const dueling = unit.passives?.includes('dueling') && isMelee(attack) ? 2 : 0;
    const ogre = attack.stat === 'str' ? unit.strDamage ?? 0 : 0; // Gauntlets of Ogre Power
    return abilityMod(unit.stats[attack.stat]) + (isWeapon(attack) ? unit.weaponBonus ?? 0 : 0) + dueling + ogre;
  }

  acOf(unit) {
    return unit.ac + (unit.acBonus ?? 0) + (unit.shielded ? 5 : 0) + (unit.faithFrom ? 2 : 0);
  }

  /**
   * Half cover: +2 AC when a barrel or crate stands between attacker and target. One right
   * next to the attacker doesn't count (you lean over your own barricade).
   */
  coverBonus(attacker, target) {
    for (const [x, z] of this.grid.lineBetween(attacker.x, attacker.z, target.x, target.z)) {
      const p = this.grid.props.get(key(x, z));
      if (p?.cover === 'half' && gridDistance(attacker, p) > 1) return 2;
    }
    return 0;
  }

  /** Roll a saving throw: d20 + ability modifier + item bonuses + a paladin's aura. */
  save(unit, stat, dc) {
    let d20 = rollDice(1, 20, this.rng).total;
    if (stat === 'dex' && this.has(unit, 'restrained')) d20 = Math.min(d20, rollDice(1, 20, this.rng).total);
    const aura = this.auraBonus(unit);
    let total = d20 + abilityMod(unit.stats[stat]) + (unit.saveBonus ?? 0) + aura;
    // Dark One's Own Luck: once per fight, a d10 on a failed save that it could still turn.
    let luck = null;
    if (total < dc && total + 10 >= dc && unit.passives?.includes('ownLuck') && !unit.luckUsed) {
      unit.luckUsed = true;
      luck = rollDice(1, 10, this.rng).total;
      total += luck;
    }
    return { unit, d20, total, aura, luck, success: total >= dc };
  }

  /** Aura of Protection: the best CHA modifier (min +1) of a living paladin of its side within 10 ft. */
  auraBonus(unit) {
    let best = 0;
    for (const p of this.living(unit.team)) {
      if (!p.passives.includes('auraOfProtection') || gridDistance(p, unit) > 2) continue;
      best = Math.max(best, Math.max(1, abilityMod(p.stats.cha)));
    }
    return best;
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
  /** 10 + WIS modifier: what a monster notices without trying. */
  passivePerception(m) {
    return 10 + abilityMod(m.stats.wis) + (m.perception ?? 0);
  }

  /** d20 + DEX, doubled proficiency for an expert, disadvantage in noisy armour. */
  stealthBonus(h) {
    return abilityMod(h.stats.dex) + (h.stealth === 'expert' ? 2 * h.prof : h.stealth === 'trained' ? h.prof : 0);
  }

  inSight(a, b, range = SIGHT) {
    return gridDistance(a, b) <= range
      && (this.grid.lineOfSight(a.x, a.z, b.x, b.z) || this.grid.lineOfSight(b.x, b.z, a.x, a.z));
  }

  /**
   * Can monster `m` spot hero `h` from where it stands? (sight works both ways)
   * Sleepers see nothing. A hidden hero is spotted only by a monster whose passive
   * Perception reaches the Stealth roll, or one standing right next to them.
   */
  notices(m, h) {
    if (!h.alive || !m.alive || m.asleep) return false;
    if (h.hidden) return gridDistance(m, h) <= 1 || (this.passivePerception(m) >= h.hidden && this.inSight(m, h));
    return this.inSight(m, h, m.unaware && h.passives.includes('skulker') ? SKULK_SIGHT : SIGHT);
  }

  /**
   * Remember the last of `tiles` (in walking order) where an alert monster could see hero
   * `h`. That spot is where searching monsters head once the hero hides.
   */
  markSeen(h, tiles) {
    if (h.hidden || !h.alive) return;
    const watchers = this.living('monsters').filter((m) => !m.unaware && !m.asleep);
    for (let i = tiles.length - 1; i >= 0; i--) {
      const t = tiles[i];
      if (watchers.some((m) => this.inSight(m, t))) {
        h.lastSeen = { x: t.x, z: t.z };
        return;
      }
    }
  }

  /**
   * Can hero `h` spot hidden monster `m`? Next to it, or in sight with a passive Perception
   * that reaches its Stealth, or in sight with nothing between them: a goblin needs a wall,
   * column, barrel or crate to stay hidden behind.
   */
  spotsHidden(h, m) {
    if (!h.alive || !m.alive) return false;
    if (gridDistance(h, m) <= 1) return true;
    if (!this.inSight(h, m)) return false;
    return this.passivePerception(h) >= m.hidden || this.coverBonus(h, m) === 0;
  }

  /** Heroes who can see `m` with nothing to hide behind (they stop it hiding). */
  hideWatchers(m) {
    return this.living('heroes').filter((h) => this.inSight(h, m) && this.coverBonus(h, m) === 0);
  }

  /** A hidden unit gives itself away (or is found). */
  reveal(h, cause, by = null) {
    if (!h.hidden) return;
    h.hidden = 0;
    this.emit('revealed', { unit: h, cause, by });
  }

  // --- conditions -------------------------------------------------------------
  has(unit, name) {
    return !!unit.conditions?.[name];
  }

  /**
   * Give `unit` a condition for `turns` of its own turns (Infinity: until removed).
   * Gained during its own turn, the rest of that turn doesn't count.
   */
  addCondition(unit, name, { turns = Infinity, by = null, dc = 10 } = {}) {
    if (!unit.alive || unit.immune?.includes(name)) return;
    const own = unit === this.current;
    const fresh = !unit.conditions[name];
    unit.conditions[name] = { turns: turns + (own && turns !== Infinity ? 1 : 0), by, dc };
    if ((name === 'prone' || name === 'restrained') && own) unit.movesLeft = 0; // knocked down or caught mid-move
    if (fresh) this.emit('condition', { unit, name, on: true, by });
  }

  removeCondition(unit, name, cause = 'expired') {
    if (!unit.conditions[name]) return;
    delete unit.conditions[name];
    this.emit('condition', { unit, name, on: false, cause });
  }

  /** The unit the frightened `unit` is afraid of, if it is still up. */
  fearSource(unit) {
    const by = unit.conditions?.frightened?.by;
    return by?.alive ? by : null;
  }

  /** Start of a turn: get up off the floor (half of the movement goes on it). */
  standUp(unit) {
    if (!this.has(unit, 'prone')) return;
    unit.movesLeft = Math.max(0, unit.speed - Math.ceil(unit.speed / 2));
    this.removeCondition(unit, 'prone', 'stand');
  }

  /**
   * Start of a turn next to a ghast: CON save or poisoned until the end of this turn. A
   * hero who passes is used to the smell for the rest of the fight.
   */
  checkStench(u) {
    if (!u.alive || u.team !== 'heroes' || u.stenchSafe || this.has(u, 'poisoned') || u.immune?.includes('poisoned')) return;
    const by = this.enemiesOf(u).find((m) => m.stench && !m.unaware && gridDistance(m, u) <= 1);
    if (!by) return;
    const s = this.save(u, 'con', by.stench.dc);
    if (s.success) u.stenchSafe = true;
    else this.addCondition(u, 'poisoned', { turns: 0, by }); // the rest of this turn
    this.emit('stench', {
      by, target: u,
      rider: { stat: 'con', dc: by.stench.dc, d20: s.d20, total: s.total, success: s.success, condition: 'poisoned' },
    });
  }

  /** End of a turn: frightened units try to shake it off, and timed conditions tick down. */
  tickConditions(unit) {
    if (!unit.alive) return;
    if (this.has(unit, 'frightened')) {
      const c = unit.conditions.frightened;
      if (!this.fearSource(unit)) this.removeCondition(unit, 'frightened', 'expired');
      else if (this.save(unit, 'wis', c.dc).success) this.removeCondition(unit, 'frightened', 'save');
    }
    for (const name of TIMED) {
      const c = unit.conditions[name];
      if (c && --c.turns <= 0) this.removeCondition(unit, name, 'expired');
    }
  }

  /**
   * An attack's rider (e.g. poisoned claws): the target saves or gains the condition.
   * Returns { stat, dc, d20, total, success, condition } or null.
   */
  applyRider(attacker, target, rider) {
    if (!rider || !target.alive || this.has(target, rider.condition) || target.immune?.includes(rider.condition)) return null;
    if (!rider.save) { // no save: a hit is enough (a web)
      this.addCondition(target, rider.condition, { turns: rider.turns ?? Infinity, by: attacker });
      return { stat: null, success: false, condition: rider.condition };
    }
    const s = this.save(target, rider.save, rider.dc);
    const out = { stat: rider.save, dc: rider.dc, d20: s.d20, total: s.total, success: s.success, condition: rider.condition };
    if (!s.success) this.addCondition(target, rider.condition, { turns: rider.turns ?? Infinity, by: attacker });
    return out;
  }

  /** An unaware monster becomes aware; if it saw or was hurt, it shouts to friends in view. */
  alert(m, cause) {
    if (!m.unaware || !m.alive) return;
    const wasAsleep = !!m.asleep;
    m.unaware = false;
    m.asleep = false;
    m.patrol = null;
    this.emit('alert', { unit: m, cause, wasAsleep });
    // Only the monster that saw you or was hurt raises the alarm: no relay across the map.
    if (cause === 'noise' || cause === 'ally') return;
    for (const o of this.living('monsters')) {
      if (o.unaware && gridDistance(o, m) <= SHOUT && this.grid.lineOfSight(o.x, o.z, m.x, m.z)) this.alert(o, 'ally');
    }
  }

  /** Every monster looks around: unaware ones may spot the party, anyone may find a hidden hero. */
  updateAwareness() {
    const heroes = this.living('heroes');
    const monsters = this.living('monsters');
    for (const h of heroes) {
      if (!h.hidden) continue;
      const by = monsters.find((m) => this.notices(m, h));
      if (by) this.reveal(h, 'spotted', by);
    }
    for (const m of monsters) {
      if (m.unaware && heroes.some((h) => this.notices(m, h))) this.alert(m, 'sight');
    }
    for (const m of monsters) {
      if (!m.hidden) continue;
      const by = heroes.find((h) => this.spotsHidden(h, m));
      if (by) this.reveal(m, 'spotted', by);
    }
    for (const h of heroes) this.markSeen(h, [h]);
  }

  /** A noise at `at` wakes unaware monsters within `range` tiles of walking distance. */
  noise(at, range = NOISE) {
    if (!this.living('monsters').some((m) => m.unaware)) return;
    const dist = this.soundField(at, range);
    for (const m of this.living('monsters')) {
      const reach = m.asleep ? range - SLEEP_DEPTH : range;
      if (m.unaware && (dist.get(key(m.x, m.z)) ?? Infinity) <= reach) this.alert(m, 'noise');
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
      colossusUsed: false,
      strikeUsed: false,
      interacted: false,
    });
    this.standUp(u);
    if (this.has(u, 'restrained')) u.movesLeft = 0;
    this.recharge(u);
    this.updateAwareness();
    this.emit('turnStart', { unit: u });
    this.checkStench(u);
  }

  /**
   * Start of a turn: each spent attack with `recharge: n` comes back on a d6 roll of n or
   * more (SRD "Recharge 5–6"). Dice are only rolled for spent attacks.
   */
  recharge(u) {
    if (!u.spent) return;
    for (const name of Object.keys(u.spent)) {
      const attack = u.attacks.find((a) => a.name === name);
      const d6 = rollDice(1, 6, this.rng).total;
      if (d6 >= (attack?.recharge ?? 1)) {
        delete u.spent[name];
        this.emit('recharged', { unit: u, attack, d6 });
      }
    }
  }

  endTurn() {
    if (this.over) return;
    const u = this.current;
    if (u.turned > 0) u.turned--;
    this.tickConditions(u);
    this.thawIce(u);
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
  /** Apply the run's difficulty to a monster (on creation, and to a mimic as it wakes). */
  toughen(u) {
    const d = this.difficulty;
    if (!d || u.team !== 'monsters') return u;
    u.maxHp = Math.max(1, Math.round(u.maxHp * d.hp));
    u.hp = u.maxHp;
    u.weaponBonus += d.bonus;
    return u;
  }

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
    const before = target.hp;
    if (amount > 0) this.reveal(target, 'hurt'); // caught in a blast: no hiding that
    if (amount > 0) target.turned = 0; // damage breaks Turn Undead
    // Temporary HP soak up damage first.
    const soaked = Math.min(target.tempHp ?? 0, Math.max(0, amount));
    if (soaked) target.tempHp -= soaked;
    target.hp = Math.max(0, target.hp - (amount - soaked));
    // Death Ward: the first blow that would drop the warded leaves them on 1 HP instead.
    if (target.hp <= 0 && target.alive && target.deathWard) {
      target.hp = 1;
      target.deathWard = false;
      const saved = this.tally(target);
      if (saved) saved.warded = (saved.warded ?? 0) + 1;
      this.emit('ward', { unit: target, source });
    }
    const t = target.team === 'monsters' ? this.tally(source) : null;
    if (t) t.damage += before - target.hp; // only what landed, not overkill
    if (target.team === 'heroes' && before > target.hp) {
      this.blows.push({
        round: this.round, to: target.name, by: source?.name ?? null, byId: source?.id ?? null, kind: source?.cls ?? null, how: this.cause,
        damage: before - target.hp, down: target.hp <= 0 && target.alive,
      });
    }
    if (target.hp <= 0 && target.alive) {
      if (t) t.kills++;
      const down = this.tally(target);
      if (down) down.downed++;
      target.alive = false;
      for (const u of this.units) if (u.faithFrom === target.id) u.faithFrom = null; // Shield of Faith drops
      target.spiritWeapon = null; // and a fallen cleric's spectral weapon fades
      let unmarked = null;
      if (target.mark) { // a fallen ranger's Hunter's Mark ends
        unmarked = this.units.find((u) => u.id === target.mark.id) ?? null;
        if (unmarked?.marked === target.mark.spell) unmarked.marked = false;
        target.mark = null;
      }
      // Dark One's Blessing: a warlock who drops a foe gains CHA + level temporary HP.
      let blessing = null;
      if (source?.alive && source.team !== target.team && source.passives?.includes('darkOnesBlessing')) {
        const gain = Math.max(1, abilityMod(source.stats.cha) + source.level);
        if (gain > (source.tempHp ?? 0)) {
          source.tempHp = gain;
          blessing = { unit: source, tempHp: gain };
        }
      }
      this.emit('death', { unit: target, source, unmarked, blessing });
      this.checkEnd();
    }
    if (target.alive && target.rises && !target.roused && target.hp * 2 <= target.maxHp) this.houseRises(target);
  }

  /**
   * Nekhet, bloodied, calls up his house (once a fight): up to `rises` of his fallen undead
   * stand again as skeletons, and fresh ones climb out beside him to make up the number.
   * His glare sweeps every hero within 2 tiles who can see him: WIS save or frightened.
   */
  houseRises(lord) {
    lord.roused = true;
    const free = (x, z) => !this.grid.isSolid(x, z) && !this.unitAt(x, z);
    const risen = [];
    const bodies = this.units.filter((u) => !u.alive && !u.raised && !u.corpse && u !== lord
      && u.team === lord.team && u.undead && free(u.x, u.z));
    for (const body of bodies.slice(0, lord.rises)) {
      body.raised = true;
      risen.push({ body, unit: createUnit('s', body.x, body.z) });
      risen.at(-1).unit.name = `Risen ${body.cls}`;
    }
    for (let r = 1; r <= 2 && risen.length < lord.rises; r++) {
      for (let dz = -r; dz <= r && risen.length < lord.rises; dz++) {
        for (let dx = -r; dx <= r && risen.length < lord.rises; dx++) {
          const x = lord.x + dx, z = lord.z + dz;
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || !free(x, z)) continue;
          if (risen.some((e) => e.unit.x === x && e.unit.z === z)) continue;
          const unit = createUnit('s', x, z);
          unit.name = 'Risen Servant';
          risen.push({ body: null, unit });
        }
      }
    }
    for (const { unit } of risen) {
      unit.team = lord.team;
      unit.unaware = false;
      this.toughen(unit);
      this.addUnit(unit, lord);
    }
    const dc = this.spellDC(lord);
    const glare = this.living('heroes')
      .filter((h) => gridDistance(h, lord) <= 2 && this.grid.lineOfSight(lord.x, lord.z, h.x, h.z))
      .map((target) => ({ target, ...this.save(target, 'wis', dc) }));
    for (const g of glare) {
      if (!g.success) this.addCondition(g.target, 'frightened', { turns: SPELLS.dread.turns, by: lord, dc });
    }
    this.emit('rising', { unit: lord, risen, glare, dc });
    this.updateAwareness();
  }

  heal(target, amount, source = target) {
    if (this.has(target, 'rotting')) return 0; // mummy rot: no HP back until it wears off
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    const t = this.tally(source);
    if (t) t.healing += target.hp - before;
    return target.hp - before;
  }

  checkEnd() {
    if (this.over) return;
    if (!this.living('monsters').length) this.over = 'victory';
    else if (!this.living('heroes').length) this.over = 'defeat';
    if (this.over) this.emit('gameOver', { result: this.over });
  }

  // --- movement -----------------------------------------------------------
  // You may move through allies but not through enemies (5e). Heroes avoid traps they know
  // about. The frightened can't step any closer to what they fear.
  passableFor(unit) {
    const fear = this.fearSource(unit);
    const keep = fear ? gridDistance(unit, fear) : 0;
    return (x, z) => {
      const o = this.unitAt(x, z);
      if (o && o.team !== unit.team) return false;
      if (fear && gridDistance({ x, z }, fear) < keep) return false;
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
    return this.grid.flood(unit.x, unit.z, unit.movesLeft, this.passableFor(unit), this.moveCost(unit));
  }

  // --- difficult terrain (Ice Storm) ----------------------------------------
  /** Keys of the tiles that are difficult terrain right now. */
  icyTiles() {
    const out = new Set();
    for (const f of this.ice ?? []) for (const k of f.tiles) out.add(k);
    return out;
  }

  /**
   * What entering a tile costs `unit` (2 on difficult ground), or null when nothing slows it:
   * no ice, or a flier (specters, wraiths, Ysolde) passing over it.
   */
  moveCost(unit = null) {
    if (!this.ice?.length || unit?.flies) return null;
    const icy = this.icyTiles();
    return (x, z) => (icy.has(key(x, z)) ? 2 : 1);
  }

  /** Ice Storm's ground stays difficult until the end of the caster's next turn. */
  addIce(caster, tiles) {
    (this.ice ??= []).push({ by: caster, turns: 2, tiles: new Set(tiles.map((t) => key(t.x, t.z))) });
    this.emit('ice', { tiles: this.icyTiles(), melted: false });
  }

  /** At the end of `unit`'s turn: its storms (or a fallen caster's) wear on, and thaw. */
  thawIce(unit) {
    if (!this.ice?.length) return;
    const before = this.ice.length;
    for (const f of this.ice) if (f.by === unit || !f.by.alive) f.turns--;
    this.ice = this.ice.filter((f) => f.turns > 0);
    if (this.ice.length !== before) this.emit('ice', { tiles: this.icyTiles(), melted: true });
  }

  /**
   * Where `monster` could hurt someone on its next turn, moving at its normal speed (no Dash):
   * `melee`, the tiles it could step next to and strike; `ranged`, the tiles it could shoot
   * from somewhere it could stand, with a line of sight. Both are Sets of tile keys. `ignore`
   * is a unit to leave out of the way: the hero deciding where to go, who won't be there.
   * Monsters that haven't noticed the party, or are fleeing a Turn Undead, threaten nothing.
   */
  threatOf(monster, { ignore = null } = {}) {
    const melee = new Set();
    const ranged = new Set();
    if (!monster.alive || monster.unaware || monster.turned) return { melee, ranged };
    const ready = monster.attacks.filter((a) => !monster.spent?.[a.name]);
    const reach = Math.max(0, ...ready.filter((a) => a.reach > 1).map((a) => a.reach));
    if (!ready.length) return { melee, ranged };

    let moves = monster.speed;
    if (this.has(monster, 'restrained')) moves = 0;
    else if (this.has(monster, 'prone')) moves -= Math.ceil(monster.speed / 2);
    const pass = this.passableFor(monster);
    const away = (x, z) => ignore && ignore.x === x && ignore.z === z;
    const map = this.grid.flood(monster.x, monster.z, Math.max(0, moves), (x, z) => away(x, z) || pass(x, z), this.moveCost(monster));
    const spots = [...map.values()].filter((n) => {
      if (n.dist === 0) return true;
      const o = this.unitAt(n.x, n.z);
      return !o || o === ignore;
    });

    if (ready.some((a) => a.reach === 1)) {
      for (const { x, z } of spots) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx || dz) && !this.grid.isSolid(x + dx, z + dz)) melee.add(key(x + dx, z + dz));
          }
        }
      }
    }
    if (reach > 1) {
      for (let z = 0; z < this.grid.height; z++) {
        for (let x = 0; x < this.grid.width; x++) {
          if (this.grid.isSolid(x, z) || melee.has(key(x, z))) continue;
          const t = { x, z };
          if (spots.some((p) => gridDistance(p, t) <= reach && this.grid.lineOfSight(p.x, p.z, x, z))) ranged.add(key(x, z));
        }
      }
    }
    return { melee, ranged };
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
    const before = {
      unit, x: unit.x, z: unit.z, movesLeft: unit.movesLeft, path,
      lastSeen: this.living('heroes').map((h) => [h, h.lastSeen]),
      rolls: this.rolls, events: this.events,
    };

    const steps = [];
    let walked = [path[0]];
    const flush = (from) => {
      if (walked.length > 1) steps.push({ type: 'walk', path: walked });
      walked = [from];
    };
    const stop = (i) => {
      flush(path[i]);
      unit.movesLeft -= map.get(key(path[i].x, path[i].z)).dist;
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
        if (result.prone) {
          // Knocked flat: the move ends here (addCondition already spent the movement).
          flush(to);
          this.emit('move', { unit, path: path.slice(0, i + 2) });
          for (const st of steps) if (st.type === 'door') this.noise(st, 3);
          this.revealTraps();
          this.updateAwareness();
          return { steps, path: path.slice(0, i + 2), interrupted: true };
        }
      }
    }
    flush(path[path.length - 1]);
    unit.movesLeft -= node.dist;
    unit.x = x;
    unit.z = z;
    this.emit('move', { unit, path });
    if (unit.team === 'heroes') this.markSeen(unit, path); // ducking out of view mid-move
    this.revealTraps();
    // A door creaks open: anything close by hears it.
    for (const st of steps) if (st.type === 'door') this.noise(st, 3);
    this.updateAwareness();
    const clean = this.rolls === before.rolls && this.events === before.events && steps.every((st) => st.type === 'walk');
    return clean ? { steps, path, undo: before } : { steps, path };
  }

  /**
   * Take back a move that rolled no dice and set nothing off (a move result's `undo`): the
   * mover goes back with its movement, as if the move never happened. False if it's too late.
   */
  undoMove(undo) {
    const { unit } = undo ?? {};
    if (!unit || this.over || unit !== this.current || !unit.alive) return false;
    if (this.rolls !== undo.rolls || unit.x !== undo.path.at(-1).x || unit.z !== undo.path.at(-1).z) return false;
    unit.x = undo.x;
    unit.z = undo.z;
    unit.movesLeft = undo.movesLeft;
    for (const [h, seen] of undo.lastSeen) {
      if (seen === undefined) delete h.lastSeen;
      else h.lastSeen = seen;
    }
    return true;
  }

  springTrap(trap, unit) {
    trap.sprung = true;
    trap.revealed = true;
    const { d20, total, success } = this.save(unit, 'dex', TRAP_DC);
    const roll = rollExpr(TRAP_DAMAGE, { rng: this.rng });
    const damage = dexSaveDamage(unit, success, roll.total);
    // Spikes through the boots: fail the save and you go down as well.
    const result = { trap, unit, d20, total, dc: TRAP_DC, success, roll, damage, prone: false };
    this.emit('trap', result);
    this.cause = 'a trap';
    this.applyDamage(unit, damage, null);
    if (!success && unit.alive) {
      result.prone = true;
      this.addCondition(unit, 'prone');
    }
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
      // The same eye for detail sees teeth marks on a chest that isn't one.
      for (const c of this.grid.chests.values()) {
        if (!c.mimic || c.suspected || gridDistance(u, c) > 2) continue;
        if (!this.grid.lineOfSight(u.x, u.z, c.x, c.z)) continue;
        c.suspected = true;
        this.emit('mimicFound', { chest: c, unit: u });
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
    unit.interacted = true;
    if (c.mimic) return this.springMimic(unit, c);
    c.opened = true;
    const loot = c.loot.splice(0);
    for (const item of loot) {
      if (item === 'potion') unit.potions++;
      else this.found.push(item);
    }
    const result = { ok: true, unit, chest: c, loot };
    this.emit('chest', result);
    return result;
  }

  /**
   * The "chest" was a mimic. It joins the fight right after the hero who touched it and
   * bites at once, with advantage unless someone had already seen through it (Keen Eyes).
   */
  springMimic(unit, c) {
    this.grid.chests.delete(key(c.x, c.z));
    const mimic = this.toughen(createUnit('m', c.x, c.z));
    this.addUnit(mimic, unit);
    const result = { ok: true, unit, chest: c, loot: [], mimic, bite: null };
    this.emit('mimic', result);
    result.bite = this.attack(mimic, unit, mimic.attacks[0], { ambush: !c.suspected });
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
    if (!opportunity && attacker.actionUsed && attacker.extraAttackWith && attack.name !== attacker.extraAttackWith) {
      return `Only ${attacker.extraAttackWith} fires again`;
    }
    if (!target?.alive) return 'No valid target';
    if (target.team === attacker.team) return 'That is an ally';
    if (attacker.spent?.[attack.name]) return `${attack.name} hasn't recharged`;
    if (target.hidden && target.team === 'monsters') return `${target.name} is hidden: Search to find it`;
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
  attackMods(attacker, target, attack, { opportunity = false, ambush = false } = {}) {
    const adv = [];
    const dis = [];
    if (ambush) adv.push('ambush');
    if (attack.reach > 1 && this.isAdjacentToEnemy(attacker)) dis.push('enemy adjacent');
    if (target.dodging) dis.push('target is dodging');
    if (attacker.clumsyMultiattack && attacker.actionUsed && !opportunity) dis.push('second attack');
    if (this.has(attacker, 'prone')) dis.push('prone');
    if (this.has(target, 'prone')) {
      if (gridDistance(attacker, target) <= 1) adv.push('target prone');
      else dis.push('target prone');
    }
    if (this.has(attacker, 'poisoned')) dis.push('poisoned');
    if (this.has(attacker, 'restrained')) dis.push('restrained');
    if (this.has(target, 'restrained')) adv.push('target restrained');
    const fear = this.fearSource(attacker);
    if (fear && this.inSight(attacker, fear, 99)) dis.push('frightened');
    if (attack.reach === 1 && this.isFlanking(attacker, target)) adv.push('flanking');
    if (attacker.passives.includes('packTactics') && this.allyNextTo(attacker, target)) adv.push('pack tactics');
    if (opportunity && target.passives.includes('escapeTheHorde')) dis.push('escape the horde');
    if (target.turned) adv.push('target is fleeing');
    if (target.asleep) adv.push('asleep');
    else if (target.unaware) adv.push('unaware');
    if (attacker.hidden && !opportunity) adv.push('hidden');
    if (target.hidden) dis.push('target hidden');
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
  /**
   * Divine Smite: spends the lowest slot for 2d8 radiant, +1d8 per slot level above 1st
   * (5d8 at most), +1d8 against undead. Dice double on a crit. Disarms afterwards.
   */
  smite(attacker, target, crit) {
    const slot = this.spendSlot(attacker, 1);
    attacker.smiteArmed = false;
    const dice = Math.min(5, 1 + slot) + (target.undead ? 1 : 0);
    const roll = rollExpr(`${dice}d8`, { crit, rng: this.rng });
    return { slot, dice, total: roll.total, roll };
  }

  /** Why `unit` can't arm Divine Smite, or null. */
  smiteProblem(unit) {
    if (!unit.passives.includes('divineSmite')) return 'Unknown feature';
    if (this.over) return 'The battle is over';
    if (!unit.smiteArmed && !this.hasSlot(unit, 1)) return 'No spell slots left';
    return null;
  }

  /** Arm or disarm Divine Smite for the next melee hit (a free choice, not an action). */
  toggleSmite(unit) {
    const problem = this.smiteProblem(unit);
    if (problem) return { ok: false, reason: problem };
    unit.smiteArmed = !unit.smiteArmed;
    return { ok: true, armed: unit.smiteArmed };
  }

  /**
   * Attacks left after the first of the Attack action. A warlock's second beam comes only
   * with Eldritch Blast: opening with the dagger (or a shove) is the whole action.
   */
  followUps(attacker, attack) {
    if (attacker.extraAttackWith && attack?.name !== attacker.extraAttackWith) return 0;
    return (attacker.multiattack ?? attacker.extraAttack ?? 1) - 1;
  }

  /** Why `unit` can't arm Hellish Rebuke, or null. */
  rebukeProblem(unit) {
    if (!unit.passives.includes('hellishRebuke')) return 'Unknown feature';
    if (this.over) return 'The battle is over';
    if (!unit.rebukeArmed && !this.hasSlot(unit, 1)) return 'No spell slots left';
    return null;
  }

  /** Arm or disarm Hellish Rebuke for the next enemy that damages you (a free choice). */
  toggleRebuke(unit) {
    const problem = this.rebukeProblem(unit);
    if (problem) return { ok: false, reason: problem };
    unit.rebukeArmed = !unit.rebukeArmed;
    return { ok: true, armed: unit.rebukeArmed };
  }

  /**
   * Hellish Rebuke, armed: the warlock's reaction to being damaged by `foe` within 60 ft and
   * in sight. 2d10 fire, +1d10 per slot level above 1st, DEX save for half. Returns the
   * spell result (already emitted and applied), or null if it didn't go off.
   */
  rebuke(warlock, foe) {
    if (!warlock.rebukeArmed || !warlock.alive || warlock.reactionUsed || !foe?.alive) return null;
    if (foe.team === warlock.team || !this.hasSlot(warlock, 1)) return null;
    const d = gridDistance(warlock, foe);
    if (d > 12 || (d > 1 && !this.grid.lineOfSight(warlock.x, warlock.z, foe.x, foe.z))) return null;
    warlock.rebukeArmed = false;
    warlock.reactionUsed = true;
    const slot = this.spendSlot(warlock, 1);
    const dc = this.spellDC(warlock);
    const save = this.save(foe, 'dex', dc);
    const roll = rollExpr(`${1 + slot}d10`, { rng: this.rng });
    const damage = dexSaveDamage(foe, save.success, roll.total);
    const r = {
      ok: true, kind: 'spell', id: 'hellishRebuke', spell: SPELLS.hellishRebuke,
      caster: warlock, target: foe, slot, dc, save, roll, damage,
    };
    this.reveal(warlock, 'spell');
    this.emit('spell', r);
    this.applyDamage(foe, damage, warlock);
    return r;
  }

  /** Hunter's Mark (weapon hits) or Hex (any hit) on this target: the extra roll, or null. */
  markDamage(attacker, target, attack, crit) {
    const m = attacker.mark;
    if (m?.id !== target.id) return null;
    const spell = m.spell ?? 'huntersMark';
    if (spell === 'huntersMark' && !isWeapon(attack)) return null;
    return { ...rollExpr(SPELLS[spell].damage, { crit, rng: this.rng }), spell };
  }

  canSneak(attacker, target, mods) {
    if (!attacker.passives.includes('sneakAttack') || attacker.sneakUsed) return false;
    return mods.mode === 'adv' || (mods.mode === 'normal' && this.allyNextTo(attacker, target));
  }

  attack(attacker, target, attack, { opportunity = false, ambush = false } = {}) {
    const problem = this.attackProblem(attacker, target, attack, { opportunity });
    if (problem) return { ok: false, reason: problem };

    const mods = this.attackMods(attacker, target, attack, { opportunity, ambush });
    this.reveal(attacker, 'attack');
    if (opportunity) {
      attacker.reactionUsed = true;
    } else if (!attacker.actionUsed) {
      attacker.actionUsed = true;
      attacker.attacksLeft = this.followUps(attacker, attack);
    } else {
      attacker.attacksLeft--;
    }
    if (attack.recharge) (attacker.spent ??= {})[attack.name] = true;

    const { d20, rolls } = this.rollD20(mods.mode);
    const toHit = this.toHitBonus(attacker, attack);
    const total = d20 + toHit;
    // Improved Critical: a fighter's weapon crits on 19 too.
    const crit = d20 >= (isWeapon(attack) && attacker.critRange ? attacker.critRange : 20);
    const fumble = d20 === 1;
    if (crit && this.tally(attacker)) this.tally(attacker).crits++;
    const cover = this.coverBonus(attacker, target);
    const ac = this.acOf(target) + cover;
    let hit = crit || (!fumble && total >= ac);

    // Shield: a reaction that turns a would-be hit into a miss.
    let shielded = false;
    let shieldSlot = null;
    if (hit && !crit && this.canShield(target) && total < ac + 5) {
      shieldSlot = this.castShield(target);
      shielded = true;
      hit = false;
    }

    let damage = 0;
    let damageRoll = null;
    let sneak = null;
    let smite = null;
    let mark = null;
    let colossus = null;
    let strike = null;
    if (hit && attack.damage) { // a web hits for no damage: only its rider matters
      damageRoll = rollExpr(attack.damage, { crit, rng: this.rng });
      damage = Math.max(1, damageRoll.total + this.damageBonus(attacker, attack));
      if (this.canSneak(attacker, target, mods)) {
        attacker.sneakUsed = true;
        sneak = rollExpr(`${attacker.sneakDice ?? 2}d6`, { crit, rng: this.rng });
        damage += sneak.total;
      }
      if (attacker.smiteArmed && isMelee(attack) && this.hasSlot(attacker, 1)) {
        smite = this.smite(attacker, target, crit);
        damage += smite.total;
      }
      mark = this.markDamage(attacker, target, attack, crit);
      if (mark) damage += mark.total;
      // Colossus Slayer looks at the foe as the arrow lands, before this hit's damage.
      if (isWeapon(attack) && attacker.passives.includes('colossusSlayer') && !attacker.colossusUsed && target.hp < target.maxHp) {
        attacker.colossusUsed = true;
        colossus = rollExpr('1d8', { crit, rng: this.rng });
        damage += colossus.total;
      }
      // Divine Strike (Life Domain): +1d8 radiant on a weapon hit, once per turn.
      if (isWeapon(attack) && attacker.passives.includes('divineStrike') && !attacker.strikeUsed) {
        attacker.strikeUsed = true;
        strike = rollExpr('1d8', { crit, rng: this.rng });
        damage += strike.total;
      }
    }

    // Uncanny Dodge: a reaction that halves an attack's damage. Saved for hits that matter.
    let uncanny = false;
    if (hit && damage && this.canUncannyDodge(target) && (damage >= 6 || damage >= target.hp)) {
      target.reactionUsed = true;
      uncanny = true;
      damage = Math.floor(damage / 2);
    }

    const result = {
      ok: true, kind: 'attack', attacker, target, attack, opportunity,
      d20, rolls, mods, toHit, total, ac: this.acOf(target) + cover, cover,
      hit, crit, fumble, shielded, damage, damageRoll, sneak, smite, mark, colossus, strike, uncanny, rider: null, rebuke: null,
    };
    this.emit('attack', result);
    if (shielded) {
      this.emit('spell', { ok: true, kind: 'spell', id: 'shield', spell: SPELLS.shield, caster: target, slot: shieldSlot });
    }
    if (hit) {
      this.cause = attack.name;
      if (damage) this.applyDamage(target, damage, attacker);
      result.rider = this.applyRider(attacker, target, attack.rider);
      if (result.rider) this.emit('rider', result);
      if (damage) result.rebuke = this.rebuke(target, attacker);
    }
    this.alert(target, 'hurt'); // a miss gives you away too
    this.noise(attacker);
    return result;
  }

  /** Shove: knock an adjacent enemy prone. Takes one attack of the Attack action. */
  shoveProblem(attacker, target) {
    if (this.over) return 'The battle is over';
    if (!this.canAttack(attacker)) return 'Action already used this turn';
    if (attacker.actionUsed && attacker.extraAttackWith) return `Only ${attacker.extraAttackWith} fires again`;
    if (attacker.turned) return 'Turned: can only flee';
    if (!target?.alive || target.team === attacker.team) return 'Choose an enemy';
    if (gridDistance(attacker, target) > 1) return 'Must stand next to them';
    if (this.has(target, 'prone')) return `${target.name} is already prone`;
    if (target.huge) return `${target.name} is too big to shove`;
    return null;
  }

  /**
   * Athletics (d20 + STR + proficiency) against the target's best of STR or DEX.
   * The target wins ties. Returns { ok, kind: 'shove', attacker, target, roll, resist, success }.
   */
  shove(attacker, target) {
    const problem = this.shoveProblem(attacker, target);
    if (problem) return { ok: false, reason: problem };
    this.reveal(attacker, 'attack');
    if (!attacker.actionUsed) {
      attacker.actionUsed = true;
      attacker.attacksLeft = this.followUps(attacker, null);
    } else {
      attacker.attacksLeft--;
    }
    const mode = this.has(attacker, 'poisoned') ? 'dis' : 'normal';
    const a = this.rollD20(mode);
    const b = rollDice(1, 20, this.rng).total;
    const bonus = this.shoveBonus(attacker);
    const resistBonus = this.shoveResist(target);
    const roll = { d20: a.d20, rolls: a.rolls, bonus, total: a.d20 + bonus };
    const resist = { d20: b, bonus: resistBonus, total: b + resistBonus };
    const result = { ok: true, kind: 'shove', attacker, target, roll, resist, success: roll.total > resist.total };
    this.emit('shove', result);
    this.alert(target, 'hurt');
    if (result.success) this.addCondition(target, 'prone', { by: attacker });
    this.noise(attacker);
    this.updateAwareness();
    return result;
  }

  shoveBonus(unit) {
    return abilityMod(unit.stats.str) + (unit.team === 'heroes' ? unit.prof : 0);
  }

  shoveResist(unit) {
    return Math.max(abilityMod(unit.stats.str), abilityMod(unit.stats.dex));
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
    if ((id === 'secondWind' || id === 'potion') && this.has(unit, 'rotting')) return 'Rotting: you can’t regain HP';
    if (id === 'turnUndead') {
      if (unit.channelUsed >= (unit.channelUses ?? 1)) return 'Already used this fight';
      if (!this.turnTargets(unit).length) return 'No undead within 30 ft';
    }
    if (['disengage', 'nimbleEscape', 'cunningDisengage'].includes(id) && unit.disengaged) return 'Already disengaged';
    if (unit.turned && !['dash', 'dodge', 'disengage', 'nimbleEscape'].includes(id)) return 'Turned: can only flee';
    if (id === 'hide' || id === 'cunningHide' || id === 'nimbleHide') {
      if (unit.hidden) return 'Already hidden';
      const watcher = unit.team === 'monsters' ? this.hideWatchers(unit)[0]
        : this.enemiesOf(unit).find((e) => !e.unaware && this.inSight(e, unit));
      if (watcher) return `${watcher.name} is watching you`;
    }
    if (id === 'search' && unit.team === 'heroes'
        && !this.enemiesOf(unit).some((e) => e.hidden && this.inSight(unit, e))) {
      return 'Nothing hidden in sight';
    }
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
        if (!this.has(unit, 'restrained')) unit.movesLeft += unit.speed; // speed 0 doubled is 0
        break;
      case 'dodge':
        unit.dodging = true;
        break;
      case 'hide':
      case 'cunningHide':
      case 'nimbleHide': {
        const poisoned = this.has(unit, 'poisoned');
        const { d20, rolls } = this.rollD20(unit.noisyArmor || poisoned ? 'dis' : 'normal');
        const bonus = this.stealthBonus(unit);
        Object.assign(result, { d20, rolls, bonus, total: d20 + bonus, noisy: !!unit.noisyArmor, poisoned });
        unit.hidden = Math.max(1, d20 + bonus);
        break;
      }
      case 'search': {
        // Perception (d20 + the passive bonus) against each hidden enemy it could see.
        const bonus = this.passivePerception(unit) - 10;
        result.checks = this.enemiesOf(unit)
          .filter((h) => h.hidden && this.inSight(unit, h))
          .map((h) => {
            const { d20 } = this.rollD20(this.has(unit, 'poisoned') ? 'dis' : 'normal');
            return { unit: h, d20, bonus, total: d20 + bonus, dc: h.hidden, success: d20 + bonus >= h.hidden };
          });
        result.found = result.checks.filter((c) => c.success).map((c) => c.unit);
        break;
      }
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
        unit.channelUsed = (unit.channelUsed || 0) + 1;
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
    for (const h of result.found ?? []) {
      this.reveal(h, 'searched', unit);
      if (h.team === 'heroes') h.lastSeen = { x: h.x, z: h.z };
    }
    if (unit.hidden) this.updateAwareness(); // anyone close enough spots the attempt
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
      return { ...s, damage: dexSaveDamage(v, s.success, damage), evasion: hasEvasion(v) };
    });
  }

  /** Mass Healing Word: up to six hurt allies (or self) within range and sight. */
  massHealTargets(caster) {
    const s = SPELLS.massHealingWord;
    return this.living(caster.team)
      .filter((t) => t.hp < t.maxHp && !this.has(t, 'rotting') && gridDistance(caster, t) <= s.range
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
    const free = this.freeRecast(caster, id);
    const again = id === 'spiritualWeapon' && free; // strikes again for free
    if (!free && !this.hasSlot(caster, s.level)) return `No level ${s.level}+ spell slots left`;
    if (s.pool && !(caster.layOnHands > 0)) return 'Your healing pool is spent';
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
        if (target.hidden && target.team === 'monsters') return `${target.name} is hidden: Search to find it`;
        if (again) {
          if (gridDistance(caster.spiritWeapon, target) > s.reach) return `Too far from the spectral weapon (${s.reach * 5} ft)`;
        } else if (!inRange(target)) return `Out of range or not in sight (${s.range * 5} ft)`;
        if (s.condition && this.has(target, s.condition)) return `${target.name} is already ${s.condition}`;
        if ((id === 'huntersMark' || id === 'hex') && caster.mark?.id === target.id) return `${target.name} is already ${id === 'hex' ? 'hexed' : 'marked'}`;
        break;
      case 'ally':
        if (!target.alive || target.team !== caster.team) return 'Choose an ally (or yourself)';
        if ((s.heal || s.pool) && target.hp >= target.maxHp) return `${target.name} is unhurt`;
        if ((s.heal || s.pool) && this.has(target, 'rotting')) return `${target.name} is rotting: no healing takes`;
        if (id === 'shieldOfFaith' && target.faithFrom === caster.id) return `${target.name} already has it`;
        if (id === 'deathWard' && target.deathWard) return `${target.name} is already warded`;
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
      case 'line':
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

  /** A floor tile next to `target`, the one closest to `from` (for things that float there). */
  besideTile(target, from) {
    let best = { x: target.x, z: target.z };
    let bestD = Infinity;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = target.x + dx;
        const z = target.z + dz;
        if ((!dx && !dz) || this.grid.blocksSight(x, z) || this.grid.isSolid(x, z)) continue;
        const d = Math.hypot(x - from.x, z - from.z);
        if (d < bestD) [best, bestD] = [{ x, z }, d];
      }
    }
    return best;
  }

  /** Who a blast over `tiles` catches. Sculpt Spells leaves the caster's side out. */
  blastVictims(caster, tiles) {
    return tiles.map((t) => this.unitAt(t.x, t.z))
      .filter((u) => u && !(caster.sculpt && u.team === caster.team));
  }

  /** Blessed Healer: a cleric who heals someone else with a slot regains 2 + its level. */
  blessedHeal(caster, slot, healedOthers) {
    if (!caster.passives.includes('blessedHealer') || !slot || !healedOthers) return null;
    return this.heal(caster, 2 + slot) || null;
  }

  /**
   * A spell that costs no slot this time: Spiritual Weapon striking again. (Hunter's Mark
   * moves on for free in the SRD; here every new mark costs a slot, for balance.)
   */
  freeRecast(caster, id) {
    return id === 'spiritualWeapon' && !!caster.spiritWeapon;
  }

  /**
   * Scorching Ray's volley: a ranged spell attack per ray, all at `target`. Once the rays
   * have dropped it, the rest fly at the nearest other foe in range and sight (or are lost).
   */
  scorchingRays(caster, target, count) {
    const spell = SPELLS.scorchingRay;
    const ray = { name: spell.name, reach: spell.range };
    const toHit = caster.prof + abilityMod(caster.stats[caster.castStat]);
    const left = new Map(); // hit points left as the rays land
    const hpOf = (u) => left.get(u.id) ?? u.hp;
    const inReach = (u) => {
      const d = gridDistance(caster, u);
      return d <= spell.range && (d <= 1 || this.grid.lineOfSight(caster.x, caster.z, u.x, u.z));
    };
    const rays = [];
    let t = target;
    for (let i = 0; i < count && t; i++) {
      const mods = this.attackMods(caster, t, ray);
      const { d20, rolls } = this.rollD20(mods.mode);
      const cover = this.coverBonus(caster, t);
      const ac = this.acOf(t) + cover;
      const crit = d20 === 20;
      const hit = crit || (d20 !== 1 && d20 + toHit >= ac);
      if (crit && this.tally(caster)) this.tally(caster).crits++;
      let damage = 0;
      let roll = null;
      let mark = null;
      if (hit) {
        roll = rollExpr(spell.damage, { crit, rng: this.rng });
        mark = this.markDamage(caster, t, ray, crit);
        damage = roll.total + (mark?.total ?? 0);
        left.set(t.id, hpOf(t) - damage);
      }
      rays.push({ target: t, d20, rolls, mods, toHit, total: d20 + toHit, ac, cover, hit, crit, fumble: d20 === 1, roll, mark, damage });
      if (hpOf(t) <= 0) {
        t = this.knownFoes(caster)
          .filter((e) => hpOf(e) > 0 && !e.hidden && inReach(e))
          .sort((a, b) => gridDistance(caster, a) - gridDistance(caster, b))[0] ?? null;
      }
    }
    return rays;
  }

  castSpell(caster, id, target) {
    const problem = this.spellProblem(caster, id, target);
    if (problem) return { ok: false, reason: problem };
    const spell = SPELLS[id];
    this.cause = spell.name;
    if (spell.time === 'action') caster.actionUsed = true;
    else caster.bonusUsed = true;
    const again = this.freeRecast(caster, id);
    const slot = again ? caster.spiritWeapon.slot : this.spendSlot(caster, spell.level);
    const upcast = Math.max(0, slot - spell.level);
    this.reveal(caster, 'spell');
    const result = { ok: true, kind: 'spell', id, spell, caster, slot: again ? 0 : slot };

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
        const victims = this.blastVictims(caster, tiles);
        Object.assign(result, { dir, tiles, roll, dc });
        result.saves = this.areaSaves(victims, dc, roll.total);
        this.emit('spell', result);
        for (const s of result.saves) this.applyDamage(s.unit, s.damage, caster);
        break;
      }
      case 'lightningBolt': {
        const tiles = lineTiles(this.grid, caster, target, spell.range);
        const roll = rollExpr(`${8 + upcast}d6`, { rng: this.rng });
        const dc = this.spellDC(caster);
        const victims = this.blastVictims(caster, tiles);
        Object.assign(result, { toward: { x: target.x, z: target.z }, tiles, roll, dc });
        result.saves = this.areaSaves(victims, dc, roll.total);
        this.emit('spell', result);
        for (const s of result.saves) this.applyDamage(s.unit, s.damage, caster);
        break;
      }
      case 'spiritualWeapon': {
        // The weapon floats to the foe (it fills no tile), then makes a melee spell attack.
        const from = caster.spiritWeapon ?? caster;
        result.again = again;
        result.from = { x: from.x, z: from.z };
        result.to = this.besideTile(target, from);
        caster.spiritWeapon = { ...result.to, slot };
        const { d20 } = this.rollD20('normal');
        const mod = abilityMod(caster.stats[caster.castStat]);
        const toHit = caster.prof + mod;
        const ac = this.acOf(target);
        const crit = d20 === 20;
        const hit = crit || (d20 !== 1 && d20 + toHit >= ac);
        const dice = 1 + Math.floor(Math.max(0, slot - 2) / 2);
        const roll = hit ? rollExpr(`${dice}d8+${mod}`, { crit, rng: this.rng }) : null;
        Object.assign(result, { target, d20, toHit, total: d20 + toHit, ac, hit, crit, roll, damage: roll ? Math.max(1, roll.total) : 0 });
        if (crit && this.tally(caster)) this.tally(caster).crits++;
        this.emit('spell', result);
        if (hit) this.applyDamage(target, result.damage, caster);
        break;
      }
      case 'fireball': {
        const tiles = areaTiles(this.grid, target, spell.radius);
        const roll = rollExpr(`${8 + upcast}d6`, { rng: this.rng });
        const dc = this.spellDC(caster);
        const victims = this.blastVictims(caster, tiles);
        Object.assign(result, { center: { x: target.x, z: target.z }, tiles, roll, dc });
        result.saves = this.areaSaves(victims, dc, roll.total);
        this.emit('spell', result);
        for (const s of result.saves) this.applyDamage(s.unit, s.damage, caster);
        break;
      }
      case 'iceStorm': {
        const tiles = areaTiles(this.grid, target, spell.radius);
        const hail = rollExpr(`${2 + upcast}d8`, { rng: this.rng });
        const cold = rollExpr('4d6', { rng: this.rng });
        const roll = { rolls: [...hail.rolls, ...cold.rolls], bonus: 0, total: hail.total + cold.total };
        const dc = this.spellDC(caster);
        const victims = this.blastVictims(caster, tiles);
        Object.assign(result, { center: { x: target.x, z: target.z }, tiles, roll, dc });
        result.saves = this.areaSaves(victims, dc, roll.total);
        this.emit('spell', result);
        for (const s of result.saves) this.applyDamage(s.unit, s.damage, caster);
        this.addIce(caster, tiles);
        break;
      }
      case 'deathWard': {
        target.deathWard = true;
        result.target = target;
        this.emit('spell', result);
        break;
      }
      case 'massHealingWord': {
        const mod = abilityMod(caster.stats[caster.castStat]);
        result.heals = this.massHealTargets(caster).map((t) => {
          const roll = rollExpr(`${1 + upcast}d4+${mod}`, { rng: this.rng });
          return { unit: t, roll, healed: this.heal(t, roll.total, caster) };
        });
        result.selfHeal = this.blessedHeal(caster, slot, result.heals.some((h) => h.unit !== caster));
        this.emit('spell', result);
        break;
      }
      case 'scorchingRay': {
        result.target = target;
        result.rays = this.scorchingRays(caster, target, spell.rays + upcast);
        this.emit('spell', result);
        for (const ray of result.rays) {
          if (ray.hit) this.applyDamage(ray.target, ray.damage, caster);
          else this.alert(ray.target, 'hurt');
        }
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
      case 'dread': {
        const dc = this.spellDC(caster);
        const { d20, total, success } = this.save(target, 'wis', dc);
        Object.assign(result, { target, dc, save: { d20, total, success } });
        this.emit('spell', result);
        if (!success) this.addCondition(target, 'frightened', { turns: spell.turns, by: caster, dc });
        break;
      }
      case 'cureWounds':
      case 'healingWord': {
        const [n, sides] = spell.heal;
        result.roll = rollExpr(`${n + upcast}d${sides}+${abilityMod(caster.stats[caster.castStat])}`, { rng: this.rng });
        result.target = target;
        result.healed = this.heal(target, result.roll.total, caster);
        result.selfHeal = this.blessedHeal(caster, slot, target !== caster);
        this.emit('spell', result);
        break;
      }
      case 'layOnHands': {
        result.target = target;
        const amount = this.has(target, 'rotting') ? 0 : Math.min(caster.layOnHands, target.maxHp - target.hp);
        caster.layOnHands -= amount;
        result.healed = this.heal(target, amount, caster);
        result.left = caster.layOnHands;
        this.emit('spell', result);
        break;
      }
      case 'shieldOfFaith': {
        // One at a time: casting it again moves it.
        for (const u of this.units) if (u.faithFrom === caster.id) u.faithFrom = null;
        target.faithFrom = caster.id;
        result.target = target;
        this.emit('spell', result);
        break;
      }
      case 'huntersMark':
      case 'hex': {
        result.target = target;
        const old = caster.mark && this.units.find((u) => u.id === caster.mark.id);
        result.unmarked = old || null; // whose tag to clear
        if (old && old.marked === (caster.mark.spell ?? 'huntersMark')) old.marked = false; // for the status tags; caster.mark is what the rules read
        target.marked = id;
        caster.mark = { id: target.id, slot, spell: id };
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
        this.toughen(risen);
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
      if (result.target?.team && result.target.team !== caster.team) this.alert(result.target, 'hurt');
      this.noise(caster, spell.level >= 3 ? NOISE + 3 : NOISE);
    }
    this.updateAwareness();
    return result;
  }
}
