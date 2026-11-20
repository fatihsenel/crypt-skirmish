// Controller: wires the rules engine (game/) to the renderer (render/) and HUD (ui/).
// The engine resolves everything instantly; animate.js plays the results back as animations.

import './style.css';
import * as THREE from 'three';
import { Game, ELITE_TRAITS } from './game/combat.js';
import { LEVELS, levelById } from './game/maps.js';
import { Grid } from './game/grid.js';
import {
  NODES, DIFFICULTIES, newCampaign, completeFight, takeRest, equip, unequip, serialize, parseSave,
  recordDefeat, runSummary, runShareText, choices, START_NODE, runDifficulty, newGamePlus, parseWonRun,
} from './game/campaign.js';
import { Heirlooms } from './ui/heirlooms.js';
import { applyCommand, monsterTurn, heroFell, replayFight, fightCheck, newSeed } from './game/replay.js';
import { key, pathFrom } from './game/grid.js';
import { signed, abilityMod, seeded } from './game/dice.js';
import { SPELLS, coneTiles, lineTiles, areaTiles, directionTo } from './game/abilities.js';
import { createStage } from './render/stage.js';
import { Board } from './render/board.js';
import { UnitView, floatText } from './render/unitView.js';
import { loadModels, modelsSettled } from './render/gltfModels.js';
import { filesForRoom, allFiles } from './render/modelSpecs.js';
import { preloadDungeon } from './render/dungeonKit.js';
import { spiritWeapon } from './render/effects.js';
import { wait, playback, calm, setMotion, onSystemMotion } from './render/tween.js';
import { Hud } from './ui/hud.js';
import { fightRecap, winRecap } from './game/recap.js';
import { Camp } from './ui/camp.js';
import { Bestiary } from './ui/bestiary.js';
import { meet, metBefore, slay, loadBestiary, slainTotal, recordBlows, slayElite, loadElitesSlain } from './game/bestiary.js';
import { TEMPLATES } from './game/units.js';
import { sfx } from './audio/sfx.js';
import { music } from './audio/music.js';
import { loadSettings, saveSettings, SPEEDS } from './game/settings.js';
import { SettingsPanel } from './ui/settings.js';
import { voices } from './audio/voices.js';
import { tips } from './ui/tips.js';
import { recordRun, loadHistory, saveLastFight, clearLastFight } from './game/history.js';
import { challengeText } from './game/fightLink.js';
import { unlock } from './game/achievements.js';
import { createLinks } from './links.js';
import { createThreats, listNames } from './threats.js';
import { createAnimations } from './animate.js';
import { tileFromEvent, figureRect, longPress, tileCommand, stepTile, ARROWS } from './input.js';
import { installDebug, sampleVictory } from './debug.js';
import { replayRate as barRate, replayGate as barGate, replayLabel as barLabel, replayPlay as barPlay, replaySpeed, replayKey } from './ui/replayBar.js';
import { dayKey, dailyPlan, dailyCampaign, partyAt, recordDaily, streak, loadDaily, shareText, recordBestFight } from './game/daily.js';
import { weekKey, weeklyPlan, weeklyCampaign, recordWeekly, weekStreak, weeklyShareText } from './game/weekly.js';

// All levels share one size, so the stage is set up once.
const stage = createStage(document.getElementById('stage'), {
  width: LEVELS[0].rows[0].length,
  height: LEVELS[0].rows.length,
});

// --- campaign & saves ---------------------------------------------------------
const SAVE_KEY = 'crypt-skirmish.save';
// Storage can be blocked (private windows, sandboxed previews); the game still runs.
// Test runs (?level=, __debug.level) never touch the save.
let saving = true;
function loadSave() {
  try { return parseSave(localStorage.getItem(SAVE_KEY)); } catch { return null; }
}
function writeSave(state) {
  if (!saving) return;
  try { localStorage.setItem(SAVE_KEY, serialize(state)); } catch { /* not saved */ }
}
/** The last won campaign, kept so New Game+ can start from it until a new campaign does. */
const WON_KEY = 'crypt-skirmish:won-run';
const loadWonRun = () => {
  try { return parseWonRun(localStorage.getItem(WON_KEY)); } catch { return null; }
};
function setWonRun(state) {
  try {
    if (state) localStorage.setItem(WON_KEY, serialize(state));
    else localStorage.removeItem(WON_KEY);
  } catch { /* not kept */ }
}

function clearSave() {
  if (!saving) return;
  try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing to clear */ }
}

/** Campaign state as of the last camp (and the last save). A lost fight leaves it untouched. */
let campaign = null;
/** The map node being fought. */
let nodeId = null;
/**
 * The fight in progress, saved with the campaign so a reload picks it up again:
 * { node, seed, log, check, explored, seen } (see replay.js). null when it can't be saved.
 */
let fight = null;
/**
 * The fight as it was played, to watch again from the end banner:
 * { node, seed, party, difficulty, log }. null once the AI has played a hero (autoplay).
 */
let record = null;
/**
 * The replay being watched, else null: { log, at, finished, fight, paused, speed, stepTurn, wake }.
 * `finished` and `fight` are the real fight's, put back when the replay ends.
 */
let replay = null;
/** Today's daily crypt while it's being played (see daily.js), or this week's elite crypt (weekly.js, `daily.weekly`), else null. */
let daily = null;
/** A linked fight being played yourself ({ rec, theirs }: the link's record and how it went), else null. */
let challenge = null;
/** What this fight's attacks did, for achievements: the biggest hit and sneak attacks landed. */
let feats = { maxHit: 0, sneaks: 0, stayDown: false };

// The character models load room by room: a fight waits only for the figures it needs.
// Once the dungeon tiles are in (they gate the title), the next room's models come first,
// then the rest in the background (see the boot code at the bottom).
const $loading = document.getElementById('loading');
let undoState = null; // { undo, unit }: the last move, while it can still be taken back (see undoMove)
let fightTicket = 0; // the latest fight asked for while its figures were loading
const roomFiles = (id, party) => filesForRoom(levelById(NODES[id].level).rows, party);

/** Save the campaign together with the fight in progress. */
function saveFight() {
  if (!fight || !game || game.over === 'defeat') return;
  fight.explored = board ? [...board.explored] : [];
  fight.seen = [...seenIds].map((id) => game.units.findIndex((u) => u.id === id)).filter((i) => i >= 0);
  writeSave({ ...campaign, fight });
}

const hud = new Hud({
  onEndTurn: () => endHeroTurn(),
  onUndo: () => undoMove(),
  onChoose: (choice) => choose(choice),
  onRestart: () => {
    if (!game) { // the ?victory sample: nothing to restart
      $banner.hidden = true;
      return backToTitle();
    }
    sfx.ui();
    if (daily || challenge) newGame(); // the daily or the linked fight again, from the same seed
    else if (game?.over === 'victory') startCampaign(); // after the final room
    else newGame(); // retry this room with the party as it entered
  },
  onNext: () => leaveRoom(),
  onMap: () => {
    if (daily || challenge) return backToTitle();
    sfx.ui();
    showCamp(null);
  },
  onToggleMusic: () => toggleMusic(),
  onToggleSound: () => toggleSound(),
});

const camp = new Camp({
  onEnter: (id) => enterRoom(id),
  onEquip: (i, code) => {
    sfx.chest();
    campaign = equip(campaign, i, code);
    writeSave(campaign);
    camp.show(campaign);
  },
  onUnequip: (code, i) => {
    sfx.ui();
    campaign = unequip(campaign, code, i);
    writeSave(campaign);
    camp.show(campaign);
  },
  onNewCampaign: (difficulty, names, classes) => startCampaign(difficulty, names, classes),
  onDaily: () => startDaily(),
  onWeekly: () => startDaily(true),
  onWatch: (f) => watchFromTitle(f),
  onShareFight: (f, button, kind) => links.copy(f, button, kind),
  onNewGamePlus: (button) => {
    const won = loadWonRun();
    if (won) heirlooms.open(won, button);
  },
  onContinue: () => {
    sfx.ui();
    saving = true;
    daily = null;
    challenge = null;
    campaign = loadSave() ?? newCampaign();
    const saved = campaign.fight;
    delete campaign.fight;
    if (saved) {
      camp.hide();
      nodeId = saved.node;
      newGame(saved);
    } else {
      showCamp(null);
    }
  },
});

function startCampaign(difficulty, names, classes) {
  sfx.ui();
  saving = true;
  daily = null;
  challenge = null;
  // A run being replaced (Abandon run, or New campaign over a save) goes into the history.
  const old = loadSave();
  if (old && !old.done) recordRun(old, 'abandoned');
  clearLastFight(); // whatever it was, it isn't this run's
  setWonRun(null); // a new campaign closes the way to New Game+
  campaign = newCampaign(difficulty, names, classes);
  writeSave(campaign);
  showCamp(null);
}

/** New Game+ after the won campaign: the same heroes, one kept item each, one tier deeper. */
const heirlooms = new Heirlooms((won, keep) => {
  sfx.ui();
  saving = true;
  daily = null;
  challenge = null;
  clearLastFight();
  setWonRun(null);
  campaign = newGamePlus(won, keep);
  writeSave(campaign);
  showCamp(null);
});

