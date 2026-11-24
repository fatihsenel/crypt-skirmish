// Rules engine: initiative, turns, movement, attacks, actions and map
// features (doors, traps, chests); spells are in spells.js. Knows nothing about three.js; the controller
// animates the results it returns.

import { rollDice, rollExpr, parseDice, abilityMod } from './dice.js';
import { Grid, key, gridDistance, pathFrom } from './grid.js';
import { createUnit, applyLevel, classOf, TEMPLATES } from './units.js';
import { applyItems } from './items.js';
import { ACTIONS, STANDARD_ACTIONS, SPELLS } from './abilities.js';
import { Spellcasting, NOISE, dexSaveDamage } from './spells.js';
import { RULES, ELITE_TRAITS, ELITE_REGEN, ELITE_BARBS, eliteTrait } from './elites.js';

// Kept apart (elites.js) so the title's code doesn't carry the rules engine.
export { RULES, ELITE_TRAITS, ELITE_REGEN, ELITE_BARBS, eliteTrait };

export const TRAP_DC = 13;
export const TRAP_DAMAGE = '2d6';
/** A tipped brazier: coals land on three tiles past it (DEX save for half), and burn there. */
export const SPILL_DC = 12;
export const SPILL_DAMAGE = '2d6';
export const BURN_DAMAGE = '1d6'; // walking onto burning coals, once a turn
export const TUMBLE_DAMAGE = '1d6'; // rules 5: pushed down a flight of stairs
export const BURN_TURNS = 3;      // the coals burn until the end of the tipper's third turn

// Monster senses, in tiles (5 ft). In the dim crypt, unaware monsters spot heroes within
// 40 ft (a Skulker only within 15 ft; a hidden hero only if their passive Perception beats
// the Stealth roll, or from right next to them). They hear fighting 25 ft away by walking
// distance (a closed door muffles it), sleepers only much closer. A monster that spots you
// or is hurt shouts to friends it can see within 20 ft; they don't pass the alarm on.
export const SIGHT = 8;
export const SKULK_SIGHT = 3;
export { NOISE }; // defined in spells.js, which casting needs too
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
//   paralyzed   (rules 2, a ghoul's claws) can't move, act or react; fails STR and DEX saves;
//               attacks against it have advantage, and a hit from within 5 ft is a crit. A CON
//               save at the start of each of its turns ends it (in time to act).
//   petrified   (a basilisk's gaze, cut down to a turn) can't move, act or react; fails STR and
//               DEX saves; attacks against it have advantage. Wears off as its next turn ends.
export const CONDITIONS = ['prone', 'poisoned', 'frightened', 'restrained', 'rotting', 'mocked', 'paralyzed', 'stunned', 'petrified'];
/** Conditions that simply run out after their `turns`. */

const TIMED = ['poisoned', 'frightened', 'restrained', 'rotting', 'mocked', 'paralyzed', 'stunned', 'petrified'];

/** Hero fields carried from one level to the next. Level and items rebuild the rest. */
const CARRY = ['level', 'items', 'hp', 'alive', 'slots', 'potions', 'layOnHands'];

/** Weapon attacks (not spell attacks like Fire Bolt) benefit from +1 weapons. */
export const isWeapon = (attack) => attack.stat === 'str' || attack.stat === 'dex' || !!attack.weapon; // a druid's Shillelagh too
/** A melee weapon attack (not a thrown javelin): what Dueling and Divine Smite need. */
export const isMelee = (attack) => isWeapon(attack) && attack.reach === 1;
/**
 * A ranged weapon's long range (rules 2): bows and javelins reach four times as far, at
 * disadvantage past their normal range (a spider's web, `long`, its own). Spells don't.
 */
/**
 * The chance (0 to 1) that d20 + `bonus` hits `ac`: a natural 1 always misses, a roll of
 * `critOn` or more always hits. With advantage the better of two dice, with disadvantage the worse.
 */
export function hitChance(bonus, ac, mode = 'normal', critOn = 20) {
  let faces = 0;
  for (let f = 2; f <= 20; f++) if (f >= critOn || f + bonus >= ac) faces++;
  const p = faces / 20;
  return mode === 'adv' ? 1 - (1 - p) ** 2 : mode === 'dis' ? p * p : p;
}

/** The chance (0 to 1) that a save of d20 + `bonus` falls short of `dc` (no natural 1s or 20s on saves). */
export function failChance(bonus, dc, mode = 'normal') {
  const p = Math.min(1, Math.max(0, (dc - bonus - 1) / 20));
  return mode === 'adv' ? p * p : mode === 'dis' ? 1 - (1 - p) ** 2 : p;
}

/** The lowest and highest a dice expression can roll, plus `bonus` (at least 1, like a hit). */
export function diceRange(expr, bonus = 0) {
  const d = parseDice(expr);
  return { min: Math.max(1, d.count + d.bonus + bonus), max: Math.max(1, d.count * d.sides + d.bonus + bonus) };
}

export const longReach = (attack) => (isWeapon(attack) && attack.reach > 1 ? attack.long ?? attack.reach * 4 : attack.reach);

/** Rules 4: the DEX save a hero thrown toward a chasm makes to catch its edge. */
const EDGE_DC = 10;

export class Game extends Spellcasting {
  /**
   * @param level  ASCII rows, or { rows, loot, asleep, patrols } where loot lists the
   *               contents of each '$' chest in reading order, e.g. [['potion'], ['potion', 'potion']],
   *               asleep lists the monsters asleep at the start by tile ('x,z'), and patrols
   *               maps a monster's tile to the waypoints of its beat, e.g. { '13,5': [[9,2]] }
   * @param party  hero state from the previous level, keyed by hero slot (F W R C)
   */
  /** senses: false makes every monster aware from the start (the old behaviour). */
  constructor(level, { rng = Math.random, party = null, senses = true, difficulty = null, relics = [], rules = RULES } = {}) {
    super();
    // Which rules the fight is played by (see RULES): a saved fight, replay or link keeps its own.
    this.rules = rules;
    this.relics = [...relics]; // the run's boss relics (items.js RELICS)
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
    // New Game+ 2 and deeper: the room's strongest monster (most XP, the first on a tie) is an elite.
    if (difficulty?.elite >= 2) {
      const top = this.units.filter((u) => u.team === 'monsters').reduce((a, u) => (!a || u.xp > a.xp ? u : a), null);
      if (top) this.makeElite(top, eliteTrait(level.id, difficulty.elite).id);
    }
    for (const c of this.grid.corpses) {
      const u = make(c);
      Object.assign(u, { alive: false, hp: 0, corpse: true, name: `Dead ${u.cls}` });
      this.units.push(u);
    }
    if (party) {
      for (const u of this.units) {
        const saved = party[u.slot];
        if (u.team !== 'heroes' || !saved) continue;
        if (saved.level) applyLevel(u, saved.level, saved.picks);
        if (saved.name) u.name = saved.name;
        applyItems(u, saved.items);
        for (const f of ['hp', 'alive', 'slots', 'potions', 'layOnHands']) {
          if (saved[f] !== undefined) u[f] = structuredClone(saved[f]);
        }
        if (!u.alive) Object.assign(u, { alive: true, hp: 1 }); // carried out by the party
        u.hp = Math.min(u.hp, u.maxHp); // an Amulet of Health handed back at camp
      }
    }
    // The Labyrinth Thread: every hero moves a tile further.
    if (this.relics.includes('thread')) for (const u of this.units) if (u.team === 'heroes') u.speed += 1;

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
    this.hurtBy = {}; // per round: HP each side lost, { heroes, monsters } (the log's round headings)
    this.blows = [];  // every hit a hero took: { round, to, by, byId, kind, code, how, via, damage, hp, down } (for the fight's recap)
    this.drunk = 0;   // potions the heroes drank this fight
    this.cause = null; // what is dealing damage right now: an attack's or spell's name, or 'a trap'
    this.via = null;   // and how: 'melee', 'ranged', 'spell' or 'trap'
  }

  /** HP each side lost in `round` (temporary HP and overkill aside). */
  roundHurt(round) {
    return { heroes: 0, monsters: 0, ...this.hurtBy[round] };
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
    return this.units.filter((u) => !u.alive && !u.raised && !u.dying);
  }

  toHitBonus(unit, attack) {
    const archery = unit.passives?.includes('archery') && isWeapon(attack) && !isMelee(attack) ? 1 : 0; // SRD +2, halved for balance
    return abilityMod(unit.stats[attack.stat]) + unit.prof + (isWeapon(attack) ? unit.weaponBonus ?? 0 : 0) + archery + (unit.hitBonus ?? 0);
  }

  /** Flat damage bonus added to an attack's dice. */
  damageBonus(unit, attack) {
    // Elemental Affinity: a draconic sorcerer's CHA on Fire Bolt (its other fire spells in spells.js).
    if (attack.projectile === 'fire' && unit.passives?.includes('elementalAffinity')) return abilityMod(unit.stats.cha);
    if (attack.addMod === false) return 0;
    const rage = unit.raging && isMelee(attack) && attack.stat === 'str' ? 2 : 0;
    const dueling = unit.passives?.includes('dueling') && isMelee(attack) ? 2 : 0;
    const ogre = attack.stat === 'str' ? unit.strDamage ?? 0 : 0; // Gauntlets of Ogre Power
    return abilityMod(unit.stats[attack.stat]) + (isWeapon(attack) ? unit.weaponBonus ?? 0 : 0) + dueling + ogre + rage;
  }

