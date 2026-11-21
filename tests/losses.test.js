import { describe, it, expect } from 'vitest';
import { summaryRows } from '../src/ui/losses.js';

describe('the ?losses summary', () => {
  it('puts each room on one row, by difficulty, the most losses first', () => {
    const rows = summaryRows([
      { room: 'crypt', difficulty: 'normal', week: 1, month: 2 },
      { room: 'throne', difficulty: 'hard', week: 3, month: 9 },
      { room: 'throne', difficulty: 'story', week: 0, month: 1 },
      { room: 'crypt', difficulty: 'hard', week: 0, month: 0 },
    ]);
    expect(rows.map((r) => r.room)).toEqual(['throne', 'crypt']);
    expect(rows[0]).toMatchObject({ week: 3, month: 10, by: { hard: { week: 3, month: 9 }, story: { week: 0, month: 1 } } });
    expect(rows[0].by.normal).toBeUndefined();
    expect(rows[1]).toMatchObject({ week: 1, month: 2 });
  });

  it('breaks ties by the last 7 days, then by campaign order', () => {
    const rows = summaryRows([
      { room: 'throne', difficulty: 'hard', week: 1, month: 4 },
      { room: 'crypt', difficulty: 'hard', week: 2, month: 4 },
      { room: 'sanctum', difficulty: 'hard', week: 1, month: 4 },
    ]);
    expect(rows.map((r) => r.room)).toEqual(['crypt', 'sanctum', 'throne']);
  });

  it('copes with nothing and with junk', () => {
    expect(summaryRows([])).toEqual([]);
    expect(summaryRows(undefined)).toEqual([]);
    expect(summaryRows([{ room: 'x', difficulty: 'hard', week: '2', month: null }])).toEqual([]);
  });
});
