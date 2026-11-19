# New Game+ (Heirlooms)

## Why
A reason to play again after winning the campaign. You go back down with the same party
and one trophy each, and the crypt is harder each time you clear it.

## Approaches
- **Heirlooms (picked):** a fresh run at level 1 that keeps names, classes and one magic item
  per hero. Monsters are scaled per tier. Every room's tuning stays valid, and the scaling
  reuses the lever that difficulty already pulls (`Game.toughen`).
- Keep levels and make the monsters stronger: every room would need new stat blocks to
  challenge a level-8 party. Too much content and balance work.
- New rules per tier (elites, more traps): new content for every tier. This can be added
  on top of Heirlooms later.

## Design
- **Tier:** `state.tier` is a whole number: 0 for a normal run, then 1, 2 and so on. Saves
  without it count as 0.
- **Scaling:** `runDifficulty(difficulty, tier)` in `campaign.js` returns the object that
  `Game` takes: `{ ...DIFFICULTIES[d], hp: base.hp * (1 + 0.15 * tier), bonus: base.bonus + tier }`.
  Every `new Game(...)` for a campaign fight uses it, in `main.js`, `scripts/sim.js` and
  `fightLink.replaysTrue`.
- **Starting New Game+:** a "New Game+" button on the won-campaign screen opens a picker.
  For each hero it lists the magic items that hero has equipped, and one may be kept. It
  defaults to the first item; heroes with no items keep nothing. Unequipped items in the
  pack are not offered.
- **The new run:** `newGamePlus(won, keep)` returns `newCampaign(won.difficulty, names,
  classes)` with `tier: won.tier + 1`, and each kept item equipped on its hero.
  - Kept items are equipped through `equip` rules, so an item's effect on HP or AC applies
    as it does today.
  - The difficulty stays what the won run used.
- **Where the tier shows:**
  - The label is "Hard NG+2", or just "Hard" at tier 0.
  - It shows on the title's saved-run line, the camp header, Past runs, the share text and
    the run picture ("The crypt cleared on Hard NG+2").
  - `runSummary` gives `difficulty` with the tier already in the label.
- **Fight records and links:**
  - Records (`record`, `watchable`, the last fight) carry `tier`.
  - Links pack it as `t`, and `LINK_VERSION` becomes 2, so version-1 links are refused as
    "made with another version".
  - A missing `tier` in a saved record means 0, so older Past-runs replays still work.
- **Not changed:** monster AI, the dice order, daily runs (always tier 0), and `?level=N`.
  That route may take `&tier=N` for testing.

## Tuned after the first build
- With kept items in the sim, +15% HP and +1 per tier won 58%, 20% and 2% at NG+1 to NG+3.
  Now +10% HP per tier and a flat +1 from NG+1: 68%, 56%, 40%, 29%, 21%, 16% (NG+1 to NG+6).
- The tier stops at 99; a hero may keep nothing; the deepest win is kept (`crypt-skirmish:deepest`).

## Docs
- README: New Game+ under the campaign section. A House rules line on tier scaling.
- CLAUDE.md: `&tier=N` in the test routes.

## Checks
- Tests:
  - `runDifficulty`
  - `newGamePlus`: keeps names, classes and the kept items at level 1, with the tier raised
  - Save parsing defaults the tier to 0
  - A link round-trips with a tier, and a tier-1 fight doesn't replay as tier 0
- Run `npm run sim` at tier 1 and tier 2 to see the win rate fall, and report the numbers.

## Left to the builder
- The look of the picker, following the existing camp overlays.
- Whether the label goes through one helper used in every place it shows (preferred).
