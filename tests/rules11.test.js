import { describe, it, expect } from 'vitest';
import { Game, SHADOW_DC } from '../src/game/combat.js';
import { levelById } from '../src/game/maps.js';
import { key } from '../src/game/grid.js';
import { makeFloor } from '../src/game/endless.js';
import { newCampaign, chooseStyle, heroStyle, heroUnit, parseSave, serialize } from '../src/game/campaign.js';
import { encodeFight, decodeFight } from '../src/game/fightLink.js';

/** A fight whose every die rolls `dice.r` (change it between steps). */
function fight(room, opts = {}) {
  const dice = { r: 0.5 };
  const g = new Game(room, { senses: false, rng: () => dice.r, ...opts });
  g.start();
  return { g, dice, hero: (cls) => g.units.find((u) => u.cls === cls), foe: (code) => g.units.find((u) => u.code === code) };
}
const turnOf = (g, u) => { while (g.current !== u) g.endTurn(); };
const rec = (style, extra = {}) => ({ level: 3, items: [], hp: 40, alive: true, slots: {}, potions: 0, ...(style && { style }), ...extra });

describe('fighting styles (rules 11)', () => {
  it('a Fighter takes Defense unless the party picks another; a Paladin keeps Dueling', () => {
    const { hero } = fight({ rows: ['#####', '#F.o#', '#####'] });
    expect(hero('Fighter').passives).toContain('defense');
    expect(hero('Fighter').acBonus).toBe(1);
    const old = fight({ rows: ['#####', '#F.o#', '#####'] }, { rules: 10 });
    expect(old.hero('Fighter').passives).not.toContain('defense');
    expect(old.hero('Fighter').acBonus).toBe(0);
    const pal = fight({ rows: ['#####', '#P.o#', '#####'] });
    expect(pal.hero('Paladin').passives.filter((p) => ['dueling', 'defense', 'greatWeapon', 'protection'].includes(p))).toEqual(['dueling']);
  });

  it('Great Weapon Fighting: the longsword in both hands, rerolling 1s and 2s; a Paladin sets the shield aside', () => {
    const { g, hero, foe } = fight({ rows: ['#####', '#Fo.#', '#####'] }, { party: { F: rec('greatWeapon') } });
    const f = hero('Fighter');
    const sword = f.attacks.find((a) => a.name === 'Longsword');
    expect(sword.damage).toBe('1d10');
    turnOf(g, f);
    const rolls = [0.9, 0.05, 0.75]; // a 19 hits; the d10 rolls a 1, rerolled to 8
    let i = 0;
    g.rng = () => rolls[i++] ?? 0.5;
    const r = g.attack(f, foe('o'), sword);
    expect(r.hit).toBe(true);
    expect(r.damageRoll.rerolled).toBe(1);
    expect(r.damageRoll.rolls).toEqual([8]);
    const pal = fight({ rows: ['#####', '#F.o#', '#####'] }, { party: { F: rec('greatWeapon', { cls: 'P' }) } });
    const plain = fight({ rows: ['#####', '#F.o#', '#####'] }, { party: { F: rec(null, { cls: 'P' }) } });
    expect(pal.hero('Paladin').ac).toBe(plain.hero('Paladin').ac - 2);
  });

  it('Protection: the guard’s reaction puts an attack on the ally beside them at disadvantage', () => {
    const { g, hero, foe } = fight({ rows: ['######', '#FWo.#', '######'] }, { party: { F: rec('protection') } });
    const f = hero('Fighter');
    const w = hero('Wizard');
    const orc = foe('o');
    turnOf(g, orc);
    const r = g.attack(orc, w, orc.attacks[0]);
    expect(r.guard).toBe(f);
    expect(r.mods.mode).toBe('dis');
    expect(r.mods.dis.some((d) => d.includes('Protection'))).toBe(true);
    expect(f.reactionUsed).toBe(true);
    // Once a round: the next attack goes in as usual.
    orc.actionUsed = false;
    expect(g.attack(orc, w, orc.attacks[0]).guard).toBeUndefined();
  });

  it('is chosen at camp, kept in the save and a link, and dropped from a class that takes none', async () => {
    let s = newCampaign();
    expect(heroStyle(s, 'F')).toBe('defense');
    expect(heroStyle(s, 'W')).toBeNull();
    s = chooseStyle(s, 'F', 'protection');
    expect(heroStyle(s, 'F')).toBe('protection');
    expect(chooseStyle(s, 'W', 'defense')).toBe(s);
    expect(chooseStyle(s, 'F', 'archery')).toBe(s);
    expect(parseSave(serialize(s)).party.F.style).toBe('protection');
    expect(heroUnit('F', { ...s.party.F, style: 'defense' }).acBonus).toBe(1);
    const odd = JSON.parse(serialize(s));
    odd.party.F.style = 'nonsense';
    expect(parseSave(JSON.stringify(odd)).party.F.style).toBeUndefined();
    const record = { node: 'crypt', seed: 5, party: s.party, difficulty: 'normal', log: [{ type: 'end' }], result: 'defeat', check: 'x' };
    expect((await decodeFight(await encodeFight(record))).party.F.style).toBe('protection');
  });
});

