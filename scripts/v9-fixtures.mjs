// One-off: records whole fights under rules 9 as fixtures (tests/fixtures/v9-fights.json), so
// rules 10 can prove fights begun before it still replay: the bosses with lair actions (Morvath, Nekhet,
// Tharok), a Wizard against Morvath's spells, the rooms with pits and cracked ceilings, and
// generation 8 Endless floors. Run: node scripts/v9-fixtures.mjs
import { writeFileSync } from 'node:fs';
import { Game } from '../src/game/combat.js';
import { nextMonsterStep } from '../src/game/ai.js';
import { seeded } from '../src/game/dice.js';
import { levelOf } from '../src/game/endless.js';
import { dailyCampaign } from '../src/game/daily.js';
import { DIFFICULTIES } from '../src/game/campaign.js';
import { applyCommand, monsterTurn, heroFell, fightCheck, unitRef, targetRef } from '../src/game/replay.js';

const RULES = 9;
const CASES = [
  ['sanctum', 5, {}, 4], ['sanctum', 5, { W: 'S' }, 7], ['tomb', 6, { W: 'K' }, 3], ['labyrinth', 7, {}, 5],
  ['ossuary', 2, {}, 6], ['bridge', 7, { C: 'D' }, 2], ['nest', 5, {}, 9], ['halls', 6, { W: 'S' }, 4],
  ['deep:3:9:8', 7, {}, 5], ['deep:12:6:8', 6, {}, 8],
];

function untilHero(g) {
  while (!g.over && g.current.team !== 'heroes') { for (const s of monsterTurn(g, g.current)) void s; g.endTurn(); }
}
function pick(g) {
  const u = g.current; const s = nextMonsterStep(g, u, {});
  switch (s.type) {
    case 'attack': return { type: 'attack', target: unitRef(g, s.target), attack: u.attacks.indexOf(s.attack) };
    case 'move': return { type: 'move', x: s.x, z: s.z };
    case 'spell': return { type: 'spell', id: s.id, ...targetRef(g, s.target) };
    case 'bonus': case 'action': return { type: 'action', id: s.id };
    default: return { type: 'end' };
  }
}
const out = [];
for (const [room, level, classes, seed] of CASES) {
  const party = dailyCampaign({ level, classes }).party;
  const g = new Game(levelOf(room), { party, difficulty: DIFFICULTIES.normal, rng: seeded(seed), rules: RULES });
  g.start(); untilHero(g);
  const log = [];
  for (let n = 0; n < 400 && !g.over; n++) {
    const u = g.current; let cmd = pick(g); const r = applyCommand(g, cmd);
    if (!r.ok) { cmd = { type: 'end' }; applyCommand(g, cmd); }
    log.push(cmd); if (cmd.type !== 'end') heroFell(g, u); untilHero(g);
  }
  out.push({ room, level, classes, seed, log, check: fightCheck(g), over: g.over, next: g.rng() });
  console.log(room, log.length, 'over', g.over);
}
writeFileSync(new URL('../tests/fixtures/v9-fights.json', import.meta.url), JSON.stringify(out));
