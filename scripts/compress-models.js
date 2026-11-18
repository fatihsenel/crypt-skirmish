// Compress every .glb under public/models for a faster first load: animation keyframes are
// resampled (redundant keys dropped), then vertex and keyframe data are quantized and
// meshopt-compressed (EXT_meshopt_compression + KHR_mesh_quantization). The loaders in
// src/render decode them with three's MeshoptDecoder. Node and mesh names are kept, so
// modelSpecs.js still finds every weapon and prop.
//
//   node scripts/compress-models.js          compress files that aren't compressed yet
//   node scripts/compress-models.js --check  only list the files that would change
//
// Run scripts/trim-models.js first when adding clips: it reads uncompressed files only, so
// a new clip has to come from the original (git history keeps the uncompressed files).

import { readFileSync, readdirSync, statSync, renameSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../public/models/', import.meta.url));
const BIN = fileURLToPath(new URL('../node_modules/.bin/gltf-transform', import.meta.url));
const check = process.argv.includes('--check');

function glbFiles(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return glbFiles(p);
    return f.endsWith('.glb') ? [p] : [];
  });
}

function compressed(path) {
  const buf = readFileSync(path);
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
  return (json.extensionsUsed ?? []).includes('EXT_meshopt_compression');
}

const tmp = mkdtempSync(join(tmpdir(), 'models-'));
let before = 0;
let after = 0;
try {
  for (const path of glbFiles(DIR)) {
    if (compressed(path)) continue;
    const size = statSync(path).size;
    if (check) {
      console.log(`would compress ${path.slice(DIR.length)} (${Math.round(size / 1024)} kB)`);
      continue;
    }
    const mid = join(tmp, 'resampled.glb');
    const out = join(tmp, 'out.glb');
    execFileSync(BIN, ['resample', path, mid], { stdio: 'ignore' });
    execFileSync(BIN, ['meshopt', mid, out], { stdio: 'ignore' });
    renameSync(out, path);
    const now = statSync(path).size;
    before += size;
    after += now;
    console.log(`${path.slice(DIR.length)}: ${Math.round(size / 1024)} kB -> ${Math.round(now / 1024)} kB`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
if (!check) console.log(`total ${Math.round(before / 1024)} kB -> ${Math.round(after / 1024)} kB`);
