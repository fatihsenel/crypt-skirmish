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
npm run touch-check    # phone taps in headless Chrome (dev server on 5173), after changing input;
                       # the deploy runs it against the build on seeds 3, 1 and 5, and
                       # SEED=3 LATE=700 (a late lift must still be a tap)
npm run build          # production bundle (base path /crypt-skirmish/ in vite.config.js)
```

The `dnd-dev` entry in `.claude/launch.json` uses port 5179. Don't use it: run the dev
server on 5173.

## Architecture

- **`src/game/` is pure rules:** no three.js, no DOM. It is unit-tested in `tests/` and run
  headlessly by `scripts/sim.js`. Keep it that way.
- The title shows as soon as the code is in; the dungeon tiles load behind it, and `newGame`
  and `startReplay` wait for them (`kit` in `main.js`). A finished fight is settled in
  `fightEnd.js` (`settleFight`): records, achievements, dailies and the banner's facts.
- The rules engine (`Game` in `combat.js`, built on `Spellcasting` in `spells.js`) resolves
  everything instantly and emits events (`attack`, `move`, `spell`, `death`, …). `move()` returns steps. `src/main.js` turns them
  into HUD updates, and `src/animate.js` into animations and sound.
- **Randomness in rules goes through `this.rng`** (or a passed-in `rng`), never
  `Math.random`. Fights are saved as a seed plus the heroes' commands and replayed on load
  (`replay.js`). Anything that changes the dice order makes old saves fall back to camp.
  The end banner's Watch replay plays the same record back (`startReplay` in `main.js`), and
  Past runs keep each run's last one (`history.js`). `#watch=` links carry the same record
  (`fightLink.js`, copied and opened by `links.js`) and are replayed headlessly first, so a rules change refuses old links.
- `src/render/` is three.js only. Animations use `tween`/`wait` from `render/tween.js`, so
  they follow the monster-turn speed setting (`playback.rate`). `calm()` there is reduced
  motion (the Motion setting, or the system's on System; `data-motion` on `<html>` for CSS):
  no shake, no camera pans, no drifting text, and a still title logo.
- The title's 3D emblem (`render/titleLogo.js`, its own renderer and chunk) replaces the flat
  `emblem.svg` once the skull in `public/models/skull/` loads, and draws only while the title
  is on screen. Without WebGL, with Data Saver or on 2G the flat emblem stays. Clicking the
  skull (or K) plays its moves in turn with `sfx.skull(move)`; a glow hints at it until the first
  click. The won-campaign banner mounts a second one that laughs (`victorySkull` in `main.js`).
  `public/boot-logo.jpg` (the boot screen, the run card), the app icons and `og-image.jpg` are
  stills of it: re-render them if the emblem changes.
- Input lives in `src/controls.js`: mouse, touch and the arrow-key cursor (`stepTile` in
  `input.js`), which reuses the hover tile. Enter picks a tile and Enter again acts, like a
  second tap (`enterStep`). A move click on a party member picks the free tile behind it
  (`floorBehind`). Screen readers hear log lines, turns and the cursor's tile
  through `announce()` (`ui/announce.js`), so a new spoken message goes there. 1-9 and 0
  press the action bar's first ten buttons (`pickByNumber` in `hud.js`); R reads `surroundings()`.
  What the hovered tile would do (path, odds, blast, the hint) is drawn by `refresh` in `preview.js`.
- `src/ui/` is plain HTML overlays. Styles are in `src/style.css`, markup in `index.html`.
  The camp redraws itself on every change; `show` in `camp.js` puts focus back on the same
  control (`focusKey`), and `arrive` focuses the way on and announces the room's results.
- Settings and progress live in localStorage under `crypt-skirmish:*` keys (`settings`,
  `threats`, `tips`, `history`, `achievements`, `daily`, `weekly`, `best-fights`, `bestiary`, `bestiary-read`, `slain`, `elites-slain`, `hurt`, `last-fight`, `won-run`, `deepest`, `skull-poked`, …).

## Adding content

- **Monster:** stat block in `game/units.js`, model in `render/modelSpecs.js` (or a
  procedural builder in `render/models.js`), an icon in `ui/icons.js`.
- **Condition:** add it to `CONDITIONS` in `combat.js` and a line in `attackMods`. Monsters
  apply it through an attack `rider` or a spell's `condition`.
- **Elite trait:** `ELITE_TRAITS` and `makeElite` in `combat.js`; the bestiary lists them.
- **Room:** a map in `LEVELS` (`game/maps.js`) and a node in `NODES` (`game/campaign.js`).
- **Class:** `CLASS_CHOICES` and `PROGRESSION` in `units.js`, a model spec, and a policy in
  `scripts/sim.js` if the AI wouldn't use its abilities.
- **Spell or action:** it needs a case in `playSpell` or `playAction` in `animate.js`;
  `tests/animate.test.js` fails until it has one.
- Rules that differ from the SRD go in the README's House rules section.

## Testing in the browser

- `?level=N` jumps into a room with a fresh party and never touches the save. Add
  `&party=5`, `&difficulty=hard|story`, `&tier=N` (New Game+; elites from 2), `&paladin`, `&ranger`, `&warlock`,
  `&seed=S` (the same dice every time; `SEED=S npm run touch-check` uses it).
- `?victory` shows the won-campaign screen for a sample run (Copy result, Save image);
  `&tier=2` makes it a New Game+ run with elites slain.
- `#watch=…` (from Copy replay link) opens a fight's replay, with Play it yourself on its bar.
- `#play=…` (from Copy challenge link) opens the same fight to play, from the same dice.
- `window.__debug` in the console (set up in `debug.js`): `command({type:'move', x, z})`,
  `command({type:'attack', target, attack})`, `autoplay()`, `win()`, `lose()`,
  `level(n)`, `focus(x, z)`, `tileToScreen(x, z)`, `pickAt(x, y)` (the tile a tap there picks), `threats()`.
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
