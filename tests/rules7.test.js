import { describe, it, expect } from 'vitest';
import { Game, MORALE_ROUNDS } from '../src/game/combat.js';
import { levelById } from '../src/game/maps.js';
import { applyCommand } from '../src/game/replay.js';
import { makeFloor } from '../src/game/endless.js';

const DARK = { rows: ['##########', '#F......o#', '#C.......#', '##########'], dark: [[5, 1, 8, 2]] };

function start(level, opts = {}) {
  const g = new Game(level, { senses: false, rng: () => 0.5, ...opts });
  g.start();
  const f = g.units.find((u) => u.cls === 'Fighter');
  while (g.current !== f) g.endTurn();
  return { g, f, c: g.units.find((u) => u.cls === 'Cleric'), foe: g.units.find((u) => u.team === 'monsters') };
}

describe('torches and Light (rules 7)', () => {
  it('a thrown torch lights the dark around it, once a fight, with the bonus action', () => {
    const { g, f, foe } = start(DARK);
    expect(g.inSight(f, foe)).toBe(false);
    const r = applyCommand(g, { type: 'torch', x: 5, z: 1 });
    expect(r).toMatchObject({ ok: true, radius: 2, spell: false });
    expect(f.bonusUsed).toBe(true);
    expect(f.actionUsed).toBe(false);
    expect(g.dim(7, 1)).toBe(false);
    expect(g.inSight(f, foe)).toBe(false); // the orc stands at 8, 3 tiles from the torch
    expect(g.dim(8, 1)).toBe(true);
    f.bonusUsed = false;
    expect(g.lightProblem(f, 5, 2)).toBe('Your torch is thrown already');
  });

  it('Light is an action for casters, reaching 30 ft and lighting 20 ft', () => {
    const { g, f, c } = start(DARK);
    expect(g.lightProblem(f, 4, 1, true)).toBe('Brannoc doesn’t know Light');
    while (g.current !== c) g.endTurn();
    expect(g.lightProblem(c, 8, 2, true)).toBe('Too far: 30 ft at most');
    const r = applyCommand(g, { type: 'torch', x: 6, z: 2, spell: true });
    expect(r).toMatchObject({ ok: true, radius: 4 });
    expect(c.actionUsed).toBe(true);
    expect(g.dim(8, 1)).toBe(false);
  });

  it('a burning creature lights the tiles around it', () => {
    const { g, f, foe } = start(DARK);
    expect(g.inSight(f, foe)).toBe(false);
    g.addCondition(foe, 'burning', { by: f });
    expect(g.inSight(f, foe)).toBe(true);
  });

  it('are not there under rules 6, and not in a room without dark', () => {
    expect(start(DARK, { rules: 6 }).g.lightProblem(start(DARK, { rules: 6 }).f, 2, 1)).toBe('This fight began before torches');
    const { g, f } = start({ rows: DARK.rows });
    expect(g.lightProblem(f, 2, 1)).toBe('Nothing here needs light');
  });
});

describe('morale (rules 7)', () => {
  it('a goblin brought under a quarter of its HP may break and run, and blows don’t stop it', () => {
    const g = new Game(['#######', '#F.g..#', '#C....#', '#######'], { senses: false, rng: () => 0.05 }); // every d20 a 2
    g.start();
    const gob = g.units.find((u) => u.code === 'g');
    const seen = [];
    g.on('morale', (r) => seen.push(r));
    g.applyDamage(gob, gob.hp - 1, null);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ why: 'hurt', success: false });
    expect(gob.turned).toBe(MORALE_ROUNDS);
    expect(gob.routed).toBe(true);
    g.heal(gob, 1);
    g.applyDamage(gob, 1, null);
    expect(gob.turned).toBe(MORALE_ROUNDS); // still running
    expect(seen).toHaveLength(1); // once a fight
  });

  it('Grukk falling makes his goblins test their nerve; undead never do', () => {
    const g = new Game(['########', '#F.b.g.#', '#C..s..#', '########'], { senses: false, rng: () => 0.05 });
    g.start();
    const boss = g.units.find((u) => u.code === 'b');
    const gob = g.units.find((u) => u.code === 'g');
    const skel = g.units.find((u) => u.code === 's');
    g.applyDamage(boss, 999, null);
    expect(gob.turned).toBe(MORALE_ROUNDS);
    expect(skel.turned).toBeFalsy();
  });

  it('is not there under rules 6', () => {
    const g = new Game(['#######', '#F.g..#', '#C....#', '#######'], { senses: false, rng: () => 0.05, rules: 6 });
    g.start();
    const gob = g.units.find((u) => u.code === 'g');
    g.applyDamage(gob, gob.hp - 1, null);
    expect(gob.turned).toBeFalsy();
  });
});

