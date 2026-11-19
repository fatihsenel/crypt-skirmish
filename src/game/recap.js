// A lost fight told back in a few lines: how each hero fell, which foe hurt the party most,
// and who was still standing. Built from the blows the rules engine logs (game.blows).

/** "Skeleton" → "Skeletons", "Mummy" → "Mummies". */
const plural = (name) => (/[^aeiou]y$/.test(name) ? `${name.slice(0, -1)}ies` : name.endsWith('s') ? name : `${name}s`);

/** "Skeleton's Shortbow", "Ysolde's Withering Touch", "a trap". */
function blowName({ by, how }) {
  if (!by) return how ?? 'something unseen';
  return how ? `${by}’s ${how}` : by;
}

/**
 * The recap of a fight, as plain sentences:
 *   falls: "Round 3: Maela fell to Wight’s Life Drain (9 damage)."
 *   worst: "Wight hit hardest: 31 damage to the party."
 *   tip:   one thing to try next time (see lossTip), or null
 *   left:  "Still standing: Wight (12/45 HP), 2 Skeletons (13/13, 4/13 HP)."
 */
export function fightRecap(game) {
  const falls = game.blows
    .filter((b) => b.down)
    .map((b) => `Round ${b.round}: ${b.to} fell to ${blowName(b)} (${b.damage} damage).`);

  // Foes of one kind count together: "Skeletons hit hardest" when three of them hit.
  const byKind = new Map();
  for (const b of game.blows) {
    if (!b.by) continue;
    const kind = b.kind ?? b.by;
    const f = byKind.get(kind) ?? { damage: 0, names: new Set() };
    f.damage += b.damage;
    f.names.add(b.by);
    byKind.set(kind, f);
  }
  const [top] = [...byKind].sort((a, b) => b[1].damage - a[1].damage);
  const worst = top
    ? `${top[1].names.size > 1 ? plural(top[0]) : [...top[1].names][0]} hit hardest: ${top[1].damage} damage to the party.`
    : null;

  const standing = game.units.filter((u) => u.team === 'monsters' && u.alive && !u.corpse);
  const groups = new Map();
  for (const u of standing) groups.set(u.cls ?? u.name, [...(groups.get(u.cls ?? u.name) ?? []), u]);
  const hp = (u) => `${u.hp}/${u.maxHp}`;
  const parts = [...groups].map(([kind, us]) => (us.length === 1
    ? `${us[0].name} (${hp(us[0])} HP)`
    : `${us.length} ${plural(kind)} (${us.map(hp).join(', ')} HP)`));
  const left = parts.length ? `Still standing: ${parts.join(', ')}.` : null;

  return { falls, worst, left, tip: lossTip(game, byKind) };
}

/** One thing to try next time, from what hurt most. Null when nothing stands out. */
function lossTip(game, byKind) {
  const total = game.blows.reduce((n, b) => n + b.damage, 0);
  if (!total) return null;
  const share = (via) => game.blows.filter((b) => b.via === via).reduce((n, b) => n + b.damage, 0) / total;
  const heroes = game.units.filter((u) => u.team === 'heroes' && !u.corpse);

  const rogue = heroes.find((u) => u.cls === 'Rogue');
  if (rogue && game.blows.some((b) => b.down && b.via === 'trap')) {
    return `A trap brought someone down. ${rogue.name} spots traps nearby: let them lead through unexplored halls.`;
  }
  const unused = heroes.filter((u) => !u.alive && u.potions > 0);
  if (unused.length) {
    const who = unused.length === 1
      ? `${unused[0].name} fell with ${unused[0].potions === 1 ? 'a potion' : `${unused[0].potions} potions`} unused`
      : `${unused.map((u) => u.name).join(' and ').replace(/ and (?=.* and )/g, ', ')} fell with potions unused`;
    return `${who}. Drinking one takes an action and heals 2d4 + 2.`;
  }
  if (share('ranged') >= 0.5) return 'Most of the damage came from range. Close in on the archers, or keep a crate or a wall between you.';
  if (share('spell') >= 0.5) return 'Spells did most of the damage. Spread out so one blast can’t catch the whole party.';
  const [top] = [...byKind].sort((a, b) => b[1].damage - a[1].damage);
  if (top && top[1].damage / total >= 0.5) {
    const many = top[1].names.size > 1;
    const name = many ? `The ${plural(top[0])}` : [...top[1].names][0];
    return `${name} dealt over half the damage. Bring ${many ? 'them' : 'it'} down first, or stay out of reach.`;
  }
  return null;
}

/**
 * A won fight in a few lines:
 *   best:    "Brannoc led the way: 34 damage, 3 kills."
 *   closest: "Closest call: Maela held on at 2/31 HP in round 4." (only at half HP or less)
 *   fell:    "Wren fell in round 3 but the party won through." (null when no one fell)
 *   potions: "2 potions drunk." / "No potions needed."
 */
export function winRecap(game) {
  const heroes = game.units.filter((u) => u.team === 'heroes' && !u.corpse);
  const tally = (u) => game.stats?.[u.slot] ?? {};
  const [top] = heroes.filter((u) => tally(u).damage > 0)
    .sort((a, b) => tally(b).damage - tally(a).damage || tally(b).kills - tally(a).kills);
  const kills = top ? tally(top).kills : 0;
  const best = top
    ? `${top.name} led the way: ${tally(top).damage} damage${kills ? `, ${kills} kill${kills === 1 ? '' : 's'}` : ''}.`
    : null;

  const falls = game.blows.filter((b) => b.down);
  const names = [...new Set(falls.map((b) => b.to))];
  // A close call is someone who stayed up: one who fell anyway is told below.
  const maxHp = (name) => heroes.find((u) => u.name === name)?.maxHp;
  const [near] = game.blows
    .filter((b) => !names.includes(b.to) && b.hp > 0 && maxHp(b.to) && b.hp * 2 <= maxHp(b.to))
    .sort((a, b) => a.hp / maxHp(a.to) - b.hp / maxHp(b.to) || a.round - b.round);
  const closest = near ? `Closest call: ${near.to} held on at ${near.hp}/${maxHp(near.to)} HP in round ${near.round}.` : null;

  const fell = names.length === 0 ? null
    : names.length === 1
      ? `${names[0]} fell in round ${falls[0].round} but the party won through.`
      : `${names.join(' and ').replace(/ and (?=.* and )/g, ', ')} fell but the party won through.`;

  const n = game.drunk ?? 0;
  const potions = n ? `${n} potion${n === 1 ? '' : 's'} drunk.` : 'No potions needed.';
  return { best, closest, fell, potions };
}
