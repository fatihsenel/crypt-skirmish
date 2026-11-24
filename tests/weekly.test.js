import { describe, it, expect } from 'vitest';
import {
  weekKey, prevWeek, weeklyPlan, weeklyCampaign, weekStreak, weeklyShareText, WEEKLY_ROOMS, WEEKLY_ROOMS_ACT_FIVE, WEEKLY_ROOMS_TWO_FLOORS, WEEKLY_TIER,
} from '../src/game/weekly.js';
import { ELITE_TRAITS, Game } from '../src/game/combat.js';
import { NODES, roomElite, runDifficulty } from '../src/game/campaign.js';
import { levelById } from '../src/game/maps.js';
import { seeded } from '../src/game/dice.js';
import { heroUnit } from '../src/game/campaign.js';

describe('weekly elite crypt', () => {
  it('keys a week by its Monday', () => {
    expect(weekKey(new Date(2026, 10, 16))).toBe('2026-11-16'); // a Monday
    expect(weekKey(new Date(2026, 10, 20))).toBe('2026-11-16'); // Friday
    expect(weekKey(new Date(2026, 10, 22))).toBe('2026-11-16'); // Sunday
    expect(weekKey(new Date(2026, 10, 23))).toBe('2026-11-23');
    expect(weekKey(new Date(2027, 0, 1))).toBe('2026-12-28'); // across the year
    expect(prevWeek('2026-11-16')).toBe('2026-11-09');
    expect(prevWeek('2027-01-04')).toBe('2026-12-28');
  });

  it('gives the same plan all week, at New Game+ 3', () => {
    const plan = weeklyPlan('2026-11-16');
    expect(weeklyPlan('2026-11-16')).toEqual(plan);
    expect(plan.tier).toBe(WEEKLY_TIER);
    expect(WEEKLY_TIER).toBe(3);
  });

  it('puts the week’s trait on the room’s elite, and every trait comes up', () => {
    const traits = new Set();
    let key = '2026-11-16';
    for (let i = 0; i < 80; i++, key = prevWeek(key)) {
      const plan = weeklyPlan(key);
      expect(WEEKLY_ROOMS.some(([n, l]) => n === plan.node && l === plan.level)).toBe(true);
      expect(roomElite(plan.node, plan.tier).id).toBe(plan.trait);
      traits.add(plan.trait);
    }
    expect(traits).toEqual(new Set(ELITE_TRAITS.map((t) => t.id)));
  });

  it('leaves out rooms too hard for a fresh party at New Game+ 3, and has a room for every trait', () => {
    const nodes = WEEKLY_ROOMS.map(([n]) => n);
    for (const n of ['catacombs', 'vault', 'barrow', 'tomb']) expect(nodes).not.toContain(n);
    for (const t of ELITE_TRAITS) expect(WEEKLY_ROOMS.some(([n]) => roomElite(n, WEEKLY_TIER).id === t.id)).toBe(true);
  });

  it('brings act five’s rooms only from 30 November, so past weeks never change', () => {
    let key = '2026-11-23';
    for (let i = 0; i < 60; i++, key = prevWeek(key)) expect(WEEKLY_ROOMS.map(([n]) => n)).toContain(weeklyPlan(key).node);
    const later = new Set();
    for (let i = 0, d = new Date(2026, 10, 30); i < 60; i++, d.setDate(d.getDate() + 7)) later.add(weeklyPlan(weekKey(d)).node);
    for (const n of ['tomb', 'bridge', 'lair']) expect(WEEKLY_ROOMS_ACT_FIVE.map(([r]) => r)).toContain(n);
    expect(['tomb', 'lair'].every((n) => later.has(n))).toBe(true);
  });

  it('brings the rooms on two floors only from 7 December', () => {
    for (let i = 0, key = '2026-11-30'; i < 30; i++, key = prevWeek(key)) {
      expect(WEEKLY_ROOMS_ACT_FIVE.map(([n]) => n)).toContain(weeklyPlan(key).node);
    }
    expect(WEEKLY_ROOMS_TWO_FLOORS.map(([n]) => n)).toEqual(expect.arrayContaining(['cistern', 'undercroft']));
    const later = new Set();
    for (let i = 0, d = new Date(2026, 11, 7); i < 200; i++, d.setDate(d.getDate() + 7)) later.add(weeklyPlan(weekKey(d)).node);
    expect(['cistern', 'undercroft'].every((n) => later.has(n))).toBe(true);
  });

  it('fights at its tier: the room’s strongest monster is an elite with the week’s trait', () => {
    const plan = weeklyPlan('2026-11-16');
    const state = weeklyCampaign(plan);
    expect(state.tier).toBe(WEEKLY_TIER);
    const party = Object.entries(state.party).map(([code, rec]) => heroUnit(code, rec));
    const game = new Game(levelById(NODES[plan.node].level), { party, difficulty: runDifficulty(state.difficulty, state.tier), rng: seeded(plan.seed) });
    expect(game.units.filter((u) => u.elite).map((u) => u.elite)).toEqual([plan.trait]);
  });

  it('counts weeks won in a row', () => {
    const won = { won: true, rounds: 5, downed: 0 };
    const results = { '2026-11-02': won, '2026-11-09': won, '2026-10-26': { ...won, won: false } };
    expect(weekStreak(results, '2026-11-16')).toBe(2); // this week not won yet
    expect(weekStreak({ ...results, '2026-11-16': won }, '2026-11-16')).toBe(3);
    expect(weekStreak(results, '2026-11-23')).toBe(0); // a week was missed
  });

  it('shares a won week as text', () => {
    const text = weeklyShareText({ key: '2026-11-16', room: 'The Larder', trait: 'Frenzied', level: 5, rounds: 7, marks: ['ok', 'fell', 'ok', 'ok'], streak: 2 });
    expect(text).toContain('Crypt Skirmish weekly elite, week of 16 Nov 2026');
    expect(text).toContain('The Larder, Frenzied elite, party level 5, New Game+ 3');
    expect(text).toContain('Won in 7 rounds, 1 of 4 fell');
    expect(text).toContain('Streak: 2 weeks');
  });
});
