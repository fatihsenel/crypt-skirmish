// Anonymous play stats (Umami Cloud): a page view and a few game events (a run started, a room
// won or lost, a stop's choice, a run abandoned, a campaign won, a replay watched), so we can see
// where runs end. No cookies, nothing personal: the events carry rooms, classes and rounds, never
// names, and the page's address goes without its ?query and #hash (a link's fight).
// A crash in the game's own code is reported by kind and place (file, line, column), never its
// message; a fight left half-way (the page closed or reloaded mid-fight) by room and round.
// Only the deployed game sends them, after the title is up, while Settings › Share anonymous play
// stats is on, and not when the browser asks not to be tracked. Test links (?level=, ?victory)
// send nothing; the dev server logs the events to the console instead.

const HOST = 'fatihsenel.github.io';
const SCRIPT = 'https://cloud.umami.is/script.js';
export const WEBSITE = '90fc36a8-7d1b-4488-bbcd-2cba1311156d'; // Umami's id for the game
const HEROES = ['F', 'W', 'R', 'C'];
/** The loss-replay Worker (worker/): lost fights go there to be watched on the ?losses page. */
export const LOSS_API = 'https://crypt-skirmish-losses.fatih-senel.workers.dev';

/** Whether this page may send stats at all (the setting aside). */
export function statsAllowed({ prod, host, search, dnt }) {
  const test = /[?&](level|victory)\b/.test(search);
  return !!prod && host === HOST && dnt !== '1' && !test;
}

const env = () => ({
  prod: import.meta.env.PROD,
  host: location.hostname,
  search: location.search,
  dnt: navigator.doNotTrack ?? window.doNotTrack,
});

let on = null; // the setting, once boot.js has read it (null before: events wait for it)
let loading = false;
const queue = []; // events before the script is in (at most a few)
const tallyQueue = []; // events before the setting is read, for the Worker's tallies
let visited = false; // the visit tally goes once a page

/** The party as class letters in hero order, e.g. "FWRC" or "PKAC". */
export const partyCode = (campaign) => HEROES.map((c) => campaign?.party?.[c]?.cls ?? c).join('');

const fightBase = (nodeId, campaign, mode, input) => ({
  room: nodeId, mode, difficulty: campaign?.difficulty ?? 'normal', tier: campaign?.tier ?? 0, party: partyCode(campaign),
  ...(input && { input }),
});
/** Heroes on their feet, and how often any of them dropped. */
const partyState = (game) => ({
  standing: game.units.filter((u) => u.team === 'heroes' && u.alive && u.hp > 0).length,
  downed: Object.values(game.stats).reduce((n, h) => n + (h.downed ?? 0), 0),
});

/** A fight still going when the page closed or reloaded: where, which round, how the party stood. */
export const leftEvent = ({ game, nodeId, campaign, mode, input }) => ['fight-left', {
  ...fightBase(nodeId, campaign, mode, input), round: game.round, ...partyState(game),
}];

/** The input pressed most, from counts: touch, mouse or keys (a tie in that order), or none. */
export function inputKind(counts) {
  const [kind, n] = ['touch', 'mouse', 'keys'].map((k) => [k, counts[k] ?? 0]).reduce((a, b) => (b[1] > a[1] ? b : a));
  return n > 0 ? kind : 'none';
}
const inputs = { touch: 0, mouse: 0, keys: 0 };
const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta'];
/** Count presses by input from now on (a pen counts as touch). boot.js calls it. */
export function watchInput() {
  window.addEventListener('pointerdown', (e) => { inputs[e.pointerType === 'mouse' ? 'mouse' : 'touch']++; }, { capture: true, passive: true });
  window.addEventListener('keydown', (e) => { if (!e.repeat && !MODIFIERS.includes(e.key)) inputs.keys++; }, { capture: true, passive: true });
}
/** The input used most since the last call (a fight's start), and the count starts again. */
export function takeInput() {
  const kind = inputKind(inputs);
  inputs.touch = inputs.mouse = inputs.keys = 0;
  return kind;
}

/**
 * How smoothly the board draws: the frame rate while something moves (stage.js counts
 * `frames` drawn back to back over `seconds`) in a band, and the pixel ratio it draws at (to a half).
 */
export function perfEvent({ frames, seconds, dpr }) {
  if (!frames || !(seconds > 0)) return null;
  const fps = frames / seconds;
  return ['perf', { fps: fps >= 50 ? '50+' : fps >= 30 ? '30-50' : 'under 30', dpr: Math.max(1, Math.round((dpr || 1) * 2) / 2) }];
}