  acOf(unit) {
    return unit.ac + (unit.acBonus ?? 0) + (unit.shielded ? 5 : 0) + (unit.faithFrom ? 2 : 0);
  }

  /**
   * Half cover: +2 AC when a barrel, a crate or a lowered portcullis (rules 2: or another
   * creature, friend or foe) stands between attacker and target. One right next to the
   * attacker doesn't count (you lean over your own barricade, or past your friend).
   */
  coverBonus(attacker, target, gone = null) { // gone(u): already felled (the rays before)
    for (const [x, z] of this.grid.lineBetween(attacker.x, attacker.z, target.x, target.z)) {
      const p = this.grid.props.get(key(x, z)) ?? this.grid.gates.get(key(x, z))
        ?? (this.rules >= 2 ? this.unitAt(x, z) : null);
      if (p?.team && (p.id === attacker.id || p.id === target.id || gone?.(p))) continue; // (a copy of either, standing elsewhere: the AI's what-ifs)
      if ((p?.cover === 'half' || p?.down || p?.team) && gridDistance(attacker, p) > 1) return 2;
    }
    return 0;
  }

  /** Roll a saving throw: d20 + ability modifier + item bonuses + a paladin's aura. */
  save(unit, stat, dc) {
    let d20 = rollDice(1, 20, this.rng).total;
    // Paralysed, stunned or petrified: STR and DEX saves fail, whatever the die says.
    if ((stat === 'str' || stat === 'dex') && (this.has(unit, 'paralyzed') || this.has(unit, 'stunned') || this.has(unit, 'petrified'))) {
      return { unit, d20, total: d20 + abilityMod(unit.stats[stat]), aura: 0, luck: null, inspired: null, success: false, paralyzed: true };
    }
    // Advantage: a raging barbarian's STR saves, Danger Sense's DEX saves. Restrained: DEX at disadvantage.
    const adv = (stat === 'str' && unit.raging) || (stat === 'dex' && !!unit.passives?.includes('dangerSense'));
    const dis = stat === 'dex' && this.has(unit, 'restrained');
    if (dis && !adv) d20 = Math.min(d20, rollDice(1, 20, this.rng).total);
    else if (adv && !dis) d20 = Math.max(d20, rollDice(1, 20, this.rng).total);
    const aura = this.auraBonus(unit);
    let total = d20 + abilityMod(unit.stats[stat]) + (unit.saveBonus ?? 0) + aura;
    // Dark One's Own Luck: once per fight, a d10 on a failed save that it could still turn.
    let luck = null;
    if (total < dc && total + 10 >= dc && unit.passives?.includes('ownLuck') && !unit.luckUsed) {
      unit.luckUsed = true;
      luck = rollDice(1, 10, this.rng).total;
      total += luck;
    }
    const inspired = total < dc ? this.useInspiration(unit, dc - total) : null;
    if (inspired) total += inspired.total;
    return { unit, d20, total, aura, luck, inspired, success: total >= dc };
  }

  /**
   * Bardic Inspiration: an inspired unit's attack or save that falls `short` of what it needed
   * by no more than the die rolls it and adds it. Dice are only rolled when they could help.
   */
  useInspiration(unit, short) {
    const ins = unit.inspired;
    if (!ins || short > ins.die) return null;
    unit.inspired = null;
    const roll = rollDice(1, ins.die, this.rng);
    return { by: ins.by, die: ins.die, total: roll.total };
  }

  /**
   * Cutting Words: a bard who can see `attacker` (within 60 ft) and has a reaction and an
   * inspiration use left takes the die off a hit the die could turn into a miss (`over`: how
   * far the roll beat the AC, plus one).
   */
  cuttingWords(attacker, over) {
    const bard = this.enemiesOf(attacker).find((b) => b.passives.includes('cuttingWords') && !b.reactionUsed
      && b.inspiration > 0 && b.inspirationDie >= over && this.inSight(b, attacker, 12));
    if (!bard) return null;
    bard.reactionUsed = true;
    bard.inspiration--;
    const roll = rollDice(1, bard.inspirationDie, this.rng);
    return { by: bard, die: bard.inspirationDie, total: roll.total };
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

  /**
   * A strike past the Attack action, when its attacks are spent: Flurry of Blows' unarmed
   * strikes, a monk's Martial Arts unarmed strike or a raging berserker's Frenzy (each a bonus
   * action). Returns 'flurry' | 'martial' | 'frenzy' or null; `attack` null: any attack.
   */
  bonusStrike(unit, attack = null) {
    if (!unit.actionUsed || unit.attacksLeft > 0 || !unit.tookAttack) return null;
    const unarmed = attack ? attack.unarmed : unit.attacks.some((a) => a.unarmed);
    if (unit.strikes > 0 && unarmed) return 'flurry';
    if (unit.bonusUsed) return null;
    if (unarmed && unit.passives.includes('martialArts')) return 'martial';
    if (unit.raging && unit.passives.includes('frenzy') && (attack ? isMelee(attack) : unit.attacks.some(isMelee))) return 'frenzy';
    return null;
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
    if (name === 'paralyzed' || name === 'stunned' || name === 'petrified') this.paralyze(unit);
  }

  /** Paralysed: no move, action, bonus action or reaction, and what it held or kept up ends. */
  paralyze(unit) {
    Object.assign(unit, { movesLeft: 0, actionUsed: true, bonusUsed: true, reactionUsed: true, interacted: true, dodging: false, readied: false, readiedAttack: null, readiedSpell: null });
    if (unit.grappling) this.letGo(unit, 'paralyzed');
    if (unit.helping) this.endHelp(unit);
    this.endConcentration(unit, 'paralyzed');
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
    if (rider && this.rules >= 2 && rider.v2) rider = rider.v2; // a ghoul's claws paralyse under rules 2
    if (!rider || !target.alive || this.has(target, rider.condition) || target.immune?.includes(rider.condition)) return null;
    if (!rider.save) { // no save: a hit is enough (a web)
      this.addCondition(target, rider.condition, { turns: rider.turns ?? Infinity, by: attacker });
      return { stat: null, success: false, condition: rider.condition };
    }
    const s = this.save(target, rider.save, rider.dc);
    const out = { stat: rider.save, dc: rider.dc, d20: s.d20, total: s.total, success: s.success, condition: rider.condition };
    if (!s.success) this.addCondition(target, rider.condition, { turns: rider.turns ?? Infinity, by: attacker, dc: rider.dc });
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
      if (u.feral) u.initRoll = Math.max(u.initRoll, rollDice(1, 20, this.rng).total); // Feral Instinct
      u.initiative = u.initRoll + abilityMod(u.stats.dex);
    }
    // Varek's Barrow Horn: the heroes go first, each side in its own initiative order.
    const first = (u) => (this.relics.includes('horn') && u.team === 'heroes' ? 0 : 1);
    this.order = this.living().sort(
      (a, b) => first(a) - first(b) || b.initiative - a.initiative || b.stats.dex - a.stats.dex,
    );
    this.emit('initiative', { order: this.order });
    this.round = 1;
    this.turn = 0;
    this.emit('round', { round: 1 });
    this.revealTraps();
    // Ysolde's Veil: the party starts hidden at 15 + Stealth, plate or not.
    if (this.relics.includes('veil')) {
      for (const h of this.living('heroes')) h.hidden = 15 + this.stealthBonus(h);
    }
    this.updateAwareness();
    this.beginTurn();
  }

  beginTurn() {
    const u = this.current;
    if (u.quickened) u.sorcery += 2; // a Quickened Spell left unused comes back
    Object.assign(u, {
      movesLeft: u.speed,
      quickened: false,
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
      readied: false,
      readiedAttack: null,
      readiedSpell: null,
      reckless: false,
      chargeUsed: false,
      threw: false,
      tookAttack: false,
      strikes: 0,
      quickCast: false,
      leveledCast: false,
    });
    if (u.helping) this.endHelp(u); // Help lasts until the helper's next turn
    this.standUp(u);
    if (this.has(u, 'restrained')) u.movesLeft = 0;
    // Paralysed: a CON save as the turn starts shakes it off in time to act (the SRD's is at the end).
    if (this.has(u, 'paralyzed')) {
      if (this.save(u, 'con', u.conditions.paralyzed.dc).success) this.removeCondition(u, 'paralyzed', 'save');
      else this.paralyze(u);
    }
    if (this.has(u, 'stunned') || this.has(u, 'petrified')) this.paralyze(u); // no save: it wears off as this turn ends
    if (u.recklessBrute && u.alive) u.reckless = true; // a minotaur: Reckless every turn
    u.startMoves = u.movesLeft; // what a Charge measures its run from (after standing up)
    if (u.grappledBy) this.struggle(u);
    this.recharge(u);
    if (u.elite === 'regenerating' && u.alive && u.hp < u.maxHp) {
      const amount = this.heal(u, ELITE_REGEN);
      if (amount) this.emit('regen', { unit: u, amount });
    }
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
    this.coolCoals(u);
    this.emit('turnEnd', { unit: u });
    do {
      this.turn++;
      if (this.turn >= this.order.length) {
        this.turn = 0;
        this.round++;
        this.emit('round', { round: this.round });
      }
      if (this.current.dying && !this.current.dying.stable) this.deathSave(this.current);
    } while (!this.current.alive);
    this.beginTurn();
  }

