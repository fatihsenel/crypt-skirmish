import { describe, it, expect } from 'vitest';
import { ACHIEVEMENTS, earned, parseAchievements } from '../src/game/achievements.js';
import { newCampaign } from '../src/game/campaign.js';

const fight = (over = {}) => ({
  round: 6, stats: {}, units: [], grid: { chests: new Map() }, ...over,
});
const ids = (list) => list.map((a) => a.id);

describe('achievements', () => {
  it('has unique ids', () => {
    expect(new Set(ids(ACHIEVEMENTS)).size).toBe(ACHIEVEMENTS.length);
  });

  it('a first room win earns only the first-room one', () => {
    expect(ids(earned('room', { game: fight(), node: 'crypt' }, {}))).toEqual(['first-room']);
  });

  it('skips what is already unlocked', () => {
    expect(earned('room', { game: fight(), node: 'crypt' }, { 'first-room': 1 })).toEqual([]);
  });

  it('checks the room goals', () => {
    const chests = new Map([['a', { opened: true }], ['b', { mimic: true }]]);
    const game = fight({
      round: 3,
      stats: { F: { crits: 2, downed: 0 }, R: { crits: 1, downed: 0 } },
      units: [{ cls: 'Mimic', alive: false }],
      grid: { chests },
    });
    expect(ids(earned('room', { game, node: 'sanctum' }, { 'first-room': 1 })))
      .toEqual(['swift', 'crits', 'thorough', 'mimic', 'clean-boss', 'act-one']);
    // A hero falling spoils the clean boss kill; an unopened chest spoils Thorough.
    game.stats.F.downed = 1;
    chests.set('c', { opened: false });
    expect(ids(earned('room', { game, node: 'barrow' }, {}))).not.toContain('clean-boss');
    expect(ids(earned('room', { game, node: 'barrow' }, {}))).not.toContain('thorough');
  });

  it('checks the run goals', () => {
    const state = newCampaign('hard', {}, { F: 'P' });
    expect(ids(earned('run', { state }, {}))).toEqual(['campaign', 'hard', 'unbroken', 'new-blood']);
    state.stats.lost = 1;
    expect(ids(earned('run', { state: { ...newCampaign('normal'), stats: state.stats } }, {}))).toEqual(['campaign']);
  });

  it('reads stored unlocks safely', () => {
    expect(parseAchievements('junk')).toEqual({});
    expect(parseAchievements('[1]')).toEqual({});
    expect(parseAchievements('{"swift":5,"nope":1,"hard":"x"}')).toEqual({ swift: 5 });
  });
});
