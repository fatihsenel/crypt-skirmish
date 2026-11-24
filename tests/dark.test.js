import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { levelById } from '../src/game/maps.js';

const ROOM = { rows: ['##########', '#F......o#', '#C.......#', '##########'], dark: [[5, 1, 8, 2]] };

function fight(rules) {
  const g = new Game(ROOM, { senses: false, rng: () => 0.5, ...(rules && { rules }) });
  g.start();
  const f = g.units.find((u) => u.cls === 'Fighter');
  const orc = g.units.find((u) => u.team === 'monsters');
  return { g, f, orc };
}

describe('dark areas', () => {
  it('hide a foe past the heroes’ torches, and only from heroes', () => {
    const { g, f, orc } = fight();
    expect(g.dim(8, 1)).toBe(true);
    expect(g.inSight(f, orc)).toBe(false);
    expect(g.inSight(orc, f)).toBe(true); // the orc sees the torch
    expect(g.attackMods(f, orc, f.attacks[1]).dis).toContain('in the dark');
    f.x = 6; // 2 tiles off: in the torchlight
    expect(g.dim(8, 1)).toBe(false);
    expect(g.inSight(f, orc)).toBe(true);
    expect(g.attackMods(f, orc, f.attacks[1]).dis).not.toContain('in the dark');
  });

  it('are plain floor under rules 5', () => {
    const { g, f, orc } = fight(5);
    expect(g.dark.size).toBe(0);
    expect(g.inSight(f, orc)).toBe(true);
  });

  it('darken the Catacombs’ side rooms', () => {
    const g = new Game(levelById('catacombs'), { rng: () => 0.5 });
    expect(g.dark.has('1,7')).toBe(true);
    expect(g.dark.has('12,8')).toBe(true);
    expect(g.dark.has('7,7')).toBe(false);
  });
});
