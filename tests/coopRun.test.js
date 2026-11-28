import { describe, it, expect } from 'vitest';
import { CoopRun, rebuildRun, fightSeed, enterAct, keyAct, voteKey, isCampStep } from '../src/game/coopRun.js';
import { nextMonsterStep } from '../src/game/ai.js';
import { applyCommand, monsterTurn, heroFell, unitRef, targetRef } from '../src/game/replay.js';
import { RULES } from '../src/game/elites.js';

const SPEC = { run: true, difficulty: 'story', classes: {}, seed: 1234, rules: RULES };
const camp = (...act) => ({ type: 'camp', act });

function untilHero(g) {
  while (!g.over && g.current.team !== 'heroes') {
    for (const s of monsterTurn(g, g.current)) void s;
    g.endTurn();
  }
}
/** The AI's command for the hero whose turn it is (as the fixtures' scripts play heroes). */
function pick(g) {
  const u = g.current;
  const s = nextMonsterStep(g, u, {});
  switch (s.type) {
    case 'attack': return { type: 'attack', target: unitRef(g, s.target), attack: u.attacks.indexOf(s.attack) };
    case 'move': return { type: 'move', x: s.x, z: s.z };
    case 'spell': return { type: 'spell', id: s.id, ...targetRef(g, s.target) };
    case 'bonus': case 'action': return { type: 'action', id: s.id };
    default: return { type: 'end' };
  }
}
/** Play the run's fight to its end as main.js would, adding the commands to `log`. */
function playFight(run, log, { idle = false } = {}) {
  const g = run.newGame();
  g.start();
  untilHero(g);
  for (let n = 0; n < 600 && !g.over; n++) {
    const u = g.current;
    let cmd = pick(g);
    if (idle && cmd.type !== 'move') cmd = { type: 'end' }; // they walk up and never strike
    if (!applyCommand(g, cmd).ok) {
      cmd = { type: 'end' };
      applyCommand(g, cmd);
    }
    log.push(cmd);
    if (cmd.type !== 'end') heroFell(g, u);
    untilHero(g);
  }
  run.fightOver(g);
  return g;
}
function take(run, log, ...act) {
  const r = run.step(act);
  expect(r.ok, `${act.join(':')}: ${r.why}`).toBe(true);
  log.push(camp(...act));
  return r;
}

