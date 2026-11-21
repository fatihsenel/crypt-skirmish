import { describe, it, expect } from 'vitest';
import { summaryRows, statsHtml } from '../src/ui/losses.js';

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

describe('the ?losses play stats', () => {
  const rows = [
    { event: 'visit', prop: '', value: '', n: 12 },
    { event: 'run-start', prop: '', value: '', n: 4 },
    { event: 'fight-won', prop: '', value: '', n: 6 },
    { event: 'fight-won', prop: 'room', value: 'crypt', n: 6 },
    { event: 'fight-won', prop: 'input', value: 'touch', n: 6 },
    { event: 'fight-lost', prop: '', value: '', n: 2 },
    { event: 'fight-lost', prop: 'room', value: 'throne', n: 2 },
    { event: 'fight-lost', prop: 'input', value: 'mouse', n: 2 },
    { event: 'error', prop: '', value: '', n: 1 },
    { event: 'error', prop: 'browser', value: 'safari', n: 1 },
    { event: 'error', prop: 'at', value: 'main-x.js:2:5', n: 1 },
    { event: 'perf', prop: 'fps', value: '50+', n: 3 },
  ];

  it('shows the totals, each room with its loss rate, crashes and how they play', () => {
    const html = statsHtml(rows);
    expect(html).toContain('12 visits, 4 runs started');
    expect(html).toContain('8 ended: 6 won, 2 lost; 0 left half-way.');
    expect(html).toMatch(/data-room="throne">The Weeping Throne<\/button><\/th><td>0<\/td><td>2<\/td><td>0<\/td><td>100%/);
    expect(html.indexOf('data-room="throne"')).toBeLessThan(html.indexOf('data-room="crypt"')); // the worst first
    expect(html).toContain('1: safari 1. Where: main-x.js:2:5 1.');
    expect(html).toContain('touch 75%, mouse 25%.');
    expect(html).toContain('50+ 100% (3 visits).');
  });

  it('says so when nothing happened, and escapes what the Worker sends', () => {
    const empty = statsHtml([]);
    expect(empty).toContain('none ended.');
    expect(empty).toContain('<b>Crashes</b> none.');
    expect(empty).not.toContain('Input');
    expect(statsHtml(undefined)).toContain('0 visits');
    const odd = statsHtml([{ event: 'error', prop: '', value: '', n: 1 }, { event: 'error', prop: 'at', value: '<img src=x>', n: 1 }]);
    expect(odd).not.toContain('<img');
  });
});
