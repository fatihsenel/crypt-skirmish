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
  **mimic** posing as a chest) and a rest at the **Still Well**, and finally the
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
  at 5, Brannoc gets **Extra Attack**, Ilsa **Fireball** (20-ft radius, hits allies too),
  Wren Sneak Attack 3d6 and **Uncanny Dodge**, Maela **Mass Healing Word** and
  **Destroy Undead**, plus 3rd-level slots for both casters. Level 6 comes after the
  Catacombs: Brannoc Strength 20, Ilsa **Sculpt Spells** (her Fireball and Burning Hands
  spare the party), Wren Sneak Attack 4d6, Maela Turn Undead twice per fight and
  **Blessed Healer** (healing someone else with a slot heals her for 2 + the slot level),
  and a third 3rd-level slot for both casters
- **difficulty**, picked on the title screen for a new run: **Story** (monsters have ¾ HP
  and −1 to hit and damage), **Normal**, or **Hard** (1.2× HP, +1 to hit and damage). It
  applies to every monster, including mimics and the risen dead; the heroes are unchanged
- **magic items** from chests (Runed Weapon +1, Ring of Protection, Cloak of Protection) go into the pack and
  are handed out at camp
- **fog of war**: you only see what your heroes can see. Rooms you have seen stay dimly
  drawn; monsters out of sight are hidden (their initiative chips read `???` until spotted)
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
- **atmosphere**: walls in front of a figure turn see-through; hits spray blood (bone chips
  from the undead), fire bolts burst into embers, critical hits and Fireball shake the
  screen, and a natural 20 or 1 throws a tumbling d20 over the attacker
- **music**, generated in the browser like the sound effects: a slow A-minor pad with stray
  bell notes while you explore; drums, a bass ostinato and strings swell in once monsters
  notice the party, with brass and a quicker pulse in the boss rooms, then fade back when
  the room is quiet. The Music button (or N) turns it off; Sound (or M) mutes everything
- **saves**: the run is saved to the browser after every room; the title screen offers
  Continue. Fights themselves are not saved: reloading mid-fight returns you to the camp
- **house rules** (simplifications of the SRD): goblin arrows and rat bites poison
  (DC 10 CON); ghoul claws poison instead of paralysing; the mimic's pseudopod knocks
  prone (DC 13 STR) instead of grappling; Grukk's second attack is the only clumsy one;
  Sculpt Spells (an Evocation feature) and Sneak Attack 4d6 arrive at level 6, and Sculpt
  simply leaves all allies out of the blast

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
3 Ossuary, 4 Sanctum, 5 Catacombs, 6 Vault, 7 Barrow) with a fresh level-3 party (add `&difficulty=hard` or `story` to try those); this doesn't touch the save.
In the browser console, `__debug.autoplay()` lets the monster AI play the heroes too, and
`__debug.win()` / `__debug.lose()` end the current fight on the spot.

## Balance

`scripts/sim.js` plays the campaign without graphics: heroes heal, Fireball crowds, Magic
Missile the weakest foe, drink potions when low, sometimes loot chests mid-fight, and
otherwise use the monster AI's tactics. Gear found goes to whoever suits it.
`npm run sim -- 300` plays 300 campaigns down each route; `npm run sim -- 300 act2` replays
act two only, from a pool of real end-of-act-one parties (faster when tuning). Set `SEED=n`
to change the dice and `DIFFICULTY=story|hard` to play another difficulty. Act two was tuned against act one's numbers from the same simulator:
roughly 80% of the party's HP left after the Catacombs, 65% after the Vault, and a Barrow
that is a clear step harder when the party skips the well's rest.

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
  render/          three.js only
    stage.js       renderer, isometric orthographic camera, lights, loop, screen shake
    board.js       dungeon meshes, torches, doors, chests, traps, stairs, banners, props,
                   highlight layers, fog of war (per-tile dimming) and wall fading
    dungeonKit.js  loads the dungeon tiles (public/models/dungeon); walls are built from
                   wall segments between neighbouring wall tiles, with pillars at corners
    gltfModels.js  loads the .glb heroes, undead, orc and rats (public/models), picks weapons,
                   plays their animation clips (idle, walk, attack, cast, hit, death, rise)
    models.js      rigged procedural miniatures: goblins, Grukk and the mimic, plus
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
tests/rules.test.js
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
4. **A goblin model**: goblins and Grukk are still procedural (the CC0 goblins found were
   voxel-styled and clashed). Add a `.glb` to `public/models` and an entry in `SPECS` in
   `gltfModels.js` (clip names per action; a `Armature|Clip` prefix is stripped).
5. **Searching monsters**: alert monsters that lose track of a hidden hero could walk
   to where they last saw them (`patrolStep` in `ai.js` already walks toward a tile).

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
