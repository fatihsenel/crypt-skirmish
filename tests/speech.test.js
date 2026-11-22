import { describe, it, expect } from 'vitest';
import { attackMoment, spellMoment, lineFor, downSpeaker, canSay, SPEECH } from '../src/speech.js';

const hero = (code = 'F', over = {}) => ({ team: 'heroes', code, name: 'Brannoc', id: code, alive: true, x: 0, z: 0, ...over });
const foe = (code = 'g', over = {}) => ({ team: 'monsters', code, name: 'Goblin 1', id: code, alive: true, x: 1, z: 0, ...over });
const never = () => 0.99; // a roll that keeps a monster quiet
const always = () => 0;

describe('speech bubbles', () => {
  it('speaks for a kill first, then a crit, then a hero’s first blow', () => {
    const a = hero();
    expect(attackMoment({ attacker: a, target: foe(), hit: true, crit: true, killed: true, first: true })).toBe('kill');
    expect(attackMoment({ attacker: a, target: foe(), hit: true, crit: true, first: true })).toBe('crit');
    expect(attackMoment({ attacker: a, target: foe(), hit: false, first: true })).toBe('first');
    expect(attackMoment({ attacker: a, target: foe(), hit: true, first: false })).toBeNull();
  });

  it('leaves a hero’s fall to a friend, not the monster', () => {
    expect(attackMoment({ attacker: foe(), target: hero(), hit: true, killed: true }, never)).toBeNull();
  });

  it('has monsters speak now and then, named foes most of the time, beasts never', () => {
    expect(attackMoment({ attacker: foe(), target: hero(), hit: false }, never)).toBeNull();
    expect(attackMoment({ attacker: foe(), target: hero(), hit: false }, () => 0.2)).toBe('attack');
    expect(attackMoment({ attacker: foe('g'), target: hero(), hit: false }, () => 0.5)).toBeNull();
    expect(attackMoment({ attacker: foe('n'), target: hero(), hit: false }, () => 0.5)).toBe('attack');
    expect(attackMoment({ attacker: foe('g'), target: hero(), hit: false, kindSpoke: true }, always)).toBeNull(); // one goblin a round
    expect(attackMoment({ attacker: foe('u'), target: hero(), hit: true, crit: true, kindSpoke: true }, always)).toBeNull(); // even on a crit
    expect(attackMoment({ attacker: foe('u'), target: hero(), hit: true, crit: true }, never)).toBe('attack');
    expect(attackMoment({ attacker: foe('n'), target: hero(), hit: false, kindSpoke: true }, always)).toBe('attack');
    expect(attackMoment({ attacker: foe('r'), target: hero(), hit: true, killed: true }, always)).toBeNull(); // rats don't talk
    expect(attackMoment({ attacker: foe('s', { name: 'Risen Goblin' }), target: foe(), hit: true, killed: true }, always)).toBeNull();
  });

  it('never says the same line twice running and fills in a fallen friend’s name', () => {
    const recent = new Map();
    let last = null;
    for (let i = 0; i < 30; i++) {
      const line = lineFor(hero(), 'kill', { recent });
      expect(line).not.toBe(last);
      last = line;
    }
    expect(lineFor(hero('C'), 'down', { name: 'Wren', rand: always })).toContain('Wren');
  });

  it('every hero class has lines for every moment, short and with no leftovers', () => {
    for (const [code, set] of Object.entries(SPEECH.HEROES)) {
      for (const moment of ['first', 'crit', 'kill', 'down']) {
        expect(canSay(hero(code), moment), `${code} ${moment}`).toBe(true);
        for (const l of set[moment]) expect(l.length).toBeLessThanOrEqual(36);
      }
      for (const l of set.down) expect(l).toContain('{name}');
    }
    for (const set of Object.values(SPEECH.MONSTERS)) for (const l of [...set.attack, ...set.kill]) expect(l).not.toContain('{');
  });

  it('the nearest friend in sight calls out when a hero falls', () => {
    const fallen = hero('F', { alive: false, x: 5, z: 5 });
    const near = hero('C', { id: 'c', x: 6, z: 5 });
    const far = hero('W', { id: 'w', x: 0, z: 0 });
    expect(downSpeaker(fallen, [fallen, far, near, foe()])).toBe(near);
    expect(downSpeaker(fallen, [fallen, far, near], (u) => u !== near)).toBe(far);
    expect(downSpeaker(fallen, [fallen])).toBeNull();
  });

  it('speaks for a heal on a friend, a big spell, and a monster’s spell now and then', () => {
    const cleric = hero('C', { name: 'Maela' });
    const wren = hero('R', { name: 'Wren', id: 'r' });
    expect(spellMoment({ caster: cleric, id: 'healingWord', healed: [wren] })).toEqual({ moment: 'heal', friend: wren });
    expect(spellMoment({ caster: cleric, id: 'cureWounds', healed: [cleric] })).toBeNull(); // healing yourself is quiet
    expect(spellMoment({ caster: hero('W'), id: 'fireball' })).toEqual({ moment: 'blast' });
    expect(spellMoment({ caster: hero('W'), id: 'magicMissile' })).toBeNull();
    expect(spellMoment({ caster: hero('P'), id: 'layOnHands', healed: [wren] }).moment).toBe('heal');
    expect(spellMoment({ caster: foe('n'), id: 'animateDead' }, () => 0.5)).toEqual({ moment: 'cast' });
    expect(spellMoment({ caster: foe('t'), id: 'dread' }, () => 0.5)).toBeNull();
    expect(spellMoment({ caster: foe('y'), id: 'dread' }, always)).toBeNull(); // mummies stay silent
  });

  it('every class thanks a friend for bringing them back, and every named foe introduces itself', () => {
    for (const code of Object.keys(SPEECH.HEROES)) expect(canSay(hero(code), 'thanks'), code).toBe(true);
    for (const code of SPEECH.NAMED) expect(canSay(foe(code), 'intro'), code).toBe(true);
    expect(canSay(foe('g'), 'intro')).toBe(false);
    for (const [code, set] of Object.entries(SPEECH.HEROES)) for (const l of set.heal ?? []) expect(l.length, code).toBeLessThanOrEqual(36);
  });
});
