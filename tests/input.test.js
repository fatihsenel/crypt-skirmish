import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { tileCommand, stepTile, ARROWS } from '../src/input.js';

function setTurn(game, i) {
  game.order = [game.units[i], ...game.units.filter((_, j) => j !== i)];
  game.turn = 0;
  game.beginTurn();
  return game.units[i];
}

const helpers = (game) => ({
  unitAt: (x, z) => game.units.find((u) => u.alive && u.x === x && u.z === z) ?? null,
  spellTarget: () => null,
});

describe('a click on a tile', () => {
  it('moves to an open tile in reach, and says when it is too far', () => {
    const game = new Game(['##################', '#F..............g#', '##################'], { senses: false });
    game.start();
    const f = setTurn(game, 0);
    expect(tileCommand(game, f, { x: 3, z: 1 }, null, helpers(game))).toEqual({ cmd: { type: 'move', x: 3, z: 1 } });
    expect(tileCommand(game, f, { x: 14, z: 1 }, null, helpers(game))).toEqual({ toast: 'Too far, not enough movement left' });
    expect(tileCommand(game, f, { x: f.x, z: f.z }, null, helpers(game))).toBeNull(); // the hero's own tile
  });

  it('attacks an enemy in reach with its best attack', () => {
    const game = new Game(['#####', '#Fg.#', '#####'], { senses: false });
    game.start();
    const f = setTurn(game, 0);
    const g = game.units[1];
    const r = tileCommand(game, f, { x: g.x, z: g.z }, null, helpers(game));
    expect(r.cmd).toEqual({ type: 'attack', target: 1, attack: f.attacks.indexOf(game.bestAttack(f, g)) });
  });

  it('asks for an enemy when shoving an empty tile', () => {
    const game = new Game(['#####', '#Fg.#', '#####'], { senses: false });
    game.start();
    const f = setTurn(game, 0);
    expect(tileCommand(game, f, { x: 1, z: 1 }, { kind: 'shove' }, helpers(game))).toEqual({ toast: 'Click an enemy next to you' });
    expect(tileCommand(game, f, { x: 2, z: 1 }, { kind: 'shove' }, helpers(game))).toEqual({ cmd: { type: 'shove', target: 1 } });
  });
});

describe('the keyboard cursor', () => {
  const grid = new Game(['#####', '#...#', '#.#.#', '#...#', '#####'], { senses: false }).grid;
  // A plain top-down view: x to the right, z down the screen.
  const flat = (x, z) => ({ x: x * 40, y: z * 40 });
  // The board seen at 45°, as the game shows it: +x goes down-right, +z down-left.
  const iso = (x, z) => ({ x: (x - z) * 40, y: (x + z) * 20 });

  it('steps one tile the way the arrow points on screen', () => {
    expect(stepTile(grid, { x: 1, z: 1 }, ARROWS.ArrowRight, flat)).toEqual({ x: 2, z: 1 });
    expect(stepTile(grid, { x: 1, z: 1 }, ARROWS.ArrowDown, flat)).toEqual({ x: 1, z: 2 });
    expect(stepTile(grid, { x: 1, z: 2 }, ARROWS.ArrowRight, iso)).toEqual({ x: 2, z: 1 }); // a diagonal on the grid
    // Straight down is the pillar: it slips to one side instead of sticking.
    expect([{ x: 2, z: 1 }, { x: 1, z: 2 }]).toContainEqual(stepTile(grid, { x: 1, z: 1 }, ARROWS.ArrowDown, iso));
  });

  it('goes around walls and stays put at the edge', () => {
    expect(stepTile(grid, { x: 2, z: 1 }, ARROWS.ArrowDown, flat)).not.toEqual({ x: 2, z: 2 }); // the pillar
    expect(stepTile(grid, { x: 1, z: 1 }, ARROWS.ArrowUp, flat)).toEqual({ x: 1, z: 1 });
    expect(stepTile(grid, { x: 1, z: 1 }, ARROWS.ArrowLeft, flat)).toEqual({ x: 1, z: 1 });
  });
});
