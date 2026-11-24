// One-off: records whole fights under rules 8 as fixtures (tests/fixtures/v8-fights.json), so
// rules 9 can prove fights begun before it still replay: the Warren's gong, the Larder's prisoner, the
// Catacombs' hold-out, the Vault's and the Armory's secret doors, the Halls, a Warlock's party and
// generation 7 Endless floors. Run: node scripts/v8-fixtures.mjs
import { writeFileSync } from 'node:fs';
import { Game } from '../src/game/combat.js';
import { nextMonsterStep } from '../src/game/ai.js';
import { seeded } from '../src/game/dice.js';
import { levelOf } from '../src/game/endless.js';
import { dailyCampaign } from '../src/game/daily.js';
import { DIFFICULTIES } from '../src/game/campaign.js';
import { applyCommand, monsterTurn, heroFell, fightCheck, unitRef, targetRef } from '../src/game/replay.js';

const RULES = 8;
const CASES = [
  ['warren', 3, {}, 4], ['larder', 6, { W: 'K' }, 3], ['catacombs', 5, {}, 2], ['vault', 5, { R: 'A' }, 9],
  ['armory', 9, {}, 5], ['halls', 7, { W: 'S' }, 6], ['deep:3:7:7', 7, {}, 5], ['deep:11:5:7', 6, {}, 8],
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
writeFileSync(new URL('../tests/fixtures/v8-fights.json', import.meta.url), JSON.stringify(out));
