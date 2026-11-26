# Crypt Skirmish

Turn-based isometric dungeon tactics with SRD 5e-style rules, built with Vite, three.js and
Vitest. It deploys to GitHub Pages at https://fatihsenel.github.io/crypt-skirmish/ on every
push to `main`. README.md describes the game for players; this file is for working on it.

## Commands

```bash
npm run dev            # dev server, use http://localhost:5173
npm test               # Vitest, run before every commit
npm run lint           # ESLint: undefined names and unused code, run before every commit
npm run sim -- 300     # headless balance check, run after changing monsters, spells or rooms
npm run touch-check    # phone taps and layout in headless Chrome (dev server on 5173), after
                       # changing input or the HUD and overlays;
                       # the deploy runs it against the build on seeds 3, 1 and 5,
                       # SEED=3 LATE=700 (a late lift must still be a tap) and
                       # SEED=3 SIDEWAYS=1 (the phone on its side, 812×375)
npm run stills         # re-render the 3D emblem's stills and README shots, after changing it
npm run build          # production bundle (base path /crypt-skirmish/ in vite.config.js)
npm run size-check     # after a build: the title's code and the skull, gzipped, within budget;
                       # the deploy runs it
npm run digest         # the last 7 days of play stats and stored losses, as Markdown, from the
                       # Worker's tallies (and Umami's visitors with UMAMI_API_KEY); LOSS_READ_KEY
                       # from the environment. GitHub Actions runs it on Mondays (digest.yml,
                       # the keys repository secrets)
```

The `dnd-dev` entry in `.claude/launch.json` uses port 5179. Don't use it: run the dev
server on 5173.

## Architecture

- **`src/game/` is pure rules:** no three.js, no DOM. It is unit-tested in `tests/` and run
  headlessly by `scripts/sim.js`. Keep it that way.
