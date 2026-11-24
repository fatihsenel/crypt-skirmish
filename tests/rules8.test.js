import { describe, it, expect } from 'vitest';
import { Game, BAR_DC, BAR_SPLINTER } from '../src/game/combat.js';
import { levelById } from '../src/game/maps.js';
import { applyCommand } from '../src/game/replay.js';
import { makeFloor } from '../src/game/endless.js';

/** A fight on `rows` with the Fighter's turn up; `rng` rolls every die. */
function start(rows, opts = {}) {
  const g = new Game(rows, { senses: false, rng: () => 0.5, ...opts });
  g.start();
  const f = g.units.find((u) => u.cls === 'Fighter');
  while (g.current !== f) g.endTurn();
  return { g, f, foe: g.units.find((u) => u.team === 'monsters') };
}

const turnOf = (g, u) => { while (g.current !== u) g.endTurn(); };

describe('barred doors (rules 8)', () => {
  const ROOM = ['#########', '#.F#....#', '#..+..o.#', '#C.#....#', '#########'];

  it('a hero shuts a door and drops its bar with the action', () => {
    const { g, f } = start(ROOM);
    const door = g.grid.doors.get('3,2');
    door.open = true;
    const r = applyCommand(g, { type: 'bar', x: 3, z: 2 });
    expect(r).toMatchObject({ ok: true, shut: true, dc: BAR_DC });
    expect(door).toMatchObject({ open: false, barred: { dc: BAR_DC } });
    expect(f.actionUsed).toBe(true);
    expect(g.barProblem(f, 3, 2)).toBe('Action already used this turn');
  });

  it('needs a hero next to the door with no one in the doorway', () => {
    const { g, f, foe } = start(ROOM);
    expect(g.barProblem(f, 3, 1)).toBe('Pick a door');
    f.x = 1;
    expect(g.barProblem(f, 3, 2)).toBe('Must stand next to it');
    f.x = 2;
    foe.x = 3;
    foe.z = 2;
    expect(g.barProblem(f, 3, 2)).toBe('Someone is in the doorway');
  });

  it('a monster has to break it: a failed STR check ends its move and splinters it', () => {
    const { g, f, foe } = start(ROOM, { rng: () => 0 }); // every d20 a 1
    applyCommand(g, { type: 'bar', x: 3, z: 2 });
    turnOf(g, foe);
    const r = g.move(foe, 2, 2);
    expect(r.interrupted).toBe(true);
    expect(r.steps.find((s) => s.type === 'bash').result).toMatchObject({ success: false, dc: BAR_DC });
    expect([foe.x, foe.z]).toEqual([4, 2]);
    expect(foe.movesLeft).toBe(0);
    expect(g.grid.doors.get('3,2')).toMatchObject({ open: false, barred: { dc: BAR_DC - BAR_SPLINTER } });
    expect(f.alive).toBe(true);
  });

  it('a monster that breaks the bar goes on through', () => {
    const { g, foe } = start(ROOM, { rng: () => 0.99 }); // every d20 a 20
    applyCommand(g, { type: 'bar', x: 3, z: 2 });
    turnOf(g, foe);
    const r = g.move(foe, 2, 2);
    expect(r.steps.map((s) => s.type)).toEqual(expect.arrayContaining(['bash', 'door']));
    expect([foe.x, foe.z]).toEqual([2, 2]);
    expect(g.grid.doors.get('3,2')).toMatchObject({ open: true, barred: false });
  });

  it('a hero lifts the bar by walking through, and rules 7 has no bars', () => {
    const { g, f } = start(ROOM);
    applyCommand(g, { type: 'bar', x: 3, z: 2 });
    g.move(f, 4, 1);
    expect(g.grid.doors.get('3,2')).toMatchObject({ open: true, barred: false });
    const old = start(ROOM, { rules: 7 });
    expect(old.g.barProblem(old.f, 3, 2)).toBe('This fight began before barring doors');
  });
});

