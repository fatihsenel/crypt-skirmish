// The co-op relay on this machine, for the dev server: the same rooms as the Worker's Durable
// Object (worker/src/room.js), over a bare-bones WebSocket server (text frames only, no packages).
//   npm run coop-relay            listens on ws://localhost:8788/coop/<CODE>
// The dev server's co-op connects here (src/coop.js); the built game connects to the Worker.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { RoomCore, deliver, overRate, MAX_MESSAGE, CODE } from '../worker/src/room.js';

const PORT = Number(process.env.PORT ?? 8788);
const rooms = new Map(); // code -> { core, socks: Set<Sock> }

/** A socket: frames out, frames in, one player id once it says hello. */
class Sock {
  constructor(socket, onText, onClose) {
    this.socket = socket;
    this.id = null;
    this.rate = { n: 0, since: Date.now() };
    this.buf = Buffer.alloc(0);
    this.closed = false;
    socket.on('data', (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      this.read(onText);
    });
    const gone = () => {
      if (this.closed) return;
      this.closed = true;
      onClose(this);
    };
    socket.on('close', gone);
    socket.on('error', gone);
  }

  read(onText) {
    while (this.buf.length >= 2) {
      const op = this.buf[0] & 0x0f;
      let len = this.buf[1] & 0x7f;
      let at = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); at = 10; }
      const masked = this.buf[1] & 0x80;
      const need = at + (masked ? 4 : 0) + len;
      if (this.buf.length < need) return;
      const mask = masked ? this.buf.subarray(at, at + 4) : null;
      const body = Buffer.from(this.buf.subarray(at + (masked ? 4 : 0), need));
      if (mask) for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
      this.buf = this.buf.subarray(need);
      if (op === 0x8) return this.close(1000);
      if (op === 0x9) this.frame(0xa, body); // ping: pong
      if (op === 0x1) onText(this, body.toString('utf8'));
    }
  }

  frame(op, body) {
    if (this.closed) return;
    const head = body.length < 126 ? Buffer.from([0x80 | op, body.length])
      : body.length < 65536 ? Buffer.from([0x80 | op, 126, body.length >> 8, body.length & 255])
        : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(body.length), 2); return h; })();
    this.socket.write(Buffer.concat([head, body]));
  }

  send(text) { this.frame(0x1, Buffer.from(text, 'utf8')); }

  close(code = 1000) {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(code);
    this.frame(0x8, b);
    this.socket.end();
  }
}

const server = createServer((req, res) => {
  res.writeHead(426, { 'Content-Type': 'text/plain' });
  res.end('websocket only');
});

server.on('upgrade', (req, socket) => {
  const code = req.url.match(/^\/coop\/([A-Z0-9]+)$/)?.[1];
  const key = req.headers['sec-websocket-key'];
  if (!code || !CODE.test(code) || !key) return socket.destroy();
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  let room = rooms.get(code);
  if (!room) rooms.set(code, room = { core: new RoomCore(), socks: new Set() });
  const pairs = () => [...room.socks].map((s) => [s, s.id]);
  const sock = new Sock(socket, (s, text) => {
    if (text.length > MAX_MESSAGE || overRate(s.rate)) return s.close(1008);
    let msg;
    try { msg = JSON.parse(text); } catch { return s.close(1003); }
    let r;
    if (!s.id) {
      if (msg?.t !== 'hello') return s.close(1008);
      r = room.core.hello(msg.id, msg.name);
      if (r.error) {
        s.send(JSON.stringify({ t: 'refused', why: r.error }));
        return s.close(1008);
      }
      for (const old of room.socks) if (old !== s && old.id === msg.id) { old.id = null; old.close(4000); }
      s.id = msg.id;
    } else r = room.core.message(s.id, msg);
    deliver(r.out, pairs());
  }, (s) => {
    room.socks.delete(s);
    if (s.id && ![...room.socks].some((o) => o.id === s.id)) deliver(room.core.leave(s.id).out, pairs());
  });
  room.socks.add(sock);
});

server.listen(PORT, () => console.log(`co-op relay on ws://localhost:${PORT}/coop/<CODE>`));
