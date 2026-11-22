// Dungeon levels. All maps are 16 × 12.
//   '#' wall   '.' floor   '+' closed door   '^' hidden trap   '$' chest
//   '>' stairs down   '%' corpse (a dead goblin, raisable by a necromancer)
// Spawns: F fighter, W wizard, R rogue, C cleric;
//         g goblin, s skeleton, o orc, r giant rat, b goblin boss, n necromancer,
//         u ghoul, w wight, k giant spider, e specter, q banshee,
//         y mummy, t wraith, x fallen knight, l mummy lord. (Mimics hide in chests: see `mimics`.)
// `loot` lists the contents of each chest in reading order (item ids from items.js).
// `mimics` lists chest tiles ('x,z') that are really mimics; give those chests [] loot.
// `final` marks the last room of the campaign; `outro` is its victory text.
// Props: '&' barrels and '=' crates (half cover: +2 AC against attacks across them), '|' columns
// (block movement and sight), '*' braziers (a hero next to one can tip it: burning coals).
// '~' shallow water: costs double to wade through.
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
      '#.....&#.......#',
      '#.F.R..#...g...#',
      '#......+.=..^..#',
      '#.W.C..#..##...#',
      '#......#..##.s.#',
      '###+####.......#',
      '#..^...........#',
      '#$...##..&.g..r#',
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
      '#F.R...#.....=.#',
      '#......+...g...#',
      '#W.C...#.......#',
      '#......###+#####',
      '##+#####.......#',
      '#......^...b..&#',
      '#..$...#.=.....#',
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
    intro: 'Bones of the old order line these halls, and some of them still walk. Black water has pooled in the lower vaults, and rats nest along its edge.',
    rows: [
      '################',
      '#F.R..#....s...#',
      '#.....+........#',
      '#W.C..#..##..$.#',
      '#.....#..##....#',
      '###+####.^..s..#',
      '#.......r.|....#',
      '#..r...##+######',
      '#..~~..#.=..~~.#',
      '#.$~~r.#...g~s.#',
      '#..~~..+......>#',
      '################',
    ],
    loot: [['ringProtection'], ['potion', 'potion', 'bracersDefense']],
    asleep: ['8,6', '3,7', '5,9'],
    patrols: { '11,1': [[14, 1], [14, 4]], '12,5': [[7, 6]] },
  },
  {
    id: 'sanctum',
    name: 'The Necromancer’s Sanctum',
    intro: 'Morvath the necromancer waits among the dead. Anything that falls here may rise again.',
    rows: [
      '################',
      '#F.R..#.|....|.#',
      '#.....+..%..s..#',
      '#W.C..#.....*..#',
      '#.....##..##...#',
      '###+###...##.%.#',
      '#.....#.|......#',
      '#..^..+.*.n....#',
      '#.....#..%...|.#',
      '#.$...##..o....#',
      '#.....#...s..>.#',
      '################',
    ],
    loot: [['potion']],
    patrols: { '12,2': [[8, 3]] },
  },
  // --- act two: below the sanctum ---------------------------------------------
  {
    id: 'catacombs',
    name: 'The Catacombs',
    intro: 'Below the sanctum run older tunnels. Something has been eating the dead down here, and it is still hungry.',
    rows: [
      '################',
      '#F.R..#..u.....#',
      '#.....+.....##.#',
      '#W.C..#..s..##.#',
      '#.....#.....^..#',
      '#####+####+#####',
      '#..#.=...#.....#',
      '#u.#..s..+..s..#',
      '#..#.....#....&#',
      '#..+..$..#.##..#',
      '#..#..u..#..u.>#',
      '################',
    ],
    loot: [['potion', 'potion', 'periaptPoison']],
    asleep: ['1,7'], // a gorged ghoul, sleeping it off
    patrols: { '9,1': [[13, 1], [13, 4]] },
  },
  {
    id: 'vault',
    name: 'The Sealed Vault',
    intro: 'The old order kept its treasure here, behind doors the dead still guard. Not every chest is what it seems.',
    rows: [
      '################',
      '#F.R..#.......$#',
      '#.....#..s...=.#',
      '#W.C..+....##..#',
      '#.....#....##.u#',
      '##+####.......$#',
      '#....#####+#####',
      '#.u..#..=...&..#',
      '#..^.+...s.u...#',
      '#....#.........#',
      '#$...#.......>.#',
      '################',
    ],
    loot: [['cloakProtection', 'ironKey', 'potion'], [], ['potion', 'weaponPlus1']],
    mimics: ['14,5'],
    asleep: ['2,7'],
    patrols: { '9,8': [[13, 9], [7, 9]] },
  },
  {
    id: 'barrow',
    name: 'The Wight’s Barrow',
    intro: 'Morvath served something older. In the deepest barrow, Varek the wight rises from his bier in rusted mail.',
    rows: [
      '################',
      '#F.R..#........#',
      '#.....#..u..u..#',
      '#W.C..+........#',
      '#.....#..##.##.#',
      '###+###..##.##.#',
      '#.....#.|....|.#',
      '#..^..+...w....#',
      '#.....#..u...u.#',
      '#.$...##.......#',
      '#.....#...u..>.#',
      '################',
    ],
    loot: [['potion', 'potion']],
    patrols: { '12,2': [[14, 6]] },
    thinned: ['10,10'], // one ghoul fewer on Hard
  },
];

