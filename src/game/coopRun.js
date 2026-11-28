// A whole campaign run played together (Play together's "A whole run"). The relay keeps one log
// for the run: the heroes' fight commands and, between fights, camp steps ({ type: 'camp', act }).
// Every device applies the same log, so every device has the same run: the camp steps go through
// the same rules as a run played alone (campaign.js, story.js, shop.js), and each fight's dice
// come from the run's seed and the fight's number. `CoopRun` holds the run as the log has built
// it; `rebuildRun` builds it from a whole log (joining, reconnecting), playing its finished fights
// without drawing them. main.js plays the fight in progress itself.
//
// Two players may click at once, so the log can hold a step that no longer fits when its turn
// comes (the last potion bought twice, gear handed out as a fight began): every device skips it,
// the same way. So does a hero's command that lands after its fight was decided.

import { Game } from './combat.js';
import { seeded } from './dice.js';
import { levelOf } from './endless.js';
import {
  NODES, newCampaign, choices, completeFight, recordDefeat, easeOffer, easeRun, takeRest, takeEvent, eventProblem,
  equip, equipProblem, unequip, chooseStyle, choosePick, settlePicks, runDifficulty, fightRelics, HERO_CODES,
} from './campaign.js';
import { pendingScene, sceneProblem, takeScene } from './story.js';
import { buy, buyProblem, sell, sellPrice, canTrade } from './shop.js';
import { build, buildProblem } from './town.js';
import { replayFight } from './replay.js';