describe('smashing barrels and crates (rules 7)', () => {
  it('a blow always lands; at 0 the barrel is gone and the tile is open floor', () => {
    const { g, f } = start({ rows: ['########', '#F&.o..#', '#C=....#', '########'] });
    expect(g.grid.isSolid(2, 1)).toBe(true);
    expect(g.smashProblem(f, 3, 1)).toBe('Pick a barrel or crate');
    const r = applyCommand(g, { type: 'smash', x: 2, z: 1 });
    expect(r).toMatchObject({ ok: true, prop: 'barrel' });
    expect(r.damage).toBeGreaterThan(0);
    expect(f.actionUsed).toBe(true);
    if (r.broken) expect(g.grid.isSolid(2, 1)).toBe(false);
    expect(g.smashProblem(f, 2, 2)).toBe('Action already used this turn');
  });

  it('a crate takes 8 and keeps what it has left between blows', () => {
    const { g } = start({ rows: ['########', '#F=.o..#', '#C.....#', '########'] }, { rng: () => 0 }); // 1s on every die
    const r = applyCommand(g, { type: 'smash', x: 2, z: 1 });
    expect(r.damage).toBe(1 + 3); // longsword 1, STR +3
    expect(r).toMatchObject({ broken: false, hp: 4 });
    expect(g.grid.props.get('2,1').hp).toBe(4);
  });

  it('only from rules 7, and never a column', () => {
    const { g, f } = start({ rows: ['########', '#F&.o..#', '#C|....#', '########'] }, { rules: 6 });
    expect(g.smashProblem(f, 2, 1)).toBe('This fight began before smashing');
    const s = start({ rows: ['########', '#F&.o..#', '#C|....#', '########'] });
    expect(s.g.smashProblem(s.f, 2, 2)).toBe('Pick a barrel or crate');
  });
});

describe('the gelatinous cube (rules 7)', () => {
  it('engulfs, digests at the start of the turn, and lets go when a STR save is made', () => {
    const g = new Game(['#######', '#F.i..#', '#C....#', '#######'], { senses: false, rng: () => 0.5 });
    g.start();
    const f = g.units.find((u) => u.cls === 'Fighter');
    const cube = g.units.find((u) => u.code === 'i');
    f.x = 2;
    g.addCondition(f, 'engulfed', { by: cube });
    expect(g.has(f, 'restrained')).toBe(true);
    const bites = [];
    g.on('digest', (r) => bites.push(r));
    const hp = f.hp;
    g.digest(f);
    expect(bites).toHaveLength(1);
    expect(f.hp).toBe(hp - bites[0].damage);
    expect(bites[0].save.dc).toBe(12);
    expect(g.has(f, 'engulfed')).toBe(!bites[0].save.success);
    expect(g.has(f, 'restrained')).toBe(g.has(f, 'engulfed'));
  });

  it('frees whoever it holds when it dies', () => {
    const g = new Game(['#######', '#F.i..#', '#C....#', '#######'], { senses: false, rng: () => 0.5 });
    g.start();
    const f = g.units.find((u) => u.cls === 'Fighter');
    const cube = g.units.find((u) => u.code === 'i');
    g.addCondition(f, 'engulfed', { by: cube });
    g.applyDamage(cube, 999, f);
    expect(g.has(f, 'engulfed')).toBe(false);
    expect(g.has(f, 'restrained')).toBe(false);
  });

  it('is transparent: hidden from the start, spotted next to it or with passive Perception 15', () => {
    const g = new Game(['########', '#F...i.#', '#C.....#', '########'], { rng: () => 0.5 });
    g.start();
    const f = g.units.find((u) => u.cls === 'Fighter');
    const cube = g.units.find((u) => u.code === 'i');
    expect(cube.hidden).toBe(15);
    expect(g.spotsHidden(f, cube)).toBe(false);
    f.x = 4;
    expect(g.spotsHidden(f, cube)).toBe(true);
  });

  it('waits in the Sunken Halls only from rules 7', () => {
    const level = levelById('halls');
    expect(new Game(level).units.some((u) => u.code === 'i')).toBe(true);
    expect(new Game(level, { rules: 6 }).units.some((u) => u.code === 'i')).toBe(false);
  });

  it('turns up on some generation 6 Endless floors, never generation 5', () => {
    let six = 0, five = 0;
    for (let seed = 1; seed <= 60; seed++) {
      for (const floor of [5, 6, 8]) {
        if (makeFloor(seed, floor, 6).rows.join('').includes('i')) six++;
        if (makeFloor(seed, floor, 5).rows.join('').includes('i')) five++;
      }
    }
    expect(six).toBeGreaterThan(0);
    expect(five).toBe(0);
  });
});
