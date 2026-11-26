// Co-op online: the connection to a room on the relay (worker/src/room.js). It keeps the room
// as the relay last described it, and the fight's commands in the relay's order. main.js applies
// our own heroes' commands at once and plays a friend's from that order, like a replay
// (coopRemoteTurn there). A dropped connection reconnects on its own and gets the whole log again.

/** The relay: the Worker when built, the local one (npm run coop-relay) on the dev server. */
export const COOP_URL = import.meta.env?.DEV ? 'ws://localhost:8788' : 'wss://crypt-skirmish-losses.fatih-senel.workers.dev';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** A new room's code: six letters and digits that are easy to read out (no I, O, 0 or 1). */
export function newRoomCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < 6; i++) s += LETTERS[Math.floor(rand() * LETTERS.length)];
  return s;
}

/** A room code as typed: capitals, the look-alikes fixed, or null. */
export function cleanCode(text) {
  const s = String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I/g, '1');
  return /^[A-HJ-NP-Z2-9]{6}$/.test(s) ? s : null;
}

/**
 * This tab's player id: kept for the tab's life (a reload rejoins as the same player), not
 * shared with other tabs (two tabs are two players).
 */
export function playerId(store = globalThis.sessionStorage) {
  const key = 'crypt-skirmish:coop-id';
  try {
    const had = store.getItem(key);
    if (had && /^[a-z0-9]{8,24}$/.test(had)) return had;
  } catch { /* no storage */ }
  const id = Array.from({ length: 16 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
  try { store.setItem(key, id); } catch { /* not kept */ }
  return id;
}

export const HERO_SLOTS = ['F', 'W', 'R', 'C'];

export class CoopLink {
  /**
   * `handlers`: onRoom(room, before) for every change, onCmd(at) when a command arrives,
   * onStatus('connecting' | 'open' | 'lost' | 'refused', why) and onStale().
   */
  constructor(code, name, handlers = {}, { url = COOP_URL, Socket = globalThis.WebSocket, id = playerId() } = {}) {
    Object.assign(this, { code, name, h: handlers, url, Socket, id });
    this.room = null; // the room as the relay last described it
    this.log = []; // this fight's commands, in order
    this.waiters = [];
    this.tries = 0;
    this.closed = false;
    this.status = 'connecting';
    this.connect();
  }

  get you() { return this.id; }
  get host() { return this.room?.host === this.id; }
  get game() { return this.room?.game ?? 0; }
  /** The player id holding hero `slot` (F, W, R or C). */
  seat(slot) { return this.room?.seats?.[slot] ?? null; }
  playerName(id) { return this.room?.players.find((p) => p.id === id)?.name ?? 'Someone'; }
  isOn(id) { return !!this.room?.players.find((p) => p.id === id)?.on; }

  connect() {
    if (this.closed) return;
    this.setStatus('connecting');
    let ws;
    try {
      ws = new this.Socket(`${this.url}/coop/${this.code}`);
    } catch {
      return this.retry();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.tries = 0;
      ws.send(JSON.stringify({ t: 'hello', id: this.id, name: this.name }));
      clearInterval(this.pinger);
      this.pinger = setInterval(() => this.send({ t: 'ping' }), 25_000);
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.receive(msg);
    };
    ws.onclose = () => {
      clearInterval(this.pinger);
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.status !== 'refused') this.retry();
      this.wake();
    };
  }

  retry() {
    if (this.closed || this.status === 'refused') return;
    this.setStatus('lost');
    const ms = Math.min(10_000, 500 * 2 ** this.tries++);
    clearTimeout(this.again);
    this.again = setTimeout(() => this.connect(), ms);
  }

  setStatus(s, why) {
    if (this.status === s && !why) return;
    this.status = s;
    this.h.onStatus?.(s, why);
    this.wake();
  }

  receive(msg) {
    switch (msg.t) {
      case 'sync': { // on (re)joining: the room and the whole log
        const before = this.room;
        this.room = msg;
        if (!before || before.game !== msg.game) this.log = [];
        // Keep what we have; take the rest (a reconnect may have missed some).
        for (let i = this.log.length; i < msg.log.length; i++) this.log.push(msg.log[i]);
        this.setStatus('open');
        this.h.onRoom?.(this.room, before);
        this.wake();
        break;
      }
      case 'room': {
        const before = this.room;
        this.room = msg;
        if (before && before.game !== msg.game) this.log = [];
        this.h.onRoom?.(this.room, before);
        this.wake();
        break;
      }
      case 'cmd':
        if (msg.g !== this.game || msg.at !== this.log.length) {
          if (msg.g === this.game && msg.at > this.log.length) this.resync(); // missed some: start over
          break;
        }
        this.log.push(msg.cmd);
        this.h.onCmd?.(msg.at, msg.by);
        this.wake();
        break;
      case 'stale':
        this.h.onStale?.(msg);
        break;
      case 'refused':
        this.setStatus('refused', msg.why);
        this.wake();
        break;
      default:
    }
  }

  /** Reconnect for a fresh sync. */
  resync() {
    try { this.ws?.close(); } catch { /* gone */ }
  }

  send(msg) {
    if (this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Send a hero's command for place `at` of this fight's log. */
  command(cmd, at) { return this.send({ t: 'cmd', g: this.game, at, cmd }); }

  /**
   * The command at place `at` of fight `game`, once it's here; null if that fight is over
   * (a restart or a return to the lobby), the link is closed, or `stop()` says to stop waiting
   * (asked again on every message).
   */
  next(game, at, stop = () => false) {
    return new Promise((resolve) => {
      const check = () => {
        if (this.closed || this.game !== game) return resolve(null), true;
        if (this.log.length > at) return resolve(this.log[at]), true;
        if (stop()) return resolve(null), true;
        return false;
      };
      if (!check()) this.waiters.push(check);
    });
  }

  wake() { this.waiters = this.waiters.filter((check) => !check()); }

  close() {
    this.closed = true;
    clearInterval(this.pinger);
    clearTimeout(this.again);
    try { this.ws?.close(); } catch { /* gone */ }
    this.ws = null;
    this.wake();
  }
}
