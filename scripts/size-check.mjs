// Fails when the build's first screen grows past its budget, gzipped as GitHub Pages sends it:
// the page with the code and styles it names (what has to arrive before the title), and the
// title skull (its code, model and textures). Run after `npm run build`; the deploy runs it.
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET = { title: 80, skull: 240 }; // kB
const dist = new URL('../dist/', import.meta.url);
const gz = (path) => gzipSync(readFileSync(new URL(path, dist)), { level: 9 }).length;
const html = readFileSync(new URL('index.html', dist), 'utf8');
const named = [...new Set([...html.matchAll(/(?:src|href)="[^"]*\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]))];
const skull = [
  ...readdirSync(new URL('assets/', dist)).filter((f) => /^titleLogo-.*\.js$/.test(f)).map((f) => `assets/${f}`),
  ...readdirSync(new URL('models/skull/', dist)).filter((f) => /\.(glb|jpg)$/.test(f)).map((f) => `models/skull/${f}`),
];
let failed = false;
for (const [name, files] of [['title', ['index.html', ...named]], ['skull', skull]]) {
  const kb = Math.round(files.reduce((s, f) => s + gz(f), 0) / 1024);
  const over = kb > BUDGET[name];
  failed ||= over;
  console.log(`${over ? 'FAIL' : 'PASS'} ${name}: ${kb} kB of ${BUDGET[name]} kB (${files.map((f) => f.split('/').pop()).join(', ')})`);
}
process.exit(failed ? 1 : 0);
