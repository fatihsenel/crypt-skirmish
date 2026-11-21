import { describe, it, expect } from 'vitest';
import { crashCheck } from '../scripts/crash-check.mjs';

const NOW = Date.UTC(2026, 10, 22, 6); // 22 Nov 2026, 06:00 UTC

describe('the daily crash check', () => {
  it('counts yesterday’s crashes, with the read key', async () => {
    const calls = [];
    const fetch = async (url, { headers }) => {
      calls.push({ url: new URL(url), auth: headers.Authorization });
      return { ok: true, json: async () => ({ tallies: [{ event: 'error', prop: '', value: '', n: 3 }, { event: 'error', prop: 'browser', value: 'safari', n: 3 }, { event: 'visit', prop: '', value: '', n: 50 }] }) };
    };
    expect(await crashCheck({ fetch, key: 'k', now: NOW })).toEqual({ day: '2026-11-21', crashes: 3 });
    expect(calls[0].url.pathname).toBe('/tallies');
    expect(calls[0].url.searchParams.get('day')).toBe('2026-11-21');
    expect(calls[0].auth).toBe('Bearer k');
  });

  it('says none, and says when it could not read the Worker', async () => {
    const empty = async () => ({ ok: true, json: async () => ({ tallies: [] }) });
    expect(await crashCheck({ fetch: empty, key: 'k', now: NOW })).toEqual({ day: '2026-11-21', crashes: 0 });
    expect((await crashCheck({ fetch: empty, key: null, now: NOW })).error).toMatch(/No read key/);
    expect((await crashCheck({ fetch: async () => ({ ok: false, status: 401 }), key: 'k', now: NOW })).error).toMatch(/refused the read key \(401\)/);
    expect((await crashCheck({ fetch: async () => { throw new Error('x'); }, key: 'k', now: NOW })).error).toMatch(/Couldn’t reach/);
  });
});
