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

export const abilityMod = (score) => Math.floor((score - 10) / 2);

export const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
