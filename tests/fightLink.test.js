import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { applyCommand, monsterTurn, heroFell, fightCheck, targetRef } from '../src/game/replay.js';
import { nextMonsterStep } from '../src/game/ai.js';
import { seeded } from '../src/game/dice.js';
import { levelById } from '../src/game/maps.js';
import { NODES, newCampaign, runDifficulty } from '../src/game/campaign.js';
import { encodeFight, decodeFight, replaysTrue, cleanParty, unpack, fightUrl, LINK_VERSION } from '../src/game/fightLink.js';

/** Play a room to the end with the AI choosing the heroes' moves, given as commands like the player's. */
function playFight(node, seed, party, tier = 0) {
  const game = new Game(levelById(NODES[node].level), { party, difficulty: runDifficulty('normal', tier), rng: seeded(seed) });
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
  return { node, seed, party, difficulty: 'normal', ...(tier && { tier }), log, result: game.over, check: fightCheck(game) };
}

describe('a fight as a link', () => {
  const party = newCampaign('normal', { F: 'Tamsin' }).party;
  const fight = playFight('crypt', 1234, party);

  it('plays a real fight to the end', () => {
    expect(['victory', 'defeat']).toContain(fight.result);
    expect(fight.log.length).toBeGreaterThan(10);
  });

  it('comes back from the link as it went in, short enough to share', async () => {
    const code = await encodeFight(fight);
    expect(code).toMatch(/^[\w-]+$/);
    expect(code.length).toBeLessThan(3000);
    expect(await decodeFight(code)).toEqual(fight);
  });

  it('replays to the end it claims, and not to a changed one', () => {
    expect(replaysTrue(fight)).toBe(true);
    expect(replaysTrue({ ...fight, check: 'nope' })).toBe(false);
    expect(replaysTrue({ ...fight, seed: fight.seed + 1 })).toBe(false);
    expect(replaysTrue({ ...fight, result: fight.result === 'victory' ? 'defeat' : 'victory' })).toBe(false);
  });

  it('carries a New Game+ tier, and the fight replays only at that tier', async () => {
    const f1 = playFight('crypt', 1234, party, 1);
    expect(f1.tier).toBe(1);
    expect(await decodeFight(await encodeFight(f1))).toEqual(f1);
    expect(replaysTrue(f1)).toBe(true);
    const { tier, ...asZero } = f1;
    expect(tier).toBe(1);
    expect(replaysTrue(asZero)).toBe(false);
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
  });
});