/** The browser's family from its user agent: chrome, safari, firefox, edge, samsung or other. */
export function browserFamily(ua = '') {
  if (/\bEdg(e|A|iOS)?\//.test(ua)) return 'edge';
  if (/SamsungBrowser\//.test(ua)) return 'samsung';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'safari';
  return 'other';
}

/**
 * A crash as [name, data]: its type, and the file, line and column of the first stack frame in
 * this page's own scripts (the built file's name carries its build). Null when it isn't ours
 * (an extension, another site's script) or there's nothing to go on. The message is never sent:
 * it can hold anything.
 */
export function errorEvent(error, { origin, ua }) {
  if (!error || typeof error !== 'object' || typeof error.stack !== 'string') return null;
  const here = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = error.stack.match(new RegExp(`${here}/[^\\s()]*?([\\w.-]+\\.js)(?:\\?[^:\\s()]*)?:(\\d+):(\\d+)`));
  if (!m) return null;
  const type = typeof error.name === 'string' && /^\w{1,40}$/.test(error.name) ? error.name : 'Error';
  return ['error', { type, file: m[1], line: Number(m[2]), col: Number(m[3]), browser: browserFamily(ua) }];
}

const MAX_ERRORS = 3; // reported in a visit; the same place only once
const errorsSeen = new Set();
/** Report crashes (thrown errors and unhandled rejections) as they happen. boot.js calls it first thing. */
export function watchErrors() {
  const report = (error) => {
    try {
      if (errorsSeen.size >= MAX_ERRORS) return;
      const ev = errorEvent(error, { origin: location.origin, ua: navigator.userAgent });
      const where = ev && `${ev[1].file}:${ev[1].line}:${ev[1].col}`;
      if (!ev || errorsSeen.has(where)) return;
      errorsSeen.add(where);
      track(...ev);
    } catch { /* never a crash about a crash */ }
  };
  window.addEventListener('error', (e) => report(e.error));
  window.addEventListener('unhandledrejection', (e) => report(e.reason));
}

/** What a finished fight reports: [name, data] pairs. `mode` is campaign, daily, weekly or challenge. */
export function fightEvents({ game, nodeId, campaign, mode, final, input }) {
  const won = game.over === 'victory';
  const base = fightBase(nodeId, campaign, mode, input);
  const out = [[won ? 'fight-won' : 'fight-lost', { ...base, rounds: game.round, ...partyState(game) }]];
  if (won && final) out.push(['campaign-won', { ...base, relics: campaign?.relics?.length ?? 0 }]);
  return out;
}

/** A new run: its difficulty, tier and party. */
export const runEvent = (campaign, kind = 'new') => ['run-start', {
  kind, difficulty: campaign.difficulty, tier: campaign.tier ?? 0, party: partyCode(campaign),
}];

/** A saved run picked up again: where it stands, and whether a fight was under way. */
export const continueEvent = (campaign, midFight) => ['run-continue', {
  room: campaign.at ?? 'start', cleared: campaign.cleared?.length ?? 0, difficulty: campaign.difficulty, tier: campaign.tier ?? 0, midFight,
}];

/** Something shared: `what` (replay, challenge, result, run-card, photo) and `how` (share sheet, copy or save). */
export const shareEvent = (what, how) => ['shared', { what, how }];

/** A run left unfinished for a new one: how far it got. */
export const abandonEvent = (campaign) => ['run-abandon', {
  room: campaign.at ?? 'start', cleared: campaign.cleared?.length ?? 0, difficulty: campaign.difficulty, tier: campaign.tier ?? 0,
}];

function send(name, data) {
  const u = window.umami;
  if (!u) return false;
  try {
    if (name) u.track(name, data);
    else u.track(); // the page view
  } catch { /* stats never get in the way of the game */ }
  return true;
}

function load() {
  if (loading) return;
  loading = true;
  const s = document.createElement('script');
  s.src = SCRIPT;
  s.defer = true;
  Object.assign(s.dataset, {
    websiteId: WEBSITE,
    autoTrack: 'false', // the page view is sent here, once
    domains: HOST,
    doNotTrack: 'true',
    excludeSearch: 'true',
    excludeHash: 'true',
  });
  s.onload = () => {
    if (!on) return;
    send();
    for (const [name, data] of queue.splice(0)) send(name, data);
  };
  s.onerror = () => { loading = false; queue.length = 0; }; // blocked or offline: no stats
  document.head.append(s);
}

/** Start (or stop) sending, as the setting says. Loads the script once the title is up. */
export function setStats(enabled) {
  on = !!enabled;
  if (!on || !statsAllowed(env())) return void (queue.length = tallyQueue.length = 0);
  if (!visited) { visited = true; sendTally('visit', {}); }
  for (const [name, data] of tallyQueue.splice(0)) sendTally(name, data);
  if (window.umami) for (const [name, data] of queue.splice(0)) send(name, data);
  else load();
}

/** One game event. Nothing is sent while the setting is off or on a test page; before the setting is read, it waits. */
export function track(name, data) {
  if (on === false) return;
  if (import.meta.env.DEV) return void console.debug('[stats]', name, data);
  if (!statsAllowed(env())) return;
  if (on === null) { if (tallyQueue.length < 20) tallyQueue.push([name, data]); } else sendTally(name, data);
  if ((on === null || !send(name, data)) && queue.length < 20) queue.push([name, data]); // sent once the script is in
}

/**
 * The same event, counted by day in the loss-replay Worker (`/event`): the weekly digest reads
 * those tallies, since Umami Cloud's API is for paid plans. No address or id is stored.
 */
function sendTally(name, data) {
  try {
    fetch(`${LOSS_API}/event`, {
      method: 'POST', body: JSON.stringify({ name, data: data ?? {} }), keepalive: true,
      headers: { 'Content-Type': 'text/plain' }, // a simple request: no preflight
    }).catch(() => {});
  } catch { /* stats never get in the way of the game */ }
}

/** The record without the heroes' names, for sending. */
export const withoutNames = (record) => ({
  ...record,
  party: Object.fromEntries(Object.entries(record.party).map(([code, { name, ...hero }]) => [code, hero])),
});

/**
 * A lost fight for the loss-replay Worker: `code` is the record as a #watch= link carries it
 * (made from withoutNames), `meta` its room, difficulty, tier, mode and rounds. Sent under the
 * same rules as the events.
 */
export function sendLoss(code, meta) {
  if (on !== true || !LOSS_API || import.meta.env.DEV || !statsAllowed(env())) return;
  fetch(`${LOSS_API}/loss`, {
    method: 'POST', body: JSON.stringify({ code, ...meta }), keepalive: true,
    headers: { 'Content-Type': 'text/plain' }, // a simple request: no preflight
  }).catch(() => {});
}

/** Several events, as fightEvents gives them. */
export const trackAll = (events) => { for (const [name, data] of events) track(name, data); };
