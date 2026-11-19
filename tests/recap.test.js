import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { fightRecap } from '../src/game/recap.js';

describe('a lost fight’s recap', () => {
  it('logs each blow a hero takes, with the attack that dealt it', () => {
    const game = new Game(['######', '#Fo..#', '######'], { senses: false, rng: () => 0.95 });
    game.start();
    const [f, o] = game.units;
    f.hp = 3;
    game.attack(o, f, o.attacks[0]);
    expect(game.blows).toEqual([{
      round: game.round, to: f.name, by: o.name, byId: o.id, kind: o.cls, how: o.attacks[0].name, damage: 3, down: true,
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
    });
  });

  it('says a lone foe’s name as it is', () => {
    const game = {
      blows: [{ round: 4, to: 'Brannoc', by: 'Mummy', byId: 3, kind: 'Mummy', how: 'Rotting Fist', damage: 11, down: true }],
      units: [{ id: 3, name: 'Mummy', cls: 'Mummy', team: 'monsters', alive: true, hp: 30, maxHp: 58 }],
    };
    expect(fightRecap(game).worst).toBe('Mummy hit hardest: 11 damage to the party.');
  });
});
