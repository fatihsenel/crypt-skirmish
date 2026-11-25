import { describe, it, expect } from 'vitest';
import { Game, LAIR_DC, CAVE_DC } from '../src/game/combat.js';
import { levelById } from '../src/game/maps.js';
import { applyCommand } from '../src/game/replay.js';
import { key } from '../src/game/grid.js';

/** A fight whose every die rolls `dice.r` (change it between steps). */
function fight(room, opts = {}) {
  const dice = { r: 0.5 };
  const g = new Game(room, { senses: false, rng: () => dice.r, ...opts });
  g.start();
  return { g, dice, hero: (cls) => g.units.find((u) => u.cls === cls), foe: (code) => g.units.find((u) => u.code === code) };
}
const turnOf = (g, u) => { while (g.current !== u) g.endTurn(); };
const toRound = (g, n) => { while (g.round < n && !g.over) g.endTurn(); };
const lairs = (g) => { const out = []; g.on('lair', (r) => out.push(r)); return out; };

describe('lair actions (rules 10)', () => {
  it('Morvath’s grasping hands restrain the nearest hero who fails a STR save, as each round begins', () => {
    const { g, dice, hero } = fight({ rows: ['#########', '#F.....n#', '#C......#', '#########'] });
    const seen = lairs(g);
    dice.r = 0.01;
    toRound(g, 2);
    expect(seen).toHaveLength(1);
    expect(seen[0].kind).toBe('hands');
    expect(seen[0].saves[0].dc).toBe(LAIR_DC.hands);
    expect(seen[0].saves[0].unit).toBe(hero('Fighter'));
    expect(g.has(hero('Fighter'), 'restrained')).toBe(true);
  });

  it('Nekhet’s sandstorm, every other round, puts ranged attacks at disadvantage that round', () => {
    const { g, hero, foe } = fight({ rows: ['##########', '#W......l#', '#C.......#', '##########'] });
    toRound(g, 2);
    const w = hero('Wizard');
    const bolt = w.attacks.find((a) => a.reach > 1);
    expect(g.attackMods(w, foe('l'), bolt).dis).toContain('sandstorm');
    const near = g.attackMods(w, foe('l'), { ...bolt, reach: 1 });
    expect(near.dis).not.toContain('sandstorm');
    toRound(g, 3);
    expect(g.attackMods(w, foe('l'), bolt).dis).not.toContain('sandstorm');
  });

  it('Tharok’s labyrinth shakes every other round: each hero a DEX save or prone', () => {
    const { g, dice } = fight({ rows: ['##########', '#F......v#', '#C.......#', '##########'] });
    const seen = lairs(g);
    dice.r = 0.01;
    toRound(g, 2);
    expect(seen).toHaveLength(1);
    expect(seen[0].saves).toHaveLength(2);
    expect(seen[0].saves.every((s) => s.dc === LAIR_DC.quake)).toBe(true);
    toRound(g, 3);
    expect(seen).toHaveLength(1); // not on odd rounds
  });

  it('wait for the boss to know the party is here, and aren’t there under rules 9', () => {
    const asleep = fight({ rows: ['#########', '#F.....n#', '#########'], asleep: ['7,1'] }, { senses: true });
    const quiet = lairs(asleep.g);
    toRound(asleep.g, 3);
    expect(quiet).toHaveLength(0);
    const old = fight({ rows: ['#########', '#F.....n#', '#########'] }, { rules: 9 });
    const none = lairs(old.g);
    toRound(old.g, 3);
    expect(none).toHaveLength(0);
  });

  it('stay in the boss’s own room: none on an Endless floor', () => {
    const deep = fight({ id: 'deep:3:9:8', rows: ['#########', '#F.....n#', '#########'] });
    const none = lairs(deep.g);
    toRound(deep.g, 3);
    expect(none).toHaveLength(0);
  });
});

