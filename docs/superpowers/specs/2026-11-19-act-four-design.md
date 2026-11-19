# Act four: the Hollow Tomb

## Why
The campaign ends at level 6, so new spells and features have no room to grow. A fourth act
gives runs a longer arc and the party levels 7 and 8. The user handed every choice to the
builder ("dive in your own choices"); all of the below are the builder's calls.

## Approaches
- **Picked: one more act shaped like act three.** One fight, then loot or a rest, then the
  boss. It reuses the act structure, the act-break long rest, and the camp map.
- A bigger act with an optional room, like act two: more maps to balance for little gain.
- A separate "deeper" mode after the campaign: splits saves and achievements in two.

## Design
- After Ysolde the throne becomes an act break (long rest). The run now ends in the tomb.
  Saves that finished at the throne open again into act four (`parseSave` already does this).
- Nodes: `halls` (fight) → `armory` (fight, loot) or `hearth` (rest) → `tomb` (boss, final).
- New monsters, built from models already in the game (no downloads):
  - **Mummy** (SRD, CR 3): slow, Rotting Fist 5d6+3 (fist and necrotic folded together),
    Dreadful Glare as Dread. Skeleton minion in bandage tones.
  - **Wraith** (SRD, CR 5): fast, Life Drain 4d8+3. The ghost model, dark violet.
  - **Fallen Knight** (SRD Knight stats, CR 3): AC 18, two longsword attacks, javelin. The
    KayKit knight in black iron. Not undead, so Turn Undead doesn't help.
  - **Boss: Nekhet, the Mummy Lord** (SRD Mummy Lord, cut down): two Rotting Fists, Dread,
    tough. The skeleton mage in gold and linen.
- Levels 7–8 for every class (SRD where the engine allows):
  - Fighter: 7 Improved Critical (19–20), 8 CON +2 (+8 HP).
  - Paladin: 7 a third 2nd-level slot, 8 CHA 18.
  - Wizard: 7 Ice Storm and a 4th-level slot, 8 INT 20 and a second 4th-level slot.
  - Warlock: 7 pact slots become 4th level, 8 CHA 20.
  - Rogue: 7 Evasion, 8 DEX 20.
  - Ranger: 7 a third 2nd-level slot, 8 DEX 20.
  - Cleric: 7 Death Ward and a 4th-level slot, 8 WIS 20, Divine Strike, Destroy Undead CR 1.
- New loot: Runed Weapon +2 (one runed weapon per hero).
- New achievement for clearing the throne (act three). "Win a campaign" now means the tomb.
- XP for levels 7 and 8 is set so a party reaches 7 on the way into act four and 8 before
  the boss.
- The daily crypt keeps its room list: adding rooms would change everyone's daily.

## House rules (README)
- Fighter Improved Critical at 7 (SRD Champion: 3).
- Mummies' rot doesn't curse; the Mummy Lord has no legendary actions or spell list.
- Wraiths don't lower maximum HP or raise specters.

## Left to the builder
Exact maps, HP and damage after the simulator, colours, room text.

## As built
- Nekhet: 150 HP, AC 17, two Rotting Fists (4d6), Dread with 3 slots.
- XP for level 7 is 9,700 and for level 8 is 10,400: lower thresholds made the act-three
  Throne too easy, and left the rest route behind the Armory route.
- Simulator, 300 runs: act four won 80% via the Armory and 94% via the Hearth (Tomb 82% / 95%).
  Act three stays at 79% (gallery) and 96% (shrine).

## Follow-up: Nekhet's rising and two achievements
- Once a fight, when Nekhet drops to half HP or below (but not straight to 0), up to two of
  his fallen undead stand up as skeletons where they fell; fresh ones climb out beside him to
  make up two. Heroes within 2 tiles who can see him make a WIS save (his spell DC) or are
  frightened for 2 turns. Nekhet's HP went from 150 to 135 to keep the Tomb at about 79% /
  95% (Armory / Hearth).
- Achievements: "Not today" (Death Ward keeps a hero up) and "No rest for the wicked" (win a
  campaign through the Black Armory).

## Follow-up: mummy rot, other difficulties
- Rotting Fist now carries a short mummy rot: CON save (mummy DC 12, Nekhet DC 16) or no HP
  regained for two of the target's turns. Normal Tomb: 75% / 94% (was 78% / 95%).
- Simulator, 300 runs: Story act four 98% / 99%. Hard Tomb 30% / 76% against the Hard Throne's
  53% / 95%, so the Tomb is the steepest fight on Hard.
- Tried: on Hard, Nekhet raising one fewer. The Hard Tomb barely moved (29% / 79%), so it was
  dropped. Whole runs (`sim full`, 300): Normal 75%, Hard 18%; on Hard the Barrow ends 33% of
  runs and the Tomb 17%.
- Hard's monster HP went from ×1.2 to ×1.1 (still +1 to hit and damage). Whole Hard runs: 18% →
  26%. Hard bosses: Barrow 24–85% → 43–91%, Throne 53% / 95% → 66% / 96%, Tomb 29% / 79% → 43% /
  83%. Normal and Story are unchanged.
- The simulator now runs on worker threads. 1,500 whole runs each: Story 97%, Normal 68%, Hard
  29%. (The earlier 75% / 26% were single 300-run samples, which swing about ±5 points.)

## Follow-up: replay tests, the Hard Barrow
- A replay test saves a Tomb fight while a hero is rotting and again after Nekhet's rising,
  and both rebuild exactly.
- Hard leaves one ghoul (10,10) out of the Barrow (`thinned` on the level, `thin` on Hard).
  Hard Barrow, 300 runs per route: 34–91% → 64–97% (Normal 80–98%). Whole Hard runs, 1,500:
  29% → 35%; the Tomb now ends the most (20%), then the Barrow (14%) and the Throne (13%).

## Follow-up: Hard at ×1.15 HP
- With one ghoul fewer in the Hard Barrow, whole Hard runs had climbed to 35%. Monster HP on
  Hard went from ×1.1 to ×1.15 (still +1 to hit and damage). Whole Hard runs (`sim full`, 400
  each, seeds 1–3): 32%, 29%, 31%. ×1.2 gave 24% and put the Barrow back to ending 21% of
  runs. Hard bosses at ×1.15: Throne 96% / 61%, Tomb 80% / 34% (rested / not).
- A saved Hard fight in progress no longer replays to the same state and goes back to camp.

## Follow-up: Hard at ×1.2 HP, with more magic items
- Four SRD items joined the chests (Bracers of Defense, Gauntlets of Ogre Power, Amulet of
  Health, Periapt of Proof against Poison). They lifted whole Hard runs to 36–38% (seeds 1, 2,
  7, 400 each). Hard went from ×1.15 to ×1.2 HP: 31%, 31%, 31%, 32% (seeds 1, 2, 7, 3); the
  Barrow ends 16% of runs. Normal: 70–72%.
- A saved Hard fight in progress no longer replays to the same state and goes back to camp.
