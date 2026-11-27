// Which side the battle view looks from, in quarter turns (stage.turn): the camera stands on one
// of the four diagonals of what it looks at, `{ x: ±1, z: ±1 }`. No three.js here, so it's tested
// on its own. North is −z and east is +x, as the map is written.

/** The camera's ground offset from what it looks at (`dx`, `dz`), as the diagonal it stands on. */
export function viewOf(dx, dz) {
  return { x: dx < 0 ? -1 : 1, z: dz < 0 ? -1 : 1 };
}

/**
 * Whether wall tile `w` stands between a camera on `view` and figure `p`: a little nearer the
 * camera along the view (depth) and lined up with it on screen (side).
 */
export function inFront(w, p, view) {
  const dx = w.x - p.x;
  const dz = w.z - p.z;
  const depth = dx * view.x + dz * view.z;
  const side = Math.abs(dx * view.z - dz * view.x);
  return depth > 0.5 && depth < 3.5 && side < 1.6;
}

/** The side the view is from, in words ("south-east" is the usual one). */
export function compass(view) {
  return `${view.z > 0 ? 'south' : 'north'}-${view.x > 0 ? 'east' : 'west'}`;
}

const TWIST = (35 * Math.PI) / 180;
/** Two fingers turned by `radians` since the twist began: a quarter turn that way past 35°. */
export function twistTurn(radians) {
  if (Math.abs(radians) < TWIST) return 0;
  return radians > 0 ? 1 : -1;
}
