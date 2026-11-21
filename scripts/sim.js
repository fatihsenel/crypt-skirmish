// Headless balance check: plays rooms many times with a simple hero policy (heals, Fireball,
// Magic Missile, potions, then the monster AI's tactics) and prints win rates.
//   node scripts/sim.js [runs] [act2|act3|act4|full]
// Runs are split over worker threads, one per core; JOBS=n sets how many (JOBS=1: one thread).
// Env: SEED, DIFFICULTY (story|normal|hard), PALADIN=1 (a Paladin in the Fighter's slot),
// RANGER=1 (a Ranger in the Rogue's), WARLOCK=1 (a Warlock in the Wizard's).
// Rooms default to the act-two route; "route" chains catacombs → vault|well → barrow the
// way the campaign does (short rests between fights, a long rest at the well).

import { Game } from '../src/game/combat.js';
import { nextMonsterStep } from '../src/game/ai.js';
import { areaTiles, lineTiles } from '../src/game/abilities.js';
import { levelById } from '../src/game/maps.js';
import { newCampaign, completeFight, takeRest, heroUnit, equip, equipProblem, HERO_CODES, runDifficulty, newGamePlus, fightRelics } from '../src/game/campaign.js';
import { ITEMS, cleanRelics } from '../src/game/items.js';
import { seeded } from '../src/game/dice.js';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

const CLASSES = {
  ...(process.env.PALADIN && { F: 'P' }), ...(process.env.RANGER && { R: 'A' }), ...(process.env.WARLOCK && { W: 'K' }),
};
/** TIER=N plays every fight at New Game+ tier N (0 by default). */
const TIER = Math.max(0, Math.floor(Number(process.env.TIER) || 0));
/** RELICS=horn,veil gives the party exactly those relics in every fight (RELICS= for none); by default they're earned from the bosses. */
const FORCED = process.env.RELICS === undefined ? null : cleanRelics(process.env.RELICS.split(','));
const withRelics = (state) => (FORCED && state ? { ...state, relics: FORCED } : state);
/** What a won party typically carries back down in New Game+: one good item each. */
const HEIRLOOMS = { F: 'weaponPlus2', W: 'bracersDefense', R: 'weaponPlus1', C: 'amuletHealth' };

function freshCampaign() {
  const start = withRelics(newCampaign(process.env.DIFFICULTY ?? 'normal', {}, CLASSES));
  if (!TIER) return start;
  const won = { ...start, done: true, tier: TIER - 1 };
  for (const code of HERO_CODES) won.party[code] = { ...won.party[code], items: [HEIRLOOMS[code]] };
  return withRelics(newGamePlus(won, HEIRLOOMS));
}

/** A rested party at `level`. */
function partyAt(level) {
  const c = freshCampaign();
  for (const code of HERO_CODES) {
    const u = heroUnit(code, { cls: c.party[code].cls, level });
    Object.assign(c.party[code], { level, hp: u.maxHp, slots: { ...u.slotMax } });
    if (u.layOnHandsMax) c.party[code].layOnHands = u.layOnHandsMax;
  }
  return c;
}

function apply(game, unit, step) {
  switch (step.type) {
    case 'attack': return game.attack(unit, step.target, step.attack);
    case 'move': return game.move(unit, step.x, step.z);
    case 'spell': return game.castSpell(unit, step.id, step.target);
    default: return game.doAction(unit, step.id);
  }
}

function foesIn(game, u, p) {
  const tiles = new Set(areaTiles(game.grid, p, 4).map((t) => `${t.x},${t.z}`));
  return game.living().filter((t) => t.team !== u.team && !t.unaware && tiles.has(`${t.x},${t.z}`)).length;
}

