// Tile grid, pathfinding and line of sight. One tile = 5 ft.
// Coordinates are (x, z) to match the three.js ground plane.

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export const key = (x, z) => `${x},${z}`;

const PROPS = {
  '&': { kind: 'barrel', cover: 'half' },
  '=': { kind: 'crate', cover: 'half' },
  '|': { kind: 'column', cover: 'full' },
  '*': { kind: 'brazier', cover: null, tipped: false },
  '!': { kind: 'lever', cover: null, pulled: false },
};

// 5e grid distance: diagonals cost the same as straight moves.
export const gridDistance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

export class Grid {
  /**
   * @param {string[]} rows
   *   '#' wall, '.' floor, '+' closed door, '^' hidden trap, '$' chest, '>' stairs,
   *   '%' corpse (a dead goblin), letters = spawn points.
   *   Props: '&' barrels, '=' crates (in the way, and half cover), '|' a column (in the way,
   *   and it blocks sight like a wall), '*' a lit brazier (in the way; a hero can tip it over).
   *   '~' shallow water: floor that costs double to wade through.
   *   ':' a raised portcullis: floor until a lever ('!', in the way like a prop) drops it. Down,
   *   its bars block walking but not sight, and give half cover.
   *   '_' a chasm: no one can cross it (not even a flier), but it blocks neither sight nor shots.
   *   '[' a stair down to the room's lower hall, ']' the stair up from it: floor tiles, the n-th '['
   *   (in reading order) linked to the n-th ']' as if they were next to each other, one step apart.
   *   ',' cracked floor over the lower hall: floor to walk on. Rules 6: a creature pushed or thrown
   *   onto it crashes through (Game.cracked), and it's a hole after that.
   */
  constructor(rows) {
    this.height = rows.length;
    this.width = rows[0].length;
    this.walls = [];
    this.spawns = [];
    this.corpses = [];
    this.doors = new Map();  // key -> {x, z, open}
    this.traps = new Map();  // key -> {x, z, revealed, sprung}
    this.chests = new Map(); // key -> {x, z, opened, loot}
    this.stairs = [];
    this.props = new Map();  // key -> {x, z, kind, cover: 'half' | 'full' | null}
    this.water = new Set();  // keys of shallow water tiles
    this.chasms = new Set(); // keys of chasm tiles
    this.cracks = new Map(); // key -> {x, z}: cracked floor (rules 6; a broken one is a chasm)
    this.gates = new Map();  // key -> {x, z, down}: portcullis tiles, all worked by the room's levers
    this.links = new Map();  // key -> {x, z}: the stair at the other end of a '[' or ']'
    this.stairways = [];     // [{ down: {x, z}, up: {x, z} }]: the linked stairs, '[' above and ']' below
    this.lower = new Set();  // keys of the lower hall's tiles (none in a one-floor room)
    const downs = [];
    const ups = [];
    rows.forEach((row, z) => {
      if (row.length !== this.width) throw new Error(`Map row ${z} has wrong width`);
      this.walls[z] = [...row].map((ch, x) => {
        if (/[a-zA-Z]/.test(ch)) this.spawns.push({ code: ch, x, z });
        else if (ch === '+') this.doors.set(key(x, z), { x, z, open: false });
        else if (ch === '^') this.traps.set(key(x, z), { x, z, revealed: false, sprung: false });
        else if (ch === '$') this.chests.set(key(x, z), { x, z, opened: false, loot: [] });
        else if (ch === '>') this.stairs.push({ x, z });
        else if (ch === '%') this.corpses.push({ code: 'g', x, z });
        else if (ch === '~') this.water.add(key(x, z));
        else if (ch === '_') this.chasms.add(key(x, z));
        else if (ch === ',') this.cracks.set(key(x, z), { x, z });
        else if (ch === ':') this.gates.set(key(x, z), { x, z, down: false });
        else if (ch === '[') downs.push({ x, z });
        else if (ch === ']') ups.push({ x, z });
        else if (PROPS[ch]) this.props.set(key(x, z), { x, z, ...PROPS[ch] });
        return ch === '#';
      });
    });
    if (downs.length !== ups.length) throw new Error('Every stair down needs a stair up');
    downs.forEach((down, i) => {
      const up = ups[i];
      this.stairways.push({ down, up });
      this.links.set(key(down.x, down.z), up);
      this.links.set(key(up.x, up.z), down);
    });
    // The lower hall: everything walkable from a stair up without climbing back.
    const above = new Set(downs.map((d) => key(d.x, d.z)));
    for (const up of ups) {
      for (const k of this.flood(up.x, up.z, Infinity, (x, z) => !above.has(key(x, z))).keys()) this.lower.add(k);
    }
  }

