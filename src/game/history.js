// Past runs, for the title screen: one short record per finished or abandoned campaign,
// newest first, kept in the browser next to the save. A lost fight doesn't end a run (the
// room can be retried), so a run ends only by winning the final room or by being abandoned
// (Abandon run at camp, or a new campaign replacing the save).

import { runSummary, nodeName } from './campaign.js';

export const HISTORY_KEY = 'crypt-skirmish:history';
export const MAX_RUNS = 20;

/**
 * The record of a run that just ended. `result` is 'won' or 'abandoned'; `when` is a
 * timestamp (ms). Returns null for an abandoned run that never won a room: nothing to remember.
 */
export function runRecord(state, result, when) {
  const s = runSummary(state);
  if (result !== 'won' && s.won === 0) return null;
  const mvp = [...s.heroes].sort((a, b) => b.damage - a.damage)[0];
  return {
    when,
    result,
    difficulty: s.difficulty,
    level: s.level,
    won: s.won,
    lost: s.lost,
    rounds: s.rounds,
    xp: s.xp,
    reached: state.at ? nodeName(state.at) : null,
    heroes: s.heroes.map((h) => ({ name: h.name, cls: h.cls, level: h.level })),
    mvp: mvp?.damage > 0 ? { name: mvp.name, damage: mvp.damage } : null,
  };
}

/** The list with `record` added at the front, keeping the newest MAX_RUNS. */
export function addRun(list, record) {
  return record ? [record, ...list].slice(0, MAX_RUNS) : list;
}

/** Parse the stored list; anything unreadable counts as no history. */
export function parseHistory(text) {
  try {
    const list = JSON.parse(text ?? '[]');
    return Array.isArray(list) ? list.filter((r) => r && typeof r === 'object' && r.result && r.when) : [];
  } catch {
    return [];
  }
}

export function loadHistory() {
  try {
    return parseHistory(localStorage.getItem(HISTORY_KEY));
  } catch {
    return [];
  }
}

export function recordRun(state, result, when = Date.now()) {
  const record = runRecord(state, result, when);
  if (!record) return;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(addRun(loadHistory(), record)));
  } catch {
    /* storage unavailable: the run just isn't remembered */
  }
}
