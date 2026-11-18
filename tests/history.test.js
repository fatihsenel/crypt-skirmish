import { describe, it, expect } from 'vitest';
import { runRecord, addRun, parseHistory, MAX_RUNS } from '../src/game/history.js';
import { newCampaign } from '../src/game/campaign.js';

describe('run history', () => {
  it('skips an abandoned run that never won a room', () => {
    expect(runRecord(newCampaign('normal'), 'abandoned', 1)).toBeNull();
  });

  it('records a run with its party and how far it got', () => {
    const state = newCampaign('hard', { F: 'Tamsin' });
    state.stats.won = 3;
    state.stats.rounds = 21;
    state.stats.heroes.F.damage = 40;
    const r = runRecord(state, 'abandoned', 123);
    expect(r).toMatchObject({ when: 123, result: 'abandoned', won: 3, rounds: 21, mvp: { name: 'Tamsin', damage: 40 } });
    expect(r.heroes).toHaveLength(4);
    expect(r.heroes[0].name).toBe('Tamsin');
  });

  it('keeps a won run even with no stats, newest first, capped', () => {
    const won = runRecord(newCampaign(), 'won', 5);
    expect(won.mvp).toBeNull();
    let list = [];
    for (let i = 0; i < MAX_RUNS + 5; i++) list = addRun(list, { result: 'won', when: i });
    expect(list).toHaveLength(MAX_RUNS);
    expect(list[0].when).toBe(MAX_RUNS + 4);
    expect(addRun(list, null)).toBe(list);
  });

  it('treats unreadable storage as no history', () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory('not json')).toEqual([]);
    expect(parseHistory('{"a":1}')).toEqual([]);
    expect(parseHistory('[null, 3, {"result":"won","when":1}]')).toEqual([{ result: 'won', when: 1 }]);
  });
});
