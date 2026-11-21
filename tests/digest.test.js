import { describe, it, expect } from 'vitest';
import { buildDigest, readKeys } from '../scripts/digest.mjs';

const NOW = Date.UTC(2026, 10, 23, 9); // Monday 23 Nov 2026, 09:00 UTC

/** Rows as the Worker's /tallies gives them: an event's total, then one row a property value. */
function rows(spec) {
  const out = [];
  for (const [event, total, props = {}] of spec) {
    out.push({ event, prop: '', value: '', n: total });
    for (const [prop, values] of Object.entries(props)) for (const [value, n] of Object.entries(values)) out.push({ event, prop, value, n });
  }
  return out;
}

const WEEK = rows([
  ['visit', 180, { returning: { true: 70, false: 110 } }],
  ['run-start', 40], ['run-continue', 25], ['campaign-won', 3], ['daily-start', 30],
  ['fight-won', 29, { room: { crypt: 18, throne: 11 }, input: { touch: 20, mouse: 9 } }],
  ['fight-lost', 12, { room: { throne: 9, crypt: 2, well: 1 }, input: { touch: 8, keys: 4 } }],
  ['fight-left', 3, { room: { throne: 3 }, input: { touch: 3 } }],
  ['error', 6, { browser: { safari: 5, chrome: 1 }, at: { 'main-CahFguWJ.js:2:5847': 6 } }],
  ['perf', 40, { fps: { '50+': 30, 'under 30': 10 } }],
]);

// The 14 days: this week plus the week before (150 visits, 30 runs, 20 won, 15 lost, 2 crashes).
const FORTNIGHT = [...WEEK, ...rows([['visit', 150], ['run-start', 30], ['fight-won', 20], ['fight-lost', 15], ['error', 2]])];

