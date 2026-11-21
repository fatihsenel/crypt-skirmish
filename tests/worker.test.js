import { describe, it, expect } from 'vitest';
import worker, { checkLoss, listQuery, GAME, MAX_CODE, KEEP_DAYS } from '../worker/src/index.js';

/** A stand-in for the D1 binding: records each statement and returns `rows` from all(). */
function fakeDB(rows = []) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, args: [] };
      calls.push(call);
      const stmt = {
        bind: (...args) => { call.args = args; return stmt; },
        run: async () => ({ success: true }),
        all: async () => ({ results: rows }),
      };
      return stmt;
    },
  };
}

const good = { code: 'abc_DEF-123', room: 'throne', difficulty: 'hard', tier: 1, mode: 'campaign', rounds: 7 };
const post = (body, origin = GAME) => new Request('https://w.example/loss', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body: typeof body === 'string' ? body : JSON.stringify(body),
});
const get = (query = '', key = 'sekrit', origin = GAME) => new Request(`https://w.example/losses${query}`, {
  headers: { Origin: origin, ...(key && { Authorization: `Bearer ${key}` }) },
});

describe('loss replay worker', () => {
  it('checks an upload field by field', () => {
    expect(checkLoss(good)).toEqual({ row: good });
    expect(checkLoss({ ...good, extra: 'x' }).row).not.toHaveProperty('extra');
    for (const [k, v] of [['code', ''], ['code', 'a'.repeat(MAX_CODE + 1)], ['code', 'has space'], ['room', 'Throne'], ['room', '../x'],
      ['difficulty', 'nightmare'], ['tier', -1], ['tier', 1.5], ['mode', 'challenge'], ['rounds', 0], ['rounds', '7']]) {
      expect(checkLoss({ ...good, [k]: v }).error, `${k}=${v}`).toBe(k);
    }
    expect(checkLoss(null).error).toBeTruthy();
  });

  it('stores an upload from the game, and refuses other sites and junk', async () => {
    const db = fakeDB();
    const ok = await worker.fetch(post(good), { DB: db });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(GAME);
    expect(db.calls[0].sql).toMatch(/^INSERT INTO losses/);
    expect(db.calls[0].args.slice(1)).toEqual(['throne', 'hard', 1, 'campaign', 7, 'abc_DEF-123']);
    expect((await worker.fetch(post(good, 'https://evil.example'), { DB: db })).status).toBe(403);
    expect((await worker.fetch(post(good, 'http://localhost:5173'), { DB: db })).status).toBe(403); // the dev server reads, never writes
    expect((await worker.fetch(post('{oops'), { DB: db })).status).toBe(400);
    expect((await worker.fetch(post({ ...good, mode: 'x' }), { DB: db })).status).toBe(400);
    expect((await worker.fetch(post('x'.repeat(MAX_CODE + 600)), { DB: db })).status).toBe(413);
    expect(db.calls).toHaveLength(1);
  });

  it('lists losses only with the key, newest first, filtered', async () => {
    const rows = [{ id: 9, room: 'throne' }];
    const db = fakeDB(rows);
    const env = { DB: db, READ_KEY: 'sekrit' };
    expect((await worker.fetch(get('', null), env)).status).toBe(401);
    expect((await worker.fetch(get('', 'wrong'), env)).status).toBe(401);
    expect((await worker.fetch(get('', 'sekrit'), { DB: db })).status).toBe(401); // no key set: nobody reads
    const res = await worker.fetch(get('?room=throne&difficulty=hard&before=20&limit=10'), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ losses: rows });
    const last = db.calls.at(-1);
    expect(last.sql).toMatch(/WHERE room = \? AND difficulty = \? AND id < \? ORDER BY id DESC LIMIT \?$/);
    expect(last.args).toEqual(['throne', 'hard', 20, 10]);
    // From the dev server too (the key is what guards it).
    const dev = await worker.fetch(get('', 'sekrit', 'http://localhost:5173'), env);
    expect(dev.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('ignores filters it does not know', () => {
    const q = listQuery(new URLSearchParams('room=DROP TABLE&difficulty=x&mode=daily&before=-3&limit=1000'));
    expect(q).toEqual({ room: null, difficulty: null, mode: 'daily', before: null, limit: 50 });
  });

  it('answers the browser’s preflight and nothing else', async () => {
    const pre = await worker.fetch(new Request('https://w.example/losses', { method: 'OPTIONS', headers: { Origin: GAME } }), {});
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Headers')).toMatch(/Authorization/);
    expect((await worker.fetch(new Request('https://w.example/'), {})).status).toBe(404);
  });

  it('deletes records older than 60 days each day', async () => {
    const db = fakeDB();
    const before = Date.now();
    await worker.scheduled({}, { DB: db });
    expect(db.calls[0].sql).toBe('DELETE FROM losses WHERE at < ?');
    expect(db.calls[0].args[0]).toBeLessThanOrEqual(before - KEEP_DAYS * 86_400_000 + 1000);
  });
});
