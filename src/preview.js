// Hover previews: what a click (or tap, or Enter on the keyboard cursor) on the hovered
// tile would do, drawn on the board and said in the hint. The path and its opportunity
// attacks, the odds of an attack or shove, a spell's targets and blast.

import { key, pathFrom } from './game/grid.js';
import { SPILL_DC, BURN_TURNS } from './game/combat.js';
import { signed, abilityMod } from './game/dice.js';
import { SPELLS, coneTiles, lineTiles, areaTiles, directionTo } from './game/abilities.js';
import { tips } from './ui/tips.js';
import { listNames } from './threats.js';

/**
 * `deps`: hud, unseen(u), isHeroTurn(), threats, and getters for the controller's state:
 * game(), board(), hovered(), selected(), busy(), touching(). Returns { refresh,
 * visibleUnitAt, spellTargetAt }.
 */
export function createPreview(deps) {
  const { hud, unseen, isHeroTurn, threats, touching } = deps;
  let game, board, hovered, selected, busy; // read afresh on every refresh
  const sync = () => {
    game = deps.game();
    board = deps.board();
    hovered = deps.hovered();
    selected = deps.selected();
    busy = deps.busy();
  };

  /** Indices of path tiles where leaving provokes an opportunity attack. */
  function provokingSteps(u, path) {
    const out = [];
    for (let i = 0; i < path.length - 1; i++) {
      if (game.provokers(u, [path[i], path[i + 1]]).length) out.push(path[i]);
    }
    return out;
  }

  function modsText(m) {
    if (m.mode === 'adv') return ` · advantage (${m.adv.join(', ')})`;
    if (m.mode === 'dis') return ` · disadvantage (${m.dis.join(', ')})`;
    return '';
  }

  function refresh() {
    sync();
    hud.renderActionBar(game, { selected, busy });
    board.clearHighlights();
    threats.draw();
    const u = game.current;
    if (!u || game.over) return;
    if (!unseen(u)) board.active.set([u]);
    hud.hint('');
    if (!isHeroTurn() || busy) return;

    if (selected?.kind === 'spell') return refreshSpell(u, selected.id);
    if (selected?.kind === 'shove') return refreshShove(u);
    if (selected?.kind === 'help') return refreshHelp(u);

    const reach = game.reachable(u);
    board.reach.set(game.destinations(u).filter((t) => board.isExplored(t.x, t.z)));
    const atkOk = (f) => (selected ? !game.attackProblem(u, f, selected.attack) : game.bestAttack(u, f));
    board.targets.set(game.enemiesOf(u).filter((f) => !unseen(f) && atkOk(f)));

    if (!hovered) {
      if (selected) hud.hint(`${selected.attack.name}: click an enemy · Esc to cancel`);
      return;
    }
    board.hover.set([hovered]);
    const foe = visibleUnitAt(hovered.x, hovered.z);
    if (foe && foe.team !== u.team) {
      const atk = selected?.attack ?? game.bestAttack(u, foe);
      if (atk && !game.attackProblem(u, foe, atk)) {
        const m = game.attackMods(u, foe, atk);
        // A Barbed elite cuts back on a hit: say so, and warn when that would drop the hero.
        const barbs = game.barbsAgainst(u, foe, atk);
        const drops = barbs && barbs >= u.hp + (u.tempHp ?? 0);
        const cut = barbs ? ` · its barbs cut you for ${barbs} on a hit${drops ? ', enough to drop you' : ''}` : '';
        hud.hint(`${atk.name} → ${foe.name}: ${signed(game.toHitBonus(u, atk))} to hit vs AC ${game.acOf(foe)}, ${atk.damage} damage${modsText(m)}${cut}`, true, { warn: !!drops });
      } else {
        hud.hint(`${foe.name}: ${game.attackProblem(u, foe, atk ?? u.attacks[0])}`);
      }
      return;
    }
    const prop = game.grid.props.get(key(hovered.x, hovered.z));
    if (prop?.kind === 'brazier') {
      const why = game.brazierProblem(u, hovered.x, hovered.z);
      if (why) return void hud.hint(why);
      const tiles = game.spillTiles(u, prop);
      board.cone.set(tiles);
      const caught = tiles.map((t) => visibleUnitAt(t.x, t.z)).filter(Boolean);
      hud.hint(`Tip the brazier (your action): coals land on ${tiles.length} tile${tiles.length === 1 ? '' : 's'}`
        + (caught.length ? `, catching ${listNames(caught.map((c) => c.name))} (DEX save DC ${SPILL_DC}, 2d6 fire)` : '')
        + `, and burn whoever steps on them (1d6) for ${BURN_TURNS} turns`, true, { warn: caught.some((c) => c.team === u.team) });
      return;
    }
    if (game.grid.chests.has(key(hovered.x, hovered.z))) {
      const why = game.chestProblem(u, hovered.x, hovered.z);
      const odd = game.grid.chests.get(key(hovered.x, hovered.z)).suspected;
      hud.hint(why ?? (odd ? 'Open the chest… if you dare. Those are teeth marks.' : 'Open the chest (free, once per turn)'), !why);
      return;
    }
    const node = reach.get(key(hovered.x, hovered.z));
    if (node && node.dist > 0 && game.canEndOn(u, hovered.x, hovered.z)) {
      const path = pathFrom(reach, hovered.x, hovered.z);
      board.path.set(path.slice(1));
      const danger = provokingSteps(u, path);
      board.danger.set(danger);
      const who = game.provokers(u, path).map((f) => f.name);
      if (who.length) tips.notice('provoke', { touch: touching() });
      const reachers = threats.active ? threats.at(hovered.x, hovered.z).map((m) => m.name) : [];
      hud.hint(`Move ${node.dist * 5} ft` + (who.length ? ` · provokes an opportunity attack from ${who.join(' and ')}` : '')
        + (reachers.length ? ` · in reach of ${listNames(reachers)} next turn` : ''), true);
    }
  }

  /** Help targeting: adjacent enemies light up, the hint says who it helps. */
  function refreshHelp(u) {
    board.targets.set(game.enemiesOf(u).filter((f) => !unseen(f) && !game.helpProblem(u, f)));
    const foe = hovered && visibleUnitAt(hovered.x, hovered.z);
    if (!foe || foe.team === u.team) {
      hud.hint('Help: click an enemy next to you · Esc to cancel');
      return;
    }
    board.hover.set([hovered]);
    const why = game.helpProblem(u, foe);
    hud.hint(why ? `${foe.name}: ${why}`
      : `Help → ${foe.name}: the next ally to attack it before your next turn has advantage`, !why);
  }

  /** Shove targeting: adjacent enemies light up, the hint shows the contest. */
  function refreshShove(u) {
    board.targets.set(game.enemiesOf(u).filter((f) => !unseen(f) && !game.shoveProblem(u, f)));
    const foe = hovered && visibleUnitAt(hovered.x, hovered.z);
    if (!foe || foe.team === u.team) {
      hud.hint('Shove: click an enemy next to you · Esc to cancel');
      return;
    }
    board.hover.set([hovered]);
    const why = game.shoveProblem(u, foe);
    hud.hint(why ? `${foe.name}: ${why}`
      : `Shove → ${foe.name}: Athletics ${signed(game.shoveBonus(u))} vs their ${signed(game.shoveResist(foe))}; win and it is knocked prone`, !why);
  }

  /** The unit on a tile, unless it's a monster lurking out of sight. */
  function visibleUnitAt(x, z) {
    game = deps.game();
    const u = game.unitAt(x, z);
    return u && !unseen(u) ? u : null;
  }

  /** The unit (or corpse) a unit-targeted spell would hit on tile t. */
  function spellTargetAt(t, s) {
    if (!t) return null;
    game = deps.game();
    if (s.targeting === 'corpse') return game.corpses().find((c) => c.x === t.x && c.z === t.z) ?? null;
    return visibleUnitAt(t.x, t.z);
  }

  /** One-line preview of what a unit-targeted spell will do to `t`. */
  function spellPreview(u, id, t) {
    const s = SPELLS[id];
    switch (id) {
      case 'magicMissile':
        return `Magic Missile → ${t.name}: 3 darts × 1d4+1, never misses`;
      case 'spiritualWeapon': {
        const mod = abilityMod(u.stats[u.castStat]);
        const cost = u.spiritWeapon ? 'no slot' : `a ${u.slots[2] ? '2nd' : '3rd'}-level slot`;
        return `Spiritual Weapon → ${t.name}: ${signed(u.prof + mod)} vs AC ${game.acOf(t)}, 1d8${signed(mod)} force · ${cost}`;
      }
      case 'huntersMark':
        return `Hunter’s Mark → ${t.name}: +1d6 on your weapon hits against it · a 1st-level slot`;
      case 'hex':
        return `Hex → ${t.name}: +1d6 necrotic on every hit against it · a ${ordinalSlot(u, 1)}-level slot`;
      case 'scorchingRay': {
        const slot = lowestSlot(u, 2);
        const toHit = u.prof + abilityMod(u.stats[u.castStat]);
        return `Scorching Ray → ${t.name}: ${s.rays + slot - 2} rays, each ${signed(toHit)} vs AC ${game.acOf(t)} for 2d6 fire · a ${ordinalSlot(u, 2)}-level slot`;
      }
      case 'sacredFlame':
        return `Sacred Flame → ${t.name}: ${s.damage} radiant, DEX save DC ${game.spellDC(u)} negates (their DEX ${signed(abilityMod(t.stats.dex))})`;
      case 'cureWounds':
      case 'healingWord': {
        const [n, d] = s.heal;
        return `${s.name} → ${t === u ? 'yourself' : t.name}: heal ${n}d${d}${signed(abilityMod(u.stats[u.castStat]))} (HP ${t.hp}/${t.maxHp})`;
      }
      case 'deathWard':
        return `${s.name} → ${t === u ? 'yourself' : t.name}: the next drop to 0 HP leaves 1 instead (${ordinalSlot(u, s.level)}-level slot)`;
      default:
        return `${s.name} → ${t.name}`;
    }
  }

  /** The slot a spell of `level` would spend: the lowest one left at that level or above. */
  function lowestSlot(u, level) {
    return Object.keys(u.slots).map(Number).sort((a, b) => a - b).find((l) => l >= level && u.slots[l] > 0) ?? level;
  }
  const ordinalSlot = (u, level) => ({ 1: '1st', 2: '2nd', 3: '3rd' })[lowestSlot(u, level)] ?? `${lowestSlot(u, level)}th`;

  function refreshSpell(u, id) {
    const s = SPELLS[id];
    switch (s.targeting) {
      case 'enemy':
      case 'ally':
      case 'corpse': {
        const layer = s.targeting === 'ally' ? board.allies : board.targets;
        layer.set(game.spellTargets(u, id).filter((t) => !unseen(t)));
        const t = spellTargetAt(hovered, s);
        if (t) {
          board.hover.set([hovered]);
          const why = game.spellProblem(u, id, t);
          hud.hint(why ? `${t.name}: ${why}` : spellPreview(u, id, t), !why);
        } else {
          const what = { enemy: 'an enemy', ally: 'an ally or yourself', corpse: 'a corpse' }[s.targeting];
          hud.hint(`${s.name}: click ${what} · Esc to cancel`);
        }
        break;
      }
      case 'cone': {
        if (!hovered || (hovered.x === u.x && hovered.z === u.z)) {
          hud.hint(`${s.name}: point the cone with the mouse, click to cast · Esc to cancel`);
          return;
        }
        const tiles = coneTiles(game.grid, u, directionTo(u, hovered), s.range);
        board.cone.set(tiles);
        const caught = tiles.map((t) => visibleUnitAt(t.x, t.z)).filter(Boolean);
        const allies = caught.filter((c) => c.team === u.team);
        const foes = caught.filter((c) => c.team !== u.team);
        hud.hint(
          `${s.name}: ${2 + lowestSlot(u, 1)}d6 fire, DEX save DC ${game.spellDC(u)} for half · ` +
            (foes.length ? `hits ${foes.map((f) => f.name).join(', ')}` : 'no enemies in the cone') +
            (allies.length ? (u.sculpt ? ' · Sculpt Spells: the party is spared'
              : ` · ⚠ also burns ${allies.map((a) => a.name).join(', ')}!`) : ''),
          true,
        );
        break;
      }
      case 'line': {
        if (!hovered || (hovered.x === u.x && hovered.z === u.z)) {
          hud.hint(`${s.name}: aim the bolt with the mouse, click to cast · Esc to cancel`);
          return;
        }
        const tiles = lineTiles(game.grid, u, hovered, s.range);
        board.cone.set(tiles);
        const caught = tiles.map((t) => visibleUnitAt(t.x, t.z)).filter(Boolean);
        const allies = caught.filter((c) => c.team === u.team);
        const foes = caught.filter((c) => c.team !== u.team);
        hud.hint(
          `${s.name}: ${s.damage} lightning in a line, DEX save DC ${game.spellDC(u)} for half · ` +
            (foes.length ? `hits ${foes.map((f) => f.name).join(', ')}` : 'no enemies in the line') +
            (allies.length ? (u.sculpt ? ' · Sculpt Spells: the party is spared'
              : ` · ⚠ also strikes ${allies.map((a) => a.name).join(', ')}!`) : ''),
          true,
        );
        break;
      }
      case 'area': {
        if (!hovered) {
          hud.hint(`${s.name}: pick the point of the blast · Esc to cancel`);
          return;
        }
        const why = game.spellProblem(u, id, hovered);
        if (why) {
          hud.hint(`${s.name}: ${why}`);
          return;
        }
        const tiles = areaTiles(game.grid, hovered, s.radius);
        board.cone.set(tiles);
        board.hover.set([hovered]);
        const caught = tiles.map((t) => visibleUnitAt(t.x, t.z)).filter(Boolean);
        const allies = caught.filter((c) => c.team === u.team);
        const foes = caught.filter((c) => c.team !== u.team);
        hud.hint(
          `${s.name}: ${s.damage} ${id === 'iceStorm' ? 'hail and cold' : 'fire'} in ${s.radius * 5} ft, DEX save DC ${game.spellDC(u)} for half · ` +
            (foes.length ? `hits ${foes.map((f) => f.name).join(', ')}` : 'no enemies caught') +
            (allies.length ? (u.sculpt ? ' · Sculpt Spells: the party is spared'
              : ` · ⚠ also ${id === 'iceStorm' ? 'pounds' : 'burns'} ${allies.map((a) => a.name).join(', ')}!`) : ''),
          true,
        );
        break;
      }
      case 'tile': {
        board.teleport.set(game.teleportTiles(u));
        if (hovered) {
          const ok = !game.spellProblem(u, id, hovered);
          if (ok) board.hover.set([hovered]);
          hud.hint(ok ? `${s.name}: teleport here (bonus action)` : 'Pick an empty spot you can see within 30 ft', ok);
        } else {
          hud.hint(`${s.name}: click a purple tile · Esc to cancel`);
        }
        break;
      }
      default:
        hud.hint('');
    }
  }

  return { refresh, visibleUnitAt, spellTargetAt };
}
