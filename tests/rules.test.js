import { describe, it, expect } from 'vitest';
import { parseDice, rollExpr, abilityMod } from '../src/game/dice.js';
import { Grid, gridDistance } from '../src/game/grid.js';
import { Game } from '../src/game/combat.js';
import { chooseAttack, chooseMove, nextMonsterStep } from '../src/game/ai.js';
import { coneTiles } from '../src/game/abilities.js';
import { levelById, LEVELS } from '../src/game/maps.js';
import { createUnit } from '../src/game/units.js';
import {
  newCampaign, choices, completeFight, takeRest, equip, unequip, levelForXp, serialize, parseSave, NODES,
} from '../src/game/campaign.js';

// Deterministic RNG that returns the given sequence of d-results for a die size.
const fixed = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('dice', () => {
  it('parses expressions', () => {
    expect(parseDice('2d6+3')).toEqual({ count: 2, sides: 6, bonus: 3 });
    expect(parseDice('d20')).toEqual({ count: 1, sides: 20, bonus: 0 });
    expect(parseDice('1d4 - 1')).toEqual({ count: 1, sides: 4, bonus: -1 });
  });

  it('doubles dice on a crit', () => {
    const r = rollExpr('1d8', { crit: true, rng: () => 0.999 });
    expect(r.rolls).toEqual([8, 8]);
  });

  it('computes ability modifiers', () => {
    expect([8, 10, 11, 16, 20].map(abilityMod)).toEqual([-1, 0, 0, 3, 5]);
  });
});

describe('grid', () => {
  const g = new Grid([
    '#####',
    '#...#',
    '#.#.#',
    '#...#',
    '#####',
  ]);

  it('floods within a step budget', () => {
    const reach = g.flood(1, 1, 1);
    expect(reach.size).toBe(3); // start, east, south (diagonal blocked by the pillar corner)
  });

  it('blocks line of sight through walls', () => {
    expect(g.lineOfSight(1, 2, 3, 2)).toBe(false);
    expect(g.lineOfSight(1, 1, 3, 1)).toBe(true);
  });

  it('uses 5e diagonal distance', () => {
    expect(gridDistance({ x: 0, z: 0 }, { x: 3, z: 2 })).toBe(3);
  });
});

describe('combat', () => {
  const arena = ['#######', '#F...g#', '#######'];

  it('rolls initiative and starts a turn', () => {
    const game = new Game(arena);
    game.start();
    expect(game.order).toHaveLength(2);
    expect(game.current.movesLeft).toBe(game.current.speed);
  });

  it('a natural 20 always hits, a natural 1 always misses', () => {
    const game = new Game(arena, { rng: () => 0.999 }); // every die maxes out
    game.start();
    const [f, g] = game.units;
    g.x = 2; // adjacent
    game.order = [f, g];
    game.turn = 0;
    const hit = game.attack(f, g, f.attacks[0]);
    expect(hit.crit).toBe(true);
    expect(g.alive).toBe(false);
    expect(game.over).toBe('victory');

    const game2 = new Game(arena, { rng: () => 0 });
    game2.start();
    const [f2, g2] = game2.units;
    g2.x = 2;
    const miss = game2.attack(f2, g2, f2.attacks[0]);
    expect(miss.fumble).toBe(true);
    expect(miss.hit).toBe(false);
  });

  it('only one action per turn', () => {
    const game = new Game(arena, { rng: fixed(0.5) });
    game.start();
    const [f, g] = game.units;
    g.x = 2;
    g.hp = 999;
    game.attack(f, g, f.attacks[0]);
    expect(game.attack(f, g, f.attacks[0]).ok).toBe(false);
  });

  it('enemies block movement', () => {
    const game = new Game(['#####', '#F.g#', '#####']);
    game.start();
    const f = game.units[0];
    game.order = [f, game.units[1]];
    game.turn = 0;
    f.movesLeft = 6;
    expect(game.move(f, 3, 1)).toBeNull();
  });

  it('move returns walk steps and spends movement', () => {
    const game = new Game(['#######', '#F...g#', '#######']);
    game.start();
    const f = setTurn(game, 0);
    const r = game.move(f, 3, 1);
    expect(r.steps).toEqual([{ type: 'walk', path: r.path }]);
    expect(f.movesLeft).toBe(4);
    expect([f.x, f.z]).toEqual([3, 1]);
  });
});

/** Make units[i] the active unit with a fresh turn. */
function setTurn(game, i) {
  game.order = [game.units[i], ...game.units.filter((_, j) => j !== i)];
  game.turn = 0;
  game.beginTurn();
  return game.units[i];
}

describe('advantage & disadvantage', () => {
  it('ranged attacks with an enemy adjacent have disadvantage', () => {
    const game = new Game(['######', '#Fg..#', '######'], { senses: false });
    const [f, g] = game.units;
    expect(game.attackMods(f, g, f.attacks[1]).mode).toBe('dis'); // javelin
    expect(game.attackMods(f, g, f.attacks[0]).mode).toBe('normal'); // longsword
  });

  it('attacks against a dodging target have disadvantage', () => {
    const game = new Game(['######', '#Fg..#', '######'], { senses: false });
    const [f, g] = game.units;
    g.dodging = true;
    expect(game.attackMods(f, g, f.attacks[0])).toMatchObject({ mode: 'dis', dis: ['target is dodging'] });
  });

  it('flanking gives melee advantage, and the pair cancels out', () => {
    const game = new Game(['#####', '#FgW#', '#####']);
    const [f, g] = game.units;
    expect(game.attackMods(f, g, f.attacks[0]).mode).toBe('adv');
    g.dodging = true;
    expect(game.attackMods(f, g, f.attacks[0]).mode).toBe('normal');
  });

  it('rolls two d20s and keeps the right one', () => {
    const game = new Game(['###', '#F#', '###'], { rng: fixed(0.1, 0.9) });
    expect(game.rollD20('adv')).toEqual({ d20: 19, rolls: [3, 19] });
    expect(game.rollD20('dis')).toEqual({ d20: 3, rolls: [3, 19] });
  });
});

