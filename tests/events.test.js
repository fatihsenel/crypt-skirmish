import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/combat.js';
import { levelById } from '../src/game/maps.js';
import {
  NODES, EVENTS, newCampaign, completeFight, takeRest, takeEvent, eventProblem, choices, equip, equipPreview,
  heroUnit, parseSave, serialize, HERO_CODES,
} from '../src/game/campaign.js';

/** Win room `node` at once (every monster down), or just open its chests when `loot`. */
const won = (state, node) => {
  const g = new Game(levelById(NODES[node].level), { party: state.party });
  for (const m of g.units) if (m.team === 'monsters') m.alive = false;
  return completeFight(state, node, g);
};
const potions = (s) => HERO_CODES.reduce((n, c) => n + s.party[c].potions, 0);
const at = (node, extra = {}) => ({ ...newCampaign(), cleared: [node], at: node, ...extra });

describe('stops with no fight', () => {
  it('sit on the map as side trips, and every option has words', () => {
    expect(choices(at('crypt'))).toContain('pilgrim');
    expect(choices(at('nest'))).toContain('altar');
    expect(choices(at('halls'))).toContain('reliquary');
    for (const [id, e] of Object.entries(EVENTS)) {
      expect(NODES[id].kind).toBe('event');
      expect(e.intro && e.teaser).toBeTruthy();
      for (const o of Object.values(e.options)) expect(o.label && o.desc).toBeTruthy();
    }
    // Going there leaves the same ways on.
    const { state } = takeEvent({ ...at('crypt'), party: { ...newCampaign().party } }, 'pilgrim', 'rob');
    expect(state.at).toBe('pilgrim');
    expect(choices(state).sort()).toEqual(['ossuary', 'warren']);
    expect(eventProblem(state, 'pilgrim', 'rob')).toBe('Not on the way');
    expect(() => takeEvent(state, 'pilgrim', 'rob')).toThrow();
  });

  it('pilgrim: tending him costs a potion now and pays one a hero at the act’s end', () => {
    const start = at('crypt');
    const before = potions(start);
    let { state } = takeEvent(start, 'pilgrim', 'tend');
    expect(potions(state)).toBe(before - 1);
    expect(state.pilgrim).toBe('owed');
    expect(parseSave(serialize(state)).pilgrim).toBe('owed');
    let r = won(state, 'warren');
    expect(r.report.pilgrim).toBe(false);
    r = won(r.state, 'sanctum');
    expect(r.report.pilgrim).toBe(true);
    expect(r.state.pilgrim).toBe('repaid');
    // Each hero gets one, whatever the chests gave.
    const again = won(r.state, 'catacombs');
    expect(again.report.pilgrim).toBe(false);
    // With no potion at all, there's nothing to give.
    const dry = at('crypt');
    for (const c of HERO_CODES) dry.party[c].potions = 0;
    expect(eventProblem(dry, 'pilgrim', 'tend')).toBe('No potion to spare');
    expect(eventProblem(dry, 'pilgrim', 'rob')).toBeNull();
  });

  it('pilgrim: robbing him gives two potions to the two heroes with fewest, and nothing later', () => {
    const start = at('crypt');
    start.party.F.potions = 3;
    const { state } = takeEvent(start, 'pilgrim', 'rob');
    expect(potions(state)).toBe(potions(start) + 2);
    expect(state.party.F.potions).toBe(3);
    expect(state.pilgrim).toBe('robbed');
    expect(won(state, 'sanctum').report.pilgrim).toBe(false);
  });

  it('altar: a quarter of the HP maximum for +1 to hit and AC, for one won fight', () => {
    const start = at('nest');
    const { state } = takeEvent(start, 'altar', 'offer');
    for (const c of HERO_CODES) {
      const max = heroUnit(c, start.party[c]).maxHp;
      expect(state.party[c].hp).toBe(Math.max(1, start.party[c].hp - Math.floor(max / 4)));
      expect(state.party[c].items).toContain('altarBlessing');
    }
    const plain = heroUnit('F', start.party.F);
    const blessed = heroUnit('F', state.party.F);
    expect(blessed.acBonus).toBe(plain.acBonus + 1);
    const g = new Game(levelById('gallery'), { party: state.party });
    const f = g.units.find((u) => u.slot === 'F');
    const g0 = new Game(levelById('gallery'), { party: start.party });
    const f0 = g0.units.find((u) => u.slot === 'F');
    expect(g.toHitBonus(f, f.attacks[0])).toBe(g0.toHitBonus(f0, f0.attacks[0]) + 1);
    // It survives the shrine's rest and fades after the next won fight.
    const rested = takeRest(state, 'shrine');
    expect(rested.party.W.items).toContain('altarBlessing');
    const r = won(rested, 'throne');
    expect(r.report.blessed).toBe(true);
    for (const c of HERO_CODES) expect(r.state.party[c].items).not.toContain('altarBlessing');
    // It can't be taken off or given away.
    expect(equip({ ...r.state, pack: ['altarBlessing'] }, 0, 'F').party.F.items).not.toContain('altarBlessing');
  });

  it('reliquary: sealed without the Vault’s key; the key opens it for a Periapt of Wound Closure', () => {
    expect(eventProblem(at('halls'), 'reliquary', 'open')).toMatch(/Iron Key/);
    // The key is in the Vault's first chest.
    const vault = won(at('catacombs'), 'vault');
    expect(vault.state.pack).toContain('ironKey');
    expect(vault.report.loot).toContain('ironKey');
    const s = { ...at('halls'), pack: ['ironKey'] };
    const { state, report } = takeEvent(s, 'reliquary', 'open');
    expect(state.pack).toEqual(['periaptWounds']);
    expect(report.loot).toEqual(['periaptWounds']);
    // Worn, every heal counts twice (up to the maximum).
    expect(equipPreview(state, 0, 'C')).toContain('Heals twice as much');
    const worn = equip(state, 0, 'C');
    const g = new Game(levelById('tomb'), { party: worn.party });
    const c = g.units.find((u) => u.slot === 'C');
    c.hp = 1;
    expect(g.heal(c, 3)).toBe(6);
    expect(g.heal(c, 999)).toBe(c.maxHp - 7);
  });

  it('saves keep the stops and the pilgrim’s debt, and drop junk', () => {
    const { state } = takeEvent(at('crypt'), 'pilgrim', 'tend');
    const back = parseSave(serialize(state));
    expect(back.at).toBe('pilgrim');
    expect(back.cleared).toContain('pilgrim');
    expect(parseSave(serialize({ ...state, pilgrim: 'maybe' })).pilgrim).toBeUndefined();
  });
});
