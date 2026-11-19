# New Game+ (Heirlooms) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a won campaign, start a New Game+ at level 1 with the same heroes, one kept magic item each, and monsters scaled by a tier that rises with each win.

**Architecture:** The tier is a number on the campaign state. `runDifficulty(difficulty, tier)` turns it into the `{ hp, bonus, thin }` object `Game` already takes, so the rules engine doesn't change. Fight records and links carry `tier` so replays rebuild the same scaling.

**Tech Stack:** Vite, three.js, Vitest, plain HTML overlays.

**Spec:** `docs/superpowers/specs/2026-11-19-new-game-plus-design.md`

## Global Constraints

- Per tier: monster HP ×(1 + 0.15 × tier), and +tier to weapon hit and damage, on top of the difficulty.
- Label: "Hard NG+2"; plain "Hard" at tier 0.
- A save, record or Past run without `tier` counts as tier 0.
- `LINK_VERSION` becomes 2. Version-1 links get the existing "another version" toast.
- The tier doesn't apply to dailies or monster AI, and doesn't change the dice order.
- Commit only when the user asks (project rule). The commit steps below are checkpoints to report, not to run.
- `npm test` must pass. `npm run build` must succeed.
- The README and CLAUDE.md are updated in their short style.

## Review Focus

1. **A won hero who fell in the last room:** the hero is dead in the state, but New Game+ still brings them back at full HP with their kept item. *Test in Task 2.*
2. **A hero whose only item can't be equipped by their class:** the item isn't offered, and the run still starts. *Test in Task 2.*
3. **Replaying a Past-runs fight saved before this change** (no `tier`): it plays at tier 0 and replays true. *Test in Task 3.*
4. **A tampered link tier** (`t: -1`, `t: 1.5`, `t: 1000`): rejected by `unpack`. *Test in Task 3.*
5. **Reloading the page mid-run at NG+1:** the resumed fight uses the same scaling, so the saved fight replays. This is covered by `parseSave` keeping `tier` (Task 1) and `startFight` reading `campaign.tier` (Task 4). *Check in the browser in Task 4.*

---

### Task 1: Tier on the campaign

**Files:**
- Modify: `src/game/campaign.js`, at DIFFICULTIES (~20), runSummary (~203), newCampaign (~232), parseSave (~451) and runShareText (~488)
- Test: `tests/rules.test.js`, or a new `tests/newGamePlus.test.js` (preferred)

**Interfaces:**
- Produces:
  - `runDifficulty(difficulty: string, tier = 0) -> { name, hp, bonus, thin?, desc }`
  - `difficultyLabel(difficulty: string, tier = 0) -> string`
  - `state.tier: number`
  - `runSummary(state).difficulty` is the tier label

- [ ] **Step 1: Write the failing tests**
  ```js
  expect(runDifficulty('hard', 2)).toMatchObject({ hp: 1.2 * 1.3, bonus: 3, thin: true });
  expect(runDifficulty('normal', 0)).toEqual(DIFFICULTIES.normal);
  expect(runDifficulty('nope', 1).bonus).toBe(1);                 // unknown → normal
  expect(difficultyLabel('hard', 2)).toBe('Hard NG+2');
  expect(difficultyLabel('story', 0)).toBe('Story');
  expect(newCampaign('normal').tier).toBe(0);
  const s = newCampaign('hard'); delete s.tier;
  expect(parseSave(serialize(s)).tier).toBe(0);
  expect(parseSave(serialize({ ...s, tier: -3 })).tier).toBe(0); // must be an integer ≥ 0
  expect(runSummary({ ...newCampaign('hard'), tier: 1 }).difficulty).toBe('Hard NG+1');
  ```
- [ ] **Step 2:** Run `npx vitest run tests/newGamePlus.test.js`. Expected: FAIL (`runDifficulty` not exported).
- [ ] **Step 3: Implement.**
  - `runDifficulty` copies the base difficulty, then overrides `hp` and `bonus`.
  - `newCampaign` adds `tier: 0`.
  - `parseSave` clamps `tier` to an integer ≥ 0, else 0.
  - `runSummary` uses `difficultyLabel`, so the share text and run card pick it up.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.

### Task 2: Starting New Game+

**Files:**
- Modify: `src/game/campaign.js`
- Test: `tests/newGamePlus.test.js`

**Interfaces:**
- Consumes: `newCampaign`, `equip`, `equipProblem` from Task 1's file
- Produces:
  - `heirloomChoices(won) -> { [code]: string[] }`: each hero's equipped item ids that `equipProblem` allows on a fresh level-1 hero of that class.
  - `newGamePlus(won, keep: { [code]: string | null }) -> state`: a new campaign with the same difficulty, names and classes, `tier: (won.tier ?? 0) + 1`, and each kept item equipped. Ids not in `heirloomChoices` are ignored. HP is full after equipping.