describe('opportunity attacks', () => {
  const map = ['#######', '#Fg...#', '#######'];

  it('leaving reach provokes, and a kill stops the move', () => {
    const game = new Game(map, { rng: () => 0.999 }); // the fighter crits
    game.start();
    const [f, g] = game.units;
    setTurn(game, 1);
    const r = game.move(g, 4, 1);
    expect(r.interrupted).toBe(true);
    expect(r.steps[0]).toMatchObject({ type: 'opportunity', result: { attacker: f, opportunity: true, hit: true } });
    expect(f.reactionUsed).toBe(true);
    expect(f.actionUsed).toBe(false);
    expect(g.alive).toBe(false);
    expect([g.x, g.z]).toEqual([2, 1]);
  });

  it('Disengage (Nimble Escape) avoids it', () => {
    const game = new Game(map, { rng: () => 0.999 });
    game.start();
    const [f, g] = game.units;
    setTurn(game, 1);
    expect(game.doAction(g, 'nimbleEscape').ok).toBe(true);
    expect(game.provokers(g, [{ x: 2, z: 1 }, { x: 3, z: 1 }])).toEqual([]);
    const r = game.move(g, 4, 1);
    expect(r.steps.map((s) => s.type)).toEqual(['walk']);
    expect(f.reactionUsed).toBe(false);
    expect(g.actionUsed).toBe(false); // bonus action only
  });

  it('only one reaction per round', () => {
    const game = new Game(map, { rng: () => 0 }); // every attack misses
    game.start();
    const [f, g] = game.units;
    setTurn(game, 1);
    game.move(g, 3, 1);
    expect(game.provokers(g, [{ x: 2, z: 1 }, { x: 3, z: 1 }])).toEqual([]);
    expect(f.reactionUsed).toBe(true);
  });
});

describe('actions', () => {
  it('Dash doubles movement, Dodge and Disengage set flags', () => {
    const game = new Game(['#######', '#F...g#', '#######']);
    game.start();
    const f = setTurn(game, 0);
    game.doAction(f, 'dash');
    expect(f.movesLeft).toBe(12);
    expect(game.doAction(f, 'dodge').ok).toBe(false); // action already used
    setTurn(game, 0);
    game.doAction(f, 'dodge');
    expect(f.dodging).toBe(true);
  });

  it('Second Wind heals 1d10 + level once per fight', () => {
    const game = new Game(['#######', '#F...g#', '#######'], { rng: () => 0.5 });
    game.start();
    const f = setTurn(game, 0);
    expect(game.doAction(f, 'secondWind').ok).toBe(false); // full HP
    f.hp = 10;
    const r = game.doAction(f, 'secondWind');
    expect(r.healed).toBe(6 + 3);
    expect(f.hp).toBe(19);
    expect(f.actionUsed).toBe(false);
    setTurn(game, 0);
    expect(game.doAction(f, 'secondWind').reason).toMatch(/already used/i);
  });
});

describe('spells', () => {
  it('Shield turns a hit into a miss and spends a slot', () => {
    const game = new Game(['#####', '#Wg.#', '#####'], { rng: () => 0.6 }); // d20 = 13
    game.start();
    const [w, g] = game.units;
    setTurn(game, 1);
    const r = game.attack(g, w, g.attacks[0]); // 13 + 4 = 17 vs AC 15
    expect(r).toMatchObject({ shielded: true, hit: false, total: 17 });
    expect(w.slots[1]).toBe(3);
    expect(w.reactionUsed).toBe(true);
    expect(game.acOf(w)).toBe(20);
    expect(w.hp).toBe(w.maxHp);
  });

  it('Shield is not wasted when it would not help', () => {
    const game = new Game(['#####', '#Wg.#', '#####'], { rng: () => 0.95 }); // d20 = 20, crit
    game.start();
    const [w, g] = game.units;
    const r = game.attack(g, w, g.attacks[0]);
    expect(r.crit).toBe(true);
    expect(r.shielded).toBe(false);
    expect(w.slots[1]).toBe(4);
  });

  it('Magic Missile always hits and uses the lowest slot', () => {
    const game = new Game(['########', '#W....g#', '########'], { rng: () => 0.999 });
    game.start();
    const [w, g] = game.units;
    setTurn(game, 0);
    const r = game.castSpell(w, 'magicMissile', g);
    expect(r.darts).toEqual([5, 5, 5]);
    expect(g.alive).toBe(false);
    expect(w.slots).toEqual({ 1: 3, 2: 2 });
  });

  it('Burning Hands hits everything in the cone, allies too', () => {
    const game = new Game(['########', '#WFg...#', '########'], { rng: () => 0 }); // 3d6 = 3, saves fail
    game.start();
    const [w, f, g] = game.units;
    setTurn(game, 0);
    const r = game.castSpell(w, 'burningHands', { x: 4, z: 1 });
    expect(r.saves.map((s) => s.unit)).toEqual([f, g]);
    expect(f.hp).toBe(f.maxHp - 3);
    expect(g.hp).toBe(g.maxHp - 3);
  });

  it('cone covers 7 tiles straight and 9 diagonally in the open', () => {
    const open = new Grid(Array.from({ length: 9 }, () => '.........'));
    expect(coneTiles(open, { x: 4, z: 4 }, { x: 1, z: 0 }, 3)).toHaveLength(7);
    expect(coneTiles(open, { x: 4, z: 4 }, { x: 1, z: 1 }, 3)).toHaveLength(9);
  });

  it('Misty Step is a bonus action teleport with a level 2 slot', () => {
    const game = new Game(['########', '#W....g#', '########']);
    game.start();
    const w = setTurn(game, 0);
    expect(game.castSpell(w, 'mistyStep', { x: 6, z: 1 }).ok).toBe(false); // occupied
    const r = game.castSpell(w, 'mistyStep', { x: 5, z: 1 });
    expect(r.ok).toBe(true);
    expect([w.x, w.z]).toEqual([5, 1]);
    expect(w.slots[2]).toBe(1);
    expect(w.actionUsed).toBe(false);
    expect(w.bonusUsed).toBe(true);
  });
});

describe('ai', () => {
  it('walks toward heroes then attacks', () => {
    const game = new Game(['##########', '#F......g#', '##########']);
    game.start();
    const goblin = game.units[1];
    goblin.attacks = goblin.attacks.filter((a) => a.reach === 1); // melee only
    goblin.movesLeft = 6;
    expect(chooseAttack(game, goblin)).toBeNull();
    const dest = chooseMove(game, goblin);
    expect(dest).toEqual({ x: 2, z: 1 });
  });

  it('goblins Nimble Escape out of melee before shooting', () => {
    const game = new Game(['##########', '#Fg......#', '##########']);
    game.start();
    const g = setTurn(game, 1);
    const memo = {};
    expect(nextMonsterStep(game, g, memo)).toEqual({ type: 'bonus', id: 'nimbleEscape' });
    game.doAction(g, 'nimbleEscape');
    const step = nextMonsterStep(game, g, memo);
    expect(step.type).toBe('move');
    expect(step.x).toBeGreaterThan(3); // steps out of reach before shooting
  });

  it('brutes walk up to swing rather than shoot', () => {
    const game = new Game(['##########', '#F.....s.#', '##########']);
    game.start();
    const s = setTurn(game, 1);
    const memo = {};
    expect(nextMonsterStep(game, s, memo)).toEqual({ type: 'move', x: 2, z: 1 });
  });

  it('avoids walking past a hero when that provokes', () => {
    const game = new Game(['#######', '#.F...#', '#.....#', '#..W.s#', '#######']);
    game.start();
    const s = setTurn(game, 2);
    s.x = 3; s.z = 2; // adjacent to both heroes
    s.attacks = s.attacks.filter((a) => a.reach === 1);
    expect(chooseMove(game, s)).toBeNull(); // already in reach, nothing to gain
  });
});