/** A stand-in for the Worker: answers by path, and records each call. */
function fakeFetch({ ok = true, tallies = WEEK, before = FORTNIGHT, umami = true } = {}) {
  const calls = [];
  const fetch = async (url, { headers } = {}) => {
    const u = new URL(url);
    calls.push({ url: u, auth: headers?.Authorization, umamiKey: headers?.['x-umami-api-key'] });
    if (!ok) return { ok: false, status: 401, json: async () => ({}) };
    if (u.host === 'api.umami.is') {
      if (umami !== true) return { ok: false, status: umami, json: async () => ({}) };
      if (headers?.['x-umami-api-key'] !== 'u-key') return { ok: false, status: 401, json: async () => ({}) };
      const umamiBody = u.pathname.endsWith('/stats') ? { pageviews: 200, visitors: { value: 120, prev: 90 }, visits: 150 }
        : u.pathname.endsWith('/metrics') ? [{ x: '', y: 60 }, { x: 'reddit.com', y: 40 }] : null;
      return { ok: true, status: 200, json: async () => umamiBody };
    }
    const body = u.pathname === '/tallies' ? { tallies: u.searchParams.get('days') === '14' ? before : tallies }
      : u.pathname === '/summary' ? { rooms: [{ room: 'throne', difficulty: 'hard', week: 5, month: 9 }, { room: 'crypt', difficulty: 'normal', week: 2, month: 2 }] }
        : null;
    return body ? { ok: true, status: 200, json: async () => body } : { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetch, calls };
}

describe('the weekly digest', () => {
  it('sums up the week from the Worker: visits, runs, fights by room, crashes, play and losses', async () => {
    const { fetch, calls } = fakeFetch();
    const text = await buildDigest({ fetch, keys: { losses: 'l-key' }, now: NOW });
    expect(text).toMatch(/^# Crypt Skirmish: the week to 23 Nov 2026/);
    expect(text).toContain('In brackets: the change from the week before.');
    expect(text).toContain('180 (+30) visits, 70 from players who had played before.');
    expect(text).toContain('40 (+10) runs started, 25 (+25) continued, 3 (+3) campaigns won, 30 (+30) dailies started.');
    expect(text).toContain('41 fights ended: 29 (+9) won, 12 (−3) lost; 3 (+3) left half-way.');
    // Rooms by loss rate, the worst first; a room with fewer than 5 fights is listed but not named worst.
    expect(text).toContain('| The Weeping Throne | 11 | 9 | 3 | 45% |');
    expect(text.indexOf('The Weeping Throne |')).toBeLessThan(text.indexOf('The Crypt Door |'));
    expect(text).toContain('Worst room: The Weeping Throne, 9 of 20 fights lost (45%).');
    expect(text).toContain('6 (+4) crashes: safari 5, chrome 1. Where: main-CahFguWJ.js:2:5847 6.');
    expect(text).toContain('Input: touch 70%, mouse 20%, keys 9%.');
    expect(text).toContain('Frame rate: 50+ 75%, under 30 25% (40 visits).');
    expect(text).toContain('7 losses stored, most in The Weeping Throne (5).');
    // Two calls, both with the read key; the tallies cover 7 days.
    expect(calls.map((c) => `${c.url.pathname}${c.url.search}`)).toEqual(['/tallies?days=7', '/tallies?days=14', '/summary']); // no Umami key: no Umami calls
    expect(text).not.toContain('Umami');
    expect(calls.every((c) => c.auth === 'Bearer l-key')).toBe(true);
  });

  it('adds Umami’s visitors, page views and referrers when its key is set', async () => {
    const { fetch, calls } = fakeFetch();
    const text = await buildDigest({ fetch, keys: { losses: 'l-key', umami: 'u-key' }, now: NOW });
    expect(text).toContain('## Visitors (Umami)');
    expect(text).toContain('120 visitors, 150 visits, 200 page views.');
    expect(text).toContain('Came from: (direct) 60, reddit.com 40.');
    const umami = calls.filter((c) => c.url.host === 'api.umami.is');
    expect(umami.every((c) => c.umamiKey === 'u-key' && !c.auth)).toBe(true); // its own key, never the read key
    expect(umami.every((c) => c.url.pathname.startsWith('/v1/websites/90fc36a8-7d1b-4488-bbcd-2cba1311156d/'))).toBe(true);
    expect(umami.every((c) => Number(c.url.searchParams.get('endAt')) === NOW && Number(c.url.searchParams.get('startAt')) === NOW - 7 * 86_400_000)).toBe(true);
    // Umami alone, without the Worker's key; and a refused Umami key is said.
    const alone = await buildDigest({ fetch, keys: { losses: null, umami: 'u-key' }, now: NOW });
    expect(alone).toContain('No read key (LOSS_READ_KEY)');
    expect(alone).toContain('120 visitors');
    const refused = await buildDigest({ fetch: fakeFetch({ umami: 401 }).fetch, keys: { losses: 'l-key', umami: 'u-key' }, now: NOW });
    expect(refused).toContain('Umami refused the key (401): left out.');
    expect(refused).toContain('7 losses stored');
  });

  it('says what it could not read', async () => {
    expect(await buildDigest({ fetch: fakeFetch().fetch, keys: { losses: null }, now: NOW })).toContain('No read key (LOSS_READ_KEY)');
    const refused = await buildDigest({ fetch: fakeFetch({ ok: false }).fetch, keys: { losses: 'l' }, now: NOW });
    expect(refused).toContain('The Worker refused the read key (401): play stats left out.');
    expect(refused).toContain('The Worker refused the read key (401).');
    const offline = await buildDigest({ fetch: async () => { throw new Error('offline'); }, keys: { losses: 'l' }, now: NOW });
    expect(offline).toContain('Couldn’t reach the Worker');
  });

  it('says so when nothing happened', async () => {
    const empty = async (url) => {
      const body = new URL(url).pathname === '/summary' ? { rooms: [] } : { tallies: [] };
      return { ok: true, status: 200, json: async () => body };
    };
    const text = await buildDigest({ fetch: empty, keys: { losses: 'l' }, now: NOW });
    expect(text).toContain('0 (+0) visits, 0 from players who had played before.');
    expect(text).toContain('No crashes.');
    expect(text).toContain('No fights ended this week.');
    expect(text).toContain('Nothing recorded yet.');
    expect(text).toContain('No losses stored.');
  });

  it('reads the key from the environment only', () => {
    expect(readKeys({ LOSS_READ_KEY: 'a', UMAMI_API_KEY: 'b' })).toEqual({ losses: 'a', umami: 'b' });
    expect(readKeys({ LOSS_READ_KEY: '', UMAMI_API_KEY: '' })).toEqual({ losses: null, umami: null });
    expect(readKeys({})).toEqual({ losses: null, umami: null });
  });
});
