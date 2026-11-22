import { describe, it, expect } from 'vitest';
import { attackMoment, spellMoment, lineFor, downSpeaker, canSay, replySpeaker, lastWordsSpeaker, banter, SPEECH } from '../src/speech.js';

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

  it('every class has a last word and a line for being badly hurt; every named foe gloats', () => {
    for (const code of Object.keys(SPEECH.HEROES)) {
      expect(canSay(hero(code), 'win'), code).toBe(true);
      expect(canSay(hero(code), 'hurt'), code).toBe(true);
      for (const l of [...SPEECH.HEROES[code].win, ...SPEECH.HEROES[code].hurt]) expect(l.length, code).toBeLessThanOrEqual(36);
    }
    for (const code of SPEECH.NAMED) expect(canSay(foe(code), 'gloat'), code).toBe(true);
  });

  it('the last word goes to the hero whose turn it is, or a standing boss after a defeat', () => {
    const f = hero('F', { id: 'f' });
    const w = hero('W', { id: 'w', alive: false });
    const gob = foe('g', { id: 'g1' });
    const boss = foe('b', { id: 'b1' });
    expect(lastWordsSpeaker('victory', [w, f], f)).toBe(f);
    expect(lastWordsSpeaker('victory', [w, f], w)).toBe(f); // the one whose turn it is is down
    expect(lastWordsSpeaker('victory', [f], f, () => false)).toBeNull();
    expect(lastWordsSpeaker('defeat', [gob, boss, f], null)).toBe(boss);
    expect(lastWordsSpeaker('defeat', [gob, f], null)).toBe(gob);
    expect(lastWordsSpeaker('defeat', [foe('r'), f], null)).toBeNull(); // rats don't gloat
  });

  it('a nearby minion answers its boss, never another boss or one far off', () => {
    const boss = foe('b', { id: 'b', x: 0, z: 0 });
    const near = foe('g', { id: 'g1', x: 2, z: 1 });
    const far = foe('g', { id: 'g2', x: 9, z: 0 });
    expect(replySpeaker(boss, [boss, far, near])).toBe(near);
    expect(replySpeaker(boss, [boss, far])).toBeNull();
    expect(replySpeaker(boss, [boss, foe('n', { id: 'n', x: 1, z: 0 })])).toBeNull();
    expect(replySpeaker(boss, [boss, near], () => false)).toBeNull();
  });

  it('camp banter: two different heroes, the one who dropped gets teased, class pairs have their own', () => {
    const party = [{ name: 'Brannoc', code: 'F' }, { name: 'Ilsa', code: 'W' }, { name: 'Wren', code: 'R' }];
    for (let i = 0; i < 20; i++) {
      const [[a, l1], [b, l2]] = banter(party);
      expect(a).not.toBe(b);
      expect(l1 && l2).toBeTruthy();
      const [[, tease], [who]] = banter(party, { downed: ['Wren'] });
      expect(who).toBe('Wren');
      expect(tease).toContain('Wren');
    }
    expect(banter(party.slice(0, 1))).toBeNull();
    expect(banter(party, {}, always)[0][1]).toBe(SPEECH.BANTER.pairs.FW[0]); // the first pair, Fighter then Wizard
    for (const key of Object.keys(SPEECH.BANTER.pairs)) for (const c of key) expect(SPEECH.HEROES[c], key).toBeTruthy();
  });
});