/** Fight number `n`'s dice in a run that began from `seed`. */
export function fightSeed(seed, n) {
  let h = (seed ^ Math.imul(n + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Is this log entry a camp step (else it's a hero's fight command)? */
export const isCampStep = (cmd) => cmd?.type === 'camp' && Array.isArray(cmd.act);

/**
 * The steps everyone agrees on (by vote, then sent by the host), as opposed to a player's own
 * (gear, picks and styles for the heroes they play, and trades).
 */
export const GROUP_ACTS = ['enter', 'scene', 'event', 'rest', 'next', 'retry', 'ease', 'camp', 'town'];

/** The camp's `data-enter` value ("warren", "altar:offer", "scene:gravedigger:take") as a step. */
export function enterAct(state, id) {
  if (id.startsWith('scene:')) {
    const [, scene, opt] = id.split(':');
    return ['scene', scene, opt];
  }
  if (id.includes(':')) {
    const [node, opt] = id.split(':');
    return ['event', node, opt];
  }
  return NODES[id]?.kind === 'rest' ? ['rest', id] : ['enter', id];
}

/** A step's vote key (the same step, the same key). */
export const voteKey = (act) => act.join(':');

/** A vote key back to its step, or null. */
export function keyAct(key) {
  if (typeof key !== 'string' || key.length > 80) return null;
  const act = key.split(':');
  return GROUP_ACTS.includes(act[0]) ? act : null;
}

export class CoopRun {
  /** `spec`: the room's fight, { run: true, difficulty, classes, seed, rules }. */
  constructor(spec) {
    this.spec = spec;
    this.rules = spec.rules ?? 1;
    this.state = newCampaign(spec.difficulty, {}, spec.classes ?? {});
    /** 'camp', 'fight' (one in progress), 'after' (one decided, waiting for the next step) or 'done'. */
    this.phase = 'camp';
    this.n = 0; // fights begun
    this.fight = null; // { node, seed, n } while in a fight or after one
    this.game = null; // that fight's Game (main.js's, or one played here)
    this.cmds = []; // its commands, as rebuildRun found them (main.js keeps its own while playing)
  }

  /** The Game for the fight about to start, as main.js builds it (startFight). */
  newGame() {
    const s = this.state;
    return new Game(levelOf(this.fight.node), {
      party: s.party, difficulty: runDifficulty(s.difficulty, s.tier ?? 0), rng: seeded(this.fight.seed), relics: fightRelics(s), rules: this.rules,
    });
  }

  /** The fight is decided (`game.over`): a lost one counts toward the run. */
  fightOver(game) {
    this.game = game;
    if (game.over === 'defeat') this.state = recordDefeat(this.state, game, this.fight.node);
    this.phase = 'after';
  }

  /** Why step `act` can't be taken now, or null. */
  problem(act) {
    if (!Array.isArray(act) || !act.length) return 'No such step';
    const s = this.state;
    const [kind, a, b] = act;
    const over = this.game?.over;
    switch (kind) {
      case 'enter':
        if (this.phase !== 'camp') return 'Not now';
        if (pendingScene(s)) return 'A scene waits for its answer';
        return NODES[a]?.kind === 'fight' && choices(s).includes(a) ? null : 'Not a way on';
      case 'rest':
        if (this.phase !== 'camp' || pendingScene(s)) return 'Not now';
        return NODES[a]?.kind === 'rest' && choices(s).includes(a) ? null : 'Not a way on';
      case 'event':
        if (this.phase !== 'camp' || pendingScene(s)) return 'Not now';
        return choices(s).includes(a) ? eventProblem(s, a, b) : 'Not a way on';
      case 'scene':
        return this.phase === 'camp' ? sceneProblem(s, a, b) : 'Not now';
      case 'next':
        return this.phase === 'after' && over === 'victory' ? null : 'Not now';
      case 'retry':
      case 'camp':
        return this.phase === 'after' && over === 'defeat' ? null : 'Not now';
      case 'ease':
        return this.phase === 'after' && over === 'defeat' && easeOffer(s, this.fight.node) ? null : 'Not now';
      case 'equip':
        if (this.phase !== 'camp') return 'Not now';
        return HERO_CODES.includes(b) && Number.isInteger(a) ? equipProblem(s, a, b) : 'No such hero';
      case 'unequip':
        if (this.phase !== 'camp') return 'Not now';
        return HERO_CODES.includes(a) && s.party[a].items[b] != null ? null : 'Nothing there';
      case 'pick':
      case 'style':
        return this.phase === 'camp' && HERO_CODES.includes(a) ? null : 'Not now';
      case 'buy':
        return this.phase === 'camp' ? buyProblem(s, a) : 'Not now';
      case 'sell':
        if (this.phase !== 'camp' || !canTrade(s)) return 'Not now';
        return sellPrice(s.pack[a], s) ? null : 'He won’t take that';
      case 'town':
        return this.phase === 'camp' ? buildProblem(s, a) : 'Not now';
      default:
        return 'No such step';
    }
  }

  /**
   * Take step `act`. Returns { ok: false, why } or { ok: true, report?, fight? }: `fight` when one
   * starts ({ node, seed, n }; main.js builds its Game from `state`), `report` for the camp.
   */
  step(act) {
    const why = this.problem(act);
    if (why) return { ok: false, why };
    const s = this.state;
    const [kind, a, b, c] = act;
    let report = null;
    switch (kind) {
      case 'enter':
        this.state = settlePicks(s);
        return this.begin(a);
      case 'rest':
        this.state = takeRest(s, a);
        report = { rest: a };
        break;
      case 'event':
        ({ state: this.state, report } = takeEvent(s, a, b));
        break;
      case 'scene':
        ({ state: this.state, report } = takeScene(s, a, b));
        break;
      case 'next': {
        ({ state: this.state, report } = completeFight(s, this.fight.node, this.game));
        if (this.state.done) {
          this.phase = 'done';
          return { ok: true, report, done: true };
        }
        break;
      }
      case 'ease':
        this.state = easeRun(s);
        return this.begin(this.fight.node);
      case 'retry':
        return this.begin(this.fight.node);
      case 'camp':
        break;
      case 'equip':
        this.state = equip(s, a, b);
        break;
      case 'unequip':
        this.state = unequip(s, a, b);
        break;
      case 'pick':
        this.state = choosePick(s, a, b, c);
        break;
      case 'style':
        this.state = chooseStyle(s, a, b);
        break;
      case 'buy':
        this.state = buy(s, a);
        break;
      case 'sell':
        this.state = sell(s, a);
        break;
      case 'town': // the village (town.js), by vote: it spends everyone's gold
        this.state = build(s, a);
        report = { built: a, stage: this.state.town[a] };
        break;
      default:
    }
    this.phase = 'camp';
    this.fight = null;
    this.game = null;
    return { ok: true, report };
  }

  /** Fight `node` begins: the next fight number's dice. */
  begin(node) {
    this.fight = { node, seed: fightSeed(this.spec.seed, this.n), n: this.n };
    this.n++;
    this.game = null;
    this.cmds = [];
    this.phase = 'fight';
    return { ok: true, fight: this.fight };
  }
}

/**
 * The run a whole log makes. Returns { ok, run } (a fight in progress or just decided: its
 * commands are `run.cmds`, its Game `run.game`) or { ok: false, at } where a command didn't apply.
 */
export function rebuildRun(spec, log) {
  const run = new CoopRun(spec);
  const settle = () => { // play the fight's commands so far
    const game = run.newGame();
    const r = replayFight(game, run.cmds);
    if (!r.ok && !game.over) return false; // (commands past its end are skipped)
    if (game.over) run.fightOver(game);
    else run.game = game;
    return true;
  };
  for (let i = 0; i < log.length; i++) {
    const cmd = log[i];
    if (!isCampStep(cmd)) {
      if (run.phase === 'fight') run.cmds.push(cmd);
      continue;
    }
    // A camp step during a fight counts once the fight is decided (else it came too late).
    if (run.phase === 'fight' && !settle()) return { ok: false, at: i };
    run.step(cmd.act);
  }
  if (run.phase === 'fight' && !settle()) return { ok: false, at: log.length };
  return { ok: true, run };
}
