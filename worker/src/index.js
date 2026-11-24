// Loss replays: a Cloudflare Worker that keeps the records of fights players lost, so they can
// be watched with the game's own replay (the unlisted ?losses page). Deployed with Wrangler
// from this folder; the records live in a D1 database (schema.sql) for 60 days.
//
// POST /loss     from the deployed game only: { code, room, difficulty, tier, mode, rounds },
//                where code is the fight as a #watch= link carries it (no hero names).
// GET  /losses   with Authorization: Bearer <READ_KEY>: the newest losses, filtered by room,
//                difficulty and mode, `before` an id for the next page, up to `limit` (50).
// GET  /summary  with the key: losses per room and difficulty in the last 7 and 30 days
//                ({ rooms: [{ room, difficulty, week, month }] }), for one `mode` or all.
// POST /event    from the game only: { name, data }, one play-stats event (src/stats.js), added
//                to the day's tallies (day, event, property, value → count). Nothing per player.
// GET  /tallies  with the key: the tallies of the last `days` (7), summed: { tallies: [{ event,
//                prop, value, n }] }; prop '' is the event's own count. scripts/digest.mjs reads it.
// Every day at 03:17 UTC, records older than 60 days and tallies older than 400 are deleted.
//
// Against junk: uploads come from the game's page only (Origin), at most 3 a minute from one
// address (the UPLOADS rate limiter, which keeps nothing), each must be a lost fight in the
// room it claims, and no more than DAILY_CAP are stored in a day. Events: from the game's page, at
// most 30 a minute from one address (EVENTS), known events and plain values only, EVENT_CAP a day.

export const GAME = 'https://fatihsenel.github.io';
/** Pages that may read the list (with the key): the game and its dev server. */
const READERS = [GAME, 'http://localhost:5173'];
export const MAX_CODE = 8000; // the game's MAX_LINK_CODE
export const KEEP_DAYS = 60;
/** Losses stored in 24 hours at most; past it, uploads are refused until the day moves on. */
export const DAILY_CAP = 1000;
/** A fight's record unpacked is far smaller than this; anything bigger is junk. */
const MAX_UNPACKED = 200_000;
const DIFFICULTIES = ['story', 'normal', 'hard'];
const MODES = ['campaign', 'daily', 'weekly'];

/** Events counted per day at most; past it, events are refused until the next day (UTC). */
export const EVENT_CAP = 20_000;
const TALLY_DAYS = 400;
const FIGHT = ['room', 'mode', 'difficulty', 'tier', 'party', 'rounds', 'standing', 'downed', 'input', 'heroesFell', 'foesFell', 'heroesTumbled', 'foesTumbled'];
/** The events the game sends and the properties counted for each; anything else is dropped. */
const TALLY_EVENTS = {
  visit: ['returning'], // played in this browser before
  'run-start': ['kind', 'difficulty', 'tier', 'party'],
  'run-continue': ['room', 'cleared', 'difficulty', 'tier', 'midFight'],
  'run-abandon': ['room', 'cleared', 'difficulty', 'tier'],
  'fight-won': FIGHT,
  'fight-lost': FIGHT,
  'fight-left': [...FIGHT, 'round'],
  'campaign-won': ['difficulty', 'tier', 'party', 'relics'],
  stop: ['stop', 'choice', 'difficulty'],
  'ease-offered': ['room', 'difficulty'], // the Defeat banner's offer after 3 losses in a room
  'ease-taken': ['room', 'from', 'to'],
  'daily-start': ['mode', 'room'],
  'challenge-played': ['room'],
  'replay-watched': ['from', 'room'],
  shared: ['what', 'how'],
  error: ['type', 'file', 'browser'],
  perf: ['fps', 'dpr'],
};
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
/** A property's value as stored: a short plain word or a small number, else nothing. */
function tallyValue(v) {
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return Number.isFinite(v) && Math.abs(v) < 100_000 ? String(v) : null;
  return typeof v === 'string' && /^[\w .+-]{1,60}$/.test(v) ? v : null;
}

/**
 * An event as tally rows [day, event, prop, value]: the day's total, the event's own count,
 * each known property, and the combined ones (a fight's room/difficulty, a crash's file:line:col).
 * Null for an event the game doesn't send.
 */
export function tallyRows(name, data, today) {
  if (typeof name !== 'string' || !Object.hasOwn(TALLY_EVENTS, name)) return null;
  const d = data && typeof data === 'object' ? data : {};
  const rows = [[today, '', '', ''], [today, name, '', '']];
  for (const prop of TALLY_EVENTS[name]) {
    const v = tallyValue(d[prop]);
    if (v !== null) rows.push([today, name, prop, v]);
  }
  const pair = (a, b) => (tallyValue(a) !== null && tallyValue(b) !== null ? `${a}/${b}` : null);
  if (FIGHT === TALLY_EVENTS[name] || name === 'fight-left') {
    const rd = pair(d.room, d.difficulty);
    if (rd) rows.push([today, name, 'room/difficulty', rd]);
  }
  if (name === 'error' && /^[\w.-]{1,60}$/.test(d.file ?? '') && int(d.line, 0, 1e7) && int(d.col, 0, 1e7)) {
    rows.push([today, name, 'at', `${d.file}:${d.line}:${d.col}`]);
  }
  return rows;
}

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

