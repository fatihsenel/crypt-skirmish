import { describe, it, expect, vi } from 'vitest';
import { Game } from '../src/game/combat.js';
import { newCampaign, START_NODE } from '../src/game/campaign.js';
import { settleFight } from '../src/fightEnd.js';

/** A one-blow fight in the first room's name: every die maxes out, so the first swing ends it. */
function finished(winner) {
  const game = new Game(['#####', '#Fg.#', '#####'], { senses: false, rng: () => 0.999 });
  game.start();
  const [f, g] = game.units;
  if (winner === 'heroes') game.attack(f, g, f.attacks[0]);
  else {
    f.hp = 1;
    game.attack(g, f, g.attacks[0]);
  }
  return game;
}

const store = () => ({ writeSave: vi.fn(), clearSave: vi.fn(), setWonRun: vi.fn() });
const base = (game, extra = {}) => ({
  game, nodeId: START_NODE, campaign: newCampaign(), record: null, daily: null, challenge: null,
  saving: false, feats: { maxHit: 0, sneaks: 0, stayDown: false }, store: store(), ...extra,
});

describe('the end of a fight', () => {
  it('a room won mid-campaign: the banner, and nothing saved on a test run', () => {
    const game = finished('heroes');
    expect(game.over).toBe('victory');
    const ctx = base(game);
    const end = settleFight(ctx);
    expect(end.final).toBe(false);
    expect(end.campaign).toBe(ctx.campaign); // the camp moves it on, not the fight's end
    expect(end.banner).toMatchObject({ round: game.round, xp: game.xpEarned(), final: false, awards: [], summary: null, daily: null, replay: false });
    expect(end.banner.win).toBeTruthy();
    expect(ctx.store.writeSave).not.toHaveBeenCalled();
  });

  it('a lost fight: the defeat is saved to the run and the banner tells how it went', () => {
    const game = finished('monsters');
    expect(game.over).toBe('defeat');
    const ctx = base(game);
    const end = settleFight(ctx);
    expect(end.campaign.stats.lost).toBe((ctx.campaign.stats?.lost ?? 0) + 1);
    expect(ctx.store.writeSave).toHaveBeenCalledWith(end.campaign);
    expect(end.banner.recap).toBeTruthy();
    expect(end.banner.win).toBeNull();
  });

  it('a third loss in the same room of a real run offers the rest of it one difficulty down', () => {
    const run = { ...newCampaign('normal'), fails: { [START_NODE]: 2 } };
    const third = settleFight(base(finished('monsters'), { campaign: run, saving: true }));
    expect(third.campaign.fails[START_NODE]).toBe(3);
    expect(third.banner.ease).toEqual({ to: 'story', name: 'Story', desc: expect.any(String) });
    // Not on a second loss, a test run, a daily or a win.
    expect(settleFight(base(finished('monsters'), { campaign: { ...run, fails: {} }, saving: true })).banner.ease).toBeNull();
    expect(settleFight(base(finished('monsters'), { campaign: run })).banner.ease).toBeNull();
    expect(settleFight(base(finished('monsters'), { campaign: null, daily: { key: '2026-11-20', level: 6, seed: 1 } })).banner.ease).toBeNull();
    expect(settleFight(base(finished('heroes'), { campaign: run, saving: true })).banner.ease).toBeNull();
  });

  it('a won daily: its result, streak and share text go on the banner', () => {
    const game = finished('heroes');
    const daily = { key: '2026-11-20', level: 6, seed: 1 };
    const end = settleFight(base(game, { daily, campaign: null }));
    expect(end.banner.daily).toMatchObject({ won: true, rounds: game.round, streak: 1, weekly: false });
    expect(end.banner.daily.share).toMatch(/^Crypt Skirmish daily, 20 Nov 2026/);
  });
});
