import { describe, it, expect, vi } from 'vitest';
import { Game } from '../src/game/combat.js';
import { tileCommand, stepTile, ARROWS, tileSummary, enterStep, surroundings, floorBehind, longPress } from '../src/input.js';

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

describe('a click on a party member standing in front of a tile', () => {
  // F and W are heroes, g a goblin far off. The figure clicked stands in front of a tile.
  const setup = () => {
    const game = new Game(['##########', '#F.W....g#', '#........#', '##########'], { senses: false });
    game.start();
    const f = setTurn(game, 0);
    const [, w, g] = game.units;
    return { game, f, w, g };
  };

  it('goes to the free tile behind an ally when the hero can walk there', () => {
    const { game, w } = setup();
    expect(floorBehind(game, w, { x: 4, z: 2 })).toEqual({ x: 4, z: 2 });
  });

  it('keeps the figure when the tile behind is taken, out of reach, or the figure is the hero or a foe', () => {
    const { game, f, w, g } = setup();
    expect(floorBehind(game, w, { x: 8, z: 1 })).toBeNull(); // the goblin's tile
    expect(floorBehind(game, w, { x: 3, z: 1 })).toBeNull(); // the ally's own tile
    f.movesLeft = 0;
    expect(floorBehind(game, w, { x: 4, z: 2 })).toBeNull(); // no movement left
    f.movesLeft = 6;
    expect(floorBehind(game, f, { x: 2, z: 2 })).toBeNull(); // the hero: the card, not a move
    expect(floorBehind(game, g, { x: 7, z: 2 })).toBeNull(); // a foe: an attack
    expect(floorBehind(game, w, null)).toBeNull(); // nothing under the pointer
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

describe('the keyboard cursor read aloud', () => {
  it('names who stands on the tile with their HP, or a chest, or the floor', () => {
    const game = new Game(['#####', '#Fg.#', '#####'], { senses: false });
    game.start();
    const f = setTurn(game, 0);
    const g = game.units[1];
    g.hp = 3;
    const h = { ...helpers(game), explored: () => true };
    expect(tileSummary(game, { x: f.x, z: f.z }, h)).toBe(`${f.name} (your turn), ${f.hp} of ${f.maxHp} HP`);
    expect(tileSummary(game, { x: g.x, z: g.z }, h)).toBe(`${g.name}, 3 of ${g.maxHp} HP`);
    expect(tileSummary(game, { x: 3, z: 1 }, h)).toBe('Floor');
    expect(tileSummary(game, { x: 3, z: 1 }, { ...h, explored: () => false })).toBe('Unexplored');
  });
});

describe('Enter on the keyboard cursor', () => {
  const move = { cmd: { type: 'move', x: 3, z: 1 } };
  it('picks a tile first and does it on the second Enter', () => {
    expect(enterStep(null, { x: 3, z: 1 }, move)).toBe('arm');
    expect(enterStep('3,1', { x: 3, z: 1 }, move)).toBe('act');
    expect(enterStep('2,1', { x: 3, z: 1 }, move)).toBe('arm'); // picked elsewhere: pick this one
  });
  it('says at once why a tile cannot be used', () => {
    expect(enterStep(null, { x: 3, z: 1 }, { toast: 'Too far' })).toBe('act');
    expect(enterStep(null, { x: 3, z: 1 }, null)).toBe('act');
  });
});

describe('reading out the surroundings', () => {
  it('gives the hero, then enemies in sight nearest first, and fallen allies', () => {
    const game = new Game(['##########', '#F.g....g#', '#C.......#', '##########'], { senses: false });
    game.start();
    const f = setTurn(game, 0);
    const [near, far] = game.units.filter((u) => u.team === 'monsters').sort((a, b) => a.x - b.x);
    const c = game.units.find((u) => u.team === 'heroes' && u !== f);
    c.hp = 0;
    c.alive = false;
    const text = surroundings(game, f, { seen: () => true });
    const reach = (e) => (game.bestAttack(f, e) ? ', in range' : '');
    expect(text).toBe(`${f.name}: ${f.hp} of ${f.maxHp} HP, ${f.movesLeft * 5} ft of movement. `
      + `Enemies in sight: ${near.name}, 10 ft, ${near.hp} of ${near.maxHp} HP${reach(near)}; `
      + `${far.name}, 35 ft, ${far.hp} of ${far.maxHp} HP${reach(far)}. `
      + `Down: ${c.name}.`);
  });

  it('says when no enemy is in sight, and marks one the hero can attack now', () => {
    const game = new Game(['#####', '#Fg.#', '#####'], { senses: false });
    game.start();
    const f = setTurn(game, 0);
    const g = game.units[1];
    expect(surroundings(game, f, { seen: () => false })).toMatch(/No enemies in sight\.$/);
    expect(surroundings(game, f, { seen: () => true })).toContain(`${g.name}, 5 ft, ${g.hp} of ${g.maxHp} HP, in range`);
  });
});

describe('reading out a chasm’s edge', () => {
  it('says a foe next to the hero can be pushed over, or that a chasm is near', () => {
    const game = new Game(['#######', '#Fs_..#', '#.....#', '#######'], { senses: false });
    game.start();
    const f = setTurn(game, 0);
    expect(surroundings(game, f, { seen: () => true })).toMatch(/Skeleton stands at the chasm’s edge: Push sends it over\./);
    f.z = 2; f.x = 3;
    game.units[1].alive = false;
    expect(surroundings(game, f, { seen: () => true })).toMatch(/A chasm opens next to you\./);
  });
});

describe('a long press on a figure', () => {
  const setup = () => {
    const on = {};
    const dom = { addEventListener: (type, fn) => (on[type] ??= []).push(fn) };
    const fire = (type, ev) => on[type]?.forEach((fn) => fn(ev));
    const seen = [];
    const press = longPress(dom, { target: () => 'Maela', show: (who) => seen.push(`show ${who}`), hide: () => seen.push('hide') });
    const down = (t) => press.start({ pointerType: 'touch', clientX: 10, clientY: 10, timeStamp: t });
    return { press, fire, seen, down };
  };

  it('shows the card once the finger has stayed down, and that press isn’t a tap', () => {
    vi.useFakeTimers();
    const { press, fire, seen, down } = setup();
    down(0);
    vi.advanceTimersByTime(500);
    fire('pointerup', { timeStamp: 600 });
    expect(seen).toEqual(['show Maela']);
    expect(press.consume()).toBe(true);
    expect(press.consume()).toBe(false);
    vi.useRealTimers();
  });

  it('takes back a card the timer showed before a quick lift got through (a busy page): a tap', () => {
    vi.useFakeTimers();
    const { press, fire, seen, down } = setup();
    down(0);
    vi.advanceTimersByTime(500); // the lift, 60 ms in, is handled late
    fire('pointerup', { timeStamp: 60 });
    expect(seen).toEqual(['show Maela', 'hide']);
    expect(press.consume()).toBe(false);
    vi.useRealTimers();
  });

  it('shows nothing for a quick tap', () => {
    vi.useFakeTimers();
    const { press, fire, seen, down } = setup();
    down(0);
    fire('pointerup', { timeStamp: 60 });
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([]);
    expect(press.consume()).toBe(false);
    vi.useRealTimers();
  });
});
