import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { applyLevel } from '../src/game/units.js';

const seq = (...vals) => () => (vals.length ? vals.shift() : 0.5);
const d20 = (n) => (n - 1) / 20 + 0.001;

function fight(rows, rules) {
  const g = new Game(rows, { senses: false, rng: () => 0.5, party: { W: { cls: 'K', level: 1, hp: 99, items: [] } }, ...(rules && { rules }) });
  g.start();
  while (g.current.team !== 'heroes') g.endTurn();
  return g;
}
const rows = ['#########', '#W.B...o#', '#.......#', '#########'];
const unit = (g, code) => g.units.find((u) => u.code === code);

describe('concentration', () => {
  it('a hurt caster keeps Hex on a CON save, and loses it on a failure', () => {
    const g = fight(rows);
    const k = unit(g, 'K');
    const orc = g.units.find((u) => u.team === 'monsters');
    g.turn = g.order.indexOf(k);
    expect(g.castSpell(k, 'hex', orc).ok).toBe(true);
    expect(k.concentrating).toBe('hex');
    const seen = [];
    g.on('concentration', (r) => seen.push(r));
    g.rng = seq(d20(19));
    g.applyDamage(k, 4, orc);
    expect(seen[0]).toMatchObject({ broken: false, save: { dc: 10 } });
    expect(orc.marked).toBe('hex');
    k.hp = k.maxHp = 60;
    g.rng = seq(d20(2));
    g.applyDamage(k, 24, orc);
    expect(seen[1]).toMatchObject({ broken: true, cause: 'damage', save: { dc: 12 } });
    expect(orc.marked).toBe(false);
    expect(k.mark).toBeNull();
    expect(k.concentrating).toBeNull();
  });

  it('one spell at a time: Greater Invisibility ends the bard’s Fear', () => {
    const g = fight(['#########', '#B..W.o.#', '#.......#', '#########']);
    const b = applyLevel(unit(g, 'B'), 7);
    const orc = g.units.find((u) => u.team === 'monsters');
    g.turn = g.order.indexOf(b);
    g.rng = () => 0;
    g.castSpell(b, 'fear', { x: 7, z: 1 });
    expect(g.has(orc, 'frightened')).toBe(true);
    expect(b.concentrating).toBe('fear');
    b.actionUsed = false;
    b.x = 3;
    g.rng = () => 0.5;
    g.castSpell(b, 'greaterInvisibility', unit(g, 'K'));
    expect(g.has(orc, 'frightened')).toBe(false);
    expect(b.concentrating).toBe('greaterInvisibility');
  });

  it('ends when the caster drops', () => {
    const g = fight(rows);
    const b = applyLevel(unit(g, 'B'), 7);
    const k = unit(g, 'K');
    b.x = 2;
    g.turn = g.order.indexOf(b);
    g.castSpell(b, 'greaterInvisibility', k);
    g.applyDamage(b, 200, null);
    expect(k.invisibleFrom).toBeNull();
  });

  it('is not a thing under the first rules', () => {
    const g = fight(rows, 1);
    const k = unit(g, 'K');
    const orc = g.units.find((u) => u.team === 'monsters');
    g.turn = g.order.indexOf(k);
    g.castSpell(k, 'hex', orc);
    expect(k.concentrating).toBeFalsy();
    const before = g.rolls;
    g.applyDamage(k, 4, orc);
    expect(g.rolls).toBe(before);
  });
});
