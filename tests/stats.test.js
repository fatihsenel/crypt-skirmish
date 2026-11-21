import { describe, it, expect, vi } from 'vitest';
import { Game } from '../src/game/combat.js';
import { levelById } from '../src/game/maps.js';
import { NODES, newCampaign } from '../src/game/campaign.js';
import { parseSettings } from '../src/game/settings.js';
import { statsAllowed, fightEvents, runEvent, abandonEvent, continueEvent, shareEvent, partyCode, track, errorEvent, browserFamily, leftEvent } from '../src/stats.js';

const live = { prod: true, host: 'fatihsenel.github.io', search: '', dnt: null };

describe('play stats', () => {
  it('are sent only by the deployed game, not on test pages or with Do Not Track', () => {
    expect(statsAllowed(live)).toBe(true);
    expect(statsAllowed({ ...live, search: '?foo=1' })).toBe(true);
    expect(statsAllowed({ ...live, prod: false })).toBe(false);
    expect(statsAllowed({ ...live, host: 'localhost' })).toBe(false);
    expect(statsAllowed({ ...live, dnt: '1' })).toBe(false);
    expect(statsAllowed({ ...live, search: '?level=3&seed=2' })).toBe(false);
    expect(statsAllowed({ ...live, search: '?victory' })).toBe(false);
  });

  it('are on unless the player turns them off', () => {
    expect(parseSettings(null).stats).toBe(true);
    expect(parseSettings('{"stats":false}').stats).toBe(false);
    expect(parseSettings('{"stats":"no"}').stats).toBe(true);
  });

  it('describe a fight by room, mode, party and rounds, and nothing personal', () => {
    const campaign = newCampaign('hard', { F: 'Somebody' }, { F: 'P' });
    const g = new Game(levelById(NODES.crypt.level), { party: campaign.party });
    for (const m of g.units) if (m.team === 'monsters') m.alive = false;
    g.over = 'victory';
    const [[name, data], ...rest] = fightEvents({ game: g, nodeId: 'crypt', campaign, mode: 'campaign', final: false });
    expect(name).toBe('fight-won');
    expect(data).toMatchObject({ room: 'crypt', mode: 'campaign', difficulty: 'hard', tier: 0, party: 'PWRC', standing: 4, downed: 0 });
    expect(JSON.stringify(data)).not.toMatch(/Somebody/);
    expect(rest).toEqual([]);
    // The last room won: the campaign too.
    const end = fightEvents({ game: g, nodeId: 'throne', campaign: { ...campaign, relics: ['veil'] }, mode: 'campaign', final: true });
    expect(end.map(([n]) => n)).toEqual(['fight-won', 'campaign-won']);
    expect(end[1][1].relics).toBe(1);
    g.over = 'defeat';
    expect(fightEvents({ game: g, nodeId: 'crypt', campaign, mode: 'daily', final: false })[0][0]).toBe('fight-lost');
  });

  it('describe a fight left half-way: where, which round, and how the party stood', () => {
    const campaign = newCampaign('normal', { W: 'Somebody' });
    const g = new Game(levelById(NODES.crypt.level), { party: campaign.party });
    g.round = 4;
    const hero = g.units.find((u) => u.team === 'heroes');
    hero.hp = 0;
    hero.alive = false;
    g.stats[hero.slot] = { ...g.stats[hero.slot], downed: 1 };
    const [name, data] = leftEvent({ game: g, nodeId: 'crypt', campaign, mode: 'daily' });
    expect(name).toBe('fight-left');
    expect(data).toEqual({ room: 'crypt', mode: 'daily', difficulty: 'normal', tier: 0, party: 'FWRC', round: 4, standing: 3, downed: 1 });
    expect(JSON.stringify(data)).not.toMatch(/Somebody/);
  });

  it('report a crash in the game’s own code by kind and place, never its message', () => {
    const base = 'https://fatihsenel.github.io';
    const err = new TypeError('Cannot read properties of undefined (reading "hp") for Somebody');
    err.stack = `TypeError: Cannot read properties of undefined\n    at xY (${base}/crypt-skirmish/assets/index-B66MHsDo.js:1:23456)\n    at ${base}/crypt-skirmish/assets/vendor-AbC_12.js:3:9`;
    const chrome = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
    const [name, data] = errorEvent(err, { origin: base, ua: chrome });
    expect(name).toBe('error');
    expect(data).toEqual({ type: 'TypeError', file: 'index-B66MHsDo.js', line: 1, col: 23456, browser: 'chrome' });
    expect(JSON.stringify(data)).not.toMatch(/Somebody|Cannot/);
    // Firefox's stack frames look different.
    err.stack = `xY@${base}/crypt-skirmish/assets/index-B66MHsDo.js:1:777\n`;
    expect(errorEvent(err, { origin: base, ua: chrome })[1]).toMatchObject({ file: 'index-B66MHsDo.js', line: 1, col: 777 });
    // The dev server's modules.
    err.stack = `at f (http://localhost:5173/src/main.js?t=17:40:12)`;
    expect(errorEvent(err, { origin: 'http://localhost:5173', ua: chrome })[1]).toMatchObject({ file: 'main.js', line: 40, col: 12 });
    // Not ours (an extension, another site's script, a cross-origin "Script error."), or nothing to go on: no report.
    err.stack = 'at x (chrome-extension://abc/content.js:1:1)';
    expect(errorEvent(err, { origin: base, ua: chrome })).toBeNull();
    err.stack = 'at x (https://cloud.umami.is/script.js:1:1)';
    expect(errorEvent(err, { origin: base, ua: chrome })).toBeNull();
    expect(errorEvent('a string thrown', { origin: base, ua: chrome })).toBeNull();
    expect(errorEvent(null, { origin: base, ua: chrome })).toBeNull();
    // A thrown oddity keeps a plain type.
    const odd = { name: 'Weird name with spaces', stack: `at x (${base}/crypt-skirmish/assets/index-B.js:1:5)` };
    expect(errorEvent(odd, { origin: base, ua: chrome })[1].type).toBe('Error');
  });

  it('name the browser family only', () => {
    expect(browserFamily('Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/133.0')).toBe('firefox');
    expect(browserFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')).toBe('safari');
    expect(browserFamily('Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1')).toBe('chrome');
    expect(browserFamily('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0')).toBe('edge');
    expect(browserFamily('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36')).toBe('samsung');
    expect(browserFamily('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36')).toBe('chrome');
    expect(browserFamily('')).toBe('other');
  });

  it('describe a new run and an abandoned one', () => {
    const c = newCampaign();
    expect(partyCode(c)).toBe('FWRC');
    expect(runEvent(c)).toEqual(['run-start', { kind: 'new', difficulty: 'normal', tier: 0, party: 'FWRC' }]);
    expect(abandonEvent({ ...c, at: 'nest', cleared: ['crypt', 'warren', 'nest'] })).toEqual(['run-abandon', { room: 'nest', cleared: 3, difficulty: 'normal', tier: 0 }]);
  });

  it('describe a run picked up again, and something shared', () => {
    const c = { ...newCampaign('hard'), at: 'nest', cleared: ['crypt', 'warren', 'nest'], tier: 1 };
    expect(continueEvent(c, true)).toEqual(['run-continue', { room: 'nest', cleared: 3, difficulty: 'hard', tier: 1, midFight: true }]);
    expect(continueEvent(newCampaign(), false)[1]).toMatchObject({ room: 'start', cleared: 0, midFight: false });
    expect(shareEvent('challenge', 'copy')).toEqual(['shared', { what: 'challenge', how: 'copy' }]);
  });

  it('send nothing before the setting is read', () => {
    expect(() => track('fight-won', {})).not.toThrow();
  });

  it('hold events made before the setting is read, then send them once the script is in', async () => {
    vi.resetModules();
    vi.stubEnv('PROD', true);
    vi.stubEnv('DEV', false);
    const scripts = [];
    const sent = [];
    vi.stubGlobal('location', { hostname: 'fatihsenel.github.io', search: '' });
    vi.stubGlobal('navigator', { doNotTrack: null });
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', { createElement: () => ({ dataset: {} }), head: { append: (s) => scripts.push(s) } });
    try {
      const stats = await import('../src/stats.js');
      stats.track('challenge-played', { room: 'crypt' }); // a #play= link, before boot.js reads the setting
      stats.setStats(true);
      expect(scripts).toHaveLength(1);
      expect(scripts[0].dataset).toMatchObject({ autoTrack: 'false', excludeHash: 'true', excludeSearch: 'true' });
      window.umami = { track: (...a) => sent.push(a) };
      scripts[0].onload();
      expect(sent).toEqual([[], ['challenge-played', { room: 'crypt' }]]); // the page view, then the held event
      stats.track('stop', { stop: 'altar' });
      expect(sent.at(-1)).toEqual(['stop', { stop: 'altar' }]);
      // Turned off: nothing more.
      stats.setStats(false);
      stats.track('fight-won', {});
      expect(sent).toHaveLength(3);
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('drop held events when the player has turned stats off', async () => {
    vi.resetModules();
    vi.stubEnv('PROD', true);
    vi.stubEnv('DEV', false);
    const scripts = [];
    vi.stubGlobal('location', { hostname: 'fatihsenel.github.io', search: '' });
    vi.stubGlobal('navigator', { doNotTrack: null });
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', { createElement: () => ({ dataset: {} }), head: { append: (s) => scripts.push(s) } });
    try {
      const stats = await import('../src/stats.js');
      stats.track('challenge-played', {});
      stats.setStats(false);
      expect(scripts).toHaveLength(0);
      stats.setStats(true); // turned on later in the visit: the earlier event is gone
      const sent = [];
      window.umami = { track: (...a) => sent.push(a) };
      scripts[0].onload();
      expect(sent).toEqual([[]]);
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