describe('co-op runs', () => {
  it('gives each fight its own dice from the run’s seed', () => {
    expect(fightSeed(7, 0)).toBe(fightSeed(7, 0));
    expect(new Set([0, 1, 2, 3].map((n) => fightSeed(7, n))).size).toBe(4);
    expect(fightSeed(8, 0)).not.toBe(fightSeed(7, 0));
  });

  it('reads the camp’s buttons and votes as steps', () => {
    const run = new CoopRun(SPEC);
    expect(enterAct(run.state, 'crypt')).toEqual(['enter', 'crypt']);
    expect(enterAct(run.state, 'altar:offer')).toEqual(['event', 'altar', 'offer']);
    expect(enterAct(run.state, 'scene:gravedigger:take')).toEqual(['scene', 'gravedigger', 'take']);
    expect(keyAct(voteKey(['event', 'altar', 'offer']))).toEqual(['event', 'altar', 'offer']);
    expect(keyAct('buy:potion')).toBe(null); // a trade is nobody's vote
    expect(isCampStep(camp('next'))).toBe(true);
    expect(isCampStep({ type: 'end' })).toBe(false);
  });

  it('plays fights and camp from one log, and a rebuild lands in the same place', () => {
    const run = new CoopRun(SPEC);
    const log = [];
    expect(run.step(['enter', 'vault']).ok).toBe(false); // not a way on yet
    expect(run.step(['next']).ok).toBe(false); // no fight to leave
    const r = take(run, log, 'enter', 'crypt');
    expect(r.fight).toEqual({ node: 'crypt', seed: fightSeed(SPEC.seed, 0), n: 0 });
    // Halfway through the fight, a device that joins builds the same fight.
    const g = playFight(run, log);
    const mid = Math.floor(log.length / 2);
    const half = rebuildRun(SPEC, log.slice(0, mid));
    expect(half.ok).toBe(true);
    expect(half.run.phase).toBe('fight');
    expect(half.run.cmds).toEqual(log.slice(1, mid));
    expect(half.run.game.over).toBe(null);
    expect(g.over).toBe('victory');
    expect(run.step(['retry']).ok).toBe(false); // it was won
    take(run, log, 'next');
    expect(run.phase).toBe('camp');
    expect(run.state.cleared).toContain('crypt');
    // A player's own step: rebuilt with the rest.
    const rebuilt = rebuildRun(SPEC, [...log, camp('style', 'F', 'protection')]);
    expect(rebuilt.ok).toBe(true);
    expect(rebuilt.run.phase).toBe('camp');
    expect(rebuilt.run.state.cleared).toEqual(run.state.cleared);
    expect(rebuilt.run.state.party.F.style).toBe('protection');
    expect(rebuilt.run.state.xp).toBe(run.state.xp);
  });

  it('lets a lost fight be fought again with new dice, or left for camp', () => {
    const run = new CoopRun({ ...SPEC, difficulty: 'hard' });
    const log = [];
    take(run, log, 'enter', 'crypt');
    const g = playFight(run, log, { idle: true }); // the heroes never strike
    expect(g.over).toBe('defeat');
    expect(run.state.fails.crypt).toBe(1);
    expect(run.step(['next']).ok).toBe(false);
    expect(run.step(['ease']).ok).toBe(false); // not offered after one loss
    const r = take(run, log, 'retry');
    expect(r.fight).toEqual({ node: 'crypt', seed: fightSeed(SPEC.seed, 1), n: 1 });
    playFight(run, log, { idle: true });
    take(run, log, 'camp');
    expect(run.phase).toBe('camp');
    const rebuilt = rebuildRun({ ...SPEC, difficulty: 'hard' }, log);
    expect(rebuilt.ok).toBe(true);
    expect(rebuilt.run.state.fails.crypt).toBe(2);
    expect(rebuilt.run.n).toBe(2);
  });

  it('skips what no longer fits, the same on every device, and refuses a broken fight', () => {
    // Gear handed out as the fight began, a second Next, a turn ended after the fight was won.
    const run = new CoopRun(SPEC);
    const log = [];
    take(run, log, 'enter', 'crypt');
    log.push(camp('style', 'F', 'protection')); // too late: the fight is on
    const g = playFight(run, log);
    expect(g.over).toBe('victory');
    log.push({ type: 'end' }, camp('next'), camp('next'), camp('scene', 'nobody', 'x'));
    const r = rebuildRun(SPEC, log);
    expect(r.ok).toBe(true);
    expect(r.run.phase).toBe('camp');
    expect(r.run.state.party.F.style).not.toBe('protection');
    expect(r.run.state.cleared).toEqual(['crypt']);
    expect(rebuildRun(SPEC, [{ type: 'end' }]).run.phase).toBe('camp'); // a stray command at camp
    expect(rebuildRun(SPEC, [camp('enter', 'crypt'), { type: 'attack', target: 99, attack: 0 }])).toEqual({ ok: false, at: 2 });
  });
});

describe('the village in a run together', () => {
  it('rebuilds by vote at an act’s end, and a second click that no longer fits is refused', () => {
    const run = new CoopRun(SPEC);
    run.state = { ...run.state, at: 'sanctum', cleared: ['crypt', 'warren', 'chapel', 'sanctum'], gold: 250 };
    expect(keyAct(voteKey(['town', 'smith']))).toEqual(['town', 'smith']);
    const r = run.step(['town', 'smith']);
    expect(r.ok).toBe(true);
    expect(r.report).toEqual({ built: 'smith', stage: 1 });
    expect(run.state.gold).toBe(130);
    expect(run.step(['town', 'smith'])).toEqual({ ok: false, why: 'Not enough gold' });
    expect(run.step(['town', 'mill']).ok).toBe(false);
  });
});
