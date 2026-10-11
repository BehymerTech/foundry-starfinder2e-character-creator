# Starfinder 2e Character Creator

A guided, video-game style character creator and level-up wizard for the **Starfinder 2e** system on Foundry VTT.

Pick an option, read about it in the side panel, and move on. The wizard enforces the official Player Core
character creation rules for you, so you cannot end up with an illegal build by accident.

## Features

**Character creation (level 1)**

1. **Ancestry**: browse every ancestry in the system compendium with HP and attribute boosts at a glance.
2. **Heritage**: filtered to the chosen ancestry, plus versatile heritages.
3. **Background**: boosts and trained skills shown on each card.
4. **Class**: HP and key attribute shown on each card.
5. **Attributes**: one row per boost source (ancestry, flaw, background, class key attribute, four free boosts).
   Fixed boosts are locked in; choices are limited to the attributes the source offers.
6. **Skills**: skills already trained by your class or background are marked; pick the rest
   (class additional skills + Intelligence modifier).
7. **Feats**: ancestry and class feat slots that open at level 1, filtered to your ancestry and class.
8. **Review**: name your character and create them.

**Level up**

The wizard reads your class's own level tables, so it only asks for what that level actually grants:

- Overview of the HP and new class features you gain
- Four attribute boosts at levels 5, 10, 15, and 20 (partial boosts shown on attributes at +4 or higher)
- Skill increases, capped by level (Expert at 3, Master at 7, Legendary at 15)
- Ancestry, class, skill, and general feats for the slots that open at that level

## Rules it enforces

- Boosts from one source (ancestry, background, free) go to different attributes
- Every ancestry, background, and class choice must be made
- Four free boosts go to four different attributes
- No attribute starts above +4
- Boosts to an attribute at +4 or higher count as half a step (matching the system's own calculation)
- Skill increases respect the level requirement for each proficiency rank
- Feats are filtered by slot type, level, and the character's ancestry/class traits

Prerequisites are shown on each feat but not automatically verified; the final call stays with you and your GM.

## Installation

In Foundry, open **Add-on Modules → Install Module** and paste the manifest URL:

```
https://github.com/BehymerTech/foundry-starfinder2e-character-creator/releases/latest/download/module.json
```

Requires Foundry VTT v14 and the [Starfinder 2e system](https://github.com/foundryvtt/pf2e) (`sf2e`) v1.6.0 or newer.

## Usage

- **New character**: click **Character Creator** at the top of the Actors tab.
- **Blank character sheet**: click the astronaut icon in the sheet's window header to build that actor.
- **Level up**: click the same icon on a character that already has a class.
- **Macro / API**: `game.modules.get("sf2e-character-creator").api.open(actor)` (omit `actor` to start a new character).

When you finish, the wizard adds the ancestry, heritage, background, class, and feats to the actor and sets
attribute boosts and skill training. The system itself grants class and ancestry features and shows any
choice prompts those features carry.

## Content and art

This module contains **no Paizo content and no art**. Every ancestry, heritage, background, class, feat, and icon is read
at runtime from the `sf2e` system's own compendiums (`sf2e.ancestries`, `sf2e.heritages`, `sf2e.backgrounds`,
`sf2e.classes`, `sf2e.feats`) and referenced by UUID. Icons come from the system's own assets.

## Known limits

- Voluntary flaws, alternate ancestry boosts, Free Archetype, and other variant rules are not yet supported.
- Starting equipment and spell selection are left to the character sheet.
- Archetype and multiclass dedication feats are not offered in class feat slots.

## Development

```
npm test
```

The rules logic lives in `scripts/lib/rules.mjs` with no Foundry dependencies, so it is unit tested with Node's
built-in test runner. `tests/compendium-data.test.mjs` also checks the rules against the real system compendium
files; point `SF2E_PACKS` at a checkout of the system's `packs/sf2e` directory to run it.

## License

Code is MIT licensed (see `LICENSE`). Game content accessed through the system is published by Paizo under the
[ORC License](https://paizo.com/orclicense) and is not distributed with this module.