/** Today's daily crypt (or, `weekly`, this week's elite crypt): its room and party, apart from the campaign (nothing is saved). */
function startDaily(weekly = false) {
  sfx.ui();
  saving = false;
  challenge = null;
  daily = weekly ? weeklyPlan(weekKey()) : dailyPlan(dayKey());
  campaign = weekly ? weeklyCampaign(daily) : dailyCampaign(daily);
  nodeId = daily.node;
  camp.hide();
  newGame();
}

/**
 * Play a linked fight yourself: its room, party, difficulty and starting dice, apart from
 * the campaign (nothing is saved). `theirs` ({ result, rounds }) is how the link's fight went.
 */
function startChallenge(rec, theirs) {
  sfx.ui();
  saving = false;
  daily = null;
  challenge = { rec, theirs };
  campaign = { ...newCampaign(rec.difficulty), party: structuredClone(rec.party), ...(rec.tier && { tier: rec.tier }) };
  nodeId = rec.node;
  camp.hide();
  newGame();
}

/** From a daily crypt back to the title screen, with the empty dungeon behind it. */
function backToTitle() {
  sfx.ui();
  ++fightTicket;
  for (const id of [...spiritWeapons.keys()]) clearSpiritWeapon(id);
  if (board) {
    stage.scene.remove(board.group);
    board.dispose();
  }
  for (const v of views.values()) {
    v.dispose();
    stage.scene.remove(v.group);
  }
  views = new Map();
  game = null;
  fight = null;
  daily = null;
  challenge = null;
  campaign = null;
  hud.reset();
  showBackdrop();
  camp.showTitle(loadSave(), loadWonRun());
}

function showCamp(report) {
  $banner.hidden = true;
  camp.show(campaign, report);
  tips.notice('camp', { report });
}

function enterRoom(id) {
  sfx.ui();
  if (NODES[id].kind === 'rest') {
    campaign = takeRest(campaign, id);
    writeSave(campaign);
    sfx.heal();
    showCamp({ rest: id });
    return;
  }
  camp.hide();
  nodeId = id;
  newGame();
}

/** After a won room: rest, XP, loot, save, then back to the map. */
function leaveRoom() {
  if (game?.over !== 'victory') return;
  sfx.ui();
  const { state, report } = completeFight(campaign, nodeId, game);
  campaign = state;
  writeSave(campaign);
  showCamp(report);
  if (report.levelUps.length) setTimeout(() => sfx.levelUp(), 250);
}

const $banner = document.getElementById('banner');

// --- framing the board around the HUD ------------------------------------------
// The camera keeps the board clear of the panels as they are actually laid out, which
// matters on a phone, where the action bar can be twice its desktop height.
const $actionbar = document.getElementById('actionbar');
let barRoom = 0; // the tallest action bar since the window last changed size
let framedFor = '';
function hudInsets(w, h) {
  if (framedFor !== `${w}x${h}`) {
    framedFor = `${w}x${h}`;
    barRoom = 0;
  }
  const bar = $actionbar.getBoundingClientRect();
  if (bar.height) barRoom = Math.max(barRoom, h - bar.top);
  const top = document.getElementById('initiative').getBoundingClientRect().bottom;
  const log = document.getElementById('log');
  const beside = getComputedStyle(log).display !== 'none' && !hud.logOpen;
  return {
    top: Math.max(56, top + 6),
    bottom: Math.max(80, barRoom + 6),
    right: beside ? w - log.getBoundingClientRect().left : 0,
  };
}
stage.setInsets(hudInsets);
// A taller action bar (a hero with more to choose from) moves the board up, once.
new ResizeObserver(() => {
  const h = window.innerHeight;
  if (h - $actionbar.getBoundingClientRect().top > barRoom + 4) stage.fit();
}).observe($actionbar);

// Audio may only start after a user gesture.
const unlockAudio = () => {
  sfx.unlock();
  music.start();
};
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

function toggleSound() {
  sfx.unlock();
  sfx.setMuted(!sfx.muted);
  hud.setSound(!sfx.muted);
}
hud.setSound(!sfx.muted);

function toggleMusic() {
  unlockAudio();
  music.setEnabled(!music.enabled);
  hud.setMusic(music.enabled);
}
hud.setMusic(music.enabled);

// Volumes, the monster-turn speed and the dice badge (the Settings button).
// Monsters met before the bestiary existed: from the save, past runs and daily crypts.
{
  const save = loadSave();
  meet(metBefore({
    cleared: save?.cleared,
    at: save?.at,
    reached: loadHistory().map((r) => r.reached),
    daily: Object.values(loadDaily()).map((d) => d.node),
  }));
}
const bestiary = new Bestiary();
for (const b of document.querySelectorAll('.bestiary-open')) b.addEventListener('click', () => bestiary.open(b));

const settings = loadSettings();
document.body.classList.toggle('colorblind', settings.colorblind);
/** The Motion setting, for the animations (calm in tween.js) and the page's CSS (data-motion). */
function applyMotion() {
  setMotion(settings.motion);
  document.documentElement.dataset.motion = calm() ? 'reduce' : 'full';
}
applyMotion();
onSystemMotion(applyMotion);
new SettingsPanel(settings, (key, value) => {
  settings[key] = value;
  saveSettings(settings);
  if (key === 'motion') return applyMotion();
  if (key === 'colorblind') {
    board?.setThreatColors(value);
    document.body.classList.toggle('colorblind', value);
  }
  if (key === 'speed' || key === 'rolls' || key === 'throwDice' || key === 'colorblind') return;
  unlockAudio();
  sfx.setLevel(key, value);
});

// The controls panel: open the first time, then remembered. On a phone it would cover
// the board, so there it starts closed.
const HELP_KEY = 'crypt-skirmish:help';
const helpBox = document.getElementById('help');
if (matchMedia('(max-width: 900px)').matches) helpBox.open = false;
try {
  if (localStorage.getItem(HELP_KEY) === '0') helpBox.open = false;
} catch {
  /* storage unavailable: start open */
}
helpBox.addEventListener('toggle', () => {
  if (matchMedia('(max-width: 900px)').matches) return; // phones always start closed
  try {
    localStorage.setItem(HELP_KEY, helpBox.open ? '1' : '0');
  } catch {
    /* setting just won't persist */
  }
});

/** What the music should be doing right now (polled; music.setMood ignores repeats). */
function currentMood() {
  if (!game || camp.open || game.over === 'defeat') return 'calm';
  if (game.over) return 'explore';
  const fighting = game.living('monsters').some((m) => !m.unaware);
  if (!fighting) return 'explore';
  return NODES[nodeId]?.boss ? 'boss' : 'combat';
}
setInterval(() => music.setMood(currentMood()), 400);

let game;
let board;
let views = new Map();
let busy = false;
let ended = false;
/** null = default (click enemy to attack with best weapon, click tile to move),
 *  { kind: 'attack', attack } or { kind: 'spell', id } = targeting mode. */
let selected = null;
let hovered = null; // {x, z}
let pendingReveals = []; // traps spotted during a move, shown once the move has played out
let pendingAlerts = [];  // monsters that noticed the party, shown once the action has played out
let pendingSpotted = []; // hidden heroes found (or giving themselves away), shown the same way
let debugAutoplay = false; // __debug.autoplay(true): the monster AI plays the heroes too

const view = (u) => views.get(u.id);

// --- fog of war -----------------------------------------------------------------
// Vision follows the figures as drawn (a hero walking through a door reveals the room
// as they step in), not the engine's instant results.
let visible = new Set();   // tile keys the heroes see right now
let seenIds = new Set();   // monsters the heroes have laid eyes on this fight
let visionSig = '';

const tileOf = (v) => ({ x: Math.round(v.group.position.x), z: Math.round(v.group.position.z) });
const inView = (t) => visible.has(key(t.x, t.z));
/** Is this unit hidden from the heroes right now? */
const unseen = (u) => u.team === 'monsters' && !!view(u) && !inView(tileOf(view(u)));

function updateVision(force = false) {
  if (!game || !board) return;
  const grid = game.grid;
  if (game.over && ended) {
    // The fight is decided: lift the fog (the stairs, who was lurking where).
    if (visionSig === 'over') return;
    visionSig = 'over';
    visible = new Set();
    for (let z = 0; z < grid.height; z++) for (let x = 0; x < grid.width; x++) visible.add(key(x, z));
    board.setVision(visible);
    return;
  }
  const eyes = game.units.filter((u) => u.team === 'heroes' && u.alive && view(u)).map((u) => tileOf(view(u)));
  const doors = [...board.doors.values()].map((d) => (d.opened ? 1 : 0)).join('');
  const sig = eyes.map((e) => key(e.x, e.z)).join(';') + '|' + doors;
  if (sig === visionSig && !force) return;
  const first = !visionSig;
  visionSig = sig;
  const blocks = (x, z) => grid.isWall(x, z) || grid.opaqueProp(x, z) || (grid.doors.has(key(x, z)) && !board.doors.get(key(x, z)).opened);
  visible = grid.visibleFrom(eyes, blocks);
  board.setVision(visible, { snap: first });
}

