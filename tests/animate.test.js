// animate.js plays back what the rules resolved, and throws on anything it has no animation
// for. It needs three.js and the page, so instead of running it this reads its switch cases
// and checks them against the rules: a new spell, action, move step or command kind fails
// here rather than in the middle of a fight.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SPELLS, ACTIONS } from '../src/game/abilities.js';

const source = readFileSync(new URL('../src/animate.js', import.meta.url), 'utf8');
const rules = (file) => readFileSync(new URL(`../src/game/${file}`, import.meta.url), 'utf8');

/** The `case '…':` labels in the body of function `name` (up to the next function). */
function cases(name) {
  const start = source.indexOf(`function ${name}(`);
  expect(start, `animate.js has no ${name}`).toBeGreaterThan(-1);
  const rest = source.slice(start + 1);
  const end = rest.search(/\n {2}(async )?function /);
  const body = end < 0 ? rest : rest.slice(0, end);
  return new Set([...body.matchAll(/case '(\w+)':/g)].map((m) => m[1]));
}

// Actions that just float their name: they fall through to playAction's default.
const MANEUVERS = ['dash', 'dodge', 'disengage', 'cunningDash', 'cunningDisengage', 'nimbleEscape'];

describe('animations', () => {
  it('has one for every spell a caster can cast (reactions show with the attack)', () => {
    const shown = cases('playSpell');
    const castable = Object.keys(SPELLS).filter((id) => SPELLS[id].time !== 'reaction');
    expect(castable.filter((id) => !shown.has(id))).toEqual([]);
  });

  it('has one for every action, or knows it only floats its name', () => {
    const shown = cases('playAction');
    expect(Object.keys(ACTIONS).filter((id) => !shown.has(id) && !MANEUVERS.includes(id))).toEqual([]);
  });

  it('has one for every step a move returns', () => {
    const steps = new Set([...rules('combat.js').matchAll(/steps\.push\(\{ type: '(\w+)'/g)].map((m) => m[1]));
    expect(steps.size).toBeGreaterThan(0);
    const shown = cases('animateSteps');
    expect([...steps].filter((t) => !shown.has(t))).toEqual([]);
  });

  it('knows every kind of command a hero can give', () => {
    const replay = rules('replay.js');
    const apply = replay.slice(replay.indexOf('export function applyCommand'));
    const kinds = new Set([...apply.slice(0, apply.indexOf('\n}\n')).matchAll(/case '(\w+)':/g)].map((m) => m[1]));
    const shown = cases('playStep');
    const silent = ['smite', 'rebuke', 'end']; // toggles and the end of a turn: nothing to show
    expect([...kinds].filter((k) => !shown.has(k) && !silent.includes(k))).toEqual([]);
  });
});
