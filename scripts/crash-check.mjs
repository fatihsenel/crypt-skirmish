// The daily crash check: did the game crash for anyone yesterday (UTC)? It reads the loss-replay
// Worker's tallies for that one day and fails (exit 1) on any crash, so the GitHub Actions run
// (.github/workflows/crash-check.yml) fails and GitHub emails about it. The log says only how
// many, since the repository is public: where they happened is on ?losses › Play stats.
// Key: LOSS_READ_KEY, from the environment.

import { fileURLToPath } from 'node:url';
import { LOSS_API } from '../src/stats.js';
import { readTallies } from '../src/tallies.js';

const DAY = 86_400_000;

/** { day, crashes } for the UTC day before `now`, or { day, error } when the Worker can't be read. */
export async function crashCheck({ fetch, key, now = Date.now() }) {
  const day = new Date(now - DAY).toISOString().slice(0, 10);
  if (!key) return { day, error: 'No read key (LOSS_READ_KEY).' };
  const res = await fetch(`${LOSS_API}/tallies?day=${day}`, { headers: { Authorization: `Bearer ${key}` } }).catch(() => null);
  if (!res?.ok) return { day, error: res ? `The Worker refused the read key (${res.status}).` : 'Couldn’t reach the Worker.' };
  return { day, crashes: readTallies((await res.json()).tallies).count('error') };
}

// node scripts/crash-check.mjs
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { day, crashes, error } = await crashCheck({ fetch, key: process.env.LOSS_READ_KEY || null });
  if (error) {
    console.log(error);
    process.exit(1);
  }
  if (crashes) {
    console.log(`${crashes} crash${crashes === 1 ? '' : 'es'} on ${day}: see https://fatihsenel.github.io/crypt-skirmish/?losses (Play stats).`);
    process.exit(1);
  }
  console.log(`No crashes on ${day}.`);
}