/** Every frame: hide monsters out of sight, notice new ones. */
stage.tickers.add(() => {
  if (!game || !board) return;
  updateVision();
  let spotted = false;
  let elite = null;
  const kinds = [];
  for (const v of views.values()) {
    const u = v.unit;
    if (u.team !== 'monsters') continue;
    const t = tileOf(v);
    const show = u.alive ? inView(t) : board.isExplored(t.x, t.z);
    v.group.visible = show && !v.gone;
    if (show && u.alive && !seenIds.has(u.id)) {
      seenIds.add(u.id);
      kinds.push(u.code);
      spotted = true;
      if (u.elite) elite = u;
    }
  }
  if (spotted) hud.renderInitiative(game);
  // The first of a kind ever seen goes into the bestiary.
  const fresh = meet(kinds);
  const names = fresh.map((c) => TEMPLATES[c].name).join(' and ');
  if (fresh.length) hud.log(`New in the bestiary: <b>${names}</b>.`, 'sys');
  if (elite) spotElite(elite, fresh.length ? `New in the bestiary: ${names}` : '');
  else if (fresh.length) {
    hud.toast(`New in the bestiary: ${names}`, 'news');
    sfx.bestiary();
  }
});

/** The elite comes into view: name its trait in the log and a toast (after `news`, if any), sound a horn, flare its band and, on a phone, pan to it. */
function spotElite(u, news) {
  const t = ELITE_TRAITS.find((e) => e.id === u.elite);
  if (!t) return;
  hud.log(`<span class="monsters">${u.name}</span> is an <b>elite</b>: ${t.name.toLowerCase()} (${t.desc}).`, 'sys');
  hud.toast(`${news ? `${news} · ` : ''}Elite: ${t.name}`, 'news');
  sfx.elite();
  view(u)?.flashElite();
  keepInView(u);
}

function addView(u) {
  const v = new UnitView(u, stage);
  views.set(u.id, v);
  stage.scene.add(v.group);
  return v;
}

// --- setup ----------------------------------------------------------------
/** Spectral weapons on the board, by the id of the cleric who summoned them. */
const spiritWeapons = new Map();
const anim = createAnimations({
  stage, hud, settings, spiritWeapons, view, addView, unseen, inView, flushReveals, syncStatus, keepInView,
  game: () => game, board: () => board, selected: () => selected, busy: () => busy, touching: () => touching,
  autoplaying: () => debugAutoplay, replaying: () => !!replay,
});
const { play, damageReaction, throwsOwn } = anim;

function clearSpiritWeapon(id) {
  spiritWeapons.get(id)?.remove();
  spiritWeapons.delete(id);
}

/**
 * Start the fight at `nodeId` with the party as it entered. With `resume` (a saved fight),
 * replay it to where it was saved instead; if that fails, the party is back at camp.
 */
function newGame(resume = null) {
  const files = roomFiles(nodeId, campaign.party);
  const ticket = ++fightTicket;
  if (modelsSettled(files)) {
    $loading.hidden = true;
    startFight(resume);
    return;
  }
  // This room's figures are still downloading (a first visit, straight in): wait for them.
  $loading.hidden = false;
  loadModels(files).then(() => {
    if (ticket !== fightTicket) return; // another fight was asked for meanwhile
    $loading.hidden = true;
    startFight(resume);
  });
}

/** Start a fight, or (`watch`: a record) a replay of a finished one. */
function startFight(resume, watch = null) {
  for (const id of [...spiritWeapons.keys()]) clearSpiritWeapon(id);
  if (board) {
    stage.scene.remove(board.group);
    board.dispose();
  }
  for (const v of views.values()) {
    v.dispose();
    stage.scene.remove(v.group);
  }

  const level = levelById(NODES[nodeId].level);
  // A daily always starts from the day's seed, so every try (and everyone) faces the same dice.
  // A linked fight played yourself starts from the link's seed: the same dice it had.
  const seed = watch?.seed ?? resume?.seed ?? daily?.seed ?? challenge?.rec.seed ?? newSeed();
  const party = watch?.party ?? campaign.party;
  const difficulty = watch?.difficulty ?? campaign.difficulty;
  const tier = (watch ? watch.tier : campaign.tier) ?? 0; // New Game+
  game = new Game(level, { party, difficulty: runDifficulty(difficulty, tier), rng: seeded(seed) });
  fight = daily || challenge || watch ? null : { node: nodeId, seed, log: [], check: null, explored: [], seen: [] };
  if (!watch) record = { node: nodeId, seed, party: structuredClone(party), difficulty, ...(tier && { tier }), log: resume ? [...resume.log] : [] };
  feats = { maxHit: 0, sneaks: 0, stayDown: false };
  game.on('attack', (r) => {
    if (r.attacker.team !== 'heroes' || !r.hit) return;
    feats.maxHit = Math.max(feats.maxHit, r.damage ?? 0);
    if (r.sneak) feats.sneaks++;
  });
  // A Relentless elite finished in the round it clung on at 1 HP.
  let clung = null;
  game.on('ward', (r) => { if (r.relentless) clung = { unit: r.unit, round: game.round }; });
  game.on('death', ({ unit }) => { if (clung?.unit === unit && clung.round === game.round) feats.stayDown = true; });
  if (resume && !replaySaved(resume)) {
    game = null;
    record = null;
    views = new Map();
    fight = null;
    showBackdrop();
    writeSave(campaign);
    showCamp(null);
    hud.toast('The fight in progress couldn’t be restored, so the party is back at camp.');
    return;
  }
  board = new Board(game.grid, stage);
  board.setThreatColors(settings.colorblind);
  stage.scene.add(board.group);
  board.setIce(game.icyTiles()); // a restored fight may have icy ground
  views = new Map();
  for (const u of game.units) addView(u);

  busy = false;
  ended = false;
  setUndo(null);
  selected = null;
  pendingReveals = [];
  anim.clearRisings();
  pendingAlerts = [];
  pendingSpotted = [];
  visionSig = '';
  seenIds = new Set();
  if (resume) restoreBoard(resume);
  board.fadeSources = () => [...views.values()]
    .filter((v) => v.unit.alive && v.group.visible)
    .map((v) => v.group.position);
  updateVision();
  hud.unknown = (u) => u.team === 'monsters' && !seenIds.has(u.id);
  hud.hidden = (u) => unseen(u);
  hud.reset();
  hud.levelIntro(level, party.F.level);
  if (resume) hud.log(`The fight picks up where you left it: round ${game.round}.`, 'sys');

  game.on('initiative', ({ order }) => {
    hud.log('<b>Roll for initiative!</b>', 'sys');
    sfx.dice();
    let lurking = 0;
    for (const u of order) {
      if (unseen(u)) {
        lurking++;
        continue;
      }
      hud.log(`<span class="${u.team}">${u.name}</span> <span class="dice">d20 ${u.initRoll} ${signed(u.initiative - u.initRoll)} = ${u.initiative}</span>`);
    }
    if (lurking) hud.log(`<span class="monsters">Something</span> stirs beyond your sight…`, 'sys');
    // New Game+ 2 and deeper: the elite's trait is named once it's seen (the vision ticker).
    const elite = game.units.find((u) => u.elite && u.alive);
    if (elite && unseen(elite)) hud.log('Something strong lurks here: an <b>elite</b>.', 'sys');
  });
  game.on('round', ({ round }) => hud.log(`Round ${round}`, 'round'));
  game.on('turnStart', ({ unit }) => onTurnStart(unit));
  game.on('attack', (r) => {
    // The player is about to throw this one: the log waits until the die lands.
    if (throwsOwn(r)) hud.holdLog();
    hud.logAttack(r);
  });
  game.on('spell', (r) => {
    if (unseen(r.caster)) hud.log('You hear chanting somewhere in the dark…', 'sys');
    else hud.logSpell(r);
  });
  game.on('action', (r) => { if (!unseen(r.unit)) hud.logAction(r); });
  game.on('death', ({ unit, unmarked, blessing }) => {
    clearSpiritWeapon(unit.id); // a fallen cleric's weapon fades
    if (unit.team === 'monsters' && !replay) {
      slay(unit.code); // the bestiary's tally
      if (unit.elite) slayElite(unit.elite);
    }
    if (unmarked) view(unmarked)?.updateStatus(); // and a fallen ranger's mark
    if (unseen(unit)) hud.log('Something falls in the dark.', 'death');
    else hud.log(`<span class="${unit.team}">${unit.name}</span> falls.`, 'death');
    if (blessing) {
      hud.logBlessing(blessing);
      // Shown once the blow has landed (the death plays out first).
      wait(500).then(() => {
        floatText(stage.scene, { x: blessing.unit.x, z: blessing.unit.z - 0.5 }, `+${blessing.tempHp} temp HP`, 'heal');
        view(blessing.unit)?.updateHp();
      });
    }
  });
  game.on('ward', (r) => {
    hud.logWard(r);
    // Shown once the blow has landed.
    wait(500).then(() => {
      floatText(stage.scene, { x: r.unit.x, z: r.unit.z - 0.5 }, r.relentless ? 'Relentless!' : 'Death Ward!', r.relentless ? 'warn' : 'heal');
      view(r.unit)?.updateStatus();
    });
  });
  game.on('regen', (r) => {
    if (unseen(r.unit)) return; // out of sight: nothing to see
    hud.logRegen(r);
    floatText(stage.scene, r.unit, `+${r.amount}`, 'heal');
    view(r.unit)?.updateHp();
    view(r.unit)?.updateStatus();
  });
  game.on('rising', (r) => anim.queueRising(r));
  // A storm’s frost goes down as its hail lands (playSpell in animate.js); it thaws here.
  game.on('ice', (r) => {
    if (!r.melted) return;
    board.setIce(r.tiles);
    sfx.thaw();
    hud.log('The ice from the hailstorm thaws.', 'sys');
  });
  game.on('trap', (r) => {
    if (r.unit.team === 'monsters' && !inView(r.trap)) hud.log('A trap snaps shut somewhere in the dark.', 'sys');
    else hud.logTrap(r);
  });
  game.on('chest', (r) => hud.logChest(r));
  game.on('mimic', (r) => hud.logMimic(r));
  game.on('mimicFound', (r) => pendingReveals.push(r));
  game.on('rider', (r) => { if (!unseen(r.target)) hud.logRider(r); });
  game.on('shove', (r) => hud.logShove(r));
  game.on('stench', (r) => {
    hud.logStench(r);
    floatText(stage.scene, r.target, r.rider.success ? 'Resists the stench' : 'Gagging!', r.rider.success ? 'miss' : 'cond');
    view(r.target)?.updateStatus();
  });
  game.on('condition', (r) => { if (!unseen(r.unit)) hud.logCondition(r); });
  game.on('trapFound', (r) => pendingReveals.push(r));
  game.on('alert', (r) => pendingAlerts.push(r));
  game.on('revealed', (r) => pendingSpotted.push(r));

  frameParty();
  if (!resume) {
    game.start();
    saveFight();
  } else if (game.over) {
    checkGameOver(); // saved on the victory banner
  } else {
    onTurnStart(game.current);
  }
}

