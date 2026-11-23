import { describe, it, expect } from 'vitest';
import { dayKey, prevDay, dailyPlan, dailyCampaign, addDaily, streak, better, parseDaily, DAILY_ROOMS, DAILY_ROOMS_ACT_FOUR, ACT_FOUR_DAILY_FROM, DAILY_ROOMS_ACT_FIVE, ACT_FIVE_DAILY_FROM, shareText, keepBest, bestFight, resultFor } from '../src/game/daily.js';
import { NODES } from '../src/game/campaign.js';

describe('daily crypt', () => {
  it('names days and steps back across months and years', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(prevDay('2026-03-01')).toBe('2026-02-28');
    expect(prevDay('2026-01-01')).toBe('2025-12-31');
  });

  it('gives the same plan for the same day, and varies across days', () => {
    expect(dailyPlan('2026-11-18')).toEqual(dailyPlan('2026-11-18'));
    const nodes = new Set();
    let key = '2026-11-18';
    for (let i = 0; i < 60; i++, key = prevDay(key)) nodes.add(dailyPlan(key).node);
    expect(nodes.size).toBeGreaterThan(5);
  });

  it('only picks fight rooms, never the final one', () => {
    for (const [node] of DAILY_ROOMS_ACT_FOUR) expect(NODES[node].kind).toBe('fight');
    expect(DAILY_ROOMS_ACT_FOUR.map(([n]) => n)).not.toContain('tomb');
  });

  it('draws act four rooms only from the cutoff date, so past dailies never change', () => {
    let key = prevDay(ACT_FOUR_DAILY_FROM);
    for (let i = 0; i < 90; i++, key = prevDay(key)) {
      const plan = dailyPlan(key);
      expect([plan.node, plan.level]).toEqual(DAILY_ROOMS[plan.seed % DAILY_ROOMS.length]);
    }
    const later = new Set();
    for (let i = 0, k = ACT_FOUR_DAILY_FROM; i < 120; i++) {
      later.add(dailyPlan(k).node);
      const [y, m, d] = k.split('-').map(Number);
      k = dayKey(new Date(y, m - 1, d + 1));
    }
    expect(['throne', 'halls', 'armory'].filter((n) => later.has(n))).toEqual(['throne', 'halls', 'armory']);
  });

  it('draws act five’s rooms (and the Tomb) only from 30 November, never the Labyrinth', () => {
    let key = prevDay(ACT_FIVE_DAILY_FROM);
    for (let i = 0; i < 10; i++, key = prevDay(key)) {
      const plan = dailyPlan(key);
      expect([plan.node, plan.level]).toEqual(DAILY_ROOMS_ACT_FOUR[plan.seed % DAILY_ROOMS_ACT_FOUR.length]);
    }
    for (const [node] of DAILY_ROOMS_ACT_FIVE) expect(NODES[node].kind).toBe('fight');
    expect(DAILY_ROOMS_ACT_FIVE.map(([n]) => n)).not.toContain('labyrinth');
    const later = new Set();
    for (let i = 0, k = ACT_FIVE_DAILY_FROM; i < 120; i++) {
      later.add(dailyPlan(k).node);
      const [y, m, d] = k.split('-').map(Number);
      k = dayKey(new Date(y, m - 1, d + 1));
    }
    expect(['tomb', 'bridge', 'lair'].filter((n) => later.has(n))).toEqual(['tomb', 'bridge', 'lair']);
  });

  it('builds a level 8 party for the Armory', () => {
    expect(dailyCampaign({ level: 8, classes: {} }).party.W.level).toBe(8);
  });

  it('builds a rested party at the plan level', () => {
    const plan = { ...dailyPlan('2026-11-18'), level: 5, classes: { F: 'P' } };
    const state = dailyCampaign(plan);
    expect(state.party.F.level).toBe(5);
    expect(state.party.F.cls).toBe('P');
  });

  it('keeps the best result of the day and counts tries', () => {
    let r = addDaily({}, '2026-11-18', { won: false, rounds: 4, downed: 4, node: 'crypt' });
    r = addDaily(r, '2026-11-18', { won: true, rounds: 9, downed: 1, node: 'crypt' });
    r = addDaily(r, '2026-11-18', { won: true, rounds: 12, downed: 0, node: 'crypt' });
    expect(r['2026-11-18']).toMatchObject({ won: true, rounds: 9, downed: 1, tries: 3 });
    expect(better({ won: true, rounds: 9, downed: 0 }, { won: true, rounds: 9, downed: 1 })).toBe(true);
  });

  it('starts afresh when the day’s or week’s room changes (a rules change moved it)', () => {
    let r = addDaily({}, '2026-11-16', { won: true, rounds: 6, downed: 0, node: 'sanctum' });
    expect(resultFor(r, '2026-11-16', 'sanctum')).toMatchObject({ rounds: 6 });
    expect(resultFor(r, '2026-11-16', 'crypt')).toBeNull();
    expect(resultFor({ '2026-11-16': { won: true, rounds: 6 } }, '2026-11-16', 'crypt')).toMatchObject({ rounds: 6 }); // no room kept: trusted
    r = addDaily(r, '2026-11-16', { won: false, rounds: 9, downed: 4, node: 'crypt' });
    expect(r['2026-11-16']).toMatchObject({ won: false, rounds: 9, node: 'crypt', tries: 1 });
  });

  it('counts a streak of days won, ending today or yesterday', () => {
    const w = { won: true, rounds: 5, downed: 0 };
    const r = { '2026-11-15': w, '2026-11-16': w, '2026-11-17': w };
    expect(streak(r, '2026-11-18')).toBe(3);
    expect(streak({ ...r, '2026-11-18': w }, '2026-11-18')).toBe(4);
    expect(streak({ ...r, '2026-11-16': { ...w, won: false } }, '2026-11-18')).toBe(1);
    expect(streak(r, '2026-11-20')).toBe(0);
  });

  it('reads stored results safely', () => {
    expect(parseDaily('nope')).toEqual({});
    expect(parseDaily('{"2026-11-18":{"won":true,"rounds":3},"x":{"won":true,"rounds":1}}'))
      .toEqual({ '2026-11-18': { won: true, rounds: 3 } });
  });
});

