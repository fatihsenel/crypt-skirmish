import { describe, it, expect } from 'vitest';
import { Game, OWL_AC, SECRET_DC } from '../src/game/combat.js';
import { levelById } from '../src/game/maps.js';
import { applyCommand } from '../src/game/replay.js';
import { makeFloor } from '../src/game/endless.js';

/** A fight on `level` with `who`'s turn up; `rng` rolls every die. */
function start(level, opts = {}, who = 'Fighter') {
  const g = new Game(level, { senses: false, rng: () => 0.5, ...opts });
  g.start();
  const f = g.units.find((u) => u.cls === who);
  while (g.current !== f) g.endTurn();
  return { g, f, foe: g.units.find((u) => u.team === 'monsters') };
}

const turnOf = (g, u) => { while (g.current !== u) g.endTurn(); };
const toRound = (g, n) => { while (g.round < n && !g.over) g.endTurn(); };

describe('the alarm gong (rules 9)', () => {
  const ROOM = {
    rows: ['##########', '#F.....g.#', '#C.......#', '#........#', '##########'],
    gong: { x: 8, z: 1, by: '7,1', after: 2, wave: [['g', 1, 3], ['g', 2, 3]] },
  };

  it('the monster by it strikes it once it knows the party is here, and the wave comes two rounds on', () => {
    const g = new Game(ROOM, { senses: false, rng: () => 0.5 });
    const foe = g.units.find((u) => u.team === 'monsters');
    expect(foe.ringer).toBe(true);
    expect(g.grid.isSolid(8, 1)).toBe(true); // the gong stands on its tile
    const rung = [];
    g.on('gong', (r) => rung.push(r));
    g.start();
    turnOf(g, foe);
    expect(rung).toHaveLength(1);
    expect(foe.actionUsed).toBe(true);
    const at = rung[0].round;
    expect(at).toBe(g.round + 2);
    expect(g.arrivals[at]).toHaveLength(2);
    const before = g.living('monsters').length;
    toRound(g, at);
    expect(g.living('monsters')).toHaveLength(before + 2);
    expect(g.order.filter((u) => u.code === 'g')).toHaveLength(3);
  });

  it('isn’t struck by a monster that hasn’t noticed the party, or under rules 8', () => {
    const quiet = new Game({ ...ROOM, asleep: ['7,1'] }, { rng: () => 0.5 });
    quiet.start();
    const foe = quiet.units.find((u) => u.team === 'monsters');
    turnOf(quiet, foe);
    expect(foe.unaware).toBe(true);
    expect(quiet.gong.rung).toBe(0);
    const old = start(ROOM, { rules: 8 });
    expect(old.g.gong).toBe(null);
    expect(old.g.grid.isSolid(8, 1)).toBe(false);
  });

  it('a pending wave keeps the fight going after the last monster falls', () => {
    const { g, f, foe } = start(ROOM);
    turnOf(g, foe);
    g.applyDamage(foe, 99, f);
    expect(g.over).toBe(null);
  });

  it('Grukk strikes his gong in the Goblin Warren', () => {
    const g = new Game(levelById('warren'));
    expect(g.units.find((u) => u.ringer)?.code).toBe('b');
  });
});

describe('holding out (rules 9)', () => {
  const ROOM = {
    rows: ['##########', '#F.......#', '#C.....s.#', '#........#', '##########'],
    hold: { rounds: 3, waves: { 2: [['s', 8, 3]] } },
  };

  it('is won when the last round ends, whoever is still standing', () => {
    const { g } = start(ROOM);
    const ends = [];
    g.on('gameOver', (r) => ends.push(r));
    toRound(g, 2);
    expect(g.living('monsters')).toHaveLength(2);
    while (!g.over) g.endTurn();
    expect(g.round).toBe(4);
    expect(ends).toEqual([{ result: 'victory', held: true }]);
    expect(g.xpEarned()).toBe(2 * 50); // both skeletons, standing or not
  });

  it('isn’t won by clearing the room while the dead are still to come', () => {
    const { g, f, foe } = start(ROOM);
    g.applyDamage(foe, 99, f);
    expect(g.over).toBe(null);
  });

  it('the Catacombs are a hold-out from rules 9', () => {
    expect(new Game(levelById('catacombs')).hold).toEqual({ rounds: 6 });
    expect(new Game(levelById('catacombs'), { rules: 8 }).hold).toBe(null);
  });
});

describe('the prisoner (rules 9)', () => {
  const ROOM = {
    rows: ['##########', '#F.......#', '#C......s#', '#........#', '##########'],
    captive: { x: 3, z: 1, until: 2, loot: ['potion', 'ringProtection'] },
  };

  it('a hero next to them frees them with the action, for what they hid', () => {
    const { g, f } = start(ROOM);
    expect(g.freeProblem(f, 3, 1)).toBe('Must stand next to them');
    f.x = 2;
    const potions = f.potions;
    const r = applyCommand(g, { type: 'free', x: 3, z: 1 });
    expect(r).toMatchObject({ ok: true, loot: ['potion', 'ringProtection'] });
    expect(f.potions).toBe(potions + 1);
    expect(g.found).toContain('ringProtection');
    expect(g.grid.isSolid(3, 1)).toBe(false);
    expect(g.freeProblem(f, 3, 1)).toBe('Already free');
  });

  it('is dragged off when round `until` + 1 begins', () => {
    const { g, f } = start(ROOM);
    toRound(g, 3);
    expect(g.captive.lost).toBe(true);
    f.x = 2;
    expect(g.freeProblem(f, 3, 1)).toBe('Too late: they’re gone');
  });
});

