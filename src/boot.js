// The page's entry: puts the title up from plain HTML before three.js and the rest of the game
// (main.js) have arrived, so on mobile data the title waits for a fifth of the download. The
// title's buttons are wired here and handed on to main.js once it has loaded (`later`); a
// press made before then waits for it.

import './style.css';
import { Camp } from './ui/camp.js';
import { hints } from './ui/hints.js';
import { parseSave, parseWonRun } from './game/campaign.js';
import './offline.js'; // the offline copy, registered as early as the title
import { loadSettings } from './game/settings.js';
import { setStats, watchErrors, watchInput } from './stats.js';

watchErrors(); // crashes are reported (by place, never message) once the stats are on
watchInput(); // a fight's stats say whether it was played by touch, mouse or keys

export const SAVE_KEY = 'crypt-skirmish.save';
/** The last won campaign, kept so New Game+ can start from it until a new campaign does. */
export const WON_KEY = 'crypt-skirmish:won-run';
// Storage can be blocked (private windows, sandboxed previews); the game still runs.
export function loadSave() {
  try { return parseSave(localStorage.getItem(SAVE_KEY)); } catch { return null; }
}
export const loadWonRun = () => {
  try { return parseWonRun(localStorage.getItem(WON_KEY)); } catch { return null; }
};

/** The camp's handlers, filled in by main.js. */
export const later = {};
let main = null;
const handOn = (name) => (...args) => main?.then(() => later[name]?.(...args));
hints(); // styled tooltips for data-hint, everywhere
document.documentElement.dataset.text = loadSettings().text; // the Text size setting, from the title on
export const camp = new Camp(Object.fromEntries([
  'onEnter', 'onEquip', 'onUnequip', 'onPick', 'onStyle', 'onNewCampaign', 'onDaily', 'onWeekly', 'onWatch',
  'onShareFight', 'onNewGamePlus', 'onContinue', 'onTrade', 'onEndless', 'onEndDive',
].map((name) => [name, handOn(name)])));

/** #boot (inline in index.html) covers the page until the title is up. */
export function hideBoot() {
  const $boot = document.getElementById('boot');
  if (!$boot || $boot.classList.contains('done')) return;
  $boot.classList.add('done');
  setTimeout(() => $boot.remove(), 600);
}

// ?level= and ?victory skip the title; main.js starts them. ?losses is the unlisted page of
// players' lost fights (ui/losses.js), with no game behind it.
const q = new URLSearchParams(location.search);
if (q.has('losses')) {
  import('./ui/losses.js').then((m) => { m.showLosses(); hideBoot(); });
} else {
  if (!q.has('level') && !q.has('victory')) {
    camp.showTitle(loadSave(), loadWonRun());
    hideBoot();
  }
  main = import('./main.js');
}
// Anonymous play stats (src/stats.js), once the page has loaded, so they never slow the title.
const startStats = () => setTimeout(() => setStats(loadSettings().stats), 1000);
if (document.readyState === 'complete') startStats();
else window.addEventListener('load', startStats, { once: true });