describe('sharing a daily', () => {
  const base = { key: '2026-11-19', room: 'The Haunted Gallery', level: 6, rounds: 7 };

  it('writes the day, the room, how it went and a mark per hero', () => {
    expect(shareText({ ...base, marks: ['up', 'up', 'up', 'up'], streak: 3 })).toBe([
      'Crypt Skirmish daily, 19 Nov 2026',
      'The Haunted Gallery, party level 6',
      'Won in 7 rounds, nobody fell',
      '🛡️🛡️🛡️🛡️',
      'Streak: 3 days',
      'https://fatihsenel.github.io/crypt-skirmish/',
    ].join('\n'));
  });

  it('counts who fell and leaves out a one-day streak', () => {
    const text = shareText({ ...base, rounds: 1, marks: ['up', 'fell', 'up', 'fell'], streak: 1 });
    expect(text).toContain('Won in 1 round, 2 of 4 fell');
    expect(text).toContain('🛡️💀🛡️💀');
    expect(text).not.toContain('Streak');
  });
});

describe('the best daily and weekly fight', () => {
  const fight = (n) => ({ node: 'crypt', seed: n, party: { F: {} }, difficulty: 'normal', log: [{ type: 'end' }], result: 'victory' });
  const win = (rounds, downed = 0) => ({ won: true, rounds, downed });

  it('keeps the best win of the day, and only a win', () => {
    let kept = keepBest({}, 'daily', '2026-11-20', { won: false, rounds: 9, downed: 4 }, { ...fight(1), result: 'defeat' });
    expect(bestFight(kept, 'daily', '2026-11-20')).toBeNull();
    kept = keepBest(kept, 'daily', '2026-11-20', win(8), fight(2));
    kept = keepBest(kept, 'daily', '2026-11-20', win(9), fight(3)); // slower: not kept
    expect(bestFight(kept, 'daily', '2026-11-20').seed).toBe(2);
    kept = keepBest(kept, 'daily', '2026-11-20', win(6), fight(4));
    expect(bestFight(kept, 'daily', '2026-11-20').seed).toBe(4);
  });

  it('forgets another day’s fight, and keeps daily and weekly apart', () => {
    let kept = keepBest({}, 'daily', '2026-11-19', win(3), fight(1));
    kept = keepBest(kept, 'weekly', '2026-11-16', win(12), fight(2));
    expect(bestFight(kept, 'daily', '2026-11-20')).toBeNull();
    kept = keepBest(kept, 'daily', '2026-11-20', win(10), fight(3)); // a slower win on a new day still counts
    expect(bestFight(kept, 'daily', '2026-11-20').seed).toBe(3);
    expect(bestFight(kept, 'weekly', '2026-11-16').seed).toBe(2);
  });

  it('forgets a fight from another room, for the same week', () => {
    let kept = keepBest({}, 'weekly', '2026-11-16', win(3), { ...fight(1), node: 'sanctum' });
    expect(bestFight(kept, 'weekly', '2026-11-16', 'crypt')).toBeNull();
    expect(bestFight(kept, 'weekly', '2026-11-16', 'sanctum').seed).toBe(1);
    kept = keepBest(kept, 'weekly', '2026-11-16', win(10), fight(2)); // slower, but the week's room now
    expect(bestFight(kept, 'weekly', '2026-11-16', 'crypt').seed).toBe(2);
  });

  it('keeps nothing it couldn’t replay', () => {
    expect(keepBest({}, 'daily', '2026-11-20', win(5), { node: 'crypt' })).toEqual({});
  });
});
