import { describe, it, expect } from 'vitest';
import worker from '../worker/src/index.js';
import { RoomCore, CoopRoom, MAX_PLAYERS, MAX_LOG, CHUNK, IDLE_MS, RUN_IDLE_MS, overRate, deliver, cleanPlayerName, CODE } from '../worker/src/room.js';

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

  it('a run: votes, a decided step spends them, and a long log', () => {
    const r = new RoomCore();
    r.hello(A, 'Ana');
    r.hello(B, 'Bo');
    r.message(A, { t: 'start', fight });
    r.message(A, { t: 'vote', key: 'enter:crypt' });
    expect(r.votes).toEqual({}); // one fight: nothing to vote on
    expect(r.idleMs).toBe(IDLE_MS);
    r.message(A, { t: 'start', fight: { run: true, difficulty: 'normal', seed: 9 } });
    expect(r.idleMs).toBe(RUN_IDLE_MS);
    r.message(A, { t: 'vote', key: 'enter:crypt' });
    r.message(B, { t: 'vote', key: 'enter:crypt' });
    r.message(B, { t: 'vote', key: 'x'.repeat(81) });
    expect(r.votes).toEqual({ [A]: 'enter:crypt', [B]: 'enter:crypt' });
    r.message(B, { t: 'vote', key: null });
    expect(r.votes).toEqual({ [A]: 'enter:crypt' });
    // A player's own step leaves the votes; the decided one spends them.
    r.message(B, { t: 'cmd', g: 2, at: 0, cmd: { type: 'camp', act: ['style', 'F', 'protection'] } });
    expect(r.votes).toEqual({ [A]: 'enter:crypt' });
    const d = r.message(A, { t: 'cmd', g: 2, at: 1, cmd: { type: 'camp', act: ['enter', 'crypt'], decided: true } });
    expect(r.votes).toEqual({});
    expect(msgs(d, B).map((m) => m.t)).toEqual(['cmd', 'room']);
    // A run's log goes on past one fight's limit.
    for (let i = r.log.length; i <= MAX_LOG; i++) r.message(A, { t: 'cmd', g: 2, at: i, cmd: { type: 'end' } });
    expect(r.log.length).toBe(MAX_LOG + 1);
  });

  it('someone back under the same name takes their old place, heroes and vote', () => {
    const r = new RoomCore();
    r.hello(A, 'Ana');
    r.hello(B, 'Bo');
    r.message(A, { t: 'seats', seats: { F: B, W: B } });
    r.message(A, { t: 'start', fight: { run: true, seed: 1 } });
    r.message(B, { t: 'vote', key: 'next' });
    r.leave(B);
    r.hello(C, 'bo'); // another tab, another day
    expect(r.players.map((p) => p.id)).toEqual([A, C]);
    expect(r.seats).toMatchObject({ F: C, W: C, R: A });
    expect(r.votes).toEqual({ [C]: 'next' });
    // Not while the first is still here: then it's someone else.
    r.hello('dddddddd', 'Bo');
    expect(r.players.length).toBe(3);
  });

  it('heroes the host took over from someone gone are theirs again when they’re back', () => {
    const r = new RoomCore();
    r.hello(A, 'Ana');
    r.hello(B, 'Bo');
    r.message(A, { t: 'seats', seats: { F: B, W: B } });
    r.leave(B);
    r.message(A, { t: 'seats', seats: { F: A, W: A } }); // the takeover
    expect(r.seats).toMatchObject({ F: A, W: A });
    r.hello(C, 'Bo'); // back, in another tab
    expect(r.seats).toMatchObject({ F: C, W: C });
    expect(r.lent).toEqual({});
    // Handed to someone here on purpose: not lent.
    r.message(A, { t: 'seats', seats: { F: A } });
    r.leave(C);
    r.hello(C, 'Bo');
    expect(r.seats.F).toBe(A);
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
      storage: {
        get: async (k) => store.get(k),
        put: async (k, v) => (typeof k === 'string' ? store.set(k, v) : Object.entries(k).forEach(([a, b]) => store.set(a, structuredClone(b)))),
        list: async ({ prefix }) => new Map([...store].filter(([k]) => k.startsWith(prefix))),
        delete: async (ks) => ks.forEach((k) => store.delete(k)),
        setAlarm: async () => {},
        deleteAll: async () => store.clear(),
      },
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
    // A run's log is kept in chunks, and comes back whole after a wake.
    await room.webSocketMessage(a2, JSON.stringify({ t: 'start', fight: { run: true, seed: 3 } }));
    const g = room.core.game;
    for (let i = 0; i < CHUNK + 5; i++) {
      room.core.message(A, { t: 'cmd', g, at: i, cmd: { type: 'end', i } });
      await room.save(); // as each message does
    }
    await room.webSocketMessage(a2, JSON.stringify({ t: 'cmd', g, at: CHUNK + 5, cmd: { type: 'end' } }));
    expect(store.get('room').log).toBeUndefined();
    expect(store.get('log:0').length).toBe(CHUNK);
    expect(store.get('log:1').length).toBe(6);
    const woke = new CoopRoom({ ...ctx, getWebSockets: () => [] });
    await new Promise((r) => setTimeout(r));
    expect(woke.core.log.length).toBe(CHUNK + 6);
    expect(woke.core.log[7].cmd.i).toBe(7);
    // Back to the lobby: the old chunks go.
    await room.webSocketMessage(a2, JSON.stringify({ t: 'lobby' }));
    expect([...store.keys()].filter((k) => k.startsWith('log:'))).toEqual([]);
    // A room kept before the chunks (its log inline) writes them all on its next save.
    store.clear();
    store.set('room', { ...room.core.snapshot(), log: Array.from({ length: CHUNK + 2 }, (_, i) => ({ cmd: { type: 'end', i }, by: A })) });
    const old = new CoopRoom({ ...ctx, getWebSockets: () => [] });
    await new Promise((r) => setTimeout(r));
    await old.save();
    expect([store.get('log:0').length, store.get('log:1').length, store.get('room').log]).toEqual([CHUNK, 2, undefined]);
  });
});