/** Where a 20-ft burst (Fireball, or `id`: Ice Storm) catches the most foes, or null below two. */
function bestFireball(game, u, id = 'fireball') {
  if (game.spellProblem(u, id)) return null;
  let best = null;
  for (let z = u.z - 30; z <= u.z + 30; z++) {
    for (let x = u.x - 30; x <= u.x + 30; x++) {
      const p = { x, z };
      if (game.spellProblem(u, id, p)) continue;
      const tiles = new Set(areaTiles(game.grid, p, 4).map((t) => `${t.x},${t.z}`));
      const inside = game.living().filter((t) => tiles.has(`${t.x},${t.z}`));
      const foes = inside.filter((t) => t.team !== u.team && !t.unaware).length;
      const friends = inside.filter((t) => t.team === u.team).length;
      if ((friends && !u.sculpt) || foes < 2) continue;
      if (!best || foes > best.foes) best = { p, foes };
    }
  }
  return best?.p ?? null;
}

/** The Lightning Bolt aim (toward a foe) that catches the most foes, or null below two. */
function bestBolt(game, u) {
  if (game.spellProblem(u, 'lightningBolt')) return null;
  let best = null;
  for (const aim of game.knownFoes(u).filter((e) => !e.unaware)) {
    const caught = lineTiles(game.grid, u, aim, 20).map((t) => game.unitAt(t.x, t.z)).filter((v) => v?.alive);
    const foes = caught.filter((t) => t.team !== u.team && !t.unaware).length;
    const friends = caught.filter((t) => t.team === u.team).length;
    if ((friends && !u.sculpt) || foes < 2) continue;
    if (!best || foes > best.foes) best = { p: { x: aim.x, z: aim.z }, foes };
  }
  return best;
}

/** Spells and potions first; whatever is left of the turn goes to the AI. */
function heroOpening(game, u) {
  // Loot: open a chest within reach (half the time walk over to one first), as players do.
  const chests = [...game.grid.chests.values()].filter((c) => !c.opened);
  if (chests.length && !game.isAdjacentToEnemy(u)) {
    const near = chests.find((c) => !game.chestProblem(u, c.x, c.z));
    if (!near && game.rng() < 0.5) {
      const spot = game.destinations(u).find((d) => chests.some((c) => Math.max(Math.abs(c.x - d.x), Math.abs(c.z - d.z)) === 1));
      if (spot) game.move(u, spot.x, spot.z);
    }
    const c = chests.find((c) => !game.chestProblem(u, c.x, c.z));
    if (c && u.alive) {
      const r = game.openChest(u, c.x, c.z);
      if (r.mimic) game.sprung = true;
    }
    if (!u.alive || game.over) return;
  }
  const heroes = game.living('heroes');
  const hurt = heroes.filter((h) => h.hp < h.maxHp / 2).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
  if (u.code === 'C') {
    if (hurt.length >= 2 && !game.spellProblem(u, 'massHealingWord')) game.castSpell(u, 'massHealingWord');
    else for (const h of hurt) if (!game.spellProblem(u, 'healingWord', h)) { game.castSpell(u, 'healingWord', h); break; }
    if (game.turnTargets(u).length >= 3 && !game.actionProblem(u, 'turnUndead')) game.doAction(u, 'turnUndead');
    // Spiritual Weapon with the bonus action left: free once summoned; summoned with a
    // 2nd-level slot when the fight is worth it (keeping 3rd-level slots for healing).
    const foes = game.knownFoes(u).filter((e) => !e.unaware);
    const worth = u.spiritWeapon || (u.slots[2] > 0 && (foes.length >= 2 || foes.some((e) => (e.cr ?? 0) >= 1)));
    if (worth && !u.bonusUsed) {
      const t = game.spellTargets(u, 'spiritualWeapon').filter((e) => !e.unaware).sort((a, b) => a.hp - b.hp)[0];
      if (t) game.castSpell(u, 'spiritualWeapon', t);
    }
    // Death Ward on the front line (or itself) once something deadly is in sight.
    if (!u.actionUsed && !heroes.some((h) => h.deathWard) && foes.some((e) => (e.cr ?? 0) >= 3)) {
      const front = heroes.filter((h) => h.alive && ['F', 'P'].includes(h.code) && !game.spellProblem(u, 'deathWard', h))[0];
      const who = front ?? (!game.spellProblem(u, 'deathWard', u) ? u : null);
      if (who) game.castSpell(u, 'deathWard', who);
    }
  }
  if (u.code === 'W' && !u.actionUsed) {
    // Fireball from 3rd-level slots; a 4th-level slot goes on Ice Storm, not a bigger Fireball.
    const p = (u.slots[3] ?? 0) > 0 ? bestFireball(game, u) : null;
    const hail = p ? null : bestFireball(game, u, 'iceStorm');
    const bolt = bestBolt(game, u);
    if (bolt && (!p || bolt.foes > foesIn(game, u, p))) game.castSpell(u, 'lightningBolt', bolt.p);
    else if (p) game.castSpell(u, 'fireball', p);
    else if (hail) game.castSpell(u, 'iceStorm', hail);
    else if ((u.slots[1] ?? 0) + (u.slots[2] ?? 0) > 0) {
      const t = game.spellTargets(u, 'magicMissile').filter((e) => !e.unaware).sort((a, b) => a.hp - b.hp)[0];
      if (t) game.castSpell(u, 'magicMissile', t);
    }
  }
  if (u.code === 'F' && u.hp < u.maxHp / 2 && !game.actionProblem(u, 'secondWind')) game.doAction(u, 'secondWind');
  if (u.code === 'P') paladinOpening(game, u, heroes);
  if (u.code === 'A') rangerOpening(game, u);
  if (u.code === 'K') warlockOpening(game, u);
  if (!u.actionUsed && u.hp < u.maxHp * 0.35 && u.potions > 0 && !game.actionProblem(u, 'potion')) game.doAction(u, 'potion');
}