  inBounds(x, z) {
    return x >= 0 && z >= 0 && x < this.width && z < this.height;
  }

  isWall(x, z) {
    return !this.inBounds(x, z) || this.walls[z][x];
  }

  /** Can't be walked onto: walls, chests, props, chasms and a portcullis that's down. */
  isSolid(x, z) {
    const k = key(x, z);
    return this.isWall(x, z) || this.chests.has(k) || this.props.has(k) || this.chasms.has(k) || !!this.gates.get(k)?.down;
  }

  /** A column: blocks sight like a wall. */
  opaqueProp(x, z) {
    return this.props.get(key(x, z))?.cover === 'full';
  }

  /** Blocks line of sight: walls, columns and closed doors. */
  blocksSight(x, z) {
    if (this.isWall(x, z) || this.opaqueProp(x, z)) return true;
    const d = this.doors.get(key(x, z));
    return !!d && !d.open;
  }

  closedDoorAt(x, z) {
    const d = this.doors.get(key(x, z));
    return d && !d.open ? d : null;
  }

  *neighbors(x, z) {
    for (const [dx, dz] of DIRS) {
      const nx = x + dx;
      const nz = z + dz;
      if (this.isSolid(nx, nz)) continue;
      // No squeezing diagonally between two walls / around a corner.
      if (dx && dz && (this.isSolid(x + dx, z) || this.isSolid(x, z + dz))) continue;
      yield [nx, nz];
    }
    // A stair to the other floor: one step to the stair at its other end (after the eight
    // directions, so a room without stairs keeps its paths).
    const to = this.links.size ? this.links.get(key(x, z)) : null;
    if (to && !this.isSolid(to.x, to.z)) yield [to.x, to.z];
  }

  /**
   * Breadth-first flood from (sx, sz) up to maxSteps.
   * canPass(x, z) decides whether a tile can be walked through.
   * Returns Map<key, {x, z, dist, prev}>.
   * With `cost(x, z)` (1 or 2: difficult terrain), dist is the movement spent getting there;
   * without it the search is the plain breadth-first one, so paths never change for fights
   * with no difficult ground (saved fights replay on the same paths).
   */
  flood(sx, sz, maxSteps, canPass = () => true, cost = null) {
    if (cost) return this.costFlood(sx, sz, maxSteps, canPass, cost);
    const out = new Map([[key(sx, sz), { x: sx, z: sz, dist: 0, prev: null }]]);
    const queue = [[sx, sz]];
    while (queue.length) {
      const [x, z] = queue.shift();
      const cur = out.get(key(x, z));
      if (cur.dist >= maxSteps) continue;
      for (const [nx, nz] of this.neighbors(x, z)) {
        const k = key(nx, nz);
        if (out.has(k) || !canPass(nx, nz)) continue;
        out.set(k, { x: nx, z: nz, dist: cur.dist + 1, prev: key(x, z) });
        queue.push([nx, nz]);
      }
    }
    return out;
  }

