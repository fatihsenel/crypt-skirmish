/* global WebSocketPair */
// Co-op rooms: two to four players on their own devices share one fight. The relay never runs
// the game: a fight is its seed plus the heroes' commands, so it only puts the commands in one
// order and hands that order to everyone (each device plays the fight itself). A command names
// the place in the log it was meant for (`at`); one sent for a place already taken (someone was
// quicker, or a host took over a hero) is refused as stale, so every device sees the same log.
//
// `RoomCore` is the room's state and rules, with no sockets: each call returns the messages to
// send ({ to: player id or '*', not?: id, msg }). `CoopRoom` is the Cloudflare Durable Object
// around it (one per room code, its sockets hibernating between messages); scripts/coop-relay.mjs
// runs the same core on this machine for testing.

export const MAX_PLAYERS = 4;
export const MAX_LOG = 4000; // commands in one fight
export const MAX_MESSAGE = 4096; // characters
export const IDLE_MS = 12 * 3600_000; // a room left this long is forgotten
const HEROES = ['F', 'W', 'R', 'C'];
const ID = /^[a-z0-9]{8,24}$/;
export const CODE = /^[A-HJ-NP-Z2-9]{6}$/; // no I, O, 0 or 1: easy to read out
const RATE = { n: 80, ms: 10_000 }; // messages a socket may send in that time

