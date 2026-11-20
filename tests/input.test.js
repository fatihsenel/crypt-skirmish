import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { tileCommand } from '../src/input.js';

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