/**
 * Is `code` a lost fight in `row`'s room and difficulty? It's unpacked as the game packs a
 * #watch= link (deflated JSON in URL-safe base64; see src/game/fightLink.js), not replayed.
 */
export async function checkCode(code, row) {
  try {
    const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const parts = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_UNPACKED) { reader.cancel().catch(() => {}); return false; }
      parts.push(value);
    }
    const o = JSON.parse(new TextDecoder().decode(await new Blob(parts).arrayBuffer()));
    return !!o && typeof o.v === 'number' && o.n === row.room && o.d === row.difficulty && o.r === 'defeat'
      && Array.isArray(o.l) && !!o.p && typeof o.p === 'object';
  } catch {
    return false;
  }
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

    if (url.pathname === '/event' && request.method === 'POST') {
      if (origin !== GAME) return json({ error: 'origin' }, 403, headers);
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      if (env.EVENTS && !(await env.EVENTS.limit({ key: ip })).success) return json({ error: 'slow down' }, 429, headers);
      const text = await request.text();
      if (text.length > 2000) return json({ error: 'too long' }, 413, headers);
      let body;
      try { body = JSON.parse(text); } catch { return json({ error: 'not json' }, 400, headers); }
      const today = day(Date.now());
      const rows = tallyRows(body?.name, body?.data, today);
      if (!rows) return json({ error: 'event' }, 400, headers);
      const total = await env.DB.prepare("SELECT n FROM tallies WHERE day = ? AND event = '' AND prop = '' AND value = ''").bind(today).first();
      if ((total?.n ?? 0) >= EVENT_CAP) return json({ error: 'full today' }, 429, headers);
      const add = 'INSERT INTO tallies (day, event, prop, value, n) VALUES (?, ?, ?, ?, 1) ON CONFLICT (day, event, prop, value) DO UPDATE SET n = n + 1';
      await env.DB.batch(rows.map((r) => env.DB.prepare(add).bind(...r)));
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === '/loss' && request.method === 'POST') {
      if (origin !== GAME) return json({ error: 'origin' }, 403, headers);
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      if (env.UPLOADS && !(await env.UPLOADS.limit({ key: ip })).success) return json({ error: 'slow down' }, 429, headers);
      const text = await request.text();
      if (text.length > MAX_CODE + 500) return json({ error: 'too long' }, 413, headers);
      let body;
      try { body = JSON.parse(text); } catch { return json({ error: 'not json' }, 400, headers); }
      const { row, error } = checkLoss(body);
      if (error) return json({ error }, 400, headers);
      if (!(await checkCode(row.code, row))) return json({ error: 'fight' }, 400, headers);
      const today = await env.DB.prepare('SELECT COUNT(*) AS n FROM losses WHERE at > ?').bind(Date.now() - 86_400_000).first();
      if ((today?.n ?? 0) >= DAILY_CAP) return json({ error: 'full today' }, 429, headers);
      await env.DB.prepare('INSERT INTO losses (at, room, difficulty, tier, mode, rounds, code) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(Date.now(), row.room, row.difficulty, row.tier, row.mode, row.rounds, row.code).run();
      return new Response(null, { status: 204, headers });
    }

    const keyed = () => !!env.READ_KEY && sameKey(request.headers.get('Authorization') ?? '', `Bearer ${env.READ_KEY}`);

    if (url.pathname === '/tallies' && request.method === 'GET') {
      if (!keyed()) return json({ error: 'key' }, 401, headers);
      // ?day=YYYY-MM-DD: that day alone (the daily crash check); else ?days=N up to today.
      const one = url.searchParams.get('day');
      const n = Number(url.searchParams.get('days'));
      const days = int(n, 1, TALLY_DAYS) ? n : 7;
      const [from, to] = /^\d{4}-\d{2}-\d{2}$/.test(one ?? '') ? [one, one] : [day(Date.now() - (days - 1) * 86_400_000), day(Date.now())];
      const { results } = await env.DB.prepare("SELECT event, prop, value, SUM(n) AS n FROM tallies WHERE day >= ? AND day <= ? AND event != '' GROUP BY event, prop, value")
        .bind(from, to).all();
      return json({ tallies: results }, 200, headers);
    }

    if (url.pathname === '/summary' && request.method === 'GET') {
      if (!keyed()) return json({ error: 'key' }, 401, headers);
      const { mode } = listQuery(url.searchParams);
      const now = Date.now();
      const sql = `SELECT room, difficulty, SUM(at > ?) AS week, COUNT(*) AS month FROM losses WHERE at > ?${mode ? ' AND mode = ?' : ''} GROUP BY room, difficulty`;
      const { results } = await env.DB.prepare(sql).bind(now - 7 * 86_400_000, now - 30 * 86_400_000, ...(mode ? [mode] : [])).all();
      return json({ rooms: results }, 200, headers);
    }

    if (url.pathname === '/losses' && request.method === 'GET') {
      if (!keyed()) return json({ error: 'key' }, 401, headers);
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
    await env.DB.prepare('DELETE FROM tallies WHERE day < ?').bind(day(Date.now() - TALLY_DAYS * 86_400_000)).run();
  },
};
