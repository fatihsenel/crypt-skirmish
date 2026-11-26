import { describe, it, expect } from 'vitest';
import worker from '../worker/src/index.js';
import { RoomCore, CoopRoom, MAX_PLAYERS, overRate, deliver, cleanPlayerName, CODE } from '../worker/src/room.js';

const A = 'aaaaaaaa';
const B = 'bbbbbbbb';
const C = 'cccccccc';
const msgs = (res, to) => res.out.filter((o) => o.to === '*' ? o.not !== to : o.to === to).map((o) => o.msg);
const fight = { node: 'warren', level: 4, difficulty: 'normal', seed: 7 };

describe('a co-op room', () => {
  it('the first in hosts and holds every hero; the next gets the room as it stands', () => {
    const r = new RoomCore();
    const a = r.hello(A, 'Ana');
    expect(msgs(a, A)[0]).toMatchObject({ t: 'sync', you: A, host: A, seats: { F: A, W: A, R: A, C: A }, log: [] });
    const b = r.hello(B, 'Bo<b>');
    expect(msgs(b, B)[0].players.map((p) => p.name)).toEqual(['Ana', 'Bob']);
    expect(msgs(b, A)[0]).toMatchObject({ t: 'room' });
    expect(msgs(b, B).length).toBe(1); // the newcomer gets the sync, not the room message too
  });

  it('only the host hands out heroes, starts and goes back to the lobby', () => {
    const r = new RoomCore();
    r.hello(A, 'Ana');
    r.hello(B, 'Bo');
    r.message(B, { t: 'seats', seats: { F: B } });
    expect(r.seats.F).toBe(A);
    r.message(A, { t: 'seats', seats: { F: B, W: 'nobody' } });
    expect(r.seats).toMatchObject({ F: B, W: A });
    r.message(B, { t: 'start', fight });
    expect(r.fight).toBe(null);
    r.message(A, { t: 'start', fight });
    expect(r.fight).toEqual(fight);
    expect(r.game).toBe(1);
    r.message(A, { t: 'lobby' });
    expect([r.fight, r.game]).toEqual([null, 2]);
  });

  it('puts commands in one order and refuses one meant for a place already taken', () => {
    const r = new RoomCore();
    r.hello(A, 'Ana');
    r.hello(B, 'Bo');
    r.message(A, { t: 'start', fight });
    const one = r.message(A, { t: 'cmd', g: 1, at: 0, cmd: { type: 'move', x: 1, z: 2 } });
    expect(msgs(one, B)[0]).toEqual({ t: 'cmd', g: 1, at: 0, cmd: { type: 'move', x: 1, z: 2 }, by: A });
    const late = r.message(B, { t: 'cmd', g: 1, at: 0, cmd: { type: 'end' } });
    expect(msgs(late, B)).toEqual([{ t: 'stale', g: 1, at: 1 }]);
    expect(msgs(late, A)).toEqual([]);
    expect(r.message(B, { t: 'cmd', g: 0, at: 1, cmd: { type: 'end' } }).out[0].msg.t).toBe('stale'); // an old fight's
    expect(r.message(B, { t: 'cmd', g: 1, at: 1, cmd: { type: 'x'.repeat(500) } }).out[0].msg.t).toBe('stale');
    // Refused once, refused until ready: a later command can't land by chance.
    expect(r.message(B, { t: 'cmd', g: 1, at: 1, cmd: { type: 'end' } }).out[0].msg.t).toBe('stale');
    r.message(B, { t: 'ready' });
    r.message(B, { t: 'cmd', g: 1, at: 1, cmd: { type: 'end' } });
    // A reconnect gets the whole log.
    expect(msgs(r.hello(B, 'Bo'), B)[0].log).toEqual([{ type: 'move', x: 1, z: 2 }, { type: 'end' }]);
  });

  it('a host who leaves hands over to the next player here, and comes back as a player', () => {
    const r = new RoomCore();
    r.hello(A, 'Ana');
    r.hello(B, 'Bo');
    expect(msgs(r.leave(A), B)[0]).toMatchObject({ host: B, players: [{ id: A, on: false }, { id: B, on: true }] });
    r.hello(A, 'Ana');
    expect(r.host).toBe(B);
  });

  it('holds four players; a fifth takes the place of one who left holding no hero', () => {
    const r = new RoomCore();
    const ids = ['p1111111', 'p2222222', 'p3333333', 'p4444444'];
    for (const id of ids) r.hello(id, id);
    expect(r.hello('p5555555', 'five').error).toBe('full');
    r.leave('p4444444');
    expect(r.hello('p5555555', 'five').error).toBeUndefined();
    expect(r.players.length).toBe(MAX_PLAYERS);
    expect(r.hello('NOT-AN-ID', 'x').error).toBe('id');
  });

  it('comes back from storage with nobody here until their sockets say so', () => {
    const r = new RoomCore();
    r.hello(A, 'Ana');
    r.hello(B, 'Bo');
    r.message(A, { t: 'start', fight });
    r.message(A, { t: 'cmd', g: 1, at: 0, cmd: { type: 'end' } });
    const back = new RoomCore(JSON.parse(JSON.stringify(r.snapshot())));
    back.online([B]);
    expect(back.host).toBe(B);
    expect(back.log.length).toBe(1);
    expect(back.players.map((p) => p.on)).toEqual([false, true]);
  });

  it('names, codes, rates and delivery', () => {
    expect(cleanPlayerName('  <Zoë>  the   Bold!!  ')).toBe('Zoë the Bold');
    expect(CODE.test('ABCDEF')).toBe(true);
    expect(CODE.test('ABCDE0')).toBe(false);
    const rate = { n: 0, since: 0 };
    let over = false;
    for (let i = 0; i < 81; i++) over = overRate(rate, 1000);
    expect(over).toBe(true);
    expect(overRate(rate, 20_000)).toBe(false);
    const got = { a: [], b: [] };
    deliver([{ to: '*', not: 'b', msg: { t: 'x' } }, { to: 'b', msg: { t: 'y' } }], [[{ send: (m) => got.a.push(m) }, 'a'], [{ send: (m) => got.b.push(m) }, 'b']]);
    expect(got).toEqual({ a: ['{"t":"x"}'], b: ['{"t":"y"}'] });
  });
});

