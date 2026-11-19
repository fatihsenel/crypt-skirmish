# Elite Monsters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From NG+2, each room's strongest monster is an elite with one of five traits.

**Architecture:** `runDifficulty` passes `elite: tier` to `Game`; `Game` picks and applies the
elite in its constructor (rules only, no dice). The renderer, unit card, log and bestiary show it.

**Tech Stack:** Vite, three.js, Vitest.

**Spec:** docs/superpowers/specs/2026-11-19-elite-monsters-design.md

## Global Constraints
- `src/game/` stays pure rules: no three.js, no DOM. No `Math.random`; the elite pick uses no dice.
- Monster AI (`ai.js`) does not change.
- Tiers 0 and 1, daily runs and plain `?level=N` have no elites.
- SRD 5.1 names only; README House rules gets a line on elites.

## Review Focus
- A room whose top-XP monster starts asleep or hidden: it is still the elite (asleep monsters are alive).
- A mimic or risen dead added mid-fight never becomes an elite (only units from the constructor).
- Relentless and a cleric's Death Ward on the same unit can't both exist (monsters have no Death Ward), but the `ward` log must name Relentless for an elite.
- Regenerating doesn't heal while `rotting` (goes through `heal`, which already refuses).
- A replay/save of an NG+2 fight replays the same elite (deterministic from level and tier).

---

### Task 1: Elite rules

**Files:**
- Modify: `src/game/campaign.js` (`runDifficulty`), `src/game/combat.js` (constructor, `beginTurn`, `applyDamage`'s ward emit)
- Test: `tests/elites.test.js`

**Interfaces:**
- Produces: `ELITE_TRAITS` (exported from `combat.js`): `[{ id: 'regenerating', name: 'Regenerating', desc }, relentless, frenzied, swift, warded]`, in that order.
- Produces: `eliteTrait(levelId: string, tier: number) -> trait` (exported): `ELITE_TRAITS[(tier + sum of levelId char codes) % 5]`.
- Produces: on the elite unit `u.elite = trait.id`; `game.emit('regen', { unit, amount })`; `ward` event gains `relentless: true` for an elite.
- Produces: `runDifficulty(d, tier)` includes `elite: tier` when tier ≥ 2.

- [ ] **Step 1: Write the failing tests** in `tests/elites.test.js`:
  - `runDifficulty('normal', 1).elite` is undefined; `runDifficulty('normal', 2).elite === 2`.
  - In a room at tier 2, exactly one monster has `elite`, and it has the highest `xp` among `team === 'monsters'` (first in `game.units` on ties); at tier 1, none.
  - Same level and tier → same elite unit index and trait in two new Games with different seeds.
  - Each trait, forced by building a Game and calling `game.makeElite(unit, id)`: swift adds 2 to `speed`; frenzied makes `multiattack` one more than before (1 → 2); warded adds 2 to `acOf` and `immune` contains frightened, prone, poisoned; relentless sets `deathWard`.
  - Regenerating: hurt the elite by 8, call `beginTurn` with it current (set `game.turn` to its order index), hp went up by 5 (not over max) and a `regen` event fired; at 0 HP it doesn't regenerate.
  - Relentless: `applyDamage(elite, 999)` leaves it alive on 1 HP and the `ward` event has `relentless: true`.
- [ ] **Step 2:** `npx vitest run tests/elites.test.js` → FAIL (`makeElite` / `ELITE_TRAITS` missing).
- [ ] **Step 3:** Implement. `makeElite(u, id)` applies the trait and sets `u.elite`; the constructor calls it once after `toughen`, for the top-XP monster, when `difficulty?.elite >= 2`. Level id is `level.id`.
- [ ] **Step 4:** `npm test` → all pass.

### Task 2: Show it

**Files:**
- Modify: `src/render/unitView.js` (gold ring on the base when `unit.elite`), `src/ui/unitCard.js` (a trait line "Elite · Regenerating: …"), `src/ui/hud.js` (`logRegen`, `logWard` names Relentless), `src/main.js` (`regen` handler: log, float "+5", `updateStatus`; a start-of-fight log line naming the elite), `src/ui/bestiary.js` + `index.html` (an Elites section listing the five traits).
- [ ] Check in the browser at `?level=3&tier=2` and phone sizes.

### Task 3: Tune and document
- [ ] `TIER=n npm run sim -- 300` for n = 2..6 (under `bash -c`); compare with 56/40/29/21/16%. If any tier drops by more than a third, ease `TIER_HP` and rerun; report the numbers.
- [ ] README: New Game+ paragraph, House rules line; CLAUDE.md if test routes change. Note in the reply that NG+2+ saves and links stop working.
