// Dungeon levels. All maps are 16 × 12.
//   '#' wall   '.' floor   '+' closed door   '^' hidden trap   '$' chest
//   '>' stairs down   '%' corpse (a dead goblin, raisable by a necromancer)
// Spawns: F fighter, W wizard, R rogue, C cleric;
//         g goblin, s skeleton, o orc, r giant rat, b goblin boss, n necromancer.
// `loot` lists the contents of each chest in reading order (item ids from items.js).
// `asleep` lists monsters asleep at the start, by tile ('x,z'); `patrols` maps a monster's
// tile to the waypoints it walks between while it hasn't noticed the party.
// The campaign map that links these levels lives in campaign.js.

export const LEVELS = [
  {
    id: 'crypt',
    name: 'The Crypt Door',
    intro: 'Rats and goblins have made a nest of the old crypt. Clear it and find the way down.',
    rows: [
      '################',
      '#......#.......#',
      '#.F.R..#...g...#',
      '#......+....^..#',
      '#.W.C..#..##...#',
      '#......#..##.s.#',
      '###+####.......#',
      '#..^...........#',
      '#$...##....g..r#',
      '#....##.......r#',
      '#..........r..>#',
      '################',
    ],
    loot: [['potion']],
    asleep: ['14,8', '14,9', '11,10'], // the rat nest
    patrols: { '13,5': [[13, 1], [9, 2]], '11,8': [[7, 7]] },
  },
  {
    id: 'warren',
    name: 'The Goblin Warren',
    intro: 'Grukk the goblin boss holds the warren with an orc sellsword at his side.',
    rows: [
      '################',
      '#F.R...#.......#',
      '#......+...g...#',
      '#W.C...#.......#',
      '#......###+#####',
      '##+#####.......#',
      '#......^...b...#',
      '#..$...#.......#',
      '#......#..o..g.#',
      '#......+.......#',
      '#r.....#....r>.#',
      '################',
    ],
    loot: [['potion', 'weaponPlus1']],
    asleep: ['10,8', '1,10', '12,10'], // the orc sleeps off last night's ale
    patrols: { '11,2': [[8, 2], [13, 3]], '13,8': [[9, 6]] },
  },
  {
    id: 'ossuary',
    name: 'The Flooded Ossuary',
    intro: 'Bones of the old order line these halls, and some of them still walk. Rats nest in the rest.',
    rows: [
      '################',
      '#F.R..#....s...#',
      '#.....+........#',
      '#W.C..#..##..$.#',
      '#.....#..##....#',
      '###+####.^..s..#',
      '#.......r......#',
      '#..r...##+######',
      '#......#.......#',
      '#.$..r.#...g.s.#',
      '#......+......>#',
      '################',
    ],
    loot: [['ringProtection'], ['potion', 'potion']],
    asleep: ['8,6', '3,7', '5,9'],
    patrols: { '11,1': [[14, 1], [14, 4]], '12,5': [[7, 6]] },
  },
  {
    id: 'sanctum',
    name: 'The Necromancer’s Sanctum',
    final: true,
    intro: 'Morvath the necromancer waits among the dead. Anything that falls here may rise again.',
    rows: [
      '################',
      '#F.R..#........#',
      '#.....+..%..s..#',
      '#W.C..#........#',
      '#.....##..##...#',
      '###+###...##.%.#',
      '#.....#........#',
      '#..^..+...n....#',
      '#.....#..%.....#',
      '#.$...##..o....#',
      '#.....#...s..>.#',
      '################',
    ],
    loot: [['potion']],
    patrols: { '12,2': [[8, 3]] },
  },
];

/** The first level's map, kept for older code and tests. */
export const CRYPT = LEVELS[0].rows;

export const levelById = (id) => LEVELS.find((l) => l.id === id);
