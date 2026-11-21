// What a finished fight leaves behind: the bestiary's blows, the last fight kept for Past
// runs, achievements, a won or lost campaign, the daily and weekly results and their best
// fights, and what the end banner shows. main.js plays the sounds and shows the banner.

import { ELITE_TRAITS } from './game/combat.js';
import { levelById } from './game/maps.js';
import { relicFrom } from './game/items.js';
import { NODES, DIFFICULTIES, completeFight, recordDefeat, easeOffer, runSummary, runShareText } from './game/campaign.js';
import { fightCheck } from './game/replay.js';
import { fightRecap, winRecap } from './game/recap.js';
import { recordBlows, loadBestiary, slainTotal, loadElitesSlain } from './game/bestiary.js';
import { recordRun, saveLastFight } from './game/history.js';
import { unlock } from './game/achievements.js';
import { challengeText, encodeFight, MAX_LINK_CODE } from './game/fightLink.js';
import { recordDaily, streak, shareText, recordBestFight } from './game/daily.js';
import { recordWeekly, weekStreak, weeklyShareText } from './game/weekly.js';
import { trackAll, fightEvents, sendLoss, withoutNames, takeInput } from './stats.js';

/**
 * Settle a fight that is over (`game.over` is 'victory' or 'defeat'). `ctx`: the game, its
 * node, the campaign, the fight's record (for replays and links), the daily or weekly being
 * played, a challenge link's fight, whether this run is saved (test runs aren't), the feats
 * for achievements, and `store` (writeSave, clearSave, setWonRun). Returns the campaign as
 * it now stands, whether this was the campaign's last room, and the banner's options.
 */
export function settleFight({ game, nodeId, campaign, record, daily, challenge, saving, feats, store }) {
  const won = game.over === 'victory';
  recordBlows(game.blows); // the bestiary's deadliest foes
  if (record) Object.assign(record, { result: game.over, check: fightCheck(game) }); // how it ended, for a link
  if (saving && record) saveLastFight({ ...record, log: [...record.log] }); // kept with the run when it ends
  const level = levelById(NODES[nodeId].level);
  const final = !!level.final && !challenge; // a linked fight is one room, not the campaign's end
  let summary = null;
  let awards = []; // achievements unlocked by this fight (none on test runs)
  let share = null; // a won campaign's text to share
  // A boss leaves its relic behind (completeFight adds it to the run).
  const dropped = won && campaign && !daily && !challenge && NODES[nodeId].boss ? relicFrom(level.id) : null;
  const relic = dropped && !(campaign.relics ?? []).includes(dropped) ? dropped : null;
  if (won) {
    if (saving || daily) awards = unlock('room', { game, node: nodeId, feats, daily: !!daily, met: loadBestiary().length, slain: slainTotal(), eliteKinds: Object.keys(loadElitesSlain()).length });
    if (final) {
      // The campaign is won: record it, and the next visit starts fresh.
      campaign = completeFight(campaign, nodeId, game).state;
      if (saving) {
        recordRun(campaign, 'won');
        awards.push(...unlock('run', { state: campaign }));
      }
      store.clearSave();
      if (saving) store.setWonRun(campaign); // for New Game+, even after a reload
      summary = runSummary(campaign);
      if (saving) share = runShareText(summary);
    }
  } else if (campaign) {
    campaign = recordDefeat(campaign, game, nodeId);
    store.writeSave(campaign);
  }
  // Anonymous play stats: real runs, dailies and linked fights, not test fights. A lost run or
  // daily also sends its replay, without names (the ?losses page).
  if (saving || daily || challenge) {
    const mode = challenge ? 'challenge' : daily ? (daily.weekly ? 'weekly' : 'daily') : 'campaign';
    trackAll(fightEvents({ game, nodeId, campaign, mode, final: final && won, input: takeInput() }));
    if (!won && record && !challenge) {
      const meta = { room: nodeId, difficulty: record.difficulty, tier: record.tier ?? 0, mode, rounds: game.round };
      encodeFight(withoutNames(record)).then((code) => code.length <= MAX_LINK_CODE && sendLoss(code, meta)).catch(() => {});
    }
  }
  const dailyResult = daily ? settleDaily(game, nodeId, daily, level, record, awards) : null;
  const versus = challenge && challengeText(challenge.theirs, { won, rounds: game.round }, level.name);
  // Lost this room again and again in a real run: offer the rest of it one difficulty down.
  const ease = !won && saving && campaign && !daily && !challenge ? easeOffer(campaign, nodeId) : null;
  const banner = {
    round: game.round, level: level.name, final, xp: game.xpEarned(), outro: level.outro, longRest: !!NODES[nodeId].actBreak,
    summary, awards, relic, jar: !!campaign?.relics?.includes('jar') && !daily && !challenge, daily: dailyResult, challenge: versus, share, replay: !!record, recap: won ? null : fightRecap(game),
    win: won && !summary ? winRecap(game) : null,
    ngplus: !!summary && saving && !!campaign?.done,
    ease: ease && { to: ease, name: DIFFICULTIES[ease].name, desc: DIFFICULTIES[ease].desc },
  };
  return { campaign, final, banner };
}

/** A daily or weekly attempt: record it, keep its best fight, and say how it went. */
function settleDaily(game, nodeId, daily, level, record, awards) {
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
  return { ...attempt, best: results[daily.key], streak: run, share, weekly: !!weekly };
}