  /** flood() over tiles that cost 1 or 2 to enter: a bucket queue, cheapest first. */
  costFlood(sx, sz, maxSteps, canPass, cost) {
    const out = new Map([[key(sx, sz), { x: sx, z: sz, dist: 0, prev: null }]]);
    const buckets = [[[sx, sz]]];
    for (let d = 0; d < buckets.length; d++) {
      for (const [x, z] of buckets[d] ?? []) {
        const cur = out.get(key(x, z));
        if (cur.dist !== d) continue; // reached more cheaply since it was queued
        for (const [nx, nz] of this.neighbors(x, z)) {
          const k = key(nx, nz);
          const dist = d + cost(nx, nz);
          if (dist > maxSteps || (out.has(k) && out.get(k).dist <= dist) || !canPass(nx, nz)) continue;
          out.set(k, { x: nx, z: nz, dist, prev: key(x, z) });
          (buckets[dist] ??= []).push([nx, nz]);
        }
      }
    }
    return out;
  }

  /** Walking distance from the nearest source to every tile (walls only block). */
  distanceField(sources) {
    const dist = new Map();
    const queue = [];
    for (const s of sources) {
      dist.set(key(s.x, s.z), 0);
      queue.push([s.x, s.z]);
    }
    while (queue.length) {
      const [x, z] = queue.shift();
      const d = dist.get(key(x, z));
      for (const [nx, nz] of this.neighbors(x, z)) {
        const k = key(nx, nz);
        if (dist.has(k)) continue;
        dist.set(k, d + 1);
        queue.push([nx, nz]);
      }
    }
    return dist;
  }

  /**
   * Bresenham line; true if no wall or closed door lies strictly between the two tiles.
   * `blocks` can stand in for blocksSight (the renderer uses the doors as drawn).
   */
  lineOfSight(x0, z0, x1, z1, blocks = (x, z) => this.blocksSight(x, z)) {
    for (const [x, z] of this.lineBetween(x0, z0, x1, z1)) if (blocks(x, z)) return false;
    return true;
  }

  /** The tiles strictly between two tiles along a Bresenham line. */
  *lineBetween(x0, z0, x1, z1) {
    let dx = Math.abs(x1 - x0);
    let dz = -Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1;
    const sz = z0 < z1 ? 1 : -1;
    let err = dx + dz;
    let x = x0;
    let z = z0;
    while (!(x === x1 && z === z1)) {
      const e2 = 2 * err;
      if (e2 >= dz) { err += dz; x += sx; }
      if (e2 <= dx) { err += dx; z += sz; }
      if (x === x1 && z === z1) break;
      yield [x, z];
    }
  }

  /**
   * Fog of war: keys of every tile that can be seen from any of `sources` (no range
   * limit). Walls and closed doors are seen but block what lies behind them. A wall
   * next to a seen open tile is seen too, so room outlines don't have gaps where the
   * Bresenham lines happen to miss a wall face.
   */
  visibleFrom(sources, blocks = (x, z) => this.blocksSight(x, z)) {
    const seen = new Set();
    for (const s of sources) {
      for (let z = 0; z < this.height; z++) {
        for (let x = 0; x < this.width; x++) {
          const k = key(x, z);
          // Either direction counts, so anyone who can target a hero can be seen.
          if (!seen.has(k) && (this.lineOfSight(s.x, s.z, x, z, blocks) || this.lineOfSight(x, z, s.x, s.z, blocks))) seen.add(k);
        }
      }
    }
    for (const k of [...seen]) {
      const [x, z] = k.split(',').map(Number);
      if (blocks(x, z)) continue;
      for (const [dx, dz] of DIRS) {
        if (this.inBounds(x + dx, z + dz) && blocks(x + dx, z + dz)) seen.add(key(x + dx, z + dz));
      }
    }
    return seen;
  }
}

/** Rebuild the path (start..target) from a flood() result. */
export function pathFrom(floodMap, x, z) {
  const path = [];
  let k = key(x, z);
  while (k) {
    const node = floodMap.get(k);
    if (!node) return null;
    path.unshift({ x: node.x, z: node.z });
    k = node.prev;
  }
  return path;
}