/**
 * Shield of Faith on whoever stands in front, Lay on Hands on a badly hurt neighbour (or
 * itself), and Divine Smite against undead and bosses, or anything while slots are plenty.
 */
function paladinOpening(game, u, heroes) {
  if (!heroes.some((h) => h.faithFrom === u.id) && game.knownFoes(u).some((e) => !e.unaware)) {
    if (!game.spellProblem(u, 'shieldOfFaith', u)) game.castSpell(u, 'shieldOfFaith', u);
  }
  const low = heroes.filter((h) => h.hp < h.maxHp * 0.4 && !game.spellProblem(u, 'layOnHands', h))
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  if (low) game.castSpell(u, 'layOnHands', low);
  const slots = Object.values(u.slots).reduce((a, b) => a + b, 0);
  const worthy = game.knownFoes(u).some((e) => !e.unaware && gridDistanceTo(u, e) <= u.speed + 1 && (e.undead || (e.cr ?? 0) >= 1));
  if (!u.smiteArmed && slots > 0 && (worthy || slots >= 3)) game.toggleSmite(u);
}

/** Hunter's Mark on the toughest foe in sight, when the fight looks worth a slot. */
function rangerOpening(game, u) {
  const foes = game.spellTargets(u, 'huntersMark').filter((e) => !e.unaware);
  const markedAlive = u.mark && game.units.find((e) => e.id === u.mark.id)?.alive;
  if (!markedAlive && foes.length && (foes.length >= 2 || foes.some((e) => (e.cr ?? 0) >= 1))) {
    game.castSpell(u, 'huntersMark', foes.sort((a, b) => b.hp - a.hp)[0]);
  }
}

/**
 * Two pact slots a room: Fireball on a crowd, Hex on a boss, Scorching Ray at a tough foe,
 * and whatever is left armed as Hellish Rebuke once enemies close in. Eldritch Blast is the
 * AI's ranged attack.
 */