describe('Counterspell (rules 10)', () => {
  const ROOM = { rows: ['##########', '#F......n#', '#W.......#', '##########'] };
  const party = { W: { level: 5, items: [] } };

  it('a Wizard from level 5 stops a monster’s spell with a 3rd-level slot and the reaction', () => {
    const { g, hero, foe } = fight(ROOM, { party });
    const w = hero('Wizard');
    const m = foe('n');
    expect(w.spells).toContain('counterspell');
    turnOf(g, m);
    const slots = w.slots[3];
    const r = g.castSpell(m, 'dread', hero('Fighter'));
    expect(r.ok).toBe(true);
    expect(r.countered.success).toBe(true);
    expect(r.countered.by).toBe(w);
    expect(w.slots[3]).toBe(slots - 1);
    expect(w.reactionUsed).toBe(true);
    expect(g.has(hero('Fighter'), 'frightened')).toBe(false);
    expect(m.actionUsed).toBe(true);
    // One reaction a round: the next spell goes through.
    m.actionUsed = false;
    const again = g.castSpell(m, 'dread', hero('Fighter'));
    expect(again.countered).toBeUndefined();
  });

  it('needs the spell, the slot and sight; not under rules 9', () => {
    const low = fight(ROOM);
    turnOf(low.g, low.foe('n'));
    expect(low.g.castSpell(low.foe('n'), 'dread', low.hero('Fighter')).countered).toBeUndefined();
    const old = fight(ROOM, { party, rules: 9 });
    turnOf(old.g, old.foe('n'));
    expect(old.g.castSpell(old.foe('n'), 'dread', old.hero('Fighter')).countered).toBeUndefined();
    const empty = fight(ROOM, { party: { W: { level: 5, items: [], slots: { 1: 4, 2: 3, 3: 0 } } } });
    turnOf(empty.g, empty.foe('n'));
    expect(empty.g.castSpell(empty.foe('n'), 'dread', empty.hero('Fighter')).countered).toBeUndefined();
  });

  it('isn’t a spell to cast on one’s own turn', () => {
    const { g, hero } = fight(ROOM, { party });
    expect(g.spellProblem(hero('Wizard'), 'counterspell')).toMatch(/reaction/);
  });
});

describe('spell scrolls (rules 10)', () => {
  const ROOM = { rows: ['##########', '#FC.....g#', '#W$......#', '##########'], loot10: [['scrollFireball']] };

  it('a hero with the spell on their list reads one: no slot, and it’s gone', () => {
    const party = { C: { level: 3, items: [], scrolls: ['scrollCureWounds'] } };
    const { g, hero } = fight(ROOM, { party });
    const c = hero('Cleric');
    const f = hero('Fighter');
    f.hp -= 10;
    turnOf(g, c);
    const slots = { ...c.slots };
    const r = applyCommand(g, { type: 'spell', id: 'cureWounds', unit: g.units.indexOf(f), scroll: 'scrollCureWounds' });
    expect(r.ok).toBe(true);
    expect(r.scroll).toBe('scrollCureWounds');
    expect(c.slots).toEqual(slots);
    expect(c.scrolls).toEqual([]);
  });

  it('only from the class’s list, only one carried, and not under rules 9', () => {
    const party = { F: { level: 3, items: [], scrolls: ['scrollFireball'] }, C: { level: 3, items: [], scrolls: ['scrollCureWounds'] } };
    const { g, hero, foe } = fight(ROOM, { party });
    expect(g.spellProblem(hero('Fighter'), 'fireball', foe('g'), { scroll: 'scrollFireball' })).toMatch(/spell list/);
    expect(g.spellProblem(hero('Wizard'), 'fireball', foe('g'), { scroll: 'scrollFireball' })).toBe('No such scroll');
    const old = fight(ROOM, { party, rules: 9 });
    expect(old.g.spellProblem(old.hero('Cleric'), 'cureWounds', old.hero('Fighter'), { scroll: 'scrollCureWounds' })).toMatch(/before/);
  });

  it('one found in a chest goes to a hero who can read it', () => {
    const { g, hero } = fight(ROOM);
    const f = hero('Fighter');
    turnOf(g, f);
    const r = g.openChest(f, 2, 2);
    expect(r.ok).toBe(true);
    expect(r.scrolls[0].to).toBe(hero('Wizard'));
    expect(hero('Wizard').scrolls).toEqual(['scrollFireball']);
    expect(g.found).toEqual([]);
  });
});