- [ ] **Step 1: Write the failing tests**
  - Build a won state from `newCampaign('hard', { F: 'Tamsin' }, { F: 'P' })` with:
    - `F.items = ['ringProtection']` and `F.alive = false`
    - `W.items = []`
    - `level: 8`, `tier: 1`
  - Expect `newGamePlus(won, { F: 'ringProtection', W: 'nonsense' })` to give:
    - `tier` 2, `difficulty` 'hard'
    - `F`: `cls` 'P', `name` 'Tamsin', `level` 1, `alive` true, `items` ['ringProtection'], `hp` equal to `heroUnit('F', F).maxHp`
    - `W.items` []
    - `pack` [], `cleared` [], `xp` 0
  - Expect `heirloomChoices(won).W` to equal `[]`.
- [ ] **Step 2:** Run the test. Expected: FAIL.
- [ ] **Step 3: Implement.** Push each kept id into `state.pack`, `equip` it, then set `hp` to the hero's `maxHp`.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.

### Task 3: Tier in records, Past runs and links

**Files:**
- Modify:
  - `src/game/history.js`: `watchable`, `runRecord`
  - `src/game/fightLink.js`: `LINK_VERSION`, `pack`, `unpack`, `replaysTrue`
  - `scripts/sim.js:203`, plus a `--tier N` argument
- Test: `tests/fightLink.test.js`, `tests/history.test.js`

**Interfaces:**
- Consumes: `runDifficulty` (Task 1)
- Produces:
  - Fight records have `tier: number`.
  - `runRecord(...).difficulty` is the tier label (it comes through `runSummary`).
  - Links pack `t`.

- [ ] **Step 1: Write the failing tests**
  - In `fightLink.test.js`, `playFight` takes a `tier` and builds `Game` with `runDifficulty('normal', tier)`.
  - Play a tier-1 fight, then expect:
    - `await decodeFight(await encodeFight(f1))` equals `f1`
    - `replaysTrue(f1)` is true
    - `replaysTrue({ ...f1, tier: 0 })` is false
  - Expect `unpack` with `t: -1`, `t: 1.5` or `t: 1000` to be null. `t` must be an integer from 0 to 99, and missing means 0.
  - Expect `unpack({ ...o, v: 1 })` to be null.
  - In `history.test.js`, expect `watchable` to:
    - keep `tier: 2`
    - default a missing `tier` to 0
    - drop a non-integer tier to 0
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `replaysTrue` uses `runDifficulty(f.difficulty, f.tier ?? 0)`.
  - `sim.js` uses `runDifficulty(campaign.difficulty, tier)`.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5:** Run `npm run sim -- 300`, then `npm run sim -- 300 --tier 1` and `--tier 2`. Note the win rates for the report. The win rate should fall with the tier.

### Task 4: The game wiring and the picker

**Files:**
- Modify:
  - `src/main.js`:
    - `startFight` ~489: `const tier = watch?.tier ?? campaign.tier ?? 0`; the Game gets `runDifficulty(difficulty, tier)`; `record` gets `tier`.
    - Dailies pass tier 0.
    - The `?level` route reads `&tier=N`.
    - `onRestart` after the final room.
    - New `onNewGamePlus(keep)`: `campaign = newGamePlus(campaign, keep)`, `writeSave`, open the camp map, the same way `startCampaign` does.
  - `src/ui/hud.js` `banner`: when `final && summary`, show a `#ngplus` button "New Game+".
  - `src/ui/camp.js`:
    - The title's saved-run line and the camp header use `difficultyLabel(s.difficulty, s.tier)`.
  - `index.html`, `src/style.css`: the picker overlay `#heirlooms`.
    - One row per hero: name, class, and radio buttons for each item from `heirloomChoices`. The first item is preselected. A "Nothing" radio button shows only when the hero has no items.
    - A "Go back down (NG+N)" button and a "Cancel" button.
    - On the `?victory` sample (no real campaign), the New Game+ button is hidden.
- Test: in the browser, following CLAUDE.md's testing section.

- [ ] **Step 1:** Wire the code above. Run `npm test` and `npm run build`. Expected: both pass.
- [ ] **Step 2: Browser check** on 5173.
  1. Back up the storage.
  2. Start the campaign at `?level=<final room>&party=8`. Win with `__debug.win()`.
  3. Click New Game+ and pick the items. Expect:
     - The camp header shows "Normal NG+1".
     - The heroes are level 1 with the kept items.
  4. Enter the Crypt and compare a skeleton's maxHp with `?level=1`: it is about ×1.15.
  5. Reload mid-fight. Expect it to resume and not fall back to camp (Review Focus 5).
  6. Win the room, then use Watch replay and Copy replay link. Expect the link to replay true.
  7. Restore the storage.
- [ ] **Step 3:** Check the picker at 375×812 and 812×375, then reset the window to desktop.

### Task 5: Docs

**Files:** `README.md`, `CLAUDE.md`

- [ ] **Step 1: README**
  - Add a New Game+ paragraph to the campaign section: what is kept, and that the tier stacks.
  - Add a House rules line: "New Game+: each tier adds 15% monster HP and +1 to monster weapon hit and damage."
- [ ] **Step 2: CLAUDE.md:** add `&tier=N` to the `?level=N` test route.
- [ ] **Step 3:** Run `npm test` and `npm run build`. Check that `git status --short .claude dist` is empty. Report, and don't commit until asked.