function warlockOpening(game, u) {
  const foes = game.knownFoes(u).filter((e) => !e.unaware);
  if (!foes.length) return;
  if (!u.actionUsed) {
    const p = bestFireball(game, u);
    if (p) game.castSpell(u, 'fireball', p);
  }
  const hexed = u.mark && game.units.find((e) => e.id === u.mark.id)?.alive;
  const boss = game.spellTargets(u, 'hex').filter((e) => !e.unaware && (e.cr ?? 0) >= 2).sort((a, b) => b.hp - a.hp)[0];
  if (!hexed && boss && !u.bonusUsed) game.castSpell(u, 'hex', boss);
  if (!u.actionUsed) {
    const tough = game.spellTargets(u, 'scorchingRay').filter((e) => !e.unaware && e.hp >= 15).sort((a, b) => b.hp - a.hp)[0];
    if (tough) game.castSpell(u, 'scorchingRay', tough);
  }
  const close = foes.some((e) => gridDistanceTo(u, e) <= e.speed + 1);
  if (close && !u.rebukeArmed && !game.rebukeProblem(u)) game.toggleRebuke(u);
}

const gridDistanceTo =(a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

function playTurn(game, u) {
  if (u.team === 'heroes') heroOpening(game, u);
  const memo = {};
  for (let i = 0; i < 12 && !game.over && u.alive; i++) {
    const step = nextMonsterStep(game, u, memo);
    if (step.type === 'end') break;
    apply(game, u, step);
  }
}

/** One fight. Returns { won, rounds, downed, state }. */
export function fight(levelId, campaign, rng) {
  const game = new Game(levelById(levelId), { party: campaign.party, rng, difficulty: runDifficulty(campaign.difficulty, TIER), relics: fightRelics(campaign) });
  game.start();
  let turns = 0;
  while (!game.over && turns++ < 600) {
    playTurn(game, game.current);
    if (!game.over) game.endTurn();
  }
  const heroes = game.units.filter((u) => u.team === 'heroes' && !u.corpse);
  const downed = heroes.filter((u) => !u.alive).length;
  const hpLeft = heroes.reduce((s, u) => s + Math.max(0, u.hp), 0) / heroes.reduce((s, u) => s + u.maxHp, 0);
  const won = game.over === 'victory';
  return { won, rounds: game.round, downed, hpLeft, sprung: !!game.sprung, game, state: won ? withRelics(completeFight(campaign, levelId, game).state) : null };
}

/** How often the mimic's ambush bite drops a fresh hero of each class. */
function mimicCheck(level, runs) {
  const out = {};
  for (const code of HERO_CODES) {
    let drops = 0;
    let lost = 0;
    for (let i = 0; i < runs; i++) {
      const game = new Game(levelById('vault'), { party: partyAt(level).party });
      game.start();
      const hero = game.units.find((u) => u.slot === code && u.team === 'heroes');
      const chest = [...game.grid.chests.values()].find((c) => c.mimic);
      Object.assign(hero, { x: chest.x - 1, z: chest.z });
      hero.interacted = false;
      game.springMimic(hero, chest);
      if (!hero.alive) drops++;
      lost += 1 - Math.max(0, hero.hp) / hero.maxHp;
    }
    out[code] = `${pct(drops, runs)} (avg ${pct(lost, runs)} of HP)`;
  }
  return out;
}

const pct = (n, d) => `${Math.round((100 * n) / d)}%`;

/** Hand pack gear to whoever it suits: weapons to the fighter then the rogue, the rest to the casters. */
function equipAll(state) {
  const order = {
    weaponPlus1: ['F', 'R'], weaponPlus2: ['R', 'F', 'C'], ringProtection: ['W', 'C', 'R'], cloakProtection: ['W', 'C', 'R'],
    bracersDefense: ['W'], gauntletsOgre: ['F', 'C'], amuletHealth: ['W', 'R', 'C'], periaptPoison: ['F', 'R', 'C'],
  };
  for (let i = state.pack.length - 1; i >= 0; i--) {
    const id = state.pack[i];
    if (ITEMS[id]?.kind !== 'gear') continue;
    const who = (order[id] ?? HERO_CODES).find((c) => !equipProblem(state, i, c));
    if (who) state = equip(state, i, who);
  }
  return state;
}

const ACT_ONE = [['crypt', 'warren', 'chapel', 'sanctum'], ['crypt', 'ossuary', 'chapel', 'sanctum'], ['crypt', 'warren', 'ossuary', 'sanctum']];
const ACT_TWO = [
  ['catacombs', 'vault', 'barrow'], ['catacombs', 'well', 'barrow'],
  ['catacombs', 'vault', 'larder', 'barrow'], ['catacombs', 'well', 'larder', 'barrow'],
];
const ACT_THREE = [['nest', 'gallery', 'throne'], ['nest', 'shrine', 'throne']];
const ACT_FOUR = [['halls', 'armory', 'tomb'], ['halls', 'hearth', 'tomb']];
const REST = new Set(['chapel', 'well', 'shrine', 'hearth']);
/** "vault", "well+larder", ...: the part of an act-two route between the catacombs and the barrow. */
const via = (two) => two.slice(1, -1).join('+');

/** Play a whole campaign along `route`; returns per-room results until the party falls. */
function campaign(route, rng, start = freshCampaign()) {
  let state = start;
  const out = [];
  for (const id of route) {
    if (REST.has(id)) {
      state = takeRest(state, id);
      continue;
    }
    const r = fight(id, state, rng);
    r.level = state.party.F.level;
    out.push({ id, ...r });
    if (!r.won) break;
    state = equipAll(r.state);
    out.at(-1).after = state;
  }
  return out;
}

// --- modes ------------------------------------------------------------------------------
// Each mode plays its share of the runs and returns plain data ({ stats, whole, ... }), so
// worker threads can split the runs between them and the main thread can merge and print.

/** A room result without its game and state: small enough to pass between threads. */
const lite = (r) => ({ won: r.won, rounds: r.rounds, downed: r.downed, hpLeft: r.hpLeft, sprung: r.sprung, level: r.level });
const add = (stats, key, r) => (stats[key] ??= []).push(lite(r));

/** `size` parties that won `last`, played from scratch along `routes(tries, found)`. */
function pool(size, routes, last, rng) {
  const out = [];
  let tries = 0;
  while (out.length < size) {
    const res = campaign(routes(tries++, out.length), rng);
    if (res.at(-1).id === last && res.at(-1).won) out.push(res.at(-1).after);
  }
  return out;
}

const MODES = {
  /** Acts one and two, every route pair, from a fresh party. */
  campaign(runs, rng) {
    const stats = {};
    const whole = {};
    for (const one of ACT_ONE) {
      for (const two of ACT_TWO) {
        const route = [...one, ...two];
        const name = `${one[1]}${one[2] === 'chapel' ? '' : '+' + one[2]} / ${via(two)}`;
        let won = 0;
        for (let i = 0; i < runs; i++) {
          const res = campaign(route, rng);
          for (const r of res) add(stats, ['vault', 'larder', 'barrow'].includes(r.id) ? `${r.id} (${via(two)})` : r.id, r);
          if (res.length === route.filter((x) => !REST.has(x)).length && res.at(-1).won) won++;
        }
        whole[name] = [won, runs];
      }
    }
    return { stats, whole };
  },

  /** Act two only, from a pool of real end-of-act-one parties (faster for tuning). */
  act2(runs, rng, poolSize = 60) {
    const parties = pool(poolSize, (_t, n) => ACT_ONE[n % 3], 'sanctum', rng);
    const stats = {};
    const whole = {};
    for (const two of ACT_TWO) {
      let won = 0;
      for (let i = 0; i < runs; i++) {
        const res = campaign(two, rng, parties[i % parties.length]);
        for (const r of res) add(stats, r.id === 'catacombs' ? r.id : `${r.id} (${via(two)})`, r);
        if (res.at(-1).id === 'barrow' && res.at(-1).won) won++;
      }
      whole[via(two)] = [won, runs];
    }
    return { stats, whole };
  },

  /** Act three only, from a pool of real parties that won the barrow (rested by its act break). */
  act3(runs, rng, poolSize = 40) {
    const parties = pool(poolSize, (t) => [...ACT_ONE[t % 3], ...ACT_TWO[t % 4]], 'barrow', rng);
    const stats = {};
    const whole = {};
    for (const three of ACT_THREE) {
      let won = 0;
      for (let i = 0; i < runs; i++) {
        const res = campaign(three, rng, parties[i % parties.length]);
        for (const r of res) add(stats, r.id === 'nest' ? r.id : `${r.id} (${three[1]})`, r);
        if (res.at(-1).id === 'throne' && res.at(-1).won) won++;
      }
      whole[three[1]] = [won, runs];
    }
    return { stats, whole };
  },

  /** Act four only, from a pool of real parties that won the throne (rested by its act break). */
  act4(runs, rng, poolSize = 40) {
    const parties = pool(poolSize, (t) => [...ACT_ONE[t % 3], ...ACT_TWO[t % 4], ...ACT_THREE[t % 2]], 'throne', rng);
    const stats = {};
    const whole = {};
    for (const four of ACT_FOUR) {
      let won = 0;
      for (let i = 0; i < runs; i++) {
        const res = campaign(four, rng, parties[i % parties.length]);
        for (const r of res) add(stats, r.id === 'halls' ? r.id : `${r.id} (${four[1]})`, r);
        if (res.at(-1).id === 'tomb' && res.at(-1).won) won++;
      }
      whole[four[1]] = [won, runs];
    }
    const levels = parties.map((p) => p.party.F.level);
    return { stats, whole, levels, xp: parties.map((p) => p.xp) };
  },

  /** Whole runs, first room to the tomb, cycling through every route; where do they end? */
  full(runs, rng, _pool, offset = 0) {
    const ends = {};
    let won = 0;
    for (let i = offset; i < offset + runs; i++) {
      const route = [...ACT_ONE[i % 3], ...ACT_TWO[i % 4], ...ACT_THREE[i % 2], ...ACT_FOUR[Math.floor(i / 2) % 2]];
      const last = campaign(route, rng).at(-1);
      if (last.id === 'tomb' && last.won) won++;
      else ends[last.id] = (ends[last.id] ?? 0) + 1;
    }
    return { stats: {}, whole: { all: [won, runs] }, ends };
  },
};

/** Fold the workers' results together. */
function merge(parts) {
  const out = { stats: {}, whole: {}, ends: {}, levels: [], xp: [] };
  for (const p of parts) {
    for (const [k, list] of Object.entries(p.stats)) (out.stats[k] ??= []).push(...list);
    for (const [k, [won, runs]] of Object.entries(p.whole)) {
      const w = (out.whole[k] ??= [0, 0]);
      w[0] += won;
      w[1] += runs;
    }
    for (const [k, n] of Object.entries(p.ends ?? {})) out.ends[k] = (out.ends[k] ?? 0) + n;
    out.levels.push(...(p.levels ?? []));
    out.xp.push(...(p.xp ?? []));
  }
  return out;
}

const rates = (whole) => Object.fromEntries(Object.entries(whole).map(([k, [won, runs]]) => [k, pct(won, runs)]));
const levelsOf = (list) => [...new Set(list.map((r) => r.level))].join('/');

function print(mode, data, runs, seed, jobs) {
  const how = `seed ${seed}${TIER ? `, NG+${TIER}` : ''}${FORCED ? `, relics: ${FORCED.join('+') || 'none'}` : ''}${jobs > 1 ? `, ${jobs} threads` : ''}`;
  if (mode === 'full') {
    const [won, total] = data.whole.all;
    console.log(`Whole campaigns, ${total} runs (${process.env.DIFFICULTY ?? 'normal'}, ${how})`);
    console.log(`  won ${pct(won, total)}; lost at`, Object.fromEntries(Object.entries(data.ends).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, pct(v, total)])));
    return;
  }
  if (mode === 'campaign') {
    console.log(`${runs} campaigns per route (${how})`);
    for (const [room, list] of Object.entries(data.stats)) {
      report(`${room} L${levelsOf(list)}`, list);
      if (room.startsWith('vault')) console.log(`    mimic sprung in ${pct(list.filter((r) => r.sprung).length, list.length)} of vault fights`);
    }
    console.log('  whole campaign won:', rates(data.whole));
    return;
  }
  const act = { act2: 'two', act3: 'three', act4: 'four' }[mode];
  if (mode === 'act4') {
    console.log(`  pool: ${data.levels.length} parties, levels ${[...new Set(data.levels)].sort().join('/')}, XP ${Math.min(...data.xp)}–${Math.max(...data.xp)}`);
  }
  console.log(`Act ${act}, ${runs} runs per route (${how})`);
  for (const [room, list] of Object.entries(data.stats)) {
    report(mode === 'act2' ? room : `${room} L${levelsOf(list)}`, list);
    if (mode === 'act2' && room.startsWith('vault')) {
      const sprung = list.filter((r) => r.sprung);
      console.log(`    mimic sprung in ${pct(sprung.length, list.length)}; vault lost after it sprang ${pct(sprung.filter((r) => !r.won).length, sprung.length)}`);
    }
  }
  console.log(`  act ${act} won via`, rates(data.whole));
}

