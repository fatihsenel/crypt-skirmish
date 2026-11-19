import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { nextMonsterStep } from '../src/game/ai.js';
import { seeded } from '../src/game/dice.js';
import { LEVELS, levelById } from '../src/game/maps.js';
import { dailyCampaign } from '../src/game/daily.js';
import { newCampaign, serialize, parseSave, DIFFICULTIES } from '../src/game/campaign.js';
import { applyCommand, monsterTurn, heroFell, replayFight, fightCheck, unitRef, targetRef } from '../src/game/replay.js';

const campaign = newCampaign('normal');
const fresh = (level, seed) =>
  new Game(level, { party: campaign.party, difficulty: DIFFICULTIES.normal, rng: seeded(seed) });

/** Run monster turns until a hero is up (or the fight ends), as the game does between commands. */
function untilHero(game) {
  while (!game.over && game.current.team !== 'heroes') {
    for (const s of monsterTurn(game, game.current)) void s;
    game.endTurn();
  }
}

/** The command a player might give: what the monster AI would do with the hero, else end. */
function pickCommand(game) {
  const u = game.current;
  const step = nextMonsterStep(game, u, {});
  switch (step.type) {
    case 'attack': return { type: 'attack', target: unitRef(game, step.target), attack: u.attacks.indexOf(step.attack) };
    case 'move': return { type: 'move', x: step.x, z: step.z };
    case 'spell': return { type: 'spell', id: step.id, ...targetRef(game, step.target) };
    case 'bonus':
    case 'action': return { type: 'action', id: step.id };
    default: return { type: 'end' };
  }
}

/** Play `n` hero commands the way the game does, returning the log. */
function play(game, n, log = []) {
  for (let i = 0; i < n && !game.over; i++) {
    const u = game.current;
    let cmd = pickCommand(game);
    let r = applyCommand(game, cmd);
    if (!r.ok) {
      cmd = { type: 'end' };
      r = applyCommand(game, cmd);
    }
    log.push(cmd);
    if (cmd.type !== 'end') heroFell(game, u);
    untilHero(game);
  }
  return log;
}

describe('saving a fight mid-battle', () => {
  for (const [i, seed] of [[0, 7], [3, 11], [5, 23]]) {
    it(`replays ${LEVELS[i].name} to the same state (seed ${seed})`, () => {
      const live = fresh(LEVELS[i], seed);
      live.start();
      untilHero(live);
      const log = play(live, 40);
      expect(log.length).toBeGreaterThan(5);

      const back = fresh(LEVELS[i], seed);
      const r = replayFight(back, log);
      expect(r.ok).toBe(true);
      expect(fightCheck(back)).toBe(fightCheck(live));
      expect(back.units.map((u) => [u.hp, u.x, u.z, u.alive])).toEqual(live.units.map((u) => [u.hp, u.x, u.z, u.alive]));

      // Both go on rolling the same dice: more commands keep them in step.
      if (!live.over) {
        const more = play(live, 15);
        for (const cmd of more) {
          const u = back.current;
          expect(applyCommand(back, cmd).ok).toBe(true);
          if (cmd.type !== 'end') heroFell(back, u);
          untilHero(back);
        }
        expect(fightCheck(back)).toBe(fightCheck(live));
      }
      expect(back.rng()).toBe(live.rng());
    });
  }

  it('replays a fight with Ice Storm\'s icy ground on the board', () => {
    const party = dailyCampaign({ level: 8, classes: {} }).party;
    const halls = (seed) => new Game(levelById('halls'), { party, difficulty: DIFFICULTIES.normal, rng: seeded(seed) });
    const live = halls(9);
    live.start();
    untilHero(live);
    const log = [];
    const act = (cmd) => {
      const u = live.current;
      expect(applyCommand(live, cmd).ok).toBe(true);
      log.push(cmd);
      if (cmd.type !== 'end') heroFell(live, u);
      untilHero(live);
    };
    while (live.current.code !== 'W') act({ type: 'end' });
    // The storm as close to the monsters as Ilsa can put it.
    const w = live.current;
    const foes = live.units.filter((u) => u.team === 'monsters');
    let spot = null;
    for (let z = 0; z < 12; z++) {
      for (let x = 0; x < 16; x++) {
        if (live.spellProblem(w, 'iceStorm', { x, z })) continue;
        const d = Math.min(...foes.map((f) => Math.max(Math.abs(f.x - x), Math.abs(f.z - z))));
        if (!spot || d < spot.d) spot = { x, z, d };
      }
    }
    act({ type: 'spell', id: 'iceStorm', x: spot.x, z: spot.z });
    act({ type: 'end' }); // the monsters take their turns on the ice
    expect(live.icyTiles().size).toBeGreaterThan(0);

    const back = halls(9);
    expect(replayFight(back, log).ok).toBe(true);
    expect([...back.icyTiles()].sort()).toEqual([...live.icyTiles()].sort());
    expect(fightCheck(back)).toBe(fightCheck(live));
    expect(back.rng()).toBe(live.rng());
  });

  it('reports the fingerprint right after the last command', () => {
    const live = fresh(LEVELS[0], 3);
    live.start();
    untilHero(live);
    const log = play(live, 6);
    const last = log.pop();
    const before = fresh(LEVELS[0], 3);
    replayFight(before, log);
    applyCommand(before, last);
    expect(replayFight(fresh(LEVELS[0], 3), [...log, last]).check).toBe(fightCheck(before));
  });

  it('notices a log that no longer fits the fight', () => {
    const live = fresh(LEVELS[0], 5);
    live.start();
    untilHero(live);
    const log = play(live, 10);
    // A move to a wall can't be made.
    expect(replayFight(fresh(LEVELS[0], 5), [...log, { type: 'move', x: 0, z: 0 }]).ok).toBe(false);
    expect(replayFight(fresh(LEVELS[0], 5), [{ type: 'attack', target: 999, attack: 0 }]).ok).toBe(false);
    // Other dice land somewhere else.
    const other = replayFight(fresh(LEVELS[0], 6), log);
    const same = replayFight(fresh(LEVELS[0], 5), log);
    expect(other.ok && other.check === same.check).toBe(false);
  });

  it('keeps a saved fight in the save, and drops a broken one', () => {
    const fight = { node: 'warren', seed: 42, log: [{ type: 'end' }], check: 'abc', explored: ['1,2'], seen: [3] };
    expect(parseSave(serialize({ ...campaign, fight })).fight).toEqual(fight);
    expect(parseSave(serialize({ ...campaign, fight: { ...fight, seed: 'x' } })).fight).toBeUndefined();
    expect(parseSave(serialize({ ...campaign, fight: { ...fight, node: 'nowhere' } })).fight).toBeUndefined();
    expect(parseSave(serialize(campaign)).fight).toBeUndefined();
  });
});
