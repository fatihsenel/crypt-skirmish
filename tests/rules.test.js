import { describe, it, expect } from 'vitest';
import { parseDice, rollExpr, abilityMod } from '../src/game/dice.js';
import { Grid, gridDistance } from '../src/game/grid.js';
import { Game } from '../src/game/combat.js';
import { chooseAttack, chooseMove, nextMonsterStep } from '../src/game/ai.js';
import { coneTiles, lineTiles } from '../src/game/abilities.js';
import { levelById, LEVELS } from '../src/game/maps.js';
import { createUnit } from '../src/game/units.js';
import { SPECS, filesForRoom } from '../src/render/modelSpecs.js';
import {
  cleanName, newCampaign, choices, completeFight, takeRest, equip, unequip, levelForXp, serialize, parseSave, NODES, DIFFICULTIES,
  recordDefeat, runSummary, heroUnit,
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

  it('fights tally each hero\'s damage, kills, crits, healing and falls', () => {
    const game = new Game(['#######', '#CFg.u#', '#######'], { senses: false, rng: fixed(0.99) }); // nat 20s
    game.start();
    const [c, f, g, u] = game.units;
    setTurn(game, 1);
    g.hp = 3;
    game.attack(f, g, f.attacks[0]); // a crit for far more than 3
    expect(game.stats.F).toMatchObject({ damage: 3, kills: 1, crits: 1 });
    f.hp = 5;
    game.heal(f, 10, c);
    expect(game.stats.C.healing).toBe(10);
    game.heal(f, 99, c);
    expect(game.stats.C.healing).toBe(f.maxHp - 5); // overhealing doesn't count
    game.applyDamage(c, c.hp, u);
    expect(game.stats.C.downed).toBe(1);
    expect(game.stats.u).toBeUndefined(); // monsters aren't tallied
  });

  it('the run adds up won fights, lost fights and rounds for the ending', () => {
    const start = newCampaign('hard', { F: 'Tamsin' });
    const lost = new Game(levelById('crypt'), { party: start.party });
    lost.round = 4;
    const afterLoss = recordDefeat(start, lost);
    expect(afterLoss.stats).toMatchObject({ won: 0, lost: 1, rounds: 4 });

    const game = new Game(levelById('crypt'), { party: afterLoss.party });
    game.round = 6;
    game.stats = { F: { damage: 40, kills: 3, crits: 1, healing: 0, downed: 0 }, C: { damage: 9, kills: 0, crits: 0, healing: 22, downed: 1 } };
    for (const m of game.units) if (m.team === 'monsters') m.alive = false;
    const { state } = completeFight(afterLoss, 'crypt', game);
    expect(state.stats).toMatchObject({ won: 1, lost: 1, rounds: 10 });

    const s = runSummary(state);
    expect(s).toMatchObject({ difficulty: 'Hard', won: 1, lost: 1, rounds: 10, level: 3 });
    const tamsin = s.heroes.find((h) => h.code === 'F');
    expect(tamsin).toMatchObject({ name: 'Tamsin', cls: 'Fighter', damage: 40, kills: 3 });
    expect(tamsin.best).toEqual(['damage', 'kills', 'crits']);
    expect(s.heroes.find((h) => h.code === 'C').best).toEqual(['healing']);
    expect(s.heroes.find((h) => h.code === 'W').best).toEqual([]); // zeros lead nothing
  });

  it('saves from before the run tally start a fresh one', () => {
    const old = newCampaign();
    delete old.stats;
    expect(parseSave(serialize(old)).stats).toMatchObject({ won: 0, lost: 0, rounds: 0 });
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

  it('a save from before a hit point cut loads with HP capped at the new maximum', () => {
    const s = newCampaign('normal', {}, { R: 'A' });
    s.party.R.hp = 28; // the Ranger had 28 HP at level 3 before the tone-down
    expect(parseSave(serialize(s)).party.R.hp).toBe(24);
    s.party.R.hp = 10; // a wounded hero keeps their wounds
    expect(parseSave(serialize(s)).party.R.hp).toBe(10);
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

  it('alert monsters remember where they last saw a hero', () => {
    const { game, w, g } = setup();
    g.unaware = false;
    Object.assign(w, { x: 6, z: 2 });
    game.updateAwareness();
    expect(w.lastSeen).toEqual({ x: 6, z: 2 });
  });

  it('an alert monster hunts a hidden hero at the spot it was last seen, then Searches', () => {
    const { game, w, g } = setup();
    g.unaware = false;
    w.hidden = 13; // above the goblin's passive Perception of 9
    w.lastSeen = { x: 5, z: 2 };
    setTurn(game, game.units.indexOf(g));
    const memo = {};
    const step = nextMonsterStep(game, g, memo);
    expect(step.type).toBe('move'); // no attack: it doesn't know where Ilsa is
    game.move(g, step.x, step.z);
    expect(gridDistance(g, w.lastSeen)).toBeLessThanOrEqual(1);
    expect(nextMonsterStep(game, g, memo)).toEqual({ type: 'action', id: 'search' });
    expect(w.lastSeen).toBe(null); // that lead is used up
  });

  it('Search rolls Perception against Stealth and finds the hero on a success', () => {
    const game = new Game(rows, { rng: fixed(0.99) }); // every d20 rolls 20
    game.start();
    const w = game.units.find((u) => u.code === 'W');
    const g = game.units.find((u) => u.code === 'g');
    Object.assign(w, { x: 6, z: 2, hidden: 15 });
    g.unaware = false;
    setTurn(game, game.units.indexOf(g));
    const seen = [];
    game.on('revealed', (e) => seen.push(e));
    const r = game.doAction(g, 'search');
    expect(r.checks[0]).toMatchObject({ unit: w, total: 19, dc: 15, success: true });
    expect(w.hidden).toBe(0);
    expect(seen[0]).toMatchObject({ unit: w, cause: 'searched', by: g });
  });

  it('a failed Search leaves the hero hidden', () => {
    const { game, w, g } = setup(); // d20 11 - 1 = 10
    Object.assign(w, { x: 6, z: 2, hidden: 13 });
    g.unaware = false;
    setTurn(game, game.units.indexOf(g));
    const r = game.doAction(g, 'search');
    expect(r.found).toEqual([]);
    expect(w.hidden).toBe(13);
  });

  describe('goblins that hide', () => {
    // Ilsa at the left; a barrel at 8,1 between her and the goblin at 9,1.
    const room = ['############', '#W......&g.#', '#..........#', '############'];
    const setup = (rng = fixed(0.5)) => {
      const game = new Game(room, { rng });
      game.start();
      const w = game.units.find((u) => u.code === 'W');
      const g = game.units.find((u) => u.code === 'g');
      g.unaware = false;
      setTurn(game, game.units.indexOf(g));
      return { game, w, g };
    };

    it('a goblin hides behind a barrel as a bonus action, but not in the open', () => {
      const { game, w, g } = setup();
      const r = game.doAction(g, 'nimbleHide');
      expect(r.total).toBe(11 + 6); // Stealth +6 (DEX 2, expertise)
      expect(g.hidden).toBe(17);
      expect(g.bonusUsed).toBe(true);
      g.hidden = 0;
      g.bonusUsed = false;
      Object.assign(g, { x: 9, z: 2 }); // out from behind the barrel
      expect(game.actionProblem(g, 'nimbleHide')).toMatch(/Ilsa is watching/);
      expect(w.alive).toBe(true);
    });

    it("a hidden goblin can't be targeted, and stepping into the open gives it away", () => {
      const { game, w, g } = setup();
      game.doAction(g, 'nimbleHide');
      expect(game.attackProblem(w, g, w.attacks[0])).toMatch(/hidden/);
      expect(game.spellProblem(w, 'magicMissile', g)).toMatch(/hidden/);
      game.move(g, 9, 2);
      expect(g.hidden).toBe(0);
    });

    it('heroes Search for hidden goblins; a blast also drives them out', () => {
      const { game, w, g } = setup();
      game.doAction(g, 'nimbleHide'); // Stealth 17
      setTurn(game, game.units.indexOf(w));
      expect(game.doAction(w, 'search').found).toEqual([]); // 11 + 1 = 12
      g.hidden = 12;
      w.actionUsed = false;
      expect(game.doAction(w, 'search').found).toEqual([g]);
      expect(g.hidden).toBe(0);
      g.hidden = 17;
      game.applyDamage(g, 1, w);
      expect(g.hidden).toBe(0);
    });

    it("Search is greyed out for heroes when nothing is hidden in sight", () => {
      const { game, w } = setup();
      setTurn(game, game.units.indexOf(w));
      expect(game.actionProblem(w, 'search')).toMatch(/Nothing hidden/);
    });

    it('the goblin AI ends its turn hidden when it can', () => {
      const { game, g } = setup();
      g.actionUsed = true; // already shot
      const memo = { moved: true };
      expect(nextMonsterStep(game, g, memo)).toEqual({ type: 'bonus', id: 'nimbleHide' });
    });
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

  it('after the catacombs: the vault or the well, maybe the larder, then the barrow, which ends the act', () => {
    const base = { ...newCampaign(), cleared: ['crypt', 'warren', 'chapel', 'sanctum', 'catacombs'], at: 'catacombs' };
    expect(choices(base)).toEqual(['vault', 'well']);
    expect(choices({ ...base, at: 'vault', cleared: [...base.cleared, 'vault'] })).toEqual(['barrow', 'larder']);
    const rested = takeRest(base, 'well');
    expect(choices(rested)).toEqual(['barrow', 'larder']);
    expect(choices({ ...rested, at: 'larder', cleared: [...rested.cleared, 'larder'] })).toEqual(['barrow']);
    const game = new Game(levelById('barrow'), { party: rested.party });
    for (const u of game.units) if (u.team === 'monsters') u.alive = false;
    rested.party.W.slots = { 1: 0 };
    const { state, report } = completeFight(rested, 'barrow', game);
    expect([state.done, report.longRest]).toEqual([false, true]);
    expect(state.party.W.slots[1]).toBeGreaterThan(0); // the act break's long rest
    expect(choices(state)).toEqual(['nest']);
  });

  it('act three: the nest, then the gallery or the shrine, then the throne, which ends the act', () => {
    const base = { ...newCampaign(), at: 'nest', cleared: ['crypt', 'warren', 'chapel', 'sanctum', 'catacombs', 'well', 'barrow', 'nest'] };
    expect(choices(base)).toEqual(['gallery', 'shrine']);
    expect(choices({ ...base, at: 'gallery', cleared: [...base.cleared, 'gallery'] })).toEqual(['throne']);
    const rested = takeRest(base, 'shrine');
    expect(choices(rested)).toEqual(['throne']);
    const game = new Game(levelById('throne'), { party: rested.party });
    expect(game.units.find((u) => u.code === 'q')).toMatchObject({ name: 'Ysolde', undead: true });
    for (const u of game.units) if (u.team === 'monsters') u.alive = false;
    const { state, report } = completeFight(rested, 'throne', game);
    expect([state.done, report.longRest, choices(state)]).toEqual([false, true, ['halls']]);
    expect(LEVELS.filter((l) => l.final).map((l) => l.id)).toEqual(['tomb']);
  });

  it('a save that finished at the barrow before act three carries on, rested', () => {
    const finished = { ...newCampaign(), at: 'barrow', cleared: ['crypt', 'warren', 'chapel', 'sanctum', 'catacombs', 'well', 'barrow'], done: true };
    finished.party.F.hp = 2;
    const loaded = parseSave(serialize(finished));
    expect(loaded.done).toBe(false);
    expect(loaded.party.F.hp).toBe(31);
    expect(choices(loaded)).toEqual(['nest']);
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

describe('room dressing', () => {
  it('barrels, crates and columns are in the way; only columns block sight', () => {
    const grid = new Grid(['#######', '#.&=|.#', '#######']);
    expect([...grid.props.values()].map((p) => p.kind)).toEqual(['barrel', 'crate', 'column']);
    for (const x of [2, 3, 4]) expect(grid.isSolid(x, 1)).toBe(true);
    expect(grid.lineOfSight(1, 1, 4, 1)).toBe(true); // over the barrel and the crate
    expect(grid.lineOfSight(1, 1, 5, 1)).toBe(false); // the column is in the way
  });

  it('a crate between archer and target is half cover: +2 AC', () => {
    const game = new Game(['##########', '#R....=g.#', '##########'], { senses: false, rng: fixed(0.5) });
    game.start();
    const [r, g] = game.units;
    setTurn(game, 0);
    expect(game.coverBonus(r, g)).toBe(2);
    const shot = game.attack(r, g, r.attacks[1]);
    expect(shot.cover).toBe(2);
    expect(shot.ac).toBe(g.ac + 2);
  });

  it('your own barricade right next to you gives the target no cover', () => {
    const game = new Game(['##########', '#R=....g.#', '##########'], { senses: false });
    game.start();
    const [r, g] = game.units;
    expect(game.coverBonus(r, g)).toBe(0);
    // ...but it covers you from them
    expect(game.coverBonus(g, r)).toBe(2);
  });

  it('a column blocks the shot entirely', () => {
    const game = new Game(['##########', '#R...|.g.#', '##########'], { senses: false });
    game.start();
    const [r, g] = game.units;
    setTurn(game, 0);
    expect(game.attackProblem(r, g, r.attacks[1])).toMatch(/sight/);
  });

  it('archers prefer a target out in the open', () => {
    const game = new Game(['##########', '#F..=...g#', '#........#', '#R.......#', '##########'], { senses: false });
    game.start();
    const f = game.units.find((u) => u.code === 'F');
    const r = game.units.find((u) => u.code === 'R');
    const g = game.units.find((u) => u.code === 'g');
    Object.assign(f, { hp: 20, maxHp: 20 });
    Object.assign(r, { hp: 20, maxHp: 20 });
    expect(game.coverBonus(g, f)).toBe(2);
    expect(chooseAttack(game, g).target).toBe(r);
  });
});

describe('balance simulator', () => {
  it('plays an act-two room to the end with a level-5 party', async () => {
    const { fight } = await import('../scripts/sim.js');
    const { newCampaign, heroUnit, HERO_CODES } = await import('../src/game/campaign.js');
    const c = newCampaign();
    for (const code of HERO_CODES) {
      const u = heroUnit(code, { level: 5 });
      Object.assign(c.party[code], { level: 5, hp: u.maxHp, slots: { ...u.slotMax } });
    }
    let seed = 3;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const r = fight('barrow', c, rng);
    expect(r.game.over).toBeTruthy();
    expect(r.rounds).toBeGreaterThan(1);
  });
});

describe('level 6 and difficulty', () => {
  const party = (overrides) => {
    const s = newCampaign();
    for (const [code, rec] of Object.entries(overrides)) {
      Object.assign(s.party[code], rec);
      delete s.party[code].slots;
      delete s.party[code].hp;
    }
    return s.party;
  };

  it('2000 XP reaches level 6; 9700 level 7; 10400 level 8, the cap', () => {
    expect(levelForXp(1999)).toBe(5);
    expect(levelForXp(2000)).toBe(6);
    expect([levelForXp(9699), levelForXp(9700), levelForXp(10399), levelForXp(10400), levelForXp(99999)]).toEqual([6, 7, 7, 8, 8]);
  });

  it('Sculpt Spells: a level-6 Fireball spares the party', () => {
    const game = new Game(['##########', '#W..gg.#g#', '#..F....##', '##########'], { party: party({ W: { level: 6 } }), rng: () => 0.01 });
    game.start();
    const w = setTurn(game, 0);
    expect(w.slotMax[3]).toBe(3);
    const r = game.castSpell(w, 'fireball', { x: 5, z: 1 });
    expect(r.saves.map((s) => s.unit.code).sort()).toEqual(['g', 'g']);
  });

  it('a level-6 cleric turns undead twice per fight and is a Blessed Healer', () => {
    const game = new Game(['#######', '#CF.s.#', '#######'], { party: party({ C: { level: 6 } }), rng: () => 0.99 });
    game.start();
    const [c, f] = game.units;
    setTurn(game, 0);
    expect(game.doAction(c, 'turnUndead').ok).toBe(true);
    c.actionUsed = false;
    expect(game.doAction(c, 'turnUndead').ok).toBe(true);
    c.actionUsed = false;
    expect(game.doAction(c, 'turnUndead').ok).toBe(false);
    c.hp = 10;
    f.hp = 5;
    const r = game.castSpell(c, 'healingWord', f);
    expect(r.selfHeal).toBe(2 + r.slot);
    expect(c.hp).toBe(10 + 2 + r.slot);
  });

  it('a level-6 rogue sneak attacks with 4d6', () => {
    const game = new Game(['######', '#R.g.#', '######'], { party: party({ R: { level: 6 } }) });
    expect(game.units[0].sneakDice).toBe(4);
  });

  it('difficulty scales monster HP and weapon bonus, mimics included', () => {
    const hard = new Game(levelById('vault'), { difficulty: DIFFICULTIES.hard });
    const ghoul = hard.units.find((u) => u.code === 'u');
    expect(ghoul.maxHp).toBe(Math.round(createUnit('u', 0, 0).maxHp * 1.1));
    expect(ghoul.weaponBonus).toBe(1);
    expect(hard.units.find((u) => u.code === 'F').maxHp).toBe(createUnit('F', 0, 0).maxHp); // heroes untouched
    hard.start();
    const f = hard.units.find((u) => u.code === 'F');
    const chest = [...hard.grid.chests.values()].find((c) => c.mimic);
    Object.assign(f, { x: chest.x - 1, z: chest.z, interacted: false });
    const r = hard.springMimic(f, chest);
    expect(r.mimic.maxHp).toBe(Math.round(createUnit('m', 0, 0).maxHp * 1.1));
    const story = new Game(levelById('vault'), { difficulty: DIFFICULTIES.story });
    expect(story.units.find((u) => u.code === 'u').weaponBonus).toBe(-1);
  });

  it('a new run keeps its difficulty; older saves load as Normal', () => {
    expect(newCampaign('hard').difficulty).toBe('hard');
    const old = newCampaign();
    delete old.difficulty;
    expect(parseSave(serialize(old)).difficulty).toBe('normal');
  });
});

describe('the ghast', () => {
  it('a hero starting its turn next to an alert ghast saves or is poisoned for that turn', () => {
    const game = new Game(['######', '#Fh..#', '######'], { rng: () => 0.01 }); // the save fails
    game.start();
    const [f, h] = game.units;
    h.unaware = false;
    const seen = [];
    game.on('stench', (r) => seen.push(r));
    setTurn(game, 0);
    game.checkStench(f);
    expect(seen).toHaveLength(1);
    expect(game.has(f, 'poisoned')).toBe(true);
    game.tickConditions(f);
    expect(game.has(f, 'poisoned')).toBe(false); // only for the rest of that turn
  });

  it('passing the save makes a hero used to the smell for the fight', () => {
    const game = new Game(['######', '#Fh..#', '######'], { rng: () => 0.99 });
    game.start();
    const [f, h] = game.units;
    h.unaware = false;
    setTurn(game, 0);
    game.checkStench(f);
    expect(f.stenchSafe).toBe(true);
    let more = 0;
    game.on('stench', () => more++);
    game.checkStench(f);
    expect(more).toBe(0);
  });
});

describe('hero names', () => {
  it('names typed for a new run are cleaned and carried into fights and level-ups', () => {
    expect(cleanName('  <b>Tam&sin</b> ')).toBe('bTamsinb');
    expect(cleanName("D'Arcy  Vel-Mor")).toBe("D'Arcy Vel-Mor");
    expect(cleanName('Ölvir the Exceedingly Long')).toBe('Ölvir the Exce');
    const s = newCampaign('normal', { F: 'Tamsin', W: '   ', R: '<>' });
    expect(s.party.F.name).toBe('Tamsin');
    expect(s.party.W.name).toBeUndefined();
    expect(s.party.R.name).toBeUndefined();
    const game = new Game(levelById('crypt'), { party: s.party });
    expect(game.units.find((u) => u.code === 'F').name).toBe('Tamsin');
    expect(game.units.find((u) => u.code === 'W').name).toBe('Ilsa');
    for (const u of game.units) if (u.team === 'monsters') u.alive = false;
    s.xp = 440;
    const { report } = completeFight(s, 'crypt', game);
    expect(report.levelUps.find((l) => l.code === 'F').name).toBe('Tamsin');
  });

  it('a save with a tampered name drops it', () => {
    const s = newCampaign('normal', { F: 'Tamsin' });
    s.party.R.name = '<img src=x>';
    const loaded = parseSave(serialize(s));
    expect(loaded.party.F.name).toBe('Tamsin');
    expect(loaded.party.R.name).toBeUndefined();
  });
});


describe('the paladin', () => {
  const paladinParty = (level = 3, extra = {}) => {
    const c = newCampaign('normal', {}, { F: 'P' });
    if (level > 3) {
      const done = completeFight(c, 'crypt', { partyState: () => ({}), stats: {}, round: 0, found: [], grid: { chests: new Map() }, xpEarned: () => ({ 4: 450, 5: 900, 6: 2000 })[level] });
      return { ...done.state.party, ...extra };
    }
    return { ...c.party, ...extra };
  };
  const arena = (rows, level, rng = fixed(0.5)) => {
    const game = new Game(rows, { party: paladinParty(level), senses: false, rng });
    game.start();
    return game;
  };

  it('takes the Fighter slot: a Paladin template, keyed as F', () => {
    const c = newCampaign('normal', { F: 'Odo' }, { F: 'P' });
    expect(c.party.F).toMatchObject({ cls: 'P', hp: 28, slots: { 1: 3 }, layOnHands: 15, name: 'Odo' });
    expect(newCampaign().party.F.cls).toBeUndefined(); // the Fighter by default
    expect(newCampaign('normal', {}, { W: 'P' }).party.W.cls).toBeUndefined(); // not a choice there
    const game = arena(['######', '#Fg..#', '######']);
    const p = game.units.find((u) => u.team === 'heroes');
    expect([p.cls, p.code, p.slot, game.acOf(p)]).toEqual(['Paladin', 'P', 'F', 18]);
    expect(Object.keys(game.partyState())).toEqual(['F']);
  });

  it('Dueling adds 2 to melee weapon damage, not to a thrown javelin', () => {
    const game = arena(['######', '#Fg..#', '######']);
    const p = game.units.find((u) => u.code === 'P');
    expect(game.damageBonus(p, p.attacks[0])).toBe(3 + 2);
    expect(game.damageBonus(p, p.attacks[1])).toBe(3);
  });

  it('Divine Smite: an armed melee hit spends a slot for 2d8, 3d8 against undead, then disarms', () => {
    const game = arena(['######', '#Fs..#', '######'], 3, () => 0.999);
    const [p, s] = game.units;
    setTurn(game, 0);
    s.hp = 999;
    expect(game.toggleSmite(p)).toEqual({ ok: true, armed: true });
    const r = game.attack(p, s, p.attacks[0]);
    expect(r.smite).toMatchObject({ slot: 1, dice: 3 });
    expect(r.smite.total).toBe(48); // a crit doubles the smite dice: 6d8 at 8 each
    expect(p.slots[1]).toBe(2);
    expect(p.smiteArmed).toBe(false);
  });

  it('Divine Smite: a thrown javelin never smites; no slots, no arming', () => {
    const game = arena(['########', '#F...g.#', '########'], 3, () => 0.95);
    const [p, g] = game.units;
    setTurn(game, 0);
    g.hp = 999;
    game.toggleSmite(p);
    const r = game.attack(p, g, p.attacks[1]);
    expect(r.hit).toBe(true);
    expect(r.smite).toBeNull();
    expect(p.smiteArmed).toBe(true); // still waiting for a melee hit
    game.toggleSmite(p);
    p.slots = { 1: 0 };
    expect(game.toggleSmite(p).ok).toBe(false);
  });

  it('Lay on Hands heals from the pool, only what is missing', () => {
    const game = arena(['#######', '#FW.g.#', '#######']);
    const p = game.units.find((u) => u.code === 'P');
    const w = game.units.find((u) => u.code === 'W');
    setTurn(game, game.units.indexOf(p));
    expect(game.spellProblem(p, 'layOnHands', w)).toBe('Ilsa is unhurt');
    w.hp -= 6;
    const r = game.castSpell(p, 'layOnHands', w);
    expect([r.healed, r.left, w.hp]).toEqual([6, 9, w.maxHp]);
    expect(game.stats.F.healing).toBe(6);
    p.layOnHands = 0;
    w.hp -= 3;
    p.actionUsed = false;
    expect(game.spellProblem(p, 'layOnHands', w)).toBe('Your healing pool is spent');
  });

  it('Shield of Faith: +2 AC on one ally at a time, gone when the paladin falls', () => {
    const game = arena(['#######', '#FW.g.#', '#######']);
    const p = game.units.find((u) => u.code === 'P');
    const w = game.units.find((u) => u.code === 'W');
    setTurn(game, game.units.indexOf(p));
    const ac = game.acOf(w);
    expect(game.castSpell(p, 'shieldOfFaith', w).ok).toBe(true); // unhurt is fine: not a heal
    expect(game.acOf(w)).toBe(ac + 2);
    p.bonusUsed = false;
    game.castSpell(p, 'shieldOfFaith', p);
    expect(game.acOf(w)).toBe(ac);
    expect(game.acOf(p)).toBe(20);
    game.applyDamage(p, 999, game.units.find((u) => u.code === 'g'));
    expect(p.faithFrom).toBeNull();
  });

  it('levels 3 to 6: Extra Attack and bigger slots at 5, Aura of Protection at 6', () => {
    const party = paladinParty(6);
    expect(party.F).toMatchObject({ cls: 'P', level: 6, layOnHands: 30 });
    const game = new Game(['########', '#FW..g.#', '########'], { party, senses: false, rng: fixed(0.5) });
    const p = game.units.find((u) => u.code === 'P');
    const w = game.units.find((u) => u.code === 'W');
    expect([p.maxHp, p.extraAttack, p.slotMax, p.stats.str]).toEqual([52, 2, { 1: 4, 2: 2 }, 18]);
    expect(game.save(w, 'wis', 10).aura).toBe(3); // CHA 16
    expect(game.save(game.units.find((u) => u.code === 'g'), 'wis', 10).aura).toBe(0);
    w.x = 5; w.z = 1; game.units.find((u) => u.code === 'g').x = 3;
    expect(game.auraBonus(w)).toBe(0); // out of the 10-ft aura
  });

  it('carries class, pool and tally through the campaign and the save', () => {
    const c = newCampaign('normal', {}, { F: 'P' });
    const game = new Game(['######', '#Fg..#', '######'], { party: c.party, senses: false, rng: () => 0.999 });
    game.start();
    const [p, g] = game.units;
    setTurn(game, 0);
    p.layOnHands = 4;
    p.hp = 10;
    game.attack(p, g, p.attacks[0]);
    const { state, report } = completeFight({ ...c, xp: 440 }, 'crypt', game);
    expect(state.party.F).toMatchObject({ cls: 'P', level: 4, layOnHands: 9 }); // the pool doesn't refill on a short rest
    expect(state.party.F.hp).toBe(19 + 8); // half the missing 18 back, plus the level's 8
    expect(state.stats.heroes.F.kills).toBe(1);
    expect(report.levelUps[0]).toMatchObject({ code: 'F', name: 'Brannoc', note: 'Strength 18: +1 to hit and damage' });
    expect(runSummary(state).heroes[0].cls).toBe('Paladin');
    const rested = takeRest(state, 'chapel');
    expect(rested.party.F).toMatchObject({ hp: 36, layOnHands: 20 });
    const loaded = parseSave(serialize(state));
    expect(loaded.party.F).toMatchObject({ cls: 'P', layOnHands: 9 });
    const bad = JSON.parse(serialize(state));
    bad.party.F.cls = 'W';
    bad.party.W.layOnHands = 5;
    const fixedSave = parseSave(JSON.stringify(bad));
    expect(fixedSave.party.F.cls).toBeUndefined();
    expect(fixedSave.party.F.layOnHands).toBeUndefined();
    expect(fixedSave.party.W.layOnHands).toBeUndefined();
  });
});

describe('the ranger', () => {
  const rangerParty = (level = 3) => {
    const c = newCampaign('normal', {}, { R: 'A' });
    if (level > 3) {
      const done = completeFight(c, 'crypt', { partyState: () => ({}), stats: {}, round: 0, found: [], grid: { chests: new Map() }, xpEarned: () => ({ 4: 450, 5: 900, 6: 2000 })[level] });
      return done.state.party;
    }
    return c.party;
  };
  const arena = (rows, level, rng = fixed(0.5)) => {
    const game = new Game(rows, { party: rangerParty(level), senses: false, rng });
    game.start();
    return game;
  };

  it('takes the Rogue slot: a Ranger template, keyed as R, that still spots traps', () => {
    const c = newCampaign('normal', { R: 'Ash' }, { R: 'A' });
    expect(c.party.R).toMatchObject({ cls: 'A', hp: 24, slots: { 1: 3 }, name: 'Ash' });
    expect(newCampaign().party.R.cls).toBeUndefined(); // the Rogue by default
    expect(newCampaign('normal', {}, { F: 'A' }).party.F.cls).toBeUndefined(); // not a choice there
    const game = arena(['######', '#Rg..#', '######']);
    const r = game.units.find((u) => u.team === 'heroes');
    expect([r.cls, r.code, r.slot, r.name, game.acOf(r)]).toEqual(['Ranger', 'A', 'R', 'Wren', 15]);
    expect(r.passives).toContain('trapSense');
    expect(Object.keys(game.partyState())).toEqual(['R']);
  });

  it('Archery adds 1 to hit with the bow, not the sword', () => {
    const game = arena(['######', '#Rg..#', '######']);
    const r = game.units.find((u) => u.code === 'A');
    expect(game.toHitBonus(r, r.attacks[1])).toBe(3 + 2 + 1);
    expect(game.toHitBonus(r, r.attacks[0])).toBe(3 + 2);
  });

  it('Hunter’s Mark: +1d6 on weapon hits on the marked foe; a new mark always costs a slot', () => {
    const game = arena(['#########', '#R...g.g#', '#########']);
    const [r, g1, g2] = game.units;
    setTurn(game, 0);
    g1.hp = g1.maxHp = 999;
    g2.hp = g2.maxHp = 999;
    const cast = game.castSpell(r, 'huntersMark', g1);
    expect(cast).toMatchObject({ ok: true, slot: 1 });
    expect([r.slots[1], r.bonusUsed, r.mark]).toEqual([2, true, { id: g1.id, slot: 1, spell: 'huntersMark' }]);
    const hit = game.attack(r, g1, r.attacks[1]);
    expect(hit.hit).toBe(true);
    expect(hit.mark.total).toBe(4); // 1d6 at the middle roll
    expect(hit.damage).toBe(hit.damageRoll.total + 3 + 4);

    setTurn(game, 0);
    const other = game.attack(r, g2, r.attacks[1]);
    expect(other.mark).toBeNull(); // only the marked foe
    r.bonusUsed = false;
    expect(game.spellProblem(r, 'huntersMark', g1)).toBe('Goblin 1 is already marked');
    // Even once the marked foe falls, moving the mark takes a new slot (SRD: free).
    game.applyDamage(g1, 9999, r);
    r.slots = { 1: 0 };
    expect(game.freeRecast(r, 'huntersMark')).toBe(false);
    expect(game.spellProblem(r, 'huntersMark', g2)).not.toBeNull(); // no slots left
    r.slots = { 1: 1 };
    const moved = game.castSpell(r, 'huntersMark', g2);
    expect(moved).toMatchObject({ ok: true, slot: 1 });
    expect([r.slots[1], r.mark]).toEqual([0, { id: g2.id, slot: 1, spell: 'huntersMark' }]);
    r.bonusUsed = false;
    game.applyDamage(r, 999, g2);
    expect(r.mark).toBeNull(); // a fallen ranger's mark ends
  });

  it('Hunter’s Mark: moving it off a living foe costs a slot; the tags follow, and end with the ranger', () => {
    const game = arena(['#########', '#R...g.g#', '#########']);
    const [r, g1, g2] = game.units;
    setTurn(game, 0);
    game.castSpell(r, 'huntersMark', g1);
    r.bonusUsed = false;
    const moved = game.castSpell(r, 'huntersMark', g2);
    expect(moved).toMatchObject({ ok: true, slot: 1, unmarked: g1 });
    expect([r.slots[1], g1.marked, g2.marked]).toEqual([1, false, 'huntersMark']);
    const deaths = [];
    game.on('death', (e) => deaths.push(e));
    game.applyDamage(r, 999, g2);
    expect([g2.marked, deaths[0].unmarked]).toEqual([false, g2]);
  });

  it('Colossus Slayer (from level 5): +1d8 once per turn, only on a foe that is already hurt', () => {
    expect(rangerParty(3).R.level).toBe(3);
    const low = arena(['########', '#R...g.#', '########']);
    expect(low.units[0].passives).not.toContain('colossusSlayer');
    expect(low.units[0].spells).toEqual(['huntersMark']); // no Cure Wounds
    const game = arena(['########', '#R...g.#', '########'], 5);
    const [r, g] = game.units;
    setTurn(game, 0);
    g.hp = g.maxHp = 999;
    expect(game.attack(r, g, r.attacks[1]).colossus).toBeNull(); // unhurt when the arrow lands
    r.actionUsed = false;
    const second = game.attack(r, g, r.attacks[1]);
    expect(second.colossus.total).toBe(5); // 1d8 at the middle roll
    r.actionUsed = false;
    expect(game.attack(r, g, r.attacks[1]).colossus).toBeNull(); // once per turn
    setTurn(game, 0);
    expect(game.attack(r, g, r.attacks[1]).colossus.total).toBe(5);
  });

  it('levels 3 to 6: Extra Attack and 2nd-level slots at 5, Escape the Horde at 6', () => {
    const party = rangerParty(6);
    expect(party.R).toMatchObject({ cls: 'A', level: 6 });
    const game = new Game(['######', '#Rg..#', '######'], { party, senses: false, rng: fixed(0.5) });
    const [r, g] = game.units;
    expect([r.maxHp, game.acOf(r), r.extraAttack, r.slotMax, r.stats.dex]).toEqual([48, 16, 2, { 1: 4, 2: 2 }, 18]);
    expect(game.attackMods(g, r, g.attacks[0], { opportunity: true }).dis).toContain('escape the horde');
    expect(game.attackMods(g, r, g.attacks[0]).dis).not.toContain('escape the horde');
  });

  it('carries its class through the campaign and the save', () => {
    const c = newCampaign('normal', {}, { R: 'A' });
    const game = new Game(['######', '#Rg..#', '######'], { party: c.party, senses: false, rng: () => 0.999 });
    game.start();
    const [r, g] = game.units;
    setTurn(game, 0);
    game.castSpell(r, 'huntersMark', g);
    game.attack(r, g, r.attacks[0]);
    const { state, report } = completeFight({ ...c, xp: 440 }, 'crypt', game);
    expect(state.party.R).toMatchObject({ cls: 'A', level: 4, slots: { 1: 2 } }); // a short rest keeps slots spent
    expect(state.stats.heroes.R.kills).toBe(1);
    expect(report.levelUps.find((l) => l.code === 'R')).toMatchObject({ name: 'Wren', note: 'Dexterity 18: +1 to hit, damage and AC' });
    expect(runSummary(state).heroes.find((h) => h.code === 'R').cls).toBe('Ranger');
    expect(parseSave(serialize(state)).party.R.cls).toBe('A');
    const bad = JSON.parse(serialize(state));
    bad.party.W.cls = 'A';
    expect(parseSave(JSON.stringify(bad)).party.W.cls).toBeUndefined();
  });
});

describe('the warlock', () => {
  const warlockParty = (level = 3) => {
    const c = newCampaign('normal', {}, { W: 'K' });
    if (level > 3) {
      const done = completeFight(c, 'crypt', { partyState: () => ({}), stats: {}, round: 0, found: [], grid: { chests: new Map() }, xpEarned: () => ({ 4: 450, 5: 900, 6: 2000 })[level] });
      return done.state.party;
    }
    return c.party;
  };
  // fixed(0.5): every d20 is 11, d10 6, d6 4.
  const arena = (rows, level, rng = fixed(0.5)) => {
    const game = new Game(rows, { party: warlockParty(level), senses: false, rng });
    game.start();
    return game;
  };

  it('takes the Wizard slot: Ilsa as a Warlock with two 2nd-level pact slots', () => {
    const c = newCampaign('normal', {}, { W: 'K' });
    expect(c.party.W).toMatchObject({ cls: 'K', hp: 24, slots: { 2: 2 } });
    const game = arena(['######', '#Wg..#', '######']);
    const k = game.units[0];
    expect([k.cls, k.code, k.slot, k.name, game.acOf(k)]).toEqual(['Warlock', 'K', 'W', 'Ilsa', 15]);
    expect(game.spellDC(k)).toBe(13);
  });

  it('Eldritch Blast adds CHA to damage; Hex adds 1d6 to every hit on the cursed foe', () => {
    const game = arena(['#########', '#W...g.g#', '#########']);
    const [k, g1, g2] = game.units;
    g1.hp = g1.maxHp = g2.hp = g2.maxHp = 999;
    setTurn(game, 0);
    const blast = game.attack(k, g1, k.attacks[0]);
    expect([blast.hit, blast.toHit, blast.damage, blast.mark]).toEqual([true, 5, 6 + 3, null]);
    const hex = game.castSpell(k, 'hex', g1);
    expect(hex).toMatchObject({ ok: true, slot: 2 }); // pact slots are all 2nd level
    expect([k.slots[2], k.mark, g1.marked]).toEqual([1, { id: g1.id, slot: 2, spell: 'hex' }, 'hex']);
    setTurn(game, 0);
    const cursed = game.attack(k, g1, k.attacks[0]);
    expect([cursed.mark.spell, cursed.mark.total, cursed.damage]).toEqual(['hex', 4, 6 + 3 + 4]);
    expect(game.attack(k, g2, k.attacks[0]).ok).toBe(false); // action spent: no second beam yet
    setTurn(game, 0);
    expect(game.attack(k, g2, k.attacks[0]).mark).toBeNull(); // only the cursed foe
    k.bonusUsed = false;
    expect(game.spellProblem(k, 'hex', g1)).toBe('Goblin 1 is already hexed');
  });

  it('Scorching Ray: three spell attacks at one foe; once it falls, the rest go to the nearest other', () => {
    const game = arena(['##########', '#W..g.g..#', '##########']);
    const [k, g1, g2] = game.units;
    setTurn(game, 0);
    g2.hp = g2.maxHp = 999;
    const r = game.castSpell(k, 'scorchingRay', g1);
    expect(r).toMatchObject({ ok: true, slot: 2 });
    expect(r.rays.map((ray) => [ray.target.name, ray.hit, ray.damage])).toEqual([
      ['Goblin 1', true, 8], ['Goblin 2', true, 8], ['Goblin 2', true, 8],
    ]);
    expect([g1.alive, g2.hp]).toEqual([false, 999 - 16]);
    // A 3rd-level slot adds a ray.
    setTurn(game, 0);
    k.slots = { 3: 1 };
    expect(game.castSpell(k, 'scorchingRay', g2).rays).toHaveLength(4);
  });

  it('Hellish Rebuke: armed, the next enemy that damages you takes 3d10 fire, DEX save for half', () => {
    const game = arena(['######', '#Wg..#', '######']);
    const [k, g] = game.units;
    setTurn(game, 1);
    expect(game.attack(g, k, g.attacks[0]).rebuke).toBeNull(); // not armed: nothing
    expect(game.toggleRebuke(k)).toEqual({ ok: true, armed: true });
    setTurn(game, 1);
    g.hp = g.maxHp = 50;
    const hit = game.attack(g, k, g.attacks[0]);
    // DEX save: 11 + 2 = 13 against DC 13, a success: half of 3 × 6.
    expect(hit.rebuke).toMatchObject({ id: 'hellishRebuke', slot: 2, damage: 9, dc: 13 });
    expect(hit.rebuke.save.success).toBe(true);
    expect([g.hp, k.slots[2], k.rebukeArmed, k.reactionUsed]).toEqual([41, 1, false, true]);
    expect(game.rebukeProblem({ ...k, rebukeArmed: false, slots: { 2: 0 } })).toBe('No spell slots left');
    // Dropped by the hit: no rebuke.
    game.toggleRebuke(k);
    setTurn(game, 1);
    k.hp = 1;
    expect(game.attack(g, k, g.attacks[0]).rebuke).toBeNull();
  });

  it('Dark One’s Blessing: a kill gives CHA + level temporary HP, lost first, gone after the fight', () => {
    const game = arena(['######', '#Wg.g#', '######']);
    const [k, g1, g2] = game.units;
    const deaths = [];
    game.on('death', (d) => deaths.push(d));
    setTurn(game, 0);
    game.attack(k, g1, k.attacks[0]); // 9 damage on 7 HP
    expect([g1.alive, k.tempHp, deaths[0].blessing]).toEqual([false, 6, { unit: k, tempHp: 6 }]);
    game.applyDamage(k, 4, g2);
    expect([k.tempHp, k.hp]).toEqual([2, 24]);
    game.applyDamage(k, 5, g2);
    expect([k.tempHp, k.hp]).toEqual([0, 21]);
    expect(game.partyState().W.tempHp).toBeUndefined();
  });

  it('level 5: two beams, but only with Eldritch Blast; 3rd-level pact slots and Fireball', () => {
    const game = arena(['########', '#Wg.g..#', '########'], 5);
    const [k, g1, g2] = game.units;
    g1.hp = g1.maxHp = g2.hp = g2.maxHp = 999;
    expect([k.slots, k.spells.includes('fireball')]).toEqual([{ 2: 0, 3: 2 }, true]);
    setTurn(game, 0);
    expect(game.attack(k, g2, k.attacks[0]).ok).toBe(true);
    expect(game.attackProblem(k, g1, k.attacks[1])).toBe('Only Eldritch Blast fires again');
    expect(game.attack(k, g1, k.attacks[0]).ok).toBe(true);
    expect(game.canAttack(k)).toBe(false);
    setTurn(game, 0);
    game.attack(k, g1, k.attacks[1]); // opening with the dagger is the whole action
    expect(game.canAttack(k)).toBe(false);
    expect(game.shoveProblem(k, g1)).toBe('Action already used this turn');
  });

  it('level 6: Dark One’s Own Luck adds 1d10 to one failed save a fight, when it could help', () => {
    const game = arena(['######', '#Wg..#', '######'], 6);
    const k = game.units[0];
    expect(game.save(k, 'dex', 30)).toMatchObject({ total: 13, luck: null, success: false }); // out of reach
    expect(game.save(k, 'dex', 16)).toMatchObject({ total: 19, luck: 6, success: true });
    expect(game.save(k, 'dex', 16)).toMatchObject({ total: 13, luck: null, success: false }); // once a fight
  });

  it('pact slots come back after every room, and survive the level-5 switch to 3rd level', () => {
    const c = newCampaign('normal', {}, { W: 'K' });
    const game = new Game(['######', '#Wg..#', '######'], { party: c.party, senses: false, rng: () => 0.999 });
    game.start();
    const [k, g] = game.units;
    setTurn(game, 0);
    game.castSpell(k, 'scorchingRay', g);
    expect(k.slots[2]).toBe(1);
    const { state } = completeFight(c, 'crypt', game);
    expect(state.party.W.slots).toEqual({ 2: 2 });
    state.party.W.slots = { 2: 0 };
    const up = completeFight({ ...state, xp: 890 }, 'warren', { ...game, partyState: () => ({}), xpEarned: () => 10, found: [], grid: { chests: new Map() }, stats: {}, round: 0 });
    expect(up.state.party.W).toMatchObject({ level: 5, slots: { 2: 0, 3: 2 } });
    expect(parseSave(serialize(up.state)).party.W.cls).toBe('K');
    const bad = JSON.parse(serialize(up.state));
    bad.party.R.cls = 'K';
    expect(parseSave(JSON.stringify(bad)).party.R.cls).toBeUndefined();
  });
});

describe('level-5 spell choices', () => {
  const at5 = (classes = {}) => {
    const party = newCampaign('normal', {}, classes).party;
    for (const [code, r] of Object.entries(party)) {
      const u = heroUnit(code, { cls: r.cls, level: 5 });
      Object.assign(r, { level: 5, hp: u.maxHp, slots: { ...u.slotMax } });
    }
    return party;
  };

  it('lineTiles runs straight from the caster and stops at a wall', () => {
    const grid = new Grid(['########', '#......#', '#...#..#', '########']);
    expect(lineTiles(grid, { x: 1, z: 1 }, { x: 3, z: 1 }, 20)).toEqual([2, 3, 4, 5, 6].map((x) => ({ x, z: 1 })));
    const diag = lineTiles(grid, { x: 1, z: 1 }, { x: 2, z: 2 }, 20);
    expect(diag).toEqual([{ x: 2, z: 2 }]); // the next step is the wall row
    expect(lineTiles(grid, { x: 1, z: 1 }, { x: 6, z: 1 }, 2)).toHaveLength(2);
  });

  it('Lightning Bolt: 8d6 down the line, DEX half, the party too (until Sculpt Spells)', () => {
    const game = new Game(['##########', '#W.g.R.g.#', '##########'], { party: at5(), senses: false, rng: fixed(0.5) });
    const w = game.units.find((u) => u.code === 'W');
    setTurn(game, game.units.indexOf(w));
    expect(w.spells).toContain('lightningBolt');
    for (const g of game.units.filter((u) => u.code === 'g')) g.hp = 999;
    const r = game.castSpell(w, 'lightningBolt', { x: 3, z: 1 });
    expect(r.ok).toBe(true);
    expect(r.saves.map((s) => s.unit.code)).toEqual(['g', 'R', 'g']);
    expect(r.roll.rolls).toHaveLength(8);
    expect(w.slots[3]).toBe(1);
    w.sculpt = true;
    expect(game.blastVictims(w, r.tiles).map((u) => u.code)).toEqual(['g', 'g']);
  });

  it('Spiritual Weapon: a slot to summon, then free bonus-action strikes within 25 ft of it', () => {
    const game = new Game(['###########', '#C.....g..#', '###########'], { party: at5(), senses: false, rng: () => 0.9 }); // d20 19, d8 8
    const c = game.units.find((u) => u.code === 'C');
    const g = game.units.find((u) => u.code === 'g');
    g.hp = 999;
    setTurn(game, game.units.indexOf(c));
    expect(c.spells).toContain('spiritualWeapon');
    const r = game.castSpell(c, 'spiritualWeapon', g);
    expect(r).toMatchObject({ ok: true, again: false, hit: true, slot: 2, to: { x: 6, z: 1 } });
    expect(r.damage).toBe(8 + 4); // 1d8 (max) + WIS (18 from level 4)
    expect(c.slots[2]).toBe(2); // 3 at level 4+, one spent
    expect(c.spiritWeapon).toEqual({ x: 6, z: 1, slot: 2 });
    expect(game.spellProblem(c, 'spiritualWeapon', g)).toBe('Bonus action already used this turn');
    setTurn(game, game.units.indexOf(c));
    const again = game.castSpell(c, 'spiritualWeapon', g);
    expect(again).toMatchObject({ ok: true, again: true, slot: 0 });
    expect(c.slots[2]).toBe(2); // no slot spent
    g.x = 9;
    c.spiritWeapon = { x: 2, z: 1, slot: 2 };
    c.bonusUsed = false;
    expect(game.spellProblem(c, 'spiritualWeapon', g)).toBe('Too far from the spectral weapon (25 ft)');
    game.applyDamage(c, 999, g);
    expect(c.spiritWeapon).toBeNull();
  });
});

describe('act three monsters', () => {
  const lair = (rng = fixed(0.95)) => new Game(['########', '#W..k..#', '########'], { senses: false, rng });

  it('a spider’s web hits for no damage, restrains, then has to recharge', () => {
    const game = lair();
    const [w, k] = game.units;
    setTurn(game, 1);
    const hp = w.hp;
    const web = k.attacks[1];
    expect(chooseAttack(game, k).attack).toBe(web); // at range, someone not yet caught
    const r = game.attack(k, w, web);
    expect([r.hit, r.damage, w.hp]).toEqual([true, 0, hp]);
    expect(r.rider).toMatchObject({ stat: null, success: false, condition: 'restrained' });
    expect(game.has(w, 'restrained')).toBe(true);
    k.actionUsed = false;
    expect(game.attackProblem(k, w, web)).toBe('Web hasn\'t recharged');
    expect(game.attackMods(k, w, k.attacks[0]).adv).toContain('target restrained');
    expect(game.attackMods(w, k, w.attacks[0]).dis).toContain('restrained');

    setTurn(game, 0); // caught: no movement this turn
    expect(w.movesLeft).toBe(0);
    game.rng = fixed(0.95, 0);
    expect(game.save(w, 'dex', 10).d20).toBe(1); // DEX saves at disadvantage
    game.endTurn();
    expect(game.has(w, 'restrained')).toBe(false); // wears off at the end of that turn
  });

  it('the web recharges on a 5 or 6 at the start of the spider’s turn', () => {
    const game = lair();
    const [w, k] = game.units;
    setTurn(game, 1);
    game.attack(k, w, k.attacks[1]);
    game.rng = fixed(0.5); // a 4
    setTurn(game, 1);
    expect(k.spent.Web).toBe(true);
    game.rng = fixed(0.9); // a 6
    setTurn(game, 1);
    expect(k.spent.Web).toBeUndefined();
  });

  it('a specter is undead; its Life Drain adds no modifier and frightens on a failed WIS save', () => {
    const game = new Game(['#######', '#We...#', '#######'], { senses: false, rng: fixed(0) });
    const [w, e] = game.units;
    expect(e.undead).toBe(true);
    const touch = e.attacks[0];
    expect(game.damageBonus(e, touch)).toBe(0);
    expect(game.applyRider(e, w, touch.rider)).toMatchObject({ stat: 'wis', success: false, condition: 'frightened' });
    expect(game.fearSource(w)).toBe(e);
  });
});

describe('model loading per room', () => {
  it('the first room waits only for the six figures it shows', () => {
    expect(filesForRoom(levelById('crypt').rows, null).sort()).toEqual(
      ['Barbarian', 'Knight', 'Mage', 'Rogue_Hooded', 'Skeleton_Warrior', 'monsters/Rat'],
    );
  });

  it('every room asks for the figure of every unit that can appear in it', () => {
    for (const party of [null, newCampaign('normal', {}, { F: 'P', R: 'A' }).party]) {
      for (const level of LEVELS) {
        const files = new Set(filesForRoom(level.rows, party));
        const game = new Game(level, { party });
        for (const u of game.units) {
          const spec = SPECS[u.code];
          if (spec) expect(files.has(spec.file), `${level.id}: ${u.name}`).toBe(true);
          // Anyone who can raise the dead needs the risen skeleton's rig too.
          if (u.spells?.includes('animateDead')) expect(files.has(SPECS.risen.file), `${level.id}: risen`).toBe(true);
        }
      }
    }
  });
});

describe('act four and levels 7–8', () => {
  const ACT_THREE = ['crypt', 'warren', 'chapel', 'sanctum', 'catacombs', 'well', 'barrow', 'nest', 'shrine', 'throne'];
  const levelled = (level, classes = {}) => {
    const s = newCampaign('normal', {}, classes);
    for (const code of Object.keys(s.party)) {
      Object.assign(s.party[code], { level });
      delete s.party[code].slots;
      delete s.party[code].hp;
    }
    return s.party;
  };
  const arena = (rows, level, classes, rng = fixed(0.5)) => {
    const game = new Game(rows, { party: levelled(level, classes), senses: false, rng });
    game.start();
    return game;
  };

  it('after the throne: the halls, then the armory or the hearth, then the tomb, which ends the campaign', () => {
    const base = { ...newCampaign(), at: 'halls', cleared: [...ACT_THREE, 'halls'] };
    expect(choices(base)).toEqual(['armory', 'hearth']);
    expect(choices({ ...base, at: 'armory', cleared: [...base.cleared, 'armory'] })).toEqual(['tomb']);
    const rested = takeRest(base, 'hearth');
    expect(choices(rested)).toEqual(['tomb']);
    const game = new Game(levelById('tomb'), { party: rested.party });
    expect(game.units.find((u) => u.code === 'l')).toMatchObject({ name: 'Nekhet', cls: 'Mummy Lord', undead: true });
    for (const u of game.units) if (u.team === 'monsters') u.alive = false;
    expect(completeFight(rested, 'tomb', game).state.done).toBe(true);
  });

  it('a run that ended at the throne before act four carries on, rested', () => {
    const finished = { ...newCampaign(), at: 'throne', cleared: ACT_THREE, done: true };
    finished.party.F.hp = 3;
    const s = parseSave(serialize(finished));
    expect([s.done, choices(s), s.party.F.hp]).toEqual([false, ['halls'], heroUnit('F', s.party.F).maxHp]);
  });

  it('the new monsters: mummies and the mummy lord are undead, the fallen knights are not', () => {
    const game = new Game(levelById('halls'));
    const codes = game.units.filter((u) => u.team === 'monsters').map((u) => u.code).sort();
    expect(codes).toEqual(['s', 's', 's', 't', 'y']);
    const knights = new Game(levelById('armory')).units.filter((u) => u.code === 'x');
    expect(knights.map((k) => [k.name.replace(/ \d$/, ''), k.ac, k.undead ?? false])).toEqual(Array(4).fill(['Fallen Knight', 18, false]));
  });

  it('only one runed weapon per hero', () => {
    const s = { ...newCampaign(), pack: ['weaponPlus1', 'weaponPlus2'] };
    const one = equip(s, 0, 'F');
    expect(one.party.F.items).toEqual(['weaponPlus1']);
    expect(equip(one, 0, 'F').party.F.items).toEqual(['weaponPlus1']);
    expect(equip(one, 0, 'R').party.R.items).toEqual(['weaponPlus2']);
  });

  it('Fighter 7: weapon attacks crit on a 19', () => {
    // 19/20 → d20 19
    const game = arena(['#####', '#Fg.#', '#####'], 7, {}, fixed(0.9));
    const [f, g] = game.units;
    g.hp = g.maxHp = 999;
    setTurn(game, 0);
    expect(f.passives).toContain('improvedCritical');
    const r = game.attack(f, g, f.attacks[0]);
    expect([r.d20, r.crit]).toEqual([19, true]);
  });

  it('Rogue 7: Evasion takes no damage from a made DEX save and half from a failed one', () => {
    // a Warlock's Fireball (a Wizard's would be sculpted around the party)
    const game = arena(['#########', '#W...R..#', '#########'], 7, { W: 'K' });
    const [w, r] = game.units;
    expect(r.passives).toContain('evasion');
    setTurn(game, 0);
    const blast = game.castSpell(w, 'fireball', { x: 5, z: 1 });
    const save = blast.saves.find((s) => s.unit === r);
    expect(save.damage).toBe(save.success ? 0 : Math.floor(blast.roll.total / 2));
  });

  it('Wizard 7: Ice Storm from a 4th-level slot, 2d8 + 4d6, DEX save for half', () => {
    const game = arena(['##########', '#W.....gg#', '##########'], 7);
    const w = setTurn(game, 0);
    expect([w.slotMax[4], w.spells.includes('iceStorm')]).toEqual([1, true]);
    const r = game.castSpell(w, 'iceStorm', { x: 7, z: 1 });
    expect([r.ok, r.slot, r.roll.rolls.length]).toEqual([true, 4, 6]);
    expect(r.saves.map((s) => s.unit.code)).toEqual(['g', 'g']);
  });

  it('Ice Storm leaves its ground difficult until the end of the caster\'s next turn', () => {
    const game = arena(['################', '#W............g#', '################'], 7);
    const [w, g] = game.units;
    g.hp = g.maxHp = 999;
    expect(game.moveCost()).toBe(null); // no ice: the plain search
    setTurn(game, 0);
    game.castSpell(w, 'iceStorm', { x: 7, z: 1 });
    const icy = game.icyTiles();
    expect(['3,1', '11,1'].every((k) => icy.has(k)) && !icy.has('12,1')).toBe(true);
    g.movesLeft = 6;
    const reach = game.reachable(g);
    expect([reach.get('12,1').dist, reach.get('11,1').dist, reach.get('10,1').dist, reach.has('9,1')])
      .toEqual([2, 4, 6, false]);
    game.endTurn(); // the end of the casting turn: still icy
    expect(game.icyTiles().size).toBe(icy.size);
    while (game.current !== w) game.endTurn();
    game.endTurn(); // the end of the caster's next turn: thawed
    expect([game.icyTiles().size, game.moveCost()]).toEqual([0, null]);
  });

  it('fliers (specters, wraiths, Ysolde) drift over icy ground at full speed', () => {
    const game = arena(['################', '#W............t#', '################'], 7);
    const [w, t] = game.units;
    t.hp = t.maxHp = 999;
    setTurn(game, 0);
    game.castSpell(w, 'iceStorm', { x: 7, z: 1 });
    t.movesLeft = 8;
    expect(t.flies).toBe(true);
    expect(game.reachable(t).get('6,1')?.dist).toBe(8);
  });

  it('a move across icy ground spends the extra movement', () => {
    const game = arena(['################', '#W..........g..#', '################'], 7);
    const [w, g] = game.units;
    g.hp = g.maxHp = 999;
    setTurn(game, 0);
    game.castSpell(w, 'iceStorm', { x: 5, z: 1 });
    game.endTurn();
    expect(game.current).toBe(g);
    g.movesLeft = 6;
    const r = game.move(g, 9, 1); // 11, 10 plain; 9 icy: 1 + 1 + 2
    expect(r).toBeTruthy();
    expect(g.movesLeft).toBe(2);
  });

  it('Warlock 7: pact slots become 4th level, so Scorching Ray fires five rays', () => {
    const game = arena(['#########', '#W.....g#', '#########'], 7, { W: 'K' });
    const [k, g] = game.units;
    g.hp = g.maxHp = 999;
    expect([k.slotMax[3], k.slotMax[4], k.slots[4]]).toEqual([0, 2, 2]);
    setTurn(game, 0);
    expect(game.castSpell(k, 'scorchingRay', g).rays).toHaveLength(5);
  });

  it('Cleric 7: Death Ward leaves a warded ally on 1 HP once', () => {
    const game = arena(['######', '#CF.g#', '######'], 7);
    const [c, f] = game.units;
    setTurn(game, 0);
    expect(game.castSpell(c, 'deathWard', f)).toMatchObject({ ok: true, slot: 4 });
    expect(game.spellProblem(c, 'deathWard', f)).toBeTruthy();
    game.applyDamage(f, 500, null);
    expect([f.hp, f.alive, f.deathWard]).toEqual([1, true, false]);
    game.applyDamage(f, 500, null);
    expect(f.alive).toBe(false);
  });

  it('mummy rot: a failed CON save stops healing for two of the target\'s turns', () => {
    const game = arena(['######', '#CFy.#', '######'], 7);
    const [c, f, y] = game.units;
    const rider = y.attacks[0].rider;
    expect(rider).toMatchObject({ save: 'con', dc: 12, condition: 'rotting' });
    setTurn(game, 0);
    game.rng = () => 0; // a natural 1
    expect(game.applyRider(y, f, rider)).toMatchObject({ success: false, condition: 'rotting' });
    f.hp = 10;
    expect(game.heal(f, 8)).toBe(0);
    expect(f.hp).toBe(10);
    expect(game.actionProblem(f, 'potion')).toMatch(/Rotting/);
    expect(game.spellProblem(c, 'healingWord', f)).toMatch(/rotting/);
    expect(game.massHealTargets(c)).not.toContain(f);
    game.tickConditions(f);
    expect(game.has(f, 'rotting')).toBe(true);
    game.tickConditions(f);
    expect(game.has(f, 'rotting')).toBe(false);
    expect(game.heal(f, 8)).toBe(8);
  });

  it('Cleric 8: Divine Strike adds 1d8 to one weapon hit a turn', () => {
    const game = arena(['#####', '#Cg.#', '#####'], 8);
    const [c, g] = game.units;
    g.hp = g.maxHp = 999;
    expect([c.destroyUndead, c.stats.wis]).toEqual([1, 20]);
    setTurn(game, 0);
    const r = game.attack(c, g, c.attacks[0]);
    expect(r.strike?.total).toBe(5);
  });

  it('level 8 tops out: no level 9 from more XP', () => {
    expect(heroUnit('F', { level: 9 }).level).toBe(8);
  });

  it('Nekhet at half HP: his fallen undead rise, fresh ones fill in beside him, his glare frightens', () => {
    const game = arena(['########', '#F.l.s.#', '#......#', '########'], 8, {}, fixed(0));
    const [f, l, s] = game.units;
    game.applyDamage(s, 999, f);
    const rose = [];
    game.on('rising', (r) => rose.push(r));
    game.applyDamage(l, Math.floor(l.maxHp / 2), f); // 135 → 68: just above half
    expect(rose).toHaveLength(0); // not yet bloodied
    game.applyDamage(l, 1, f);
    expect(rose).toHaveLength(1);
    const [{ risen, glare }] = rose;
    expect(risen.map((e) => [e.body?.name ?? null, e.unit.name, e.unit.x, e.unit.z]))
      .toEqual([['Skeleton', 'Risen Skeleton', 5, 1], [null, 'Risen Servant', 2, 1]]);
    expect(risen.every((e) => e.unit.alive && e.unit.team === 'monsters' && game.order.includes(e.unit))).toBe(true);
    expect(s.raised).toBe(true);
    expect(glare).toHaveLength(1);
    expect(f.conditions.frightened).toBeTruthy();
    game.applyDamage(l, 10, f);
    expect(rose).toHaveLength(1); // once a fight
    expect(game.stats.F).toBeTruthy();
  });

  it('a blow that drops Nekhet outright raises nobody', () => {
    const game = arena(['######', '#F.l.#', '######'], 8);
    const [f, l] = game.units;
    game.applyDamage(l, 999, f);
    expect(game.units).toHaveLength(2);
  });

  it('Death Ward saving a hero is tallied for the achievement', () => {
    const game = arena(['######', '#CF.g#', '######'], 7);
    const [c, f] = game.units;
    setTurn(game, 0);
    game.castSpell(c, 'deathWard', f);
    game.applyDamage(f, 500, null);
    expect(game.stats.F.warded).toBe(1);
  });
});
