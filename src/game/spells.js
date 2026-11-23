// Spells for the rules engine: slots, targets, what stops a cast, and casting each spell.
// Game (combat.js) extends Spellcasting, so these run as its own methods: \`this\` is the
// game, with its dice, saves, damage and conditions.

import { rollExpr, abilityMod } from './dice.js';
import { gridDistance } from './grid.js';
import { createUnit } from './units.js';
import { SPELLS, coneTiles, lineTiles, areaTiles, directionTo } from './abilities.js';

/** How far a fight is heard, in tiles (combat.js has the rest of the senses); a 3rd-level spell is louder. */
export const NOISE = 5;

/** Evasion (a rogue's): no damage on a made DEX save for half, half on a failed one. */
const hasEvasion = (unit) => !!unit.passives?.includes('evasion');
export const dexSaveDamage = (unit, success, damage) => (hasEvasion(unit)
  ? (success ? 0 : Math.floor(damage / 2))
  : (success ? Math.floor(damage / 2) : damage));

export class Spellcasting {
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

  /** Saves (DEX unless `stat` says) for everyone caught in an area: half damage on a success. */
  areaSaves(victims, dc, damage, stat = 'dex') {
    return victims.map((v) => {
      const s = this.save(v, stat, dc);
      if (stat !== 'dex') return { ...s, damage: s.success ? Math.floor(damage / 2) : damage, evasion: false };
      return { ...s, damage: dexSaveDamage(v, s.success, damage), evasion: hasEvasion(v) };
    });
  }

  /** Who a Thunderwave from `caster` catches: everyone next to it, friend or foe. */
  thunderVictims(caster) {
    return this.units.filter((u) => u.alive && u !== caster && gridDistance(u, caster) <= SPELLS.thunderwave.radius);
  }

  /** Elemental Affinity: a draconic sorcerer adds CHA to a fire spell's damage. */
  affinity(caster, roll) {
    if (!caster.passives?.includes('elementalAffinity')) return roll;
    const mod = abilityMod(caster.stats.cha);
    return { ...roll, bonus: (roll.bonus ?? 0) + mod, total: roll.total + mod, affinity: mod };
  }

  /** Mass Healing Word: up to six hurt allies (or self) within range and sight. */
  massHealTargets(caster) {
    const s = SPELLS.massHealingWord;
    return this.units.filter((t) => t.team === caster.team && (t.alive || t.dying))
      .filter((t) => t.hp < t.maxHp && !this.has(t, 'rotting') && gridDistance(caster, t) <= s.range
        && this.grid.lineOfSight(caster.x, caster.z, t.x, t.z))
      .slice(0, 6);
  }

  /** Valid targets for a unit-targeted spell ('enemy' / 'ally' / 'corpse'). */
  spellTargets(caster, id) {
    const s = SPELLS[id];
    const pool = s.targeting === 'enemy' ? this.enemiesOf(caster)
      : s.targeting === 'ally' ? this.units.filter((u) => u.team === caster.team && (u.alive || u.dying))
        : s.targeting === 'corpse' ? this.corpses() : [];
    return pool.filter((t) => !this.spellProblem(caster, id, t));
  }