/** On a phone the whole crypt is small: start zoomed in on the party (pinch and drag from there). */
function frameParty() {
  if (Math.min(window.innerWidth, window.innerHeight) >= 600) return;
  const heroes = game.living('heroes');
  if (!heroes.length) return;
  const x = heroes.reduce((a, u) => a + u.x, 0) / heroes.length;
  const z = heroes.reduce((a, u) => a + u.z, 0) / heroes.length;
  lookAt(x, z, 2);
  // The initiative and action bars lay out over the next frames and refit the camera, which
  // can leave the party under the action bar: frame again once they have, unless a pan
  // (keepInView) has taken over by then.
  const ticket = panTween;
  const settle = (n) => requestAnimationFrame(() => {
    if (ticket !== panTween) return;
    if (n) settle(n - 1);
    else lookAt(x, z, stage.camera.zoom);
  });
  settle(3);
}

const raycaster = new THREE.Raycaster(); // finding the ground under a point of the screen

/** Centre the view on a tile at a zoom level, in the middle of the area the HUD leaves free. */
function lookAt(x, z, zoom) {
  const cam = stage.camera;
  cam.zoom = zoom;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  const w = window.innerWidth;
  const h = window.innerHeight;
  const { top, bottom, right } = hudInsets(w, h);
  // Where the free area's middle is on the ground, and how far the tile is from it.
  const ndc = new THREE.Vector2(((w - right) / 2 / w) * 2 - 1, -(((top + h - bottom) / 2) / h) * 2 + 1);
  raycaster.setFromCamera(ndc, cam);
  const ground = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ground)) return;
  const shift = new THREE.Vector3(x, 0, z).sub(ground);
  stage.controls.target.add(shift);
  cam.position.add(shift);
}

/**
 * On a phone only part of the crypt is on screen: when a unit near or past the edge of the
 * free area (between the initiative bar and the action bar) takes its turn, glide the camera
 * to centre it. Zoom stays put, and so does any pan the player made while the unit is in view.
 */
