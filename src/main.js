// Controller: wires the rules engine (game/) to the renderer (render/) and HUD (ui/).
// The engine resolves everything instantly; animate.js plays the results back as animations.

import { camp, later, loadSave, loadWonRun, hideBoot, SAVE_KEY, WON_KEY } from './boot.js';
import { Game, ELITE_TRAITS, RULES, TORCH } from './game/combat.js';
import { LEVELS } from './game/maps.js';
import { Grid } from './game/grid.js';
import {
  NODES, DIFFICULTIES, newCampaign, completeFight, takeRest, equip, unequip, choosePick, chooseStyle, settlePicks, serialize,
  choices, START_NODE, runDifficulty, newGamePlus, fightRelics, takeEvent, eventProblem, easeRun,
} from './game/campaign.js';
import { pendingScene, sceneProblem, takeScene } from './game/story.js';
import { Heirlooms } from './ui/heirlooms.js';
import { applyCommand, monsterTurn, heroFell, replayFight, fightCheck, newSeed } from './game/replay.js';
import { key } from './game/grid.js';
import { signed, seeded } from './game/dice.js';
import { SPELLS, ACTIONS } from './game/abilities.js';
import { createStage } from './render/stage.js';
import { Board } from './render/board.js';
import { moodFor } from './render/mood.js';
import { UnitView, floatText } from './render/unitView.js';
import { loadModels, modelsSettled } from './render/gltfModels.js';
import { filesForRoom, allFiles } from './render/modelSpecs.js';
import { preloadDungeon } from './render/dungeonKit.js';
import { spiritWeapon, raiseFx } from './render/effects.js';
import { createOwl } from './render/owl.js';
import { wait, playback, calm, setMotion, onSystemMotion, keepAwake } from './render/tween.js';
import { Hud } from './ui/hud.js';
import { Bestiary } from './ui/bestiary.js';
import { Shop } from './ui/shop.js';
import { levelOf, newEndless, nextFloor, afterFloor, loadEndless, saveBestFloor, clearEndless, ENDLESS_KEY } from './game/endless.js';
import { meet, metBefore, slay, slayElite } from './game/bestiary.js';
import { TEMPLATES } from './game/units.js';
import { sfx } from './audio/sfx.js';
import { music } from './audio/music.js';
import { loadSettings, saveSettings, SPEEDS } from './game/settings.js';
import { SettingsPanel } from './ui/settings.js';
import { voices } from './audio/voices.js';
import { hush } from './render/speechBubble.js';
import { banter, SPEECH } from './speech.js';
import { tips } from './ui/tips.js';
import { recordRun, loadHistory, clearLastFight } from './game/history.js';
import { createLinks } from './links.js';
import { createThreats } from './threats.js';
import { createAnimations } from './animate.js';
import { createControls } from './controls.js';
import { createGamepad } from './gamepad.js';
import { createPhotoMode } from './photo.js';
import { cleanRelics, RELICS } from './game/items.js';
import { createPreview } from './preview.js';
import { createCamera } from './camera.js';
import { settleFight } from './fightEnd.js';
import { announce } from './ui/announce.js';
import { installDebug, sampleVictory } from './debug.js';
import { saveLoaded } from './offline.js';
import { track, setStats, runEvent, abandonEvent, continueEvent, leftEvent, takeInput, perfEvent } from './stats.js';
import { replayRate as barRate, replayGate as barGate, replayLabel as barLabel, replayPlay as barPlay, replaySpeed } from './ui/replayBar.js';
import { dayKey, dailyPlan, dailyCampaign, partyAt, loadDaily } from './game/daily.js';
import { weekKey, weeklyPlan, weeklyCampaign } from './game/weekly.js';
import { CoopLobby, fightFrom } from './ui/coop.js';
import { HERO_SLOTS } from './coop.js';

// All levels share one size, so the stage is set up once.
const stage = createStage(document.getElementById('stage'), {
  width: LEVELS[0].rows[0].length,
  height: LEVELS[0].rows.length,
});
// Once a visit, after about 300 frames of movement, how smoothly the board drew (play stats).
const perfCheck = setInterval(() => {
  if (stage.perf.frames < 300) return;
  clearInterval(perfCheck);
  track(...perfEvent({ ...stage.perf, dpr: stage.renderer.getPixelRatio() }));
}, 5000);

// --- campaign & saves ---------------------------------------------------------
// Storage can be blocked (private windows, sandboxed previews); the game still runs.
// Test runs (?level=, __debug.level) never touch the save. loadSave is in boot.js.
let saving = true;
function writeSave(state) {
  if (!saving) return;
  // A dive in the Endless Crypt is kept apart from the campaign's save.
  try { localStorage.setItem(state.endless ? ENDLESS_KEY : SAVE_KEY, serialize(state)); } catch { /* not saved */ }
}
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
/** ?level=N&seed=S: the test fight's dice, for the same fight every time (the first fight only). */
let testSeed = new URLSearchParams(location.search).has('level') && new URLSearchParams(location.search).has('seed')
  ? Number(new URLSearchParams(location.search).get('seed')) >>> 0 : null;
/** A linked fight being played yourself ({ rec, theirs }: the link's record and how it went), else null. */
let challenge = null;
/**
 * A co-op fight (Play together, ui/coop.js), else null: { link, game, fight, log, at, turn,
 * remote, gone }. `log` is the commands applied here, `at` the next place in the relay's log,
 * `turn` the hero turn being timed ({ unit, since }), `remote` the hero whose commands are being
 * played from the relay, `gone` when each player who dropped out went.
 */
let coop = null;
/** What this fight's attacks did, for achievements: the biggest hit and sneak attacks landed. */
let feats = { maxHit: 0, sneaks: 0, stayDown: false, held: false, coals: false, pinned: false, teamwork: false, edge: false, caught: false };

// The character models load room by room: a fight waits only for the figures it needs.
// Once the dungeon tiles are in (they gate the title), the next room's models come first,
// then the rest in the background (see the boot code at the bottom).
const $loading = document.getElementById('loading');
let undoState = null; // { undo, unit }: the last move, while it can still be taken back (see undoMove)
let fightTicket = 0; // the latest fight asked for while its figures were loading
const roomFiles = (id, party) => filesForRoom(levelOf(id).rows, party, levelOf(id));

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
    if (coop) return coop.link.host && coop.link.send({ t: 'start', fight: fightFrom(coop.link.room?.draft) }); // Play again
    if (daily || challenge) newGame(); // the daily or the linked fight again, from the same seed
    else if (game?.over === 'victory') startCampaign(); // after the final room
    else newGame(); // retry this room with the party as it entered
  },
  // The Defeat banner's offer after losing a room again and again (easeOffer): the rest of the
  // run one difficulty down, and this room again.
  onEase: () => {
    if (!campaign || !game || game.over !== 'defeat') return;
    const from = campaign.difficulty;
    campaign = easeRun(campaign);
    writeSave(campaign);
    track('ease-taken', { room: nodeId, from, to: campaign.difficulty });
    sfx.ui();
    newGame();
  },
  onNext: () => leaveRoom(),
  onMap: () => {
    if (coop) return coop.link.host ? coop.link.send({ t: 'lobby' }) : lobby.leave(); // the lobby, or out of the room
    if (daily || challenge || (campaign?.endless && game?.over === 'defeat')) return backToTitle(); // a dive ends where it falls
    sfx.ui();
    showCamp(null);
  },
  onToggleMusic: () => toggleMusic(),
  onToggleSound: () => toggleSound(),
});

// The pedlar's panel: a trade is saved at once, like handing out an item.
const shop = new Shop(() => campaign, (state) => {
  sfx.chest();
  campaign = state;
  writeSave(campaign);
  camp.show(campaign);
});

// The camp itself is made in boot.js, which put the title up before this file arrived.
Object.assign(later, {
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
  onPick: (code, level, stat) => {
    sfx.levelUp();
    campaign = choosePick(campaign, code, level, stat);
    writeSave(campaign);
    camp.show(campaign);
  },
  onStyle: (code, style) => {
    sfx.ui();
    campaign = chooseStyle(campaign, code, style);
    writeSave(campaign);
    camp.show(campaign);
  },
  onTrade: (opener) => {
    sfx.ui();
    shop.open(opener);
  },
  onEndless: () => startEndless(),
  onCoop: (button) => lobby.show(button),
  onEndDive: () => endDive(),
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
    const save = loadSave();
    campaign = save ?? newCampaign();
    const saved = campaign.fight;
    delete campaign.fight;
    if (save) track(...continueEvent(campaign, !!saved));
    if (saved) {
      camp.hide();
      nodeId = saved.node;
      newGame(saved);
    } else {
      showCamp(null);
    }
  },
});

// The 3D emblem loads on its own and replaces its still (the same size, so nothing jumps) when
// it's ready. With Data Saver on, or on a 2G connection, the still stays and the skull isn't
// downloaded.
const slowLink = ((c) => !!c && (c.saveData || /2g/.test(c.effectiveType ?? '')))(navigator.connection);
const logoModule = () => import('./render/titleLogo.js');
let titleLogo = null, bannerLogo = null;
// Settles once the skull is up (or has failed): the title's figure downloads wait for it.
const titleLogoUp = slowLink ? Promise.resolve() : logoModule().then((m) => m.mountTitleLogo(document.querySelector('#title .title-emblem'))).then((l) => { titleLogo = l; }).catch(() => {});

/**
 * The end banner's skull (the won campaign and every defeat): a second 3D emblem, mounted the
 * first time, that plays `move`: a laugh for the won campaign, a mocking chatter for a defeat.
 */
