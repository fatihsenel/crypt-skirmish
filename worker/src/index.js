// Loss replays: a Cloudflare Worker that keeps the records of fights players lost, so they can
// be watched with the game's own replay (the unlisted ?losses page). Deployed with Wrangler
// from this folder; the records live in a D1 database (schema.sql) for 60 days.
//
// POST /loss     from the deployed game only: { code, room, difficulty, tier, mode, rounds },
//                where code is the fight as a #watch= link carries it (no hero names).
// GET  /losses   with Authorization: Bearer <READ_KEY>: the newest losses, filtered by room,
//                difficulty and mode, `before` an id for the next page, up to `limit` (50).
// Every day at 03:17 UTC, records older than 60 days are deleted.

export const GAME = 'https://fatihsenel.github.io';
/** Pages that may read the list (with the key): the game and its dev server. */
const READERS = [GAME, 'http://localhost:5173'];
export const MAX_CODE = 8000; // the game's MAX_LINK_CODE
export const KEEP_DAYS = 60;
const DIFFICULTIES = ['story', 'normal', 'hard'];
const MODES = ['campaign', 'daily', 'weekly'];

const int = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;

/** An upload's fields, checked: { row } to store, or { error }. */
export function checkLoss(body) {
  if (!body || typeof body !== 'object') return { error: 'not an object' };
  const { code, room, difficulty, tier, mode, rounds } = body;
  if (typeof code !== 'string' || !code.length || code.length > MAX_CODE || !/^[\w-]+$/.test(code)) return { error: 'code' };
  if (typeof room !== 'string' || !/^[a-z]{2,20}$/.test(room)) return { error: 'room' };
  if (!DIFFICULTIES.includes(difficulty)) return { error: 'difficulty' };
  if (!int(tier, 0, 99)) return { error: 'tier' };
  if (!MODES.includes(mode)) return { error: 'mode' };
  if (!int(rounds, 1, 999)) return { error: 'rounds' };
  return { row: { code, room, difficulty, tier, mode, rounds } };
}

/** The list's filters from the query string, checked. */
export function listQuery(params) {
  const room = params.get('room');
  const difficulty = params.get('difficulty');
  const mode = params.get('mode');
  const before = Number(params.get('before'));
  const limit = Number(params.get('limit'));
  return {
    room: room && /^[a-z]{2,20}$/.test(room) ? room : null,
    difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : null,
    mode: MODES.includes(mode) ? mode : null,
    before: Number.isInteger(before) && before > 0 ? before : null,
    limit: int(limit, 1, 100) ? limit : 50,
  };
}

/** Compares two strings in time that doesn't depend on where they differ. */
function sameKey(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const cors = (origin) => (READERS.includes(origin) ? {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
} : { Vary: 'Origin' });

const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') ?? '';
    const headers = cors(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    if (url.pathname === '/loss' && request.method === 'POST') {
      if (origin !== GAME) return json({ error: 'origin' }, 403, headers);
      const text = await request.text();
      if (text.length > MAX_CODE + 500) return json({ error: 'too long' }, 413, headers);
      let body;
      try { body = JSON.parse(text); } catch { return json({ error: 'not json' }, 400, headers); }
      const { row, error } = checkLoss(body);
      if (error) return json({ error }, 400, headers);
      await env.DB.prepare('INSERT INTO losses (at, room, difficulty, tier, mode, rounds, code) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(Date.now(), row.room, row.difficulty, row.tier, row.mode, row.rounds, row.code).run();
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === '/losses' && request.method === 'GET') {
      const auth = request.headers.get('Authorization') ?? '';
      if (!env.READ_KEY || !sameKey(auth, `Bearer ${env.READ_KEY}`)) return json({ error: 'key' }, 401, headers);
      const q = listQuery(url.searchParams);
      const where = [];
      const args = [];
      for (const k of ['room', 'difficulty', 'mode']) if (q[k]) { where.push(`${k} = ?`); args.push(q[k]); }
      if (q.before) { where.push('id < ?'); args.push(q.before); }
      const sql = `SELECT id, at, room, difficulty, tier, mode, rounds, code FROM losses${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`;
      const { results } = await env.DB.prepare(sql).bind(...args, q.limit).all();
      return json({ losses: results }, 200, headers);
    }

    return json({ error: 'not found' }, 404, headers);
  },

  async scheduled(event, env) {
    await env.DB.prepare('DELETE FROM losses WHERE at < ?').bind(Date.now() - KEEP_DAYS * 86_400_000).run();
  },
};
