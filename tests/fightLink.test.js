import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { applyCommand, monsterTurn, heroFell, fightCheck, targetRef } from '../src/game/replay.js';
import { nextMonsterStep } from '../src/game/ai.js';
import { seeded } from '../src/game/dice.js';
import { levelById } from '../src/game/maps.js';
import { NODES, newCampaign, runDifficulty } from '../src/game/campaign.js';
import { withoutNames } from '../src/stats.js';
import { encodeFight, decodeFight, replaysTrue, replayOutcome, challengeText, cleanParty, unpack, fightUrl, linkIn, LINK_VERSION } from '../src/game/fightLink.js';

/** Play a room to the end with the AI choosing the heroes' moves, given as commands like the player's. */
function playFight(node, seed, party, tier = 0, relics = []) {
  const game = new Game(levelById(NODES[node].level), { party, difficulty: runDifficulty('normal', tier), rng: seeded(seed), relics });
  const log = [];
  const give = (cmd) => {
    const r = applyCommand(game, cmd);
    if (r?.ok) log.push(cmd);
    return r;
  };
  game.start();
  for (let turns = 0; !game.over && turns < 600; turns++) {
    const u = game.current;
    if (u.team === 'monsters') {
      for (const s of monsterTurn(game, u)) void s;
      game.endTurn();
      continue;
    }
    const memo = {};
    for (let k = 0; k < 8 && game.current === u && !game.over && u.alive; k++) {
      const s = nextMonsterStep(game, u, memo);
      if (s.type === 'end') break;
      const cmd = s.type === 'move' ? { type: 'move', x: s.x, z: s.z }
        : s.type === 'attack' ? { type: 'attack', target: game.units.indexOf(s.target), attack: u.attacks.indexOf(s.attack) }
          : s.type === 'spell' ? { type: 'spell', id: s.id, ...targetRef(game, s.target) }
            : { type: 'action', id: s.id };
      if (!give(cmd)?.ok) break;
      heroFell(game, u);
    }
    if (game.current === u && !game.over) give({ type: 'end' });
  }
  return { node, seed, rules: game.rules, party, difficulty: 'normal', ...(tier && { tier }), ...(relics.length && { relics }), log, result: game.over, check: fightCheck(game), rounds: game.round };
}