- `src/boot.js` is the entry: it makes the `Camp` and shows the title before three.js and
  `main.js` arrive, so it must not import three.js or `render/` (`npm run size-check` fails if
  the title's code grows past 80 kB). The camp's handlers are filled in by `main.js`
  (`later`); a press before then waits for it. The dungeon tiles load behind the title (the backdrop stays hidden,
  `#stage.veiled`, and fades in once they're here), and `newGame` and `startReplay` wait for them
  (`kit` in `main.js`). A finished fight is settled in
  `fightEnd.js` (`settleFight`): records, achievements, dailies and the banner's facts.
- The rules engine (`Game` in `combat.js`, built on `Spellcasting` in `spells.js`) resolves
  everything instantly and emits events (`attack`, `move`, `spell`, `death`, …). `move()` returns steps (doors, traps, coals, and the opportunity and readied attacks it sets off). `src/main.js` turns them
  into HUD updates, and `src/animate.js` into animations and sound.
- **Randomness in rules goes through `this.rng`** (or a passed-in `rng`), never
  `Math.random`. Fights are saved as a seed plus the heroes' commands and replayed on load
  (`replay.js`). Anything that changes the dice order makes old saves fall back to camp.
  The end banner's Watch replay plays the same record back (`startReplay` in `main.js`), and
  Past runs keep each run's last one (`history.js`). `#watch=` links carry the same record
  (`fightLink.js`, copied and opened by `links.js`) and are replayed headlessly first, so a rules change refuses old links.
  To change the rules without breaking them, bump `RULES` in `combat.js` and gate the new rule
  on `this.rules >= N`: records, saves and links carry their `rules` (`ru` in a link; none means
  1) and are rebuilt with it, and `tests/rulesVersion.test.js` replays fights recorded under the
  first rules (`tests/fixtures/v1-fights.json`, made by `scripts/v1-fixtures.mjs`). `RULES=1
  npm run sim` plays the old rules. Rules 2: death saves (`dying`, `deathSave`, `revive`),
  concentration (`concentrating`, `endConcentration`), ghoul paralysis (a rider's `v2`), long
  range (`longReach`) and creatures giving cover. Rules 3: Push, a shove's `push` choice
  (`pushTo`, `pushed`, `fall`: over a chasm's edge, `fell` and `raised`, no body left).
  Rules 4: monsters throw heroes back (`throwBack`: an attack's `throws: { dc }` once a turn,
  `threw`, and Tharok's failed charge knock; a hero thrown at a chasm saves DEX vs `EDGE_DC` to
  catch the edge; the `throw` event, `playThrown` in `animate.js`). Rules 5: a push into a
  stairwell tumbles down (`stairwell`, `tumble`: a push's `stair`, `tumbleDown` in `animate.js`),
  and a `lurks` monster keeps to its floor (`lurking`, through `passableFor`). Rules 6: a potion
  tossed to an ally within `TOSS_RANGE` (`feedPotion`'s `thrown`), the ochre jelly's `splits`
  (`split`, the `split` event, `playSplit`), cracked floor (`cracked`, `breakCrack`: a push's
  `crash`, a tumble's `through`), the supplies (`SUPPLIES`: `flasks` and `caltrops`, carried
  like potions; the `flask` and `caltrops` commands, the `burning` condition's `burnOn`,
  `caltropTiles`) and dark areas (`dark`, `dim`, `TORCH`: heroes don't see past their torches,
  in `inSight` and the fog). Rooms gate their rules-6 parts through `level.added` (spawns
  `[code, x, z, young]`), `level.below` and `level.dark`; rules-5 fights are replayed by
  `tests/fixtures/v5-fights.json` (`scripts/v5-fixtures.mjs`). Rules 7: thrown torches and the
  Light cantrip (`lightTile`, the `torch` command with `spell`, `lamps`; `LIGHT_CLASSES`), morale
  (`morale` and `leader` stat-block fields, `moraleCheck`: a rout is `turned` with `routed`),
  smashing barrels and crates (`smash`, `PROP_HP`, `board.removeProp`) and the gelatinous cube
  (`i`: `transparent`, the `engulfed` condition and `digest`); rooms add rules-7 spawns through
  `level.added7`, and rules-6 fights are replayed by `tests/fixtures/v6-fights.json`
  (`scripts/v6-fixtures.mjs`). Rules 8: barred doors (the `bar` command, `barDoor`, a door's
  `barred: { dc }`; a monster stepping into one makes `bashDoor`, a `bash` move step), disarmed
  traps (the `disarm` command, `disarmBonus`; a `rigged` trap springs on monsters, not heroes),
  the zombie (`d`: `fortitude`, Undead Fortitude in `applyDamage`, beaten by `this.blow`'s crit or
  radiant or a `radiant` spell) and the swarm of rats (`c`: `swarm`, half weapon damage, through
  foes in `passableFor`, an attack's `weak` dice at half HP); rooms add rules-8 spawns through
  `level.added8`, and rules-7 fights are replayed by `tests/fixtures/v7-fights.json`
  (`scripts/v7-fixtures.mjs`). Rules 9: mid-fight arrivals (`addUnit`, `arrivals[round]`, spawned
  by `newRound` with the `arrive` event), the alarm gong (`level.gong`, a `gong` prop; its
  `ringer` strikes it in `turnStarts`, `ringGong`), holding out (`level.hold`: waves by round, won
  as round `rounds + 1` begins, `gameOver` with `held`), the prisoner (`level.captive`, a
  `captive` prop, the `free` command, `freeCaptive`), the owl familiar (`FAMILIAR_CLASSES`,
  `u.familiar`, the `owl` command, `sendOwl`, `owlHelp`, swatted in `turnStarts`; drawn by
  `render/owl.js`, its eyes only in the fog), secret doors (`level.secrets`, found by Search,
  passive Perception or Keen Eyes, `openSecret`, `board.revealSecret`) and the cult fanatic (`f`:
  `summons`, `summon`, the called crumble with it, no XP); rooms add rules-9 spawns through
  `level.added9`, and rules-8 fights are replayed by `tests/fixtures/v8-fights.json`
  (`scripts/v8-fixtures.mjs`). Rules 10: lair actions (a boss's `lair`: `hands`, `sandstorm`,
  `quake`; `lairAction` in `newRound`, the `lair` event), spell scrolls (`kind: 'scroll'` items,
  carried in `u.scrolls`, `readsScroll` and `classSpells`; a spell command's `scroll`, `takeScroll`
  from chests, the pedlar's one in `stock`), Counterspell (`counterer`, `counterspell`, a spell
  result's `countered`), pit traps (`level.pits`, a trap's `pit`, `fallInPit`, the `pit` condition,
  `climbOut`), cracked ceilings (`level.ceilings`, `shake` from a charge, Shatter or Thunderwave,
  `caveIn`, `rubble`; a result's `caveIns`, `playCaveIns`), Fog Cloud (`fogs`, `fogBlocks`,
  `clearShot`; kept out of `Grid`) and Grease (`grease`, a `slip` move step); rubble, grease and
  open pits are difficult through `roughTiles`. Rooms add rules-10 chest loot through
  `level.loot10` (and spawns through `level.added10`), and rules-9 fights are replayed by
  `tests/fixtures/v9-fights.json` (`scripts/v9-fixtures.mjs`). Rules 11: fighting styles
  (`FIGHTING_STYLES`, `STYLE_CLASSES`, `applyStyle` in `units.js`; a party record's `style`,
  `chooseStyle` and `heroStyle` in `campaign.js`, `rec.style` in links; Protection is
  `protector`, Great Weapon Fighting a damage roll's `rerolled`), high ground (`level.high`
  rects, `this.high` and `grid.high`: a climb in `moveCost`, which now gets the tile it's
  entered from, `high ground` advantage in `attackMods`, a push's `drop` and a `ledge` tumble;
  drawn by `liftAt` and `LEDGE` in `render/board.js`, figures lifted by `raise` in
  `unitView.js`), the shadow (`p`: `shadowy`, `shadowStealth`, an attack's `drain`, `shade`
  half weapon damage, radiant `vulnerable`), the hobgoblin (`H`: `martial`, once a turn
  through `martialUsed`) and the kobold (`Y`, pack tactics); rooms add rules-11 spawns through
  `level.added11` and dark through `level.dark11` (`filesForRoom` takes the level, so every
  `added*` spawn's figure loads), and rules-10 fights are replayed by
  `tests/fixtures/v10-fights.json` (`scripts/v10-fixtures.mjs`).
  `RULES` lives in `game/elites.js`.
- `src/render/` is three.js only. Animations use `tween`/`wait` from `render/tween.js`, so
  they follow the monster-turn speed setting (`playback.rate`). `calm()` there is reduced
  motion (the Motion setting, or the system's on System; `data-motion` on `<html>` for CSS):
  no shake, no camera pans, no drifting text, a still title logo, steady torches without
  embers or dust (`Motes` in `render/motes.js`) and no hit-stop.
  The 3D view draws every frame only while something moves (`animating()` in `tween.js`:
  tweens, waits, input), else about 15 a second (`stage.js`). Anything else that moves the
  scene for a while (a camera glide, a clip, fog) calls `keepAwake(ms)`, or it will stutter.
  Shadows are redrawn on those frames and every 4th idle one (`shadowMap.autoUpdate` is off).
  Draw a frame with `stage.render()`, never `renderer.render`: with glow (bloom, the `glow`
  setting: `auto` is off on a coarse pointer, `applyGlow` in `main.js`) or photo mode's blur on,
  `stage.setEffects` loads `render/post.js` (its own chunk: `vite.config.js` keeps three's
  `postprocessing/` and `shaders/` out of the three chunk) and frames go through its composer,
  which swaps the background for its inverse-ACES colour so it isn't tone-mapped twice. Only
  light above its threshold glows, so keep plain highlights below white.
  Walls get a shading strip at their feet (`addAO` in `board.js`; `redoAO` after a secret
  door opens). A struck figure flashes and its rig freezes (`impact` in `unitView.js`,
  `GltfRig.freeze`); a slain monster burns away (`burnAway`, `render/dissolve.js` patched into
  its own materials, `edgeColor` picks the rim), so a figure's materials are cloned (`own`)
  before they're changed.
  An effect's light is a `SpellLight` (`render/lights.js`), never a new `PointLight`: the scene
  keeps 4 point lights and lends them to the brightest stand-ins, since changing the light count
  recompiles every lit material. Floor marks (`render/marks.js`: soot, char, remains through
  `board.marks.add`) are drawn only and gone on reload; so are footprints (`render/tracks.js`,
  aged by the `round` event) and the floor's loose bits (`render/clutter.js`, one instanced
  mesh a kind, fogged per piece), both fed each step through `board.tread` from `moveAlong`'s
  `onStep`; a scorch or char mark also `blast`s the clutter. Water reflections
  (`render/reflect.js`, one three `Reflector` over every pool, its fog a vertex attribute) go with
  the Glow setting (`board.setReflections`); they leave the floor's meshes out of the mirror.
  A caster's runes are `castGlyphs` (`render/glyphs.js`, from `cast` and `shoot` in `unitView.js`;
  `schoolColor` maps a spell id, so a new spell needs a school in `SPELL_SCHOOL`). A scorch or char
  mark also scars the walls facing the camera beside it (`board.scars`, `render/scars.js`; Shatter
  and Thunderwave through `crackWalls` in `animate.js`); a missed arrow or javelin aims wide
  (`wideOf`) and `shootProjectile`'s `missed` hands it to `board.arrows.fly` (`render/arrows.js`),
  which sticks it (a closed door's shafts ride its hinge; `removeProp` and `revealSecret` clear them).
  Taking the stairs, `board.focusFloor` ghosts the floor being left (`lowerCells`, in `tickFog`)
  and `stairCamera` in `camera.js` tips and leans the camera (skipped under `calm()`).
  `setVision`'s `from` (the eyes) delays each newly seen cell (`cell.delay`), so sight sweeps in. The haze at the explored map's edge and
  over a lower hall is `render/wisps.js`. A new fight's room rises into place (`board.rise`,
  skipped on a restored fight and under `calm()`); while it does, `liftAt` carries each tile's
  offset, so figures and overlays ride up with it. Outlines (`render/outline.js`,
  `UnitView.setOutline`) follow `board.hover` and `board.targets` from a ticker in `main.js`.
  An area spell's rune circle is `board.setRunes` (the preview) and `flashRunes` (a monster's
  cast, awaited in `animate.js`). A wounded figure stoops and sways through its `lean` group
  (`animateHurt`, from the HP its bar shows). In a dark room (`board.setDark`, `DARK_SEEN`) each
  hero gets a torch at the fight's start (`carryTorch`): those lights are made once a fight,
  never added later. Banners, cobwebs, drips and the rat out of sight are `render/life.js`,
  drawn only. A smashed prop goes through `board.smashProp` (debris), not `removeProp` alone.
  Conditions drawn on a figure are `render/auras.js`, set from `updateStatus` (a new condition
  that shows needs a kind there); a paralysed or petrified figure's pose holds (`held`, the rig's
  `held`). Idle looks and glances (`idle`, `glance`, called by `lookToward` in `animate.js`) turn
  `lean` about y. An act's light is `render/mood.js` through `stage.setMood` (colours only); a
  new room needs its act in `ACT` there. The camera's moves live in `src/camera.js`
  (`createCamera`: framing round the HUD with `hudInsets`, `keepInView` on a phone, a named
  foe's sweep `bossSweep`, the last blow's slow close-up `lastBlow` through `easeCamera`,
  `stairCamera`, the Floor peek `peekFloor`; a newer pan takes over through `panTween`), and
  they skip under `calm()`, as does `board.lairShake` in `main.js`. The red edges are `#vignette` (`data-level`).
  Clamp any `pow` in vertex or colour maths (`Math.max(0, …)`): one NaN pixel spreads over the
  whole screen through the glow's bloom.
- The title's 3D emblem (`render/titleLogo.js`, its own renderer and chunk) replaces its still
  (the same size) once the skull in `public/models/skull/` loads, and draws only while the title
  is on screen. Without WebGL, with Data Saver or on 2G its still (`boot-logo.jpg`) stays.
  Clicking the skull (or K) plays its moves in turn with `sfx.skull(move)`; a glow hints at it
  until the first click; its eyes follow the pointer (`pose.look`) and flare at the title's
  buttons (`glance`). The end banner mounts a second one that laughs at the won campaign and
  chatters after a defeat (`bannerSkull` in `main.js`). `public/boot-logo.jpg` (the boot screen,
  the run card), the app icons, `og-image.jpg` and the title and victory screenshots are stills
  of it: `npm run stills` re-renders them. The skull is `skull.glb` (from its OBJ scan by
  `scripts/skull-glb.mjs`), and the figures wait for it, up to 6 s, on the title.
- Production builds register `public/sw.js` (`src/offline.js`), an offline copy: pages from the
  network first (4 s), hashed `assets/` from the cache, everything else from the cache and
  refreshed behind it. The page posts the files it loaded before the worker ran; the worker
  saves the Latin font files from the saved Google Fonts stylesheet itself. Change `CACHE` in
  `sw.js` to drop every saved file. When the page has sent everything, the worker answers and
  the title's foot says it's saved (`ui/appStatus.js`, with the install tip, the no-signal line
  and a new deploy found by fetching the page with `no-store`, which the worker passes by).
  The dev server never registers it, so that line never shows there; test it on
  `npm run preview` in a throwaway headless Chrome, not the browser pane's profile.
- Play stats (`src/stats.js`): Umami Cloud, loaded by `boot.js` after the page has loaded,
  only on fatihsenel.github.io, with the `stats` setting on and no Do Not Track. Events go
  through `track()`: `settleFight` (real runs, dailies and links, not `?level=` fights),
  `startCampaign`, Continue, New Game+, dailies, the stops, replays, challenges and sharing, a fight
  left on `pagehide` (`leftEvent`), and crashes (`watchErrors`, from `boot.js`: type, file, line,
  column, browser, never the message; 3 a visit). Fight events carry the input used most
  (`watchInput`, `takeInput` at a fight's start and end), and `perf` goes once a visit from
  `stage.perf` (frames drawn back to back while moving). On the dev server they're logged
  as `[stats]` in the console instead. A new event goes there, with no names or free text.
  Each event is also counted by day in the Worker (`sendTally` → `/event`, the `tallies` table,
  read by `/tallies` with the read key); a new event or property needs a line in `TALLY_EVENTS`
  in `worker/src/index.js`, or the Worker refuses or drops it.
  A lost run or daily also sends its record, names stripped (`withoutNames`, `sendLoss`), to the
  loss-replay Worker in `worker/` (Cloudflare, D1, deployed with `npx wrangler deploy` from there);
  `?losses` (`ui/losses.js`, loaded by `boot.js` instead of the game) lists them with a read key,
  under the week's play stats from `/tallies` (`statsHtml`) and a per-room count from the
  Worker's `/summary` (`summaryRows`). `src/tallies.js` (`readTallies`) reads the tallies for
  that page, the digest and the daily crash check (`scripts/crash-check.mjs`, `crash-check.yml`:
  yesterday's `/tallies?day=`, failing the run on any crash).
  Uploads are limited per address (`UPLOADS` in `wrangler.toml`), unpacked to check they're a lost
  fight in the room they name (`checkCode`), and capped at `DAILY_CAP` a day.
  The Worker's tests (`tests/worker.test.js`) use a fake D1.
- Input lives in `src/controls.js`: mouse, touch and the arrow-key cursor (`stepTile` in
  `input.js`), which reuses the hover tile. Enter picks a tile and Enter again acts, like a
  second tap (`enterStep`). A move click on a party member picks the free tile behind it
  (`floorBehind`). Screen readers hear log lines, turns and the cursor's tile
  through `announce()` (`ui/announce.js`), so a new spoken message goes there. 1-9 and 0
  press the action bar's first ten buttons (`pickByNumber` in `hud.js`; moves few turns need
  fold behind its More button, `RARE_ACTIONS` and `more`); R reads `surroundings()`; V (or the Floor button, shown in rooms on two floors) looks along the nearest stair
  (`otherFloor`, `peekFloor` in `camera.js`). A foe that acts out of sight leaves rings where it
  was heard (`heard` in `main.js`, `board.heard`), drawn only, never in the rules.
  The log can show one figure's lines (`filterLog`: double-click, F or a long press on a name);
  rounds and turns fold through `fold`, so a filtered log refolds them once it's cleared.
  What the hovered tile would do (path, odds, blast, the hint) is drawn by `refresh` in `preview.js`.
  A gamepad (`gamepad.js`, polled on a 16 ms timer while one is connected) presses those same
  keys on the board (A is Enter, after an arrow puts the cursor out), and outside a fight moves
  focus to the nearest control in a direction (`nearest`, inside `layer()`: an open overlay, the
  settings, the banner, the title or the camp). A new key shortcut that a pad should reach needs a
  button in `press`; `body.pad` shows the pad's help and focus rings, and the hint says A.
- Speech bubbles: `speech.js` has the lines and picks the moment (`attackMoment`: a kill, a
  crit, a hero's first blow, a monster now and then; `spellMoment`: a big spell, a heal on a
  friend, a monster's spell; `downSpeaker` when a hero falls; `thanks` from `rises`, `intro`
  when the ticker in `main.js` first sees a named foe; `hurt` under a quarter HP in
  `damageReaction`; `flee` for a turned monster's move; `replySpeaker`, a minion answering a
  named foe; `lastWordsSpeaker` from `checkGameOver`) with `Math.random`, never the fight's
  dice; `banter` gives `leaveRoom` two heroes' camp talk (`report.banter`), and a monster's
  line is kept for the bestiary (`hear`, `crypt-skirmish:heard`); `quip` in `animate.js` shows them through
  `render/speechBubble.js` (one at a time, inside the speaker's label, the `bubbles` setting;
  its styles are `speechBubble.css`, loaded with the game to keep them off the title's budget).
  A new talking monster or class needs its lines in `speech.js`.
- Photo mode (`src/photo.js`, P or the camera button) hides the HUD and the board's highlights,
  centres the view on the current figure and lets the camera turn; Blur (B) is a depth of field
  focused on the camera's target (`stage.setEffects({ blur })`); Save image renders a frame
  through `stage.render()` and reads the canvas back. Monster turns wait for it (`whileAway`), and leaving restores the camera
  and frustum exactly.
- `src/ui/` is plain HTML overlays. Styles are in `src/styles/` (one file per part of the screen, imported in cascade order by
  `src/style.css`), markup in `index.html`.
  The camp redraws itself on every change; `show` in `camp.js` puts focus back on the same
  control (`focusKey`), and `arrive` focuses the way on and announces the room's results.
  A short note on a small label is `data-hint="…"`, never `title=`: `ui/hints.js` shows it
  as a card on hover, focus or a tap, and gives it to screen readers (a control's
  `aria-description`, else hidden text in a `.hint-read` span). The Text size setting is CSS `zoom` on the panels
  (`data-text` on `<html>`), so cards placed by script divide by the element's zoom; the
  board's labels scale their type by `--t` instead, since zoom would move them. Copying text
  goes through `copyText` (`ui/copyBox.js`), which falls back to a panel with it selected.
- Settings and progress live in localStorage under `crypt-skirmish:*` keys (`settings`,
  `threats`, `tips`, `history`, `achievements`, `daily`, `weekly`, `best-fights`, `bestiary`, `bestiary-read`, `slain`, `elites-slain`, `hurt`, `heard`, `last-fight`, `won-run`, `deepest`, `skull-poked`, `install-tip`, `loss-key`, `endless`, `endless-best`, …).

## Adding content

- **Monster:** stat block in `game/units.js` (a free letter: the map reads every letter as a
  unit, and `m` is the mimic), model in `render/modelSpecs.js` (and a fallback builder in
  `render/models.js`), an icon in `ui/icons.js`, lore in `ui/bestiary.js` (its count is in
  the `scholar` achievement), a sound alias in `audio/sfx.js`, and lines in `speech.js` if it
  talks. Monster abilities are template fields that `combat.js` reads (`rider`, `charge`, `lurks`,
  `recklessBrute`, `rises`), never changes to `ai.js`.
- **Condition:** add it to `CONDITIONS` in `combat.js` and a line in `attackMods`. Monsters
  apply it through an attack `rider` or a spell's `condition`.
- **Elite trait:** `ELITE_TRAITS` and `makeElite` in `combat.js`; the bestiary lists them.
- **Room:** a map in `LEVELS` (`game/maps.js`) and a node in `NODES` (`game/campaign.js`).
  For the daily and weekly to draw it, add it to a new room list from a date on (like
  `TWO_FLOORS_DAILY_FROM` in `daily.js`, its weekly list filtered by `TOO_HARD`), so past days keep their room.
  Map symbols are listed in `Grid` (`game/grid.js`): `'~'` shallow water (double cost, through
  `moveCost`; a room without water or ice keeps the plain paths, so its old saves still
  replay), `'*'` a brazier (the `brazier` command, `tipBrazier`; its coals are `this.fire`, a
  `burn` move step), `'!'` a lever and `':'` a portcullis (the `lever` command, `pullLever`; down,
  `grid.gates` are solid but see-through), `'_'` a chasm (`grid.chasms`: solid for everyone,
  fliers too, but see-through and no cover), `'['` a stair down and `']'` a stair up (a room on
  two floors: the n-th `[` is linked to the n-th `]` in `grid.links`, one step apart through
  `neighbors`, so paths, the AI and sound use them; `','` cracked floor (`grid.cracks`, plain floor
  unless the room has `below`, the `[dx, dz]` to the tile under it); `grid.lower` is the lower hall, drawn shaded;
  a `stairs` move step, `takeStairs` in `unitView.js` walking each flight the board drew (`flightAt`); a hero standing on a stair sees from its
  other end too, in `updateVision`, but rules' sight is unchanged). Keep a wall two tiles thick between the
  floors, and the stairs against a far (`-x` or `-z`) wall so the camera sees them. Adding any of these to an existing room changes its
  paths or dice, so its old saves and links fall back. The last room has `final` and an
  `outro`; an earlier act's boss has `actBreak`, and a save that finished at it before the
  next act existed is reopened by `parseSave`.
- **Relic:** `RELICS` in `game/items.js` (its `boss` is the room that drops it) and its rule in
  `Game` (`this.relics`) or `completeFight`. Relics ride in the fight record and links (`rl`).
- **Endless Crypt:** `game/endless.js`. A floor is the room id `deep:<seed>:<floor>` (and
  `:<gen>` from generation 2), rebuilt by `makeFloor` (`levelOf(id)` finds any room, campaign or
  floor; use it, not `levelById(NODES[id].level)`, where a fight's room is looked up). The dive is
  a campaign state with `endless: { seed, floor, rested, gen }`, saved under
  `crypt-skirmish:endless` (`writeSave` picks the key); `afterFloor` follows `completeFight`. A
  dive keeps the `gen` it began with (none means 1), so new monsters go in a new generation's
  pool (`GEN`, `POOL_TWO`, `BOSSES_TWO`). Generation 3 cuts chasms with their own dice
  (`crng`), so a gen-3 floor without one is its gen-2 floor; generation 4 sinks the exit's
  chamber below a stair (`sinkEnd`, its own dice too; a one-tile wall is enough there); generation 5
  turns a monster into an ochre jelly now and then (`oozeIn`, its own dice), generation 6 into a
  gelatinous cube (`cubeIn`), generation 7 a skeleton into a zombie and a rat into a swarm
  (`restlessIn`), generation 8 a skeleton into a cult fanatic (`cultIn`), and generation 9 rats into kobolds,
  the orc into a hobgoblin and a ghoul into a shadow in a dark chamber (`rankIn`); changing `makeFloor`, `POOL` or `floorBudget` itself
  changes every floor, and a saved mid-floor fight falls back to camp.
  `npm run sim -- 100 endless` checks its balance.
- **Gold and the pedlar:** `game/shop.js` (`goldFor` in `completeFight`, `canTrade`, `stock`,
  `PRICES`); `ui/shop.js` is the panel, opened from camp through `onTrade`. A new item for sale
  needs a price in `PRICES` and a place in `STOCK`. Supplies (`kind: 'supply'` in `ITEMS`, its
  `carry` the hero field) are always in stock and go to whoever carries fewest.
- **Stop with no fight:** a node of `kind: 'event'` in `NODES`, its words and options in
  `EVENTS`, and its rule in `takeEvent` and `eventProblem` (`game/campaign.js`); the camp
  draws its options as buttons (`data-enter="altar:offer"`) and `EVENT_NEWS` in `camp.js` says
  what happened. Lasting effects ride with the party (potions, the pack, a `boon` item), so
  fight records need nothing new.
- **Ability increases:** a `PROGRESSION` level with `stats` is an Ability Score Improvement
  the player may swap (`picks` in the party record, `{ 4: 'con' }`; none means the class's own,
  so old records build the same heroes). What follows from an ability (CON's hit points per
  level, DEX's AC in light armour, a bard's inspiration from CHA) is worked out in `raise` and
  `applyLevel`, never written into `PROGRESSION`. The camp offers them (`openPicks`,
  `pickOptions`, `choosePick`), and `enterRoom` settles open ones (`settlePicks`).
- **Class:** `CLASS_CHOICES` and `PROGRESSION` in `units.js`, a model spec, and a policy in
  `scripts/sim.js` if the AI wouldn't use its abilities, its lines in `speech.js`, an icon, a voice
  (`audio/voices.js`), a `CLASS_BLURB` in `ui/camp.js` and a URL flag in `main.js`. A daily or
  weekly may only pick it from a date on (`THIRD_FROM` in `daily.js` and `weekly.js`), so
  earlier days stay the same. A per-turn toggle (Reckless Attack, Quickened Spell, Stunning
  Strike) is an `ACTIONS` entry with `time: 'free'` through the `action` command; bonus attacks
  after the Attack action go through `bonusStrike` in `combat.js`.
- **Spell or action:** it needs a case in `playSpell` or `playAction` in `animate.js`;
  `tests/animate.test.js` fails until it has one.
- Rules that differ from the SRD go in the README's House rules section.

## Testing in the browser

- `?level=N` jumps into a room with a fresh party and never touches the save. Add
  `&party=5`, `&difficulty=hard|story`, `&tier=N` (New Game+; elites from 2), `&relics=veil,horn`, `&paladin`, `&ranger`, `&warlock`, `&bard`, `&barbarian`, `&sorcerer`, `&monk`, `&druid`,
  `&seed=S` (the same dice every time; `SEED=S npm run touch-check` uses it).
- `?losses` lists real players' lost fights (needs the Worker's read key, kept under
  `crypt-skirmish:loss-key`).
- `?victory` shows the won-campaign screen for a sample run (Copy result, Save image);
  `&tier=2` makes it a New Game+ run with elites slain.
- `#watch=…` (from Copy replay link) opens a fight's replay, with Play it yourself on its bar.
- `#play=…` (from Copy challenge link) opens the same fight to play, from the same dice.
- `window.__debug` in the console (set up in `debug.js`): `command({type:'move', x, z})`,
  `command({type:'attack', target, attack})`, `autoplay()`, `win()`, `lose()`, `reveal()` (no fog until the next fight), `board()` (the Board, e.g. `board().rise(at)`),
  `level(n)` (or a room id, an Endless floor too: `level('deep:3:4:3')`), `focus(x, z)`, `tileToScreen(x, z)`, `pickAt(x, y)` (the tile a tap there picks), `threats()`, `heard()` (the rings' tiles).
- Monster turns wait while the page is hidden (`whileAway` in `main.js`): script fights in a
  showing tab or headless Chrome, or they stall.
- Back up the `crypt-skirmish:*` localStorage keys before a scripted test and restore them
  afterwards. The browser pane is the user's real profile.
- Check phones too: 375×812 and 812×375. Touch shows its own controls (tap to preview, tap
  again to act).

## Conventions

- Commit and push only when asked. Commit messages are a short imperative summary, like
  "Add an enemy reach overlay".
- Keep the README up to date when a feature, control or file changes, in the same short
  style.
- Model packs are CC0 (KayKit, Quaternius). Use only SRD 5.1 names, no Wizards of the Coast
  trademarks.
