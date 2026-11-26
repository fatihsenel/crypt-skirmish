import { describe, it, expect, vi, afterEach } from 'vitest';
import { CoopLink, cleanCode, newRoomCode, playerId } from '../src/coop.js';
import { RoomCore, deliver, CODE } from '../worker/src/room.js';

/** Sockets wired straight to a RoomCore, as the relay would be (messages go out at once). */
function relay() {
  const core = new RoomCore();
  const socks = new Set();
  class Socket {
    constructor() {
      this.readyState = 0;
      this.id = null;
      socks.add(this);
      queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
    }
    send(text) {
      const msg = JSON.parse(text);
      let r;
      if (!this.id) {
        r = core.hello(msg.id, msg.name);
        if (r.error) return this.onmessage?.({ data: JSON.stringify({ t: 'refused', why: r.error }) });
        this.id = msg.id;
      } else r = core.message(this.id, msg);
      deliver(r.out, [...socks].filter((s) => s.readyState === 1).map((s) => [{ send: (t) => s.onmessage?.({ data: t }) }, s.id]));
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      socks.delete(this);
      if (this.id && ![...socks].some((s) => s.id === this.id)) deliver(core.leave(this.id).out, [...socks].map((s) => [{ send: (t) => s.onmessage?.({ data: t }) }, s.id]));
      this.onclose?.();
    }
  }
  return { core, Socket, socks };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('co-op room codes and ids', () => {
  it('makes codes the relay accepts and reads typed ones kindly', () => {
    for (let i = 0; i < 50; i++) expect(CODE.test(newRoomCode())).toBe(true);
    expect(cleanCode(' ab-c23 4 ')).toBe('ABC234');
    expect(cleanCode('ABCD')).toBe(null);
    expect(cleanCode('ABC1O2')).toBe(null); // 1 and 0 never appear in a code
  });

  it('keeps one id per tab', () => {
    const store = new Map();
    const s = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    const id = playerId(s);
    expect(id).toMatch(/^[a-z0-9]{16}$/);
    expect(playerId(s)).toBe(id);
  });
});

describe('CoopLink', () => {
  afterEach(() => vi.useRealTimers());

  it('joins, hears the room and orders commands', async () => {
    const { Socket } = relay();
    const rooms = [];
    const a = new CoopLink('ABCDEF', 'Ana', { onRoom: (r) => rooms.push(r) }, { Socket, id: 'aaaaaaaa1' });
    await tick();
    expect(a.status).toBe('open');
    expect(a.host).toBe(true);
    const b = new CoopLink('ABCDEF', 'Ben', {}, { Socket, id: 'bbbbbbbb2' });
    await tick();
    expect(b.host).toBe(false);
    expect(a.room.players.map((p) => p.name)).toEqual(['Ana', 'Ben']);
    a.send({ t: 'start', fight: { node: 'warren', seed: 7 } });
    expect(b.room.fight.seed).toBe(7);
    const waiting = b.next(b.game, 0);
    a.command({ type: 'move', x: 1, z: 2 }, 0);
    expect(await waiting).toEqual({ type: 'move', x: 1, z: 2 });
    expect(a.log).toEqual(b.log);
    a.close();
    b.close();
  });

  it('stops waiting when the fight changes, the link closes or stop() says so', async () => {
    const { Socket } = relay();
    const a = new CoopLink('ABCDEF', 'Ana', {}, { Socket, id: 'aaaaaaaa1' });
    await tick();
    a.send({ t: 'start', fight: { node: 'warren', seed: 1 } });
    const g = a.game;
    const restarted = a.next(g, 0);
    a.send({ t: 'start', fight: { node: 'warren', seed: 2 } });
    expect(await restarted).toBe(null);
    let mine = false;
    const handed = a.next(a.game, 0, () => mine);
    mine = true;
    a.send({ t: 'ping' }); // any message asks again… a pong isn't a room change: wake by hand
    a.wake();
    expect(await handed).toBe(null);
    const closed = a.next(a.game, 0);
    a.close();
    expect(await closed).toBe(null);
  });

  it('says when a command was refused, and reconnects with the whole log', async () => {
    vi.useFakeTimers();
    const { Socket, socks } = relay();
    const stale = [];
    const a = new CoopLink('ABCDEF', 'Ana', { onStale: (m) => stale.push(m) }, { Socket, id: 'aaaaaaaa1' });
    await vi.advanceTimersByTimeAsync(0);
    a.send({ t: 'start', fight: { node: 'warren', seed: 1 } });
    a.command({ type: 'end' }, 0);
    a.command({ type: 'end' }, 5);
    expect(stale).toEqual([{ t: 'stale', g: a.game, at: 1 }]);
    // The connection drops: it comes back on its own and gets the log again.
    [...socks][0].close();
    expect(a.status).toBe('lost');
    a.log = [];
    await vi.advanceTimersByTimeAsync(600);
    expect(a.status).toBe('open');
    expect(a.log).toEqual([{ type: 'end' }]);
    a.close();
  });
});