describe('high ground (rules 11)', () => {
  const room = { rows: ['#######', '#W....#', '#.....#', '#....o#', '#######'], high: [[1, 1, 2, 2]] };

  it('climbing up costs a tile more; walking along it or down does not', () => {
    const { g, hero } = fight({ ...room, rows: ['#######', '#.....#', '#W....#', '#....o#', '#######'], high: [[1, 1, 5, 1]] });
    const w = hero('Wizard');
    const map = g.reachable(w);
    expect(map.get(key(1, 1)).dist).toBe(2);
    expect(map.get(key(2, 2)).dist).toBe(1);
    expect(new Game({ ...room, rows: ['#######', '#.....#', '#W....#', '#....o#', '#######'], high: [[1, 1, 5, 1]] }, { senses: false, rules: 10 }).reachable(w).get(key(1, 1)).dist).toBe(1);
  });

  it('gives a shot from up there advantage on a foe below, not in melee or under rules 10', () => {
    const { g, hero, foe } = fight(room);
    const w = hero('Wizard');
    const bolt = w.attacks.find((a) => a.reach > 1);
    expect(g.attackMods(w, foe('o'), bolt).adv).toContain('high ground');
    expect(g.attackMods(foe('o'), w, foe('o').attacks.find((a) => a.reach > 1)).adv).not.toContain('high ground');
    const old = fight(room, { rules: 10 });
    expect(old.g.attackMods(old.hero('Wizard'), old.foe('o'), bolt).adv).not.toContain('high ground');
  });

  it('a push off the edge is a fall: 1d6 and prone', () => {
    const { g, dice, hero, foe } = fight({ rows: ['######', '#Fo..#', '#....#', '######'], high: [[1, 1, 2, 1]] });
    const f = hero('Fighter');
    const orc = foe('o');
    // Both up on the ledge: pushed east, the orc goes off its end.
    turnOf(g, f);
    dice.r = 0.9; // the fighter wins, and the d6 rolls a 6
    const tumbles = [];
    g.on('tumble', (r) => tumbles.push(r));
    const hp = orc.hp;
    const r = g.shove(f, orc, true);
    expect(r.success).toBe(true);
    expect(r.push.drop).toBe(true);
    expect(orc.x).toBe(3);
    expect(tumbles[0].ledge).toBe(true);
    expect(orc.hp).toBe(hp - 6);
    expect(g.has(orc, 'prone')).toBe(true);
  });

  it('is in the crypt, the warren and the gallery', () => {
    for (const id of ['crypt', 'warren', 'gallery']) {
      expect(new Game(levelById(id), { senses: false }).high.size).toBeGreaterThan(0);
      expect(new Game(levelById(id), { senses: false, rules: 10 }).high.size).toBe(0);
    }
  });
});

