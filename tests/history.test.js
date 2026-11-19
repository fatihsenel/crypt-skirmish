import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runRecord, addRun, parseHistory, MAX_RUNS, watchable, saveLastFight, loadLastFight, recordRun, loadHistory, LAST_FIGHT_KEY } from '../src/game/history.js';
import { newCampaign, runShareText } from '../src/game/campaign.js';

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

describe('a run’s last fight', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.localStorage = {
      getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
    };
  });
  afterEach(() => { delete globalThis.localStorage; });

  const fight = (more = {}) => ({ node: 'tomb', seed: 42, party: { F: { level: 8 } }, difficulty: 'normal', log: [{ type: 'end' }], result: 'victory', ...more });

  it('keeps only a complete record, without extra fields', () => {
    expect(watchable(fight({ extra: 1 }))).toEqual(fight());
    expect(watchable(fight({ seed: 'x' }))).toBeNull();
    expect(watchable(fight({ result: 'draw' }))).toBeNull();
    expect(watchable(fight({ log: null }))).toBeNull();
    expect(watchable(null)).toBeNull();
  });

  it('drops a record too big to keep', () => {
    expect(watchable(fight({ log: Array.from({ length: 5000 }, () => ({ type: 'move', x: 10, z: 10 })) }))).toBeNull();
  });

  it('goes with the run when it ends, and is then cleared', () => {
    saveLastFight(fight({ result: 'defeat' }));
    expect(loadLastFight().result).toBe('defeat');
    const state = newCampaign('normal');
    state.stats.won = 2;
    recordRun(state, 'abandoned', 7);
    expect(loadHistory()[0].fight).toEqual(fight({ result: 'defeat' }));
    expect(store.has(LAST_FIGHT_KEY)).toBe(false);
    recordRun(state, 'abandoned', 8);
    expect(loadHistory()[0].fight).toBeNull();
  });
});

describe('sharing a won campaign', () => {
  const summary = (over = {}) => ({
    difficulty: 'Hard', level: 8, won: 11, lost: 1, rounds: 84,
    heroes: [{ cls: 'Fighter', downed: 2 }, { cls: 'Wizard', downed: 1 }, { cls: 'Rogue', downed: 0 }, { cls: 'Cleric', downed: 0 }],
    ...over,
  });

  it('writes the difficulty, the rooms, the party and its falls', () => {
    expect(runShareText(summary())).toBe([
      'Crypt Skirmish: the crypt cleared on Hard',
      '11 rooms won, 1 fight lost, 84 rounds',
      'Fighter, Wizard, Rogue and Cleric, level 8',
      'Heroes fell 3 times 💀',
      'https://fatihsenel.github.io/crypt-skirmish/',
    ].join('\n'));
  });

  it('celebrates a run with no losses and no falls', () => {
    const text = runShareText(summary({ lost: 0, heroes: summary().heroes.map((h) => ({ ...h, downed: 0 })) }));
    expect(text).toContain('11 rooms won, no fight lost, 84 rounds');
    expect(text).toContain('No hero ever fell 🛡️');
  });
});
