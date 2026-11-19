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

  return { falls, worst, left };
}
