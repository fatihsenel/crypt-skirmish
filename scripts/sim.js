// Headless balance check: plays rooms many times with a simple hero policy (heals, Fireball,
// Magic Missile, potions, then the monster AI's tactics) and prints win rates.
//   node scripts/sim.js [runs] [act2|act3|act4]
// Env: SEED, DIFFICULTY (story|normal|hard), PALADIN=1 (a Paladin in the Fighter's slot),
// RANGER=1 (a Ranger in the Rogue's), WARLOCK=1 (a Warlock in the Wizard's).
// Rooms default to the act-two route; "route" chains catacombs → vault|well → barrow the
// way the campaign does (short rests between fights, a long rest at the well).

import { Game } from '../src/game/combat.js';
import { nextMonsterStep } from '../src/game/ai.js';
import { areaTiles, lineTiles } from '../src/game/abilities.js';
import { levelById } from '../src/game/maps.js';
import { newCampaign, completeFight, takeRest, heroUnit, equip, equipProblem, HERO_CODES, DIFFICULTIES } from '../src/game/campaign.js';
import { ITEMS } from '../src/game/items.js';
import { seeded } from '../src/game/dice.js';

const CLASSES = {
  ...(process.env.PALADIN && { F: 'P' }), ...(process.env.RANGER && { R: 'A' }), ...(process.env.WARLOCK && { W: 'K' }),
};
const freshCampaign = () => newCampaign(process.env.DIFFICULTY ?? 'normal', {}, CLASSES);

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