  /** `readied`: a readied spell going off, its action and slot already spent. */
  spellProblem(caster, id, target, { readied = false } = {}) {
    const s = SPELLS[id];
    if (!s || !caster.spells.includes(id)) return 'Unknown spell';
    if (this.over) return 'The battle is over';
    if (s.time === 'reaction') return 'Cast automatically as a reaction';
    if (caster.turned) return 'Turned: can only flee';
    const quick = !readied && s.time === 'action' && caster.quickened; // Quickened Spell: a bonus action
    if (!readied && s.time === 'action' && !quick && caster.actionUsed) return 'Action already used this turn';
    if (!readied && (s.time === 'bonus' || quick) && caster.bonusUsed) return 'Bonus action already used this turn';
    if (!readied && s.time === 'action' && s.level > 0 && caster.quickCast) return 'After a Quickened spell, your action can cast only a cantrip';
    if (quick && s.level > 0 && caster.leveledCast) return 'You cast a spell this turn: a Quickened one must be a cantrip';
    const free = readied || this.freeRecast(caster, id);
    const again = id === 'spiritualWeapon' && free; // strikes again for free
    if (!free && !this.hasSlot(caster, s.level)) return `No level ${s.level}+ spell slots left`;
    if (s.pool && !(caster.layOnHands > 0)) return 'Your healing pool is spent';
    if (s.uses && !(caster.inspiration > 0)) return 'No Bardic Inspiration left this fight';
    if (s.targeting === 'self') {
      if (id === 'thunderwave' && !this.thunderVictims(caster).length) return 'No one within 5 ft';
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
        if (!(target.alive || (target.dying && (s.heal || s.pool))) || target.team !== caster.team) return 'Choose an ally (or yourself)';
        if ((s.heal || s.pool) && target.hp >= target.maxHp) return `${target.name} is unhurt`;
        if ((s.heal || s.pool) && this.has(target, 'rotting')) return `${target.name} is rotting: no healing takes`;
        if (id === 'shieldOfFaith' && target.faithFrom === caster.id) return `${target.name} already has it`;
        if (id === 'deathWard' && target.deathWard) return `${target.name} is already warded`;
        if (id === 'bardicInspiration' && target === caster) return 'Inspire an ally, not yourself';
        if (id === 'bardicInspiration' && target.inspired) return `${target.name} is already inspired`;
        if (id === 'greaterInvisibility' && target.invisibleFrom === caster.id) return `${target.name} is already invisible`;
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
    return (id === 'spiritualWeapon' && !!caster.spiritWeapon) || (id === 'callLightning' && !!caster.storm);
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
      this.useHelp(caster, t);
      const { d20, rolls } = this.rollD20(mods.mode);
      const cover = this.coverBonus(caster, t, (u) => hpOf(u) <= 0);
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

  /** `readied`: the slot a readied spell was given (see castReadied); its action is long spent. */
  castSpell(caster, id, target, { readied = null } = {}) {
    const problem = this.spellProblem(caster, id, target, { readied: readied !== null });
    if (problem) return { ok: false, reason: problem };
    const spell = SPELLS[id];
    this.cause = spell.name;
    this.via = 'spell';
    const quick = readied === null && spell.time === 'action' && caster.quickened;
    if (readied === null) { // a readied spell's action went on Ready
      if (spell.time === 'action' && !quick) caster.actionUsed = true;
      else caster.bonusUsed = true;
    }
    if (quick) {
      caster.quickened = false;
      caster.quickCast = true;
    } else if (spell.time === 'action' && spell.level > 0) caster.leveledCast = true;
    const again = readied === null && this.freeRecast(caster, id);
    const slot = readied ?? (again ? (caster.storm ?? caster.spiritWeapon).slot : this.spendSlot(caster, spell.level));
    const upcast = Math.max(0, slot - spell.level);
    this.reveal(caster, 'spell');
    const focus = this.rules >= 2 && spell.concentration; // rules 2: one concentration spell at a time
    // A new mark moves the old one itself (the case below clears its tag).
    const moving = ['hex', 'huntersMark', 'callLightning'].includes(id) && caster.concentrating === id;
    if (focus && !moving) this.endConcentration(caster, 'switch');
    const result = { ok: true, kind: 'spell', id, spell, caster, slot: again ? 0 : slot, ...(readied !== null && { readied: true }), ...(quick && { quickened: true }) };

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
        const roll = this.affinity(caster, rollExpr(`${3 + upcast}d6`, { rng: this.rng }));
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
        const roll = this.affinity(caster, rollExpr(`${8 + upcast}d6`, { rng: this.rng }));
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
      case 'shatter': {
        const tiles = areaTiles(this.grid, target, spell.radius);
        const roll = rollExpr(`${3 + upcast}d8`, { rng: this.rng });
        const dc = this.spellDC(caster);
        const victims = this.blastVictims(caster, tiles);
        Object.assign(result, { center: { x: target.x, z: target.z }, tiles, roll, dc });
        result.saves = this.areaSaves(victims, dc, roll.total, 'con');
        this.emit('spell', result);
        for (const s of result.saves) this.applyDamage(s.unit, s.damage, caster);
        break;
      }
      case 'thunderwave': {
        const roll = rollExpr(`${2 + upcast}d8`, { rng: this.rng });
        const dc = this.spellDC(caster);
        const victims = this.thunderVictims(caster);
        Object.assign(result, { center: { x: caster.x, z: caster.z }, tiles: victims.map((v) => ({ x: v.x, z: v.z })), roll, dc });
        result.saves = this.areaSaves(victims, dc, roll.total, 'con');
        this.emit('spell', result);
        for (const s of result.saves) {
          this.applyDamage(s.unit, s.damage, caster);
          if (!s.success && s.unit.alive) this.addCondition(s.unit, 'prone', { by: caster });
          this.alert(s.unit, 'hurt');
        }
        break;
      }
      case 'entangle': {
        const tiles = areaTiles(this.grid, target, spell.radius);
        const dc = this.spellDC(caster);
        const victims = this.blastVictims(caster, tiles);
        Object.assign(result, { center: { x: target.x, z: target.z }, tiles, dc });
        result.saves = victims.map((v) => this.save(v, 'str', dc));
        this.emit('spell', result);
        for (const s of result.saves) {
          if (!s.success) this.addCondition(s.unit, 'restrained', { turns: spell.turns, by: caster });
          this.alert(s.unit, 'hurt');
        }
        break;
      }
      case 'callLightning': {
        const tiles = areaTiles(this.grid, target, spell.radius);
        const roll = rollExpr(`${3 + upcast}d10`, { rng: this.rng });
        const dc = this.spellDC(caster);
        const victims = this.blastVictims(caster, tiles);
        caster.storm = { slot };
        Object.assign(result, { center: { x: target.x, z: target.z }, tiles, roll, dc, again });
        result.saves = this.areaSaves(victims, dc, roll.total);
        this.emit('spell', result);
        for (const s of result.saves) this.applyDamage(s.unit, s.damage, caster);
        break;
      }
      case 'fear': {
        // Foes only: the party knows the bard's tricks.
        const dir = directionTo(caster, target);
        const tiles = coneTiles(this.grid, caster, dir, spell.range);
        const dc = this.spellDC(caster);
        const victims = this.blastVictims(caster, tiles).filter((v) => v.team !== caster.team);
        Object.assign(result, { dir, tiles, dc });
        result.saves = victims.map((v) => this.save(v, 'wis', dc));
        this.emit('spell', result);
        for (const s of result.saves) {
          if (!s.success) this.addCondition(s.unit, 'frightened', { turns: spell.turns, by: caster, dc });
          this.alert(s.unit, 'hurt');
        }
        break;
      }
      case 'viciousMockery': {
        const dc = this.spellDC(caster);
        const { d20, total, success } = this.save(target, 'wis', dc);
        const roll = rollExpr(spell.damage, { rng: this.rng });
        Object.assign(result, { target, dc, save: { d20, total, success }, roll, damage: success ? 0 : roll.total });
        this.emit('spell', result);
        if (result.damage) {
          this.applyDamage(target, result.damage, caster);
          this.addCondition(target, 'mocked', { turns: 1, by: caster });
        }
        break;
      }
      case 'bardicInspiration': {
        caster.inspiration--;
        target.inspired = { die: caster.inspirationDie, by: caster };
        Object.assign(result, { target, die: caster.inspirationDie, left: caster.inspiration });
        this.emit('spell', result);
        break;
      }
      case 'greaterInvisibility': {
        // One at a time: casting it again moves it.
        for (const u of this.units) if (u.invisibleFrom === caster.id) u.invisibleFrom = null;
        target.invisibleFrom = caster.id;
        result.target = target;
        this.emit('spell', result);
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
    if (focus && (id !== 'fear' || result.saves.some((s) => !s.success))) caster.concentrating = id;
    if (id !== 'mistyStep') {
      if (result.target?.team && result.target.team !== caster.team) this.alert(result.target, 'hurt');
      this.noise(caster, spell.level >= 3 ? NOISE + 3 : NOISE);
    }
    this.updateAwareness();
    return result;
  }
}