describe('map features', () => {
  it('closed doors block sight and open when walked through', () => {
    const game = new Game(['#######', '#F.+.g#', '#######']);
    game.start();
    const [f, g] = game.units;
    expect(game.attackProblem(f, g, f.attacks[1])).toMatch(/line of sight/);
    setTurn(game, 0);
    const r = game.move(f, 4, 1);
    expect(r.steps.map((s) => s.type)).toEqual(['walk', 'door', 'walk']);
    expect(game.grid.doors.get('3,1').open).toBe(true);
    expect(game.grid.lineOfSight(1, 1, 5, 1)).toBe(true);
  });

  it('hidden traps spring on heroes but not monsters', () => {
    const game = new Game(['#######', '#F.^..#', '#.....#', '#....g#', '#######'], { rng: () => 0 }); // save fails, 2d6 = 2
    game.start();
    const [f, g] = game.units;
    setTurn(game, 0);
    const r = game.move(f, 4, 1);
    // A failed save also knocks you prone, which ends the move on the trap.
    expect(r.steps.map((s) => s.type)).toEqual(['walk', 'trap']);
    expect(r.interrupted).toBe(true);
    expect([f.x, f.z]).toEqual([3, 1]);
    expect(game.has(f, 'prone')).toBe(true);
    expect(f.movesLeft).toBe(0);
    expect(f.hp).toBe(f.maxHp - 2);
    expect(game.grid.traps.get('3,1').sprung).toBe(true);

    const game2 = new Game(['#######', '#g.^..#', '#.....#', '#....F#', '#######']);
    game2.start();
    const g2 = setTurn(game2, 0);
    expect(game2.move(g2, 4, 1).steps.map((s) => s.type)).toEqual(['walk']);
  });

  it('the rogue spots nearby traps and heroes path around them', () => {
    const game = new Game(['#######', '#R....#', '#..^..#', '#.....#', '#....g#', '#######']);
    game.start(); // revealTraps runs at the start
    expect(game.grid.traps.get('3,2').revealed).toBe(true);
    const r = setTurn(game, 0);
    expect(game.reachable(r).has('3,2')).toBe(false);
  });

  it('chests hold potions; drinking one heals', () => {
    const game = new Game({ rows: ['######', '#F$.g#', '######'], loot: [['potion', 'potion']] }, { rng: () => 0.5 });
    game.start();
    const f = setTurn(game, 0);
    expect(game.grid.isSolid(2, 1)).toBe(true);
    const r = game.openChest(f, 2, 1);
    expect(r.loot).toEqual(['potion', 'potion']);
    expect(f.potions).toBe(3); // the fighter starts with one
    expect(game.openChest(f, 2, 1).ok).toBe(false);
    f.hp = 10;
    expect(game.doAction(f, 'potion').healed).toBe(3 + 3 + 2);
    expect(f.potions).toBe(2);
  });

  it('carries the party between levels', () => {
    const game = new Game(['#####', '#FWg#', '#####']);
    const [f, w] = game.units;
    f.hp = 9;
    w.slots[1] = 0;
    w.alive = false;
    const next = new Game(['#####', '#.FW#', '#..g#', '#####'], { party: game.partyState() });
    const [f2, w2] = next.units;
    expect(f2.hp).toBe(9);
    expect(w2.slots[1]).toBe(0);
    expect(w2.alive).toBe(true);
    expect(w2.hp).toBe(1);
  });
});

describe('rogue, cleric and new monsters', () => {
  it('Sneak Attack adds 2d6 once per turn with an ally next to the target', () => {
    const game = new Game(['######', '#RgF.#', '######'], { rng: () => 0.999 });
    game.start();
    const [r, g] = game.units;
    g.hp = 999;
    setTurn(game, 0);
    const hit = game.attack(r, g, r.attacks[0]);
    expect(hit.sneak.total).toBe(24); // crit: 4d6 at max
    expect(r.sneakUsed).toBe(true);
  });

  it('Pack Tactics: a rat gets advantage when another rat is next to the target', () => {
    const game = new Game(['#####', '#rFr#', '#####']);
    const [r1, f] = game.units;
    expect(game.attackMods(r1, f, r1.attacks[0]).adv).toContain('pack tactics');
  });

  it('the goblin boss attacks twice, the second at disadvantage', () => {
    const game = new Game(['#####', '#bF.#', '#####'], { rng: () => 0.3 });
    game.start();
    const [b, f] = game.units;
    f.hp = 999;
    setTurn(game, 0);
    expect(game.attack(b, f, b.attacks[0]).mods.mode).toBe('normal');
    const second = game.attack(b, f, b.attacks[0]);
    expect(second.ok).toBe(true);
    expect(second.mods.dis).toContain('second attack');
    expect(game.attack(b, f, b.attacks[0]).ok).toBe(false);
  });

  it('Sacred Flame is a cantrip with a WIS save DC', () => {
    const game = new Game(['#######', '#C...g#', '#######'], { rng: () => 0 }); // goblin rolls a 1
    game.start();
    const [c, g] = game.units;
    setTurn(game, 0);
    expect(game.spellDC(c)).toBe(13);
    const r = game.castSpell(c, 'sacredFlame', g);
    expect(r.save.success).toBe(false);
    expect(r.damage).toBe(1);
    expect(c.slots).toEqual({ 1: 4, 2: 2 });
  });

  it('Cure Wounds needs touch, Healing Word reaches 60 ft as a bonus action', () => {
    const game = new Game(['########', '#C....F#', '#.....g#', '########'], { rng: () => 0.5 });
    game.start();
    const [c, f] = game.units;
    f.hp = 5;
    setTurn(game, 0);
    expect(game.castSpell(c, 'cureWounds', f).reason).toMatch(/touch/);
    const r = game.castSpell(c, 'healingWord', f);
    expect(r.healed).toBe(3 + 3);
    expect(c.bonusUsed).toBe(true);
    expect(c.actionUsed).toBe(false);
  });

  it('Turn Undead makes a skeleton flee until it is hurt', () => {
    const game = new Game(['########', '#C..s..#', '########'], { rng: () => 0 });
    game.start();
    const [c, s] = game.units;
    setTurn(game, 0);
    const r = game.doAction(c, 'turnUndead');
    expect(r.saves[0].success).toBe(false);
    expect(s.turned).toBe(2);
    expect(game.attackProblem(s, c, s.attacks[1])).toMatch(/flee/);
    expect(nextMonsterStep(game, s, {}).type).toBe('move');
    expect(game.doAction(c, 'turnUndead').ok).toBe(false);
    game.applyDamage(s, 1, c);
    expect(s.turned).toBe(0);
  });

  it('Animate Dead raises a corpse that acts right after the necromancer', () => {
    const game = new Game(['########', '#n.%..F#', '########']);
    game.start();
    const n = game.units.find((u) => u.code === 'n');
    setTurn(game, game.units.indexOf(n));
    const step = nextMonsterStep(game, n, {});
    expect(step.type).toBe('spell');
    const r = game.castSpell(n, 'animateDead', step.target);
    expect(r.risen.team).toBe('monsters');
    expect(game.order[game.turn + 1]).toBe(r.risen);
    expect(game.current).toBe(n);
    expect(game.corpses()).toHaveLength(0);
    expect(n.slots[3]).toBe(1);
  });

  it('cannot raise a corpse someone is standing on', () => {
    const game = new Game(['########', '#n.%..F#', '########']);
    game.start();
    const [n, f] = game.units;
    setTurn(game, game.units.indexOf(n));
    const corpse = game.corpses()[0];
    f.x = corpse.x;
    f.z = corpse.z;
    expect(game.spellProblem(n, 'animateDead', corpse)).toMatch(/standing/);
    expect(game.spellTargets(n, 'animateDead')).toHaveLength(0);
  });

  it('the orc charges with Aggressive when melee is out of reach', () => {
    const game = new Game(['################', '#F...........o.#', '################'], { senses: false });
    game.start();
    const o = setTurn(game, 1);
    o.attacks = o.attacks.filter((a) => a.reach === 1);
    expect(nextMonsterStep(game, o, {})).toEqual({ type: 'bonus', id: 'aggressive' });
  });
});

