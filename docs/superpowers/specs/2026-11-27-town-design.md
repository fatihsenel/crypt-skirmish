# The village: rebuilding Hesk's town between acts

## Why

Gold has one use today, the pedlar, and runs feel alike from act to act. The village gives gold
a longer goal: each act's boss cleared, the party can put gold into rebuilding the village above
the crypt, and what it rebuilds makes the rest of the run easier in ways the player chooses.
It also gives the cutscenes (the next project) something to show.

## Goals

- A Town panel at camp after each act's boss (sanctum, barrow, throne, tomb: four visits a run).
- Three buildings, each rebuilt in three stages with gold: the smith, the temple, the library.
- Every stage does something the player feels at camp or in the next rooms.
- Costs that force a choice: everything costs more than a run earns.

## Non-goals

- Nothing a building does reaches into a fight's rules or dice. What it gives comes as gold,
  prices, stock, HP, spell slots or potions, which already ride with the party (like the story
  scenes). Fight records, saves and links stay the same; no `RULES` bump.
- No 3D village (approach B) and no blessings in fights (approach C).
- No town in the Endless Crypt, dailies, weeklies or challenge links.
- No new stats property (`track()`).

## Anti-goals

- A must-buy stage that makes every run the same.
- A panel that hides the way on or makes camp slower to get through.

## Approaches considered

- **A. A Town panel at camp (chosen).** Next to the pedlar after each act's boss, camp-only
  effects. Smallest build, keeps saves and links safe, fits Play together's votes.
- B. A small 3D village to walk through: prettiest, several times the work, hard on phones and
  in co-op.
- C. A with blessings that carry into fights: needs a rules bump and a field in every record.

## The buildings

Stages cost **120, 220 and 340 gold** (680 a building, 2,040 for all three; a run earns about
1,500–1,700 on one path, less what the pedlar takes). A stage is bought in one step and works
from then on.

| | Stage 1 | Stage 2 | Stage 3 |
|---|---|---|---|
| **Smith** | The pedlar carries a third piece of gear | Gear sells for three quarters, not half | The next act's gear comes into stock an act early |
| **Temple** | After every room each hero gets 3 HP more back (with Hesk's 4 if he's along) | At each act's boss cleared, every hero gets a potion | After every room each caster gets one spent level-1 slot back |
| **Library** | The pedlar carries a second scroll | Scrolls cost a third less | Each hero who can read scrolls gets a free one at each act's boss cleared |

Each building has a short line of what it looks like at each stage (ruins, roofed, busy), shown
on its card, and a camp news line when a stage is bought ("The forge is lit again…").

## How it fits the code

- **State:** the campaign's `town: { smith, temple, library }` (0–3, none means 0), checked by a
  `cleanTown` in `parseSave` like `cleanGold`; a New Game+ run starts with the village in ruins.
- **Rules:** `game/town.js`, pure like `shop.js`: `TOWN` (stages, costs, words), `canBuild`
  (at an act break, campaign runs only), `buildProblem`, `build(state, id)`. The pedlar's `stock`,
  `PRICES` use and `sellPrice` read the smith and library stages; the after-room HP and slot back
  go in `completeFight` next to Hesk's; the act-break potions and scrolls in the long rest there.
- **UI:** `ui/town.js`, a panel like `ui/shop.js`, opened by a Town button beside Trade
  (`onTown`). Three cards:

  ```
  ┌ The village ───────────────────── 340 gold ┐
  │ SMITH ●●○   The forge glows again.          │
  │   Now: gear sells for ¾.                    │
  │   Next: next act's gear an act early · 340  │
  │                               [Rebuild]     │
  │ TEMPLE ●○○  …                               │
  │ LIBRARY ○○○ …                               │
  └─────────────────────────────────────────────┘
  ```

- **Play together:** rebuilding spends the party's gold, so it's a vote, like the way on
  (`coopVote`, a `town` step settled by the host's device); `CoopRun.step` applies it.
- **Docs:** README (a Town paragraph, the files), CLAUDE.md (an "Adding content" line for a
  building stage).

## Left to the builder

- The buildings' words and news lines, in the game's voice.
- Whether the Town button sits in the camp header or beside Trade, so long as the way on stays
  first.
- Tests: `town.js` rules (costs, problems, each stage's effect through `stock`, `sellPrice`,
  `completeFight`), `parseSave` of a save without `town`, and a co-op run's town vote.
