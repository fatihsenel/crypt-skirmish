import { describe, it, expect } from 'vitest';
import worker, { checkLoss, checkCode, listQuery, tallyRows, GAME, MAX_CODE, KEEP_DAYS, DAILY_CAP, EVENT_CAP } from '../worker/src/index.js';
import { encodeFight } from '../src/game/fightLink.js';
import { newCampaign } from '../src/game/campaign.js';

/** A record as the game sends it: a lost fight in `room`, packed like a #watch= link. */
const lostFight = (over = {}) => encodeFight({
  node: 'throne', seed: 7, party: newCampaign('hard').party, difficulty: 'hard', log: [], result: 'defeat', check: 'x', ...over,
});

/** A stand-in for the D1 binding: records each statement, returns `rows` from all() and `today` as the day's count. */
function fakeDB(rows = [], today = 0) {
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
        first: async () => ({ n: today }),
      };
      return stmt;
    },
    batched: [],
    async batch(stmts) { this.batched.push(stmts.length); return stmts.map(() => ({ success: true })); },
  };
}

const good = { code: 'abc_DEF-123', room: 'throne', difficulty: 'hard', tier: 1, mode: 'campaign', rounds: 7 };
/** The rate limiter's stand-in: allows `n` calls, then refuses; records the keys. */
const limiter = (n = 99) => ({ keys: [], async limit({ key }) { this.keys.push(key); return { success: this.keys.length <= n }; } });
const post = (body, origin = GAME, ip = '203.0.113.9') => new Request('https://w.example/loss', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain', 'CF-Connecting-IP': ip }, body: typeof body === 'string' ? body : JSON.stringify(body),
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
    const code = await lostFight();
    const ok = await worker.fetch(post({ ...good, code }), { DB: db, UPLOADS: limiter() });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(GAME);
    const insert = db.calls.find((c) => c.sql.startsWith('INSERT'));
    expect(insert.args.slice(1)).toEqual(['throne', 'hard', 1, 'campaign', 7, code]);
    const env = { DB: db, UPLOADS: limiter() };
    expect((await worker.fetch(post(good, 'https://evil.example'), env)).status).toBe(403);
    expect((await worker.fetch(post(good, 'http://localhost:5173'), env)).status).toBe(403); // the dev server reads, never writes
    expect((await worker.fetch(post('{oops'), env)).status).toBe(400);
    expect((await worker.fetch(post({ ...good, mode: 'x' }), env)).status).toBe(400);
    expect((await worker.fetch(post('x'.repeat(MAX_CODE + 600)), env)).status).toBe(413);
    expect(db.calls.filter((c) => c.sql.startsWith('INSERT'))).toHaveLength(1);
  });

  it('only stores a lost fight in the room it claims', async () => {
    const row = { room: 'throne', difficulty: 'hard' };
    expect(await checkCode(await lostFight(), row)).toBe(true);
    expect(await checkCode('abc_DEF-123', row)).toBe(false); // not a fight at all
    expect(await checkCode(await lostFight({ node: 'crypt' }), row)).toBe(false);
    expect(await checkCode(await lostFight({ result: 'victory' }), row)).toBe(false);
    expect(await checkCode(await lostFight({ difficulty: 'story' }), row)).toBe(false);
    const db = fakeDB();
    const res = await worker.fetch(post(good), { DB: db, UPLOADS: limiter() });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'fight' });
    expect(db.calls.some((c) => c.sql.startsWith('INSERT'))).toBe(false);
  });

  it('limits each address, and stores no more than a day’s cap', async () => {
    const code = await lostFight();
    const slow = limiter(3);
    const db = fakeDB();
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await worker.fetch(post({ ...good, code }), { DB: db, UPLOADS: slow })).status);
    expect(codes).toEqual([204, 204, 204, 429, 429]);
    expect(slow.keys).toEqual(Array(5).fill('203.0.113.9')); // the address is the key, and is never stored
    expect(db.calls.filter((c) => c.sql.startsWith('INSERT')).every((c) => !c.args.includes('203.0.113.9'))).toBe(true);
    // A full day: refused, and nothing written.
    const full = fakeDB([], DAILY_CAP);
    expect((await worker.fetch(post({ ...good, code }), { DB: full, UPLOADS: limiter() })).status).toBe(429);
    expect(full.calls.some((c) => c.sql.startsWith('INSERT'))).toBe(false);
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

  it('counts losses by room and difficulty for the last 7 and 30 days, only with the key', async () => {
    const rows = [{ room: 'throne', difficulty: 'hard', week: 3, month: 9 }];
    const db = fakeDB(rows);
    const env = { DB: db, READ_KEY: 'sekrit' };
    const ask = (query, key) => worker.fetch(new Request(`https://w.example/summary${query}`, { headers: { Origin: GAME, ...(key && { Authorization: `Bearer ${key}` }) } }), env);
    expect((await ask('', null)).status).toBe(401);
    expect(db.calls).toHaveLength(0);
    const now = Date.now();
    const res = await ask('?mode=daily&room=throne', 'sekrit');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rooms: rows });
    const { sql, args } = db.calls.at(-1);
    expect(sql).toMatch(/SUM\(at > \?\) AS week, COUNT\(\*\) AS month FROM losses WHERE at > \? AND mode = \? GROUP BY room, difficulty$/);
    expect(args[0]).toBeGreaterThanOrEqual(now - 7 * 86_400_000 - 1000);
    expect(args[1]).toBeGreaterThanOrEqual(now - 30 * 86_400_000 - 1000);
    expect(args[2]).toBe('daily'); // the room filter is ignored: the summary is of every room
    expect(args).toHaveLength(3);
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

  it('deletes records older than 60 days, and tallies older than 400, each day', async () => {
    const db = fakeDB();
    const before = Date.now();
    await worker.scheduled({}, { DB: db });
    expect(db.calls[0].sql).toBe('DELETE FROM losses WHERE at < ?');
    expect(db.calls[0].args[0]).toBeLessThanOrEqual(before - KEEP_DAYS * 86_400_000 + 1000);
    expect(db.calls[1].sql).toBe('DELETE FROM tallies WHERE day < ?');
    expect(db.calls[1].args[0]).toBe(new Date(before - 400 * 86_400_000).toISOString().slice(0, 10));
  });

  describe('event tallies', () => {
    const DAY = '2026-11-23';
    const send = (body, origin = GAME, ip = '203.0.113.9') => new Request('https://w.example/event', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain', 'CF-Connecting-IP': ip }, body: typeof body === 'string' ? body : JSON.stringify(body),
    });

    it('turns an event into rows: the event, each known property, and the combined ones', () => {
      const rows = tallyRows('fight-lost', { room: 'throne', mode: 'campaign', difficulty: 'hard', tier: 0, party: 'FWRC', rounds: 7, standing: 0, downed: 4, input: 'touch', name: 'Somebody' }, DAY);
      expect(rows).toContainEqual([DAY, '', '', '']); // the day's total
      expect(rows).toContainEqual([DAY, 'fight-lost', '', '']);
      expect(rows).toContainEqual([DAY, 'fight-lost', 'room', 'throne']);
      expect(rows).toContainEqual([DAY, 'fight-lost', 'tier', '0']);
      expect(rows).toContainEqual([DAY, 'fight-lost', 'room/difficulty', 'throne/hard']);
      expect(tallyRows('fight-won', { room: 'bridge', foesFell: 2 }, DAY)).toContainEqual([DAY, 'fight-won', 'foesFell', '2']);
      expect(tallyRows('fight-lost', { room: 'undercroft', heroesTumbled: 1 }, DAY)).toContainEqual([DAY, 'fight-lost', 'heroesTumbled', '1']);
      expect(rows.some((r) => r.includes('Somebody') || r.includes('name'))).toBe(false); // unknown fields are dropped
      const crash = tallyRows('error', { type: 'TypeError', file: 'main-CahFguWJ.js', line: 2, col: 5847, browser: 'safari' }, DAY);
      expect(crash).toContainEqual([DAY, 'error', 'at', 'main-CahFguWJ.js:2:5847']);
      expect(crash).toContainEqual([DAY, 'error', 'browser', 'safari']);
      expect(tallyRows('perf', { fps: 'under 30', dpr: 1.5 }, DAY)).toContainEqual([DAY, 'perf', 'fps', 'under 30']);
      expect(tallyRows('run-continue', { midFight: true }, DAY)).toContainEqual([DAY, 'run-continue', 'midFight', 'true']);
      expect(tallyRows('ease-taken', { room: 'throne', from: 'hard', to: 'normal' }, DAY)).toContainEqual([DAY, 'ease-taken', 'to', 'normal']);
      expect(tallyRows('visit', { returning: true }, DAY)).toEqual([[DAY, '', '', ''], [DAY, 'visit', '', ''], [DAY, 'visit', 'returning', 'true']]);
      expect(tallyRows('visit', {}, DAY)).toEqual([[DAY, '', '', ''], [DAY, 'visit', '', '']]);
    });

    it('refuses events it does not know, and values that could carry anything', () => {
      expect(tallyRows('whatever', {}, DAY)).toBeNull();
      expect(tallyRows('__proto__', {}, DAY)).toBeNull();
      const rows = tallyRows('shared', { what: '<script>', how: 'x'.repeat(61) }, DAY);
      expect(rows).toEqual([[DAY, '', '', ''], [DAY, 'shared', '', '']]);
      expect(tallyRows('error', { type: 'TypeError', file: 'evil file.js', line: 1, col: 1 }, DAY).some((r) => r[2] === 'at')).toBe(false);
    });

    it('counts an event from the game, refuses others, and keeps no address', async () => {
      const db = fakeDB();
      const env = { DB: db, EVENTS: limiter() };
      expect((await worker.fetch(send({ name: 'fight-won', data: { room: 'crypt', difficulty: 'normal' } }), env)).status).toBe(204);
      const ups = db.calls.filter((c) => c.sql.startsWith('INSERT INTO tallies'));
      expect(ups.map((c) => c.args.slice(1))).toEqual([['', '', ''], ['fight-won', '', ''], ['fight-won', 'room', 'crypt'], ['fight-won', 'difficulty', 'normal'], ['fight-won', 'room/difficulty', 'crypt/normal']]);
      expect(ups[0].sql).toMatch(/ON CONFLICT \(day, event, prop, value\) DO UPDATE SET n = n \+ 1$/);
      expect(ups[0].args[0]).toBe(new Date().toISOString().slice(0, 10));
      expect(db.batched).toEqual([5]); // one round trip
      expect(db.calls.flatMap((c) => c.args).includes('203.0.113.9')).toBe(false);
      expect((await worker.fetch(send({ name: 'fight-won', data: {} }, 'https://evil.example'), env)).status).toBe(403);
      expect((await worker.fetch(send({ name: 'nope', data: {} }), env)).status).toBe(400);
      expect((await worker.fetch(send('{oops'), env)).status).toBe(400);
      expect((await worker.fetch(send('x'.repeat(3000)), env)).status).toBe(413);
    });

    it('limits each address, and counts no more than a day’s cap', async () => {
      const slow = limiter(2);
      const env = { DB: fakeDB(), EVENTS: slow };
      const codes = [];
      for (let i = 0; i < 4; i++) codes.push((await worker.fetch(send({ name: 'visit', data: {} }), env)).status);
      expect(codes).toEqual([204, 204, 429, 429]);
      const full = fakeDB([], EVENT_CAP);
      expect((await worker.fetch(send({ name: 'visit', data: {} }), { DB: full, EVENTS: limiter() })).status).toBe(429);
      expect(full.calls.some((c) => c.sql.startsWith('INSERT'))).toBe(false);
    });

    it('reads the tallies of the last days only with the key', async () => {
      const rows = [{ event: 'fight-lost', prop: 'room', value: 'throne', n: 9 }];
      const db = fakeDB(rows);
      const env = { DB: db, READ_KEY: 'sekrit' };
      const ask = (q, key) => worker.fetch(new Request(`https://w.example/tallies${q}`, { headers: { ...(key && { Authorization: `Bearer ${key}` }) } }), env);
      expect((await ask('', null)).status).toBe(401);
      const res = await ask('?days=7', 'sekrit');
      expect(await res.json()).toEqual({ tallies: rows });
      const { sql, args } = db.calls.at(-1);
      const today = new Date().toISOString().slice(0, 10);
      const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
      expect(sql).toBe("SELECT event, prop, value, SUM(n) AS n FROM tallies WHERE day >= ? AND day <= ? AND event != '' GROUP BY event, prop, value");
      expect(args).toEqual([weekAgo, today]); // today and the 6 days before
      await ask('?days=9999', 'sekrit');
      expect(db.calls.at(-1).args).toEqual([weekAgo, today]); // out of range: a week
      await ask('?day=2026-11-20', 'sekrit');
      expect(db.calls.at(-1).args).toEqual(['2026-11-20', '2026-11-20']); // one day
      await ask("?day=2026-11-20' OR 1=1", 'sekrit');
      expect(db.calls.at(-1).args).toEqual([weekAgo, today]); // not a date: a week
    });
  });
});