describe('campaign: levels, items and the dungeon map', () => {
  const party = (overrides) => {
    const s = newCampaign();
    for (const [code, rec] of Object.entries(overrides)) {
      Object.assign(s.party[code], rec);
      if (rec.level && !rec.slots) delete s.party[code].slots; // fresh slots for the new level
      if (rec.level && !rec.hp) delete s.party[code].hp; // and full HP
    }
    return s.party;
  };

  it('a level-5 party arrives with its new features, and items apply', () => {
    const p = party({ F: { level: 5, items: ['weaponPlus1'] }, W: { level: 5 }, R: { level: 5, items: ['ringProtection'] } });
    const game = new Game(['######', '#FWRg#', '######'], { party: p });
    const [f, w, r] = game.units;
    expect(f.maxHp).toBe(31 + 16);
    expect(f.extraAttack).toBe(2);
    expect(f.prof).toBe(3);
    expect(game.toHitBonus(f, f.attacks[0])).toBe(4 + 3 + 1); // STR 18, prof 3, +1 weapon
    expect(game.damageBonus(f, f.attacks[0])).toBe(5);
    expect(w.spells).toContain('fireball');
    expect(w.slots).toEqual({ 1: 4, 2: 3, 3: 2 });
    expect(game.toHitBonus(w, w.attacks[0])).toBe(4 + 3); // Fire Bolt is not a weapon
    expect(r.sneakDice).toBe(3);
    expect(game.acOf(r)).toBe(14 + 1 + 1); // DEX 18 and the ring
  });

  it('Extra Attack: two attacks per action, neither at disadvantage', () => {
    const game = new Game(['#####', '#Fg.#', '#####'], { party: party({ F: { level: 5 } }), rng: () => 0.5 });
    game.start();
    const [f, g] = game.units;
    g.hp = 999;
    setTurn(game, 0);
    expect(game.attack(f, g, f.attacks[0]).ok).toBe(true);
    expect(game.canAttack(f)).toBe(true);
    const second = game.attack(f, g, f.attacks[0]);
    expect(second.mods.dis).toEqual([]);
    expect(game.canAttack(f)).toBe(false);
  });

  it('Uncanny Dodge halves a big hit once per round', () => {
    const game = new Game(['#####', '#Ro.#', '#####'], { party: party({ R: { level: 5 } }), rng: () => 0.8 });
    game.start();
    const [r, o] = game.units;
    r.hp = 999;
    r.maxHp = 999;
    setTurn(game, 1);
    const hit = game.attack(o, r, o.attacks[0]);
    expect(hit.uncanny).toBe(true);
    expect(hit.damage).toBe(Math.floor((10 + 3) / 2));
    expect(r.reactionUsed).toBe(true);
  });

  it('Fireball hits everyone in 20 ft, friend or foe, and walls block it', () => {
    const p = party({ W: { level: 5 } });
    const game = new Game(['##########', '#W..gg.#g#', '#..F....##', '##########'], { party: p, rng: () => 0.01 });
    game.start();
    const w = setTurn(game, 0);
    const r = game.castSpell(w, 'fireball', { x: 5, z: 1 });
    expect(r.ok).toBe(true);
    const hit = r.saves.map((s) => s.unit.code).sort();
    expect(hit).toEqual(['F', 'W', 'g', 'g']); // the goblin behind the wall is safe
    expect(r.saves.every((s) => !s.success && s.damage === 8)).toBe(true);
    expect(w.slots[3]).toBe(1);
  });

  it('Destroy Undead destroys a skeleton that fails its save', () => {
    const game = new Game(['######', '#C.s.#', '######'], { party: party({ C: { level: 5 } }), rng: () => 0.01 });
    game.start();
    const [c, s] = game.units;
    setTurn(game, 0);
    const r = game.doAction(c, 'turnUndead');
    expect(r.saves[0].destroyed).toBe(true);
    expect(s.alive).toBe(false);
  });

  it('Mass Healing Word heals every hurt ally in range', () => {
    const game = new Game(['#######', '#CF.W.#', '#....g#', '#######'], { party: party({ C: { level: 5 } }), rng: () => 0.5 });
    game.start();
    const [c, f, w] = game.units;
    f.hp = 5;
    w.hp = 5;
    setTurn(game, 0);
    const r = game.castSpell(c, 'massHealingWord');
    expect(r.heals.map((h) => h.unit)).toEqual([f, w]);
    expect(c.bonusUsed).toBe(true);
  });

  it('chests put magic items in the pack; XP counts slain monsters only', () => {
    const game = new Game({ rows: ['#######', '#F$g.%#', '#######'], loot: [['potion', 'ringProtection']] });
    game.start();
    const f = setTurn(game, 0);
    game.openChest(f, 2, 1);
    expect(game.found).toEqual(['ringProtection']);
    game.units[1].alive = false;
    expect(game.xpEarned()).toBe(50); // the old corpse gives nothing
  });

  it('the map forks: one middle room then the chapel, or both and straight to the boss', () => {
    let s = newCampaign();
    expect(choices(s)).toEqual(['crypt']);
    s = { ...s, at: 'crypt', cleared: ['crypt'] };
    expect(choices(s)).toEqual(['warren', 'ossuary']);
    const one = { ...s, at: 'warren', cleared: ['crypt', 'warren'] };
    expect(choices(one)).toEqual(['ossuary', 'chapel']);
    expect(choices({ ...one, at: 'chapel', cleared: [...one.cleared, 'chapel'] })).toEqual(['sanctum']);
    const both = { ...s, at: 'ossuary', cleared: ['crypt', 'warren', 'ossuary'] };
    expect(choices(both)).toEqual(['sanctum']);
  });

  it('a won fight rests the party, awards XP, levels up and banks loot', () => {
    const start = { ...newCampaign(), xp: 400 };
    const game = new Game(levelById('crypt'), { party: start.party });
    const f = game.units.find((u) => u.code === 'F');
    f.hp = 11;
    for (const u of game.units) if (u.team === 'monsters') u.alive = false;
    game.found.push('weaponPlus1');
    const { state, report } = completeFight(start, 'crypt', game);
    expect(report.xp).toBe(225);
    expect(state.xp).toBe(625);
    expect(levelForXp(state.xp)).toBe(4);
    expect(report.levelUps.map((l) => l.code)).toEqual(['F', 'W', 'R', 'C']);
    expect(state.party.F.level).toBe(4);
    expect(state.party.F.hp).toBe(11 + 10 + 8); // rest: half of 20 missing, then +8 for the level
    expect(state.party.W.slots[2]).toBe(3);
    expect(state.pack).toEqual(['weaponPlus1']);
    expect(start.xp).toBe(400); // the previous state is untouched (retry after a defeat)

    const geared = equip(state, 0, 'F');
    expect(geared.party.F.items).toEqual(['weaponPlus1']);
    expect(geared.pack).toEqual([]);
    expect(unequip(geared, 'F', 0).pack).toEqual(['weaponPlus1']);
  });

  it('the chapel is a long rest', () => {
    const s = newCampaign();
    s.party.W.hp = 2;
    s.party.W.slots = { 1: 0, 2: 0 };
    const r = takeRest(s, 'chapel');
    expect(r.party.W.hp).toBe(20);
    expect(r.party.W.slots).toEqual({ 1: 4, 2: 2 });
  });

  it('save data round-trips and bad saves are rejected', () => {
    const s = equip({ ...newCampaign(), pack: ['ringProtection'] }, 0, 'C');
    expect(parseSave(serialize(s))).toEqual(s);
    expect(parseSave('not json')).toBe(null);
    expect(parseSave(JSON.stringify({ ...s, v: 99 }))).toBe(null);
    expect(parseSave(JSON.stringify({ ...s, at: 'nowhere' }))).toBe(null);
    expect(parseSave(null)).toBe(null);
  });
});

