import { describe, it, expect } from 'vitest';
import {
  DIFFICULTIES, runDifficulty, difficultyLabel, newCampaign, parseSave, serialize, runSummary,
  heirloomChoices, newGamePlus, heroUnit,
} from '../src/game/campaign.js';

describe('the New Game+ tier', () => {
  it('scales monsters by 15% HP and +1 to hit and damage per tier', () => {
    expect(runDifficulty('hard', 2)).toMatchObject({ hp: 1.2 * 1.3, bonus: 3, thin: true });
    expect(runDifficulty('normal', 0)).toEqual(DIFFICULTIES.normal);
    expect(runDifficulty('nope', 1)).toMatchObject({ hp: 1.15, bonus: 1 });
  });

  it('names the tier after the difficulty', () => {
    expect(difficultyLabel('hard', 2)).toBe('Hard NG+2');
    expect(difficultyLabel('story', 0)).toBe('Story');
    expect(difficultyLabel('story')).toBe('Story');
  });

  it('starts at 0, and saves without one (or with a bad one) count as 0', () => {
    expect(newCampaign('normal').tier).toBe(0);
    const s = newCampaign('hard');
    delete s.tier;
    expect(parseSave(serialize(s)).tier).toBe(0);
    expect(parseSave(serialize({ ...s, tier: -3 })).tier).toBe(0);
    expect(parseSave(serialize({ ...s, tier: 1.5 })).tier).toBe(0);
    expect(parseSave(serialize({ ...s, tier: 2 })).tier).toBe(2);
  });

  it('shows the tier in the run summary', () => {
    expect(runSummary({ ...newCampaign('hard'), tier: 1 }).difficulty).toBe('Hard NG+1');
    expect(runSummary(newCampaign('hard')).difficulty).toBe('Hard');
  });
});

describe('starting New Game+', () => {
  const won = () => {
    const s = newCampaign('hard', { F: 'Tamsin' }, { F: 'P' });
    s.party.F = { ...s.party.F, items: ['ringProtection', 'cloakProtection'], alive: false, hp: 0, level: 8 };
    s.party.R = { ...s.party.R, items: ['amuletHealth'], level: 8 };
    s.party.W.level = 8;
    s.pack = ['bracersDefense'];
    s.cleared = ['crypt', 'warren'];
    s.xp = 10400;
    s.done = true;
    s.tier = 1;
    return s;
  };

  it('offers each hero’s equipped items, not the pack', () => {
    const c = heirloomChoices(won());
    expect(c.F).toEqual(['ringProtection', 'cloakProtection']);
    expect(c.W).toEqual([]);
    expect(Object.values(c).flat()).not.toContain('bracersDefense');
  });

  it('starts a fresh run one tier up with names, classes and the kept items', () => {
    const s = newGamePlus(won(), { F: 'cloakProtection', R: 'amuletHealth', W: 'nonsense' });
    expect(s.tier).toBe(2);
    expect(s.difficulty).toBe('hard');
    expect(s).toMatchObject({ pack: [], cleared: [], xp: 0, done: false, at: null });
    expect(s.party.F).toMatchObject({ cls: 'P', name: 'Tamsin', level: newCampaign().party.F.level, alive: true, items: ['cloakProtection'] });
    expect(s.party.F.hp).toBe(heroUnit('F', s.party.F).maxHp);
    expect(s.party.R.items).toEqual(['amuletHealth']);
    expect(s.party.R.hp).toBe(heroUnit('R', s.party.R).maxHp); // the amulet's HP counts
    expect(s.party.W.items).toEqual([]);
    expect(s.party.C.items).toEqual([]);
  });

  it('treats a run without a tier as tier 0', () => {
    const w = won();
    delete w.tier;
    expect(newGamePlus(w, {}).tier).toBe(1);
  });
});

describe('items that add hit points', () => {
  const withAmulet = () => {
    const s = newCampaign('normal');
    s.party.C.items = ['amuletHealth'];
    s.party.C.hp = heroUnit('C', s.party.C).maxHp;
    return s;
  };

  it('keep their HP through a save and load (or a saved fight would not resume)', () => {
    const s = withAmulet();
    expect(s.party.C.hp).toBeGreaterThan(heroUnit('C', { level: s.party.C.level }).maxHp);
    expect(parseSave(serialize(s)).party.C.hp).toBe(s.party.C.hp);
  });
});

describe('a won run kept for New Game+', () => {
  it('reads back only a finished run', async () => {
    const { parseWonRun } = await import('../src/game/campaign.js');
    const s = { ...newCampaign('hard'), done: true, tier: 2 };
    expect(parseWonRun(serialize(s))).toMatchObject({ done: true, tier: 2, difficulty: 'hard' });
    expect(parseWonRun(serialize(newCampaign()))).toBeNull();
    expect(parseWonRun(null)).toBeNull();
    expect(parseWonRun('nonsense')).toBeNull();
  });
});
