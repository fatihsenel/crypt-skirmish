// Headless balance check: plays rooms many times with a simple hero policy (heals, Fireball,
// Magic Missile, potions, then the monster AI's tactics) and prints win rates.
//   node scripts/sim.js [runs] [room ...]
// Rooms default to the act-two route; "route" chains catacombs → vault|well → barrow the
// way the campaign does (short rests between fights, a long rest at the well).

import { Game } from '../src/game/combat.js';
import { nextMonsterStep } from '../src/game/ai.js';
import { areaTiles } from '../src/game/abilities.js';
import { levelById } from '../src/game/maps.js';
import { newCampaign, completeFight, takeRest, heroUnit, equip, HERO_CODES } from '../src/game/campaign.js';
import { ITEMS } from '../src/game/items.js';

/** A rested party at `level`. */
function partyAt(level) {
  const c = newCampaign();
  for (const code of HERO_CODES) {
    const u = heroUnit(code, { level });
    Object.assign(c.party[code], { level, hp: u.maxHp, slots: { ...u.slotMax } });
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
      if (friends || foes < 2) continue;
      if (!best || foes > best.foes) best = { p, foes };
    }
  }
  return best?.p ?? null;
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
  }
  if (u.code === 'W' && !u.actionUsed) {
    const p = bestFireball(game, u);
    if (p) game.castSpell(u, 'fireball', p);
    else if ((u.slots[1] ?? 0) + (u.slots[2] ?? 0) > 0) {
      const t = game.spellTargets(u, 'magicMissile').filter((e) => !e.unaware).sort((a, b) => a.hp - b.hp)[0];
      if (t) game.castSpell(u, 'magicMissile', t);
    }
  }
  if (!u.actionUsed && u.hp < u.maxHp * 0.35 && u.potions > 0 && !game.actionProblem(u, 'potion')) game.doAction(u, 'potion');
}

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
  const game = new Game(levelById(levelId), { party: campaign.party, rng });
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
      const hero = game.units.find((u) => u.code === code);
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

/** Seeded PRNG (mulberry32) so before/after runs compare like with like. */
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hand pack gear to whoever it suits: weapons to the fighter then the rogue, the rest to the casters. */
function equipAll(state) {
  const order = { weaponPlus1: ['F', 'R'], ringProtection: ['W', 'C', 'R'], cloakProtection: ['W', 'C', 'R'] };
  for (let i = state.pack.length - 1; i >= 0; i--) {
    const id = state.pack[i];
    if (ITEMS[id]?.kind !== 'gear') continue;
    const who = (order[id] ?? HERO_CODES).find((c) => !state.party[c].items.includes(id));
    if (who) state = equip(state, i, who);
  }
  return state;
}

const ACT_ONE = [['crypt', 'warren', 'chapel', 'sanctum'], ['crypt', 'ossuary', 'chapel', 'sanctum'], ['crypt', 'warren', 'ossuary', 'sanctum']];
const ACT_TWO = [['catacombs', 'vault', 'barrow'], ['catacombs', 'well', 'barrow']];

/** Play a whole campaign along `route`; returns per-room results until the party falls. */
function campaign(route, rng, start = newCampaign()) {
  let state = start;
  const out = [];
  for (const id of route) {
    if (id === 'chapel' || id === 'well') {
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
      for (const r of res) (stats[r.id === 'catacombs' ? r.id : `${r.id} (${two[1]})`] ??= []).push(r);
      if (res.at(-1).id === 'barrow' && res.at(-1).won) won++;
    }
    whole[two[1]] = pct(won, runs);
  }
  console.log(`Act two, ${runs} runs per route from 60 act-one parties`);
  for (const [room, list] of Object.entries(stats)) {
    report(room, list);
    if (room.startsWith('vault')) console.log(`    mimic sprung in ${pct(list.filter((r) => r.sprung).length, list.length)}; vault lost after it sprang ${pct(list.filter((r) => r.sprung && !r.won).length, list.filter((r) => r.sprung).length)}`);
  }
  console.log('  act two won via', whole);
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
  const stats = {};
  let wholeRuns = {};
  for (const one of ACT_ONE) {
    for (const two of ACT_TWO) {
      const route = [...one, ...two];
      const name = `${one[1]}${one[2] === 'chapel' ? '' : '+' + one[2]} / ${two[1]}`;
      let won = 0;
      for (let i = 0; i < runs; i++) {
        const res = campaign(route, rng);
        for (const r of res) {
          const key = r.id === 'vault' || r.id === 'barrow' ? `${r.id} (${two[1]})` : r.id;
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
