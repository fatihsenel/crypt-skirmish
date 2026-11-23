import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { applyLevel, createUnit, CLASS_CHOICES } from '../src/game/units.js';
import { nextMonsterStep } from '../src/game/ai.js';
import { dailyPlan, THIRD_FROM } from '../src/game/daily.js';
import { weeklyPlan } from '../src/game/weekly.js';
import { newCampaign, heroUnit } from '../src/game/campaign.js';

/** A fight on `rows`, run on to the first hero's turn. */
function fight(rows, rng = () => 0.5) {
  const g = new Game(rows, { senses: false, rng });
  g.start();
  while (g.current.team !== 'heroes') g.endTurn();
  return g;
}
/** Dice that come up in this order (as fractions of the die), then 0.5. */
const seq = (...vals) => () => (vals.length ? vals.shift() : 0.5);
const find = (g, code) => g.units.find((u) => u.code === code);
/** It's `u`'s turn, fresh. */
function turnOf(g, u) {
  g.turn = g.order.indexOf(u);
  g.beginTurn();
}
const lvl = (code, level) => applyLevel(createUnit(code, 0, 0), level);

describe('the third classes', () => {
  it('fill each slot as its third choice and level up to 8', () => {
    expect(CLASS_CHOICES).toEqual({ F: ['F', 'P', 'Z'], W: ['W', 'K', 'S'], R: ['R', 'A', 'M'], C: ['C', 'B', 'D'] });
    const z = lvl('Z', 8);
    expect(z).toMatchObject({ speed: 8, feral: true, ac: 16 }); // CON 18 lifts Unarmored Defense
    expect(z.passives).toEqual(expect.arrayContaining(['extraAttack', 'mindlessRage', 'feralInstinct']));
    const s = lvl('S', 8);
    expect(s.sorcery).toBe(8);
    expect(s.spells).toEqual(expect.arrayContaining(['fireball', 'iceStorm']));
    const m = lvl('M', 8);
    expect(m).toMatchObject({ ki: 8, speed: 9, ac: 17 }); // DEX 18, WIS 16
    expect(m.features).toEqual(expect.arrayContaining(['flurry', 'stunningStrike', 'wholeness']));
    expect(m.attacks[0].damage).toBe('1d6');
    expect(createUnit('M', 0, 0).attacks[0].damage).toBe('1d4'); // the template is untouched
    const d = lvl('D', 8);
    expect(d.spells).toEqual(expect.arrayContaining(['callLightning', 'iceStorm']));
    expect(d.attacks[1].damage).toBe('2d8');
    expect(lvl('D', 4).ac).toBe(15);
  });

  it('a pick moves AC with Unarmored Defense, and a druid’s hide stops at +2 DEX', () => {
    const at = (code, level, picks) => applyLevel(createUnit(code, 0, 0), level, picks);
    expect(at('Z', 4, { 4: 'con' }).ac).toBe(at('Z', 3).ac + 1);
    expect(at('M', 4, { 4: 'wis' }).ac).toBe(at('M', 3).ac + 1);
    expect(at('D', 8, { 4: 'dex' }).ac).toBe(at('D', 3).ac + 1); // DEX 14: +2
    expect(at('D', 8, { 4: 'dex', 8: 'dex' }).ac).toBe(at('D', 3).ac + 1); // DEX 16 still +2
  });

  it('heroes built from a party record play the class it names', () => {
    const s = newCampaign('normal', {}, { F: 'Z', W: 'S', R: 'M', C: 'D' });
    expect(heroUnit('R', s.party.R).cls).toBe('Monk');
    expect(heroUnit('C', s.party.C).cls).toBe('Druid');
  });
});

