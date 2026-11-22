// One-off: records whole fights under the current rules as fixtures (tests/fixtures/v1-fights.json),
// so later rule changes can prove old saves still replay. Run: node scripts/v1-fixtures.mjs
import { writeFileSync } from 'node:fs';
import { Game } from '../src/game/combat.js';
import { nextMonsterStep } from '../src/game/ai.js';
import { seeded } from '../src/game/dice.js';
import { levelById } from '../src/game/maps.js';
import { dailyCampaign } from '../src/game/daily.js';
import { DIFFICULTIES } from '../src/game/campaign.js';
import { applyCommand, monsterTurn, heroFell, fightCheck, unitRef, targetRef } from '../src/game/replay.js';

const CASES = [
  ['crypt', 1, {}, 5], ['warren', 2, { F: 'P', R: 'A' }, 8], ['catacombs', 3, {}, 2],
  ['larder', 4, { W: 'K' }, 11], ['barrow', 4, { C: 'B' }, 6], ['nest', 6, { R: 'A', W: 'K' }, 3],
  ['throne', 6, { C: 'B', F: 'P' }, 4], ['armory', 8, { R: 'A', W: 'K', F: 'P', C: 'B' }, 9],
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
  const g = new Game(levelById(room), { party, difficulty: DIFFICULTIES.normal, rng: seeded(seed) });
  g.start(); untilHero(g);
  const log = []; let fell = 0;
  for (let n = 0; n < 400 && !g.over; n++) {
    const u = g.current; let cmd = pick(g); let r = applyCommand(g, cmd);
    if (!r.ok) { cmd = { type: 'end' }; applyCommand(g, cmd); }
    log.push(cmd); if (cmd.type !== 'end') heroFell(g, u); untilHero(g);
  }
  fell = g.units.filter((u) => u.team === 'heroes' && !u.alive).length;
  out.push({ room, level, classes, seed, log, check: fightCheck(g), over: g.over, next: g.rng() });
  console.log(room, log.length, 'over', g.over, 'heroes down', fell);
}
writeFileSync(new URL('../tests/fixtures/v1-fights.json', import.meta.url), JSON.stringify(out));
