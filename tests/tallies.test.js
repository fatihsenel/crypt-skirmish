import { describe, it, expect } from 'vitest';
import { readTallies } from '../src/tallies.js';

describe('reading the Worker’s tallies', () => {
  it('adds up totals and property values, and ranks rooms by loss rate', () => {
    const t = readTallies([
      { event: 'fight-won', prop: '', value: '', n: 3 },
      { event: 'fight-won', prop: '', value: '', n: 2 }, // two days
      { event: 'fight-won', prop: 'room', value: 'crypt', n: 5 },
      { event: 'fight-lost', prop: 'room', value: 'crypt', n: 1 },
      { event: 'fight-lost', prop: 'room', value: 'throne', n: 4 },
      { event: 'fight-won', prop: 'room', value: 'throne', n: 1 },
      { event: 'fight-left', prop: 'input', value: 'keys', n: 2 },
      { event: 'fight-won', prop: 'input', value: 'keys', n: 1 },
    ]);
    expect(t.count('fight-won')).toBe(5);
    expect(t.count('nothing')).toBe(0);
    expect(t.values('fight-won', 'room')).toEqual({ crypt: 5, throne: 1 });
    expect(t.rooms.map((r) => r.id)).toEqual(['throne', 'crypt']);
    expect(t.rooms[0]).toMatchObject({ won: 1, lost: 4, left: 0, rate: 0.8 });
    expect(t.worst.id).toBe('throne'); // 5 fights
    expect(t.inputs).toEqual({ keys: 3 });
  });

  it('names no worst room under 5 fights, and skips junk rows', () => {
    const t = readTallies([null, { event: 'fight-lost', prop: 'room', value: 'crypt', n: 4 }, { event: 'x', prop: '', value: '', n: 'many' }]);
    expect(t.worst).toBeNull();
    expect(t.count('x')).toBe(0);
    expect(readTallies('nope').rooms).toEqual([]);
  });
});