describe('the barbarian', () => {
  const rows = ['#######', '#Z.o..#', '#.....#', '#######'];

  it('rages once a fight: +2 melee damage, half from weapons, advantage on STR saves', () => {
    const g = fight(rows);
    const z = find(g, 'Z');
    const orc = find(g, 'o');
    turnOf(g, z);
    expect(g.doAction(z, 'rage')).toMatchObject({ ok: true });
    expect(z.bonusUsed).toBe(true);
    expect(g.damageBonus(z, z.attacks[0])).toBe(5);
    expect(g.damageBonus(z, z.attacks[1])).toBe(3); // the thrown axe gets no rage
    turnOf(g, z);
    expect(g.actionProblem(z, 'rage')).toBe('Already raging');
    // Half damage from the orc's greataxe.
    orc.x = 2;
    turnOf(g, orc);
    g.rng = seq(0.9, 0.5);
    const r = g.attack(orc, z, orc.attacks[0]);
    expect(r.hit).toBe(true);
    expect(r.resisted).toBe(true);
    // STR saves with advantage: a 1 and a 20.
    g.rng = seq(0, 0.99);
    expect(g.save(z, 'str', 15).d20).toBe(20);
    g.rng = seq(0, 0.99);
    expect(g.save(z, 'dex', 15).d20).toBe(20); // Danger Sense
  });

  it('Reckless Attack: advantage on its STR melee attacks, and against it until its next turn', () => {
    const g = fight(rows);
    const z = find(g, 'Z');
    const orc = find(g, 'o');
    orc.x = 2;
    turnOf(g, z);
    expect(g.doAction(z, 'reckless')).toMatchObject({ ok: true });
    expect(z.actionUsed || z.bonusUsed).toBe(false); // free
    expect(g.attackMods(z, orc, z.attacks[0]).adv).toContain('reckless');
    expect(g.attackMods(orc, z, orc.attacks[0]).adv).toContain('target is reckless');
    turnOf(g, z);
    expect(z.reckless).toBe(false);
  });

  it('Frenzy: while raging, one more melee attack as a bonus action', () => {
    const g = fight(rows);
    const z = find(g, 'Z');
    const orc = find(g, 'o');
    orc.x = 2;
    orc.hp = orc.maxHp = 200;
    turnOf(g, z);
    z.raging = true;
    g.attack(z, orc, z.attacks[0]);
    expect(g.canAttack(z)).toBe(false);
    expect(g.bonusStrike(z, z.attacks[0])).toBe('frenzy');
    expect(g.attackProblem(z, orc, z.attacks[1])).toBe('Frenzy: a melee weapon only');
    expect(g.attack(z, orc, z.attacks[0])).toMatchObject({ ok: true, bonus: 'frenzy' });
    expect(z.bonusUsed).toBe(true);
    expect(g.attackProblem(z, orc, z.attacks[0])).toBe('Action already used this turn');
  });
});

describe('the sorcerer', () => {
  const rows = ['#########', '#S.....o#', '#.......#', '#########'];

  it('Quickened Spell puts an action spell on the bonus action, then only a cantrip', () => {
    const g = fight(rows);
    const s = find(g, 'S');
    const orc = find(g, 'o');
    orc.hp = orc.maxHp = 200;
    turnOf(g, s);
    expect(g.doAction(s, 'quicken')).toMatchObject({ ok: true, armed: true, left: 1 });
    expect(g.actionProblem(s, 'quicken')).toBeNull(); // pressing again cancels
    const r = g.castSpell(s, 'scorchingRay', orc);
    expect(r).toMatchObject({ ok: true, quickened: true });
    expect(s).toMatchObject({ bonusUsed: true, actionUsed: false, quickened: false });
    expect(g.spellProblem(s, 'burningHands', orc)).toBe('After a Quickened spell, your action can cast only a cantrip');
    expect(g.attackProblem(s, orc, s.attacks[0])).toBeNull(); // Fire Bolt is still fine
    turnOf(g, s);
    expect(g.actionProblem(s, 'quicken')).toBe('Not enough sorcery points (2)');
  });

  it('cancelling Quickened Spell gives the points back', () => {
    const g = fight(rows);
    const s = find(g, 'S');
    turnOf(g, s);
    g.doAction(s, 'quicken');
    expect(g.doAction(s, 'quicken')).toMatchObject({ armed: false, left: 3 });
  });

  it('a Quickened Spell left unused gives its points back next turn', () => {
    const g = fight(rows);
    const s = find(g, 'S');
    turnOf(g, s);
    g.doAction(s, 'quicken');
    turnOf(g, s);
    expect(s).toMatchObject({ quickened: false, sorcery: 3 });
  });

  it('Elemental Affinity adds CHA to Fire Bolt and fire spells', () => {
    const s = lvl('S', 6);
    const g = fight(rows);
    expect(g.damageBonus(s, s.attacks[0])).toBe(4); // CHA 18 by level 6
    expect(g.damageBonus(lvl('S', 5), s.attacks[0])).toBe(0);
    expect(g.affinity(s, { total: 10, bonus: 0 })).toMatchObject({ total: 14, affinity: 4 });
  });
});

