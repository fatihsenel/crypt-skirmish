// Threat zones: where the monsters in sight could strike next turn. The T key and the
// toolbar button show every monster's zone; hovering (or tapping) a monster's portrait in
// the turn order shows just its own.

import { key } from './game/grid.js';

const THREATS_KEY = 'crypt-skirmish:threats';

/** "A", "A and B", "A, B and C", or "4 monsters". */
export const listNames = (names) => (names.length > 3 ? `${names.length} monsters`
  : names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]);

/**
 * The controller's view of the fight, as functions: `game()`, `board()`, `unseen(u)` (a
 * monster out of sight), `showing()` (a hero's turn waiting for input) and `refresh()`.
 */
export function createThreats({ game, board, unseen, showing, refresh }) {
  let on = false;
  try {
    on = localStorage.getItem(THREATS_KEY) === '1';
  } catch {
    /* storage unavailable: starts off */
  }
  let focus = null; // a monster whose portrait is hovered (or tapped): just its zone
  let cache = { sig: '', melee: [], ranged: [], far: [] };
  const $toggle = document.getElementById('threats-toggle');
  $toggle.setAttribute('aria-pressed', String(on));

  function toggle(next = !on) {
    on = next;
    $toggle.setAttribute('aria-pressed', String(on));
    try {
      localStorage.setItem(THREATS_KEY, on ? '1' : '0');
    } catch {
      /* storage unavailable: just this session */
    }
    if (game() && board()) refresh();
  }
  $toggle.addEventListener('click', () => toggle());

  /** The monsters whose zones show: the focused one, or (toggle on) every one in sight. */
  function sources() {
    if (focus) return focus.alive && !unseen(focus) ? [focus] : [];
    if (!on) return [];
    return game().units.filter((m) => m.team === 'monsters' && m.alive && !m.hidden && !unseen(m));
  }

  /** Threat tiles for the hero whose turn it is (they're the one about to move, so not in the way). */
  function tiles() {
    const g = game();
    const u = g.current;
    const from = sources();
    const sig = [g.round, u?.id, focus?.id ?? '', ...g.units.map((m) =>
      `${m.id}:${m.x},${m.z}:${m.alive ? 1 : 0}${m.unaware ? 'u' : ''}${m.turned ? 't' : ''}${Object.keys(m.conditions ?? {}).join('')}`),
    ...from.map((m) => m.id)].join('|');
    if (sig === cache.sig) return cache;
    const melee = new Set();
    const ranged = new Set();
    const far = new Set(); // only a long-range shot reaches, at disadvantage
    for (const m of from) {
      const t = g.threatOf(m, { ignore: u?.team === 'heroes' ? u : null });
      t.melee.forEach((k) => melee.add(k));
      t.ranged.forEach((k) => ranged.add(k));
      t.far.forEach((k) => far.add(k));
    }
    const explored = (set) => [...set].map((k) => k.split(',').map(Number)).map(([x, z]) => ({ x, z }))
      .filter((t) => board().isExplored(t.x, t.z));
    cache = {
      sig, melee: explored(melee), ranged: explored([...ranged].filter((k) => !melee.has(k))),
      far: explored([...far].filter((k) => !melee.has(k) && !ranged.has(k))),
    };
    return cache;
  }

  function draw() {
    const b = board();
    if (!(game() && !game().over && showing() && (on || focus))) {
      b.threatMelee.clear();
      b.threatRanged.clear();
      b.threatFar.clear();
      return;
    }
    const { melee, ranged, far } = tiles();
    b.threatMelee.set(melee);
    b.threatRanged.set(ranged);
    b.threatFar.set(far);
  }

  /** The monsters in sight that could strike a hero standing on (x, z) next turn. */
  function at(x, z) {
    return near(x, z).map((r) => r.unit);
  }

  /**
   * The same, with what each would bring: `charge` (it could charge in: Tharok's extra dice
   * and a shove to the floor), `stone` (its bite can turn a hero to stone) and `edge` (it could
   * throw a hero standing there over a chasm's edge). `all: false`
   * looks only at the monsters that bring either (cheap enough for every hover).
   */
  function near(x, z, { all = true } = {}) {
    const g = game();
    const k = key(x, z);
    const special = (m) => m.attacks.some((a) => a.charge || a.throws || a.rider?.condition === 'petrified');
    const edge = [...g.grid.chasms].some((c) => { const [cx, cz] = c.split(',').map(Number); return Math.max(Math.abs(cx - x), Math.abs(cz - z)) <= 1; });
    return g.units.filter((m) => m.team === 'monsters' && m.alive && !m.hidden && !unseen(m) && (all || special(m)))
      .map((m) => ({ unit: m, zone: g.threatOf(m, { ignore: g.current }) }))
      .filter((r) => r.zone.melee.has(k))
      .map(({ unit, zone }) => ({
        unit, charge: zone.charge.has(k),
        stone: unit.attacks.some((a) => a.rider?.condition === 'petrified'),
        // Rules 4: a thrower in reach of a tile at a chasm's edge could send a hero over it.
        edge: edge && g.rules >= 4 && unit.attacks.some((a) => a.throws || a.charge),
      }));
  }

  // Hovering a monster's portrait shows just its reach; on a touch screen, tapping does.
  const $initiative = document.getElementById('initiative');
  const portraitUnit = (ev) => {
    const id = Number(ev.target.closest('[data-unit]')?.dataset.unit);
    const m = game()?.units.find((x) => x.id === id);
    return m?.team === 'monsters' && m.alive && !unseen(m) ? m : null;
  };
  $initiative.addEventListener('pointerover', (ev) => {
    if (ev.pointerType !== 'mouse' || !game()) return;
    const m = portraitUnit(ev);
    if (m === focus) return;
    focus = m;
    if (board()) refresh();
  });
  $initiative.addEventListener('pointerleave', (ev) => {
    if (ev.pointerType !== 'mouse' || !focus) return;
    focus = null;
    if (board()) refresh();
  });
  window.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse' || !game() || !board()) return;
    const m = $initiative.contains(ev.target) ? portraitUnit(ev) : null;
    const next = m && m !== focus ? m : null; // tap it again (or anything else) to clear
    if (next === focus) return;
    focus = next;
    refresh();
  });

  return {
    toggle, draw, at, near,
    /** Is any zone showing (the toggle, or a focused portrait)? */
    get active() { return on || !!focus; },
    get on() { return on; },
    get focus() { return focus; },
  };
}
