// A finished fight as a link: its record (seed, party and the commands given, see replay.js)
// packed into the URL's #watch= part, so anyone who opens it watches the same fight. Nothing
// goes to a server. A link is checked by replaying it headlessly before it's shown: one
// made before the rules changed the dice order doesn't land where it ended, and is refused.

import { Game, RULES } from './combat.js';
import { replayFight, fightCheck } from './replay.js';
import { seeded } from './dice.js';
import { levelById } from './maps.js';
import { NODES, HERO_CODES, DIFFICULTIES, cleanName, runDifficulty } from './campaign.js';
import { CLASS_CHOICES } from './units.js';
import { ITEMS, cleanRelics } from './items.js';

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

const COMMAND_KEYS = { type: 'string', id: 'string', x: 'number', z: 'number', target: 'number', attack: 'number', unit: 'number', spell: 'string' };

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

/** The record as a plain object for a link: { v, n, s, d, t?, ru?, rl?, p, l, r, c }. */
function pack(f) {
  return { v: LINK_VERSION, n: f.node, s: f.seed, d: f.difficulty, ...(f.tier && { t: f.tier }), ...(f.rules > 1 && { ru: f.rules }), ...(f.relics?.length && { rl: f.relics }), p: f.party, l: f.log, r: f.result, c: f.check };
}

/** A record read from a link, cleaned, or null if anything is missing or unknown. */
export function unpack(o) {
  if (!o || typeof o !== 'object' || o.v !== LINK_VERSION) return null;
  if (typeof o.n !== 'string' || !NODES[o.n]?.level || !int(o.s, 0, 2 ** 32 - 1)) return null;
  if (!Object.hasOwn(DIFFICULTIES, o.d) || !['victory', 'defeat'].includes(o.r) || typeof o.c !== 'string') return null;
  if (o.t !== undefined && !int(o.t, 1, 99)) return null;
  if (o.ru !== undefined && !int(o.ru, 2, RULES)) return null; // rules newer than these can't be played
  if (o.rl !== undefined && (!Array.isArray(o.rl) || cleanRelics(o.rl).length !== o.rl.length)) return null;
  const relics = cleanRelics(o.rl);
  const party = cleanParty(o.p);
  if (!party || !Array.isArray(o.l) || o.l.length > 5000) return null;
  const log = o.l.map(cleanCommand);
  if (log.includes(null)) return null;
  return { node: o.n, seed: o.s, difficulty: o.d, ...(o.t && { tier: o.t }), ...(o.ru && { rules: o.ru }), ...(relics.length && { relics }), party, log, result: o.r, check: o.c };
}

/**
 * Replay the record headlessly: { rounds } when it lands on the end it says it had (same
 * rules, same dice, same result), else null. The rounds aren't in the link; this tells them.
 */
export function replayOutcome(f) {
  try {
    const game = new Game(levelById(NODES[f.node].level), { party: f.party, difficulty: runDifficulty(f.difficulty, f.tier ?? 0), rng: seeded(f.seed), relics: f.relics ?? [], rules: f.rules ?? 1 });
    const r = replayFight(game, f.log);
    return r.ok && game.over === f.result && fightCheck(game) === f.check ? { rounds: game.round } : null;
  } catch {
    return null;
  }
}

/** Does the record replay to the end it says it had? */
export const replaysTrue = (f) => replayOutcome(f) !== null;

const roundsText = (n) => `${n} round${n === 1 ? '' : 's'}`;

/**
 * The end screen of playing a linked fight yourself: { title, text } comparing `theirs`
 * ({ result, rounds }, the link's fight) with `mine` ({ won, rounds }) in the room `room`.
 */
export function challengeText(theirs, mine, room) {
  const theyWon = theirs.result === 'victory';
  if (!mine.won) {
    const them = theyWon ? `The link won in ${roundsText(theirs.rounds)}.` : `The link’s party fell too, in round ${theirs.rounds}.`;
    return { title: 'Defeat', text: `Your party fell in ${room} in round ${mine.rounds}. ${them} Try again from the same dice.` };
  }
  let them;
  if (!theyWon) them = `, where the link’s party fell in round ${theirs.rounds}.`;
  else if (mine.rounds < theirs.rounds) them = `, faster than the link’s ${theirs.rounds}.`;
  else if (mine.rounds === theirs.rounds) them = ', level with the link.';
  else them = `. The link did it in ${theirs.rounds}.`;
  return { title: 'Challenge won', text: `You won ${room} in ${roundsText(mine.rounds)}${them}` };
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

/**
 * The whole link: the page's address with the fight after #watch= (`kind` 'watch': it's
 * replayed) or #play= ('play': a challenge, played from the same dice before it's shown).
 */
export const fightUrl = (pageUrl, code, kind = 'watch') => `${pageUrl.split('#')[0].split('?')[0]}#${kind}=${code}`;

/** The fight link in a page's `hash`: { kind: 'watch' | 'play', code }, or null. */
export function linkIn(hash) {
  const m = /^#(watch|play)=([\w-]+)$/.exec(hash ?? '');
  return m ? { kind: m[1], code: m[2] } : null;
}
