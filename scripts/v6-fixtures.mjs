// One-off: records whole fights under rules 6 as fixtures (tests/fixtures/v6-fights.json), so
// rules 7 can prove fights begun before it still replay: the jelly's Cistern, the dark Catacombs,
// the goblins' Warren, the Sunken Halls and a generation 5 Endless floor. Run: node scripts/v6-fixtures.mjs
import { writeFileSync } from 'node:fs';
import { Game } from '../src/game/combat.js';
import { nextMonsterStep } from '../src/game/ai.js';
import { seeded } from '../src/game/dice.js';
import { levelOf } from '../src/game/endless.js';
import { dailyCampaign } from '../src/game/daily.js';
import { DIFFICULTIES } from '../src/game/campaign.js';
import { applyCommand, monsterTurn, heroFell, fightCheck, unitRef, targetRef } from '../src/game/replay.js';

const RULES = 6;
const CASES = [
  ['cistern', 5, {}, 4], ['catacombs', 4, { C: 'B' }, 6], ['warren', 3, {}, 2], ['halls', 7, { R: 'M', C: 'D' }, 3],
  ['undercroft', 8, { F: 'Z', W: 'S' }, 7], ['deep:3:7:5', 7, {}, 5], ['deep:11:5:5', 6, {}, 8],
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
writeFileSync(new URL('../tests/fixtures/v6-fights.json', import.meta.url), JSON.stringify(out));
