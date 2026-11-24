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

  it('marks New Game+ wins, and the third tier deeper still', () => {
    const run = (tier) => ids(earned('run', { state: { ...newCampaign('normal'), tier } }, {}));
    expect(run(0)).not.toContain('ngplus');
    expect(run(1)).toContain('ngplus');
    expect(run(2)).not.toContain('ngplus3');
    expect(run(3)).toEqual(expect.arrayContaining(['ngplus', 'ngplus3']));
  });

  it('marks elites slain, a Relentless one finished in time, and every trait', () => {
    const got = (game, ctx = {}) => ids(earned('room', { game, node: 'crypt', ...ctx }, { 'first-room': 1 }));
    expect(got(fight({ units: [{ team: 'monsters', alive: false }] }))).toEqual([]);
    expect(got(fight({ units: [{ team: 'monsters', elite: 'swift', alive: false }] }))).toEqual(['elite']);
    expect(got(fight(), { feats: { stayDown: true } })).toEqual(['stay-down']);
    expect(got(fight(), { eliteKinds: 5 })).toEqual([]);
    expect(got(fight(), { eliteKinds: 6 })).toEqual(['elite-hunter']);
  });

  it('a first room win earns only the first-room one', () => {
    expect(ids(earned('room', { game: fight(), node: 'crypt' }, {}))).toEqual(['first-room']);
  });

  it('counts the bestiary when a room is won', () => {
    const base = { game: fight(), node: 'crypt' };
    const got = (ctx) => ids(earned('room', { ...base, ...ctx }, { 'first-room': 1 }));
    expect(got({ met: 19, slain: 99 })).toEqual([]);
    expect(got({ met: 20, slain: 100 })).toEqual(['scholar', 'exterminator']);
    expect(got({})).toEqual([]);
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
    expect(ids(earned('run', { state }, {}))).toEqual(['campaign', 'hard', 'unbroken', 'iron', 'new-blood']);
    state.stats.lost = 1;
    expect(ids(earned('run', { state: { ...newCampaign('normal'), stats: state.stats } }, {}))).toEqual(['campaign', 'iron']);
  });

  it('reads stored unlocks safely', () => {
    expect(parseAchievements('junk')).toEqual({});
    expect(parseAchievements('[1]')).toEqual({});
    expect(parseAchievements('{"swift":5,"nope":1,"hard":"x"}')).toEqual({ swift: 5 });
  });
});

describe('newer achievements', () => {
  const won = { 'first-room': 1 };
  it('counts a big hit, sneak attacks, healing and a one-hero sweep', () => {
    const game = fight({ stats: { R: { kills: 4, healing: 0 }, C: { kills: 0, healing: 31 } }, units: [{ team: 'heroes', alive: true }, { team: 'heroes', alive: true }] });
    expect(ids(earned('room', { game, node: 'crypt', feats: { maxHit: 25, sneaks: 4 } }, won)))
      .toEqual(['heavy-blow', 'sneaky', 'medic', 'one-hero']);
  });
  it('counts the board and the new actions: a readied kill, coals, a hold, a helped blow', () => {
    const game = fight({ units: [{ team: 'heroes', alive: true }, { team: 'heroes', alive: true }] });
    expect(ids(earned('room', { game, node: 'crypt', feats: { held: true, coals: true, pinned: true, teamwork: true, edge: true, caught: true, stairs: true } }, won)))
      .toEqual(['hold-door', 'hot-coals', 'edge', 'stairs-push', 'fingertips', 'pinned', 'teamwork']);
  });
  it('knows a last stand, and needs four kills for a sweep', () => {
    const game = fight({ stats: { R: { kills: 3 } }, units: [{ team: 'heroes', alive: true }, { team: 'heroes', alive: false }] });
    expect(ids(earned('room', { game, node: 'crypt' }, won))).toEqual(['last-stand']);
  });
  it('leaves the act goals to the campaign', () => {
    expect(ids(earned('room', { game: fight(), node: 'barrow', daily: true }, won))).toEqual(['clean-boss']);
  });
  it('knows a Death Ward save and a run through the Black Armory', () => {
    expect(ids(earned('room', { game: fight({ stats: { C: { warded: 1 } } }), node: 'halls' }, won))).toEqual(['warded']);
    const state = { ...newCampaign('normal'), cleared: ['halls', 'armory', 'tomb'] };
    state.stats.lost = 1;
    state.stats.heroes = { F: { downed: 1 } };
    expect(ids(earned('run', { state }, {}))).toEqual(['no-rest', 'campaign']);
  });
  it('rewards a weekly elite crypt won, and three weeks in a row', () => {
    expect(ids(earned('weekly', { streak: 1 }, {}))).toEqual(['weekly']);
    expect(ids(earned('weekly', { streak: 2 }, { weekly: 1 }))).toEqual([]);
    expect(ids(earned('weekly', { streak: 3 }, { weekly: 1 }))).toEqual(['weekly-streak']);
  });

  it('rewards daily wins and a three-day streak', () => {
    expect(ids(earned('daily', { streak: 1 }, {}))).toEqual(['daily']);
    expect(ids(earned('daily', { streak: 3 }, { daily: 1 }))).toEqual(['daily-streak']);
  });
});