describe('campaign: unopened chests', () => {
  it('a cleared room gives up its closed chests: gear to the pack, potions to the party', () => {
    const start = newCampaign();
    const game = new Game(levelById('ossuary'), { party: start.party });
    for (const u of game.units) if (u.team === 'monsters') u.alive = false;
    const { state, report } = completeFight(start, 'ossuary', game);
    expect(state.pack).toEqual(['ringProtection']);
    expect(report.potions).toBe(2);
    const total = (p) => Object.values(p).reduce((n, h) => n + h.potions, 0);
    expect(total(state.party)).toBe(total(start.party) + 2);
  });
});

describe('fog of war', () => {
  const g = new Grid([
    '#########',
    '#...#...#',
    '#...+...#',
    '#...#...#',
    '#########',
  ]);

  it('sees its own room and its walls, not past a closed door', () => {
    const seen = g.visibleFrom([{ x: 1, z: 2 }]);
    expect(seen.has('3,1')).toBe(true);
    expect(seen.has('0,0')).toBe(true); // corner wall filled in
    expect(seen.has('4,2')).toBe(true); // the door itself
    expect(seen.has('5,2')).toBe(false);
    expect(seen.has('7,3')).toBe(false);
  });

  it('sees through a door once it is open (or the blocker says so)', () => {
    const open = (x, z) => g.isWall(x, z);
    const seen = g.visibleFrom([{ x: 1, z: 2 }], open);
    expect(seen.has('6,2')).toBe(true);
    expect(seen.has('7,2')).toBe(true);
  });

  it('sees every tile that can see a viewer (sight works both ways)', () => {
    for (const { id } of LEVELS) {
      const grid = new Grid(levelById(id).rows);
      const eyes = grid.spawns.filter((sp) => 'FWRC'.includes(sp.code));
      const seen = grid.visibleFrom(eyes);
      for (let z = 0; z < grid.height; z++) {
        for (let x = 0; x < grid.width; x++) {
          for (const e of eyes) {
            if (grid.lineOfSight(x, z, e.x, e.z)) expect(seen.has(`${x},${z}`)).toBe(true);
          }
        }
      }
    }
  });

  it('combines several viewers', () => {
    const seen = g.visibleFrom([{ x: 1, z: 2 }, { x: 7, z: 2 }]);
    expect(seen.has('2,2') && seen.has('6,2')).toBe(true);
  });
});

describe('monster senses', () => {
  const rows = [
    '##########',
    '#F...#...#',
    '#....+.g.#',
    '#....#...#',
    '##########',
  ];

  it('monsters behind a closed door start unaware and do nothing', () => {
    const game = new Game(rows);
    game.start();
    const g = game.units.find((u) => u.code === 'g');
    expect(g.unaware).toBe(true);
    expect(nextMonsterStep(game, g, {}).type).toBe('end');
  });

  it('opening the door into view wakes them, with the alert event', () => {
    const game = new Game(rows);
    game.start();
    const f = game.units.find((u) => u.code === 'F');
    const g = game.units.find((u) => u.code === 'g');
    const seen = [];
    game.on('alert', (r) => seen.push(r.unit));
    setTurn(game, game.units.indexOf(f));
    expect(game.move(f, 6, 1)).not.toBeNull(); // through the door
    expect(g.unaware).toBe(false);
    expect(seen).toContain(g);
  });

  it('attacks against an unaware monster have advantage, and give the attacker away', () => {
    const game = new Game(['#######', '#R....#', '#.....#', '#.....#', '#....g#', '#######'], { rng: fixed(0.5) });
    const r = game.units.find((u) => u.code === 'R');
    const g = game.units.find((u) => u.code === 'g');
    game.start();
    expect(g.unaware).toBe(true); // a Skulker 20 ft away goes unnoticed
    expect(game.attackMods(r, g, r.attacks[1]).adv).toContain('unaware');
    setTurn(game, game.units.indexOf(r));
    game.attack(r, g, r.attacks[1]);
    expect(g.unaware).toBe(false);
  });

  it('the same monster spots a hero who is no Skulker at that range', () => {
    const game = new Game(['#######', '#F....#', '#.....#', '#.....#', '#....g#', '#######']);
    game.start();
    expect(game.units.find((u) => u.code === 'g').unaware).toBe(false);
  });

  it('fighting is heard just behind a closed door, and unaware monsters make no opportunity attacks', () => {
    const game = new Game(['##########', '#....#...#', '#...Fg+s.#', '#....#...#', '##########']);
    game.start();
    const f = game.units.find((u) => u.code === 'F');
    const g = game.units.find((u) => u.code === 'g');
    const s = game.units.find((u) => u.code === 's');
    expect(g.unaware).toBe(false);
    expect(s.unaware).toBe(true);
    const leaving = [s, f, { x: 8, z: 2 }, { x: 8, z: 0 }];
    expect(game.canOpportunityAttack(...leaving)).toBe(false);
    setTurn(game, game.units.indexOf(f));
    game.attack(f, g, f.attacks[0]);
    expect(s.unaware).toBe(false); // 3 steps + 2 for the door
    expect(game.canOpportunityAttack(...leaving)).toBe(true);
  });

  it('a closed door muffles fighting further off, and far-off fighting goes unheard', () => {
    const game = new Game(['############', '#....#.....#', '#...Fg+..s.#', '#....#.....#', '############'], { rng: fixed(0.5) });
    game.start();
    const f = game.units.find((u) => u.code === 'F');
    const g = game.units.find((u) => u.code === 'g');
    const s = game.units.find((u) => u.code === 's');
    setTurn(game, game.units.indexOf(f));
    game.attack(f, g, f.attacks[0]);
    expect(s.unaware).toBe(true); // 5 steps + 2 for the door
    game.grid.doors.get('6,2').open = true;
    game.noise(f);
    expect(s.unaware).toBe(false); // 5 steps with the door open
  });
});

