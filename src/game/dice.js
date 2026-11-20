// Dice and ability-score helpers. Pure functions, no rendering.

export function rollDice(count, sides, rng = Math.random) {
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(rng() * sides));
  return { rolls, total: rolls.reduce((a, b) => a + b, 0) };
}

// "2d6+3" -> { count: 2, sides: 6, bonus: 3 }
export function parseDice(expr) {
  const m = /^(\d*)d(\d+)\s*([+-]\s*\d+)?$/i.exec(expr.trim());
  if (!m) throw new Error(`Bad dice expression: ${expr}`);
  return {
    count: Number(m[1] || 1),
    sides: Number(m[2]),
    bonus: m[3] ? Number(m[3].replace(/\s/g, '')) : 0,
  };
}

// A critical hit doubles the number of dice rolled (5e rule), not the bonus.
export function rollExpr(expr, { crit = false, rng = Math.random } = {}) {
  const { count, sides, bonus } = parseDice(expr);
  const r = rollDice(crit ? count * 2 : count, sides, rng);
  return { ...r, bonus, total: r.total + bonus };
}

/** Seeded PRNG (mulberry32): the same seed rolls the same dice, so a fight can be replayed. */
export function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const abilityMod =(score) => Math.floor((score - 10) / 2);

export const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

/** A 32-bit hash of a string (FNV-1a, then mixed), so neighbouring dates land far apart. */
export function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return h >>> 0;
}
