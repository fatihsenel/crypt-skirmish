# Crypt Skirmish — isometric D&D-style tactics in three.js

**Play it in the browser: https://fatihsenel.github.io/crypt-skirmish/**

![The party fighting skeletons in the Flooded Ossuary, with the combat log](docs/screenshots/battle.jpg)

![Wren sneaking past a patrolling goblin and sleeping rats while hidden](docs/screenshots/stealth.jpg)

A small turn-based dungeon crawl: a party of four (Fighter, Wizard, Rogue, Cleric) fights
its way down a crypt on a 5-ft grid, with SRD 5e-style rules:

- initiative, d20 attack rolls vs AC, crits, ability modifiers, 30 ft movement
- action economy: one action, one bonus action and one reaction per round
- **advantage / disadvantage**: flanking (an ally on the far side) gives melee advantage;
  ranged attacks with an enemy adjacent, or against a Dodging target, have disadvantage
- **opportunity attacks** when you leave an enemy's reach (Disengage prevents them)
- actions: Dash, Dodge, Disengage; Fighter **Second Wind** and Goblin **Nimble Escape** (bonus actions)
- Wizard spell slots (4 × 1st, 2 × 2nd): **Magic Missile**, **Burning Hands** (15-ft cone,
  DEX save, hits allies too), **Misty Step** (bonus-action teleport), **Shield** (automatic reaction)
- **Rogue**: Sneak Attack (+2d6 once per turn with advantage or an ally next to the target),
  Cunning Action (bonus-action Dash / Disengage), Keen Eyes (spots traps within 10 ft)
- **Cleric**: Sacred Flame (cantrip, DEX save), Cure Wounds, Healing Word (bonus action, 60 ft)
  and **Turn Undead** (undead within 30 ft make a WIS save or flee for 2 turns, or until hurt)
- **Paladin** (optional: picked on the title screen in place of the Fighter, as Brannoc in
  white and gold with a crested shield): 28 HP, AC 18, three 1st-level slots and the
  **Dueling** style (+2 melee damage). **Divine Smite** is a toggle in the Attack group: armed,
  the next melee weapon hit spends the lowest slot for 2d8 radiant (+1d8 per slot level above
  1st, +1d8 against undead; a crit doubles it), then it disarms. **Lay on Hands** heals a
  neighbour or yourself from a pool of 5 HP per level that only a long rest refills, and
  **Shield of Faith** (bonus action, 60 ft) gives one ally +2 AC for the fight, until it moves
  to someone else or the paladin falls
- monsters: goblins (skirmishers), skeletons (brutes, undead), an **orc** that charges
  (Aggressive), **giant rats** with Pack Tactics, **Grukk the goblin boss** (two attacks, the
  second at disadvantage) and **Morvath the necromancer**, who raises corpses with
  **Animate Dead**, and the risen skeleton acts right after him (he also casts **Dread**)
- **conditions** that feed advantage / disadvantage:
  - **prone**: melee attacks against you have advantage, ranged ones disadvantage, and your
    own attacks have disadvantage. You stand up at the start of your turn for half your
    movement. Failing a trap's save knocks you prone and ends your move there
  - **Shove** (uses one attack): STR (Athletics) against the target's STR or DEX; a win knocks
    it prone, and ties go to the target. Too-big targets (the mimic) can't be shoved
  - **poisoned**: disadvantage on attacks and on Hide. Goblin arrows, rat bites and ghoul claws
    poison on a failed CON save
  - **frightened** (**Dread**, 1st-level spell, WIS save): disadvantage on attacks while the
    source is in sight, and you can't step closer to it. Repeat the save at the end of each
    of your turns; it also ends if the source dies
  - poisoned and frightened always last through the victim's next turn. Tags show on the figure
- the dungeon: **doors** that block sight until opened, hidden **spike traps** (DEX save,
  2d6), **chests** with potions of healing, and **stairs** to the next level
- **room dressing**: barrels and crates are in the way and give **half cover**: +2 AC
  against an attack that crosses one, unless it stands right next to the attacker (you lean
  over your own barricade). The log marks it. Columns block movement and sight like walls.
  Goblin archers prefer targets out in the open and like to end their move behind a barrel.
  Some crates carry a lit candle
