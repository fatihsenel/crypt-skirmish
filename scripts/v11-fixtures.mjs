// One-off: records whole fights under rules 11 as fixtures (tests/fixtures/v11-fights.json), so
// rules 12 can prove fights begun before it still replay: the rooms that gained heights, cliffs and
// ladders (the warren, the gallery, the bridge), the crypt's ledge, a few others and Endless floors.
// Run: node scripts/v11-fixtures.mjs
import { writeFileSync } from 'node:fs';
import { Game } from '../src/game/combat.js';
import { nextMonsterStep } from '../src/game/ai.js';
import { seeded } from '../src/game/dice.js';
import { levelOf } from '../src/game/endless.js';
import { dailyCampaign } from '../src/game/daily.js';
import { DIFFICULTIES } from '../src/game/campaign.js';
import { applyCommand, monsterTurn, heroFell, fightCheck, unitRef, targetRef } from '../src/game/replay.js';

const RULES = 11;
const CASES = [
  ['crypt', 1, {}, 4], ['warren', 2, {}, 3], ['warren', 3, { F: 'P' }, 5], ['warren', 3, { R: 'A' }, 11],
  ['gallery', 6, {}, 9], ['gallery', 6, { F: 'P' }, 2], ['bridge', 9, {}, 4], ['bridge', 9, { R: 'A' }, 7],
  ['throne', 7, {}, 3], ['deep:3:9:9', 7, {}, 5],
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
writeFileSync(new URL('../tests/fixtures/v11-fights.json', import.meta.url), JSON.stringify(out));