describe('disarming traps (rules 8)', () => {
  const ROOM = ['########', '#F^...o#', '#C.....#', '########'];
  const found = (g) => { const t = g.grid.traps.get('2,1'); t.revealed = true; return t; };

  it('a success rigs the trap: heroes cross it, and it springs on the next monster', () => {
    const { g, f, foe } = start(ROOM, { rng: () => 0.99 });
    const trap = found(g);
    expect(g.reachable(f).has('2,1')).toBe(false); // heroes walk around a trap they know
    const r = applyCommand(g, { type: 'disarm', x: 2, z: 1 });
    expect(r).toMatchObject({ ok: true, success: true, sprung: null });
    expect(trap.rigged).toBe(true);
    expect(f.actionUsed).toBe(true);
    expect(g.reachable(f).has('2,1')).toBe(true);
    const step = g.move(f, 3, 1);
    expect(step.steps.some((s) => s.type === 'trap')).toBe(false);
    turnOf(g, foe);
    const hp = foe.hp;
    const m = g.move(foe, 2, 1);
    const spring = m.steps.find((s) => s.type === 'trap');
    expect(spring.result.unit).toBe(foe);
    expect(foe.hp).toBeLessThan(hp);
    expect(trap.sprung).toBe(true);
  });

  it('failing by 5 or more sets it off on the hero; a near miss does nothing', () => {
    const low = start(ROOM, { rng: () => 0 }); // a 1
    found(low.g);
    const hp = low.f.hp;
    const r = applyCommand(low.g, { type: 'disarm', x: 2, z: 1 });
    expect(r.success).toBe(false);
    expect(r.sprung.unit).toBe(low.f);
    expect(low.f.hp).toBeLessThan(hp);

    const near = start(ROOM, { rng: () => 0.5 }); // an 11: 11 + DEX 1 = 12, one short
    const trap = found(near.g);
    const n = applyCommand(near.g, { type: 'disarm', x: 2, z: 1 });
    expect(n).toMatchObject({ success: false, sprung: null });
    expect(trap.sprung).toBe(false);
  });

  it('a rogue’s eye for traps adds proficiency, and the trap must be found first', () => {
    const { g, f } = start(ROOM);
    expect(g.disarmProblem(f, 2, 1)).toBe('Pick a trap you’ve found');
    found(g);
    expect(g.disarmProblem(f, 2, 1)).toBe(null);
    const plain = g.disarmBonus(f);
    f.passives.push('trapSense');
    expect(g.disarmBonus(f)).toBe(plain + f.prof);
    const old = start(ROOM, { rules: 7 });
    found(old.g);
    expect(old.g.disarmProblem(old.f, 2, 1)).toBe('This fight began before disarming traps');
  });
});

describe('zombies (rules 8)', () => {
  const ROOM = ['#######', '#F.d..#', '#C....#', '#######'];

  it('Undead Fortitude: a CON save against 5 + the damage keeps it on 1 HP', () => {
    const { g, f, foe } = start(ROOM, { rng: () => 0.99 }); // a 20: 20 + 3 = 23
    foe.hp = 5;
    g.applyDamage(foe, 5, f); // DC 10
    expect(foe).toMatchObject({ alive: true, hp: 1 });
    g.applyDamage(foe, 30, f); // DC 35: no save makes that
    expect(foe.alive).toBe(false);
  });

  it('a crit or radiant damage keeps it down', () => {
    const crit = start(ROOM, { rng: () => 0.99 });
    crit.g.blow = { crit: true, radiant: false };
    crit.g.applyDamage(crit.foe, 22, crit.f);
    expect(crit.foe.alive).toBe(false);
    const holy = start(ROOM, { rng: () => 0.99 });
    holy.foe.hp = 5;
    holy.g.cause = 'Sacred Flame';
    holy.g.applyDamage(holy.foe, 5, holy.f);
    expect(holy.foe.alive).toBe(false);
  });

  it('has no Fortitude under rules 7, and shambles into the Crypt Door only from rules 8', () => {
    const { g, f, foe } = start(ROOM, { rng: () => 0.99, rules: 7 });
    foe.hp = 5;
    g.applyDamage(foe, 5, f);
    expect(foe.alive).toBe(false);
    expect(new Game(levelById('crypt')).units.some((u) => u.code === 'd')).toBe(true);
    expect(new Game(levelById('crypt'), { rules: 7 }).units.some((u) => u.code === 'd')).toBe(false);
  });
});

describe('swarms of rats (rules 8)', () => {
  it('weapons deal a swarm half damage', () => {
    const { g, f, foe } = start(['#######', '#Fc...#', '#C....#', '#######'], { rng: () => 0.75 });
    const r = g.attack(f, foe, f.attacks[0]);
    expect(r.hit).toBe(true);
    expect(r.resisted).toBe(true);
    const old = start(['#######', '#Fc...#', '#C....#', '#######'], { rng: () => 0.75, rules: 7 });
    const o = old.g.attack(old.f, old.foe, old.f.attacks[0]);
    expect(r.damage).toBe(Math.floor(o.damage / 2));
  });

  it('pours through heroes, though it can’t stop on one, and can’t be grappled', () => {
    const { g, f, foe } = start(['#######', '#.Fc..#', '#C....#', '#######']);
    expect(g.grappleProblem(f, foe)).toBe('Swarm of Rats is a swarm: nothing to hold');
    turnOf(g, foe);
    expect(g.reachable(foe).has('1,1')).toBe(true);
    expect(g.canEndOn(foe, 2, 1)).toBe(false);
  });

  it('bites for 2d6, and 1d6 once it’s down to half its HP', () => {
    const { g, f, foe } = start(['#######', '#Fc...#', '#C....#', '#######'], { rng: () => 0.75 });
    turnOf(g, foe);
    const full = g.attack(foe, f, foe.attacks[0]);
    foe.hp = 12;
    foe.attacksLeft = 1;
    foe.actionUsed = false;
    const weak = g.attack(foe, f, foe.attacks[0]);
    expect(full.damageRoll.rolls.length).toBe(2);
    expect(weak.damageRoll.rolls.length).toBe(1);
  });

  it('turns up in generation 7 Endless floors, never generation 6', () => {
    let seven = 0, six = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const floor of [2, 4, 7]) {
        const rows = makeFloor(seed, floor, 7).rows.join('');
        if (/[dc]/.test(rows)) seven++;
        if (/[dc]/.test(makeFloor(seed, floor, 6).rows.join(''))) six++;
      }
    }
    expect(seven).toBeGreaterThan(0);
    expect(six).toBe(0);
  });
});
