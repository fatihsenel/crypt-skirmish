import { describe, it, expect } from 'vitest';
import { createUnit, applyLevel, asiLevels, asiDefault } from '../src/game/units.js';
import { newCampaign, heroUnit, openPicks, pickOptions, choosePick, settlePicks, parseSave, serialize } from '../src/game/campaign.js';
import { cleanParty } from '../src/game/fightLink.js';
import { Game } from '../src/game/combat.js';
import { seeded } from '../src/game/dice.js';
import { levelById } from '../src/game/maps.js';

const at = (code, level, picks) => applyLevel(createUnit(code, 0, 0), level, picks);
const party = (level, cls = {}) => {
  const s = newCampaign('normal', {}, cls);
  for (const rec of Object.values(s.party)) rec.level = level;
  for (const [code, rec] of Object.entries(s.party)) rec.hp = heroUnit(code, rec).maxHp;
  return s;
};

describe('ability score picks', () => {
  it('a hero with no picks is built as before: the class’s own increases', () => {
    for (const code of 'FPWKRACBZSMD') {
      const own = Object.fromEntries(asiLevels(code).map((l) => [l, asiDefault(code, l)]));
      for (let l = 3; l <= 8; l++) {
        const a = at(code, l);
        const b = at(code, l, own);
        delete a.id;
        delete b.id;
        expect(b).toEqual(a);
      }
    }
    expect(asiLevels('F')).toEqual([4, 6, 8]);
    expect(asiLevels('W')).toEqual([4, 8]);
    expect(at('F', 8).maxHp).toBe(79); // Constitution 17 at 8: +1 HP for every level
    expect(at('R', 4).ac).toBe(15);
    expect(at('B', 8).inspiration).toBe(5);
  });

  it('Constitution gives a hit point for every level, now and after', () => {
    const own = at('F', 4);
    const con = at('F', 4, { 4: 'con' });
    expect(con.stats.con).toBe(17);
    expect(con.stats.str).toBe(16);
    expect(con.maxHp).toBe(own.maxHp + 4);
    expect(at('F', 5, { 4: 'con' }).maxHp - at('F', 5).maxHp).toBe(5);
  });

  it('Dexterity raises AC only in light armour; Charisma gives a bard more inspiration', () => {
    expect(at('W', 4, { 4: 'dex' }).ac).toBe(at('W', 4).ac + 1);
    expect(at('C', 4, { 4: 'dex' }).ac).toBe(at('C', 4).ac);
    expect(at('R', 4, { 4: 'con' }).ac).toBe(at('R', 3).ac);
    expect(at('B', 4, { 4: 'con' }).inspiration).toBe(3);
    expect(at('B', 8, { 4: 'con' }).inspiration).toBe(4);
  });

  it('no ability goes past 20', () => {
    const u = at('F', 8, { 4: 'con', 6: 'con' });
    expect(u.stats.con).toBe(20);
  });

  it('camp offers the open increases, the class’s own first, and a pick moves HP with the maximum', () => {
    const s = party(5);
    expect(openPicks(s, 'F')).toEqual([4]);
    expect(openPicks(s, 'W')).toEqual([4]);
    const opts = pickOptions(s, 'F', 4);
    expect(opts[0]).toMatchObject({ stat: 'str', value: 18, own: true });
    expect(opts.map((o) => o.stat)).toContain('con');
    expect(opts.find((o) => o.stat === 'con').lines).toContain('+5 max HP');
    expect(pickOptions(s, 'W', 4).find((o) => o.stat === 'dex').lines).toEqual(expect.arrayContaining(['+1 AC', '+1 initiative']));
    const hp = s.party.F.hp;
    const next = choosePick(s, 'F', 4, 'con');
    expect(next.party.F.picks).toEqual({ 4: 'con' });
    expect(next.party.F.hp).toBe(hp + 5);
    expect(openPicks(next, 'F')).toEqual([]);
    expect(s.party.F.picks).toBeUndefined(); // the old state is untouched
    expect(choosePick(next, 'F', 4, 'str')).toBe(next); // made once
    expect(choosePick(s, 'F', 6, 'con')).toBe(s); // not reached yet
    expect(choosePick(s, 'F', 4, 'luck')).toBe(s);
  });

  it('the next fight keeps the class’s own pick for any still open', () => {
    const s = choosePick(party(8), 'R', 4, 'con');
    const settled = settlePicks(s);
    expect(settled.party.F.picks).toEqual({ 4: 'str', 6: 'str', 8: 'con' });
    expect(settled.party.R.picks).toEqual({ 4: 'con', 8: 'dex' });
    expect(HERO_HP(settled)).toEqual(HERO_HP(s));
    expect(settlePicks(settled)).toBe(settled);
  });

  it('picks ride in saves and links, and the fight builds heroes with them', () => {
    const s = choosePick(party(4), 'F', 4, 'con');
    expect(parseSave(serialize(s)).party.F.picks).toEqual({ 4: 'con' });
    const bad = JSON.parse(serialize(s));
    bad.party.F.picks = { 4: 'luck', 5: 'str', x: 'con' };
    expect(parseSave(JSON.stringify(bad)).party.F.picks).toBeUndefined();
    expect(cleanParty(s.party).F.picks).toEqual({ 4: 'con' });
    const game = new Game(levelById('crypt'), { rng: seeded(1), party: s.party });
    const fighter = game.units.find((u) => u.slot === 'F');
    expect(fighter.stats.con).toBe(17);
    expect(fighter.maxHp).toBe(heroUnit('F', s.party.F).maxHp);
  });
});

const HERO_HP = (s) => Object.fromEntries(Object.entries(s.party).map(([c, r]) => [c, r.hp]));