describe('the Worker’s co-op route', () => {
  const req = (path, origin = 'https://fatihsenel.github.io', upgrade = 'websocket') => new Request(`https://w.example${path}`, { headers: { Origin: origin, ...(upgrade && { Upgrade: upgrade }), 'CF-Connecting-IP': '203.0.113.9' } });
  const env = (limit = true) => {
    const seen = [];
    return {
      seen,
      ROOMS: { limit: async () => ({ success: limit }) },
      COOP: { idFromName: (n) => `id:${n}`, get: (id) => ({ fetch: async () => { seen.push(id); return new Response('ok'); } }) },
    };
  };
  it('sends a good code from the game to its room, and nothing else', async () => {
    const e = env();
    expect((await worker.fetch(req('/coop/ABCDEF'), e)).status).toBe(200);
    expect(e.seen).toEqual(['id:ABCDEF']);
    expect((await worker.fetch(req('/coop/ABCDEF', 'https://evil.example'), e)).status).toBe(403);
    expect((await worker.fetch(req('/coop/ABCDE1'), e)).status).toBe(400);
    expect((await worker.fetch(req('/coop/ABCDEF', undefined, null), e)).status).toBe(426);
    expect((await worker.fetch(req('/coop/ABCDEF'), env(false))).status).toBe(429);
  });

  it('the room object: hello first, then the room; a newer socket replaces the old', async () => {
    const store = new Map();
    const sockets = [];
    const ctx = {
      blockConcurrencyWhile: (f) => f(),
      storage: { get: async (k) => store.get(k), put: async (k, v) => store.set(k, v), setAlarm: async () => {}, deleteAll: async () => store.clear() },
      getWebSockets: () => sockets.filter((s) => !s.closed),
    };
    const sock = () => {
      const s = { att: null, sent: [], closed: false, send(m) { this.sent.push(JSON.parse(m)); }, close() { this.closed = true; }, serializeAttachment(a) { this.att = structuredClone(a); }, deserializeAttachment() { return this.att; } };
      s.att = { id: null, rate: { n: 0, since: Date.now() } };
      sockets.push(s);
      return s;
    };
    const room = new CoopRoom(ctx);
    await new Promise((r) => setTimeout(r));
    const a = sock();
    await room.webSocketMessage(a, JSON.stringify({ t: 'start' }));
    expect(a.closed).toBe(true); // not a hello
    const a2 = sock();
    await room.webSocketMessage(a2, JSON.stringify({ t: 'hello', id: A, name: 'Ana' }));
    expect(a2.sent[0]).toMatchObject({ t: 'sync', you: A });
    const b = sock();
    await room.webSocketMessage(b, JSON.stringify({ t: 'hello', id: B, name: 'Bo' }));
    expect(a2.sent.at(-1).players.length).toBe(2);
    const b2 = sock();
    await room.webSocketMessage(b2, JSON.stringify({ t: 'hello', id: B, name: 'Bo' }));
    expect(b.closed).toBe(true);
    await room.webSocketClose(b);
    expect(a2.sent.at(-1).players[1].on).toBe(true); // b2 is still here
    expect(store.get('room').players.length).toBe(2);
    const c = sock();
    await room.webSocketMessage(c, 'x'.repeat(5000));
    expect(c.closed).toBe(true);
    expect(store.get('room').players.some((p) => p.id === C)).toBe(false);
  });
});