  /**
   * A dying hero's turn (rules 2): a d20, 10 or more a success. Three successes and they're
   * stable; three failures and they're out for the fight. A 1 counts as two failures; a 20
   * brings them round with 1 HP, in time to take the turn.
   */
  deathSave(u) {
    const d = u.dying;
    const d20 = rollDice(1, 20, this.rng).total;
    let result = null;
    if (d20 === 20) {
      result = 'rally';
      this.heal(u, 1, u, true);
    } else {
      if (d20 >= 10) d.successes++;
      else d.failures += d20 === 1 ? 2 : 1;
      if (d.failures >= 3) {
        result = 'dead';
        u.dying = null;
      } else if (d.successes >= 3) {
        result = 'stable';
        d.stable = true;
      }
    }
    this.emit('deathSave', { unit: u, d20, successes: d.successes, failures: Math.min(3, d.failures), result });
  }

  /**
   * End what `caster` is concentrating on (rules 2): Hex or Hunter's Mark, Shield of Faith,
   * Greater Invisibility, or Fear's frightened foes. `cause`: 'switch' (another such spell),
   * 'damage' (a failed CON save) or 'fell'. Returns the units whose tags changed.
   */
  endConcentration(caster, cause, save = null) {
    const id = caster.concentrating;
    if (!id) return [];
    caster.concentrating = null;
    const touched = [];
    if (id === 'callLightning') caster.storm = null;
    if (caster.mark && (id === 'hex' || id === 'huntersMark')) {
      const old = this.units.find((u) => u.id === caster.mark.id);
      if (old?.marked === caster.mark.spell) { old.marked = false; touched.push(old); }
      caster.mark = null;
    }
    for (const u of this.units) {
      if (id === 'shieldOfFaith' && u.faithFrom === caster.id) { u.faithFrom = null; touched.push(u); }
      if (id === 'greaterInvisibility' && u.invisibleFrom === caster.id) { u.invisibleFrom = null; touched.push(u); }
      if (id === 'fear' && u.conditions?.frightened?.by === caster) { this.removeCondition(u, 'frightened', 'concentration'); touched.push(u); }
    }
    this.emit('concentration', { unit: caster, spell: id, cause, save, broken: true, touched });
    return touched;
  }

  /** Hurt while concentrating (rules 2): a CON save, DC 10 or half the damage, to keep it. */
  concentrationCheck(unit, damage) {
    if (!unit.concentrating || damage <= 0) return;
    const dc = Math.max(10, Math.floor(damage / 2));
    const s = this.save(unit, 'con', dc);
    const save = { stat: 'con', dc, d20: s.d20, total: s.total, success: s.success };
    if (s.success) this.emit('concentration', { unit, spell: unit.concentrating, cause: 'damage', save, broken: false, touched: [] });
    else this.endConcentration(unit, 'damage', save);
  }

  /** A dying hero healed (or rallying on a 20) is back in the fight, prone, from 0 HP. */
  revive(u, by) {
    u.dying = null;
    u.alive = true;
    u.hp = 0;
    if (this.unitAt(u.x, u.z) && this.unitAt(u.x, u.z) !== u) { // someone was shoved onto the body
      const free = this.teleportTiles(u, 2).sort((a, b) => gridDistance(u, a) - gridDistance(u, b))[0];
      if (free) Object.assign(u, { x: free.x, z: free.z });
    }
    this.addCondition(u, 'prone', { by });
    this.emit('revive', { unit: u, by });
  }