function bannerSkull(move) {
  if (slowLink) return;
  bannerSkull.mounting ??= logoModule()
    .then((m) => m.mountTitleLogo(document.querySelector('#banner-emblem img'), { className: 'banner-logo', hint: false }))
    .catch(() => null);
  bannerSkull.mounting.then((l) => { bannerLogo = l; setTimeout(() => l?.poke(move), 900); });
}

// The title's skull glances at a button as the pointer or the keyboard focus reaches it.
const titleEl = document.getElementById('title');
const onButton = (ev) => {
  const b = ev.target.closest?.('button');
  if (b && ev.relatedTarget?.closest?.('button') !== b) titleLogo?.glance();
};
titleEl.addEventListener('pointerover', onButton);
titleEl.addEventListener('focusin', onButton);

// K: the skull on the title (or the end banner) plays its next move.
window.addEventListener('keydown', (ev) => {
  if (ev.code !== 'KeyK' || ev.repeat || ev.altKey || ev.metaKey || ev.ctrlKey || replay) return;
  if (ev.target instanceof HTMLInputElement) return; // typing a hero's name
  if (!document.getElementById('title').hidden) titleLogo?.poke();
  else if (!document.getElementById('banner-emblem').hidden) bannerLogo?.poke();
});

function startCampaign(difficulty, names, classes) {
  sfx.ui();
  saving = true;
  daily = null;
  challenge = null;
  // A run being replaced (Abandon run, or New campaign over a save) goes into the history.
  const old = loadSave();
  if (old && !old.done) {
    recordRun(old, 'abandoned');
    track(...abandonEvent(old));
  }
  clearLastFight(); // whatever it was, it isn't this run's
  setWonRun(null); // a new campaign closes the way to New Game+
  campaign = newCampaign(difficulty, names, classes);
  writeSave(campaign);
  track(...runEvent(campaign));
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
  track(...runEvent(campaign, 'ngplus'));
  showCamp(null);
});

/**
 * The Endless Crypt after a won campaign: the dive in progress, or a new one with the won
 * party, floor after floor of rooms made from its seed (game/endless.js), until it falls.
 */
function startEndless() {
  const dive = loadEndless();
  const won = loadWonRun();
  if (!dive && !won) return;
  sfx.ui();
  saving = true;
  daily = null;
  challenge = null;
  campaign = dive ?? newEndless(won, newSeed());
  const saved = campaign.fight;
  delete campaign.fight;
  if (!dive) writeSave(campaign);
  if (saved) {
    camp.hide();
    nodeId = saved.node;
    newGame(saved);
  } else {
    showCamp(null);
  }
}

/** Give up the dive in progress (from camp), back to the title. */
function endDive() {
  if (!campaign?.endless) return;
  clearEndless();
  backToTitle();
}

/** Today's daily crypt (or, `weekly`, this week's elite crypt): its room and party, apart from the campaign (nothing is saved). */
function startDaily(weekly = false) {
  sfx.ui();
  saving = false;
  challenge = null;
  daily = weekly ? weeklyPlan(weekKey()) : dailyPlan(dayKey());
  track('daily-start', { mode: weekly ? 'weekly' : 'daily', room: daily.node });
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
  track('challenge-played', { room: rec.node });
  campaign = { ...newCampaign(rec.difficulty), party: structuredClone(rec.party), ...(rec.tier && { tier: rec.tier }), relics: [...(rec.relics ?? [])] };
  nodeId = rec.node;
  camp.hide();
  newGame();
}

/** From a daily crypt back to the title screen, with the empty dungeon behind it. */
function backToTitle() {
  sfx.ui();
  if (coop) { // out of the room too
    coop = null;
    lobby.leave(true);
  }
  ++fightTicket;
  for (const id of [...spiritWeapons.keys()]) clearSpiritWeapon(id);
  clearOwls();
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
  camp.arrive(campaign, report);
  tips.notice('camp', { report });
}

function enterRoom(id) {
  sfx.ui();
  // The Endless Crypt's next floor.
  if (id === 'deep') {
    if (!campaign?.endless) return;
    campaign = settlePicks(campaign); // an ability increase left open keeps the usual one
    writeSave(campaign);
    camp.hide();
    tips.hide();
    nodeId = nextFloor(campaign);
    newGame();
    return;
  }
  // A scene between fights (game/story.js): "scene:gravedigger:take".
  if (id.startsWith('scene:')) {
    const [, scene, opt] = id.split(':');
    if (sceneProblem(campaign, scene, opt)) return;
    const { state, report } = takeScene(campaign, scene, opt);
    campaign = state;
    writeSave(campaign);
    track('stop', { stop: scene, choice: opt, difficulty: campaign.difficulty });
    if (report.gold) sfx.chest();
    else if (report.potions) sfx.heal();
    else sfx.discover();
    showCamp(report);
    return;
  }
  // The way on stays shut while a scene waits for its answer.
  if (pendingScene(campaign)) return;
  // A stop with no fight: the choice is made from the camp ("altar:offer").
  if (id.includes(':')) {
    const [node, opt] = id.split(':');
    if (eventProblem(campaign, node, opt)) return;
    const { state, report } = takeEvent(campaign, node, opt);
    campaign = state;
    writeSave(campaign);
    track('stop', { stop: node, choice: opt, difficulty: campaign.difficulty });
    if (node === 'reliquary') sfx.unlock();
    else if (node === 'altar') sfx.discover();
    else if (opt === 'tend') sfx.heal();
    else sfx.chest();
    showCamp(report);
    return;
  }
  if (NODES[id].kind === 'rest') {
    campaign = takeRest(campaign, id);
    writeSave(campaign);
    sfx.heal();
    showCamp({ rest: id });
    return;
  }
  campaign = settlePicks(campaign);
  writeSave(campaign);
  camp.hide();
  tips.hide(); // the camp's tip is about the camp
  nodeId = id;
  newGame();
}

// A fight still going when the page closes or reloads is counted (play stats), once a fight:
// real runs, dailies and linked fights, not test fights or replays.
let leftFor = null;
window.addEventListener('pagehide', () => {
  if (!game || game.over || replay || !campaign || campaign.endless || !(saving || daily || challenge) || leftFor === game) return;
  leftFor = game;
  const mode = challenge ? 'challenge' : daily ? (daily.weekly ? 'weekly' : 'daily') : 'campaign';
  track(...leftEvent({ game, nodeId, campaign, mode, input: takeInput() }));
});

/** After a won room: rest, XP, loot, save, then back to the map. */
function leaveRoom() {
  if (game?.over !== 'victory') return;
  sfx.ui();
  let { state, report } = completeFight(campaign, nodeId, game);
  if (state.endless) { // a floor of the Endless Crypt: its gold, the next floor, a long rest every third
    const f = afterFloor(state);
    state = f.state;
    Object.assign(report, { gold: f.gold, longRest: f.longRest, floor: f.floor });
    saveBestFloor(f.floor);
  }
  campaign = state;
  writeSave(campaign);
  // Two heroes trade a line in camp (with speech bubbles on).
  const heroes = game.units.filter((u) => u.team === 'heroes' && (u.alive || u.dying));
  if (settings.bubbles) report.banter = banter(heroes, { downed: game.blows.filter((b) => b.down).map((b) => b.to), boss: !!NODES[nodeId]?.boss });
  showCamp(report);
  if (report.levelUps.length) setTimeout(() => sfx.levelUp(), 250);
}

const $banner = document.getElementById('banner');


// --- the camera: framing the board round the HUD, and its moves in a fight (camera.js) ---------
const floorButton = document.getElementById('floor-toggle');
const camera = createCamera({ stage, hud, game: () => game, board: () => board, photo: () => photo, floorButton });
const { frameParty, lookAt, keepInView, bossSweep, stairCamera, lastBlow, peekFloor, setPeek } = camera;