describe('the shadow (rules 11)', () => {
  const dark = { rows: ['#######', '#F...p#', '#######'], dark: [[4, 1, 5, 1]] };

  it('starts hidden in the dark, and slips back into it as its turn ends there', () => {
    const { g, foe } = fight(dark, { senses: true });
    const p = foe('p');
    expect(p.hidden).toBe(SHADOW_DC);
    p.hidden = 0;
    turnOf(g, p);
    g.endTurn();
    expect(p.hidden).toBe(SHADOW_DC);
  });

  it('drains Strength for the fight, never below 1', () => {
    const { g, dice, hero, foe } = fight({ rows: ['#####', '#Fp.#', '#####'] });
    const f = hero('Fighter');
    const p = foe('p');
    f.hp = f.maxHp = 200;
    turnOf(g, p);
    dice.r = 0.9;
    const r = g.attack(p, f, p.attacks[0]);
    expect(r.drain).toEqual(expect.objectContaining({ stat: 'str', from: 16, to: 12 }));
    f.stats.str = 2;
    p.actionUsed = false;
    expect(g.attack(p, f, p.attacks[0]).drain.to).toBe(1);
  });

  it('takes half from plain steel, all from a magic weapon, and double radiant', () => {
    const { g, dice, hero, foe } = fight({ rows: ['#####', '#Pp.#', '#####'] });
    const pal = hero('Paladin');
    const p = foe('p');
    p.hp = p.maxHp = 200;
    turnOf(g, pal);
    dice.r = 0.9;
    const sword = pal.attacks[0];
    const plain = g.attack(pal, p, sword);
    expect(plain.shade).toEqual({ halved: true, burned: false });
    pal.actionUsed = false;
    pal.weaponBonus = 1;
    expect(g.attack(pal, p, sword).shade).toBeUndefined();
    pal.actionUsed = false;
    pal.weaponBonus = 0;
    pal.smiteArmed = true;
    const smitten = g.attack(pal, p, sword);
    expect(smitten.shade).toEqual({ halved: true, burned: true });
    const rest = smitten.damageRoll.total + g.damageBonus(pal, sword);
    expect(smitten.damage).toBe(Math.floor(rest / 2) + 2 * smitten.smite.total);
  });
});

describe('the hobgoblin and the kobold (rules 11)', () => {
  it('Martial Advantage: +2d6 once a turn, with an ally of its next to the target', () => {
    const { g, dice, hero, foe } = fight({ rows: ['######', '#HFg.#', '######'] });
    const hob = foe('H');
    const f = hero('Fighter');
    f.hp = f.maxHp = 200;
    turnOf(g, hob);
    dice.r = 0.9;
    const r = g.attack(hob, f, hob.attacks[0]);
    expect(r.martial.total).toBe(12);
    const lone = fight({ rows: ['######', '#HF..#', '######'] });
    lone.dice.r = 0.9;
    turnOf(lone.g, lone.foe('H'));
    expect(lone.g.attack(lone.foe('H'), lone.hero('Fighter'), lone.foe('H').attacks[0]).martial).toBeUndefined();
  });

  it('Pack Tactics: a kobold has advantage with a friend next to the target', () => {
    const { g, hero, foe } = fight({ rows: ['######', '#YFY.#', '######'] });
    expect(g.attackMods(foe('Y'), hero('Fighter'), foe('Y').attacks[0]).adv).toContain('pack tactics');
  });

  it('turn up in rooms only under rules 11', () => {
    const count = (id, rules) => new Game(levelById(id), { senses: false, rules }).units.filter((u) => ['H', 'Y', 'p'].includes(u.code)).length;
    for (const id of ['crypt', 'sanctum', 'vault', 'catacombs']) {
      expect(count(id)).toBeGreaterThan(0);
      expect(count(id, 10)).toBe(0);
    }
  });

  it('come to the Endless Crypt from generation 9, a shadow’s chamber dark; generation 8 floors are unchanged', () => {
    let shadows = 0;
    for (let seed = 1; seed < 40; seed++) {
      for (let f = 1; f < 10; f++) {
        const a = makeFloor(seed, f, 9);
        const b = makeFloor(seed, f, 8);
        expect(b.rows.join('')).not.toMatch(/[HYp]/);
        if (!/[HYp]/.test(a.rows.join(''))) expect(a.rows).toEqual(b.rows);
        for (const [z, row] of a.rows.entries()) {
          for (const [x, ch] of [...row].entries()) {
            if (ch !== 'p') continue;
            shadows++;
            expect(a.dark.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1)).toBe(true);
          }
        }
      }
    }
    expect(shadows).toBeGreaterThan(0);
  });
});