describe('stealth', () => {
  // The goblin starts 9 tiles away: out of sight.
  const rows = ['############', '#W.........#', '#..........#', '#.........g#', '############'];
  const setup = () => {
    const game = new Game(rows, { rng: fixed(0.5) }); // every d20 rolls 11
    game.start();
    const w = game.units.find((u) => u.code === 'W');
    const g = game.units.find((u) => u.code === 'g');
    setTurn(game, game.units.indexOf(w));
    return { game, w, g };
  };

  it('a hidden hero walks past a monster whose passive Perception is below the roll', () => {
    const { game, w, g } = setup();
    const r = game.doAction(w, 'hide');
    expect(r.total).toBe(13); // 11 + DEX 2; the goblin's passive Perception is 9
    expect(w.hidden).toBe(13);
    game.move(w, 5, 2);
    expect(g.unaware).toBe(true);
    expect(w.hidden).toBe(13);
  });

  it('without hiding, the same walk is spotted', () => {
    const { game, w, g } = setup();
    game.move(w, 5, 2);
    expect(g.unaware).toBe(false);
  });

  it('stepping right next to a monster gives you away', () => {
    const { game, w, g } = setup();
    game.doAction(w, 'hide');
    const seen = [];
    game.on('revealed', (e) => seen.push(e));
    Object.assign(w, { x: 9, z: 2 });
    game.updateAwareness();
    expect(w.hidden).toBe(0);
    expect(seen[0]).toMatchObject({ unit: w, cause: 'spotted', by: g });
    expect(g.unaware).toBe(false);
  });

  it('the first attack from hiding has advantage, then you are seen', () => {
    const { game, w, g } = setup();
    game.doAction(w, 'hide');
    w.bonusUsed = false;
    w.actionUsed = false; // pretend the hide was a bonus action
    expect(game.attackMods(w, g, w.attacks[0]).adv).toContain('hidden');
    expect(game.attackMods(g, w, g.attacks[1]).dis).toContain('target hidden');
    game.attack(w, g, w.attacks[0]);
    expect(w.hidden).toBe(0);
  });

  it("can't hide while an alert enemy can see you", () => {
    const game = new Game(rows, { senses: false });
    game.start();
    const w = setTurn(game, game.units.findIndex((u) => u.code === 'W'));
    Object.assign(w, { x: 5, z: 2 });
    expect(game.actionProblem(w, 'hide')).toMatch(/watching/);
  });

  it('heavy armour hides with disadvantage; Wren hides as a bonus action with expertise', () => {
    const game = new Game(['#######', '#F...R#', '#######'], { rng: fixed(0.5) });
    game.start();
    const f = setTurn(game, game.units.findIndex((u) => u.code === 'F'));
    expect(game.doAction(f, 'hide').rolls).toHaveLength(2);
    const r = setTurn(game, game.units.findIndex((u) => u.code === 'R'));
    const res = game.doAction(r, 'cunningHide');
    expect(res.total).toBe(11 + 3 + 4);
    expect(r.actionUsed).toBe(false);
  });
});

describe('sleepers and patrols', () => {
  it("an ally roused by a shout doesn't pass the alarm on", () => {
    const game = new Game(['############', '#F#.g..s..s#', '############']);
    game.start();
    const [g, s1, s2] = game.units.filter((u) => u.team === 'monsters');
    game.alert(g, 'hurt');
    expect(s1.unaware).toBe(false); // 3 tiles from the goblin
    expect(s2.unaware).toBe(true);  // 3 tiles from s1, 6 from the goblin
  });

  it('a sleeping monster sees nothing and sleeps through fighting a few tiles off', () => {
    // The rat is 5 tiles off: beyond the goblin's shout, within earshot of an awake monster.
    const level = { rows: ['##########', '#F....r..#', '#g.......#', '##########'], asleep: ['6,1'] };
    const game = new Game(level, { rng: fixed(0.5) });
    game.start();
    const f = game.units.find((u) => u.code === 'F');
    const g = game.units.find((u) => u.code === 'g');
    const r = game.units.find((u) => u.code === 'r');
    expect(r.asleep && r.unaware).toBe(true); // in plain view
    setTurn(game, game.units.indexOf(f));
    game.attack(f, g, f.attacks[0]);
    expect(r.asleep).toBe(true); // an awake monster would have heard that
    expect(game.attackMods(f, r, f.attacks[0]).adv).toContain('asleep');
    const woke = [];
    game.on('alert', (e) => woke.push(e));
    Object.assign(f, { x: 4, z: 1 });
    game.noise(f);
    expect(r.asleep).toBe(false);
    expect(woke[0]).toMatchObject({ unit: r, cause: 'noise', wasAsleep: true });
  });

  it('a patrol walks its beat at half speed and turns back at the end', () => {
    const level = {
      rows: ['############', '#F...#....s#', '#....#.....#', '#....#.....#', '############'],
      patrols: { '10,1': [[6, 3]] },
    };
    const game = new Game(level);
    game.start();
    const s = game.units.find((u) => u.code === 's');
    expect(s.unaware).toBe(true);
    setTurn(game, game.units.indexOf(s));
    const step = nextMonsterStep(game, s, {});
    expect(step.type).toBe('move');
    expect(gridDistance(s, step)).toBeLessThanOrEqual(3);
    game.move(s, step.x, step.z);
    expect(gridDistance(s, { x: 6, z: 3 })).toBe(1);
    setTurn(game, game.units.indexOf(s));
    const step2 = nextMonsterStep(game, s, {});
    game.move(s, step2.x, step2.z);
    expect([s.x, s.z]).toEqual([6, 3]);
    expect(s.patrol.next).toBe(0); // heading home
    expect(s.unaware).toBe(true); // the wall still hides the party
  });

  it('a patrol that wanders into view raises the alarm and stops patrolling', () => {
    const level = {
      rows: ['############', '#F.........#', '#####......#', '#.........s#', '############'],
      patrols: { '10,3': [[6, 1]] },
    };
    const game = new Game(level);
    game.start();
    const s = game.units.find((u) => u.code === 's');
    expect(s.unaware).toBe(true);
    setTurn(game, game.units.indexOf(s));
    const step = nextMonsterStep(game, s, {});
    game.move(s, step.x, step.z);
    expect(s.unaware).toBe(false);
    expect(s.patrol).toBeNull();
  });
});

