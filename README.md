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
   Feats you don't meet the prerequisites for are hidden (or shown locked, with the reason).
8. **Review**: name your character and create them.
9. **Spells** (casters): choose your repertoire or spell database. The tradition and the free spells come from
   the connection, paradox, or programming language you picked on the character sheet.
10. **Equipment**: shop with 150 credits. Leftover credits go on the character.

The character is created at step 8; spells and equipment are added to the finished character, so you can close the
window and pick them up later (the sheet's header icon becomes **Finish Character Setup**).

**Level up**

The wizard reads your class's own level tables, so it only asks for what that level actually grants:

- Overview of the HP and new class features you gain
- Four attribute boosts at levels 5, 10, 15, and 20 (partial boosts shown on attributes at +4 or higher)
- New spells for mystics, technomancers, and witchwarpers, including the free spell for each newly gained rank
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
- Feat prerequisites are checked against the character as built so far: skill ranks (including the skill you
  are about to raise), attribute modifiers, and required feats, features, heritages, and dedications
- Spells are limited to the class's tradition, the right rank, and common rarity; cantrips and ranked spells are
  kept separate; how many you may learn follows the class's spell tables and repertoire/database text
- Starting equipment is limited to 150 credits (configurable in module settings) and common items of level 1
  or lower (also configurable)

Some prerequisites are free text that cannot be checked mechanically (for example "your lucky number" or
"able to cast spells"). Those feats stay available with a "Check with your GM" note. Rare and uncommon feats,
spells, and items are hidden unless you turn on the option.

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
- Spell support covers the mystic, technomancer, and witchwarper. Focus spells (epiphany spells, warp spells, magic
  hacks) are left to the sheet, as are daily spell preparation and any 10th-rank spell slot.
- The system's spell compendium is still growing: some spells a connection, paradox, or programming language
  grants are not in it yet. The wizard lists them as missing so you can add them by hand.
- Equipment is bought at character creation only (no in-game shopping), and nothing is equipped automatically.
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