describe('the monk', () => {
  const rows = ['#######', '#M.o..#', '#.....#', '#######'];

  it('Martial Arts: an unarmed strike as a bonus action after the Attack action', () => {
    const g = fight(rows);
    const m = find(g, 'M');
    const orc = find(g, 'o');
    orc.x = 2;
    orc.hp = orc.maxHp = 200;
    turnOf(g, m);
    expect(g.bonusStrike(m)).toBeNull(); // no Attack action yet
    g.attack(m, orc, m.attacks[1]);
    expect(g.attackProblem(m, orc, m.attacks[1])).toBe('Martial Arts: an unarmed strike only');
    expect(g.attack(m, orc, m.attacks[0])).toMatchObject({ ok: true, bonus: 'martial' });
    expect(g.attackProblem(m, orc, m.attacks[0])).toBe('Action already used this turn');
  });

  it('Flurry of Blows: 1 ki for two unarmed strikes, each may knock the foe prone', () => {
    const g = fight(rows);
    const m = find(g, 'M');
    const orc = find(g, 'o');
    orc.x = 2;
    orc.hp = orc.maxHp = 200;
    turnOf(g, m);
    expect(g.actionProblem(m, 'flurry')).toBe('Take the Attack action first');
    g.attack(m, orc, m.attacks[0]);
    expect(g.doAction(m, 'flurry')).toMatchObject({ ok: true, left: 2 });
    g.rng = seq(0.9, 0.5, 0); // a hit, damage, the orc's DEX save a 1
    const r = g.attack(m, orc, m.attacks[0]);
    expect(r).toMatchObject({ bonus: 'flurry', hit: true });
    expect(r.topple).toMatchObject({ stat: 'dex', success: false, condition: 'prone' });
    expect(g.has(orc, 'prone')).toBe(true);
    expect(g.attack(m, orc, m.attacks[0])).toMatchObject({ ok: true, bonus: 'flurry' });
    expect(m.strikes).toBe(0);
  });

  it('Patient Defense and Step of the Wind cost ki; none left, none to use', () => {
    const g = fight(rows);
    const m = find(g, 'M');
    turnOf(g, m);
    const moves = m.movesLeft;
    g.doAction(m, 'stepOfTheWind');
    expect(m).toMatchObject({ ki: 2, disengaged: true, movesLeft: moves + m.speed });
    m.ki = 0;
    turnOf(g, m);
    expect(g.actionProblem(m, 'patientDefense')).toBe('No ki left this fight');
  });

  it('Deflect Missiles takes its die off a ranged weapon hit', () => {
    const g = fight(['#######', '#M...g#', '#.....#', '#######']);
    const m = find(g, 'M');
    const gob = find(g, 'g');
    turnOf(g, gob);
    g.rng = seq(0.95);
    const r = g.attack(gob, m, gob.attacks[1]);
    expect(r.hit).toBe(true);
    expect(r.deflect.total).toBeGreaterThanOrEqual(7);
    expect(m.reactionUsed).toBe(true);
  });

  it('Stunning Strike: an armed melee hit spends ki, and a stunned foe loses its turn', () => {
    for (const code of ['o', 'g', 'n', 'w']) { // aggressive, skirmisher, caster, boss with a spell
      const g = fight(['#########', `#M${code}.....#`, '#.......#', '#########'], seq(0.99));
      const m = find(g, 'M');
      applyLevel(m, 5);
      const foe = find(g, code);
      foe.hp = foe.maxHp = 300;
      turnOf(g, m);
      expect(g.doAction(m, 'stunningStrike')).toMatchObject({ armed: true });
      g.rng = seq(0.9, 0.5, 0); // a hit, damage, a failed CON save
      const r = g.attack(m, foe, m.attacks[0]);
      expect(r.stun).toMatchObject({ success: false, condition: 'stunned' });
      expect(m.ki).toBe(4);
      expect(g.save(foe, 'dex', 5).success).toBe(false);
      expect(g.attackMods(m, foe, m.attacks[0]).adv).toContain('target stunned');
      // Its turn: nothing at all.
      g.rng = seq();
      turnOf(g, foe);
      const memo = {};
      let acted = 0;
      for (let i = 0; i < 10; i++) {
        const step = nextMonsterStep(g, foe, memo);
        if (step.type === 'end') break;
        acted++;
        if (step.type === 'attack') g.attack(foe, step.target, step.attack);
        else if (step.type === 'move') g.move(foe, step.x, step.z);
        else if (step.type === 'spell') g.castSpell(foe, step.id, step.target);
        else g.doAction(foe, step.id);
      }
      expect(acted).toBe(0);
      expect(m.hp).toBe(m.maxHp);
      g.endTurn();
      expect(g.has(foe, 'stunned')).toBe(false); // over as its turn ends
    }
  });
});