describe('conditions', () => {
  it('prone: melee against it has advantage, ranged disadvantage, and its own attacks disadvantage', () => {
    const game = new Game(['#########', '#F.g...W#', '#########'], { senses: false });
    game.start();
    const [f, g, w] = game.units;
    game.addCondition(g, 'prone');
    Object.assign(f, { x: 2 });
    expect(game.attackMods(f, g, f.attacks[0]).adv).toContain('target prone');
    expect(game.attackMods(w, g, w.attacks[0]).dis).toContain('target prone');
    expect(game.attackMods(g, f, g.attacks[0]).dis).toContain('prone');
  });

  it('a prone unit stands up at the start of its turn for half its movement', () => {
    const game = new Game(['######', '#F.g.#', '######'], { senses: false });
    game.start();
    const [, g] = game.units;
    game.addCondition(g, 'prone');
    setTurn(game, 1);
    expect(game.has(g, 'prone')).toBe(false);
    expect(g.movesLeft).toBe(3);
  });

  it('Shove: a won contest knocks the target prone and takes one attack', () => {
    const game = new Game(['######', '#Fg..#', '######'], { senses: false, rng: fixed(0.9, 0.1) });
    game.start();
    const [f, g] = game.units;
    setTurn(game, 0);
    const r = game.shove(f, g);
    expect(r.success).toBe(true);
    expect(r.roll.total).toBe(19 + 3 + 2); // d20 + STR 16 + proficiency
    expect(game.has(g, 'prone')).toBe(true);
    expect(f.actionUsed).toBe(true);
    expect(game.shoveProblem(f, g)).toMatch(/Action already used|already prone/);
    // the follow-up is at advantage for anyone next to it
    expect(game.attackMods(f, g, f.attacks[0]).mode).toBe('adv');
  });

  it('Shove: ties go to the target, and a mimic is too big to shove', () => {
    const game = new Game(['######', '#Fg..#', '######'], { senses: false, rng: fixed(0.5) });
    game.start();
    const [f, g] = game.units;
    setTurn(game, 0);
    const m = createUnit('m', 1, 2);
    expect(game.shoveProblem(f, Object.assign(m, { x: 2, z: 1 }))).toMatch(/too big/);
    g.stats.str = 20; // +5 resists +5 (STR 16 + proficiency 2 = +5)
    expect(game.shove(f, g).success).toBe(false);
    expect(game.has(g, 'prone')).toBe(false);
  });

  it('poison from a hit lasts until the end of the victim’s next turn', () => {
    // After setup, the queue gives the attack a 19; everything after rolls 1s (the save fails).
    const queue = [];
    const game = new Game(['######', '#Fr..#', '######'], { senses: false, rng: () => queue.shift() ?? 0.01 });
    game.start();
    const [f, r] = game.units;
    f.hp = 999;
    setTurn(game, 1);
    queue.push(0.9);
    const hit = game.attack(r, f, r.attacks[0]);
    expect(hit.hit).toBe(true);
    expect(hit.rider).toMatchObject({ condition: 'poisoned', success: false });
    expect(game.has(f, 'poisoned')).toBe(true);
    expect(game.attackMods(f, r, f.attacks[0]).dis).toContain('poisoned');
    game.endTurn(); // the rat's turn ends: still poisoned
    expect(game.current).toBe(f);
    expect(game.has(f, 'poisoned')).toBe(true);
    game.endTurn(); // the fighter's own turn ends: it wears off
    expect(game.has(f, 'poisoned')).toBe(false);
  });

  it('a condition gained on your own turn still lasts through your next one', () => {
    const game = new Game(['######', '#Fr..#', '######'], { senses: false });
    game.start();
    const [f] = game.units;
    setTurn(game, 0);
    game.addCondition(f, 'poisoned', { turns: 1 });
    game.endTurn();
    expect(game.has(f, 'poisoned')).toBe(true);
    game.endTurn(); // the rat
    game.endTurn(); // the fighter again
    expect(game.has(f, 'poisoned')).toBe(false);
  });

  it('poisoned heroes hide at disadvantage', () => {
    const game = new Game(['#########', '#R#....g#', '#########']);
    game.start();
    const r = setTurn(game, 0);
    game.addCondition(r, 'poisoned', { turns: 1 });
    const res = game.doAction(r, 'hide');
    expect(res.rolls).toHaveLength(2);
    expect(res.poisoned).toBe(true);
  });

  it('frightened: no stepping closer to the source, disadvantage while it is in sight', () => {
    const game = new Game(['##########', '#F......n#', '#........#', '##########'], { senses: false });
    game.start();
    const [f, n] = game.units;
    setTurn(game, 0);
    game.addCondition(f, 'frightened', { turns: 2, by: n, dc: 30 });
    const tiles = game.destinations(f);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((t) => gridDistance(t, n) >= gridDistance(f, n))).toBe(true);
    expect(game.attackMods(f, n, f.attacks[1]).dis).toContain('frightened');
    game.endTurn(); // DC 30: no way out by saving
    expect(game.has(f, 'frightened')).toBe(true);
    n.alive = false; // the source is gone: the fear goes with it
    expect(game.destinations(f).some((t) => t.x === 2)).toBe(true);
  });

  it('a frightened hero can shake it off with a WIS save at the end of the turn', () => {
    const game = new Game(['##########', '#F......n#', '##########'], { senses: false, rng: fixed(0.99) });
    game.start();
    const [f, n] = game.units;
    setTurn(game, 0);
    game.addCondition(f, 'frightened', { turns: 2, by: n, dc: 13 });
    game.endTurn();
    expect(game.has(f, 'frightened')).toBe(false);
  });

  it('Dread frightens a hero that fails a WIS save; the wight uses it when it cannot reach melee', () => {
    const game = new Game(['################', '#F..........w..#', '################'], { senses: false, rng: fixed(0.01) });
    game.start();
    const [f, w] = game.units;
    setTurn(game, 1);
    const step = nextMonsterStep(game, w, {});
    expect(step).toEqual({ type: 'spell', id: 'dread', target: f });
    const r = game.castSpell(w, 'dread', f);
    expect(r.save.success).toBe(false);
    expect(game.has(f, 'frightened')).toBe(true);
    expect(game.spellProblem(w, 'dread', f)).toMatch(/already frightened|Action already used/);
  });

  it('the wight attacks twice, and its second attack is not at disadvantage', () => {
    const game = new Game(['#####', '#Fw.#', '#####'], { senses: false, rng: fixed(0.5) });
    game.start();
    const [f, w] = game.units;
    f.hp = 999;
    setTurn(game, 1);
    game.attack(w, f, w.attacks[0]);
    expect(game.canAttack(w)).toBe(true);
    expect(game.attack(w, f, w.attacks[0]).mods.dis).toEqual([]);
  });
});

