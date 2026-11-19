import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { fightRecap, winRecap } from '../src/game/recap.js';

describe('a lost fight’s recap', () => {
  it('logs each blow a hero takes, with the attack that dealt it', () => {
    const game = new Game(['######', '#Fo..#', '######'], { senses: false, rng: () => 0.95 });
    game.start();
    const [f, o] = game.units;
    f.hp = 3;
    game.attack(o, f, o.attacks[0]);
    expect(game.blows).toEqual([{
      round: game.round, to: f.name, by: o.name, byId: o.id, kind: o.cls, code: o.code, how: o.attacks[0].name, via: 'melee', damage: 3, hp: 0, down: true,
    }]);
  });

  it('logs nothing when a monster is hit', () => {
    const game = new Game(['######', '#Fo..#', '######'], { senses: false, rng: () => 0.95 });
    game.start();
    const [f, o] = game.units;
    game.attack(f, o, f.attacks[0]);
    expect(game.blows).toEqual([]);
  });

  it('tells how each hero fell, who hit hardest and who was left', () => {
    const skeleton = (id, hp) => ({ id, name: `Skeleton ${id}`, cls: 'Skeleton', team: 'monsters', alive: true, hp, maxHp: 13 });
    const game = {
      blows: [
        { round: 1, to: 'Wren', by: 'Wight', byId: 9, kind: 'Wight', how: 'Life Drain', damage: 6, down: false },
        { round: 2, to: 'Wren', by: 'Skeleton 1', byId: 1, kind: 'Skeleton', how: 'Shortbow', damage: 5, down: true },
        { round: 2, to: 'Maela', by: 'Skeleton 2', byId: 2, kind: 'Skeleton', how: 'Shortbow', damage: 4, down: false },
        { round: 3, to: 'Maela', by: null, byId: null, how: 'a trap', damage: 7, down: true },
      ],
      units: [
        { id: 9, name: 'Wight', cls: 'Wight', team: 'monsters', alive: true, hp: 12, maxHp: 45 },
        skeleton(1, 13), skeleton(2, 4),
        { id: 3, name: 'Mummy', team: 'monsters', alive: false, hp: 0, maxHp: 58 },
        { id: 4, name: 'Wren', team: 'heroes', alive: false, hp: 0, maxHp: 42 },
      ],
    };
    expect(fightRecap(game)).toEqual({
      falls: [
        'Round 2: Wren fell to Skeleton 1’s Shortbow (5 damage).',
        'Round 3: Maela fell to a trap (7 damage).',
      ],
      worst: 'Skeletons hit hardest: 9 damage to the party.',
      left: 'Still standing: Wight (12/45 HP), 2 Skeletons (13/13, 4/13 HP).',
      tip: null, // no one kind or kind of attack did half the damage
    });
  });

  it('says a lone foe’s name as it is', () => {
    const game = {
      blows: [{ round: 4, to: 'Brannoc', by: 'Mummy', byId: 3, kind: 'Mummy', how: 'Rotting Fist', damage: 11, down: true }],
      units: [{ id: 3, name: 'Mummy', cls: 'Mummy', team: 'monsters', alive: true, hp: 30, maxHp: 58 }],
    };
    expect(fightRecap(game).worst).toBe('Mummy hit hardest: 11 damage to the party.');
  });

  describe('the tip for next time', () => {
    const hero = (name, cls, more = {}) => ({ name, cls, team: 'heroes', alive: false, hp: 0, maxHp: 30, potions: 0, ...more });
    const blow = (more) => ({ round: 1, to: 'Wren', by: 'Skeleton 1', byId: 1, kind: 'Skeleton', how: 'Shortbow', via: 'ranged', damage: 5, down: false, ...more });
    const tip = (blows, heroes = [hero('Wren', 'Rogue')]) => fightRecap({ blows, units: heroes }).tip;

    it('points the Rogue at traps after a trap drops someone', () => {
      expect(tip([blow({ by: null, kind: null, how: 'a trap', via: 'trap', down: true })]))
        .toBe('A trap brought someone down. Wren spots traps nearby: let them lead through unexplored halls.');
      expect(tip([blow({ by: null, kind: null, how: 'a trap', via: 'trap', down: true })], [hero('Wren', 'Ranger')])).toBe(null);
    });

    it('notices potions left in the pack', () => {
      expect(tip([blow({ via: 'melee' })], [hero('Maela', 'Cleric', { potions: 2 })]))
        .toBe('Maela fell with 2 potions unused. Drinking one takes an action and heals 2d4 + 2.');
      expect(tip([blow({ via: 'melee' })], [hero('Ilsa', 'Wizard', { potions: 1 }), hero('Maela', 'Cleric', { potions: 1 }), hero('Wren', 'Rogue', { potions: 3 })]))
        .toBe('Ilsa, Maela and Wren fell with potions unused. Drinking one takes an action and heals 2d4 + 2.');
    });

    it('blames archers, spells or one foe when they did most of the damage', () => {
      expect(tip([blow({}), blow({ via: 'melee', damage: 4 })])).toMatch(/^Most of the damage came from range/);
      expect(tip([blow({ via: 'spell' }), blow({ via: 'melee', damage: 4 })])).toMatch(/^Spells did most/);
      expect(tip([blow({ by: 'Wraith', kind: 'Wraith', via: 'melee', damage: 9 }), blow({ via: 'melee' })]))
        .toBe('Wraith dealt over half the damage. Bring it down first, or stay out of reach.');
      expect(tip([blow({ via: 'melee' }), blow({ by: 'Skeleton 2', byId: 2, via: 'melee' }), blow({ by: 'Mummy', kind: 'Mummy', via: 'melee', damage: 3 })]))
        .toBe('The Skeletons dealt over half the damage. Bring them down first, or stay out of reach.');
    });
  });

  describe('a won fight', () => {
    const hero = (name, slot, maxHp = 30) => ({ name, slot, team: 'heroes', alive: true, hp: maxHp, maxHp });
    const party = [hero('Brannoc', 'F', 44), hero('Maela', 'C', 31), hero('Wren', 'R', 27)];
    const blow = (more) => ({ round: 2, to: 'Maela', by: 'Ghoul', damage: 5, hp: 20, down: false, ...more });

    it('names the top hitter, the closest call and the potions drunk', () => {
      const game = {
        units: party,
        stats: { F: { damage: 34, kills: 3 }, C: { damage: 12, kills: 1 }, R: { damage: 34, kills: 1 } },
        blows: [blow({ round: 2, hp: 14 }), blow({ round: 4, hp: 2 }), blow({ to: 'Brannoc', hp: 9 })],
        drunk: 2,
      };
      expect(winRecap(game)).toEqual({
        best: 'Brannoc led the way: 34 damage, 3 kills.',
        closest: 'Closest call: Maela held on at 2/31 HP in round 4.',
        fell: null,
        potions: '2 potions drunk.',
      });
    });

    it('leaves out calls that weren’t close or ended in a fall, and says who fell', () => {
      const game = {
        units: party,
        stats: { C: { damage: 6, kills: 0 } },
        blows: [blow({ hp: 20 }), blow({ to: 'Wren', round: 2, hp: 3 }), blow({ to: 'Wren', round: 3, hp: 0, down: true })],
        drunk: 0,
      };
      expect(winRecap(game)).toEqual({
        best: 'Maela led the way: 6 damage.',
        closest: null,
        fell: 'Wren fell in round 3 but the party won through.',
        potions: 'No potions needed.',
      });
    });

    it('counts potions in a real fight', () => {
      const game = new Game(['######', '#F..o#', '######'], { senses: false, rng: () => 0.5 });
      game.start();
      const [f] = game.units;
      f.potions = 1;
      f.hp = 5;
      game.doAction(f, 'potion');
      expect(f.potions).toBe(0);
      expect(winRecap(game).potions).toBe('1 potion drunk.');
    });
  });
});