// Audio may only start after a user gesture. Safari on a phone takes the end of a tap, not its
// start: a context made on touch-down says it's running yet stays silent. So start it on the
// end of a tap, a click or a key, and for the first few of those kick it again the way the
// Sound button does (wake it, then set the volume afresh); after that only when it has
// stopped (a call, or the app going to the background).
const unlockAudio = () => {
  sfx.unlock();
  music.start();
};
let audioKicks = 0;
for (const type of ['pointerup', 'touchend', 'click', 'keydown']) {
  window.addEventListener(type, () => {
    if (sfx.ready && audioKicks >= 4) return;
    audioKicks++;
    unlockAudio();
    sfx.setMuted(sfx.muted);
  }, { capture: true, passive: true });
}

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
/** The Glow setting: bloom (render/post.js), on Auto everywhere but phones. */
const glowOn = () => settings.glow === 'on' || (settings.glow === 'auto' && !matchMedia('(pointer: coarse)').matches);
/** And reflections in the water (render/reflect.js), which go with it. */
const applyGlow = () => {
  board?.setReflections(glowOn());
  return stage.setEffects({ glow: glowOn() });
};
stage.setEffects({ glow: glowOn() }); // (the board, made later, takes its reflections from glowOn)
new SettingsPanel(settings, (key, value) => {
  settings[key] = value;
  saveSettings(settings);
  if (key === 'motion') return applyMotion();
  if (key === 'glow') return applyGlow();
  if (key === 'text') {
    document.documentElement.dataset.text = value;
    camera.remeasure(); // the action bar's height changed: measure it afresh, smaller too
    return stage.fit(); // the panels' edges moved
  }
  if (key === 'stats') return setStats(value);
  if (key === 'colorblind') {
    board?.setThreatColors(value);
    document.body.classList.toggle('colorblind', value);
  }
  if (key === 'bubbles' && !value) hush();
  if (key === 'speed' || key === 'rolls' || key === 'throwDice' || key === 'colorblind' || key === 'bubbles') return;
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
let revealed = false; // __debug.reveal(): the fog lifted for a screenshot, until the next fight
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
  if ((game.over && ended) || revealed) {
    // The fight is decided (or __debug.reveal()): lift the fog (the stairs, who was lurking where).
    if (visionSig === 'over') return;
    visionSig = 'over';
    visible = new Set();
    for (let z = 0; z < grid.height; z++) for (let x = 0; x < grid.width; x++) visible.add(key(x, z));
    board.setVision(visible);
    return;
  }
  const eyes = game.units.filter((u) => u.team === 'heroes' && u.alive && view(u)).map((u) => tileOf(view(u)));
  // Rules 9: an owl sees from its perch, in the dark too (drawn only: the rules' sight is the heroes').
  const owlEyes = [...owls.values()].map((o) => o.tile).filter(Boolean);
  // A hero on a stair to the other floor sees down (or up) it: from the stair at its other end too.
  for (const e of [...eyes]) {
    const far = grid.links.get(key(e.x, e.z));
    if (far) eyes.push(far);
  }
  const doors = [...board.doors.values()].map((d) => (d.opened ? 1 : 0)).join('');
  // In a dark room, thrown torches, Light and burning creatures change what's lit too.
  const lit = game.dark.size ? '|' + game.lamps.length + ':' + game.units.filter((u) => u.alive && game.has(u, 'burning')).map((u) => key(u.x, u.z)).join(';') : '';
  const fog = game.fogs?.length ? game.fogTiles() : null; // rules 10: Fog Cloud
  const sig = eyes.map((e) => key(e.x, e.z)).join(';') + '|' + owlEyes.map((e) => key(e.x, e.z)).join(';') + '|' + doors + lit + (fog ? '|' + [...fog].join(';') : '');
  if (sig === visionSig && !force) return;
  const first = !visionSig;
  visionSig = sig;
  const blocks = (x, z) => grid.isWall(x, z) || grid.opaqueProp(x, z) || (grid.doors.has(key(x, z)) && !board.doors.get(key(x, z)).opened);
  if (fog) {
    // Rules 10: nobody sees into, out of or through Fog Cloud past 5 ft.
    const inFog = (e) => fog.has(key(e.x, e.z));
    visible = grid.visibleFrom(eyes.filter((e) => !inFog(e)), (x, z) => blocks(x, z) || fog.has(key(x, z)));
    const near = (x, z) => eyes.some((e) => Math.abs(e.x - x) <= 1 && Math.abs(e.z - z) <= 1);
    for (const k of fog) {
      const [x, z] = k.split(',').map(Number);
      if (!near(x, z)) visible.delete(k);
    }
    for (const e of eyes) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) visible.add(key(e.x + dx, e.z + dz));
  } else visible = grid.visibleFrom(eyes, blocks);
  // Rules 6: a dark area shows only as far as the heroes' torches reach.
  if (game.dark.size) {
    for (const k of game.dark) {
      const [x, z] = k.split(',').map(Number);
      if (visible.has(k) && game.dim(x, z, eyes)) visible.delete(k);
    }
  }
  if (owlEyes.length) for (const k of grid.visibleFrom(owlEyes, blocks)) visible.add(k);
  board.setVision(visible, { snap: first, from: [...eyes, ...owlEyes] });
}

/**
 * Every frame: outline the hovered figure (warm) and each foe the action can reach (red), from
 * the board's hover and target tiles, so taps and the arrow-key cursor get them too. None in
 * photo mode, on the fallen or on what the heroes can't see.
 */
stage.tickers.add(() => {
  if (!game || !board) return;
  const on = board.overlaysOn !== false;
  // The pointed tile itself (an area preview's hover is the whole blast), while one is drawn.
  const hoverKey = on && hovered && board.hover.last?.length ? key(hovered.x, hovered.z) : null;
  const targets = new Set(on ? (board.targets.last ?? []).map((t) => key(Math.round(t.x), Math.round(t.z))) : []);
  for (const v of views.values()) {
    const u = v.unit;
    let kind = null;
    if (u.alive && !v.gone && !v.ghost && v.group.visible && !unseen(u)) {
      const t = tileOf(v);
      const k = key(t.x, t.z);
      kind = k === hoverKey ? 'hover' : targets.has(k) ? 'target' : null;
    }
    v.setOutline(kind);
  }
});

/**
 * The edges of the screen darken while a hero is near death: a little below a quarter of their
 * hit points, more while one lies dying. Gone once the fight is over.
 */
