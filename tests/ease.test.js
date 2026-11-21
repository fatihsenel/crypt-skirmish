import { describe, it, expect } from 'vitest';
import { newCampaign, recordDefeat, easeOffer, easeRun, parseSave, EASE_AFTER } from '../src/game/campaign.js';
import { Game } from '../src/game/combat.js';
import { levelById } from '../src/game/maps.js';

const lose = (state, room, times) => {
  for (let i = 0; i < times; i++) state = recordDefeat(state, new Game(levelById(room), { party: state.party }), room);
  return state;
};

describe('an easier difficulty after losing a room again and again', () => {
  it('is offered from the third loss in the same room, one step down', () => {
    expect(EASE_AFTER).toBe(3);
    const run = newCampaign('normal');
    expect(easeOffer(lose(run, 'crypt', 2), 'crypt')).toBeNull();
    const thrice = lose(run, 'crypt', 3);
    expect(thrice.fails).toEqual({ crypt: 3 });
    expect(easeOffer(thrice, 'crypt')).toBe('story');
    expect(easeOffer(thrice, 'throne')).toBeNull(); // losses elsewhere don't count
    expect(easeOffer(lose(newCampaign('hard'), 'crypt', 3), 'crypt')).toBe('normal');
    expect(easeOffer(lose(newCampaign('story'), 'crypt', 5), 'crypt')).toBeNull(); // nothing easier
  });

  it('lowers the rest of the run and starts the count again', () => {
    const thrice = lose(newCampaign('hard'), 'crypt', 3);
    const eased = easeRun(thrice);
    expect(eased.difficulty).toBe('normal');
    expect(eased.fails).toEqual({});
    expect(thrice.difficulty).toBe('hard'); // a new state, the old one untouched
    expect(easeOffer(eased, 'crypt')).toBeNull();
    expect(easeRun(newCampaign('story')).difficulty).toBe('story');
  });

  it('keeps the count in the save, and drops a junk one', () => {
    const thrice = lose(newCampaign('normal'), 'crypt', 3);
    expect(parseSave(JSON.stringify(thrice)).fails).toEqual({ crypt: 3 });
    expect(parseSave(JSON.stringify({ ...thrice, fails: { crypt: 'x', nowhere: 4, throne: 2 } })).fails).toEqual({ throne: 2 });
    expect(parseSave(JSON.stringify({ ...thrice, fails: 'lots' })).fails).toBeUndefined();
  });
});