describe('mimics', () => {
  const vaultish = {
    rows: ['########', '#F.$..$#', '#.....g#', '########'],
    loot: [[], ['potion']],
    mimics: ['3,1'],
  };

  it('opening a mimic wakes it: it joins right after the opener and bites with advantage', () => {
    const game = new Game(vaultish, { senses: false, rng: fixed(0.5) });
    game.start();
    const f = game.units.find((u) => u.code === 'F');
    Object.assign(f, { x: 2, z: 1 });
    setTurn(game, 0);
    const r = game.openChest(f, 3, 1);
    expect(r.mimic.name).toBe('Mimic');
    expect(game.order[game.order.indexOf(f) + 1]).toBe(r.mimic);
    expect(r.bite.mods.adv).toContain('ambush');
    expect(game.grid.chests.has('3,1')).toBe(false);
    expect(game.unitAt(3, 1)).toBe(r.mimic);
  });

  it('Keen Eyes spot a mimic nearby, so it gets no ambush', () => {
    const game = new Game({ ...vaultish, rows: ['########', '#R.$..$#', '#.....g#', '########'] }, { senses: false });
    const found = [];
    game.on('mimicFound', (e) => found.push(e));
    game.start();
    expect(found).toHaveLength(1);
    const r = game.units.find((u) => u.code === 'R');
    Object.assign(r, { x: 2, z: 1 });
    setTurn(game, 0);
    expect(game.openChest(r, 3, 1).bite.mods.adv).not.toContain('ambush');
  });

  it('a cleared room leaves a sleeping mimic alone', () => {
    const start = newCampaign();
    const game = new Game(levelById('vault'), { party: start.party });
    for (const u of game.units) if (u.team === 'monsters') u.alive = false;
    const { state } = completeFight(start, 'vault', game);
    expect(state.pack.sort()).toEqual(['cloakProtection', 'weaponPlus1']);
  });
});

describe('act two', () => {
  it('the sanctum leads on to the catacombs, after a long rest', () => {
    const start = { ...newCampaign(), at: 'chapel', cleared: ['crypt', 'warren', 'chapel'] };
    start.party.W.slots = { 1: 0, 2: 0 };
    start.party.F.hp = 3;
    const game = new Game(levelById('sanctum'), { party: start.party });
    for (const u of game.units) if (u.team === 'monsters') u.alive = false;
    const { state, report } = completeFight(start, 'sanctum', game);
    expect(state.done).toBe(false);
    expect(report.longRest).toBe(true);
    expect(state.party.W.slots[1]).toBeGreaterThanOrEqual(4);
    expect(state.party.W.slots[2]).toBeGreaterThanOrEqual(2);
    expect(state.party.F.hp).toBeGreaterThan(3);
    expect(state.party.F.hp).toBe(new Game(levelById('barrow'), { party: state.party }).units.find((u) => u.code === 'F').maxHp);
    expect(choices(state)).toEqual(['catacombs']);
  });

  it('after the catacombs: the vault or the well, then the barrow, which ends the campaign', () => {
    const base = { ...newCampaign(), cleared: ['crypt', 'warren', 'chapel', 'sanctum', 'catacombs'], at: 'catacombs' };
    expect(choices(base)).toEqual(['vault', 'well']);
    expect(choices({ ...base, at: 'vault', cleared: [...base.cleared, 'vault'] })).toEqual(['barrow']);
    const rested = takeRest(base, 'well');
    expect(choices(rested)).toEqual(['barrow']);
    const game = new Game(levelById('barrow'), { party: rested.party });
    for (const u of game.units) if (u.team === 'monsters') u.alive = false;
    expect(completeFight(rested, 'barrow', game).state.done).toBe(true);
    expect(levelById('barrow').final).toBe(true);
    expect(LEVELS.filter((l) => l.final).map((l) => l.id)).toEqual(['barrow']);
  });

  it('every campaign node has its level, and saves from before act two still load', () => {
    for (const n of Object.values(NODES)) if (n.kind === 'fight') expect(levelById(n.level)).toBeTruthy();
    const old = { ...newCampaign(), at: 'warren', cleared: ['crypt', 'warren'] };
    expect(parseSave(serialize(old))).toEqual(old);
    // a run that ended at the Sanctum before act two carries on, rested
    const finished = { ...newCampaign(), at: 'sanctum', cleared: ['crypt', 'warren', 'chapel', 'sanctum'], done: true };
    finished.party.F.hp = 2;
    const loaded = parseSave(serialize(finished));
    expect(loaded.done).toBe(false);
    expect(loaded.party.F.hp).toBe(31);
    expect(choices(loaded)).toEqual(['catacombs']);
  });
});

describe('level data', () => {
  for (const level of LEVELS) {
    it(`${level.id}: well-formed, connected, and its options point at real things`, () => {
      expect(level.rows).toHaveLength(12);
      for (const row of level.rows) expect(row).toHaveLength(16);
      const game = new Game(level);
      const grid = game.grid;
      const heroes = game.units.filter((u) => u.team === 'heroes');
      expect(heroes.map((u) => u.code).sort()).toEqual(['C', 'F', 'R', 'W']);
      expect(grid.stairs).toHaveLength(1);
      expect(level.loot?.length ?? 0).toBe(grid.chests.size);
      // Doors count as floor for walking; every monster, chest and the stairs can be reached.
      const field = grid.distanceField([heroes[0]]);
      const reach = (t) => field.has(`${t.x},${t.z}`) || [...grid.neighbors(t.x, t.z)].some(([x, z]) => field.has(`${x},${z}`));
      for (const u of game.units) expect(reach(u), `${u.name} at ${u.x},${u.z}`).toBe(true);
      for (const c of grid.chests.values()) expect(reach(c), `chest ${c.x},${c.z}`).toBe(true);
      expect(reach(grid.stairs[0])).toBe(true);
      const monsterAt = (k) => game.units.find((u) => u.team === 'monsters' && `${u.x},${u.z}` === k);
      for (const k of level.asleep ?? []) expect(monsterAt(k), `asleep ${k}`).toBeTruthy();
      for (const [k, route] of Object.entries(level.patrols ?? {})) {
        expect(monsterAt(k), `patrol ${k}`).toBeTruthy();
        for (const [x, z] of route) expect(field.has(`${x},${z}`), `waypoint ${x},${z}`).toBe(true);
      }
      for (const k of level.mimics ?? []) {
        expect(grid.chests.has(k), `mimic ${k}`).toBe(true);
        expect(grid.chests.get(k).loot).toEqual([]);
      }
    });
  }
});