describe('a fight as a link', () => {
  const party = newCampaign('normal', { F: 'Tamsin' }).party;
  const fight = playFight('crypt', 1234, party);

  it('plays a real fight to the end', () => {
    expect(['victory', 'defeat']).toContain(fight.result);
    expect(fight.log.length).toBeGreaterThan(10);
  });

  it('sent as a loss replay, it has no names and still replays', async () => {
    expect(fight.party.F.name).toBe('Tamsin');
    const sent = withoutNames(fight);
    expect(fight.party.F.name).toBe('Tamsin'); // the record itself is untouched
    const back = await decodeFight(await encodeFight(sent));
    expect(JSON.stringify(back)).not.toMatch(/Tamsin/);
    expect(back.party.F.level).toBe(fight.party.F.level);
    expect(replaysTrue(back)).toBe(true);
  });

  it('comes back from the link as it went in, short enough to share', async () => {
    const code = await encodeFight(fight);
    expect(code).toMatch(/^[\w-]+$/);
    expect(code.length).toBeLessThan(3000);
    const { rounds, ...sent } = fight; // the rounds aren't in the link: replaying tells them
    expect(rounds).toBeGreaterThan(0);
    expect(await decodeFight(code)).toEqual(sent);
  });

  it('replays to the end it claims, and not to a changed one', () => {
    expect(replaysTrue(fight)).toBe(true);
    expect(replayOutcome(fight)).toEqual({ rounds: fight.rounds });
    expect(replayOutcome({ ...fight, check: 'nope' })).toBeNull();
    expect(replaysTrue({ ...fight, check: 'nope' })).toBe(false);
    expect(replaysTrue({ ...fight, seed: fight.seed + 1 })).toBe(false);
    expect(replaysTrue({ ...fight, result: fight.result === 'victory' ? 'defeat' : 'victory' })).toBe(false);
  });

  it('carries a New Game+ tier, and the fight replays only at that tier', async () => {
    const f1 = playFight('crypt', 1234, party, 1);
    expect(f1.tier).toBe(1);
    const { rounds: _r, ...sent1 } = f1;
    expect(await decodeFight(await encodeFight(f1))).toEqual(sent1);
    expect(replaysTrue(f1)).toBe(true);
    const { tier, rounds: _r2, ...asZero } = f1;
    expect(tier).toBe(1);
    expect(replaysTrue(asZero)).toBe(false);
  });

  it('carries the run’s relics, and the fight replays only with them', async () => {
    const f2 = playFight('crypt', 1234, party, 0, ['phylactery', 'horn', 'veil']);
    const { rounds: _r, ...sent2 } = f2;
    expect(await decodeFight(await encodeFight(f2))).toEqual(sent2);
    expect(replaysTrue(f2)).toBe(true);
    const { relics, ...without } = f2;
    expect(relics).toHaveLength(3);
    expect(replaysTrue(without)).toBe(false);
    expect(unpack({ v: LINK_VERSION, n: 'crypt', s: 1, d: 'normal', rl: ['crown'], p: party, l: [], r: 'victory', c: 'x' })).toBeNull();
  });

  it('refuses broken or unknown links', async () => {
    expect(await decodeFight('not a link!')).toBeNull();
    expect(await decodeFight('AAAA')).toBeNull();
    const o = { v: LINK_VERSION, n: 'crypt', s: 1, d: 'normal', p: party, l: [], r: 'victory', c: 'x' };
    expect(unpack(o)).not.toBeNull();
    expect(unpack({ ...o, v: 99 })).toBeNull();
    expect(unpack({ ...o, v: 1 })).toBeNull(); // links from before New Game+
    expect(unpack({ ...o, t: 2 }).tier).toBe(2);
    expect(unpack(o).tier).toBeUndefined();
    for (const t of [-1, 1.5, 1000, '2']) expect(unpack({ ...o, t })).toBeNull();
    expect(unpack({ ...o, n: 'nowhere' })).toBeNull();
    expect(unpack({ ...o, d: 'brutal' })).toBeNull();
    expect(unpack({ ...o, l: [{ type: 'move', x: -1, z: 2 }] })).toBeNull();
    expect(unpack({ ...o, l: [{ type: 'spell', id: '<b>' }] })).toBeNull();
  });

  it('keeps only known party fields, with names cleaned', () => {
    const p = cleanParty({
      F: { ...party.F, name: '<img src=x onerror=alert(1)>', cls: 'P', extra: 'x' },
      W: { ...party.W, items: ['ringProtection', 'nonsense'], cls: 'F' },
    });
    expect(p.F.name).toBe('img srcx onerr');
    expect(p.F.cls).toBe('P');
    expect(p.F.extra).toBeUndefined();
    expect(p.W.items).toEqual(['ringProtection']);
    expect(p.W.cls).toBeUndefined();
    expect(cleanParty({ F: { level: 'x' } })).toBeNull();
  });

  it('builds the link from the page address', () => {
    expect(fightUrl('https://x.io/crypt-skirmish/?level=2#old', 'abc')).toBe('https://x.io/crypt-skirmish/#watch=abc');
    expect(fightUrl('https://x.io/crypt-skirmish/#watch=old', 'abc', 'play')).toBe('https://x.io/crypt-skirmish/#play=abc');
  });
});

describe('playing a linked fight yourself', () => {
  const room = 'The Crypt Door';
  it('compares a win with the link’s', () => {
    expect(challengeText({ result: 'victory', rounds: 6 }, { won: true, rounds: 5 }, room))
      .toEqual({ title: 'Challenge won', text: 'You won The Crypt Door in 5 rounds, faster than the link’s 6.' });
    expect(challengeText({ result: 'victory', rounds: 6 }, { won: true, rounds: 6 }, room).text)
      .toBe('You won The Crypt Door in 6 rounds, level with the link.');
    expect(challengeText({ result: 'victory', rounds: 4 }, { won: true, rounds: 7 }, room).text)
      .toBe('You won The Crypt Door in 7 rounds. The link did it in 4.');
    expect(challengeText({ result: 'defeat', rounds: 3 }, { won: true, rounds: 1 }, room).text)
      .toBe('You won The Crypt Door in 1 round, where the link’s party fell in round 3.');
  });

  it('says how a loss compares', () => {
    expect(challengeText({ result: 'victory', rounds: 6 }, { won: false, rounds: 4 }, room))
      .toEqual({ title: 'Defeat', text: 'Your party fell in The Crypt Door in round 4. The link won in 6 rounds. Try again from the same dice.' });
    expect(challengeText({ result: 'defeat', rounds: 5 }, { won: false, rounds: 2 }, room).text)
      .toBe('Your party fell in The Crypt Door in round 2. The link’s party fell too, in round 5. Try again from the same dice.');
  });
});

describe('which link the page was opened with', () => {
  it('tells a replay from a challenge, and ignores anything else', () => {
    expect(linkIn('#watch=abc')).toEqual({ kind: 'watch', code: 'abc' });
    expect(linkIn('#play=a-b_c')).toEqual({ kind: 'play', code: 'a-b_c' });
    expect(linkIn('')).toBeNull();
    expect(linkIn('#play=')).toBeNull();
    expect(linkIn('#other=abc')).toBeNull();
  });
});
