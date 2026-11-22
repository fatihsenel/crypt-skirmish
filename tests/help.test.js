import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { applyCommand, unitRef } from '../src/game/replay.js';

/** Brannoc and Wren on one side of an orc. */
function fight() {
  const g = new Game(['#######', '#F.o..#', '#.R...#', '#######'], { senses: false, rng: () => 0.5 });
  g.start();
  const f = g.units.find((u) => u.cls === 'Fighter');
  const r = g.units.find((u) => u.cls === 'Rogue');
  const orc = g.units.find((u) => u.team === 'monsters');
  f.x = 2; // next to the orc, Wren's not
  r.x = 5; r.z = 2;
  while (g.current !== f) g.endTurn();
  return { g, f, r, orc };
}

describe('the Help action', () => {
  it('gives the next ally to attack the foe advantage, once', () => {
    const { g, f, r, orc } = fight();
    const res = applyCommand(g, { type: 'help', target: unitRef(g, orc) });
    expect(res).toMatchObject({ ok: true, unit: f, target: orc });
    expect(f.actionUsed).toBe(true);
    expect(g.attackMods(f, orc, f.attacks[0]).adv).not.toContain('help from Brannoc'); // not the helper
    const bow = r.attacks.find((a) => a.name === 'Shortbow');
    expect(g.attackMods(r, orc, bow).adv).toContain('help from Brannoc');
    while (g.current !== r) g.endTurn();
    const hit = g.attack(r, orc, bow);
    expect(hit.mods.adv).toContain('help from Brannoc');
    expect(hit.rolls).toHaveLength(2);
    expect(orc.helped).toBe(null);
    expect(g.attackMods(r, orc, bow).adv).not.toContain('help from Brannoc');
  });

  it('wears off at the helper’s next turn', () => {
    const { g, f, r, orc } = fight();
    g.help(f, orc);
    g.endTurn();
    while (g.current !== f) g.endTurn();
    expect(orc.helped).toBe(null);
    expect(g.attackMods(r, orc, r.attacks[1]).adv).not.toContain('help from Brannoc');
  });

  it('needs the foe next to the helper and an action left', () => {
    const { g, f, r, orc } = fight();
    expect(g.helpProblem(r, orc)).toBe('Must stand next to them');
    expect(g.helpProblem(f, r)).toBe('Choose an enemy');
    expect(g.helpProblem(orc, f)).toBe('Only heroes help');
    f.actionUsed = true;
    expect(g.helpProblem(f, orc)).toBe('Action already used this turn');
  });
});
