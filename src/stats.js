// Anonymous play stats (Umami Cloud): a page view and a few game events (a run started, a room
// won or lost, a stop's choice, a run abandoned, a campaign won, a replay watched), so we can see
// where runs end. No cookies, nothing personal: the events carry rooms, classes and rounds, never
// names, and the page's address goes without its ?query and #hash (a link's fight).
// Only the deployed game sends them, after the title is up, while Settings › Share anonymous play
// stats is on, and not when the browser asks not to be tracked. Test links (?level=, ?victory)
// send nothing; the dev server logs the events to the console instead.

const HOST = 'fatihsenel.github.io';
const SCRIPT = 'https://cloud.umami.is/script.js';
const WEBSITE = '90fc36a8-7d1b-4488-bbcd-2cba1311156d';
const HEROES = ['F', 'W', 'R', 'C'];

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

let on = false; // the setting
let loading = false;
const queue = []; // events before the script is in (at most a few)

/** The party as class letters in hero order, e.g. "FWRC" or "PKAC". */
export const partyCode = (campaign) => HEROES.map((c) => campaign?.party?.[c]?.cls ?? c).join('');

/** What a finished fight reports: [name, data] pairs. `mode` is campaign, daily, weekly or challenge. */
export function fightEvents({ game, nodeId, campaign, mode, final }) {
  const won = game.over === 'victory';
  const heroes = game.units.filter((u) => u.team === 'heroes');
  const base = {
    room: nodeId, mode, difficulty: campaign?.difficulty ?? 'normal', tier: campaign?.tier ?? 0, party: partyCode(campaign),
  };
  const out = [[won ? 'fight-won' : 'fight-lost', {
    ...base,
    rounds: game.round,
    standing: heroes.filter((u) => u.alive && u.hp > 0).length,
    downed: Object.values(game.stats).reduce((n, h) => n + (h.downed ?? 0), 0),
  }]];
  if (won && final) out.push(['campaign-won', { ...base, relics: campaign?.relics?.length ?? 0 }]);
  return out;
}

/** A new run: its difficulty, tier and party. */
export const runEvent = (campaign, kind = 'new') => ['run-start', {
  kind, difficulty: campaign.difficulty, tier: campaign.tier ?? 0, party: partyCode(campaign),
}];

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
  if (!on) queue.length = 0;
  if (on && statsAllowed(env())) load();
}

/** One game event. Nothing is sent while the setting is off or on a test page. */
export function track(name, data) {
  if (!on) return;
  if (import.meta.env.DEV) return void console.debug('[stats]', name, data);
  if (!statsAllowed(env())) return;
  if (!send(name, data) && queue.length < 20) queue.push([name, data]);
}

/** Several events, as fightEvents gives them. */
export const trackAll = (events) => { for (const [name, data] of events) track(name, data); };