const vignette = document.getElementById('vignette');
stage.tickers.add(() => {
  let level = 0;
  if (game && !game.over && !camp.open) {
    for (const u of game.units) {
      if (u.team !== 'heroes') continue;
      if (u.dying && !u.dying.stable) level = 2;
      else if (u.alive && u.hp > 0 && u.hp < u.maxHp / 4) level = Math.max(level, 1);
    }
  }
  if (vignette.dataset.level !== String(level)) vignette.dataset.level = level;
});

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
    if (heard.has(u.id) && (show || !u.alive || inView(heard.get(u.id)))) {
      heard.delete(u.id); // seen, gone, or its tile seen empty: no need to guess any more
      drawHeard();
    }
    if (show && u.alive && !seenIds.has(u.id)) {
      seenIds.add(u.id);
      kinds.push(u.code);
      spotted = true;
      if (u.elite) elite = u;
      anim.intro(u); // a named foe says who it is
      if (SPEECH.NAMED.has(u.code) && u.alive) bossSweep(u); // and the camera turns to it
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
  hud.log(`<span class="monsters" data-unit="${u.id}">${u.name}</span> is an <b>elite</b>: ${t.name.toLowerCase()} (${t.desc}).`, 'sys');
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
/** Rules 9: the wizards' and warlocks' owls on the board, by their master's id. */
const owls = new Map();
function clearOwls() {
  for (const o of owls.values()) o.remove();
  owls.clear();
}
const anim = createAnimations({
  stage, hud, settings, spiritWeapons, owls, view, addView, unseen, inView, flushReveals, syncStatus, keepInView,
  game: () => game, board: () => board, selected: () => selected, busy: () => busy, touching: () => controls.touching,
  lastBlow: (at) => lastBlow(at), stairCamera: (step, unit, ms) => stairCamera(step, unit, ms), views: () => views,
  // A friend's hero in co-op is played like a replay: no throwing their dice for them.
  autoplaying: () => debugAutoplay, replaying: () => !!replay || (!!coop && !!game?.current && !coopMine(game.current)),
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
  if (kitLoaded && modelsSettled(files)) {
    $loading.hidden = true;
    startFight(resume);
    return;
  }
  // This room's figures (or the dungeon tiles) are still downloading: wait for them.
  $loading.hidden = false;
  Promise.all([loadModels(files), kit]).then(() => {
    if (ticket !== fightTicket) return; // another fight was asked for meanwhile
    $loading.hidden = true;
    startFight(resume);
  });
}

/** Start a fight, or (`watch`: a record) a replay of a finished one. */
function startFight(resume, watch = null) {
  for (const id of [...spiritWeapons.keys()]) clearSpiritWeapon(id);
  clearOwls();
  if (board) {
    stage.scene.remove(board.group);
    board.dispose();
  }
  for (const v of views.values()) {
    v.dispose();
    stage.scene.remove(v.group);
  }

  const level = levelOf(nodeId);
  // A daily always starts from the day's seed, so every try (and everyone) faces the same dice.
  // A linked fight played yourself starts from the link's seed: the same dice it had.
  const seed = watch?.seed ?? resume?.seed ?? daily?.seed ?? challenge?.rec.seed ?? coop?.fight.seed ?? testSeed ?? newSeed();
  testSeed = null; // ?level=N&seed=S fixes the first fight's dice only
  const party = watch?.party ?? campaign.party;
  const difficulty = watch?.difficulty ?? campaign.difficulty;
  const tier = (watch ? watch.tier : campaign.tier) ?? 0; // New Game+
  // A saved fight keeps the relics it began with (none for one saved before relics).
  const relics = (watch ? watch.relics : resume ? resume.relics : fightRelics(campaign)) ?? [];
  // A saved fight, replay or played link keeps the rules it began under (none: the first).
  const from = watch ?? resume ?? challenge?.rec ?? coop?.fight;
  const rules = from ? from.rules ?? 1 : RULES;
  const ru = rules > 1 ? { rules } : {};
  game = new Game(level, { party, difficulty: runDifficulty(difficulty, tier), rng: seeded(seed), relics, rules });
  fight = daily || challenge || watch || coop ? null : { node: nodeId, seed, ...ru, log: [], check: null, explored: [], seen: [], ...(relics.length && { relics: [...relics] }) };
  if (!watch) record = { node: nodeId, seed, ...ru, party: structuredClone(party), difficulty, ...(tier && { tier }), ...(relics.length && { relics: [...relics] }), log: resume ? [...resume.log] : [] };
  feats = { maxHit: 0, sneaks: 0, stayDown: false, held: false, coals: false, pinned: false, teamwork: false, edge: false };
  if (!watch) takeInput(); // the fight's presses count from here (play stats)
  game.on('attack', (r) => {
    if (r.attacker.team !== 'heroes' || !r.hit) return;
    feats.maxHit = Math.max(feats.maxHit, r.damage ?? 0);
    if (r.sneak) feats.sneaks++;
  });
  // A Relentless elite finished in the round it clung on at 1 HP.
  let clung = null;
  game.on('ward', (r) => { if (r.relentless) clung = { unit: r.unit, round: game.round }; });
  // The board and the new actions: the hero attack that dropped a foe, coals, a hold.
  let blow = null;
  let scorched = null; // the last one the coals landed on or burned
  game.on('attack', (r) => { blow = r.attacker.team === 'heroes' ? r : null; scorched = null; });
  game.on('spell', () => { blow = null; scorched = null; });
  game.on('spill', (r) => { blow = null; scorched = r.unit; });
  game.on('burn', (r) => { blow = null; scorched = r.unit; });
  game.on('throw', (r) => { if (r.target.team === 'heroes' && r.edge?.success) feats.caught = true; });
  game.on('shove', (r) => { if (r.push?.stair && !r.push.crash && r.attacker.team === 'heroes') feats.stairs = true; });
  game.on('grappleEnd', ({ unit, why }) => { if (why === 'fell' && unit.team === 'monsters' && !unit.alive) feats.pinned = true; });
  game.on('death', ({ unit }) => {
    if (clung?.unit === unit && clung.round === game.round) feats.stayDown = true;
    if (unit.team !== 'monsters') return;
    if (scorched === unit) feats.coals = true;
    if (unit.fell) feats.edge = true;
    if (blow?.target === unit) {
      if (blow.readied) feats.held = true;
      if (blow.mods.adv.some((a) => a.startsWith('help from'))) feats.teamwork = true;
    }
  });
  if (resume && !replaySaved(resume)) {
    if (coop) { // can't happen unless the relay's log is broken: out of the room
      game = null;
      hud.toast('The shared fight couldn’t be rebuilt, so you left the room.');
      lobby.leave();
      return;
    }
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
  board.setReflections(glowOn()); // the water's reflections go with the Glow setting
  stage.setMood(moodFor(nodeId ?? level.id)); // each act's light (render/mood.js)
  floorButton.hidden = !game.grid.links.size; // rooms on two floors only
  heard.clear();
  setPeek(null);
  board.setThreatColors(settings.colorblind);
  stage.scene.add(board.group);
  board.setIce(game.icyTiles()); // a restored fight may have icy ground
  board.setFire(game.burningTiles()); // and coals from a tipped brazier
  board.setCaltrops(game.caltropTiles); // and caltrops (rules 6)
  board.setCeilings(game.ceilings); // rules 10: cracked ceilings, rubble, Grease and Fog Cloud
  board.addRubble([...game.rubble].map((k) => { const [x, z] = k.split(',').map(Number); return { x, z }; }));
  board.setGrease(game.grease.keys());
  board.setFog(game.fogTiles());
  for (const p of game.grid.props.values()) if (p.tipped) board.tipBrazier(p.x, p.z, p.from.x, p.from.z, true);
  if ([...game.grid.gates.values()].some((g) => g.down)) board.setGates(true, true); // a portcullis already down
  views = new Map();
  for (const u of game.units) addView(u);
  for (const u of game.units) if (u.alive && u.familiar?.alive) owls.set(u.id, createOwl(stage.scene, u.familiar));
  if (game.dark.size) {
    // Rules 6: each hero carries a torch, lit while dark lies within its reach.
    board.setDark(game.dark);
    const near = (x, z) => { for (let dz = -TORCH; dz <= TORCH; dz++) for (let dx = -TORCH; dx <= TORCH; dx++) if (game.dark.has(key(x + dx, z + dz))) return true; return false; };
    for (const v of views.values()) if (v.unit.team === 'heroes') v.carryTorch(near, TORCH + 2);
  }

  busy = false;
  ended = false;
  revealed = false;
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
  if (!resume) {
    // The room builds itself in a wave out from where the party stands (drawn only).
    const heroes = game.units.filter((u) => u.team === 'heroes');
    const mid = (k) => heroes.reduce((n, u) => n + u[k], 0) / (heroes.length || 1);
    board.rise({ x: mid('x'), z: mid('z') });
  }
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
      hud.log(`<span class="${u.team}" data-unit="${u.id}">${u.name}</span> <span class="dice">d20 ${u.initRoll} ${signed(u.initiative - u.initRoll)} = ${u.initiative}</span>`);
    }
    if (lurking) hud.log(`<span class="monsters">Something</span> stirs beyond your sight…`, 'sys');
    // The run's relics that change how a fight starts.
    if (game.relics.includes('horn')) hud.log(`<b class="relic">${RELICS.horn.name}</b> sounds: the heroes go first.`, 'sys');
    if (game.relics.includes('veil')) hud.log(`<b class="relic">${RELICS.veil.name}</b> hides the party.`, 'sys');
    // New Game+ 2 and deeper: the elite's trait is named once it's seen (the vision ticker).
    const elite = game.units.find((u) => u.elite && u.alive);
    if (elite && unseen(elite)) hud.log('Something strong lurks here: an <b>elite</b>.', 'sys');
  });
  game.on('round', () => board?.tracks?.age()); // footprints dry
  game.on('round', ({ round }) => hud.log(game.hold ? `Round ${round} of ${game.hold.rounds}` : `Round ${round}`, 'round'));
  game.on('turnStart', ({ unit }) => onTurnStart(unit));
  game.on('turnEnd', () => hud.endTurn()); // before the next round's heading
  game.on('attack', (r) => {
    // The player is about to throw this one: the log waits until the die lands.
    if (throwsOwn(r)) hud.holdLog();
    if (r.guard) hud.logGuard(r); // rules 11: Protection
    hud.logAttack(r);
  });
  // Rules 11: a shadow's touch, radiant on a shadow, and a shadow slipping back into the dark.
  game.on('drain', (r) => hud.logDrain(r));
  game.on('vulnerable', (r) => { if (!unseen(r.unit)) hud.logVulnerable(r); });
  game.on('shadowHide', (r) => { if (!unseen(r.unit)) hud.logShadowHide(r); });
  game.on('spell', (r) => {
    if (unseen(r.caster)) hud.log('You hear chanting somewhere in the dark…', 'sys');
    else hud.logSpell(r);
  });
  game.on('action', (r) => { if (!unseen(r.unit)) hud.logAction(r); });
  game.on('death', ({ unit, unmarked, blessing, dying }) => {
    clearSpiritWeapon(unit.id); // a fallen cleric's weapon fades
    if (unit.team === 'monsters' && !replay) {
      slay(unit.code); // the bestiary's tally
      if (unit.elite) slayElite(unit.elite);
    }
    if (unmarked) view(unmarked)?.updateStatus(); // and a fallen ranger's mark
    if (unseen(unit)) hud.log('Something falls in the dark.', 'death');
    else if (dying) hud.log(`<span class="${unit.team}" data-unit="${unit.id}">${unit.name}</span> falls, dying: death saves until healed.`, 'death');
    else hud.log(`<span class="${unit.team}" data-unit="${unit.id}">${unit.name}</span> falls.`, 'death');
    if (blessing) {
      hud.logBlessing(blessing);
      // Shown once the blow has landed (the death plays out first).
      wait(500).then(() => {
        floatText(stage.scene, { x: blessing.unit.x, z: blessing.unit.z - 0.5 }, `+${blessing.tempHp} temp HP`, 'heal');
        view(blessing.unit)?.updateHp();
      });
    }
  });
  // Death saves (rules 2): rolled as a dying hero's turn comes round.
  game.on('deathSave', (r) => {
    hud.logDeathSave(r);
    hud.renderInitiative(game);
    const text = r.result === 'rally' ? 'Back up!' : r.result === 'stable' ? 'Stable' : r.result === 'dead' ? 'Gone' : r.d20 >= 10 ? 'Save ✓' : 'Save ✗';
    floatText(stage.scene, r.unit, text, r.result === 'dead' || (!r.result && r.d20 < 10) ? 'crit' : 'heal');
    if (r.result === 'rally') view(r.unit)?.getUp();
    if (r.result === 'dead') view(r.unit)?.fadeMeshes(0.4);
  });
  game.on('concentration', (r) => {
    hud.logConcentration(r);
    // Shown once the blow has landed.
    wait(500).then(() => {
      if (r.cause === 'damage') floatText(stage.scene, { x: r.unit.x, z: r.unit.z - 0.5 }, r.broken ? 'Concentration lost' : 'Concentration held', r.broken ? 'warn' : 'heal');
      for (const u of [r.unit, ...r.touched]) view(u)?.updateStatus();
    });
  });
  game.on('revive', ({ unit, by }) => {
    if (by) hud.log(`<span class="heroes" data-unit="${unit.id}">${unit.name}</span> is back in the fight, prone.`, 'sys');
  });
  game.on('ward', (r) => {
    hud.logWard(r);
    // Shown once the blow has landed.
    wait(500).then(() => {
      floatText(stage.scene, { x: r.unit.x, z: r.unit.z - 0.5 }, r.relic ? 'Phylactery!' : r.relentless ? 'Relentless!' : 'Death Ward!', r.relentless ? 'warn' : 'heal');
      view(r.unit)?.updateStatus();
    });
  });
  game.on('barbs', (r) => hud.logBarbs(r)); // shown by playBarbs in animate.js
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
  game.on('brazier', (r) => hud.logBrazier(r));
  game.on('lever', (r) => hud.logLever(r));
  game.on('spill', (r) => { if (!unseen(r.unit)) hud.logSpill(r); });
  game.on('burn', (r) => {
    if (unseen(r.unit)) hud.log('Something blunders onto the coals in the dark.', 'sys');
    else hud.logBurn(r);
  });
  game.on('coals', (r) => {
    board.setFire(r.tiles);
    hud.log('The spilled coals burn out.', 'sys');
  });
  game.on('mimic', (r) => hud.logMimic(r));
  game.on('mimicFound', (r) => pendingReveals.push(r));
  game.on('rider', (r) => { if (!unseen(r.target)) hud.logRider(r); });
  game.on('technique', (r) => { if (!unseen(r.target)) hud.logTechnique(r); });
  game.on('shove', (r) => hud.logShove(r));
  game.on('tumble', (r) => { if (unseen(r.unit)) hud.log(r.through ? 'Stone gives way somewhere in the dark.' : r.ledge ? 'Something falls in the dark.' : 'Something tumbles down the stairs in the dark.', 'sys'); else hud.logTumble(r); });
  game.on('throw', (r) => hud.logThrow(r));
  game.on('help', (r) => hud.logHelp(r));
  game.on('feed', (r) => hud.logFeed(r));
  // Rules 6: the pedlar's flasks and caltrops.
  game.on('flask', (r) => hud.logFlask(r));
  game.on('caltrops', (r) => hud.logCaltrops(r));
  game.on('light', (r) => hud.logLight(r));
  game.on('smash', (r) => hud.logSmash(r));
  // Rules 8: barred doors, disarmed traps and Undead Fortitude.
  game.on('bar', (r) => hud.logBar(r));
  game.on('bash', (r) => {
    const seen = !unseen(r.unit);
    if (seen || inView(r)) hud.logBash(r, seen);
    else hud.log('Something pounds on a barred door in the dark.', 'sys');
  });
  game.on('disarm', (r) => hud.logDisarm(r));
  game.on('fortitude', (r) => {
    if (unseen(r.unit)) return;
    hud.logFortitude(r);
    if (r.success) floatText(stage.scene, { x: r.unit.x, z: r.unit.z - 0.5 }, 'Gets back up!', 'warn');
  });
  game.on('morale', (r) => {
    if (unseen(r.unit)) return;
    hud.logMorale(r);
    if (!r.success) {
      floatText(stage.scene, { x: r.unit.x, z: r.unit.z - 0.5 }, 'Flees!', 'warn');
      view(r.unit)?.updateStatus();
    }
  });
  game.on('digest', (r) => {
    hud.logDigest(r);
    sfx.fireImpact();
    floatText(stage.scene, r.unit, `Acid −${r.damage}`, 'crit');
    anim.damageReaction(r.unit);
  });
  game.on('caltropStep', (r) => {
    if (unseen(r.unit)) { if (!r.success) hud.log('Someone yelps on the caltrops in the dark.', 'sys'); } else hud.logCaltropStep(r);
  });
  game.on('aflame', (r) => { // burning at the end of its turn (the save comes after)
    if (unseen(r.unit)) return;
    hud.logAflame(r);
    sfx.fireImpact();
    floatText(stage.scene, r.unit, `Burns −${r.damage}`, 'crit');
    anim.damageReaction(r.unit);
  });
  game.on('grapple', (r) => hud.logGrapple(r));
  game.on('struggle', (r) => { if (!unseen(r.unit)) hud.logStruggle(r); });
  game.on('grappleEnd', (r) => {
    if (!unseen(r.unit)) hud.logGrappleEnd(r);
    view(r.unit)?.updateStatus();
  });
  game.on('stench', (r) => {
    hud.logStench(r);
    floatText(stage.scene, r.target, r.rider.success ? 'Resists the stench' : 'Gagging!', r.rider.success ? 'miss' : 'cond');
    view(r.target)?.updateStatus();
  });
  game.on('condition', (r) => {
    if (!unseen(r.unit)) hud.logCondition(r);
    if ((r.name === 'burning' || r.name === 'engulfed') && !r.on) view(r.unit)?.updateStatus(); // ended between turns
  });
  game.on('trapFound', (r) => pendingReveals.push(r));
  game.on('alert', (r) => pendingAlerts.push(r));
  game.on('revealed', (r) => pendingSpotted.push(r));
  // Rules 9: the gong, those who answer it, the fanatic's skeletons, the owl, secret doors and the prisoner.
  game.on('gong', (r) => {
    hud.logGong(r);
    sfx.gong();
    stage.shake(0.15, 500);
    board.strikeGong();
    floatText(stage.scene, { x: r.x, z: r.z - 0.5 }, 'GONG!', 'warn');
    keepAwake(1000);
  });
  game.on('arrive', (r) => {
    hud.logArrive(r);
    if (r.why === 'hold') sfx.raise();
    for (const u of r.units) {
      if (inView(u)) raiseFx(stage.scene, u);
      addView(u).rise();
    }
    hud.renderInitiative(game);
  });
  game.on('summon', (r) => {
    if (unseen(r.unit)) hud.log('Someone chants in the dark.', 'sys');
    else hud.logSummon(r);
    sfx.raise();
    if (inView(r.spawn)) raiseFx(stage.scene, r.spawn);
    addView(r.spawn).rise();
    hud.renderInitiative(game);
  });
  game.on('crumble', (r) => {
    hud.logCrumble(r);
    for (const u of r.called) wait(300).then(() => view(u)?.die());
  });
  game.on('owl', (r) => hud.logOwl(r));
  game.on('owlSwat', (r) => {
    hud.logOwlSwat(r);
    if (!r.hit) return;
    owls.get(r.master.id)?.vanish();
    owls.delete(r.master.id);
    floatText(stage.scene, { x: r.master.familiar.x, z: r.master.familiar.z - 0.5 }, 'Owl lost!', 'crit');
  });
  game.on('secret', (r) => {
    hud.logSecret(r);
    board.revealSecret(r.x, r.z);
    sfx.discover();
    floatText(stage.scene, { x: r.x, z: r.z - 0.5 }, 'Secret door!', 'spell');
  });
  game.on('captive', (r) => {
    hud.logCaptive(r);
    if (r.kind !== 'lost') return; // a freeing plays out in playFree (animate.js)
    board.removeProp(r.x, r.z);
    floatText(stage.scene, { x: r.x, z: r.z - 0.5 }, 'Dragged off!', 'crit');
  });
  // Rules 10: lair actions, climbing out of pits, Counterspell and Fog Cloud lifting.
  game.on('lair', (r) => {
    hud.logLair(r);
    const at = r.unit;
    board.lairShake(); // the torches gutter and dust comes down
    if (r.kind !== 'quake') stage.shake(0.12, 500);
    if (r.kind === 'hands') {
      sfx.necro();
      for (const s of r.saves) {
        floatText(stage.scene, s.unit, s.success ? 'Breaks free' : 'Grasped!', s.success ? 'miss' : 'cond');
        wait(50).then(() => view(s.unit)?.updateStatus());
      }
    } else if (r.kind === 'sandstorm') {
      sfx.whoosh(true);
      if (inView(at)) floatText(stage.scene, { x: at.x, z: at.z - 0.5 }, 'Sandstorm!', 'warn');
    } else {
      sfx.fall();
      stage.shake(0.3, 600);
      for (const s of r.saves) {
        floatText(stage.scene, s.unit, s.success ? 'Keeps footing' : 'Knocked prone!', s.success ? 'miss' : 'cond');
        wait(50).then(() => view(s.unit)?.updateStatus());
      }
    }
    keepAwake(800);
  });
  game.on('climb', (r) => {
    if (unseen(r.unit)) return;
    hud.logClimb(r);
    floatText(stage.scene, r.unit, r.success ? 'Climbs out' : 'Still in the pit', r.success ? 'spell' : 'miss');
    wait(50).then(() => view(r.unit)?.updateStatus());
  });
  game.on('counterspell', (r) => hud.logCounterspell(r));
  game.on('slip', (r) => { if (!unseen(r.unit)) hud.logSlip(r); });
  game.on('caveIn', (r) => hud.logCaveIn(r));
  game.on('fog', (r) => {
    board.setFog(r.tiles);
    hud.log('The fog cloud thins away.', 'sys');
  });
  // A hold-out is won as a round begins, not on anyone's move.
  game.on('gameOver', (r) => {
    if (!r.held) return;
    hud.log(`The heroes held out to the end of round ${game.hold.rounds}!`, 'sys');
    const g = game;
    Promise.resolve().then(() => { if (game === g) checkGameOver(); });
  });

  frameParty();
  if (!resume) {
    if (game.hold) hud.log(`<b>Hold out</b> until the end of round ${game.hold.rounds}: the dead will keep coming.`, 'sys');
    if (game.captive) hud.log(`A <b>prisoner</b> is chained here. Free them (stand beside them: More → Free prisoner) before round ${game.captive.until + 1}, or they’re dragged off.`, 'sys');
    game.start();
    saveFight();
  } else if (game.over) {
    checkGameOver(); // saved on the victory banner
  } else {
    onTurnStart(game.current);
  }
}

