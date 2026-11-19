import { describe, it, expect } from 'vitest';
import { dayKey, prevDay, dailyPlan, dailyCampaign, addDaily, streak, better, parseDaily, DAILY_ROOMS, DAILY_ROOMS_ACT_FOUR, ACT_FOUR_DAILY_FROM } from '../src/game/daily.js';
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
