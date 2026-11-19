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