/** Replay a saved fight on the new `game`. False if it didn't land where it was saved. */
function replaySaved(saved) {
  try {
    const r = replayFight(game, saved.log);
    if (!r.ok || (!saved.coop && r.check !== saved.check)) return false; // a co-op log has no check
    if (fight) {
      fight.log = [...saved.log];
      fight.check = saved.check;
    }
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
  return game && !replay && !game.over && !camp.open && game.current?.team === 'heroes' && (!coop || coopMine(game.current));
}

/** The dungeon without anyone in it, behind the title screen. */
function showBackdrop() {
  board = new Board(new Grid(LEVELS[0].rows), stage);
  stage.setMood(moodFor(LEVELS[0].id));
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
    const who = `<span class="${unit.team}" data-unit="${unit.id}">${unit.name}</span>`;
    if (cause === 'spotted' || cause === 'searched') {
      floatText(stage.scene, unit, cause === 'searched' ? 'Found!' : 'Spotted!', unit.team === 'heroes' ? 'warn' : 'spell');
      const finder = by && !unseen(by) ? `<span class="${by.team}" data-unit="${by.id}">${by.name}</span>` : 'Something';
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
    hud.log(`<span class="monsters" data-unit="${unit.id}">${unit.name}</span> ${text}`, 'sys');
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
  setPeek(null); // a new turn's view starts from here
  for (const v of views.values()) v.setActive(v.unit === unit);
  if (!unseen(unit)) keepInView(unit);
  selected = null;
  controls.disarm();
  if (!unseen(unit)) announce(`${unit.name}’s turn${unit.team === 'heroes' ? '' : ' (enemy)'}`);
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
    if (unit.team === 'heroes') {
      hud.beginTurn(unit, () => false, true);
      await replayHeroTurn(unit);
    }
    else await runMonsterTurn(unit);
    return;
  }
  if (unit.team === 'heroes') hud.beginTurn(unit, () => false, true); // open while they act
  if (coop && unit.team === 'heroes') {
    await null; // the command that ended the last turn has its place in the log now (command)
    if (game?.current !== unit) return;
    coop.turn = { unit, since: Date.now() };
    // A friend's hero, or commands for ours already in (sent for it while this device lagged).
    const remote = !coopMine(unit) || coop.link.log.length > coop.at;
    const loop = remote ? coopRemoteTurn(unit) : null; // marks the turn as played from the relay
    coopTick(); // so its own check doesn't start a second loop
    if (loop && !await loop) return;
  }
  if (unit.team === 'heroes') {
    sfx.turn();
    voices.bark(unit, 'turn'); // now and then
    saveFight(); // with the rooms seen so far
    if (game.has(unit, 'petrified')) hud.toast(`${unit.name} is stone: no move or action this turn.`);
    if (game.has(unit, 'paralyzed')) hud.toast(`${unit.name} is paralysed: no move or action this turn (a CON save next turn may end it).`);
    if (!debugAutoplay) {
      const chestInSight = [...game.grid.chests.keys()].some((k) => visible.has(k));
      const near = (t) => Math.max(Math.abs(t.x - unit.x), Math.abs(t.z - unit.z)) <= 1;
      const foes = game.enemiesOf(unit);
      tips.notice('heroTurn', {
        unit, chestInSight, touch: controls.touching,
        brazierNext: [...game.grid.props.values()].some((p) => p.kind === 'brazier' && !p.tipped && near(p)),
        leverNext: [...game.grid.props.values()].some((p) => p.kind === 'lever' && near(p)),
        waterInSight: [...game.grid.water].some((k) => visible.has(k)),
        chasmInSight: [...game.grid.chasms].some((k) => visible.has(k)),
        stairsInSight: [...game.grid.links.keys()].some((k) => visible.has(k)),
        cracksInSight: [...game.grid.cracks.keys()].some((k) => visible.has(k)),
        darkNear: [...game.dark].some((k) => visible.has(k)),
        edgeFoe: foes.find((f) => !unseen(f) && near(f) && !game.shoveProblem(unit, f, true) && game.pushTo(unit, f).fall),
        foeNext: foes.some((f) => !unseen(f) && near(f)),
        // Foes on the hunt but none in sight: a moment to Ready.
        foesComing: foes.length > 0 && foes.every((f) => unseen(f)) && foes.some((f) => !f.unaware),
        hurtAllyNext: game.alliesOf(unit).some((a) => near(a) && a.hp * 2 <= a.maxHp),
        dyingAlly: game.units.find((a) => a.team === 'heroes' && a.dying && !unseen(a)),
        paralysed: [unit, ...game.alliesOf(unit)].find((a) => game.has(a, 'paralyzed')),
        petrified: [unit, ...game.alliesOf(unit)].find((a) => game.has(a, 'petrified')),
        rules: game.rules,
      });
    }
  }
  if (unit.team === 'monsters' || debugAutoplay) await runMonsterTurn(unit);
}

// --- threat zones: where the monsters in sight could strike next turn ------------------
const threats = createThreats({
  game: () => game, board: () => board, unseen, showing: () => isHeroTurn() && !busy, refresh,
});
const drawThreats = () => threats.draw();

// --- hover previews: the path, the odds, the blast (see preview.js) --------------------
const preview = createPreview({
  hud, unseen, isHeroTurn, threats,
  game: () => game, board: () => board, hovered: () => hovered, selected: () => selected,
  busy: () => busy, touching: () => controls.touching, view: (u) => view(u),
});
/** Redraw the highlights and the hint for the current hero, selection and hovered tile. */
function refresh() { preview.refresh(); }
/** The unit on a tile, unless it's a monster lurking out of sight. */
function visibleUnitAt(x, z) { return preview.visibleUnitAt(x, z); }
/** The unit (or corpse) a unit-targeted spell would hit on tile t. */
function spellTargetAt(t, s) { return preview.spellTargetAt(t, s); }

// --- a fight decided (results are animated in animate.js) -------------------------
/** Shows the end banner once the game is decided. Returns true if over. */
async function checkGameOver() {
  if (!game.over) return false;
  if (ended) return true;
  ended = true;
  tips.hide(); // a tip would sit on the end banner
  await wait(400);
  board.clearHighlights();
  hud.hint(''); // nor the preview's hint, while the last word is said
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
  const g = game;
  if (anim.lastWords(game.over)) await wait(1400); // the last word, before the banner
  if (game !== g) return true;
  // A co-op fight leaves nothing behind on this device but the bestiary's blows.
  const none = () => {};
  const store = coop ? { writeSave: none, clearSave: none, setWonRun: none, clearEndless: none } : { writeSave, clearSave, setWonRun, clearEndless };
  const end = settleFight({ game, nodeId, campaign, record, daily, challenge, saving, feats, store });
  campaign = end.campaign;
  hud.renderActionBar(game, { selected: null, busy: false });
  if (game.over === 'victory') {
    sfx.victory();
    if (end.final) bannerSkull('laugh');
    if (!end.final) {
      board.lightStairs();
      setTimeout(() => sfx.stairs(), 900);
    }
  } else {
    sfx.defeat();
    bannerSkull('chatter');
  }
  hud.banner(game.over, end.banner);
  if (coop) coopBanner();
  if (end.banner.ease) track('ease-offered', { room: nodeId, difficulty: campaign.difficulty });
  return true;
}

// --- turns ------------------------------------------------------------------
/**
 * While the game is out of sight (another tab or app, a locked screen) or in photo mode,
 * monsters wait to take their turn, and their next step, until it's back, so the player sees
 * what they do. Null (no wait) while it shows.
 */
function whileAway() {
  const away = () => document.hidden || photo.active;
  if (!away()) return null;
  return new Promise((resolve) => {
    const back = () => {
      if (away()) return;
      document.removeEventListener('visibilitychange', back);
      setTimeout(resolve, 400); // a moment to take in the board first
    };
    document.addEventListener('visibilitychange', back);
    photo.onLeave(back);
  });
}

/**
 * Where each foe out of sight was last heard (unit id -> tile): an aware monster that moves or
 * strikes where no hero can see it leaves rings on its tile, until it's seen or it dies.
 * Drawn only: the rules never hear of it.
 */
const heard = new Map();
function drawHeard() {
  board?.heard.set([...heard.values()]);
  keepAwake(100);
}

async function runMonsterTurn(unit) {
  const g = game; // a restart or level change mid-turn abandons this turn
  busy = true;
  refresh();
  // The monster-turn speed setting: everything plays faster until the turn is over.
  playback.rate = replay ? replayRate() : unit.team === 'monsters' ? SPEEDS[settings.speed] : 1;
  try {
    // Monsters out of sight act quickly: nothing to watch.
    const pace = (ms) => wait(unit.team === 'monsters' && (unseen(unit) || unit.unaware) ? ms / 4 : ms);
    await whileAway();
    if (game !== g) return;
    await pace(450);

    if (unit.team === 'monsters') hud.beginTurn(unit, () => unseen(unit));
    let acted = false;
    for (const { step, result } of monsterTurn(g, unit)) {
      if (result.ok) hud.turnNote(stepNote(step));
      if (result.ok && step.type !== 'end') acted = true;
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
      await whileAway();
      if (game !== g) return;
    }

    if (acted && unit.team === 'monsters' && unit.alive && unseen(unit)) {
      heard.set(unit.id, tileOf(view(unit)));
      drawHeard();
    }
    if (game !== g || await checkGameOver()) return;
    await pace(300);
    if (game !== g) return;
  } finally {
    playback.rate = replay ? replayRate() : 1;
    hud.endTurn();
  }
  busy = false;
  game.endTurn();
}

const STEP_VERBS = { dash: 'dashes', dodge: 'dodges', disengage: 'disengages', hide: 'hides', nimbleHide: 'hides',
  nimbleEscape: 'slips away', search: 'searches', aggressive: 'charges', potion: 'drinks a potion', ready: 'readies' };

/** What a step (a monster's, or a hero's command) adds to its turn's line in the log (attacks add their own). */
function stepNote(step) {
  if (step.type === 'move') return 'moves';
  if (step.type === 'shove') return step.push ? 'pushes' : 'shoves';
  if (step.type === 'help') return 'helps';
  if (step.type === 'grapple') return 'grapples';
  if (step.type === 'feed') return step.thrown ? 'tosses a potion' : 'gives a potion';
  if (step.type === 'flask') return 'throws alchemist’s fire';
  if (step.type === 'caltrops') return 'spreads caltrops';
  if (step.type === 'torch') return step.spell ? 'casts Light' : 'throws a torch';
  if (step.type === 'smash') return 'smashes cover';
  if (step.type === 'bar') return 'bars a door';
  if (step.type === 'disarm') return 'works at a trap';
  if (step.type === 'chest') return 'opens a chest';
  if (step.type === 'brazier') return 'tips a brazier';
  if (step.type === 'lever') return 'pulls the lever';
  if (step.type === 'owl') return 'sends the owl';
  if (step.type === 'free') return 'frees the prisoner';
  if (step.type === 'spell') return `casts ${SPELLS[step.id]?.name ?? 'a spell'}`;
  if (step.type === 'action' || step.type === 'bonus') return STEP_VERBS[step.id] ?? ACTIONS[step.id]?.name.toLowerCase() ?? null;
  return null;
}

// A name in the combat log: hovering marks its figure's tile, clicking looks at it.
let spotTimer = 0;
hud.onLogName = (id, how) => {
  clearTimeout(spotTimer);
  const u = game?.units.find((x) => x.id === id);
  const shown = u?.alive && !unseen(u) && !hud.unknown?.(u);
  board?.spot.set(how !== 'leave' && shown ? [u] : []);
  keepAwake(100);
  if (how !== 'go' || !shown) return;
  lookAt(u.x, u.z, stage.camera.zoom);
  spotTimer = setTimeout(() => {
    board?.spot.clear();
    keepAwake(100);
  }, 1500);
};

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
  track('replay-watched', { from: link ? 'link' : fromTitle ? 'title' : 'banner', room: rec.node });
  $banner.hidden = true;
  tips.hide(); // nothing to do while watching
  document.body.classList.add('replaying');
  $replayBar.hidden = false;
  if (kitLoaded) return void startFight(null, rec);
  // From the title before the dungeon tiles are in (a #watch= link, say): wait for them.
  $loading.hidden = false;
  kit.then(() => {
    $loading.hidden = true;
    if (replay?.rec === rec && !game) startFight(null, rec);
  });
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

const links = createLinks({ hud, touch: () => controls.touching, watch: watchFromTitle, play: startChallenge, idle: () => !replay && !game });

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
    hud.turnNote(stepNote(cmd));
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

// --- co-op online (Play together): each device plays the fight from the relay's order ------
// Our own heroes' commands apply here at once and go to the relay with their place in the log
// (`command`); a friend's are played from the relay as they come (`coopRemoteTurn`), like a
// replay. If the relay refuses one of ours (someone was quicker, a takeover), this device
// rebuilds the fight from the relay's log. See src/coop.js and worker/src/room.js.
const TURN_MS = 90_000; // a hero's turn, then it ends on its own
const TAKEOVER_MS = 15_000; // a player gone this long: the host plays their heroes
const GRACE_MS = 45_000; // past the turn's time: a friend ends it for a player whose device stalled
// (wide, as each device starts the clock when it gets there: monster turns play at each one's speed)

const lobby = new CoopLobby({
  onFight: (link, room) => startCoop(link, room),
  onLobby: () => {
    coop = null; // keep the room: back to its lobby, the title behind it
    backToTitle();
  },
  onRoom: (link, room) => coopRoom(link, room),
  onLeave: () => { if (coop) backToTitle(); },
  onStatus: () => coopTick(),
  onStale: (link, msg) => coopStale(msg),
});
lobby.bar.addEventListener('click', () => lobby.show(lobby.bar));

/** Is hero `u` played on this device (its seat is ours and the room is reachable)? */
function coopMine(u) {
  return coop.link.status === 'open' && coop.link.seat(u.slot) === coop.link.you;
}

/** The host started a fight (or one was running when we joined): everyone plays it from its seed. */
function startCoop(link, room) {
  const f = room.fight;
  if ((f.rules ?? 1) > RULES || !levelOf(f.node)) {
    hud.toast('The host has a newer version of the game: reload this page to play with them.');
    lobby.show(null);
    return;
  }
  if (replay) endReplay();
  sfx.ui();
  camp.hide();
  $banner.hidden = true;
  saving = false;
  daily = null;
  challenge = null;
  campaign = partyAt(newCampaign(f.difficulty, {}, f.classes ?? {}), f.level);
  nodeId = f.node;
  coop = { link, game: room.game, fight: f, log: [], checks: [], at: 0, turn: null, remote: null, gone: new Map(), sent: 0, forced: -1 };
  coopRoom(link, room);
  newGame(link.log.length ? coopResume() : null);
}

/** The fight as the relay has it, to replay: the seed and every command so far. */
function coopResume() {
  const log = [...coop.link.log];
  coop.log = [...log];
  coop.checks = [];
  coop.at = log.length;
  coop.remote = null;
  return { seed: coop.fight.seed, rules: coop.fight.rules ?? 1, log, coop: true, explored: board && game ? [...board.explored] : [], seen: [] };
}

/** Out of step with the relay: start the fight again from its log (drawn as a restored fight). */
function coopRebuild() {
  if (!coop) return;
  coop.rebuilds = (coop.rebuilds ?? 0) + 1;
  hud.toast('A friend’s move came first: the fight catches up.');
  newGame(coopResume());
  coop.link.send({ t: 'ready' }); // the relay takes our commands again
}

/** Have we applied anything the relay doesn't have (in that place)? */
function coopAhead() {
  const theirs = coop.link.log;
  return coop.log.length > theirs.length || coop.log.some((c, i) => JSON.stringify(c) !== JSON.stringify(theirs[i]));
}

/** The relay refused a command of ours. */
function coopStale(msg) {
  if (!coop || msg.g !== coop.game) return;
  if (coop.link.log.length < msg.at) return coop.link.resync(); // missed some: a fresh sync
  if (coopAhead()) coopRebuild();
  else coop.link.send({ t: 'ready' }); // a forced end that lost a race: nothing to undo here
}

/** The room changed: who's here (for takeovers), and after a reconnect, whether we're in step. */
function coopRoom(link, room) {
  if (!coop || room.game !== coop.game) return;
  const now = Date.now();
  for (const p of room.players) {
    if (p.on) coop.gone.delete(p.id);
    else if (!coop.gone.has(p.id)) coop.gone.set(p.id, now);
  }
  if (room.t === 'sync' && game && coopAhead()) coopRebuild();
  coopTick();
}

/**
 * A hero's turn played from the relay: a friend's, or commands for ours that came in before this
 * device got here. True if the turn is ours to play now (the commands ran out, or it was handed
 * to us), false once it's over.
 */
async function coopRemoteTurn(unit) {
  const g = game;
  const c = coop;
  if (c.remote === unit) return false; // already being played
  c.remote = unit;
  busy = true;
  refresh();
  try {
    while (game === g && coop === c && game.current === unit && !game.over) {
      const cmd = await c.link.next(c.game, c.at, () => coopMine(unit) && c.link.log.length <= c.at);
      if (game !== g || coop !== c || game.current !== unit) return false;
      if (!cmd) {
        if (!coopMine(unit)) return false; // the room was left or the fight ended
        busy = false;
        refresh();
        return true;
      }
      c.log.push(cmd);
      c.at++;
      record?.log.push(cmd);
      if (cmd.type === 'end') busy = false; // the next turn starts inside applyCommand
      const r = applyCommand(game, cmd);
      if (!r?.ok) {
        coopRebuild();
        return false;
      }
      c.checks[c.at - 1] = fightCheck(game);
      if (cmd.type === 'end') return false;
      hud.turnNote(stepNote(cmd));
      try {
        await play(unit, cmd.type, r);
      } catch (err) {
        if (game === g) console.error(err);
      }
      hud.releaseLog();
      if (game !== g) return false;
      syncStatus();
      if (await checkGameOver()) return false;
      if (!unit.alive) {
        await wait(500);
        if (game !== g) return false;
        busy = false;
        heroFell(game, unit);
        return false;
      }
      refresh();
    }
    return false;
  } finally {
    if (c.remote === unit) c.remote = null;
  }
}

/** Once a second in co-op: the line over the fight, the turn timer, the host's takeovers. */
function coopTick() {
  if (!coop) return lobby.status(null);
  const { link } = coop;
  const now = Date.now();
  // The host plays the heroes of anyone gone a while (they're handed back from the lobby).
  if (link.host && link.status === 'open' && now - coop.sent > 3000) {
    const seats = {};
    for (const s of HERO_SLOTS) {
      const who = link.seat(s);
      if (who !== link.you && !link.isOn(who) && now - (coop.gone.get(who) ?? now) > TAKEOVER_MS) seats[s] = link.you;
    }
    if (Object.keys(seats).length) {
      coop.sent = now;
      link.send({ t: 'seats', seats });
      hud.toast('A player dropped out: you play their heroes until they’re back.');
    }
  }
  const u = game?.current;
  // A hero's turn that went elsewhere (handed away, or played for us while we were gone): play
  // it from the relay. And one handed to us mid-turn is ours once the relay's commands run out.
  if (u?.team === 'heroes' && link.status === 'open' && !game.over && !replay && !coop.remote && !busy
    && (!coopMine(u) || link.log.length > coop.at)) coopRemoteTurn(u);
  let text;
  if (link.status !== 'open') text = 'Connection lost: trying again…';
  else if (!game || game.over) text = `Room ${link.code}`;
  else if (u?.team !== 'heroes') text = 'The monsters’ turn';
  else {
    const who = link.seat(u.slot);
    const since = coop.turn?.unit === u ? coop.turn.since : now;
    const left = Math.max(0, TURN_MS - (now - since));
    const secs = Math.ceil(left / 1000);
    const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const mine = who === link.you;
    text = `${u.name}: ${mine ? 'your turn' : `${link.playerName(who)}’s turn${link.isOn(who) ? '' : ' (away)'}`} · ${clock}`;
    if (mine && !left && isHeroTurn() && !busy) {
      hud.toast(`Time’s up: ${u.name}’s turn ends.`);
      endHeroTurn();
    } else if (!mine && now - since > TURN_MS + GRACE_MS && coop.remote === u
      && link.log.length === coop.at && coop.forced !== coop.at) {
      // Their device stalled (or they walked off mid-throw): any friend ends the turn for them.
      // The relay takes the first; the others are refused and carry on (coopStale).
      coop.forced = coop.at;
      link.command({ type: 'end' }, coop.at);
    }
  }
  lobby.status(text);
}
setInterval(coopTick, 1000);

/** The end banner in co-op: the host plays again or goes back to the lobby; the others can leave. */
function coopBanner() {
  const host = coop.link.host;
  for (const id of ['next', 'ease', 'watch', 'ngplus']) document.getElementById(id).hidden = true;
  const again = document.getElementById('restart');
  again.hidden = !host;
  again.textContent = 'Play again';
  const out = document.getElementById('to-map');
  out.hidden = false;
  out.textContent = host ? 'Back to the lobby' : 'Leave the room';
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
  hud.turnNote(stepNote(cmd));
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
  if (r.undo && !coop) { // not in co-op: the friends have seen it
    await new Promise(requestAnimationFrame);
    if (game !== g) return r;
    if (board.explored.size === known.explored && seenIds.size === known.seen && game.current === u) setUndo({ undo: r.undo, unit: u });
  }
  busy = false;
  refresh();
  if (game.current === u && !game.over && cmd.type !== 'end') tips.notice('acted', { unit: u, cmd, touch: controls.touching });
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
  hud.log(`<span class="heroes" data-unit="${unit.id}">${unit.name}</span> takes the move back.`, 'sys');
  busy = false;
  refresh();
}

/** Resolve a command and add it to the fight's save. */
function command(cmd) {
  setUndo(null); // anything else the hero does settles the move before it
  const r = applyCommand(game, cmd);
  if (r.ok) record?.log.push(cmd);
  if (r.ok && coop) { // to the relay, for its place in the shared log
    coop.log.push(cmd);
    coop.checks[coop.at] = fightCheck(game); // where it left the fight, to compare devices (tests)
    coop.link.command(cmd, coop.at++);
  }
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
  if (choice.kind === 'readyAttack') { // Ready, then the attack to hold
    selected = null;
    heroCommand({ type: 'action', id: 'ready', attack: choice.attack });
    return;
  }
  if (choice.kind === 'readySpell') { // or a spell, its slot spent now
    selected = null;
    heroCommand({ type: 'action', id: 'ready', spell: choice.id });
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
    heroCommand({ type: 'spell', id: choice.id, ...(choice.scroll && { scroll: choice.scroll }) });
    return;
  }
  const same = selected?.kind === choice.kind
    && (choice.kind === 'attack' ? selected.attack === choice.attack : selected.id === choice.id && selected.scroll === choice.scroll);
  selected = same ? null : choice;
  controls.disarm();
  if (controls.touching) hovered = null; // aim afresh: a tap from before must not cast at once
  refresh();
}

// --- input ----------------------------------------------------------------
// Mouse, touch and keyboard (see controls.js).
const controls = createControls({
  stage, hud, threats, helpBox, camp,
  game: () => game, board: () => board, views: () => views, busy: () => busy, replay: () => replay,
  hovered: () => hovered, setHovered: (t) => { hovered = t; },
  selected: () => selected, setSelected: (s) => { selected = s; },
  isHeroTurn, refresh, heroCommand, endHeroTurn, undoMove, endReplay, keepInView, peekFloor,
  toggleSound, toggleMusic, visibleUnitAt, spellTargetAt, photo: () => photo.active,
});
// A gamepad drives the same cursor and keys, and moves focus in the menus (gamepad.js).
createGamepad({ hud, hovered: () => hovered, onBoard: () => !!game && !!board && !camp.open });
// Photo mode (P): no HUD, a free camera and Save image. Monster turns wait for it (whileAway).
const photo = createPhotoMode(stage, {
  canEnter: () => !!game && !!board && !camp.open && document.getElementById('title').hidden,
  board: () => board,
  views: () => views,
  focus: () => { // the figure whose turn it is, if it can be seen (a hidden one stays hidden)
    const c = game?.current;
    return c?.alive && visibleUnitAt(c.x, c.z) === c ? c : null;
  },
  touch: () => hud.touch,
});
/** ?victory: the won-campaign screen for a made-up run (see debug.js). Nothing is saved or recorded. */
function showSampleVictory() {
  saving = false;
  hud.banner(...sampleVictory(location.search));
  bannerSkull('laugh');
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
// The title is plain HTML over a backdrop room, so it shows as soon as the code is here; the
// dungeon tiles (~600 kB) follow, the backdrop is rebuilt from them, and fights wait for
// them (see newGame and startReplay). Only ?level= waits behind the boot screen.
let kitLoaded = false;
const kit = preloadDungeon(bootProgress).then(() => { kitLoaded = true; });
// The stand-in blocks stay hidden (#stage starts .veiled in index.html), so the crypt fades in
// once, finished.
showBackdrop();
kit.then(() => {
  if (!game) {
    stage.scene.remove(board.group);
    board.dispose();
    showBackdrop();
  }
  requestAnimationFrame(() => document.getElementById('stage').classList.remove('veiled'));
});
const levelParam = Number(new URLSearchParams(location.search).get('level'));
if (levelParam >= 1 && levelParam <= LEVELS.length) {
  kit.then(() => {
    saving = false;
    const q = new URLSearchParams(location.search);
    const d = q.get('difficulty'); // e.g. &difficulty=hard
    campaign = partyAt(newCampaign(DIFFICULTIES[d] ? d : 'normal', {}, { ...(q.has('paladin') && { F: 'P' }), ...(q.has('warlock') && { W: 'K' }), ...(q.has('ranger') && { R: 'A' }), ...(q.has('bard') && { C: 'B' }), ...(q.has('barbarian') && { F: 'Z' }), ...(q.has('sorcerer') && { W: 'S' }), ...(q.has('monk') && { R: 'M' }), ...(q.has('druid') && { C: 'D' }) }), Number(q.get('party')));
    campaign.tier = Math.max(0, Math.min(99, Math.floor(Number(q.get('tier')) || 0))); // &tier=2: New Game+
    campaign.relics = cleanRelics((q.get('relics') ?? '').split(',')); // &relics=veil,horn
    nodeId = LEVELS[levelParam - 1].id;
    newGame();
    loadModels(roomFiles(nodeId, campaign.party)).then(() => loadModels(allFiles())); // this room first
    hideBoot();
  });
} else {
  if (new URLSearchParams(location.search).has('victory')) {
    showSampleVictory();
  } else {
    const save = loadSave(); // the title is up already (boot.js)
    links.open(location.hash); // a #watch= replay or #play= challenge
    const room = location.hash.match(/^#coop=([A-Za-z0-9]{6})$/)?.[1]; // an invite to a co-op room
    if (room) {
      history.replaceState(null, '', location.pathname + location.search);
      lobby.show(null, room.toUpperCase());
    }
    // While the title is up, once its skull is in (at most 6 s: on mobile data the two would
    // share the line and the skull would come last): the figures for the room the player is
    // most likely to enter next (the saved fight, the rooms open from the saved camp, or the
    // first room), then every other model. A fight started sooner asks for its own at once.
    let next = [START_NODE];
    if (save?.fight) next = [save.fight.node];
    else if (save) next = choices(save).filter((id) => NODES[id].kind === 'fight');
    const first = [...new Set(next.flatMap((id) => roomFiles(id, save?.party ?? null)))];
    Promise.race([titleLogoUp, new Promise((r) => setTimeout(r, 6000))])
      .then(() => loadModels(first)).then(() => loadModels(allFiles())).then(() => saveLoaded(true)); // all in: keep them offline
  }
  hideBoot();
}

// Handy for debugging in the console (see debug.js).
installDebug({
  game: () => game,
  board: () => board,
  threatState: () => ({ on: threats.on, focus: threats.focus }),
  views: () => views,
  stage,
  sfx,
  campaign: () => campaign,
  coop: () => coop,
  lobby: () => lobby,
  busy: () => busy,
  fightCheck: () => game && fightCheck(game),
  command: (cmd) => heroCommand(cmd),
  reveal() {
    revealed = true;
    updateVision(true);
  },
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
    daily = null; // a test fight isn't a try at the daily or a linked fight
    challenge = null;
    saving = false;
    campaign = newCampaign();
    // A number is a campaign room in order; a string is any room id, an Endless floor too ('deep:3:4:3').
    nodeId = typeof n === 'string' && levelOf(n) ? n : LEVELS[Math.min(LEVELS.length, Math.max(1, Number(n) || 1)) - 1].id;
    newGame();
  },
  damageReaction,
  checkGameOver,
  lookAt,
});