/** A player's name, made safe like a hero's: letters, digits, spaces, ' and -, at most 14. */
export const cleanPlayerName = (text) => String(text ?? '').replace(/[^\p{L}\p{N} '’-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 14).trim();

/** A small JSON object, or null: what a host may set (the fight, the lobby's draft). */
function small(obj, max) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  try {
    return JSON.stringify(obj).length <= max ? structuredClone(obj) : null;
  } catch {
    return null;
  }
}

export class RoomCore {
  /** `saved`: what `snapshot()` gave, or nothing for a new room. */
  constructor(saved) {
    const s = saved && typeof saved === 'object' ? saved : {};
    this.players = Array.isArray(s.players) ? s.players.map((p) => ({ ...p, on: false })) : []; // { id, name, on }
    this.host = s.host ?? null;
    this.seats = s.seats ?? {}; // hero code -> player id
    this.draft = s.draft ?? null; // the host's choices in the lobby, for the others to see
    this.fight = s.fight ?? null; // { node, level, difficulty, classes, seed, rules } once started
    this.game = s.game ?? 0; // which fight this is: a new start or a return to the lobby bumps it
    this.log = Array.isArray(s.log) ? s.log : []; // [{ cmd, by }]
    this.touched = s.touched ?? 0;
    // Players refused a command: everything they send is refused until they've rebuilt the
    // fight from the log and say they're ready (their next commands were meant for a fight
    // that went another way). Not kept: a wake from storage starts clean, as reconnects resync.
    this.blocked = new Set();
  }

  snapshot() {
    const { players, host, seats, draft, fight, game, log, touched } = this;
    return { players: players.map(({ id, name }) => ({ id, name })), host, seats, draft, fight, game, log, touched };
  }

  /** The room as every player sees it (without the log). */
  view() {
    return {
      t: 'room', host: this.host, players: this.players.map(({ id, name, on }) => ({ id, name, on })),
      seats: this.seats, draft: this.draft, fight: this.fight, game: this.game, len: this.log.length,
    };
  }

  player(id) { return this.players.find((p) => p.id === id); }

  /** The host is the first player still here when the old one goes. */
  promote() {
    if (this.player(this.host)?.on) return;
    this.host = this.players.find((p) => p.on)?.id ?? this.host;
  }

  /** Sockets that are open now (after a wake from hibernation, say): those players are here. */
  online(ids) {
    for (const p of this.players) p.on = ids.includes(p.id);
    this.promote();
  }

  /** A socket says who it is. Returns { out } or { error } (then the socket is closed). */
  hello(id, name, now = Date.now()) {
    if (typeof id !== 'string' || !ID.test(id)) return { error: 'id' };
    let p = this.player(id);
    if (!p) {
      if (this.players.length >= MAX_PLAYERS) {
        // Full: a player who left and holds no hero gives up their place.
        const gone = this.players.find((q) => !q.on && !Object.values(this.seats).includes(q.id));
        if (!gone) return { error: 'full' };
        this.players = this.players.filter((q) => q !== gone);
      }
      p = { id, name: '', on: true };
      this.players.push(p);
    }
    p.name = cleanPlayerName(name) || p.name || `Player ${this.players.indexOf(p) + 1}`;
    p.on = true;
    this.blocked.delete(id); // a new socket gets the whole log
    if (!this.host) this.host = id;
    this.promote();
    // A new room seats the first player in every chair; the host hands them out.
    for (const h of HEROES) if (!this.player(this.seats[h])) this.seats[h] = this.host;
    this.touched = now;
    return {
      out: [
        { to: id, msg: { ...this.view(), t: 'sync', you: id, log: this.log.map((e) => e.cmd) } },
        { to: '*', not: id, msg: this.view() },
      ],
    };
  }

  /** A player's socket closed and they have no other one open. */
  leave(id, now = Date.now()) {
    const p = this.player(id);
    if (!p || !p.on) return { out: [] };
    p.on = false;
    this.promote();
    this.touched = now;
    return { out: [{ to: '*', msg: this.view() }] };
  }

  /** A message from player `id` (already said hello). Returns { out }. */
  message(id, msg, now = Date.now()) {
    const p = this.player(id);
    if (!p || !msg || typeof msg !== 'object') return { out: [] };
    this.touched = now;
    const host = id === this.host;
    const all = () => ({ out: [{ to: '*', msg: this.view() }] });
    switch (msg.t) {
      case 'ping':
        return { out: [{ to: id, msg: { t: 'pong' } }] };
      case 'name': {
        const name = cleanPlayerName(msg.name);
        if (!name) return { out: [] };
        p.name = name;
        return all();
      }
      case 'draft': { // the host's choices before a fight, shown to the others
        if (!host) return { out: [] };
        this.draft = small(msg.draft, 600);
        return all();
      }
      case 'seats': { // the host hands out the heroes (or takes over a gone player's)
        if (!host || !msg.seats || typeof msg.seats !== 'object') return { out: [] };
        for (const h of HEROES) if (this.player(msg.seats[h])) this.seats[h] = msg.seats[h];
        return all();
      }
      case 'start': { // the host starts a fight (or the next): everyone starts it from the same seed
        if (!host) return { out: [] };
        const fight = small(msg.fight, 600);
        if (!fight) return { out: [] };
        this.fight = fight;
        this.log = [];
        this.game++;
        this.blocked.clear();
        return all();
      }
      case 'lobby': { // the host takes everyone back to the lobby
        if (!host) return { out: [] };
        this.fight = null;
        this.log = [];
        this.game++;
        this.blocked.clear();
        return all();
      }
      case 'ready': // rebuilt after a refused command
        this.blocked.delete(id);
        return { out: [] };
      case 'cmd': {
        const fits = !this.blocked.has(id) && this.fight && msg.g === this.game && msg.at === this.log.length && this.log.length < MAX_LOG
          && msg.cmd && typeof msg.cmd === 'object' && typeof msg.cmd.type === 'string' && JSON.stringify(msg.cmd).length <= 400;
        if (!fits) {
          if (this.fight && msg.g === this.game) this.blocked.add(id);
          return { out: [{ to: id, msg: { t: 'stale', g: this.game, at: this.log.length } }] };
        }
        this.log.push({ cmd: msg.cmd, by: id });
        return { out: [{ to: '*', msg: { t: 'cmd', g: this.game, at: this.log.length - 1, cmd: msg.cmd, by: id } }] };
      }
      default:
        return { out: [] };
    }
  }
}

/** Has a socket sent too much? `rate` is its { n, since } so far (updated). */
export function overRate(rate, now = Date.now()) {
  if (now - rate.since > RATE.ms) {
    rate.since = now;
    rate.n = 0;
  }
  return ++rate.n > RATE.n;
}

/** Hand each message to the sockets it's for: `socks` is [[socket, player id]]. */
export function deliver(out, socks) {
  for (const { to, not, msg } of out) {
    const text = JSON.stringify(msg);
    for (const [ws, id] of socks) {
      if (!id || id === not || (to !== '*' && to !== id)) continue;
      try { ws.send(text); } catch { /* closing */ }
    }
  }
}

/** One room code's Durable Object: its sockets hibernate, its state lives in storage. */
export class CoopRoom {
  constructor(ctx) {
    this.ctx = ctx;
    ctx.blockConcurrencyWhile(async () => {
      this.core = new RoomCore(await ctx.storage.get('room'));
      this.core.online(this.socks().map(([, id]) => id));
    });
  }

  /** The open sockets with the player each belongs to. */
  socks() {
    return this.ctx.getWebSockets().map((ws) => [ws, ws.deserializeAttachment()?.id]);
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: null, rate: { n: 0, since: Date.now() } });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, data) {
    const att = ws.deserializeAttachment() ?? { id: null, rate: { n: 0, since: Date.now() } };
    if (typeof data !== 'string' || data.length > MAX_MESSAGE || overRate(att.rate)) return ws.close(1008, 'too much');
    let msg;
    try { msg = JSON.parse(data); } catch { return ws.close(1003, 'not json'); }
    let res;
    if (!att.id) {
      if (msg?.t !== 'hello') return ws.close(1008, 'hello first');
      res = this.core.hello(msg.id, msg.name);
      if (res.error) {
        ws.send(JSON.stringify({ t: 'refused', why: res.error }));
        return ws.close(1008, res.error);
      }
      // The same player on a newer socket (a reconnect): the old one goes quietly.
      for (const [old, id] of this.socks()) if (old !== ws && id === msg.id) { old.serializeAttachment({ id: null }); old.close(4000, 'replaced'); }
      att.id = msg.id;
    } else res = this.core.message(att.id, msg);
    ws.serializeAttachment(att);
    deliver(res.out, this.socks());
    await this.ctx.storage.put('room', this.core.snapshot());
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
  }

  async webSocketClose(ws) { await this.gone(ws); }

  async webSocketError(ws) { await this.gone(ws); }

  async gone(ws) {
    const id = ws.deserializeAttachment()?.id;
    ws.serializeAttachment({ id: null });
    if (!id || this.socks().some(([other, oid]) => other !== ws && oid === id)) return;
    deliver(this.core.leave(id).out, this.socks());
    await this.ctx.storage.put('room', this.core.snapshot());
  }

  /** Nobody has touched the room for IDLE_MS: forget it. */
  async alarm() {
    if (this.socks().length) return this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
    await this.ctx.storage.deleteAll();
    this.core = new RoomCore();
  }
}