  /** Make `u` an elite with the trait `id` (one of ELITE_TRAITS). */
  makeElite(u, id) {
    u.elite = id;
    if (id === 'relentless') u.deathWard = true; // works as Death Ward does
    else if (id === 'frenzied') u.multiattack = (u.multiattack ?? 1) + 1;
    else if (id === 'swift') u.speed += 2;
    else if (id === 'warded') {
      u.ac += 2;
      u.immune = [...new Set([...(u.immune ?? []), 'frightened', 'prone', 'poisoned'])];
    }
    return u;
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
    if (target.lurks && amount > 0) target.stirred = true;
    const before = target.hp;
    if (amount > 0) this.reveal(target, 'hurt'); // caught in a blast: no hiding that
    if (amount > 0) target.turned = 0; // damage breaks Turn Undead
    // Temporary HP soak up damage first.
    const soaked = Math.min(target.tempHp ?? 0, Math.max(0, amount));
    if (soaked) target.tempHp -= soaked;
    const over = amount - soaked - target.hp; // damage past 0 HP
    target.hp = Math.max(0, target.hp - (amount - soaked));
    // Death Ward: the first blow that would drop the warded leaves them on 1 HP instead.
    if (target.hp <= 0 && target.alive && target.deathWard) {
      target.hp = 1;
      target.deathWard = false;
      const saved = this.tally(target);
      if (saved) saved.warded = (saved.warded ?? 0) + 1;
      this.emit('ward', { unit: target, source, ...(target.elite === 'relentless' && { relentless: true }) });
    }
    // Morvath's Phylactery: once a fight, the first hero who would drop stays on 1 HP.
    if (target.hp <= 0 && target.alive && target.team === 'heroes' && !target.corpse
      && this.relics.includes('phylactery') && !this.phylacteryUsed) {
      target.hp = 1;
      this.phylacteryUsed = true;
      this.emit('ward', { unit: target, source, relic: 'phylactery' });
    }
    const t = target.team === 'monsters' ? this.tally(source) : null;
    if (t) t.damage += before - target.hp; // only what landed, not overkill
    if (before > target.hp) {
      const hurt = (this.hurtBy[this.round] ??= { heroes: 0, monsters: 0 });
      hurt[target.team] = (hurt[target.team] ?? 0) + before - target.hp;
    }
    if (target.team === 'heroes' && before > target.hp) {
      const down = target.hp <= 0 && target.alive;
      // A fall also notes, for the recap's tip, whether no other hero standing was within 10 ft
      // and the conditions the hero had.
      const friends = down ? this.units.filter((u) => u.team === 'heroes' && u !== target && u.alive && !u.corpse) : [];
      this.blows.push({
        round: this.round, to: target.name, by: source?.name ?? null, byId: source?.id ?? null, kind: source?.cls ?? null, code: source?.code ?? null, how: this.cause, via: this.via,
        damage: before - target.hp, hp: target.hp, down,
        ...(down && { alone: friends.length > 0 && friends.every((u) => gridDistance(u, target) > 2), conds: CONDITIONS.filter((c) => this.has(target, c)) }),
      });
    }
    if (target.hp <= 0 && target.alive) {
      if (t) t.kills++;
      const down = this.tally(target);
      if (down) down.downed++;
      target.alive = false;
      // Rules 2: a hero at 0 HP is dying, making death saves, unless what's left of the blow
      // is as much as their HP maximum.
      const dying = this.rules >= 2 && target.team === 'heroes' && !target.corpse && over < target.maxHp;
      if (dying) target.dying = { successes: 0, failures: 0, stable: false };
      for (const u of this.units) if (u.faithFrom === target.id) u.faithFrom = null; // Shield of Faith drops
      target.spiritWeapon = null; // and a fallen cleric's spectral weapon fades
      if (target.grappling) this.letGo(target, 'fell');
      if (target.grappledBy?.grappling === target) this.letGo(target.grappledBy, 'fell');
      let unmarked = null;
      if (target.mark) { // a fallen ranger's Hunter's Mark ends
        unmarked = this.units.find((u) => u.id === target.mark.id) ?? null;
        if (unmarked?.marked === target.mark.spell) unmarked.marked = false;
        target.mark = null;
      }
      this.endConcentration(target, 'fell'); // rules 2: the rest of what they held ends too
      // Dark One's Blessing: a warlock who drops a foe gains CHA + level temporary HP.
      let blessing = null;
      if (source?.alive && source.team !== target.team && source.passives?.includes('darkOnesBlessing')) {
        const gain = Math.max(1, abilityMod(source.stats.cha) + source.level);
        if (gain > (source.tempHp ?? 0)) {
          source.tempHp = gain;
          blessing = { unit: source, tempHp: gain };
        }
      }
      this.emit('death', { unit: target, source, unmarked, blessing, ...(dying && { dying: true }), ...(this.rules >= 2 && !dying && target.team === 'heroes' && { outright: true }) });
      this.checkEnd();
    }
    if (target.alive && amount > 0) this.concentrationCheck(target, amount);
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

  heal(target, amount, source = target, rally = false) {
    if (this.has(target, 'rotting')) return 0; // mummy rot: no HP back until it wears off
    if (target.dying && amount > 0) this.revive(target, rally ? null : source);
    if (!target.alive) return 0;
    const before = target.hp;
    if (target.healTwice) amount *= 2; // a Periapt of Wound Closure
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
    const floor = this.lurking(unit) ? this.grid.lower.has(key(unit.x, unit.z)) : null;
    return (x, z) => {
      const o = this.unitAt(x, z);
      if (o && o.team !== unit.team) return false;
      if (floor !== null && this.grid.lower.has(key(x, z)) !== floor) return false; // it keeps to its floor
      if (fear && gridDistance({ x, z }, fear) < keep) return false;
      if (unit.team === 'heroes') {
        const t = this.grid.traps.get(key(x, z));
        if (t && t.revealed && !t.sprung) return false;
        if (this.fire?.length && this.burningTiles().has(key(x, z))) return false; // the party walks around coals
      }
      return true;
    };
  }

  canEndOn(unit, x, z) {
    const o = this.unitAt(x, z) ?? this.dyingAt(x, z);
    return !o || o === unit;
  }

  /** The dying hero lying on a tile, if any (rules 2: death saves). */
  dyingAt(x, z) {
    return this.units.find((u) => u.dying && u.x === x && u.z === z) ?? null;
  }

  /**
   * Rules 5: a monster that `lurks` (ghouls) keeps to its own floor of a two-floor room, waiting
   * at the stairs' foot, until a foe sets foot on that floor or it's hurt; then it's `stirred`.
   */
  lurking(unit) {
    if (!unit.lurks || unit.stirred || this.rules < 5 || !this.grid.links.size) return false;
    const below = (t) => this.grid.lower.has(key(t.x, t.z));
    if (this.enemiesOf(unit).some((e) => e.alive && below(e) === below(unit))) unit.stirred = true;
    return !unit.stirred;
  }

  reachable(unit) {
    return this.grid.flood(unit.x, unit.z, unit.movesLeft, this.passableFor(unit), this.moveCost(unit));
  }

  // --- difficult terrain (Ice Storm, shallow water) -----------------------------
  /** Keys of the tiles that are difficult terrain right now. */
  icyTiles() {
    const out = new Set();
    for (const f of this.ice ?? []) for (const k of f.tiles) out.add(k);
    return out;
  }

  /**
   * What entering a tile costs `unit` (2 on difficult ground: ice or water), or null when
   * nothing slows it: no ice or water in the room, or a flier (specters, wraiths, Ysolde) passing
   * over it. Null keeps the plain breadth-first paths, so rooms without either never change.
   */
  moveCost(unit = null) {
    const water = this.grid.water;
    if ((!this.ice?.length && !water.size) || unit?.flies) return null;
    const icy = this.icyTiles();
    return (x, z) => (icy.has(key(x, z)) || water.has(key(x, z)) ? 2 : 1);
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
   * `far` (rules 2): the tiles only a long-range shot reaches, at disadvantage.
   * `charge`: the melee tiles a charger (Tharok) can reach after a run of 2 tiles or more.
   * Monsters that haven't noticed the party, or are fleeing a Turn Undead, threaten nothing.
   */
  threatOf(monster, { ignore = null } = {}) {
    const melee = new Set();
    const ranged = new Set();
    const far = new Set();
    const charge = new Set();
    if (!monster.alive || monster.unaware || monster.turned) return { melee, ranged, far, charge };
    const ready = monster.attacks.filter((a) => !monster.spent?.[a.name]);
    const reach = Math.max(0, ...ready.filter((a) => a.reach > 1).map((a) => a.reach));
    const long = this.rules >= 2 ? Math.max(reach, ...ready.filter((a) => a.reach > 1).map(longReach)) : reach;
    if (!ready.length) return { melee, ranged, far, charge };

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
      const charger = ready.some((a) => a.reach === 1 && a.charge);
      for (const { x, z, dist } of spots) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!(dx || dz) || this.grid.isSolid(x + dx, z + dz)) continue;
            melee.add(key(x + dx, z + dz));
            if (charger && dist >= 2) charge.add(key(x + dx, z + dz));
          }
        }
      }
    }
    if (reach > 1) {
      for (let z = 0; z < this.grid.height; z++) {
        for (let x = 0; x < this.grid.width; x++) {
          if (this.grid.isSolid(x, z) || melee.has(key(x, z))) continue;
          const t = { x, z };
          const within = (r) => spots.some((p) => gridDistance(p, t) <= r && this.grid.lineOfSight(p.x, p.z, x, z));
          if (within(reach)) ranged.add(key(x, z));
          else if (long > reach && within(long)) far.add(key(x, z));
        }
      }
    }
    return { melee, ranged, far, charge };
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

  /**
   * What a readied hero sees of a foe on `at`: whether it is in reach, and whether it is in sight.
   * Taken before the foe steps on (and before a door on its way opens).
   */
  readyWatch(hero, at) {
    return { near: gridDistance(hero, at) <= 1, saw: this.grid.lineOfSight(hero.x, hero.z, at.x, at.z) };
  }

  /** A spell a hero can ready: one cast as an action at a single foe (Magic Missile, Sacred Flame…). */
  readySpellProblem(hero, id) {
    const s = SPELLS[id];
    if (!s || s.targeting !== 'enemy' || s.time !== 'action') return 'That spell can’t be readied';
    return this.spellProblem(hero, id);
  }

  /** A readied spell goes off at `target`, on the slot spent when it was readied. Uses the reaction. */
  castReadied(hero, target) {
    const { id, slot } = hero.readiedSpell;
    hero.readiedSpell = null;
    hero.reactionUsed = true;
    return this.castSpell(hero, id, target, { readied: slot });
  }

  /** The attack a hero readies: the one they picked, else their first (main weapon or cantrip). */
  readyWeapon(hero) {
    return hero.readiedAttack ?? hero.attacks[0];
  }

  /**
   * The attack a readied hero makes as `foe` steps onto `at`, or null. A melee weapon strikes a
   * foe stepping into reach; a ranged one (Fire Bolt, Eldritch Blast) a foe stepping into view
   * (`before.saw` false) within range, so one already in sight can walk on. Needs the reaction.
   */
  readyAttack(hero, foe, at, before) {
    if (!hero.readied || !hero.alive || hero.reactionUsed) return null;
    const spell = hero.readiedSpell;
    const a = spell ? null : this.readyWeapon(hero);
    const now = this.readyWatch(hero, at);
    if (a?.reach === 1 ? !now.near || before.near : !now.saw || before.saw) return null;
    const there = Object.create(foe);
    there.x = at.x;
    there.z = at.z;
    if (spell) return this.spellProblem(hero, spell.id, there, { readied: true }) ? null : spell;
    return this.attackProblem(hero, there, a, { opportunity: true }) ? null : a;
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
   *   { type: 'opportunity', result, at }  { type: 'trap', result }  { type: 'burn', result }
   *   { type: 'readied', result, at } (a readied hero's attack as the mover steps into it)
   *   { type: 'stairs', from, to, down } (down or up a stair to the room's other floor)
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
      // Readied heroes, and what they saw of the mover before this step (and before a door opens).
      const waiting = this.enemiesOf(unit).filter((h) => h.readied).map((h) => [h, this.readyWatch(h, from)]);
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
      if (gridDistance(from, to) > 1) { // a stair to the other floor: down out of sight, up at its other end
        flush(from);
        steps.push({ type: 'stairs', from: { x: from.x, z: from.z }, to: { x: to.x, z: to.z }, down: !this.grid.lower.has(key(from.x, from.z)) });
        this.emit('stairs', { unit, from, to });
        walked = [to];
      } else walked.push(to);
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
      if (this.fire?.length && !unit.flies && this.burningTiles().has(key(to.x, to.z)) && unit.burnTurn !== this.turnId()) {
        flush(to);
        unit.x = to.x;
        unit.z = to.z;
        steps.push({ type: 'burn', result: this.burn(unit) });
        if (!unit.alive || this.over) return stop(i + 1);
      }
      for (const [h, before] of waiting) {
        const atk = this.readyAttack(h, unit, to, before);
        if (!atk) continue;
        flush(to);
        unit.x = to.x;
        unit.z = to.z;
        h.readied = false;
        const result = atk === h.readiedSpell ? this.castReadied(h, unit) : this.attack(h, unit, atk, { readied: true });
        steps.push({ type: 'readied', result, at: { x: to.x, z: to.z } });
        if (!unit.alive || this.over) return stop(i + 1);
      }
    }
    flush(path[path.length - 1]);
    unit.movesLeft -= node.dist;
    unit.x = x;
    unit.z = z;
    if (unit.grappling && gridDistance(unit, unit.grappling) > 1) this.letGo(unit); // walked off
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
    this.via = 'trap';
    this.applyDamage(unit, damage, null);
    if (!success && unit.alive) {
      this.addCondition(unit, 'prone');
      result.prone = this.has(unit, 'prone'); // not if it can't be knocked down (a Warded elite)
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

  // --- braziers and burning coals ---------------------------------------------
  /** This turn, as a key: walking onto coals burns a creature once a turn. */
  turnId() {
    return `${this.round}.${this.turn}`;
  }

  /** Keys of the tiles where coals burn right now. */
  burningTiles() {
    const out = new Set();
    for (const f of this.fire ?? []) for (const k of f.tiles) out.add(k);
    return out;
  }

  /**
   * Where a brazier's coals land when `unit` tips it: the tile straight past it, away from
   * `unit`, and the two beside that one (for a push along a diagonal, the two it leans
   * between). Walls, props, chests and water are left out.
   */
  spillTiles(unit, b) {
    const dx = Math.sign(b.x - unit.x);
    const dz = Math.sign(b.z - unit.z);
    const spots = dx && dz
      ? [[dx, dz], [dx, 0], [0, dz]]
      : [[dx, dz], [dx + (dz ? 1 : 0), dz + (dx ? 1 : 0)], [dx - (dz ? 1 : 0), dz - (dx ? 1 : 0)]];
    return spots.map(([ox, oz]) => ({ x: b.x + ox, z: b.z + oz }))
      .filter((t) => !this.grid.isSolid(t.x, t.z) && !this.grid.water.has(key(t.x, t.z)));
  }

  brazierProblem(unit, x, z) {
    const b = this.grid.props.get(key(x, z));
    if (b?.kind !== 'brazier') return 'Nothing to tip over here';
    if (unit.team !== 'heroes') return 'Only heroes tip braziers';
    if (b.tipped) return 'The brazier is already on its side';
    if (gridDistance(unit, b) > 1) return 'Move next to the brazier to tip it';
    if (unit.actionUsed) return 'Action already used this turn';
    if (!this.spillTiles(unit, b).length) return 'The coals would have nowhere to land';
    return null;
  }

  /**
   * Tip a brazier over (the action): its coals spill onto the tiles past it. Anyone there makes
   * a DEX save against SPILL_DAMAGE (half on a success), and the coals burn for BURN_TURNS of
   * the tipper's turns: whoever walks onto them takes BURN_DAMAGE, once a turn.
   */
  tipBrazier(unit, x, z) {
    const problem = this.brazierProblem(unit, x, z);
    if (problem) return { ok: false, reason: problem };
    const b = this.grid.props.get(key(x, z));
    const tiles = this.spillTiles(unit, b);
    unit.actionUsed = true;
    b.tipped = true;
    b.from = { x: unit.x, z: unit.z }; // which way it fell (the board draws it so)
    this.reveal(unit, 'attack');
    (this.fire ??= []).push({ by: unit, turns: BURN_TURNS, tiles: new Set(tiles.map((t) => key(t.x, t.z))) });
    const result = { ok: true, unit, brazier: b, tiles, hits: [] };
    this.emit('brazier', result);
    this.cause = 'burning coals';
    this.via = 'fire';
    const caught = this.units.filter((u) => u.alive && !u.corpse && tiles.some((t) => t.x === u.x && t.z === u.z));
    for (const u of caught) {
      const { d20, total, success } = this.save(u, 'dex', SPILL_DC);
      const roll = rollExpr(SPILL_DAMAGE, { rng: this.rng });
      const damage = dexSaveDamage(u, success, roll.total);
      u.burnTurn = this.turnId();
      const hit = { unit: u, d20, total, dc: SPILL_DC, success, roll, damage };
      result.hits.push(hit);
      this.emit('spill', hit); // before the damage lands, so the log tells it first
      this.applyDamage(u, damage, u.team === 'monsters' ? unit : null);
    }
    this.noise(b, 4); // a crash and a roar of sparks
    this.updateAwareness();
    return result;
  }

  // --- levers and portcullises ------------------------------------------------------
  leverProblem(unit, x, z) {
    const lever = this.grid.props.get(key(x, z));
    if (lever?.kind !== 'lever') return 'No lever here';
    if (unit.team !== 'heroes') return 'Only heroes work the levers';
    if (gridDistance(unit, lever) > 1) return 'Move next to the lever to pull it';
    if (unit.interacted) return 'Already interacted with something this turn';
    if (!lever.pulled && [...this.grid.gates.values()].some((g) => this.unitAt(g.x, g.z))) {
      return 'Someone stands under the portcullis';
    }
    return null;
  }

  /**
   * Free object interaction: pull an adjacent lever, and every portcullis in the room drops (or
   * rises again). Down, its bars stop walking but not sight. The crash carries.
   */
  pullLever(unit, x, z) {
    const problem = this.leverProblem(unit, x, z);
    if (problem) return { ok: false, reason: problem };
    const lever = this.grid.props.get(key(x, z));
    unit.interacted = true;
    const down = !lever.pulled;
    for (const p of this.grid.props.values()) if (p.kind === 'lever') p.pulled = down; // they work as one
    const gates = [...this.grid.gates.values()];
    for (const g of gates) g.down = down;
    const result = { ok: true, unit, lever, gates, down };
    this.emit('lever', result);
    if (gates.length) this.noise(gates[0], 4);
    this.updateAwareness();
    return result;
  }

  /** `unit` walks onto burning coals: BURN_DAMAGE, credited to whoever tipped them. */
  burn(unit) {
    const k = key(unit.x, unit.z);
    const fire = this.fire.find((f) => f.tiles.has(k));
    unit.burnTurn = this.turnId();
    const roll = rollExpr(BURN_DAMAGE, { rng: this.rng });
    this.cause = 'burning coals';
    this.via = 'fire';
    const result = { unit, roll, damage: roll.total };
    this.emit('burn', result);
    this.applyDamage(unit, roll.total, unit.team === 'monsters' ? fire?.by ?? null : null);
    return result;
  }

  /** At the end of `unit`'s turn: coals it tipped (or a fallen tipper's) burn lower, and go out. */
  coolCoals(unit) {
    if (!this.fire?.length) return;
    const before = this.fire.length;
    for (const f of this.fire) if (f.by === unit || !f.by.alive) f.turns--;
    this.fire = this.fire.filter((f) => f.turns > 0);
    if (this.fire.length !== before) this.emit('coals', { tiles: this.burningTiles(), out: true });
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
    if (opportunity ? attacker.reactionUsed : !this.canAttack(attacker) && !this.bonusStrike(attacker, attack)) {
      if (!opportunity && attacker.strikes > 0) return 'Flurry of Blows: unarmed strikes only';
      if (!opportunity && this.bonusStrike(attacker)) return attacker.raging ? 'Frenzy: a melee weapon only' : 'Martial Arts: an unarmed strike only';
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
    const far = this.rules >= 2 ? longReach(attack) : attack.reach;
    if (d > far) return `Out of range (${d * 5} ft, ${attack.name} reaches ${far * 5} ft${far > attack.reach ? ' at long range' : ''})`;
    if (d > 1 && !this.grid.lineOfSight(attacker.x, attacker.z, target.x, target.z)) {
      const lower = this.grid.lower;
      if (lower.size && lower.has(key(attacker.x, attacker.z)) !== lower.has(key(target.x, target.z))) return 'On the other floor: take the stairs first';
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
    if (this.rules >= 2 && attack.reach > 1 && gridDistance(attacker, target) > attack.reach) dis.push('long range');
    if (target.dodging) dis.push('target is dodging');
    if (attacker.clumsyMultiattack && attacker.actionUsed && !opportunity) dis.push('second attack');
    if (this.has(attacker, 'prone')) dis.push('prone');
    if (this.has(target, 'prone')) {
      if (gridDistance(attacker, target) <= 1) adv.push('target prone');
      else dis.push('target prone');
    }
    if (this.has(attacker, 'poisoned')) dis.push('poisoned');
    if (this.has(attacker, 'mocked')) dis.push('mocked');
    if (attacker.invisibleFrom) adv.push('invisible');
    if (target.invisibleFrom) dis.push('target invisible');
    if (this.has(attacker, 'restrained')) dis.push('restrained');
    if (this.has(target, 'restrained')) adv.push('target restrained');
    if (this.has(target, 'paralyzed')) adv.push('target paralyzed');
    if (this.has(target, 'stunned')) adv.push('target stunned');
    if (this.has(target, 'petrified')) adv.push('target petrified');
    if (attacker.reckless && !opportunity && isMelee(attack) && attack.stat === 'str') adv.push('reckless');
    if (target.reckless) adv.push('target is reckless');
    const fear = this.fearSource(attacker);
    if (fear && this.inSight(attacker, fear, 99)) dis.push('frightened');
    if (attack.reach === 1 && this.isFlanking(attacker, target)) adv.push('flanking');
    if (attacker.passives.includes('packTactics') && this.allyNextTo(attacker, target)) adv.push('pack tactics');
    if (opportunity && target.passives.includes('escapeTheHorde')) dis.push('escape the horde');
    if (target.turned) adv.push('target is fleeing');
    const helper = this.helperFor(attacker, target);
    if (helper) adv.push(`help from ${helper.name}`);
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

  /** What a hit by `attacker` on `target` with `attack` would cost it in barbs (0: none). */
  barbsAgainst(attacker, target, attack) {
    return target.elite === 'barbed' && isMelee(attack) && attacker.team !== target.team ? ELITE_BARBS : 0;
  }

  /**
   * A Barbed elite hit by a melee weapon: the attacker takes ELITE_BARBS piercing damage, no
   * roll (the killing blow too). Returns { unit, target, damage } (already emitted and applied), or null.
   */
  barbs(elite, foe, attack) {
    if (!foe?.alive || !this.barbsAgainst(foe, elite, attack)) return null;
    const r = { unit: elite, target: foe, damage: ELITE_BARBS };
    this.emit('barbs', r);
    this.cause = 'barbs';
    this.via = 'melee';
    this.applyDamage(foe, r.damage, elite);
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

  /**
   * The odds of an attack before it's made, for the preview: `chance` to hit (cover counted, the
   * reactions that might turn it left out), and the damage a hit does, `min` to `max` (no crit).
   */
  attackOdds(attacker, target, attack) {
    const mods = this.attackMods(attacker, target, attack);
    const cover = this.coverBonus(attacker, target);
    const critOn = isWeapon(attack) && attacker.critRange ? attacker.critRange : 20;
    const chance = hitChance(this.toHitBonus(attacker, attack), this.acOf(target) + cover, mods.mode, critOn);
    const dmg = attack.damage ? diceRange(attack.damage, this.damageBonus(attacker, attack)) : { min: 0, max: 0 };
    if (attack.damage && this.canSneak(attacker, target, mods)) {
      const n = attacker.sneakDice ?? 2;
      dmg.min += n;
      dmg.max += n * 6;
    }
    return { chance, cover, mods, ...dmg };
  }

  /** The chance `unit` fails a `stat` save against `dc`, for the preview (luck and inspiration left out). */
  saveOdds(unit, stat, dc) {
    if ((stat === 'str' || stat === 'dex') && this.has(unit, 'paralyzed')) return 1;
    const bonus = abilityMod(unit.stats[stat]) + (unit.saveBonus ?? 0) + this.auraBonus(unit);
    return failChance(bonus, dc, stat === 'dex' && this.has(unit, 'restrained') ? 'dis' : 'normal');
  }

  canSneak(attacker, target, mods) {
    if (!attacker.passives.includes('sneakAttack') || attacker.sneakUsed) return false;
    return mods.mode === 'adv' || (mods.mode === 'normal' && this.allyNextTo(attacker, target));
  }

  /** A monk's technique: `target` saves or gains `condition`. Returns the save. */
  monkSave(target, stat, dc, condition, turns = Infinity) {
    const s = this.save(target, stat, dc);
    const immune = target.immune?.includes(condition);
    if (!s.success && !immune) this.addCondition(target, condition, { turns });
    return { stat, dc, d20: s.d20, total: s.total, success: s.success || !!immune, condition };
  }

  attack(attacker, target, attack, { opportunity = false, ambush = false, readied = false } = {}) {
    const problem = this.attackProblem(attacker, target, attack, { opportunity: opportunity || readied });
    if (problem) return { ok: false, reason: problem };

    const mods = this.attackMods(attacker, target, attack, { opportunity, ambush });
    this.useHelp(attacker, target);
    this.reveal(attacker, 'attack');
    let bonus = null; // a bonus-action strike: 'flurry' | 'martial' | 'frenzy'
    if (opportunity || readied) {
      attacker.reactionUsed = true;
    } else if (!attacker.actionUsed) {
      attacker.actionUsed = true;
      attacker.tookAttack = true;
      attacker.attacksLeft = this.followUps(attacker, attack);
    } else if (attacker.attacksLeft > 0) {
      attacker.attacksLeft--;
    } else {
      bonus = this.bonusStrike(attacker, attack);
      if (bonus === 'flurry') attacker.strikes--;
      else attacker.bonusUsed = true;
    }
    if (attack.recharge) (attacker.spent ??= {})[attack.name] = true;

    if (this.has(attacker, 'mocked')) this.removeCondition(attacker, 'mocked', 'used');
    const { d20, rolls } = this.rollD20(mods.mode);
    const toHit = this.toHitBonus(attacker, attack);
    let total = d20 + toHit;
    // Improved Critical: a fighter's weapon crits on 19 too.
    let crit = d20 >= (isWeapon(attack) && attacker.critRange ? attacker.critRange : 20);
    const fumble = d20 === 1;
    if (crit && this.tally(attacker)) this.tally(attacker).crits++;
    const cover = this.coverBonus(attacker, target);
    const ac = this.acOf(target) + cover;
    let hit = crit || (!fumble && total >= ac);

    // Bardic Inspiration turns a near miss; Cutting Words a near hit.
    let inspired = null;
    let cutting = null;
    if (!hit && !fumble) {
      inspired = this.useInspiration(attacker, ac - total);
      if (inspired) {
        total += inspired.total;
        hit = total >= ac;
      }
    } else if (hit && !crit) {
      cutting = this.cuttingWords(attacker, total - ac + 1);
      if (cutting) {
        total -= cutting.total;
        hit = total >= ac;
      }
    }

    // Shield: a reaction that turns a would-be hit into a miss.
    let shielded = false;
    let shieldSlot = null;
    if (hit && !crit && this.canShield(target) && total < ac + 5) {
      shieldSlot = this.castShield(target);
      shielded = true;
      hit = false;
    }
    // Paralysed: any hit from within 5 ft is a critical hit.
    if (hit && !crit && this.has(target, 'paralyzed') && gridDistance(attacker, target) <= 1) {
      crit = true;
      if (this.tally(attacker)) this.tally(attacker).crits++;
    }

    let damage = 0;
    let damageRoll = null;
    let sneak = null;
    let smite = null;
    let mark = null;
    let colossus = null;
    let strike = null;
    let charge = null;
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
      // Charge (a minotaur's gore): the first hit on a turn it moved 2 tiles or more first.
      if (attack.charge && !opportunity && !readied && attacker === this.current && !attacker.chargeUsed && (attacker.startMoves ?? 0) - attacker.movesLeft >= 2) {
        attacker.chargeUsed = true;
        charge = rollExpr(attack.charge.damage, { crit, rng: this.rng });
        damage += charge.total;
      }
    }

    // Rage: half damage from weapon attacks.
    let resisted = false;
    if (hit && damage && target.raging && isWeapon(attack)) {
      resisted = true;
      damage = Math.floor(damage / 2);
    }
    // Deflect Missiles: a monk's reaction takes 1d10 + DEX + level off a ranged weapon hit.
    let deflect = null;
    if (hit && damage && isWeapon(attack) && attack.reach > 1 && target.alive && target.passives.includes('deflectMissiles') && !target.reactionUsed) {
      target.reactionUsed = true;
      deflect = rollExpr(`1d10+${abilityMod(target.stats.dex) + target.level}`, { rng: this.rng });
      damage = Math.max(0, damage - deflect.total);
    }
    // Uncanny Dodge: a reaction that halves an attack's damage. Saved for hits that matter.
    let uncanny = false;
    if (hit && damage && this.canUncannyDodge(target) && (damage >= 6 || damage >= target.hp)) {
      target.reactionUsed = true;
      uncanny = true;
      damage = Math.floor(damage / 2);
    }

    const result = {
      ok: true, kind: 'attack', attacker, target, attack, opportunity, readied,
      d20, rolls, mods, toHit, total, ac: this.acOf(target) + cover, cover,
      hit, crit, fumble, shielded, inspired, cutting, damage, damageRoll, sneak, smite, mark, colossus, strike, uncanny, rider: null, rebuke: null, barbs: null,
      bonus, resisted, deflect, stun: null, topple: null, charge, knock: null, thrown: null,
    };
    this.emit('attack', result);
    if (shielded) {
      this.emit('spell', { ok: true, kind: 'spell', id: 'shield', spell: SPELLS.shield, caster: target, slot: shieldSlot });
    }
    if (hit) {
      this.cause = attack.name;
      this.via = attack.reach === 1 ? 'melee' : 'ranged';
      if (damage) this.applyDamage(target, damage, attacker);
      result.rider = this.applyRider(attacker, target, attack.rider);
      if (result.rider) this.emit('rider', result);
      // A charge's gore knocks the target down unless it makes a STR save.
      if (charge && target.alive && !this.has(target, 'prone')) {
        result.knock = this.monkSave(target, 'str', attack.charge.dc, 'prone');
        // Rules 4: and it throws them back 5 ft (no second save).
        if (this.rules >= 4 && !result.knock.success && target.alive) result.thrown = this.throwBack(attacker, target, null);
      }
      // Rules 4: a gargoyle's claws throw a foe back once a turn, unless it makes a STR save.
      if (this.rules >= 4 && attack.throws && !result.thrown && target.alive && !attacker.threw && gridDistance(attacker, target) <= 1) {
        attacker.threw = true;
        result.thrown = this.throwBack(attacker, target, attack.throws.dc);
      }
      if (result.thrown) this.emit('throw', { attacker, target, ...result.thrown });
      // A monk's hit: Stunning Strike (armed, 1 ki) and Open Hand's push to the floor.
      const dc = 8 + attacker.prof + abilityMod(attacker.stats.wis);
      if (attacker.stunArmed && isMelee(attack) && attacker.ki > 0 && target.alive) {
        attacker.stunArmed = false;
        attacker.ki--;
        result.stun = this.monkSave(target, 'con', dc, 'stunned', 1);
      }
      if (bonus === 'flurry' && attacker.passives.includes('openHand') && target.alive && !this.has(target, 'prone')) {
        result.topple = this.monkSave(target, 'dex', dc, 'prone');
      }
      if (result.stun || result.topple || result.knock) this.emit('technique', result);
      if (damage) result.rebuke = this.rebuke(target, attacker);
      result.barbs = this.barbs(target, attacker, attack);
    }
    this.alert(target, 'hurt'); // a miss gives you away too
    this.noise(attacker);
    return result;
  }

  // --- giving a potion ---------------------------------------------------------
  /** Why `unit` can't pour a potion into `target`, or null. */
  feedProblem(unit, target) {
    if (this.over) return 'The battle is over';
    if (unit.team !== 'heroes') return 'Only heroes carry potions';
    if (!(unit.potions > 0)) return 'No potions left';
    if (unit.actionUsed) return 'Action already used this turn';
    if (unit.turned) return 'Turned: can only flee';
    if (!(target?.alive || target?.dying) || target.team !== unit.team || target === unit) return 'Choose an ally next to you';
    if (gridDistance(unit, target) > 1) return 'Must stand next to them';
    if (target.hp >= target.maxHp) return `${target.name} is at full HP`;
    if (this.has(target, 'rotting')) return `${target.name} is rotting: no healing takes`;
    return null;
  }

  /** Pour one of `unit`'s potions into an ally next to it: 2d4 + 2 HP. Uses the action. */
  feedPotion(unit, target) {
    const problem = this.feedProblem(unit, target);
    if (problem) return { ok: false, reason: problem };
    unit.actionUsed = true;
    unit.potions--;
    this.drunk++;
    const roll = rollExpr('2d4+2', { rng: this.rng });
    const healed = this.heal(target, roll.total, unit);
    const result = { ok: true, kind: 'feed', unit, target, roll, healed };
    this.emit('feed', result);
    return result;
  }

  // --- grappling ------------------------------------------------------------
  /** Grapple: like Shove, it takes one attack of the Attack action. */
  grappleProblem(attacker, target) {
    if (this.over) return 'The battle is over';
    if (attacker.team !== 'heroes') return 'Only heroes grapple';
    if (!this.canAttack(attacker)) return 'Action already used this turn';
    if (attacker.actionUsed && attacker.extraAttackWith) return `Only ${attacker.extraAttackWith} fires again`;
    if (attacker.turned) return 'Turned: can only flee';
    if (!target?.alive || target.team === attacker.team) return 'Choose an enemy';
    if (target.hidden) return `${target.name} is hidden: Search to find it`;
    if (gridDistance(attacker, target) > 1) return 'Must stand next to them';
    if (target.huge) return `${target.name} is too big to grapple`;
    if (target.grappledBy === attacker) return `Already holding ${target.name}`;
    return null;
  }

  /**
   * Athletics against the target's best of STR or DEX (the target wins ties). Won: its speed is 0
   * while the grappler stays next to it. Returns { ok, kind: 'grapple', attacker, target, roll, resist, success }.
   */
  grapple(attacker, target) {
    const problem = this.grappleProblem(attacker, target);
    if (problem) return { ok: false, reason: problem };
    this.reveal(attacker, 'attack');
    if (!attacker.actionUsed) {
      attacker.actionUsed = true;
      attacker.attacksLeft = this.followUps(attacker, null);
    } else {
      attacker.attacksLeft--;
    }
    const { roll, resist } = this.contest(attacker, target);
    const result = { ok: true, kind: 'grapple', attacker, target, roll, resist, success: roll.total > resist.total };
    this.emit('grapple', result);
    this.alert(target, 'hurt');
    if (result.success) {
      if (attacker.grappling) this.letGo(attacker); // one hold at a time
      if (target.grappledBy) this.letGo(target.grappledBy);
      attacker.grappling = target;
      target.grappledBy = attacker;
      target.movesLeft = 0;
    }
    this.noise(attacker);
    this.updateAwareness();
    return result;
  }

  /** Athletics (d20 + STR + proficiency) against the defender's best of STR or DEX. */
  contest(attacker, defender) {
    const a = this.rollD20(this.has(attacker, 'poisoned') ? 'dis' : 'normal');
    const b = rollDice(1, 20, this.rng).total;
    const bonus = this.shoveBonus(attacker);
    const resistBonus = this.shoveResist(defender);
    return {
      roll: { d20: a.d20, rolls: a.rolls, bonus, total: a.d20 + bonus },
      resist: { d20: b, bonus: resistBonus, total: b + resistBonus },
    };
  }

  /** Whether `unit`'s grappler still holds it: alive, and next to it. */
  held(unit) {
    const g = unit.grappledBy;
    return !!g && g.alive && g.grappling === unit && gridDistance(g, unit) <= 1;
  }

  /** `grappler` lets go (it moved off, fell, or its hold was broken). */
  letGo(grappler, why = 'let go') {
    const t = grappler.grappling;
    if (!t) return;
    grappler.grappling = null;
    if (t.grappledBy === grappler) t.grappledBy = null;
    this.emit('grappleEnd', { unit: t, by: grappler, why });
  }

  /**
   * Start of a grappled creature's turn: free if the hold has lapsed, else it tries to break
   * free at once (its best of STR or DEX against the grappler's Athletics), without spending
   * its action. Still held: speed 0 this turn.
   */
  struggle(u) {
    const g = u.grappledBy;
    if (!this.held(u)) {
      if (g?.grappling === u) this.letGo(g, 'gone');
      else u.grappledBy = null;
      return;
    }
    const d20 = rollDice(1, 20, this.rng).total;
    const bonus = this.shoveResist(u);
    const hold = rollDice(1, 20, this.rng).total + this.shoveBonus(g);
    const result = { unit: u, by: g, d20, bonus, total: d20 + bonus, hold, success: d20 + bonus > hold };
    this.emit('struggle', result);
    if (result.success) this.letGo(g, 'broken');
    else u.movesLeft = 0;
  }

  // --- the Help action -------------------------------------------------------
  /** Why `unit` can't Help against `target` (a foe next to it), or null. */
  helpProblem(unit, target) {
    if (this.over) return 'The battle is over';
    if (unit.team !== 'heroes') return 'Only heroes help';
    if (unit.actionUsed) return 'Action already used this turn';
    if (unit.turned) return 'Turned: can only flee';
    if (!target?.alive || target.team === unit.team) return 'Choose an enemy';
    if (target.hidden) return `${target.name} is hidden: Search to find it`;
    if (gridDistance(unit, target) > 1) return 'Must stand next to them';
    if (target.helped === unit) return `Already distracting ${target.name}`;
    return null;
  }

  /**
   * Help: distract `target`, so the next attack an ally of `unit` makes against it, before
   * `unit`'s next turn, has advantage. Uses the action; rolls nothing.
   */
  help(unit, target) {
    const problem = this.helpProblem(unit, target);
    if (problem) return { ok: false, reason: problem };
    unit.actionUsed = true;
    if (unit.helping) this.endHelp(unit);
    if (target.helped) this.endHelp(target.helped); // one distraction at a time: the latest
    unit.helping = target;
    target.helped = unit;
    const result = { ok: true, kind: 'help', unit, target };
    this.emit('help', result);
    return result;
  }

  /** The hero whose Help gives `attacker` advantage against `target`, or null. */
  helperFor(attacker, target) {
    const h = target.helped;
    return h && h !== attacker && h.alive && h.team === attacker.team ? h : null;
  }

  /** An attack roll against a helped foe uses the Help up. */
  useHelp(attacker, target) {
    if (this.helperFor(attacker, target)) this.endHelp(target.helped);
  }

  endHelp(helper) {
    if (helper.helping?.helped === helper) helper.helping.helped = null;
    helper.helping = null;
  }

  /**
   * Shove: knock an adjacent enemy prone, or (rules 3, `push`) push it 5 ft straight back.
   * Takes one attack of the Attack action.
   */
  shoveProblem(attacker, target, push = false) {
    if (this.over) return 'The battle is over';
    if (push && this.rules < 3) return 'This fight began before pushing';
    if (!this.canAttack(attacker)) return 'Action already used this turn';
    if (attacker.actionUsed && attacker.extraAttackWith) return `Only ${attacker.extraAttackWith} fires again`;
    if (attacker.turned) return 'Turned: can only flee';
    if (!target?.alive || target.team === attacker.team) return 'Choose an enemy';
    if (gridDistance(attacker, target) > 1) return 'Must stand next to them';
    if (target.huge) return `${target.name} is too big to shove`;
    if (push) return this.pushTo(attacker, target).why ?? null;
    if (this.has(target, 'prone')) return `${target.name} is already prone`;
    if (target.immune?.includes('prone')) return `${target.name} can’t be knocked prone`; // a Warded elite
    return null;
  }

  /**
   * Where a push from `attacker` sends `target`: the tile straight behind it, { x, z, fall }
   * (fall: a chasm), or { why } when there's no room: a wall, a door, a prop or someone there.
   * Fliers and the surefooted don't go over a chasm's edge.
   */
  pushTo(attacker, target) {
    const g = this.grid;
    const dx = Math.sign(target.x - attacker.x);
    const dz = Math.sign(target.z - attacker.z);
    const x = target.x + dx;
    const z = target.z + dz;
    const down = this.stairwell(target, x, z);
    if (down) return down;
    const fall = g.chasms.has(key(x, z));
    const blocked = (bx, bz) => g.isSolid(bx, bz) && !g.chasms.has(key(bx, bz));
    if (!fall && (blocked(x, z) || g.closedDoorAt(x, z))) return { why: `No room to push ${target.name} back` };
    if (dx && dz && (blocked(target.x + dx, target.z) || blocked(target.x, target.z + dz))) return { why: `No room to push ${target.name} back` };
    if (this.unitAt(x, z)) return { why: `Someone stands behind ${target.name}` };
    if (fall && target.flies) return { why: `${target.name} would only fly` };
    if (fall && target.surefooted) return { why: `${target.name} won’t be pushed off the edge` };
    return { x, z, fall };
  }

  /**
   * Rules 5: a push into a stairwell (onto a stair down, or from one) sends `target` tumbling
   * down to the stair at its foot: { x, z, fall: false, tumble: { x, z } } (the stair it fell
   * down), or null when that's not it: older rules, a flier, no stair, or someone at the foot.
   */
  stairwell(target, x, z) {
    const g = this.grid;
    if (this.rules < 5 || !g.links.size || target.flies) return null;
    const top = [[x, z], [target.x, target.z]].find(([sx, sz]) => g.links.has(key(sx, sz)) && !g.lower.has(key(sx, sz)));
    if (!top) return null;
    if (this.unitAt(top[0], top[1]) && this.unitAt(top[0], top[1]) !== target) return null;
    const foot = g.links.get(key(top[0], top[1]));
    if (this.unitAt(foot.x, foot.z)) return null;
    return { x: foot.x, z: foot.z, fall: false, tumble: { x: top[0], z: top[1] } };
  }

  /**
   * Athletics (d20 + STR + proficiency) against the target's best of STR or DEX.
   * The target wins ties. Returns { ok, kind: 'shove', attacker, target, roll, resist, success },
   * and with `push`, `push: { from, to, fall, burn }` when it wins.
   */
  shove(attacker, target, push = false) {
    const problem = this.shoveProblem(attacker, target, push);
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
    const to = push && result.success ? this.pushTo(attacker, target) : null;
    if (to) result.push = { from: { x: target.x, z: target.z }, to: { x: to.x, z: to.z }, fall: to.fall, burn: null, ...(to.tumble && { stair: to.tumble }) };
    this.emit('shove', result);
    this.alert(target, 'hurt');
    if (to) this.pushed(target, attacker, to, result.push);
    else if (result.success) this.addCondition(target, 'prone', { by: attacker });
    this.noise(attacker);
    this.updateAwareness();
    return result;
  }

  /** `target` is pushed onto `to`: a hold that's now out of reach lets go; coals burn; a chasm is the end. */
  pushed(target, by, to, out) {
    target.x = to.x;
    target.z = to.z;
    if (target.grappling && gridDistance(target, target.grappling) > 1) this.letGo(target, 'pushed');
    if (target.grappledBy && !this.held(target)) this.letGo(target.grappledBy, 'pushed');
    if (to.fall) this.fall(target, by);
    else if (to.tumble) out.tumble = this.tumble(target, by);
    else if (this.fire?.length && !target.flies && this.burningTiles().has(key(to.x, to.z))) out.burn = this.burn(target);
  }

  /** Rules 5: down a flight of stone steps: 1d6 bludgeoning, and prone at the bottom. */
  tumble(target, by) {
    const roll = rollExpr(TUMBLE_DAMAGE, { rng: this.rng });
    this.cause = 'a fall down the stairs';
    this.via = 'fall';
    const result = { unit: target, roll, damage: roll.total, lands: roll.total < target.hp + (target.tempHp ?? 0) };
    target.tumbled = (target.tumbled ?? 0) + 1; // for play stats; no dice
    this.emit('tumble', result);
    this.applyDamage(target, roll.total, by);
    if (target.alive && target.hp > 0) this.addCondition(target, 'prone', { by });
    return result;
  }

  /** Over the edge: no saving throw, no Death Ward, and no body left to raise. */
  fall(target, by) {
    target.deathWard = false;
    target.fell = true;
    target.raised = true;
    this.cause = 'a fall';
    this.via = 'fall';
    this.applyDamage(target, target.hp + (target.tempHp ?? 0) + target.maxHp, by);
  }

  /**
   * Rules 4: a monster's blow throws `target` 5 ft straight back: a STR save against `dc`
   * resists it (`dc` null: already failed). Nowhere to go, and it stays put. A hero sent over
   * a chasm's edge makes a DEX save (DC 10) to catch the lip, and lies prone there instead.
   * Returns { stat, dc, d20, total, success, push, edge }.
   */
  throwBack(attacker, target, dc) {
    const s = dc ? this.save(target, 'str', dc) : null;
    const out = { stat: 'str', dc, d20: s?.d20 ?? null, total: s?.total ?? null, success: !!s?.success, push: null, edge: null };
    if (out.success || target.huge) return out;
    const to = this.pushTo(attacker, target);
    if (to.why) return out;
    if (to.fall && target.team === 'heroes') {
      const e = this.save(target, 'dex', EDGE_DC);
      out.edge = { stat: 'dex', dc: EDGE_DC, d20: e.d20, total: e.total, success: e.success };
      if (e.success) {
        this.addCondition(target, 'prone', { by: attacker });
        return out;
      }
    }
    out.push = { from: { x: target.x, z: target.z }, to: { x: to.x, z: to.z }, fall: to.fall, burn: null, ...(to.tumble && { stair: to.tumble }) };
    this.pushed(target, attacker, to, out.push);
    return out;
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
    if (unit.team === 'heroes') list.push('ready'); // last, so the number keys before it stay put
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
    if (id === 'rage' && unit.raging) return 'Already raging';
    if (id === 'reckless') {
      if (unit.reckless) return 'Already reckless this turn';
      if (!this.canAttack(unit)) return 'No attacks left this turn';
    }
    if (id === 'quicken' && !unit.quickened) {
      if (unit.sorcery < 2) return 'Not enough sorcery points (2)';
      if (unit.bonusUsed) return 'Bonus action already used this turn';
      if (unit.actionUsed) return 'Action already used this turn';
    }
    if (['flurry', 'patientDefense', 'stepOfTheWind'].includes(id) && !(unit.ki > 0)) return 'No ki left this fight';
    if (id === 'flurry' && !unit.tookAttack) return 'Take the Attack action first';
    if (id === 'stunningStrike' && !unit.stunArmed && !(unit.ki > 0)) return 'No ki left this fight';
    if (id === 'wholeness') {
      if (unit.wholenessUsed) return 'Already used this fight';
      if (unit.hp >= unit.maxHp) return 'Already at full HP';
    }
    if (id === 'ready' && unit.readied) return 'Already readied';
    if ((id === 'secondWind' || id === 'potion' || id === 'wholeness') && this.has(unit, 'rotting')) return 'Rotting: you can’t regain HP';
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

  /**
   * `attack`: for Ready, the index of the attack to hold (the first when left out); `spell`, a
   * spell to hold instead, whose slot is spent now (as in the SRD) and lost if nothing comes.
   */
  doAction(unit, id, { attack, spell } = {}) {
    const problem = this.actionProblem(unit, id) ?? (id === 'ready' && spell ? this.readySpellProblem(unit, spell) : null);
    if (problem) return { ok: false, reason: problem };
    const def = ACTIONS[id];
    if (def.time === 'action') unit.actionUsed = true;
    else if (def.time === 'bonus') unit.bonusUsed = true; // 'free': a choice, not an action

    const result = { ok: true, kind: 'action', unit, id, name: def.name };
    switch (id) {
      case 'dash':
      case 'cunningDash':
      case 'aggressive':
        if (!this.has(unit, 'restrained') && !this.held(unit)) unit.movesLeft += unit.speed; // speed 0 doubled is 0
        break;
      case 'dodge':
        unit.dodging = true;
        break;
      case 'ready':
        unit.readied = true;
        if (spell) {
          unit.readiedSpell = { id: spell, slot: this.spendSlot(unit, SPELLS[spell].level) };
          result.spell = SPELLS[spell];
          break;
        }
        unit.readiedAttack = unit.attacks[attack] ?? null;
        result.attack = this.readyWeapon(unit);
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
      case 'rage':
        unit.raging = true;
        // Mindless Rage: no fear while raging.
        if (unit.passives.includes('mindlessRage')) {
          unit.immune = [...(unit.immune ?? []), 'frightened'];
          if (this.has(unit, 'frightened')) this.removeCondition(unit, 'frightened', 'rage');
        }
        break;
      case 'reckless':
        unit.reckless = true;
        break;
      case 'quicken':
        unit.quickened = !unit.quickened;
        unit.sorcery += unit.quickened ? -2 : 2;
        result.armed = unit.quickened;
        result.left = unit.sorcery;
        break;
      case 'stunningStrike':
        unit.stunArmed = !unit.stunArmed;
        result.armed = unit.stunArmed;
        break;
      case 'flurry':
        unit.ki--;
        unit.strikes = 2;
        result.left = unit.ki;
        break;
      case 'patientDefense':
        unit.ki--;
        unit.dodging = true;
        result.left = unit.ki;
        break;
      case 'stepOfTheWind':
        unit.ki--;
        unit.disengaged = true;
        if (!this.has(unit, 'restrained') && !this.held(unit)) unit.movesLeft += unit.speed;
        result.left = unit.ki;
        break;
      case 'wholeness':
        unit.wholenessUsed = true;
        result.healed = this.heal(unit, 3 * unit.level);
        break;
      case 'potion':
        unit.potions--;
        this.drunk++;
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
}