describe('the owl familiar (rules 9)', () => {
  const ROOM = ['##########', '#W....s..#', '#F.......#', '#........#', '##########'];

  it('the Wizard comes in with an owl that flies 60 ft to distract a foe', () => {
    const { g, f: w, foe } = start(ROOM, {}, 'Wizard');
    expect(w.familiar).toMatchObject({ alive: true });
    expect(g.owlProblem(w, 9, 1)).toBe('The owl can’t perch there');
    const r = applyCommand(g, { type: 'owl', x: 5, z: 1 });
    expect(r).toMatchObject({ ok: true, target: foe });
    expect(foe.owlHelp).toBe(w.id);
    expect(g.owlProblem(w, 5, 2)).toBe('The owl has flown this turn');
    const fighter = g.units.find((u) => u.cls === 'Fighter');
    expect(g.attackMods(fighter, foe, fighter.attacks[0]).adv).toContain('the owl');
    g.useHelp(fighter, foe);
    expect(foe.owlHelp).toBe(null);
  });

  it('a monster beside it as its turn starts swats at it', () => {
    const { g, f: w, foe } = start(ROOM, { rng: () => 0.99 }, 'Wizard');
    applyCommand(g, { type: 'owl', x: 5, z: 1 });
    const swats = [];
    g.on('owlSwat', (r) => swats.push(r));
    turnOf(g, foe);
    expect(swats[0]).toMatchObject({ unit: foe, ac: OWL_AC, hit: true });
    expect(w.familiar.alive).toBe(false);
    expect(foe.owlHelp).toBe(null);
    expect(g.owlProblem(w, 4, 1)).toBe('Your owl is gone until the next fight');
  });

  it('no owl under rules 8', () => {
    const { f: w } = start(ROOM, { rules: 8 }, 'Wizard');
    expect(w.familiar).toBeUndefined();
  });
});

describe('secret doors (rules 9)', () => {
  const ROOM = {
    rows: ['#########', '#F..#...#', '#C..#.s.#', '#...#...#', '#########'],
    secrets: [[4, 2]],
  };

  it('Search finds one within 10 ft, and it is a door from then on', () => {
    const { g, f } = start(ROOM, { rng: () => 0.99 }); // a 20
    f.x = 2;
    f.z = 2;
    expect(g.grid.isWall(4, 2)).toBe(true);
    const r = applyCommand(g, { type: 'action', id: 'search' });
    expect(r.walls[0]).toMatchObject({ dc: SECRET_DC, success: true });
    expect(g.grid.isWall(4, 2)).toBe(false);
    expect(g.grid.doors.get('4,2')).toMatchObject({ open: false });
  });

  it('Keen Eyes spot one within 10 ft in passing; rules 8 never does', () => {
    const { g, f } = start(ROOM);
    f.passives.push('trapSense');
    f.x = 2;
    g.revealTraps();
    expect(g.secrets.get('4,2').found).toBe(true);
    const old = start(ROOM, { rules: 8 });
    old.f.passives.push('trapSense');
    old.f.x = 3;
    old.g.revealTraps();
    expect(old.g.grid.isWall(4, 2)).toBe(true);
  });
});

describe('the cult fanatic (rules 9)', () => {
  const ROOM = ['##########', '#F.....f.#', '#C.......#', '#........#', '##########'];

  it('calls up a skeleton as its turn starts, two at most, and they crumble when it falls', () => {
    const g = new Game(ROOM, { senses: false, rng: () => 0.5 });
    g.start();
    const f = g.units.find((u) => u.cls === 'Fighter');
    const foe = g.units.find((u) => u.code === 'f');
    const called = () => g.units.filter((u) => u.summonedBy === foe.id && u.alive);
    turnOf(g, foe);
    expect(foe.actionUsed).toBe(true);
    expect(called()).toHaveLength(1);
    expect(called()[0]).toMatchObject({ code: 's', summoned: true, unaware: false });
    g.endTurn();
    turnOf(g, foe);
    g.endTurn();
    turnOf(g, foe);
    expect(called()).toHaveLength(2);
    expect(foe.actionUsed).toBe(false); // two up: it fights
    const xp = g.xpEarned();
    g.applyDamage(foe, 99, f);
    expect(g.units.filter((u) => u.summonedBy === foe.id && u.alive)).toHaveLength(0);
    expect(g.xpEarned()).toBe(xp + 450); // the called skeletons are worth nothing
    expect(g.over).toBe('victory');
  });

  it('stands by the stair in the Sunken Halls from rules 9', () => {
    expect(new Game(levelById('halls')).units.some((u) => u.code === 'f')).toBe(true);
    expect(new Game(levelById('halls'), { rules: 8 }).units.some((u) => u.code === 'f')).toBe(false);
  });

  it('turns up in generation 8 Endless floors, never generation 7', () => {
    let eight = 0, seven = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const floor of [2, 4, 7]) {
        if (makeFloor(seed, floor, 8).rows.join('').includes('f')) eight++;
        if (makeFloor(seed, floor, 7).rows.join('').includes('f')) seven++;
      }
    }
    expect(eight).toBeGreaterThan(0);
    expect(seven).toBe(0);
  });
});
