import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { applyLevel } from '../src/game/units.js';

const d20 = (n) => (n - 1) / 20 + 0.001;

function fight(rows, rules) {
  const g = new Game(rows, { senses: false, rng: () => 0.5, ...(rules && { rules }) });
  g.start();
  while (g.current.team !== 'heroes') g.endTurn();
  return g;
}
const rows = ['#########', '#F.C...o#', '#.......#', '#########'];
const hero = (g, code) => g.units.find((u) => u.code === code);

describe('death saves', () => {
  it('leave a hero dying at 0 HP, out of the way of corpse spells', () => {
    const g = fight(rows);
    const f = hero(g, 'F');
    g.applyDamage(f, f.hp + 2, null);
    expect(f.alive).toBe(false);
    expect(f.dying).toMatchObject({ successes: 0, failures: 0 });
    expect(g.corpses()).not.toContain(f);
    expect(g.canEndOn(hero(g, 'C'), f.x, f.z)).toBe(false);
  });

  it('kill outright when the blow past 0 is the hero’s maximum', () => {
    const g = fight(rows);
    const f = hero(g, 'F');
    g.applyDamage(f, f.hp + f.maxHp, null);
    expect(f.dying).toBeFalsy();
  });

  it('are rolled as the dying hero’s turn comes round: three failures and out', () => {
    const g = fight(rows);
    const f = hero(g, 'F');
    g.applyDamage(f, f.hp, null);
    const saves = [];
    g.on('deathSave', (r) => saves.push(r));
    g.rng = () => d20(5);
    for (let i = 0; i < 40 && saves.length < 3; i++) g.endTurn();
    expect(saves.map((s) => s.failures)).toEqual([1, 2, 3]);
    expect(saves[2].result).toBe('dead');
    expect(f.dying).toBeNull();
  });

  it('a 1 is two failures; three successes is stable, with no more rolls', () => {
    const g = fight(rows);
    const f = hero(g, 'F');
    g.applyDamage(f, f.hp, null);
    g.rng = () => d20(1);
    const saves = [];
    g.on('deathSave', (r) => saves.push(r));
    while (!saves.length) g.endTurn();
    expect(saves[0].failures).toBe(2);
    f.dying = { successes: 0, failures: 0, stable: false };
    g.rng = () => d20(12);
    while (saves.length < 4) g.endTurn();
    expect(saves[3].result).toBe('stable');
    for (let i = 0; i < 12; i++) g.endTurn();
    expect(saves.length).toBe(4);
  });

  it('a 20 brings the hero round with 1 HP, prone, for their turn', () => {
    const g = fight(rows);
    const f = hero(g, 'F');
    g.applyDamage(f, f.hp, null);
    g.rng = () => d20(20);
    let tries = 0;
    do g.endTurn(); while (g.current !== f && tries++ < 20);
    expect(g.current).toBe(f);
    expect(f.alive).toBe(true);
    expect(f.hp).toBe(1);
    expect(f.conditions.prone).toBeUndefined(); // stood up at the start of the turn
  });

  it('healing brings a dying hero back, prone', () => {
    const g = fight(rows);
    const f = hero(g, 'F');
    const c = applyLevel(hero(g, 'C'), 1);
    g.applyDamage(f, f.hp, null);
    g.turn = g.order.indexOf(c);
    expect(g.spellProblem(c, 'healingWord', f)).toBeNull();
    const r = g.castSpell(c, 'healingWord', f);
    expect(r.ok).toBe(true);
    expect(f.alive).toBe(true);
    expect(f.hp).toBe(r.healed);
    expect(f.conditions.prone).toBeTruthy();
    expect(f.dying).toBeNull();
  });

  it('a potion from an ally brings them back too', () => {
    const g = fight(rows);
    const f = hero(g, 'F');
    const c = hero(g, 'C');
    c.potions = 1;
    c.x = 2;
    g.applyDamage(f, f.hp, null);
    g.turn = g.order.indexOf(c);
    expect(g.feedPotion(c, f).ok).toBe(true);
    expect(f.alive).toBe(true);
  });

  it('the whole party down is still a defeat', () => {
    const g = fight(['#######', '#F...o#', '#######']);
    const f = hero(g, 'F');
    g.applyDamage(f, f.hp, null);
    expect(f.dying).toBeTruthy();
    expect(g.over).toBe('defeat');
  });

  it('never under the first rules', () => {
    const g = fight(rows, 1);
    const f = hero(g, 'F');
    g.applyDamage(f, f.hp, null);
    expect(f.dying).toBeFalsy();
    expect(g.spellProblem(hero(g, 'C'), 'healingWord', f)).toBe('Choose an ally (or yourself)');
  });
});
