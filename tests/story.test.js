import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { levelById } from '../src/game/maps.js';
import { NODES, newCampaign, completeFight, takeEvent, eventProblem, choices, nodeShown, parseSave, serialize, heroUnit, HERO_CODES } from '../src/game/campaign.js';
import { SCENES, pendingScene, sceneProblem, takeScene, storyOutro, cleanStory, TENDING } from '../src/game/story.js';

const won = (state, node) => {
  const g = new Game(levelById(NODES[node].level), { party: state.party });
  for (const m of g.units) if (m.team === 'monsters') m.alive = false;
  return completeFight(state, node, g);
};
const at = (node, story) => ({ ...newCampaign(), cleared: [node], at: node, ...(story && { story }) });
const potions = (s) => HERO_CODES.reduce((n, c) => n + s.party[c].potions, 0);

describe('the story between fights', () => {
  it('every scene follows a real room and every option has words', () => {
    for (const s of Object.values(SCENES)) {
      expect(NODES[s.after]).toBeTruthy();
      expect(s.title && s.text).toBeTruthy();
      for (const o of Object.values(s.options)) expect(o.label && o.desc && o.news).toBeTruthy();
    }
  });

  it('a scene waits after its room, once, and only when its thread got there', () => {
    expect(pendingScene(newCampaign())).toBe(null); // not before the first room
    expect(pendingScene(at('crypt'))).toBe('gravedigger');
    expect(pendingScene(at('barrow'))).toBe(null); // Hesk was never met
    expect(pendingScene(at('barrow', { gravedigger: 'take' }))).toBe('hesk');
    expect(pendingScene(at('tomb', { journal: 'burn' }))).toBe(null);
    expect(pendingScene(at('tomb', { journal: 'keep' }))).toBe('bargain');
    expect(pendingScene({ ...at('crypt'), endless: { seed: 1, floor: 1 } })).toBe(null);
    const { state } = takeScene(at('crypt'), 'gravedigger', 'send');
    expect(pendingScene(state)).toBe(null);
    expect(sceneProblem(state, 'gravedigger', 'take')).toBe('Not now');
    expect(() => takeScene(state, 'gravedigger', 'take')).toThrow();
    // The map is unchanged by a scene: the way on is the same.
    expect(choices(state)).toEqual(choices(at('crypt')));
  });

  it('choices pay out now: gold and potions', () => {
    const s = at('crypt');
    expect(takeScene(s, 'gravedigger', 'send').state.gold).toBe(25);
    expect(potions(takeScene(at('sanctum'), 'journal', 'burn').state)).toBe(potions(s) + 2);
    expect(potions(takeScene(at('barrow', { gravedigger: 'take' }), 'hesk', 'home').state)).toBe(potions(s) + 4);
    expect(takeScene(at('throne'), 'lament', 'sell').state.gold).toBe(40);
    expect(takeScene(at('tomb', { journal: 'keep' }), 'bargain', 'bargain').state.gold).toBe(100);
  });

  it('Hesk tends the party after each room while he follows', () => {
    const hurt = (s) => {
      for (const c of HERO_CODES) s.party[c].hp = 1;
      return s;
    };
    const plain = won(hurt(at('crypt')), 'warren');
    const tended = won(hurt(at('crypt', { gravedigger: 'take' })), 'warren');
    expect(plain.report.tended).toBe(false);
    expect(tended.report.tended).toBe(true);
    for (const c of HERO_CODES) expect(tended.state.party[c].hp).toBe(Math.min(heroUnit(c, tended.state.party[c]).maxHp, plain.state.party[c].hp + TENDING));
    expect(won(hurt(at('crypt', { gravedigger: 'take', hesk: 'home' })), 'warren').report.tended).toBe(false);
  });

  it('reading the journal opens the hidden study', () => {
    expect(nodeShown(at('vault'), 'study')).toBe(false);
    expect(choices(at('vault'))).not.toContain('study');
    const s = at('vault', { journal: 'keep' });
    expect(nodeShown(s, 'study')).toBe(true);
    expect(choices(s)).toContain('study');
    expect(choices(at('cistern', { journal: 'keep' }))).toContain('study');
    expect(eventProblem(at('vault'), 'study', 'silver')).toBe('Not on the way');
    expect(takeEvent(s, 'study', 'silver').state.gold).toBe(60);
    const { state, report } = takeEvent(s, 'study', 'scrolls');
    expect(report.loot).toEqual(['scrollFireball', 'scrollMistyStep']);
    expect(HERO_CODES.flatMap((c) => state.party[c].scrolls ?? [])).toEqual(['scrollFireball', 'scrollMistyStep']);
    expect(choices(state)).toEqual(['barrow']);
  });

  it('answers ride in the save, checked', () => {
    const { state } = takeScene(at('crypt'), 'gravedigger', 'take');
    expect(parseSave(serialize(state)).story).toEqual({ gravedigger: 'take' });
    expect(parseSave(serialize({ ...state, story: { gravedigger: 'eat', nope: 'x' } })).story).toBe(undefined);
    expect(cleanStory({ journal: 'keep', lament: 7 })).toEqual({ journal: 'keep' });
    expect(parseSave(serialize(at('crypt'))).story).toBe(undefined); // old saves have none
  });

  it('the ending follows the threads', () => {
    expect(storyOutro({}, 'The end.')).toBe('The end.');
    const end = storyOutro({ story: { gravedigger: 'take', hesk: 'stay', lament: 'vow', journal: 'keep', bargain: 'bargain' } }, 'The end.');
    expect(end).toMatch(/^The end\. /);
    expect(end).toMatch(/Corin/);
    expect(end).toMatch(/whispers/);
    expect(end).toMatch(/Hesk leads you up/);
    expect(storyOutro({ story: { gravedigger: 'take', hesk: 'home' } })).not.toMatch(/leads you up/);
  });
});