let panTween = 0;
function keepInView(unit) {
  if (Math.min(window.innerWidth, window.innerHeight) >= 600) return;
  const cam = stage.camera;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const { top, bottom, right } = hudInsets(w, h);
  const p = new THREE.Vector3(unit.x, 0, unit.z).project(cam);
  const sx = ((p.x + 1) / 2) * w;
  const sy = ((1 - p.y) / 2) * h;
  const mx = Math.min(70, (w - right) * 0.2);
  const my = Math.min(70, (h - top - bottom) * 0.2);
  const inside = sx >= mx && sx <= w - right - mx && sy >= top + my && sy <= h - bottom - my;
  if (inside) return;
  // Bring it to the middle of the free area (an edge would tuck it under the HUD buttons).
  const dx = sx - (w - right) / 2;
  const dy = sy - (top + h - bottom) / 2;
  // Turn that nudge into a ground-plane shift: where would the unit's screen point land?
  const toGround = (x, y) => {
    raycaster.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), cam);
    const g = new THREE.Vector3();
    return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), g) ? g : null;
  };
  const from = toGround(sx - dx, sy - dy);
  const to = toGround(sx, sy);
  if (!from || !to) return;
  const shift = to.sub(from);
  const ticket = ++panTween;
  if (calm()) { // reduced motion: jump there
    stage.controls.target.add(shift);
    cam.position.add(shift);
    return;
  }
  const start = performance.now();
  let done = 0;
  const step = (now) => {
    if (ticket !== panTween) return; // a newer pan took over
    const t = Math.min(1, (now - start) / 350);
    const eased = 1 - (1 - t) ** 3;
    const d = shift.clone().multiplyScalar(eased - done);
    done = eased;
    stage.controls.target.add(d);
    cam.position.add(d);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Replay a saved fight on the new `game`. False if it didn't land where it was saved. */
function replaySaved(saved) {
  try {
    const r = replayFight(game, saved.log);
    if (!r.ok || r.check !== saved.check) return false;
    fight.log = [...saved.log];
    fight.check = saved.check;
    return true;
  } catch (err) {
    console.warn('Saved fight did not replay:', err);
    return false;
  }
}

/** Draw a replayed fight as it stood: the dead, sprung traps, explored rooms, spirit weapons. */
function restoreBoard(saved) {
  board.explored = new Set(saved.explored);
  seenIds = new Set(saved.seen.map((i) => game.units[i]?.id).filter(Boolean));
  for (const v of views.values()) if (!v.unit.alive) v.restoreDead();
  for (const t of game.grid.traps.values()) {
    if (!t.revealed) continue;
    board.showTrap(t).then(() => t.sprung && board.retractTrap(t));
  }
  for (const u of game.units) {
    const w = u.alive && u.spiritWeapon;
    if (w) spiritWeapons.set(u.id, spiritWeapon(stage.scene, { x: w.x, z: w.z }));
  }
}

function isHeroTurn() {
  return game && !replay && !game.over && !camp.open && game.current?.team === 'heroes';
}

/** The dungeon without anyone in it, behind the title screen. */
function showBackdrop() {
  board = new Board(new Grid(LEVELS[0].rows), stage);
  board.setThreatColors(settings.colorblind);
  stage.scene.add(board.group);
}

function syncStatus() {
  flushAlerts();
  for (const v of views.values()) v.updateStatus();
}

const ALERT_TEXT = {
  sight: 'spots the party!',
  ally: 'is roused by a shout!',
  noise: 'hears the fighting!',
  hurt: 'is caught off guard!',
};

/** Monsters that just noticed the party: a "!" over each one in view, one log line. */
function flushAlerts() {
  for (const { unit, cause, by } of pendingSpotted) {
    if (unseen(unit)) continue; // a goblin found somewhere the party can't see
    const who = `<span class="${unit.team}">${unit.name}</span>`;
    if (cause === 'spotted' || cause === 'searched') {
      floatText(stage.scene, unit, cause === 'searched' ? 'Found!' : 'Spotted!', unit.team === 'heroes' ? 'warn' : 'spell');
      const finder = by && !unseen(by) ? `<span class="${by.team}">${by.name}</span>` : 'Something';
      hud.log(`${finder} ${cause === 'searched' ? 'finds' : 'spots'} ${who} in the shadows!`, 'sys');
    } else if (unit.team === 'monsters' && cause === 'attack') {
      hud.log(`${who} strikes from hiding!`, 'sys');
    } else {
      hud.log(`${who} ${cause === 'hurt' ? 'is driven out of hiding' : 'steps out of hiding'}.`, 'sys');
    }
  }
  pendingSpotted = [];
  if (!pendingAlerts.length) return;
  let hidden = 0;
  for (const { unit, cause, wasAsleep } of pendingAlerts) {
    if (!unit.alive) continue; // killed by the blow that woke it: "falls" says it all
    if (unseen(unit)) {
      hidden++;
      continue;
    }
    if (cause !== 'hurt') floatText(stage.scene, unit, '!', 'warn');
    const text = wasAsleep && cause !== 'hurt' ? 'wakes with a start!' : ALERT_TEXT[cause];
    hud.log(`<span class="monsters">${unit.name}</span> ${text}`, 'sys');
  }
  if (hidden) hud.log('Somewhere in the dark, something stirs.', 'sys');
  if (pendingAlerts.some((a) => !unseen(a.unit) && a.cause !== 'hurt')) sfx.alert();
  pendingAlerts = [];
}

/** Shows traps a hero spotted, after their move has finished playing. */
function flushReveals() {
  for (const r of pendingReveals) {
    if (r.chest) {
      hud.logMimicFound(r);
      sfx.discover();
      floatText(stage.scene, r.chest, 'Teeth?!', 'warn');
      continue;
    }
    hud.logTrapFound(r);
    board.showTrap(r.trap);
    sfx.discover();
    floatText(stage.scene, r.trap, 'Trap!', 'warn');
  }
  pendingReveals = [];
}

async function onTurnStart(unit) {
  flushReveals();
  for (const v of views.values()) v.setActive(v.unit === unit);
  if (!unseen(unit)) keepInView(unit);
  selected = null;
  syncStatus();
  hud.renderInitiative(game);
  refresh();
  if (replay) {
    const g = game;
    replayLabel();
    if (replay.stepTurn) { // "Next turn": stop at the one after
      replay.stepTurn = false;
      replay.paused = true;
      replayLabel();
    }
    await replayGate();
    if (game !== g) return;
    if (unit.team === 'heroes') await replayHeroTurn(unit);
    else await runMonsterTurn(unit);
    return;
  }
  if (unit.team === 'heroes') {
    sfx.turn();
    voices.bark(unit, 'turn'); // now and then
    saveFight(); // with the rooms seen so far
    if (!debugAutoplay) {
      const chestInSight = [...game.grid.chests.keys()].some((k) => visible.has(k));
      tips.notice('heroTurn', { unit, chestInSight, touch: touching });
    }
  }
  if (unit.team === 'monsters' || debugAutoplay) await runMonsterTurn(unit);
}

// --- highlights & HUD -------------------------------------------------------
/** Indices of path tiles where leaving provokes an opportunity attack. */
function provokingSteps(u, path) {
  const out = [];
  for (let i = 0; i < path.length - 1; i++) {
    if (game.provokers(u, [path[i], path[i + 1]]).length) out.push(path[i]);
  }
  return out;
}

function modsText(m) {
  if (m.mode === 'adv') return ` · advantage (${m.adv.join(', ')})`;
  if (m.mode === 'dis') return ` · disadvantage (${m.dis.join(', ')})`;
  return '';
}

// --- threat zones: where the monsters in sight could strike next turn ------------------
const threats = createThreats({
  game: () => game, board: () => board, unseen, showing: () => isHeroTurn() && !busy, refresh,
});
const drawThreats = () => threats.draw();

function refresh() {
  hud.renderActionBar(game, { selected, busy });
  board.clearHighlights();
  drawThreats();
  const u = game.current;
  if (!u || game.over) return;
  if (!unseen(u)) board.active.set([u]);
  hud.hint('');
  if (!isHeroTurn() || busy) return;

  if (selected?.kind === 'spell') return refreshSpell(u, selected.id);
  if (selected?.kind === 'shove') return refreshShove(u);

  const reach = game.reachable(u);
  board.reach.set(game.destinations(u).filter((t) => board.isExplored(t.x, t.z)));
  const atkOk = (f) => (selected ? !game.attackProblem(u, f, selected.attack) : game.bestAttack(u, f));
  board.targets.set(game.enemiesOf(u).filter((f) => !unseen(f) && atkOk(f)));

  if (!hovered) {
    if (selected) hud.hint(`${selected.attack.name}: click an enemy · Esc to cancel`);
    return;
  }
  board.hover.set([hovered]);
  const foe = visibleUnitAt(hovered.x, hovered.z);
  if (foe && foe.team !== u.team) {
    const atk = selected?.attack ?? game.bestAttack(u, foe);
    if (atk && !game.attackProblem(u, foe, atk)) {
      const m = game.attackMods(u, foe, atk);
      hud.hint(`${atk.name} → ${foe.name}: ${signed(game.toHitBonus(u, atk))} to hit vs AC ${game.acOf(foe)}, ${atk.damage} damage${modsText(m)}`, true);
    } else {
      hud.hint(`${foe.name}: ${game.attackProblem(u, foe, atk ?? u.attacks[0])}`);
    }
    return;
  }
  if (game.grid.chests.has(key(hovered.x, hovered.z))) {
    const why = game.chestProblem(u, hovered.x, hovered.z);
    const odd = game.grid.chests.get(key(hovered.x, hovered.z)).suspected;
    hud.hint(why ?? (odd ? 'Open the chest… if you dare. Those are teeth marks.' : 'Open the chest (free, once per turn)'), !why);
    return;
  }
  const node = reach.get(key(hovered.x, hovered.z));
  if (node && node.dist > 0 && game.canEndOn(u, hovered.x, hovered.z)) {
    const path = pathFrom(reach, hovered.x, hovered.z);
    board.path.set(path.slice(1));
    const danger = provokingSteps(u, path);
    board.danger.set(danger);
    const who = game.provokers(u, path).map((f) => f.name);
    if (who.length) tips.notice('provoke', { touch: touching });
    const reachers = threats.active ? threats.at(hovered.x, hovered.z).map((m) => m.name) : [];
    hud.hint(`Move ${node.dist * 5} ft` + (who.length ? ` · provokes an opportunity attack from ${who.join(' and ')}` : '')
      + (reachers.length ? ` · in reach of ${listNames(reachers)} next turn` : ''), true);
  }
}

/** Shove targeting: adjacent enemies light up, the hint shows the contest. */
function refreshShove(u) {
  board.targets.set(game.enemiesOf(u).filter((f) => !unseen(f) && !game.shoveProblem(u, f)));
  const foe = hovered && visibleUnitAt(hovered.x, hovered.z);
  if (!foe || foe.team === u.team) {
    hud.hint('Shove: click an enemy next to you · Esc to cancel');
    return;
  }
  board.hover.set([hovered]);
  const why = game.shoveProblem(u, foe);
  hud.hint(why ? `${foe.name}: ${why}`
    : `Shove → ${foe.name}: Athletics ${signed(game.shoveBonus(u))} vs their ${signed(game.shoveResist(foe))}; win and it is knocked prone`, !why);
}

/** The unit on a tile, unless it's a monster lurking out of sight. */
function visibleUnitAt(x, z) {
  const u = game.unitAt(x, z);
  return u && !unseen(u) ? u : null;
}

/** The unit (or corpse) a unit-targeted spell would hit on tile t. */
function spellTargetAt(t, s) {
  if (!t) return null;
  if (s.targeting === 'corpse') return game.corpses().find((c) => c.x === t.x && c.z === t.z) ?? null;
  return visibleUnitAt(t.x, t.z);
}

/** One-line preview of what a unit-targeted spell will do to `t`. */
function spellPreview(u, id, t) {
  const s = SPELLS[id];
  switch (id) {
    case 'magicMissile':
      return `Magic Missile → ${t.name}: 3 darts × 1d4+1, never misses`;
    case 'spiritualWeapon': {
      const mod = abilityMod(u.stats[u.castStat]);
      const cost = u.spiritWeapon ? 'no slot' : `a ${u.slots[2] ? '2nd' : '3rd'}-level slot`;
      return `Spiritual Weapon → ${t.name}: ${signed(u.prof + mod)} vs AC ${game.acOf(t)}, 1d8${signed(mod)} force · ${cost}`;
    }
    case 'huntersMark':
      return `Hunter’s Mark → ${t.name}: +1d6 on your weapon hits against it · a 1st-level slot`;
    case 'hex':
      return `Hex → ${t.name}: +1d6 necrotic on every hit against it · a ${ordinalSlot(u, 1)}-level slot`;
    case 'scorchingRay': {
      const slot = lowestSlot(u, 2);
      const toHit = u.prof + abilityMod(u.stats[u.castStat]);
      return `Scorching Ray → ${t.name}: ${s.rays + slot - 2} rays, each ${signed(toHit)} vs AC ${game.acOf(t)} for 2d6 fire · a ${ordinalSlot(u, 2)}-level slot`;
    }
    case 'sacredFlame':
      return `Sacred Flame → ${t.name}: ${s.damage} radiant, DEX save DC ${game.spellDC(u)} negates (their DEX ${signed(abilityMod(t.stats.dex))})`;
    case 'cureWounds':
    case 'healingWord': {
      const [n, d] = s.heal;
      return `${s.name} → ${t === u ? 'yourself' : t.name}: heal ${n}d${d}${signed(abilityMod(u.stats[u.castStat]))} (HP ${t.hp}/${t.maxHp})`;
    }
    case 'deathWard':
      return `${s.name} → ${t === u ? 'yourself' : t.name}: the next drop to 0 HP leaves 1 instead (${ordinalSlot(u, s.level)}-level slot)`;
    default:
      return `${s.name} → ${t.name}`;
  }
}

/** The slot a spell of `level` would spend: the lowest one left at that level or above. */
function lowestSlot(u, level) {
  return Object.keys(u.slots).map(Number).sort((a, b) => a - b).find((l) => l >= level && u.slots[l] > 0) ?? level;
}
const ordinalSlot = (u, level) => ({ 1: '1st', 2: '2nd', 3: '3rd' })[lowestSlot(u, level)] ?? `${lowestSlot(u, level)}th`;

function refreshSpell(u, id) {
  const s = SPELLS[id];
  switch (s.targeting) {
    case 'enemy':
    case 'ally':
    case 'corpse': {
      const layer = s.targeting === 'ally' ? board.allies : board.targets;
      layer.set(game.spellTargets(u, id).filter((t) => !unseen(t)));
      const t = spellTargetAt(hovered, s);
      if (t) {
        board.hover.set([hovered]);
        const why = game.spellProblem(u, id, t);
        hud.hint(why ? `${t.name}: ${why}` : spellPreview(u, id, t), !why);
      } else {
        const what = { enemy: 'an enemy', ally: 'an ally or yourself', corpse: 'a corpse' }[s.targeting];
        hud.hint(`${s.name}: click ${what} · Esc to cancel`);
      }
      break;
    }
    case 'cone': {
      if (!hovered || (hovered.x === u.x && hovered.z === u.z)) {
        hud.hint(`${s.name}: point the cone with the mouse, click to cast · Esc to cancel`);
        return;
      }
      const tiles = coneTiles(game.grid, u, directionTo(u, hovered), s.range);
      board.cone.set(tiles);
      const caught = tiles.map((t) => visibleUnitAt(t.x, t.z)).filter(Boolean);
      const allies = caught.filter((c) => c.team === u.team);
      const foes = caught.filter((c) => c.team !== u.team);
      hud.hint(
        `${s.name}: ${2 + lowestSlot(u, 1)}d6 fire, DEX save DC ${game.spellDC(u)} for half · ` +
          (foes.length ? `hits ${foes.map((f) => f.name).join(', ')}` : 'no enemies in the cone') +
          (allies.length ? (u.sculpt ? ' · Sculpt Spells: the party is spared'
            : ` · ⚠ also burns ${allies.map((a) => a.name).join(', ')}!`) : ''),
        true,
      );
      break;
    }
    case 'line': {
      if (!hovered || (hovered.x === u.x && hovered.z === u.z)) {
        hud.hint(`${s.name}: aim the bolt with the mouse, click to cast · Esc to cancel`);
        return;
      }
      const tiles = lineTiles(game.grid, u, hovered, s.range);
      board.cone.set(tiles);
      const caught = tiles.map((t) => visibleUnitAt(t.x, t.z)).filter(Boolean);
      const allies = caught.filter((c) => c.team === u.team);
      const foes = caught.filter((c) => c.team !== u.team);
      hud.hint(
        `${s.name}: ${s.damage} lightning in a line, DEX save DC ${game.spellDC(u)} for half · ` +
          (foes.length ? `hits ${foes.map((f) => f.name).join(', ')}` : 'no enemies in the line') +
          (allies.length ? (u.sculpt ? ' · Sculpt Spells: the party is spared'
            : ` · ⚠ also strikes ${allies.map((a) => a.name).join(', ')}!`) : ''),
        true,
      );
      break;
    }
    case 'area': {
      if (!hovered) {
        hud.hint(`${s.name}: pick the point of the blast · Esc to cancel`);
        return;
      }
      const why = game.spellProblem(u, id, hovered);
      if (why) {
        hud.hint(`${s.name}: ${why}`);
        return;
      }
      const tiles = areaTiles(game.grid, hovered, s.radius);
      board.cone.set(tiles);
      board.hover.set([hovered]);
      const caught = tiles.map((t) => visibleUnitAt(t.x, t.z)).filter(Boolean);
      const allies = caught.filter((c) => c.team === u.team);
      const foes = caught.filter((c) => c.team !== u.team);
      hud.hint(
        `${s.name}: ${s.damage} ${id === 'iceStorm' ? 'hail and cold' : 'fire'} in ${s.radius * 5} ft, DEX save DC ${game.spellDC(u)} for half · ` +
          (foes.length ? `hits ${foes.map((f) => f.name).join(', ')}` : 'no enemies caught') +
          (allies.length ? (u.sculpt ? ' · Sculpt Spells: the party is spared'
            : ` · ⚠ also ${id === 'iceStorm' ? 'pounds' : 'burns'} ${allies.map((a) => a.name).join(', ')}!`) : ''),
        true,
      );
      break;
    }
    case 'tile': {
      board.teleport.set(game.teleportTiles(u));
      if (hovered) {
        const ok = !game.spellProblem(u, id, hovered);
        if (ok) board.hover.set([hovered]);
        hud.hint(ok ? `${s.name}: teleport here (bonus action)` : 'Pick an empty spot you can see within 30 ft', ok);
      } else {
        hud.hint(`${s.name}: click a purple tile · Esc to cancel`);
      }
      break;
    }
    default:
      hud.hint('');
  }
}

// --- animation of resolved results: see animate.js ---------------------------

/** Shows the end banner once the game is decided. Returns true if over. */
async function checkGameOver() {
  if (!game.over) return false;
  if (ended) return true;
  ended = true;
  await wait(400);
  board.clearHighlights();
  drawThreats(); // the fight is over: no zones left
  if (replay) {
    await wait(600);
    if (!replay) return true;
    if (replay.link) { // a link's fight: stay at its end, where it can be played or left
      replay.over = true;
      replayLabel();
      return true;
    }
    endReplay();
    return true;
  }
  recordBlows(game.blows); // the bestiary's deadliest foes
  if (record) Object.assign(record, { result: game.over, check: fightCheck(game) }); // how it ended, for a link
  if (saving && record) saveLastFight({ ...record, log: [...record.log] }); // kept with the run when it ends
  hud.renderActionBar(game, { selected: null, busy: false });
  const level = levelById(NODES[nodeId].level);
  const final = !!level.final && !challenge; // a linked fight is one room, not the campaign's end
  let summary = null;
  let awards = []; // achievements unlocked by this fight (none on test runs)
  let share = null; // a won campaign's text to share
  if (game.over === 'victory') {
    sfx.victory();
    if (saving || daily) awards = unlock('room', { game, node: nodeId, feats, daily: !!daily, met: loadBestiary().length, slain: slainTotal(), eliteKinds: Object.keys(loadElitesSlain()).length });
    if (!final) {
      board.lightStairs();
      setTimeout(() => sfx.stairs(), 900);
    } else {
      // The campaign is won: record it, and the next visit starts fresh.
      campaign = completeFight(campaign, nodeId, game).state;
      if (saving) {
        recordRun(campaign, 'won');
        awards.push(...unlock('run', { state: campaign }));
      }
      clearSave();
      if (saving) setWonRun(campaign); // for New Game+, even after a reload
      summary = runSummary(campaign);
      if (saving) share = runShareText(summary);
    }
  } else {
    sfx.defeat();
    if (campaign) {
      campaign = recordDefeat(campaign, game);
      writeSave(campaign);
    }
  }
  let dailyResult = null;
  if (daily) {
    const attempt = { won: game.over === 'victory', rounds: game.round, downed: Object.values(game.stats).reduce((n, h) => n + (h.downed ?? 0), 0), node: nodeId };
    const { weekly } = daily;
    const results = weekly ? recordWeekly(daily.key, attempt) : recordDaily(daily.key, attempt);
    const run = weekly ? weekStreak(results, daily.key) : streak(results, daily.key);
    if (record) recordBestFight(weekly ? 'weekly' : 'daily', daily.key, attempt, record); // to watch from the title
    if (attempt.won) awards.push(...unlock(weekly ? 'weekly' : 'daily', { streak: run }));
    // A won daily can be shared: a mark per hero, a skull if they fell at any point.
    const marks = game.units.filter((u) => u.team === 'heroes').map((u) => (game.stats[u.slot]?.downed ? 'fell' : 'up'));
    const result = { key: daily.key, room: level.name, level: daily.level, rounds: game.round, marks, streak: run };
    const share = attempt.won && (weekly
      ? weeklyShareText({ ...result, trait: ELITE_TRAITS.find((t) => t.id === daily.trait).name })
      : shareText(result));
    dailyResult = { ...attempt, best: results[daily.key], streak: run, share, weekly: !!weekly };
  }
  const versus = challenge && challengeText(challenge.theirs, { won: game.over === 'victory', rounds: game.round }, level.name);
  hud.banner(game.over, {
    round: game.round, level: level.name, final, xp: game.xpEarned(), outro: level.outro, longRest: !!NODES[nodeId].actBreak,
    summary, awards, daily: dailyResult, challenge: versus, share, replay: !!record, recap: game.over === 'defeat' ? fightRecap(game) : null,
    win: game.over === 'victory' && !summary ? winRecap(game) : null,
    ngplus: !!summary && saving && !!campaign?.done,
  });
  return true;
}

// --- turns ------------------------------------------------------------------
async function runMonsterTurn(unit) {
  const g = game; // a restart or level change mid-turn abandons this turn
  busy = true;
  refresh();
  // The monster-turn speed setting: everything plays faster until the turn is over.
  playback.rate = replay ? replayRate() : unit.team === 'monsters' ? SPEEDS[settings.speed] : 1;
  try {
    // Monsters out of sight act quickly: nothing to watch.
    const pace = (ms) => wait(unit.team === 'monsters' && (unseen(unit) || unit.unaware) ? ms / 4 : ms);
    await pace(450);

    for (const { step, result } of monsterTurn(g, unit)) {
      try {
        if (result.ok) await play(unit, step.type, result);
      } catch (err) {
        if (game === g) throw err;
        return; // the fight was left mid-animation (a replay exited to the title): nothing to finish
      }
      if (game !== g) return;
      syncStatus();
      hud.renderActionBar(game, { selected, busy });
      await pace(180);
      await replayGate();
      if (game !== g) return;
    }

    if (game !== g || await checkGameOver()) return;
    await pace(300);
    if (game !== g) return;
  } finally {
    playback.rate = replay ? replayRate() : 1;
  }
  busy = false;
  game.endTurn();
}

// --- watching a finished fight again ------------------------------------------
const $replayBar = document.getElementById('replay-bar');
const replayRate = () => barRate(replay);
const replayGate = () => barGate(replay);
const replayLabel = () => barLabel(replay, game?.round ?? 0);
const replayPlay = (stepTurn = false) => barPlay(replay, game?.round ?? 0, stepTurn);

/**
 * Replay a fight from its record (seed and the commands given, see replay.js): the one that
 * just ended, from the end banner, or a past run's last fight, from the title (`fromTitle`).
 */
function startReplay(rec = record, { fromTitle = false, link = false } = {}) {
  if (!rec || replay || (!fromTitle && !game?.over)) return;
  sfx.ui();
  replay = { rec, log: rec.log, at: 0, finished: fromTitle ? null : game, fight, fromTitle, link, over: false, paused: false, speed: 0, stepTurn: false, wake: null };
  $banner.hidden = true;
  tips.hide(); // nothing to do while watching
  document.body.classList.add('replaying');
  $replayBar.hidden = false;
  startFight(null, rec);
}

/** Past runs → Watch the last fight: the room's figures first, then the replay; Exit goes back to the title. */
function watchFromTitle(rec, { link = false } = {}) {
  if (replay || !NODES[rec.node]) return;
  camp.hide();
  nodeId = rec.node;
  const files = roomFiles(rec.node, rec.party);
  const ticket = ++fightTicket;
  $loading.hidden = modelsSettled(files);
  loadModels(files).then(() => {
    if (ticket !== fightTicket) return;
    $loading.hidden = true;
    startReplay(rec, { fromTitle: true, link });
  });
}

const links = createLinks({ hud, touch: () => touching, watch: watchFromTitle, play: startChallenge, idle: () => !replay && !game });

/** Back to the end banner, with the real fight as it ended. */
function endReplay() {
  if (!replay) return;
  const r = replay;
  replay = null;
  r.wake?.();
  playback.rate = 1;
  game = r.finished;
  fight = r.fight;
  ended = true;
  busy = false;
  document.body.classList.remove('replaying');
  $replayBar.hidden = true;
  if (r.link) links.clearHash(); // done with the link: a reload shows the title
  if (r.fromTitle) return backToTitle();
  hud.renderInitiative(game);
  syncStatus();
  $banner.hidden = false;
}

document.getElementById('watch').addEventListener('click', () => startReplay());
document.getElementById('ngplus').addEventListener('click', (ev) => campaign?.done && heirlooms.open(campaign, ev.currentTarget));
document.getElementById('copy-link').addEventListener('click', (ev) => links.copy(record, ev.currentTarget));
document.getElementById('copy-challenge').addEventListener('click', (ev) => links.copy(record, ev.currentTarget, 'play'));
// After a challenge: the fight it was made from, then back to this end screen.
document.getElementById('watch-theirs').addEventListener('click', () => challenge && startReplay(challenge.rec));
document.getElementById('replay-pause').addEventListener('click', () => replayPlay());
document.getElementById('replay-step').addEventListener('click', () => replayPlay(true));
document.getElementById('replay-speed').addEventListener('click', () => replaySpeed(replay, game?.round ?? 0, 1, true));
document.getElementById('replay-play').addEventListener('click', () => {
  if (!replay?.link) return;
  const { rec } = replay;
  endReplay(); // back to the title, then straight into the fight
  startChallenge(rec, { result: rec.result, rounds: rec.rounds });
});
document.getElementById('replay-exit').addEventListener('click', () => {
  sfx.ui();
  endReplay();
});

/** A hero's turn as it was played: the commands the player gave, one after another. */
async function replayHeroTurn(unit) {
  const g = game;
  busy = true;
  refresh();
  playback.rate = replayRate();
  await wait(350);
  while (game === g && game.current === unit && !game.over) {
    const cmd = replay.log[replay.at++];
    const r = cmd ? applyCommand(game, cmd) : null;
    if (!r?.ok) return endReplay(); // the record ran out or went astray
    if (cmd.type === 'end') return; // the next turn has begun
    try {
      await play(unit, cmd.type, r);
    } catch (err) {
      if (game === g) console.error(err); // else the replay was exited mid-animation
    }
    if (game !== g) return;
    syncStatus();
    if (await checkGameOver()) return;
    if (!unit.alive) {
      await wait(500);
      if (game !== g) return;
      heroFell(game, unit);
      return;
    }
    await wait(250);
    await replayGate();
  }
}

function endHeroTurn() {
  if (!isHeroTurn() || busy) return;
  command({ type: 'end' });
}

/**
 * The player's command for the hero whose turn it is: resolve it, save it, then play it
 * back with input locked. Every hero action goes through here (see replay.js).
 */
async function heroCommand(cmd) {
  const u = game.current;
  const known = { explored: board.explored.size, seen: seenIds.size };
  const r = command(cmd);
  if (!r.ok) {
    hud.toast(r.reason);
    return r;
  }
  const g = game;
  busy = true;
  selected = null;
  hovered = null;
  refresh();
  try {
    await play(u, cmd.type, r);
  } catch (err) {
    // A broken animation must never leave the controls locked: the rules already applied.
    console.error(err);
  }
  hud.releaseLog(); // in case the throw never came (nothing held: no-op)
  if (game !== g) return r;
  syncStatus();
  if (await checkGameOver()) return r;
  if (!u.alive) {
    // Cut down by an opportunity attack mid-move: input stays locked until the turn passes.
    await wait(500);
    if (game !== g) return r;
    busy = false;
    heroFell(game, u);
    return r;
  }
  // A move that rolled nothing and showed nothing new can be taken back (the view settles first).
  if (r.undo) {
    await new Promise(requestAnimationFrame);
    if (game !== g) return r;
    if (board.explored.size === known.explored && seenIds.size === known.seen && game.current === u) setUndo({ undo: r.undo, unit: u });
  }
  busy = false;
  refresh();
  if (game.current === u && cmd.type !== 'end') tips.notice('acted', { unit: u, cmd, touch: touching });
  return r;
}

function setUndo(state) {
  undoState = state;
  hud.canUndo = !!state;
}

/** Take back the last move: the hero walks back, and the save forgets it. */
async function undoMove() {
  if (!isHeroTurn() || busy || !undoState) return;
  const { undo, unit } = undoState;
  setUndo(null);
  if (!game.undoMove(undo)) {
    refresh();
    return;
  }
  sfx.ui();
  record?.log.pop();
  if (fight) {
    fight.log.pop();
    fight.check = fightCheck(game);
    saveFight();
  }
  const g = game;
  busy = true;
  selected = null;
  hovered = null;
  refresh();
  await view(unit).moveAlong([...undo.path].reverse());
  if (game !== g) return;
  hud.log(`<span class="heroes">${unit.name}</span> takes the move back.`, 'sys');
  busy = false;
  refresh();
}

/** Resolve a command and add it to the fight's save. */
function command(cmd) {
  setUndo(null); // anything else the hero does settles the move before it
  const r = applyCommand(game, cmd);
  if (r.ok) record?.log.push(cmd);
  if (r.ok && fight) {
    fight.log.push(cmd);
    fight.check = fightCheck(game);
    saveFight();
  }
  return r;
}

function choose(choice) {
  if (!isHeroTurn() || busy) return;
  sfx.ui();
  const u = game.current;
  if (choice.kind === 'action') {
    heroCommand({ type: 'action', id: choice.id });
    return;
  }
  if (choice.kind === 'smite') {
    const r = command({ type: 'smite' });
    if (r.ok) hud.logSmiteArmed(u, r.armed);
    else hud.toast(r.reason);
    refresh();
    return;
  }
  if (choice.kind === 'rebuke') {
    const r = command({ type: 'rebuke' });
    if (r.ok) {
      hud.logRebukeArmed(u, r.armed);
      view(u)?.updateStatus();
    } else hud.toast(r.reason);
    refresh();
    return;
  }
  if (choice.kind === 'spell' && SPELLS[choice.id].targeting === 'self') {
    heroCommand({ type: 'spell', id: choice.id });
    return;
  }
  const same = selected?.kind === choice.kind
    && (choice.kind === 'attack' ? selected.attack === choice.attack : selected.id === choice.id);
  selected = same ? null : choice;
  if (touching) hovered = null; // aim afresh: a tap from before must not cast at once
  refresh();
}

// --- input ----------------------------------------------------------------
const pickTile = (ev) => tileFromEvent(ev, { stage, views, board, game });
const unitRect = (u) => figureRect(stage, u, view(u));

// A finger has no hover: the first tap on a tile shows what would happen there (the path,
// the odds, the blast), and a second tap on the same tile does it. Dragging pans the view.
let touching = matchMedia('(hover: none)').matches; // the last pointer was a finger or pen
hud.touch = touching;
document.body.classList.toggle('touch', touching);
let downAt = null;
window.addEventListener('pointerdown', (ev) => {
  const touch = ev.pointerType !== 'mouse';
  if (touch === touching) return;
  touching = hud.touch = touch;
  document.body.classList.toggle('touch', touch);
  if (isHeroTurn() && !busy) refresh(); // hints say "tap" now
}, { capture: true });
stage.dom.addEventListener('pointerdown', (ev) => {
  downAt = { x: ev.clientX, y: ev.clientY };
  press.start(ev);
});

// On a touch screen a long press on a figure shows its character card (a tap previews and
// acts, as before). The press that showed the card isn't a tap.
const press = longPress(stage.dom, {
  target: (ev) => {
    if (!game || game.over) return null;
    const t = pickTile(ev);
    return t && visibleUnitAt(t.x, t.z);
  },
  show: (who) => hud.showUnitCard(game, who, unitRect(who)),
});
stage.dom.addEventListener('contextmenu', (ev) => ev.pointerType !== 'mouse' && touching && ev.preventDefault());

stage.dom.addEventListener('pointermove', (ev) => {
  if (ev.pointerType !== 'mouse') return;
  keyCursor = false; // the mouse has the cursor again
  const t = pickTile(ev);
  if (t?.x === hovered?.x && t?.z === hovered?.z) return;
  hovered = t;
  // The character card for a figure the mouse rests on, whoever's turn it is.
  const who = game && t && !game.over ? visibleUnitAt(t.x, t.z) : null;
  hud.hoverUnit(game, who, () => unitRect(who));
  if (isHeroTurn() && !busy) refresh();
});

stage.dom.addEventListener('pointerleave', (ev) => {
  if (ev.pointerType !== 'mouse') return; // a lifted finger leaves its preview up
  hovered = null;
  hud.hoverUnit(game, null);
  if (isHeroTurn() && !busy) refresh();
});
for (const type of ['pointerdown', 'wheel']) {
  stage.dom.addEventListener(type, (ev) => ev.pointerType !== 'touch' && hud.hoverUnit(game, null), { passive: true });
}

stage.dom.addEventListener('click', (ev) => {
  if (press.consume()) return; // the long press that showed a card
  if (!isHeroTurn() || busy) return;
  if (downAt && Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 10) return; // a drag
  const t = pickTile(ev);
  if (!t) return;
  if (touching && (t.x !== hovered?.x || t.z !== hovered?.z)) {
    hovered = t;
    refresh();
    return;
  }
  actAt(t);
});

/** What a click (or Enter on the keyboard cursor) on tile `t` does: act, or say why not. */
function actAt(t) {
  const r = tileCommand(game, game.current, t, selected, { unitAt: visibleUnitAt, spellTarget: spellTargetAt });
  if (r?.toast) hud.toast(r.toast);
  else if (r?.cmd) heroCommand(r.cmd);
}

// The keyboard cursor: the arrow keys move the hovered tile (starting on the hero whose turn
// it is) and show what a click there would do; Enter does it. The mouse takes it back.
let keyCursor = false;
const screenOf = (x, z) => {
  const v = new THREE.Vector3(x, 0, z).project(stage.camera);
  return { x: v.x, y: -v.y * (stage.dom.clientHeight / Math.max(1, stage.dom.clientWidth)) };
};
function moveCursor(dir) {
  const hero = game.current?.team === 'heroes' ? game.current : game.living('heroes')[0];
  if (!hero) return;
  hovered = keyCursor && hovered ? stepTile(game.grid, hovered, dir, screenOf) : { x: hero.x, z: hero.z };
  keyCursor = true;
  keepInView(hovered); // a phone with a keyboard: don't let it walk off screen
  const who = visibleUnitAt(hovered.x, hovered.z);
  hud.hoverUnit(game, who, () => unitRect(who));
  if (isHeroTurn() && !busy) refresh();
  else board.hover.set([hovered]);
}

window.addEventListener('keydown', (ev) => {
  if (ev.target instanceof HTMLInputElement) return; // typing a hero's name
  if (replay && replayKey(replay, ev, game?.round ?? 0, endReplay)) return;
  if (ARROWS[ev.code] && game && board && !game.over && !replay && !camp.open && !ev.altKey && !ev.metaKey && !ev.ctrlKey) {
    if (ev.target.closest?.('#settings, #log, #help, .overlay')) return; // scrolling or picking there
    ev.preventDefault();
    moveCursor(ARROWS[ev.code]);
    return;
  }
  if (ev.code === 'Space' || ev.code === 'Enter') {
    if (ev.target instanceof HTMLButtonElement || ev.target instanceof HTMLElement && ev.target.closest('summary')) return;
    ev.preventDefault();
    // Enter acts on the keyboard cursor's tile; Space (or Enter without the cursor) ends the turn.
    if (ev.code === 'Enter' && keyCursor && hovered) {
      if (isHeroTurn() && !busy) actAt(hovered);
    } else endHeroTurn();
  }
  if (ev.code === 'KeyZ' && !ev.altKey) {
    ev.preventDefault();
    undoMove();
  }
  if (ev.code === 'KeyT') threats.toggle();
  if (ev.code === 'KeyM') toggleSound();
  if (ev.code === 'KeyN') toggleMusic();
  if (ev.code === 'KeyH' || ev.key === '?') helpBox.open = !helpBox.open;
  if (ev.code === 'KeyL' && game) hud.toggleLog();
  if (ev.code === 'Escape') {
    if (!selected && keyCursor) { // nothing to cancel: put the keyboard cursor away
      keyCursor = false;
      hovered = null;
      hud.hoverUnit(game, null);
    }
    selected = null;
    if (isHeroTurn() && !busy) refresh();
    else board?.hover.clear();
  }
});

/** ?victory: the won-campaign screen for a made-up run (see debug.js). Nothing is saved or recorded. */
function showSampleVictory() {
  saving = false;
  hud.banner(...sampleVictory(location.search));
}

// ?level=3 jumps straight into a room with a fresh party (handy for testing); &party=5 sets
// the heroes' level, &paladin swaps the Fighter for a Paladin, &warlock the Wizard for a
// Warlock and &ranger the Rogue for a Ranger.
// The title waits only for the dungeon tiles (~0.25 MB compressed); the .glb figures
// follow, the next room's first, and a fight waits only for its own. Any that fail fall
// back to the built-in miniatures.
// #boot (inline in index.html) covers the page until the title is up.
const $boot = document.getElementById('boot');
function bootProgress(done, total) {
  if (!$boot) return;
  $boot.querySelector('.boot-fill').style.width = `${Math.round(10 + (90 * done) / total)}%`;
  $boot.querySelector('.boot-status').textContent = `Laying the crypt stones… ${done}/${total}`;
}
function hideBoot() {
  if (!$boot) return;
  $boot.classList.add('done');
  setTimeout(() => $boot.remove(), 600);
}
showBackdrop();
preloadDungeon(bootProgress).then(() => {
  // rebuild the backdrop from the tile kit now that it's here
  if (!game) {
    stage.scene.remove(board.group);
    board.dispose();
    showBackdrop();
  }
  const levelParam = Number(new URLSearchParams(location.search).get('level'));
  if (levelParam >= 1 && levelParam <= LEVELS.length) {
    saving = false;
    const q = new URLSearchParams(location.search);
    const d = q.get('difficulty'); // e.g. &difficulty=hard
    campaign = partyAt(newCampaign(DIFFICULTIES[d] ? d : 'normal', {}, { ...(q.has('paladin') && { F: 'P' }), ...(q.has('warlock') && { W: 'K' }), ...(q.has('ranger') && { R: 'A' }) }), Number(q.get('party')));
    campaign.tier = Math.max(0, Math.min(99, Math.floor(Number(q.get('tier')) || 0))); // &tier=2: New Game+
    nodeId = LEVELS[levelParam - 1].id;
    newGame();
    loadModels(roomFiles(nodeId, campaign.party)).then(() => loadModels(allFiles())); // this room first
  } else if (new URLSearchParams(location.search).has('victory')) {
    showSampleVictory();
  } else {
    const save = loadSave();
    camp.showTitle(save, loadWonRun());
    links.open(location.hash); // a #watch= replay or #play= challenge
    // While the title is up: the figures for the room the player is most likely to enter
    // next (the saved fight, the rooms open from the saved camp, or the first room), then
    // every other model.
    let next = [START_NODE];
    if (save?.fight) next = [save.fight.node];
    else if (save) next = choices(save).filter((id) => NODES[id].kind === 'fight');
    const first = [...new Set(next.flatMap((id) => roomFiles(id, save?.party ?? null)))];
    loadModels(first).then(() => loadModels(allFiles()));
  }
  hideBoot();
});

// Handy for debugging in the console (see debug.js).
installDebug({
  game: () => game,
  board: () => board,
  threatState: () => ({ on: threats.on, focus: threats.focus }),
  views: () => views,
  stage,
  sfx,
  campaign: () => campaign,
  command: (cmd) => heroCommand(cmd),
  autoplay(on = true) {
    debugAutoplay = on;
    if (on) record = null; // the AI's hero turns aren't commands: nothing to replay
    if (on && fight) {
      // The AI's hero turns aren't commands, so this fight can't be replayed.
      fight = null;
      writeSave(campaign);
    }
    if (on && isHeroTurn() && !busy) runMonsterTurn(game.current);
  },
  level(n) {
    camp.hide();
    saving = false;
    campaign = newCampaign();
    nodeId = LEVELS[Math.min(LEVELS.length, Math.max(1, n)) - 1].id;
    newGame();
  },
  damageReaction,
  checkGameOver,
  lookAt,
});
