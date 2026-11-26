// Dungeon levels. All maps are 16 × 12.
//   '#' wall   '.' floor   '+' closed door   '^' hidden trap   '$' chest
//   '>' stairs down   '%' corpse (a dead goblin, raisable by a necromancer)
// Spawns: F fighter, W wizard, R rogue, C cleric;
//         g goblin, s skeleton, o orc, r giant rat, b goblin boss, n necromancer,
//         u ghoul, w wight, k giant spider, e specter, q banshee,
//         y mummy, t wraith, x fallen knight, l mummy lord,
//         a gargoyle, z basilisk, v minotaur. (Mimics hide in chests: see `mimics`.)
// `loot` lists the contents of each chest in reading order (item ids from items.js).
// `mimics` lists chest tiles ('x,z') that are really mimics; give those chests [] loot.
// `final` marks the last room of the campaign; `outro` is its victory text.
// Props: '&' barrels and '=' crates (half cover: +2 AC against attacks across them), '|' columns
// (block movement and sight), '*' braziers (a hero next to one can tip it: burning coals).
// '~' shallow water: costs double to wade through.
// '_' a chasm: no one crosses it, but it blocks neither sight nor shots.
// Rules 9: `gong` {x, z, by, after, wave} (the monster on tile `by` strikes it once it knows the
// party is here; `wave` comes in `after` rounds later), `captive` {x, z, until, loot} (freed
// before round `until` + 1, or lost), `hold` {rounds, waves} (won at the end of round `rounds`;
// `waves` by round), `secrets` [[x, z]] (walls that are secret doors) and `added9` spawns.
// Rules 11: `high` [[x0, z0, x1, z1]] raised ledges, `dark11` more dark areas, `added11` spawns
// (H hobgoblin, Y kobold, p shadow).
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
    added8: [['d', 3, 9]], // rules 8: a zombie shuffling by the chest
    high: [[12, 1, 14, 2]], // rules 11: a ledge in the east hall's far corner
    added11: [['Y', 13, 1], ['Y', 14, 2]], // rules 11: kobolds with slings up on it
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
    // Rules 9: Grukk's war gong. Once he knows you're here he strikes it, and two rounds later
    // three more goblins pour out of the burrows in the north room.
    gong: { x: 12, z: 5, by: '11,6', after: 3, wave: [['g', 14, 1], ['g', 14, 3]] },
    high: [[13, 7, 14, 9]], // rules 11: a ledge by the way down, the archer's perch
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
    added8: [['c', 1, 7]], // rules 8: a swarm of rats in the flooded room
    pits: [[8, 2], [11, 6]], // rules 10: pit traps past the door and by the column
    loot10: [['ringProtection', 'scrollMagicMissile'], ['potion', 'potion', 'bracersDefense']],
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
    added8: [['d', 11, 6]], // rules 8: one of the necromancer's zombies
    added11: [['H', 12, 9]], // rules 11: a hobgoblin sellsword hired to guard the way down
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
    dark: [[1, 6, 2, 10], [10, 6, 14, 10]], // rules 6: unlit side rooms, seen only by torchlight
    patrols: { '9,1': [[13, 1], [13, 4]] },
    // Rules 9: hold the catacombs until the end of round 7 while the dead climb out of their niches.
    hold: { rounds: 6, waves: { 3: [['s', 1, 9], ['s', 13, 6]] } },
    added11: [['p', 13, 8]], // rules 11: a shadow in the unlit east room
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
    added8: [['d', 3, 9]], // rules 8: a zombie in the lower hall
    secrets: [[13, 6]], // rules 9: a secret door from the vault's upper room to the lower hall
    dark11: [[1, 6, 4, 10]], // rules 11: the side room's torches are out
    added11: [['p', 4, 10]], // rules 11: a shadow by its chest
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
  // Rules 9: a prisoner chained by the larder's west wall. Free them before round 8 and they hand
  // over what they hid; after that the ghouls drag them off.
  captive: { x: 7, z: 9, until: 7, loot: ['potion', 'potion', 'ringProtection'] },
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
    ceilings: [[10, 7], [10, 2]], // rules 10: cracked ceilings a charge, Shatter or Thunderwave brings down
    loot10: [['potion', 'potion', 'gauntletsOgre', 'scrollFogCloud']],
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
    loot10: [['cloakProtection', 'potion', 'scrollCureWounds'], ['weaponPlus1', 'potion']],
    high: [[7, 1, 14, 1]], // rules 11: the gallery itself, a raised walk along the north wall
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
    added7: [['i', 3, 9]], // rules 7: a gelatinous cube, unseen, by the side room's chest
    added9: [['f', 13, 9]], // rules 9: a cult fanatic calling the dead up by the stair
    ceilings: [[11, 1]], // rules 10
    loot10: [['potion', 'potion', 'amuletHealth', 'scrollFireball']],
  },
  {
    id: 'armory',
    name: 'The Black Armory',
    intro: 'The knights who once guarded the tomb still keep its armory, their oaths rotted into something else. A lever by the door still works the portcullis to the lower hall.',
    rows: [
      '################',
      '#F.R..#!.x..=..#',
      '#.....+.....$..#',
      '#W.C..#..|..|..#',
      '#.....#.....t..#',
      '##+#####+###:::#',
      '#......#....x..#',
      '#..x...+.......#',
      '#......#.|..|..#',
      '#.$..^.#...x...#',
      '#......#.....>.#',
      '################',
    ],
    loot: [['weaponPlus2', 'potion'], ['potion']],
    patrols: { '12,6': [[13, 9], [9, 7]] },
    secrets: [[10, 5]], // rules 9: a secret door from the upper hall to the lower one
  },
  {
    id: 'tomb',
    name: 'The Hollow Tomb',
    intro: 'Nekhet built the crypt to hold his court forever. He rises from his sarcophagus, and the dead of his house rise with him.',
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
  // --- act five: under the tomb, the labyrinth Nekhet sealed away -------------------
  {
    id: 'bridge',
    name: 'The Broken Bridge',
    intro: 'Beneath Nekhet’s sarcophagus a shaft drops into older stone. A chasm splits the hall, crossed by two narrow spans, and stone gargoyles crouch along its far lip.',
    rows: [
      '################',
      '#F.R..#..__.a..#',
      '#.....#..__..x.#',
      '#W.C..+........#',
      '#.....#..__.|a.#',
      '###+###..__..x.#',
      '#.....#..__....#',
      '#..^..#..__.a..#',
      '#.$...+........#',
      '#.....#..__..a.#',
      '#.....#..__..>.#',
      '################',
    ],
    loot: [['potion', 'potion']],
    asleep: ['12,1', '13,4', '12,7', '13,9'], // statues until something comes close (False Appearance)
    pits: [[9, 3], [10, 8]], // rules 10: rotten planks on both crossings
    loot10: [['potion', 'potion', 'scrollMistyStep']],
  },
  {
    id: 'lair',
    name: 'The Basilisk Den',
    intro: 'The statues here were adventurers once: their faces are still frozen mid-scream. Something heavy drags itself through the shallows.',
    rows: [
      '################',
      '#F.R..#.|....$.#',
      '#.....#....z...#',
      '#W.C..+..|..|..#',
      '#.....#~~....a.#',
      '###+###~~..a...#',
      '#.....#.....|z.#',
      '#..^..+..|.....#',
      '#.$...#....z...#',
      '#.....#.|....|.#',
      '#.....#......>.#',
      '################',
    ],
    loot: [['weaponPlus2', 'potion'], ['potion']],
    asleep: ['11,5', '13,4'],
  },
  {
    id: 'labyrinth',
    name: 'The Labyrinth',
    final: true,
    intro: 'Nekhet walled a beast into the heart of his crypt. Tharok the minotaur has paced these halls for a thousand years, and he smells you coming.',
    outro: 'Tharok falls, and the labyrinth goes quiet. Nothing below the crypt stirs again. The crypt is cleansed at last.',
    rows: [
      '################',
      '#F.R..#........#',
      '#.....#.##.##..#',
      '#W.C..+.#...#..#',
      '#.....#.#.v.#.a#',
      '###+###......__#',
      '#.....#.#...#__#',
      '#..^..+.#...#..#',
      '#.$...#.##.##..#',
      '#.....#..a...a.#',
      '#.....#......>.#',
      '################',
    ],
    loot: [['potion', 'potion']],
    asleep: ['9,9', '13,9', '14,4'], // gargoyles on their plinths
    thinned: ['14,4'], // Hard leaves this gargoyle out
    ceilings: [[10, 5], [11, 9]], // rules 10: Tharok's charges can bring these down
  },
  // Act two's third way: a room on two floors. The stairs '[' lead down to ']' in the lower hall.
  {
    id: 'cistern',
    name: 'The Cistern Stair',
    intro: 'Past the catacombs a charnel hall sits over a flooded cistern. Two stairs wind down through its floor, and something hungry splashes in the dark below.',
    rows: [
      '################',
      '#F.R.[.##.]...u#',
      '#...,..##.~~...#',
      '#W.C...##.~~...#',
      '#...|..##...u..#',
      '#..,...##.=....#',
      '#.s..s.##..~~..#',
      '#......##..~~.u#',
      '#[...|.##].$...#',
      '#..s...##..u...#',
      '#^.....##....>.#',
      '################',
    ],
    loot: [['weaponPlus1', 'ringProtection', 'potion']],
    added: [['j', 13, 5, true]], // rules 6: a young ochre jelly (Medium, half HP) in the flooded hall below
    below: [8, 0], // rules 6: the cracked floor (',') gives way into the hall 8 tiles east
    asleep: ['13,5'], // rules 6: the jelly lies still in the water until something comes near
  },
  // Act five's middle way: a chapel over an undercroft, its stairs crossing (the first '[' leads to
  // the first ']', at the far end below).
  {
    id: 'undercroft',
    name: 'The Undercroft',
    intro: 'Past the bridge a ruined chapel stands over its undercroft. Its two stairs go down to opposite ends of the dark, where something heavy waits in the water.',
    rows: [
      '################',
      '#F.R..[....a..[#',
      '#W.C.,......x..#',
      '#..|....a,..|..#',
      '#.....$........#',
      '################',
      '################',
      '#]...........]~#',
      '#..~~.......~~.#',
      '#..~~.$z.....u.#',
      '#^....|....z.>.#',
      '################',
    ],
    loot: [['weaponPlus2', 'potion'], ['potion', 'potion']],
    below: [0, 6], // rules 6: the cracked floor (',') gives way into the undercroft 6 tiles south
    asleep: ['11,1', '8,3'], // gargoyles on their plinths
  },
);

/** The first level's map, kept for older code and tests. */
export const CRYPT = LEVELS[0].rows;

export const levelById = (id) => LEVELS.find((l) => l.id === id);
