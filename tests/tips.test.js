import { describe, it, expect } from 'vitest';
import { pickTip, TIPS } from '../src/ui/tips.js';

const hero = (over = {}) => ({ name: 'Brannoc', hp: 20, maxHp: 20, potions: 1, spells: [], slots: {}, actionUsed: false, ...over });

describe('tips for new players', () => {
  it('starts with how to move, then waits for the next turn for the rest', () => {
    const seen = new Set();
    const first = pickTip('heroTurn', { unit: hero(), chestInSight: true }, seen);
    expect(first.id).toBe('move');
    seen.add(first.id);
    expect(pickTip('heroTurn', { unit: hero(), chestInSight: true }, seen).id).toBe('chest');
  });

  it('shows each tip only once', () => {
    const seen = new Set(TIPS.map((t) => t.id));
    expect(pickTip('heroTurn', { unit: hero() }, seen)).toBeNull();
    expect(pickTip('camp', { report: {} }, seen)).toBeNull();
  });

  it('fits the tip to what just happened', () => {
    const seen = new Set(['move']);
    expect(pickTip('heroTurn', { unit: hero({ hp: 6 }) }, seen).id).toBe('potion');
    expect(pickTip('heroTurn', { unit: hero({ hp: 6, potions: 0 }) }, seen)).toBeNull();
    expect(pickTip('heroTurn', { unit: hero({ spells: ['magicMissile'], slots: { 1: 2 } }) }, seen).id).toBe('spells');
    expect(pickTip('acted', { unit: hero(), cmd: { type: 'move' } }, seen).id).toBe('attack');
    expect(pickTip('acted', { unit: hero({ actionUsed: true }), cmd: { type: 'move' } }, seen)).toBeNull();
    expect(pickTip('acted', { unit: hero(), cmd: { type: 'attack' } }, seen).id).toBe('end');
    expect(pickTip('camp', { report: { rest: 'well' } }, seen)).toBeNull();
    expect(pickTip('camp', { report: { xp: 50 } }, seen).id).toBe('camp');
  });

  it('points out the board and the moves beyond attacking when they fit', () => {
    const seen = new Set(['move']);
    expect(pickTip('heroTurn', { unit: hero(), brazierNext: true }, seen).id).toBe('brazier');
    expect(pickTip('heroTurn', { unit: hero(), waterInSight: true }, seen).id).toBe('water');
    expect(pickTip('heroTurn', { unit: hero(), leverNext: true }, seen).id).toBe('lever');
    expect(pickTip('heroTurn', { unit: hero(), hurtAllyNext: true }, seen).id).toBe('feed');
    expect(pickTip('heroTurn', { unit: hero({ potions: 0 }), hurtAllyNext: true }, seen)).toBeNull();
    expect(pickTip('heroTurn', { unit: hero(), foesComing: true }, seen).id).toBe('ready');
    expect(pickTip('heroTurn', { unit: hero({ actionUsed: true }), foesComing: true }, seen)).toBeNull();
    expect(pickTip('heroTurn', { unit: hero(), foeNext: true }, seen).id).toBe('teamwork');
  });

  it('every tip reads for both mouse and touch', () => {
    const ctx = { unit: hero(), cmd: { type: 'attack' }, report: {} };
    for (const t of TIPS) {
      expect(t.text({ ...ctx, touch: false })).not.toMatch(/undefined/);
      expect(t.text({ ...ctx, touch: true })).not.toMatch(/\bclick\b|Space/i);
    }
  });
});
