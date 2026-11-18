// Strip the character models down to the animation clips the game plays.
// The KayKit and Quaternius packs ship 14 to 95 clips per model; the units use about ten
// (see src/render/modelSpecs.js). Dropping the rest, and the keyframe data only they
// used, makes each file several times smaller.
//
//   node scripts/trim-models.js          rewrite public/models/*.glb in place
//   node scripts/trim-models.js --check  only report what would change
//
// Run it again after adding a clip to modelSpecs.js: a clip already stripped from a file
// has to come back from the original pack first (git history keeps the untrimmed files).

import { readFileSync, writeFileSync } from 'node:fs';
import { clipsByFile } from '../src/render/modelSpecs.js';

const DIR = new URL('../public/models/', import.meta.url);
const check = process.argv.includes('--check');

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

function readGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a .glb');
  let at = 12;
  let json;
  let bin;
  while (at < buf.length) {
    const len = buf.readUInt32LE(at);
    const type = buf.readUInt32LE(at + 4);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === JSON_CHUNK) json = JSON.parse(data.toString('utf8'));
    else if (type === BIN_CHUNK) bin = data;
    at += 8 + len;
  }
  return { json, bin };
}

const pad4 = (n) => (n + 3) & ~3;

function writeGlb(json, bin) {
  const text = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonLen = pad4(text.length);
  const binLen = pad4(bin.length);
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const out = Buffer.alloc(total, 0);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonLen, 12);
  out.writeUInt32LE(JSON_CHUNK, 16);
  text.copy(out, 20);
  out.fill(0x20, 20 + text.length, 20 + jsonLen); // JSON is padded with spaces
  const b = 20 + jsonLen;
  out.writeUInt32LE(binLen, b);
  out.writeUInt32LE(BIN_CHUNK, b + 4);
  bin.copy(out, b + 8);
  return out;
}

/** Keep only the named clips, then drop accessors, buffer views and bytes nothing uses. */
function trim(json, bin, keep) {
  const clipName = (a) => (a.name ?? '').split('|').pop();
  const before = json.animations?.length ?? 0;
  json.animations = (json.animations ?? []).filter((a) => keep.has(clipName(a)));
  const missing = [...keep].filter((n) => !json.animations.some((a) => clipName(a) === n));

  // Accessors still in use.
  const usedAcc = new Set();
  for (const m of json.meshes ?? []) {
    for (const p of m.primitives) {
      Object.values(p.attributes).forEach((i) => usedAcc.add(i));
      if (p.indices !== undefined) usedAcc.add(p.indices);
      for (const t of p.targets ?? []) Object.values(t).forEach((i) => usedAcc.add(i));
    }
  }
  for (const s of json.skins ?? []) if (s.inverseBindMatrices !== undefined) usedAcc.add(s.inverseBindMatrices);
  for (const a of json.animations) for (const s of a.samplers) { usedAcc.add(s.input); usedAcc.add(s.output); }

  const accMap = new Map();
  const accessors = [];
  json.accessors.forEach((a, i) => {
    if (!usedAcc.has(i)) return;
    if (a.sparse) throw new Error('sparse accessors are not handled');
    accMap.set(i, accessors.length);
    accessors.push(a);
  });

  // Buffer views still in use, packed into a new binary chunk.
  const usedView = new Set(accessors.map((a) => a.bufferView).filter((v) => v !== undefined));
  for (const img of json.images ?? []) if (img.bufferView !== undefined) usedView.add(img.bufferView);
  const viewMap = new Map();
  const views = [];
  const parts = [];
  let offset = 0;
  json.bufferViews.forEach((v, i) => {
    if (!usedView.has(i)) return;
    if ((v.buffer ?? 0) !== 0) throw new Error('only one buffer is handled');
    const start = v.byteOffset ?? 0;
    const bytes = bin.subarray(start, start + v.byteLength);
    const aligned = pad4(offset);
    if (aligned > offset) parts.push(Buffer.alloc(aligned - offset));
    offset = aligned;
    viewMap.set(i, views.length);
    views.push({ ...v, byteOffset: offset });
    parts.push(bytes);
    offset += bytes.length;
  });

  const acc = (i) => accMap.get(i);
  for (const a of accessors) if (a.bufferView !== undefined) a.bufferView = viewMap.get(a.bufferView);
  for (const img of json.images ?? []) if (img.bufferView !== undefined) img.bufferView = viewMap.get(img.bufferView);
  for (const m of json.meshes ?? []) {
    for (const p of m.primitives) {
      for (const k of Object.keys(p.attributes)) p.attributes[k] = acc(p.attributes[k]);
      if (p.indices !== undefined) p.indices = acc(p.indices);
      for (const t of p.targets ?? []) for (const k of Object.keys(t)) t[k] = acc(t[k]);
    }
  }
  for (const s of json.skins ?? []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = acc(s.inverseBindMatrices);
  for (const a of json.animations) for (const s of a.samplers) { s.input = acc(s.input); s.output = acc(s.output); }

  json.accessors = accessors;
  json.bufferViews = views;
  const out = Buffer.concat(parts);
  json.buffers = [{ byteLength: out.length }];
  return { bin: out, before, after: json.animations.length, missing };
}

let failed = false;
for (const [file, keep] of clipsByFile()) {
  const url = new URL(`${file}.glb`, DIR);
  const buf = readFileSync(url);
  const { json, bin } = readGlb(buf);
  if ((json.extensionsUsed ?? []).includes('EXT_meshopt_compression')) {
    // Compressed buffers can't be sliced by accessor; start from the uncompressed file.
    console.error(`${file}.glb is meshopt-compressed (scripts/compress-models.js): restore it from git first`);
    failed = true;
    continue;
  }
  const r = trim(json, bin, keep);
  const out = writeGlb(json, r.bin);
  const kb = (n) => `${Math.round(n / 1024)} kB`;
  console.log(`${file}.glb: ${r.before} → ${r.after} clips, ${kb(buf.length)} → ${kb(out.length)}`);
  if (r.missing.length) {
    // Quaternius models have no clip for some kinds (spell, rise...); the rig skips those.
    console.log(`  not in this file: ${r.missing.join(', ')}`);
  }
  if (r.after === 0) failed = true;
  if (!check && out.length < buf.length) writeFileSync(url, out);
}
if (failed) {
  console.error('Some models were not trimmed (see above); a model with no clips left means modelSpecs.js needs checking.');
  process.exit(1);
}
