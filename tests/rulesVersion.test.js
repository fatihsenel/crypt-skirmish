import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game } from '../src/game/combat.js';
import { seeded } from '../src/game/dice.js';
import { levelById } from '../src/game/maps.js';
import { levelOf } from '../src/game/endless.js';
import { dailyCampaign } from '../src/game/daily.js';
import { DIFFICULTIES } from '../src/game/campaign.js';
import { replayFight, fightCheck } from '../src/game/replay.js';

// Whole fights recorded before the SRD rules (death saves, concentration, ghoul paralysis,
// long range, creatures giving cover) by scripts/v1-fixtures.mjs. Built with rules: 1 they
// must land exactly where they did, so old saves, replays and links still play back.
const FIGHTS = JSON.parse(readFileSync(new URL('./fixtures/v1-fights.json', import.meta.url), 'utf8'));

describe('fights recorded under the first rules', () => {
  for (const f of FIGHTS) {
    it(`replay ${f.room} (seed ${f.seed}) unchanged`, () => {
      const party = dailyCampaign({ level: f.level, classes: f.classes }).party;
      const g = new Game(levelById(f.room), { party, difficulty: DIFFICULTIES.normal, rng: seeded(f.seed), rules: 1 });
      const r = replayFight(g, f.log);
      expect(r.ok).toBe(true);
      expect(g.over).toBe(f.over);
      expect(fightCheck(g)).toBe(f.check);
      expect(g.rng()).toBe(f.next);
    });
  }
});

// Whole fights recorded under rules 5 by scripts/v5-fixtures.mjs: the rooms on two floors,
// acts four and five, and a generation 4 Endless floor. Rules 6 must leave them as they were.
const FIVE = JSON.parse(readFileSync(new URL('./fixtures/v5-fights.json', import.meta.url), 'utf8'));

describe('fights recorded under rules 5', () => {
  for (const f of FIVE) {
    it(`replay ${f.room} (seed ${f.seed}) unchanged`, () => {
      const party = dailyCampaign({ level: f.level, classes: f.classes }).party;
      const g = new Game(levelOf(f.room), { party, difficulty: DIFFICULTIES.normal, rng: seeded(f.seed), rules: 5 });
      const r = replayFight(g, f.log);
      expect(r.ok).toBe(true);
      expect(g.over).toBe(f.over);
      expect(fightCheck(g)).toBe(f.check);
      expect(g.rng()).toBe(f.next);
    });
  }
});

describe('the rules a fight began under', () => {
  it('ride with a saved record and a link', async () => {
    const { watchable } = await import('../src/game/history.js');
    const { encodeFight, decodeFight } = await import('../src/game/fightLink.js');
    const { RULES } = await import('../src/game/combat.js');
    const party = dailyCampaign({ level: 1, classes: {} }).party;
    const g = new Game(levelById('crypt'), { party, difficulty: DIFFICULTIES.normal, rng: seeded(5) });
    expect(g.rules).toBe(RULES);
    const base = { node: 'crypt', seed: 5, party, difficulty: 'normal', log: [{ type: 'end' }], result: 'defeat', check: 'x' };
    expect(watchable({ ...base, rules: 2 }).rules).toBe(2);
    expect(watchable(base).rules).toBeUndefined();
    expect((await decodeFight(await encodeFight({ ...base, rules: 2 }))).rules).toBe(2);
    expect((await decodeFight(await encodeFight(base))).rules).toBeUndefined();
  });
});
