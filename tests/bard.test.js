import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { applyLevel, createUnit, CLASS_CHOICES } from '../src/game/units.js';
import { dailyPlan } from '../src/game/daily.js';

/** A fight on `rows`, run on to the first hero's turn. */
function fight(rows, rng = () => 0.5) {
  const g = new Game(rows, { senses: false, rng });
  g.start();
  while (g.current.team !== 'heroes') g.endTurn();
  return g;
}

/** Dice that come up in this order (as fractions of the die), then 0.5. */
const seq = (...vals) => () => (vals.length ? vals.shift() : 0.5);

const rows = [
  '#########',
  '#B.F...o#',
  '#.......#',
  '#########',
];

describe('the bard', () => {
  it('fills the cleric’s slot and levels up to 8', () => {
    expect(CLASS_CHOICES.C).toEqual(['C', 'B']);
    const b = applyLevel(createUnit('B', 0, 0), 8);
    expect(b.stats.cha).toBe(20);
    expect(b.inspiration).toBe(5);
    expect(b.inspirationDie).toBe(8);
    expect(b.spells).toEqual(expect.arrayContaining(['fear', 'massHealingWord', 'greaterInvisibility']));
    expect(b.slots).toEqual({ 1: 4, 2: 3, 3: 3, 4: 2 });
  });

  it('inspires an ally, not themself, with a bonus action and a use', () => {
    const g = fight(rows);
    const b = g.units.find((u) => u.code === 'B');
    const f = g.units.find((u) => u.code === 'F');
    g.turn = g.order.indexOf(b);
    expect(g.spellProblem(b, 'bardicInspiration', b)).toBe('Inspire an ally, not yourself');
    const r = g.castSpell(b, 'bardicInspiration', f);
    expect(r).toMatchObject({ ok: true, die: 6, left: 2 });
    expect(f.inspired).toMatchObject({ die: 6 });
    expect(b.bonusUsed).toBe(true);
    expect(b.slots).toEqual({ 1: 4, 2: 2 }); // no slot
    b.bonusUsed = false;
    expect(g.spellProblem(b, 'bardicInspiration', f)).toBe(`${f.name} is already inspired`);
  });

  it('adds the die to a near miss, and keeps it for one the die can’t turn', () => {
    const g = fight(rows);
    const f = g.units.find((u) => u.code === 'F');
    const orc = g.units.find((u) => u.team === 'monsters');
    orc.x = 4; orc.z = 1;
    f.inspired = { die: 6, by: null };
    g.turn = g.order.indexOf(f);
    // d20 = 1 + floor(0.3 * 20) = 7: a miss by far more than 6 keeps the die.
    const toHit = g.toHitBonus(f, f.attacks[0]);
    const ac = g.acOf(orc);
    let roll = (ac - toHit - 7 - 1) / 20; // a d20 just short of the AC minus 7
    g.rng = seq(Math.max(0, roll));
    let r = g.attack(f, orc, f.attacks[0]);
    expect(r.hit).toBe(false);
    expect(r.inspired).toBeNull();
    expect(f.inspired).not.toBeNull();
    // A miss by 1, and the d6 comes up 4: a hit.
    f.actionUsed = false;
    roll = (ac - toHit - 2) / 20; // d20 = ac - toHit - 1
    g.rng = seq(roll, 0.5);
    r = g.attack(f, orc, f.attacks[0]);
    expect(r.inspired).toMatchObject({ die: 6, total: 4 });
    expect(r.hit).toBe(true);
    expect(f.inspired).toBeNull();
  });

  it('helps a failed save', () => {
    const g = fight(rows);
    const f = g.units.find((u) => u.code === 'F');
    f.inspired = { die: 6, by: null };
    g.rng = seq(0.45, 0.99); // d20 10, then a 6 on the die
    const s = g.save(f, 'wis', 12);
    expect(s.inspired).toMatchObject({ total: 6 });
    expect(s.success).toBe(true);
  });

  it('Cutting Words turns a near hit on an ally into a miss', () => {
    const g = fight(rows);
    const b = g.units.find((u) => u.code === 'B');
    const f = g.units.find((u) => u.code === 'F');
    const orc = g.units.find((u) => u.team === 'monsters');
    orc.x = 4; orc.z = 1;
    g.turn = g.order.indexOf(orc);
    const atk = orc.attacks[0];
    const toHit = g.toHitBonus(orc, atk);
    const d20 = g.acOf(f) - toHit; // a hit by exactly 0
    g.rng = seq((d20 - 1) / 20, 0.99);
    const r = g.attack(orc, f, atk);
    expect(r.cutting).toMatchObject({ by: b, total: 6 });
    expect(r.hit).toBe(false);
    expect(b.reactionUsed).toBe(true);
    expect(b.inspiration).toBe(2);
  });

  it('Vicious Mockery hurts and gives disadvantage on the next attack', () => {
    const g = fight(rows);
    const b = g.units.find((u) => u.code === 'B');
    const orc = g.units.find((u) => u.team === 'monsters');
    g.turn = g.order.indexOf(b);
    g.rng = () => 0; // the orc rolls a 1
    const r = g.castSpell(b, 'viciousMockery', orc);
    expect(r.save.success).toBe(false);
    expect(r.damage).toBe(1);
    expect(g.has(orc, 'mocked')).toBe(true);
    const f = g.units.find((u) => u.code === 'F');
    expect(g.attackMods(orc, f, orc.attacks[0]).dis).toContain('mocked');
    g.turn = g.order.indexOf(orc);
    orc.x = 4;
    g.rng = () => 0.5;
    g.attack(orc, f, orc.attacks[0]);
    expect(g.has(orc, 'mocked')).toBe(false);
  });

  it('Shatter calls for CON saves, half on a success', () => {
    const g = fight(rows);
    const b = g.units.find((u) => u.code === 'B');
    const orc = g.units.find((u) => u.team === 'monsters');
    g.turn = g.order.indexOf(b);
    g.rng = () => 0.5;
    const r = g.castSpell(b, 'shatter', { x: orc.x, z: orc.z });
    expect(r.ok).toBe(true);
    expect(r.saves.map((s) => s.unit)).toEqual([orc]);
    expect(b.slots[2]).toBe(1);
  });

  it('Fear frightens foes in the cone and spares allies', () => {
    const g = fight(['#########', '#B..F.o.#', '#.......#', '#########']);
    const b = applyLevel(g.units.find((u) => u.code === 'B'), 5);
    const orc = g.units.find((u) => u.team === 'monsters');
    g.turn = g.order.indexOf(b);
    g.rng = () => 0;
    const r = g.castSpell(b, 'fear', { x: 7, z: 1 });
    expect(r.saves.map((s) => s.unit)).toEqual([orc]);
    expect(g.has(orc, 'frightened')).toBe(true);
  });

  it('Greater Invisibility: advantage out, disadvantage in', () => {
    const g = fight(rows);
    const b = applyLevel(g.units.find((u) => u.code === 'B'), 7);
    const f = g.units.find((u) => u.code === 'F');
    const orc = g.units.find((u) => u.team === 'monsters');
    b.x = 2; // next to the fighter
    g.turn = g.order.indexOf(b);
    expect(g.castSpell(b, 'greaterInvisibility', f).ok).toBe(true);
    expect(g.attackMods(f, orc, f.attacks[0]).adv).toContain('invisible');
    expect(g.attackMods(orc, f, orc.attacks[0]).dis).toContain('target invisible');
  });

  it('leaves fights without a bard to the same dice', () => {
    const g = fight(['#########', '#F.....o#', '#########']);
    const f = g.current;
    expect(g.save(f, 'wis', 30).inspired).toBeNull();
  });

  it('joins dailies from 2026-11-23 on, leaving earlier days as they were', () => {
    expect(dailyPlan('2026-11-22').classes).toEqual({ R: 'A', W: 'K' });
    expect(dailyPlan('2026-11-23').classes.C).toBe('B');
  });
});