function bestFireball(game, u) {
  if (game.spellProblem(u, 'fireball')) return null;
  let best = null;
  for (let z = u.z - 30; z <= u.z + 30; z++) {
    for (let x = u.x - 30; x <= u.x + 30; x++) {
      const p = { x, z };
      if (game.spellProblem(u, 'fireball', p)) continue;
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
    const p = bestFireball(game, u);
    const bolt = bestBolt(game, u);
    if (bolt && (!p || bolt.foes > foesIn(game, u, p))) game.castSpell(u, 'lightningBolt', bolt.p);
    else if (p) game.castSpell(u, 'fireball', p);
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
  const game = new Game(levelById(levelId), { party: campaign.party, rng, difficulty: DIFFICULTIES[campaign.difficulty] });
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
  return { won, rounds: game.round, downed, hpLeft, sprung: !!game.sprung, game, state: won ? completeFight(campaign, levelId, game).state : null };
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
  const order = { weaponPlus1: ['F', 'R'], weaponPlus2: ['R', 'F', 'C'], ringProtection: ['W', 'C', 'R'], cloakProtection: ['W', 'C', 'R'] };
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

/** Act two only, from a pool of real end-of-act-one parties (faster for tuning). */
function actTwo(runs, rng) {
  const pool = [];
  while (pool.length < 60) {
    const res = campaign(ACT_ONE[pool.length % 3], rng);
    if (res.at(-1).id === 'sanctum' && res.at(-1).won) pool.push(res.at(-1).after);
  }
  const stats = {};
  const whole = {};
  for (const two of ACT_TWO) {
    let won = 0;
    for (let i = 0; i < runs; i++) {
      const res = campaign(two, rng, pool[i % pool.length]);
      for (const r of res) (stats[r.id === 'catacombs' ? r.id : `${r.id} (${via(two)})`] ??= []).push(r);
      if (res.at(-1).id === 'barrow' && res.at(-1).won) won++;
    }
    whole[via(two)] = pct(won, runs);
  }
  console.log(`Act two, ${runs} runs per route from 60 act-one parties`);
  for (const [room, list] of Object.entries(stats)) {
    report(room, list);
    if (room.startsWith('vault')) console.log(`    mimic sprung in ${pct(list.filter((r) => r.sprung).length, list.length)}; vault lost after it sprang ${pct(list.filter((r) => r.sprung && !r.won).length, list.filter((r) => r.sprung).length)}`);
  }
  console.log('  act two won via', whole);
}

/** Act three only, from a pool of real parties that won the barrow (rested by its act break). */
function actThree(runs, rng) {
  const pool = [];
  let tries = 0;
  while (pool.length < 40) {
    const route = [...ACT_ONE[tries % 3], ...ACT_TWO[tries % 4]];
    tries++;
    const res = campaign(route, rng);
    if (res.at(-1).id === 'barrow' && res.at(-1).won) pool.push(res.at(-1).after);
  }
  const stats = {};
  const whole = {};
  for (const three of ACT_THREE) {
    let won = 0;
    for (let i = 0; i < runs; i++) {
      const res = campaign(three, rng, pool[i % pool.length]);
      for (const r of res) (stats[r.id === 'nest' ? r.id : `${r.id} (${three[1]})`] ??= []).push(r);
      if (res.at(-1).id === 'throne' && res.at(-1).won) won++;
    }
    whole[three[1]] = pct(won, runs);
  }
  console.log(`Act three, ${runs} runs per route from 40 parties that won act two`);
  for (const [room, list] of Object.entries(stats)) report(`${room} L${[...new Set(list.map((r) => r.level))].join('/')}`, list);
  console.log('  act three won via', whole);
}

/** Act four only, from a pool of real parties that won the throne (rested by its act break). */
function actFour(runs, rng) {
  const pool = [];
  let tries = 0;
  while (pool.length < 40) {
    const route = [...ACT_ONE[tries % 3], ...ACT_TWO[tries % 4], ...ACT_THREE[tries % 2]];
    tries++;
    const res = campaign(route, rng);
    if (res.at(-1).id === 'throne' && res.at(-1).won) pool.push(res.at(-1).after);
  }
  const levels = pool.map((p) => p.party.F.level);
  console.log(`  pool: ${pool.length} parties, levels ${[...new Set(levels)].sort().join('/')}, XP ${Math.min(...pool.map((p) => p.xp))}–${Math.max(...pool.map((p) => p.xp))}`);
  const stats = {};
  const whole = {};
  for (const four of ACT_FOUR) {
    let won = 0;
    for (let i = 0; i < runs; i++) {
      const res = campaign(four, rng, pool[i % pool.length]);
      for (const r of res) (stats[r.id === 'halls' ? r.id : `${r.id} (${four[1]})`] ??= []).push(r);
      if (res.at(-1).id === 'tomb' && res.at(-1).won) won++;
    }
    whole[four[1]] = pct(won, runs);
  }
  console.log(`Act four, ${runs} runs per route from 40 parties that won act three`);
  for (const [room, list] of Object.entries(stats)) report(`${room} L${[...new Set(list.map((r) => r.level))].join('/')}`, list);
  console.log('  act four won via', whole);
}

function report(name, results) {
  const wins = results.filter((r) => r.won);
  const avg = (f, list = results) => (list.reduce((s, r) => s + f(r), 0) / Math.max(1, list.length)).toFixed(1);
  console.log(`  ${name.padEnd(20)} win ${pct(wins.length, results.length).padStart(4)}  rounds ${avg((r) => r.rounds)}  heroes down ${avg((r) => r.downed)}  hp left ${pct(wins.reduce((s, r) => s + r.hpLeft, 0), wins.length)}`);
}

function main() {
  const runs = Number(process.argv[2]) || 500;
  const rng = seeded(Number(process.env.SEED) || 1);
  if (process.argv[3] === 'act2') return actTwo(runs, rng);
  if (process.argv[3] === 'act3') return actThree(runs, rng);
  if (process.argv[3] === 'act4') return actFour(runs, rng);
  const stats = {};
  let wholeRuns = {};
  for (const one of ACT_ONE) {
    for (const two of ACT_TWO) {
      const route = [...one, ...two];
      const name = `${one[1]}${one[2] === 'chapel' ? '' : '+' + one[2]} / ${via(two)}`;
      let won = 0;
      for (let i = 0; i < runs; i++) {
        const res = campaign(route, rng);
        for (const r of res) {
          const key = ['vault', 'larder', 'barrow'].includes(r.id) ? `${r.id} (${via(two)})` : r.id;
          (stats[key] ??= []).push(r);
        }
        if (res.length === route.filter((x) => x !== 'chapel' && x !== 'well').length && res.at(-1).won) won++;
      }
      wholeRuns[name] = pct(won, runs);
    }
  }
  console.log(`${runs} campaigns per route (seed ${Number(process.env.SEED) || 1})`);
  for (const [room, list] of Object.entries(stats)) {
    const lv = [...new Set(list.map((r) => r.level))].join('/');
    report(`${room} L${lv}`, list);
    if (room.startsWith('vault')) console.log(`    mimic sprung in ${pct(list.filter((r) => r.sprung).length, list.length)} of vault fights`);
  }
  console.log('  whole campaign won:', wholeRuns);
  console.log('  mimic ambush on a fresh L5 hero:', JSON.stringify(mimicCheck(5, 300)));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