function report(name, results) {
  const wins = results.filter((r) => r.won);
  const avg = (f, list = results) => (list.reduce((s, r) => s + f(r), 0) / Math.max(1, list.length)).toFixed(1);
  console.log(`  ${name.padEnd(20)} win ${pct(wins.length, results.length).padStart(4)}  rounds ${avg((r) => r.rounds)}  heroes down ${avg((r) => r.downed)}  hp left ${pct(wins.reduce((s, r) => s + r.hpLeft, 0), wins.length)}`);
}

const POOLS = { act2: 60, act3: 40, act4: 40 };

/** Split `runs` over `jobs` worker threads (each with its own seed and a share of the pool). */
async function inThreads(mode, runs, seed, jobs) {
  const shares = Array.from({ length: jobs }, (_, i) => Math.floor(runs / jobs) + (i < runs % jobs ? 1 : 0));
  let offset = 0;
  const parts = await Promise.all(shares.map((share, i) => {
    const job = { mode, runs: share, seed: seed + 7919 * (i + 1), pool: Math.max(4, Math.ceil((POOLS[mode] ?? 0) / jobs)), offset };
    offset += share;
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL(import.meta.url), { workerData: job, env: process.env });
      w.once('message', resolve);
      w.once('error', reject);
    });
  }));
  return merge(parts);
}

async function main() {
  const runs = Number(process.argv[2]) || 500;
  const mode = ['act2', 'act3', 'act4', 'full'].includes(process.argv[3]) ? process.argv[3] : 'campaign';
  const seed = Number(process.env.SEED) || 1;
  // JOBS=1 plays everything on this thread with one dice stream (the numbers from before threads).
  const jobs = Math.max(1, Math.min(Number(process.env.JOBS) || availableParallelism(), runs));
  const data = jobs > 1 ? await inThreads(mode, runs, seed, jobs) : merge([MODES[mode](runs, seeded(seed))]);
  print(mode, data, runs, seed, jobs);
  if (mode === 'campaign') console.log('  mimic ambush on a fresh L5 hero:', JSON.stringify(mimicCheck(5, 300)));
}

if (!isMainThread) {
  const { mode, runs, seed, pool: size, offset } = workerData;
  parentPort.postMessage(MODES[mode](runs, seeded(seed), size, offset));
} else if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
