import { describe, it, expect } from 'vitest';
import { nearest } from '../src/gamepad.js';

const r = (left, top, w = 40, h = 20) => ({ left, top, width: w, height: h });

describe('gamepad focus', () => {
  // Three buttons in a row, one under the middle.
  const a = ['a', r(0, 0)];
  const b = ['b', r(100, 0)];
  const c = ['c', r(200, 0)];
  const d = ['d', r(100, 80)];
  const list = [a, b, c, d];

  it('moves to the nearest control that way', () => {
    expect(nearest(list, b[1], 'right')).toBe('c');
    expect(nearest(list, b[1], 'left')).toBe('a');
    expect(nearest(list, b[1], 'down')).toBe('d');
    expect(nearest(list, d[1], 'up')).toBe('b');
  });

  it('prefers a control in line over a nearer one off to the side', () => {
    expect(nearest([['side', r(130, 60)], ['below', r(0, 120)]], a[1], 'down')).toBe('below');
  });

  it('stays put when nothing lies that way', () => {
    expect(nearest(list, c[1], 'right')).toBeNull();
    expect(nearest(list, a[1], 'up')).toBeNull();
  });
});