// Listed after the Barrow so the ?level= numbers of the older rooms stay put.
LEVELS.push({
  id: 'larder',
  name: 'The Ghast’s Larder',
  intro: 'The ghouls drag what they find down here. Their elder keeps it, and the air is thick with rot.',
  rows: [
    '################',
    '#F.R..#....u...#',
    '#.....+..=.....#',
    '#W.C..#.....##+#',
    '#.....#..h..#..#',
    '###+###.....#$.#',
    '#.....##+####..#',
    '#..u..#...~~.&.#',
    '#.....+..u~~...#',
    '#.$...#.|.~~u..#',
    '#.....#...~~.>.#',
    '################',
  ],
  loot: [['weaponPlus1', 'potion'], ['potion', 'potion']],
  asleep: ['3,7'], // gnawing on something in the side room
  patrols: { '11,1': [[14, 1], [14, 2]] },
});

// Act three, below the barrow: spiders, then the haunted gallery or the shrine, then the
// banshee who called Varek back.
LEVELS.push(
  {
    id: 'nest',
    name: 'The Spider Nest',
    intro: 'Below the barrow the walls are grey with silk. Something big shifts in the webs overhead.',
    rows: [
      '################',
      '#F.R..#..k..k..#',
      '#.....+.....k..#',
      '#W.C..#..|..|..#',
      '#.....#.k......#',
      '###+####..k..k.#',
      '#......#..k..&.#',
      '#..r...+.......#',
      '#.r....#.|..|..#',
      '#$..^..#..k.k..#',
      '#......#.....>.#',
      '################',
    ],
    loot: [['potion', 'potion', 'gauntletsOgre']],
    asleep: ['3,7', '2,8'], // rats nesting in the silk
    patrols: { '12,1': [[14, 3], [12, 2]] },
  },
  {
    id: 'gallery',
    name: 'The Haunted Gallery',
    intro: 'Portraits of the barrow’s old lords line the walls. Their eyes follow you, and so do their ghosts.',
    rows: [
      '################',
      '#F.R..#..e..e..#',
      '#.....#.....s..#',
      '#W.C..+..|..|..#',
      '#.....#........#',
      '##+####..e...e.#',
      '#.....#........#',
      '#..$..+..|..|..#',
      '#..s..#.....s..#',
      '#..^..##+###.e.#',
      '#.........$#.>.#',
      '################',
    ],
    loot: [['cloakProtection', 'potion'], ['weaponPlus1', 'potion']],
    patrols: { '9,1': [[14, 1], [14, 4]] },
  },
  {
    id: 'throne',
    name: 'The Weeping Throne',
    intro: 'A woman in grey weeps on a throne of bones. It was her grief that woke Varek, and she will not let you leave.',
    rows: [
      '################',
      '#F.R..#........#',
      '#.....#..e..e..#',
      '#W.C..+........#',
      '#.....#.|....|.#',
      '###+###........#',
      '#.....#.e.q..e.#',
      '#..^..+........#',
      '#.....#.|....|.#',
      '#.$...##.......#',
      '#.....#......>.#',
      '################',
    ],
    loot: [['potion', 'potion']],
  },
  // --- act four: below the throne, the tomb of the crypt's first lord -------------
  {
    id: 'halls',
    name: 'The Sunken Halls',
    intro: 'Behind the throne a stair winds down to halls older than the crypt. Bandaged shapes stand in the alcoves, and something darker drifts between them.',
    rows: [
      '################',
      '#F.R..#........#',
      '#.....#..s..s..#',
      '#W.C..+...|....#',
      '#.....#........#',
      '###+###..y..|..#',
      '#.....#.~~~....#',
      '#..^..#.|~~.t..#',
      '#.$...+..~~....#',
      '#.....#..s.....#',
      '#.....#......>.#',
      '################',
    ],
    loot: [['potion', 'potion', 'amuletHealth']],
    asleep: ['9,5'], // the mummy stands in its alcove until disturbed
    patrols: { '12,7': [[12, 2], [9, 9]] },
  },
  {
    id: 'armory',
    name: 'The Black Armory',
    intro: 'The knights who once guarded the tomb still keep its armory, their oaths rotted into something else.',
    rows: [
      '################',
      '#F.R..#..x..=..#',
      '#.....+.....$..#',
      '#W.C..#..|..|..#',
      '#.....#.....t..#',
      '##+#####+###...#',
      '#......#....x..#',
      '#..x...+.......#',
      '#......#.|..|..#',
      '#.$..^.#...x...#',
      '#......#.....>.#',
      '################',
    ],
    loot: [['weaponPlus2', 'potion'], ['potion']],
    patrols: { '12,6': [[13, 9], [9, 7]] },
  },
  {
    id: 'tomb',
    name: 'The Hollow Tomb',
    final: true,
    intro: 'Nekhet built the crypt to hold his court forever. He rises from his sarcophagus, and the dead of his house rise with him.',
    outro: 'Nekhet crumbles into dust and linen, and nothing below the crypt stirs again. The crypt is cleansed at last.',
    rows: [
      '################',
      '#F.R..#........#',
      '#.....#..y..s..#',
      '#W.C..+........#',
      '#.....#.|....|.#',
      '###+###........#',
      '#.....#.*.l.*..#',
      '#..^..+........#',
      '#.....#.|....|.#',
      '#.$...#..s..s..#',
      '#.....#......>.#',
      '################',
    ],
    loot: [['potion', 'potion']],
  },
);

/** The first level's map, kept for older code and tests. */
export const CRYPT = LEVELS[0].rows;

export const levelById = (id) => LEVELS.find((l) => l.id === id);
