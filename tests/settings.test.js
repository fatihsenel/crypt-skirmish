import { describe, it, expect } from 'vitest';
import { parseSettings, DEFAULT_SETTINGS, SPEEDS, levelGain } from '../src/game/settings.js';

describe('settings', () => {
  it('defaults when nothing is stored or the text is junk', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[1,2]')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and clamps levels to 0..1', () => {
    const s = parseSettings(JSON.stringify({ music: 0.3, effects: 2, voices: -1, speed: 'fastest' }));
    expect(s).toEqual({ music: 0.3, effects: 1, voices: 0, speed: 'fastest', rolls: true, throwDice: true, colorblind: false, motion: 'system' });
  });

  it('drops an unknown speed and non-numeric levels', () => {
    const s = parseSettings(JSON.stringify({ music: 'loud', speed: 'warp' }));
    expect(s.music).toBe(1);
    expect(s.speed).toBe('normal');
  });

  it('keeps the dice switch only when it is a true or false', () => {
    expect(parseSettings(JSON.stringify({ rolls: false })).rolls).toBe(false);
    expect(parseSettings(JSON.stringify({ rolls: 'no' })).rolls).toBe(true);
    expect(parseSettings(JSON.stringify({ throwDice: false })).throwDice).toBe(false);
  });

  it('follows the system’s motion setting unless one is picked', () => {
    expect(parseSettings(null).motion).toBe('system');
    expect(parseSettings(JSON.stringify({ motion: 'reduce' })).motion).toBe('reduce');
    expect(parseSettings(JSON.stringify({ motion: 'full' })).motion).toBe('full');
    expect(parseSettings(JSON.stringify({ motion: 'wild' })).motion).toBe('system');
  });

  it('keeps the colour-blind reach off unless switched on', () => {
    expect(parseSettings(null).colorblind).toBe(false);
    expect(parseSettings(JSON.stringify({ colorblind: true })).colorblind).toBe(true);
    expect(parseSettings(JSON.stringify({ colorblind: 'yes' })).colorblind).toBe(false);
  });

  it('only speeds monster turns up', () => {
    expect(SPEEDS.normal).toBe(1);
    expect(SPEEDS.fast).toBeGreaterThan(1);
    expect(SPEEDS.fastest).toBeGreaterThan(SPEEDS.fast);
  });

  it('maps a slider level to a gain that is silent at 0 and full at 1', () => {
    expect(levelGain(0)).toBe(0);
    expect(levelGain(1)).toBe(1);
    expect(levelGain(0.5)).toBeCloseTo(0.25);
  });
});
