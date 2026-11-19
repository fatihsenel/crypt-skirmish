# Elite monsters in New Game+

## Why
New Game+ only scales numbers (more HP, +1 to hit and damage). From NG+2 each room's
strongest monster becomes an elite with a trait, so deeper runs play differently.

## Approaches
- **A fixed pick (chosen):** the room's strongest monster, with the trait rotating by tier and
  room. Uses no dice, so the dice order is unchanged, and players can learn it.
- A random pick from the fight's dice: more variety, but each retry would change the elite
  and it would shift the dice order.
- New elite stat blocks per monster: much more content and balance work.

## Design
- **When:** `runDifficulty(d, tier)` adds `elite: tier` when tier ≥ 2. Tiers 0 and 1, daily
  crypts and `?level=N` without `&tier=2+` have no elites.
- **Who:** the living monster with the most XP when the fight starts; ties go to the first in
  the room's spawn order. One per room. Monsters added mid-fight (risen dead, a mimic) never
  become elites.
- **Which trait:** `ELITE_TRAITS[(tier + roomHash) % 5]`, where roomHash is the sum of the
  level id's character codes. The five traits:
  - **Regenerating:** regains 5 HP at the start of each of its turns while alive (emits `regen`).
  - **Relentless:** the first time it would drop to 0 HP it stays on 1 (reuses Death Ward's
    `deathWard` flag; the `ward` event says which).
  - **Frenzied:** one more attack in each Attack action (`multiattack` + 1).
  - **Swift:** +10 ft speed (+2 tiles).
  - **Warded:** +2 AC; immune to frightened, prone and poisoned.
- **Shown:** a gold ring on the figure's base, "Elite · Trait" on the unit card (fight and
  tooltip), a log line when the fight starts, and an Elites section in the bestiary.
- **Not changed:** the monster AI, the dice order, tiers 0–1, daily runs.
- **Breaks:** saves and links of fights at NG+2 and deeper (they play out differently).

## Checks
- Tests: the pick (most XP, ties, none below NG+2), each trait's effect, regeneration and
  Relentless in a fight.
- `npm run sim` at NG+2 to NG+6; if win rates fall too far, ease `TIER_HP` and report.

## Left to the builder (my calls)
- Names avoid any trademarked terms; "Relentless" and "Regenerating" are plain words.
- The ring's exact look and the bestiary section's wording.