describe('the druid', () => {
  it('Shillelagh is a weapon attack with WIS', () => {
    const d = createUnit('D', 0, 0);
    const g = fight(['#####', '#D.o#', '#####']);
    expect(g.toHitBonus(d, d.attacks[0])).toBe(5);
    expect(g.damageBonus(d, d.attacks[0])).toBe(3);
  });

  it('Thunderwave knocks down everyone next to the druid who fails, friend or foe', () => {
    const g = fight(['#######', '#oDF..#', '#.....#', '#######']);
    const d = find(g, 'D');
    turnOf(g, d);
    g.rng = seq(0.5, 0.5, 0, 0.99); // damage dice, the orc fails, the fighter saves
    const r = g.castSpell(d, 'thunderwave');
    expect(r.ok).toBe(true);
    expect(r.saves.map((s) => s.unit.code).sort()).toEqual(['F', 'o']);
    expect(g.has(find(g, 'o'), 'prone')).toBe(true);
    expect(g.has(find(g, 'F'), 'prone')).toBe(false);
    turnOf(g, d);
    for (const u of g.units.filter((u) => u !== d)) u.x += 3;
    expect(g.spellProblem(d, 'thunderwave')).toBe('No one within 5 ft');
  });

  it('Entangle restrains those who fail a STR save', () => {
    const g = fight(['#########', '#D....oo#', '#.......#', '#########']);
    const d = find(g, 'D');
    turnOf(g, d);
    g.rng = seq(0, 0.99);
    const r = g.castSpell(d, 'entangle', { x: 6, z: 1 });
    expect(r.saves).toHaveLength(2);
    expect(g.units.filter((u) => u.code === 'o').map((o) => g.has(o, 'restrained'))).toEqual([true, false]);
  });

  it('Call Lightning: later bolts are free while the druid concentrates', () => {
    const g = fight(['###########', '#D.......o#', '#.........#', '###########']);
    const d = find(g, 'D');
    applyLevel(d, 5);
    const orc = find(g, 'o');
    orc.hp = orc.maxHp = 300;
    turnOf(g, d);
    g.castSpell(d, 'callLightning', orc);
    expect(d.slots[3]).toBe(1);
    expect(d.concentrating).toBe('callLightning');
    turnOf(g, d);
    expect(g.castSpell(d, 'callLightning', orc)).toMatchObject({ ok: true, slot: 0, again: true });
    expect(d.slots[3]).toBe(1);
    expect(d.concentrating).toBe('callLightning');
    g.endConcentration(d, 'damage');
    expect(d.storm).toBeNull();
  });
});

describe('dailies and weeklies', () => {
  it('bring a third class only from the gate, a third of the time', () => {
    const third = new Set(['Z', 'S', 'M', 'D']);
    const day = (i) => new Date(2026, 10, 30 + i).toISOString().slice(0, 10);
    expect(THIRD_FROM).toBe('2026-11-30');
    let n = 0;
    for (let i = -120; i < 0; i++) {
      const plan = dailyPlan(day(i));
      expect(Object.values(plan.classes).some((c) => third.has(c))).toBe(false);
    }
    for (let i = 0; i < 120; i++) n += Object.values(dailyPlan(day(i)).classes).filter((c) => third.has(c)).length;
    expect(n / (120 * 4)).toBeGreaterThan(0.2);
    expect(n / (120 * 4)).toBeLessThan(0.45);
    expect(Object.values(weeklyPlan('2026-11-23').classes).some((c) => third.has(c))).toBe(false);
  });
});