- **a campaign**: a dungeon map with a fork. After the Crypt Door, pick the Goblin Warren or
  the Flooded Ossuary; then either rest at the Forgotten Chapel (long rest) or clear the
  other room too (more XP and loot, but no rest) before the Necromancer's Sanctum
- **act two**: Morvath's fall is followed by a long rest, then the **Catacombs** (ghouls: two
  poisoning claws each),
  a fork between the **Sealed Vault** (treasure, including a Cloak of Protection, and a
  **mimic** posing as a chest) and a rest at the **Still Well**, then an optional detour
  through the **Larder** (a **ghast** and its ghouls; the ghast's stench poisons any hero
  who starts a turn next to it and fails a DC 10 CON save, and one success makes them
  immune for the fight), and finally the
  **Wight's Barrow**, where Varek the wight (110 HP, two attacks, a longbow, Dread) waits. The
  party reaches act two at level 5 and level 6 after the Catacombs, and these monsters are
  tougher than their SRD stat blocks
  to match (see Balance below). Opening the
  mimic wakes it: it joins the initiative right after the opener and bites with advantage,
  unless Wren's Keen Eyes spotted it from within 10 ft (the log warns you, and hovering the
  chest says so)
- between rooms the party keeps HP, spell slots and potions, takes a short rest (regain half
  the missing HP; the fallen get back up) and shares **XP**. A lost fight can be retried as
  you entered it, or you can go back to the map and pick another way
- **levelling** from 3 to 6 (450 / 900 / 2000 party XP): more HP and a +2 to the main ability at 4;
  at 5, Brannoc gets **Extra Attack** (the Paladin also two 2nd-level slots), Ilsa
  **Fireball** (20-ft radius, hits allies too) and **Lightning Bolt** (a 100-ft line, 5 ft
  wide, 8d6 lightning with a DEX save for half; walls stop it, and it hits allies in the
  line too), Wren Sneak Attack 3d6 and **Uncanny Dodge**, Maela **Mass Healing Word**,
  **Spiritual Weapon** (bonus action: a floating spectral mace appears beside a foe within
  60 ft and makes a melee spell attack for 1d8 + WIS force; for the rest of the fight it
  strikes again as a bonus action, with no slot, at any foe within 25 ft of it, and it fades
  if Maela falls) and **Destroy Undead**, plus 3rd-level slots for both casters. Level 6 comes after the
  Catacombs: Brannoc Strength 20 (the Paladin **Aura of Protection**: allies within 10 ft add
  the paladin's CHA modifier, +3, to saving throws), Ilsa **Sculpt Spells** (her Fireball, Lightning Bolt and
  Burning Hands spare the party), Wren Sneak Attack 4d6, Maela Turn Undead twice per fight and
  **Blessed Healer** (healing someone else with a slot heals her for 2 + the slot level),
  and a third 3rd-level slot for both casters
- **difficulty**, picked on the title screen for a new run: **Story** (monsters have ¾ HP
  and −1 to hit and damage), **Normal**, or **Hard** (1.2× HP, +1 to hit and damage). It
  applies to every monster, including mimics and the risen dead; the heroes are unchanged
- **hero names and class**: "Name your heroes, pick a class" on the title screen renames
  Brannoc, Ilsa, Wren and Maela for a new run (letters, numbers, spaces, apostrophes and
  hyphens, up to 14 characters; a blank field keeps the default), and its Fighter / Paladin
  switch picks the first hero's class. The choice is kept in the save; older saves load as a Fighter
- **magic items** from chests (Runed Weapon +1, Ring of Protection, Cloak of Protection) go into the pack and
  are handed out at camp
