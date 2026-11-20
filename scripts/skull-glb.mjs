// Converts the title skull's OBJ scan to a binary glTF, public/models/skull/skull.glb.
// GitHub Pages sends .obj files uncompressed (277 kB) but compresses .glb, and a glTF's
// indexed buffers are smaller to begin with. Each `o` object stays its own named mesh: the
// title opens and shuts the one called Jaw. UVs keep the OBJ's orientation, since the title
// loads its textures with TextureLoader, not from the file.
//   node scripts/skull-glb.mjs path/to/skull.obj
import { readFileSync, writeFileSync } from 'node:fs';

const src = process.argv[2];
if (!src) throw new Error('usage: node scripts/skull-glb.mjs path/to/skull.obj');
const lines = readFileSync(src, 'utf8').split('\n');
const v = [], vt = [], vn = [];
const objects = [];
let cur = null;
for (const line of lines) {
  const [k, ...p] = line.trim().split(/\s+/);
  if (k === 'v') v.push(p.map(Number));
  else if (k === 'vt') vt.push(p.slice(0, 2).map(Number));
  else if (k === 'vn') vn.push(p.map(Number));
  else if (k === 'o') objects.push((cur = { name: p.join(' '), faces: [] }));
  else if (k === 'f') {
    if (!cur) objects.push((cur = { name: 'Skull', faces: [] }));
    const c = p.map((s) => s.split('/').map((n) => (n ? Number(n) - 1 : -1)));
    for (let i = 1; i + 1 < c.length; i++) cur.faces.push(c[0], c[i], c[i + 1]); // a fan of triangles
  }
}

// One indexed vertex per distinct position/uv/normal triple, per object.
const chunks = [], accessors = [], views = [], meshes = [], nodes = [];
let offset = 0;
const add = (typed, target) => {
  const pad = (4 - (typed.byteLength % 4)) % 4;
  chunks.push(Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength), Buffer.alloc(pad));
  views.push({ buffer: 0, byteOffset: offset, byteLength: typed.byteLength, ...(target && { target }) });
  offset += typed.byteLength + pad;
  return views.length - 1;
};
for (const o of objects) {
  const map = new Map(), pos = [], nor = [], uv = [], idx = [];
  for (const [a, b, c] of o.faces) {
    const key = `${a}/${b}/${c}`;
    let i = map.get(key);
    if (i === undefined) {
      i = map.size;
      map.set(key, i);
      pos.push(...v[a]);
      nor.push(...(c >= 0 ? vn[c] : [0, 1, 0]));
      uv.push(...(b >= 0 ? vt[b] : [0, 0]));
    }
    idx.push(i);
  }
  const P = new Float32Array(pos), N = new Float32Array(nor), T = new Float32Array(uv);
  const I = map.size < 65536 ? new Uint16Array(idx) : new Uint32Array(idx);
  const min = [0, 1, 2].map((k) => Math.min(...pos.filter((_, j) => j % 3 === k)));
  const max = [0, 1, 2].map((k) => Math.max(...pos.filter((_, j) => j % 3 === k)));
  const acc = (view, componentType, count, type, extra = {}) => (accessors.push({ bufferView: view, componentType, count, type, ...extra }), accessors.length - 1);
  const attributes = {
    POSITION: acc(add(P, 34962), 5126, map.size, 'VEC3', { min, max }),
    NORMAL: acc(add(N, 34962), 5126, map.size, 'VEC3'),
    TEXCOORD_0: acc(add(T, 34962), 5126, map.size, 'VEC2'),
  };
  const indices = acc(add(I, 34963), I instanceof Uint16Array ? 5123 : 5125, idx.length, 'SCALAR');
  meshes.push({ name: o.name, primitives: [{ attributes, indices }] });
  nodes.push({ name: o.name, mesh: meshes.length - 1 });
}

const bin = Buffer.concat(chunks);
const json = Buffer.from(JSON.stringify({
  asset: { version: '2.0', generator: 'crypt-skirmish skull-glb.mjs' },
  scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes, accessors,
  bufferViews: views, buffers: [{ byteLength: bin.length }],
}));
const jpad = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20);
const total = 12 + 8 + json.length + jpad.length + 8 + bin.length;
const head = Buffer.alloc(12);
head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
const chunkHead = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
const out = new URL('../public/models/skull/skull.glb', import.meta.url);
writeFileSync(out, Buffer.concat([head, chunkHead(json.length + jpad.length, 0x4e4f534a), json, jpad, chunkHead(bin.length, 0x004e4942), bin]));
console.log(`skull.glb: ${objects.map((o) => o.name).join(', ')}, ${total} bytes`);
