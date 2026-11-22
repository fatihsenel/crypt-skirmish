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
  (`later`); a press before then waits for it. The dungeon tiles load behind the title, and
  `newGame` and `startReplay` wait for them (`kit` in `main.js`). A finished fight is settled in
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
  range (`longReach`) and creatures giving cover.
- `src/render/` is three.js only. Animations use `tween`/`wait` from `render/tween.js`, so
  they follow the monster-turn speed setting (`playback.rate`). `calm()` there is reduced
  motion (the Motion setting, or the system's on System; `data-motion` on `<html>` for CSS):
  no shake, no camera pans, no drifting text, and a still title logo.
  The 3D view draws every frame only while something moves (`animating()` in `tween.js`:
  tweens, waits, input), else about 15 a second (`stage.js`). Anything else that moves the
  scene for a while (a camera glide, a clip, fog) calls `keepAwake(ms)`, or it will stutter.
  Shadows are redrawn on those frames and every 4th idle one (`shadowMap.autoUpdate` is off).
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
  fold behind its More button, `RARE_ACTIONS` and `more`); R reads `surroundings()`.
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
  centres the view on the current figure and lets the camera turn; Save image renders a frame and
  reads the canvas back. Monster turns wait for it (`whileAway`), and leaving restores the camera
  and frustum exactly.
- `src/ui/` is plain HTML overlays. Styles are in `src/style.css`, markup in `index.html`.
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

- **Monster:** stat block in `game/units.js`, model in `render/modelSpecs.js` (or a
  procedural builder in `render/models.js`), an icon in `ui/icons.js`, and lines in
  `speech.js` if it talks.
- **Condition:** add it to `CONDITIONS` in `combat.js` and a line in `attackMods`. Monsters
  apply it through an attack `rider` or a spell's `condition`.
- **Elite trait:** `ELITE_TRAITS` and `makeElite` in `combat.js`; the bestiary lists them.
- **Room:** a map in `LEVELS` (`game/maps.js`) and a node in `NODES` (`game/campaign.js`).
  Map symbols are listed in `Grid` (`game/grid.js`): `'~'` shallow water (double cost, through
  `moveCost`; a room without water or ice keeps the plain paths, so its old saves still
  replay), `'*'` a brazier (the `brazier` command, `tipBrazier`; its coals are `this.fire`, a
  `burn` move step), `'!'` a lever and `':'` a portcullis (the `lever` command, `pullLever`; down,
  `grid.gates` are solid but see-through). Adding any of these to an existing room changes its
  paths or dice, so its old saves and links fall back.
- **Relic:** `RELICS` in `game/items.js` (its `boss` is the room that drops it) and its rule in
  `Game` (`this.relics`) or `completeFight`. Relics ride in the fight record and links (`rl`).
- **Endless Crypt:** `game/endless.js`. A floor is the room id `deep:<seed>:<floor>`, rebuilt
  by `makeFloor` (`levelOf(id)` finds any room, campaign or floor; use it, not
  `levelById(NODES[id].level)`, where a fight's room is looked up). The dive is a campaign state
  with `endless: { seed, floor, rested }`, saved under `crypt-skirmish:endless` (`writeSave`
  picks the key); `afterFloor` follows `completeFight`. Changing `makeFloor`, `POOL` or
  `floorBudget` changes every floor, so a saved mid-floor fight falls back to camp.
  `npm run sim -- 100 endless` checks its balance.
- **Gold and the pedlar:** `game/shop.js` (`goldFor` in `completeFight`, `canTrade`, `stock`,
  `PRICES`); `ui/shop.js` is the panel, opened from camp through `onTrade`. A new item for sale
  needs a price in `PRICES` and a place in `STOCK`.
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
  `scripts/sim.js` if the AI wouldn't use its abilities, and its lines in `speech.js`.
- **Spell or action:** it needs a case in `playSpell` or `playAction` in `animate.js`;
  `tests/animate.test.js` fails until it has one.
- Rules that differ from the SRD go in the README's House rules section.

## Testing in the browser

- `?level=N` jumps into a room with a fresh party and never touches the save. Add
  `&party=5`, `&difficulty=hard|story`, `&tier=N` (New Game+; elites from 2), `&relics=veil,horn`, `&paladin`, `&ranger`, `&warlock`, `&bard`,
  `&seed=S` (the same dice every time; `SEED=S npm run touch-check` uses it).
- `?losses` lists real players' lost fights (needs the Worker's read key, kept under
  `crypt-skirmish:loss-key`).
- `?victory` shows the won-campaign screen for a sample run (Copy result, Save image);
  `&tier=2` makes it a New Game+ run with elites slain.
- `#watch=…` (from Copy replay link) opens a fight's replay, with Play it yourself on its bar.
- `#play=…` (from Copy challenge link) opens the same fight to play, from the same dice.
- `window.__debug` in the console (set up in `debug.js`): `command({type:'move', x, z})`,
  `command({type:'attack', target, attack})`, `autoplay()`, `win()`, `lose()`,
  `level(n)`, `focus(x, z)`, `tileToScreen(x, z)`, `pickAt(x, y)` (the tile a tap there picks), `threats()`.
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