- **turn order**: each initiative chip carries a small portrait on the unit's own colour: a
  class icon for the heroes (sword, crested shield, wizard's hat, hood, sun) and a silhouette
  for each monster (goblin, crowned boss, orc, rat, skull, hooded necromancer, ghoul claws,
  the ghast's reeking claws, the wight's crowned skull, a toothy chest), with the
  initiative number on a badge
- **fog of war**: you only see what your heroes can see. Rooms you have seen stay dimly
  drawn; monsters out of sight are hidden (their initiative chips show a `?` and read `???` until spotted)
  and their turns pass quickly while "something moves in the dark"
- **monster senses**: monsters start unaware. They notice a hero they can see within 8
  tiles (3 for Wren, a *skulker*), hear fighting within 5 tiles of walking distance (a closed
  door counts as 2 more; 3rd-level spells carry to 8), and a monster that spots you or gets hurt shouts to unaware
  allies within 4 tiles that can see it (a roused ally doesn't pass the alarm on). Unaware
  monsters make no opportunity attacks and are attacked with advantage (so Sneak Attack
  works on them). Some **sleep** (they see nothing and only wake to noise within 2 tiles,
  a shout, or a blow); some **patrol**, walking a beat at half speed until they notice you
- **stealth**: any hero can take the **Hide** action (Wren as a bonus action, with
  expertise; Brannoc and Maela roll with disadvantage in heavy armour). A hidden hero is
  only spotted by a monster whose passive Perception (10 + WIS) reaches the Stealth roll,
  or one right next to them. The first attack from hiding has advantage; attacking or
  casting gives you away. You can't hide while an alert enemy can see you
- **searching monsters**: alert monsters lose track of a hidden hero. They remember the
  last tile where they saw each hero (even partway through a move), walk there (Dashing if
  it's far), and take the **Search** action: a Perception roll against the hero's Stealth
  for every hidden hero in sight, which finds them on a success. With no lead, they stay
  put and Search
- **goblins that hide**: goblins use **Nimble Escape** to Hide as a bonus action (Stealth
  with expertise), usually after shooting. They need something to hide behind: out of the
  heroes' sight, or behind a barrel or crate, and they end their moves in such spots. A
  hidden goblin is drawn as a ghost with a "Hidden" tag and can't be targeted. A hero
  standing next to it, one with a clear view of it, or one whose passive Perception
  reaches its roll spots it; otherwise the
  heroes' **Search** action rolls Perception against every hidden goblin in sight. Attacking
  or getting hurt gives a goblin away
- **atmosphere**: walls in front of a figure turn see-through; hits spray blood (bone chips
  from the undead), fire bolts burst into embers, critical hits and Fireball shake the
  screen, and a natural 20 or 1 throws a tumbling d20 over the attacker
- **music**, generated in the browser like the sound effects: a slow A-minor pad with stray
  bell notes while you explore; drums, a bass ostinato and strings swell in once monsters
  notice the party, with brass and a quicker pulse in the boss rooms, then fade back when
  the room is quiet. The Music button (or N) turns it off; Sound (or M) mutes everything
- **the ending**: beating Varek shows the run's tally: difficulty, party level, rooms won,
  rounds fought, fights lost and XP, then each hero's damage dealt, kills, critical hits,
  healing given and times downed, with a star on whoever leads each column. Lost fights
  count toward the tally; hero numbers come from the fights that were won
- **saves**: the run is saved to the browser after every room; the title screen offers
  Continue. A fight in progress is saved too, as its dice seed plus the commands the
  heroes were given; reloading replays them and picks up on the same turn. If a save
  no longer replays to the same state (say, after a rules change), the party is sent
  back to the camp instead. The combat log's earlier lines are not restored
- **house rules** (simplifications of the SRD): goblin arrows and rat bites poison
  (DC 10 CON); ghoul claws poison instead of paralysing; the mimic's pseudopod knocks
  prone (DC 13 STR) instead of grappling; Grukk's second attack is the only clumsy one;
  Sculpt Spells (an Evocation feature) and Sneak Attack 4d6 arrive at level 6, and Sculpt
  simply leaves all allies out of the blast; the ghast's stench poisons only until the end
  of the victim's turn

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # rules unit tests (Vitest)
npm run sim      # balance check: plays whole campaigns headlessly and prints win rates
npm run build    # production bundle in dist/ (served from /crypt-skirmish/)
npm run preview  # http://localhost:4173/crypt-skirmish/ to check the build
```

Every push to `main` runs the tests, builds, and deploys to GitHub Pages
(`.github/workflows/pages.yml`). The base path lives in `vite.config.js`.

Open `http://localhost:5173/?level=4` to jump straight into a room (1 Crypt, 2 Warren,
3 Ossuary, 4 Sanctum, 5 Catacombs, 6 Vault, 7 Barrow, 8 Larder) with a fresh level-3 party (add `&difficulty=hard` or `story` to try those, `&party=5` for
heroes of another level from 3 to 6, and `&paladin` for a Paladin instead of the Fighter);
this doesn't touch the save.
In the browser console, `__debug.autoplay()` lets the monster AI play the heroes too, and
`__debug.win()` / `__debug.lose()` end the current fight on the spot.

## Balance

`scripts/sim.js` plays the campaign without graphics: heroes heal, Fireball crowds (or
Lightning Bolt a line of them), keep Spiritual Weapon swinging, Magic
Missile the weakest foe, drink potions when low, sometimes loot chests mid-fight, and
otherwise use the monster AI's tactics. Gear found goes to whoever suits it.
`npm run sim -- 300` plays 300 campaigns down each route; `npm run sim -- 300 act2` replays
act two only, from a pool of real end-of-act-one parties (faster when tuning). Set `SEED=n`
to change the dice and `DIFFICULTY=story|hard` to play another difficulty. Act two was tuned against act one's numbers from the same simulator:
roughly 80% of the party's HP left after the Catacombs, 65% after the Vault, and a Barrow
that is a clear step harder when the party skips the well's rest. The Larder is the greedy
option: on Normal it's won almost always after the well, but taking it after the Vault (no
rest at all) drops the Barrow to roughly two wins in three.

## Controls

| Input | Action |
| --- | --- |
| Left-click tile | Move (blue tiles = reachable, gold dots = path, red dots = provokes an opportunity attack) |
| Left-click enemy | Attack (red tiles = targetable); uses the best weapon in range |
| Attack buttons | Force a specific attack, or pick **Shove** and click an adjacent enemy |
| Spell buttons | Enter targeting: enemy (red), ally (green), aim a cone (Burning Hands), pick a purple tile (Misty Step) |
| Action buttons | Dash / Dodge / Disengage / Second Wind / Potion / Turn Undead take effect immediately |
| Left-click chest | Open it when standing next to it (free, once per turn) |
| Camp: click a gold room | Choose where to go next, then Enter (or Rest) |
| Camp: Give to … | Hand an item from the pack to a hero (× puts it back) |
| Esc | Cancel the selected attack or spell |
| Right-drag / wheel | Pan / zoom |
| Space / Enter | End turn |
| M / N | Sound on/off / music on/off |
| H | Show or hide the controls panel (its state is remembered) |

On phones and tablets:

| Touch | Action |
| --- | --- |
| Tap a tile, enemy, chest or target | Preview what would happen (the hint shows it) |
| Tap the same spot again | Do it |
| Drag / pinch | Pan / zoom |
| Tap a tag or portrait | Show its tooltip |
| Log button (top right) | Open or close the combat log; a gold dot means new lines. Below 900 px wide the log is hidden otherwise |

## Layout

```
src/
  game/            pure rules, no three.js (unit-testable)
    dice.js        dice rolling, "2d6+3" parsing, ability modifiers
    grid.js        map grid, BFS movement, distance field, line of sight, fog-of-war vision
    units.js       stat blocks, XP values, and what heroes gain at levels 4 to 6
    items.js       magic items and what they do
    abilities.js   action and spell definitions, cone geometry
    campaign.js    the dungeon map, XP and levelling, the pack, rests, save data (pure state)
    maps.js        the rooms as ASCII maps: '#' wall, '+' door, '^' trap,
                   '$' chest, '>' stairs, '%' corpse, '&' barrel, '=' crate,
                   '|' column, letters = spawns
    combat.js      Game: initiative, turns, move (+ opportunity attacks, doors, traps),
                   attack, advantage, sneak attack, actions, spells & slots, chests,
                   party carry-over between levels, events
    ai.js          monster brains (brute / skirmisher / caster), one step at a time
    replay.js      fight saves: hero commands, monster turns and replaying them from a seed
  render/          three.js only
    stage.js       renderer, isometric orthographic camera, lights, loop, screen shake
    board.js       dungeon meshes, torches, doors, chests, traps, stairs, banners, props,
                   highlight layers, fog of war (per-tile dimming) and wall fading
    dungeonKit.js  loads the dungeon tiles (public/models/dungeon); walls are built from
                   wall segments between neighbouring wall tiles, with pillars at corners
    gltfModels.js  loads the .glb heroes, undead, orc, rats and goblins (public/models), picks
                   weapons, plays their animation clips (idle, walk, attack, cast, hit, death,
                   rise); goblins are the hooded rogue scaled down and tinted green, Grukk a
                   green-tinted barbarian, the ghast a tinted skeleton minion
    models.js      rigged procedural miniatures: the mimic, plus
                   fallbacks for every other unit if its .glb fails to load
    unitView.js    base + label, idle/walk/swing/cast/teleport/death animations
    effects.js     spell effects: missiles, fire cone, mist, shield dome, healing,
                   sacred flame, turn undead, raise dead, fireball; hit particles,
                   fire-bolt bursts and the tumbling d20
    tween.js       promise-based tweening
  audio/sfx.js     procedural Web Audio sound effects + dungeon ambience
  audio/music.js   procedural music: explore, combat and boss layers that crossfade
  ui/hud.js        HTML overlay: initiative, action bar, combat log
  ui/camp.js       title screen and camp: map, party, pack, level-ups
  main.js          controller: input → game → animations → HUD; campaign flow and saving
tests/rules.test.js, tests/replay.test.js
scripts/sim.js     headless balance simulator (npm run sim)
```

The rules engine resolves everything instantly and emits events (`initiative`, `turnStart`,
`move`, `attack`, `spell`, `action`, `door`, `trap`, `trapFound`, `chest`, `mimic`,
`mimicFound`, `shove`, `rider`, `condition`, `death`, `gameOver`); `move()` returns a list of steps (`walk`, `door`, `opportunity`, `trap`) that
the controller plays back in order. Keep it that way and
you can swap the visuals (real models, different camera) without touching rules.

## Good next steps

1. **More monsters**: add a stat block in `units.js` and a builder in `models.js` returning the same rig fields
   (`body`, `head`, `armL/R`, `legL/R`, `rest`, `height`); animations work
   automatically (quadrupeds wire their front legs as arms and set `bite: true`). For downloaded `.glb` models, load them
   with `GLTFLoader` and map their bones onto the same rig fields.
2. **More conditions**: add one to `CONDITIONS` in `combat.js` and a line in `attackMods`;
   monsters can inflict it through an attack `rider` or a spell's `condition`.
3. **More rooms**: add a map to `LEVELS` in `maps.js` and a node in `NODES` in `campaign.js`
   (its column, row and `next` links); the camp map draws it.
4. **A real goblin model**: goblins and Grukk reuse tinted KayKit adventurers. A dedicated
   rigged goblin would only need a `.glb` in `public/models` and its entry in `SPECS` in
   `gltfModels.js` (clip names per action; a `Armature|Clip` prefix is stripped).
5. **More classes**: `CLASS_CHOICES` in `units.js` lists which classes can fill each hero
   slot. A new one needs a stat block and a `PROGRESSION` table there, a model spec in
   `gltfModels.js` (and a builder in `models.js`), and a simulator policy in `scripts/sim.js`
   if it has abilities the monster AI wouldn't use. A Ranger for Wren's slot would be next.

## Credits

The heroes, skeletons and Morvath are from the **KayKit Adventurers** and **KayKit Skeletons**
character packs by Kay Lousberg (www.kaylousberg.com), CC0. Their license files are in
`public/models`. The orc (Ultimate Monsters) and the giant rats (Animated Enemies) are by
Quaternius (quaternius.com), CC0, via Poly Pizza (`public/models/monsters`). If a model
fails to load, that unit falls back to its procedural figure.
The floors, walls, torches, chests, spike traps, banners, barrels, crates, candles and
columns are from **KayKit Dungeon
Remastered** by the same author, CC0 (`public/models/dungeon`); without them the board
falls back to plain boxes.

Rules content follows the SRD 5.1 (CC-BY-4.0). Credit it if you publish, and avoid
non-SRD names and Wizards of the Coast trademarks.
