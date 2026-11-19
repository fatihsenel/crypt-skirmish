// A finished fight as a link: its record (seed, party and the commands given, see replay.js)
// packed into the URL's #watch= part, so anyone who opens it watches the same fight. Nothing
// goes to a server. A link is checked by replaying it headlessly before it's shown: one
// made before the rules changed the dice order doesn't land where it ended, and is refused.

import { Game } from './combat.js';
import { replayFight, fightCheck } from './replay.js';
import { seeded } from './dice.js';
import { levelById } from './maps.js';
import { NODES, HERO_CODES, DIFFICULTIES, cleanName, runDifficulty } from './campaign.js';
import { CLASS_CHOICES } from './units.js';
import { ITEMS } from './items.js';

/** 2: New Game+ added the tier (`t`), so links from before it are refused. */
export const LINK_VERSION = 2;
export const WATCH_PREFIX = '#watch=';
/** Longer than this (in characters) and a link is not offered: some apps cut long links. */
export const MAX_LINK_CODE = 8000;

const int = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;

/** A party record from a link, rebuilt from known fields only (names cleaned), or null. */
export function cleanParty(party) {
  if (!party || typeof party !== 'object') return null;
  const out = {};
  for (const code of HERO_CODES) {
    const r = party[code];
    if (r === undefined) continue;
    if (!r || typeof r !== 'object' || !int(r.level, 1, 20) || typeof r.hp !== 'number' || !Array.isArray(r.items)) return null;
    const h = {
      level: r.level,
      hp: Math.max(0, Math.round(r.hp)),
      alive: r.alive !== false,
      slots: Object.fromEntries(Object.entries(r.slots && typeof r.slots === 'object' ? r.slots : {})
        .filter(([k, v]) => /^\d$/.test(k) && int(v, 0, 9))),
      potions: int(r.potions, 0, 99) ? r.potions : 0,
      items: r.items.filter((i) => typeof i === 'string' && Object.hasOwn(ITEMS, i)),
    };
    if (CLASS_CHOICES[code].includes(r.cls) && r.cls !== code) h.cls = r.cls;
    if (int(r.layOnHands, 0, 200)) h.layOnHands = r.layOnHands;
    const name = cleanName(r.name);
    if (name) h.name = name;
    out[code] = h;
  }
  return Object.keys(out).length ? out : null;
}

const COMMAND_KEYS = { type: 'string', id: 'string', x: 'number', z: 'number', target: 'number', attack: 'number', unit: 'number' };

/** A command from a link with only the fields commands use, or null. */
function cleanCommand(c) {
  if (!c || typeof c !== 'object' || typeof c.type !== 'string' || !/^[a-z]+$/i.test(c.type)) return null;
  const out = {};
  for (const [k, kind] of Object.entries(COMMAND_KEYS)) {
    if (c[k] === undefined) continue;
    if (typeof c[k] !== kind) return null;
    if (kind === 'number' && !int(c[k], 0, 999)) return null;
    if (kind === 'string' && !/^[a-z]+$/i.test(c[k])) return null;
    out[k] = c[k];
  }
  return out;
}

/** The record as a plain object for a link: { v, n, s, d, t?, p, l, r, c }. */
function pack(f) {
  return { v: LINK_VERSION, n: f.node, s: f.seed, d: f.difficulty, ...(f.tier && { t: f.tier }), p: f.party, l: f.log, r: f.result, c: f.check };
}

/** A record read from a link, cleaned, or null if anything is missing or unknown. */
export function unpack(o) {
  if (!o || typeof o !== 'object' || o.v !== LINK_VERSION) return null;
  if (typeof o.n !== 'string' || !NODES[o.n]?.level || !int(o.s, 0, 2 ** 32 - 1)) return null;
  if (!Object.hasOwn(DIFFICULTIES, o.d) || !['victory', 'defeat'].includes(o.r) || typeof o.c !== 'string') return null;
  if (o.t !== undefined && !int(o.t, 1, 99)) return null;
  const party = cleanParty(o.p);
  if (!party || !Array.isArray(o.l) || o.l.length > 5000) return null;
  const log = o.l.map(cleanCommand);
  if (log.includes(null)) return null;
  return { node: o.n, seed: o.s, difficulty: o.d, ...(o.t && { tier: o.t }), party, log, result: o.r, check: o.c };
}

/** Does the record replay to the end it says it had? (Same rules, same dice, same result.) */
export function replaysTrue(f) {
  try {
    const game = new Game(levelById(NODES[f.node].level), { party: f.party, difficulty: runDifficulty(f.difficulty, f.tier ?? 0), rng: seeded(f.seed) });
    const r = replayFight(game, f.log);
    return r.ok && game.over === f.result && fightCheck(game) === f.check;
  } catch {
    return false;
  }
}

// --- packing: JSON, deflated, in URL-safe base64 -------------------------------
async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

const toBase64Url = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text) => {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** The record as the text after #watch=. */
export async function encodeFight(f) {
  const json = new TextEncoder().encode(JSON.stringify(pack(f)));
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

/** The record from the text after #watch=, cleaned, or null if it can't be read. */
export async function decodeFight(code) {
  try {
    if (typeof code !== 'string' || code.length > MAX_LINK_CODE * 2 || !/^[\w-]+$/.test(code)) return null;
    const json = await pipe(fromBase64Url(code), new DecompressionStream('deflate-raw'));
    return unpack(JSON.parse(new TextDecoder().decode(json)));
  } catch {
    return null;
  }
}

/** The whole link: the page's address with the fight after #watch=. */
export const fightUrl = (pageUrl, code) => `${pageUrl.split('#')[0].split('?')[0]}${WATCH_PREFIX}${code}`;