describe('pit traps (rules 10)', () => {
  const ROOM = { rows: ['#########', '#F......#', '#.......#', '#......g#', '#########'], pits: [[3, 1]] };

  it('a hero who fails the DEX save falls in: 1d6, prone, and the move ends there', () => {
    const { g, dice, hero } = fight(ROOM);
    const f = hero('Fighter');
    turnOf(g, f);
    dice.r = 0.01;
    const hp = f.hp;
    const r = g.move(f, 5, 1);
    expect(r.interrupted).toBe(true);
    expect([f.x, f.z]).toEqual([3, 1]);
    const step = r.steps.find((s) => s.type === 'trap');
    expect(step.result.pit).toBe(true);
    expect(f.hp).toBe(hp - step.result.damage);
    expect(g.has(f, 'pit')).toBe(true);
    expect(g.has(f, 'prone')).toBe(true);
  });

  it('a STR check as each turn starts climbs out; a failure keeps the hero there', () => {
    const { g, dice, hero } = fight(ROOM);
    const f = hero('Fighter');
    turnOf(g, f);
    dice.r = 0.01;
    g.move(f, 5, 1);
    g.endTurn();
    turnOf(g, f);
    expect(g.has(f, 'pit')).toBe(true);
    expect(f.movesLeft).toBe(0);
    dice.r = 0.9;
    g.endTurn();
    turnOf(g, f);
    expect(g.has(f, 'pit')).toBe(false);
    expect(f.movesLeft).toBeGreaterThan(0);
    // The pit stays open: difficult ground for everyone after.
    expect(g.moveCost(f)(3, 1)).toBe(2);
  });

  it('a made save catches the edge; the pit isn’t there under rules 9', () => {
    const { g, dice, hero } = fight(ROOM);
    const f = hero('Fighter');
    turnOf(g, f);
    dice.r = 0.95;
    g.move(f, 5, 1);
    expect([f.x, f.z]).toEqual([5, 1]);
    expect(g.has(f, 'pit')).toBe(false);
    const old = fight(ROOM, { rules: 9 });
    expect(old.g.grid.traps.size).toBe(0);
  });
});

describe('cracked ceilings (rules 10)', () => {
  const ROOM = { rows: ['#########', '#D.g....#', '#.......#', '#########'], ceilings: [[3, 1]] };

  it('Thunderwave next to one brings it down: 2d6 within 5 ft, DEX for half, and rubble', () => {
    const { g, hero, foe } = fight({ ...ROOM, rows: ['#########', '#.Dg...g#', '#.......#', '#########'] });
    const d = hero('Druid');
    turnOf(g, d);
    const caves = [];
    g.on('caveIn', (r) => caves.push(r));
    const r = g.castSpell(d, 'thunderwave');
    expect(r.ok).toBe(true);
    expect(caves).toHaveLength(1);
    expect(caves[0].dc).toBe(CAVE_DC);
    expect(caves[0].saves.map((s) => s.unit)).toContain(d);
    expect(g.ceilings.get(key(3, 1)).fallen).toBe(true);
    expect(g.rubble.has(key(4, 2))).toBe(true);
    expect(g.moveCost(foe('g'))(4, 2)).toBe(2);
  });

  it('Tharok’s Labyrinth has two, and none under rules 9', () => {
    expect(new Game(levelById('labyrinth'), { rng: () => 0.5 }).ceilings.size).toBe(2);
    expect(new Game(levelById('labyrinth'), { rng: () => 0.5, rules: 9 }).ceilings.size).toBe(0);
  });
});

describe('Fog Cloud and Grease (rules 10)', () => {
  const ROOM = { rows: ['############', '#W.........#', '#F....g....#', '#..........#', '############'] };

  it('fog hides whoever stands in it past 5 ft, until the caster stops concentrating', () => {
    const { g, hero, foe } = fight(ROOM);
    const w = hero('Wizard');
    turnOf(g, w);
    const r = g.castSpell(w, 'fogCloud', { x: 6, z: 2 });
    expect(r.ok).toBe(true);
    expect(w.concentrating).toBe('fogCloud');
    w.actionUsed = false;
    const bolt = w.attacks.find((a) => a.reach > 1);
    expect(g.inSight(w, foe('g'))).toBe(false);
    expect(g.attackProblem(w, foe('g'), bolt)).toBe('The fog hides it');
    expect(g.spellProblem(w, 'magicMissile', foe('g'))).toMatch(/not in sight/);
    g.endConcentration(w, 'switch');
    expect(g.fogs).toHaveLength(0);
    expect(g.inSight(w, foe('g'))).toBe(true);
  });

  it('grease knocks down whoever fails a DEX save, slows the ground, and trips those who walk on', () => {
    const { g, dice, hero, foe } = fight(ROOM);
    const w = hero('Wizard');
    turnOf(g, w);
    dice.r = 0.01;
    const r = g.castSpell(w, 'grease', { x: 6, z: 2 });
    expect(r.ok).toBe(true);
    expect(g.has(foe('g'), 'prone')).toBe(true);
    expect(g.moveCost(hero('Fighter'))(5, 2)).toBe(2);
    const f = hero('Fighter');
    turnOf(g, f);
    const m = g.move(f, 5, 2);
    expect(m.steps.some((s) => s.type === 'slip')).toBe(true);
    expect(g.has(f, 'prone')).toBe(true);
  });

  it('can’t be cast in a fight begun under rules 9', () => {
    const { g, hero } = fight(ROOM, { rules: 9 });
    expect(g.spellProblem(hero('Wizard'), 'fogCloud', { x: 6, z: 2 })).toMatch(/before Fog Cloud/);
  });
});
