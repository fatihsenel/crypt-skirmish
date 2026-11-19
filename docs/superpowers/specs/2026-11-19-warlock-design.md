# Warlock class (Ilsa's slot)

## Why
More variety between runs: a third optional class, picked like the Paladin and Ranger.
The Warlock should play differently from the Wizard: few strong spells per fight, a strong
at-will blast, and a reason to commit slots to Hex.

## Approaches
- **Warlock (picked):** most new ideas, fits the short rest after every room, reuses Hunter's
  Mark and Divine Smite toggle code.
- Druid: loses Turn Undead and strong healing in an undead-heavy crypt; Wild Shape needs models.
- Sorcerer: shares the Wizard's spells; would feel like a reskin.

## Design (SRD 5.1 Fiend Warlock)
- Template code `K`, slot `W`: `CLASS_CHOICES.W = ['W', 'K']`. Name Ilsa, 24 HP, AC 15
  (Armor of Shadows), CHA 16, castStat cha.
- Pact slots: 2 × 2nd level; 2 × 3rd from level 5. Refilled after every room won.
- Eldritch Blast (cantrip attack, 120 ft, 1d10 + CHA force); two beams at level 5.
- Hex: bonus action, 90 ft, +1d6 necrotic on each of the warlock's hits on that foe for the
  fight; a new target costs a new slot (as Hunter's Mark).
- Scorching Ray: three ranged spell attacks, 2d6 fire each, each ray picks its target.
- Burning Hands (existing spell, cast at the pact slot level).
- Hellish Rebuke: toggle (like Divine Smite). Armed, the next time an enemy damages the
  warlock, that enemy takes 3d10 fire (4d10 with a 3rd-level slot), DEX save for half.
  Spends the reaction and a slot.
- Dark One's Blessing: reducing a foe to 0 HP gives temp HP = CHA mod + level. New
  mechanic: temp HP absorbs damage first, shown on the HUD, gone after the fight.
- Level 4: CHA 18. Level 5: two beams, 3rd-level slots, Fireball. Level 6: Dark One's Own
  Luck: once per room, a failed save gets +1d10 if that would make it succeed (automatic).
- Figure: Mage model recoloured dark red; horned icon in the initiative bar.
- AI/sim: skirmisher; `WARLOCK=1` in the simulator; tune to land near the Wizard's win rates.
- House rules: Hex has no ability-check part and lasts the fight (no concentration).

## Left to the builder
Exact model hue, icon art, how the HUD draws temp HP, and sim policy details.
