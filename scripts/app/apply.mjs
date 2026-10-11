/**
 * Writes the wizard's choices to an actor. All item data comes from the sf2e compendiums at the time of
 * creation, with the player's choices stamped on top (selected boosts, key attribute, feat location).
 * Granted class/ancestry features and any rule-element choice prompts are handled by the system itself.
 */
import { MODULE_ID, sourceOf } from "../lib/compendium.mjs";
import { cartTotal, purchaseUnit } from "../lib/rules.mjs";
import { slotsAtLevel, CANTRIPS_KNOWN, spellKey } from "../lib/spells.mjs";

function stampSlots(source, field, resolved) {
    for (const slot of resolved) {
        foundry.utils.setProperty(source, `system.${field}.${slot.key}.selected`, slot.selected);
    }
}

async function addFeats(actor, slots, picks) {
    const sources = [];
    for (const slot of slots) {
        const entry = picks[slot.id];
        if (!entry) continue;
        const source = await sourceOf(entry.uuid);
        source.system.location = slot.id;
        source.system.level = { ...(source.system.level ?? {}), taken: slot.level };
        sources.push(source);
    }
    if (sources.length) await actor.createEmbeddedDocuments("Item", sources);
}

/** Create (or finish) a level 1 character. Returns the actor. */
export async function applyCreation(app) {
    const { build } = app;
    const name = app.name.trim() || game.i18n.localize("SF2ECC.UnnamedCharacter");
    const actor = app.actor ?? (await Actor.create({ name, type: "character" }));
    if (!actor) throw new Error(`${MODULE_ID} | Could not create the actor`);

    const ancestry = await sourceOf(app.picks.ancestry);
    stampSlots(ancestry, "boosts", build.ancestry);
    stampSlots(ancestry, "flaws", build.flaws);

    const background = await sourceOf(app.picks.background);
    stampSlots(background, "boosts", build.background);

    const classSource = await sourceOf(app.picks.class);
    foundry.utils.setProperty(classSource, "system.keyAbility.selected", build.keySelected);

    // Order matters: the heritage needs its ancestry, and class features come last so prompts follow the story
    await actor.createEmbeddedDocuments("Item", [ancestry]);
    if (app.picks.heritage) await actor.createEmbeddedDocuments("Item", [await sourceOf(app.picks.heritage)]);
    await actor.createEmbeddedDocuments("Item", [background]);
    await actor.createEmbeddedDocuments("Item", [classSource]);

    const update = { name, "system.build.attributes.boosts.1": [...build.free] };
    for (const skill of app.skillPicks) update[`system.skills.${skill}.rank`] = 1;
    await actor.update(update);

    await addFeats(actor, app.featSlots, app.featPicks);
    return actor;
}

/* -------------------------------------------- */
/*  Setup progress                              */
/* -------------------------------------------- */

/** Setup steps (spells, equipment) that still need doing, so the wizard can be resumed after closing it. */
export const getPendingSetup = (actor) => actor?.getFlag(MODULE_ID, "setup") ?? [];

export async function setPendingSetup(actor, steps) {
    if (steps.length) await actor.setFlag(MODULE_ID, "setup", steps);
    else await actor.unsetFlag(MODULE_ID, "setup");
}

export async function completeSetupStep(actor, step) {
    await setPendingSetup(
        actor,
        getPendingSetup(actor).filter((s) => s !== step),
    );
}

/* -------------------------------------------- */
/*  Spells                                      */
/* -------------------------------------------- */

const titleCase = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** Find the spellcasting entry for this class and tradition, or create it. */
async function ensureSpellcastingEntry(actor, { casting, tradition }) {
    const existing = actor.itemTypes.spellcastingEntry.find(
        (e) => e.system.tradition?.value === tradition && e.system.prepared?.value === casting,
    );
    if (existing) return existing;

    const [entry] = await actor.createEmbeddedDocuments("Item", [
        {
            name: game.i18n.format("SF2ECC.SpellEntryName", {
                tradition: titleCase(tradition),
                casting: game.i18n.localize(`SF2ECC.Casting.${casting}`),
            }),
            type: "spellcastingEntry",
            system: {
                ability: { value: actor.system.details?.keyability?.value ?? "int" },
                prepared: { value: casting },
                tradition: { value: tradition },
                proficiency: { value: actor.class?.system.spellcasting || 1 },
            },
            flags: { [MODULE_ID]: { created: true } },
        },
    ]);
    return entry;
}

/** Spells per day for the entry at the given level. Spontaneous slots are filled, prepared slots start empty. */
function slotUpdate(casting, level) {
    const update = {};
    for (const [rank, max] of Object.entries(slotsAtLevel(casting, level))) {
        update[`system.slots.slot${rank}.max`] = max;
        if (casting === "spontaneous") update[`system.slots.slot${rank}.value`] = max;
    }
    if (casting === "prepared") update["system.slots.slot0.max"] = CANTRIPS_KNOWN;
    return update;
}

/**
 * Add chosen and granted spells to the character's spellcasting entry and set its slots.
 * @param {object} args
 * @param {Actor} args.actor
 * @param {"spontaneous"|"prepared"} args.casting
 * @param {string} args.tradition
 * @param {number} args.level  the level the slots should reflect
 * @param {Array<{ uuid: string, rank: number }>} args.spells  every spell to add, with the rank it is learned at
 */
export async function applySpells({ actor, casting, tradition, level, spells }) {
    const entry = await ensureSpellcastingEntry(actor, { casting, tradition });
    await entry.update(slotUpdate(casting, level));

    const owned = new Set(
        actor.itemTypes.spell
            .filter((s) => s.system.location?.value === entry.id)
            .map((s) => `${spellKey(s.name)}@${s.system.traits.value.includes("cantrip") ? 0 : (s.system.location.heightenedLevel ?? s.system.level.value)}`),
    );

    const sources = [];
    for (const { uuid, rank } of spells) {
        const source = await sourceOf(uuid);
        const isCantrip = (source.system.traits?.value ?? []).includes("cantrip");
        const learnedRank = isCantrip ? 0 : rank;
        if (owned.has(`${spellKey(source.name)}@${learnedRank}`)) continue;
        owned.add(`${spellKey(source.name)}@${learnedRank}`);

        const base = source.system.level?.value ?? 1;
        source.system.location = {
            value: entry.id,
            ...(!isCantrip && rank > base ? { heightenedLevel: rank } : {}),
        };
        sources.push(source);
    }
    if (sources.length) await actor.createEmbeddedDocuments("Item", sources);
    return entry;
}

/* -------------------------------------------- */
/*  Equipment                                   */
/* -------------------------------------------- */

/**
 * Buy the cart's items and give the character whatever credits are left.
 * @param {Actor} actor
 * @param {Array<{ uuid: string, price: object, units: number }>} cart
 * @param {number} credits  the budget
 */
export async function applyPurchases(actor, cart, credits) {
    const total = cartTotal(cart);
    if (total > credits) throw new Error(game.i18n.localize("SF2ECC.Shop.OverBudget"));

    const sources = [];
    for (const line of cart) {
        if (line.units <= 0) continue;
        const source = await sourceOf(line.uuid);
        source.system.quantity = line.units * purchaseUnit(line.price);
        sources.push(source);
    }
    if (sources.length) await actor.createEmbeddedDocuments("Item", sources);

    const leftover = credits - total;
    if (leftover > 0) await actor.inventory.addCurrency({ credits: leftover });
    return leftover;
}

/** Advance an existing character by one level. */
export async function applyLevelUp(app) {
    const { actor, target } = app;
    const update = { "system.details.level.value": target };

    if (app.lu.boosts.length) update[`system.build.attributes.boosts.${target}`] = [...app.lu.boosts];

    let loreUpdate = null;
    if (app.lu.skill) {
        const option = app.skillOptions.find((s) => s.key === app.lu.skill);
        if (option) {
            if (option.lore) loreUpdate = { _id: option.lore, "system.proficient.value": option.rank + 1 };
            else update[`system.skills.${option.key}.rank`] = option.rank + 1;
        }
    }

    // Changing the level makes the system add the new class features (and ask about any choices they carry)
    await actor.update(update);
    if (loreUpdate) await actor.updateEmbeddedDocuments("Item", [loreUpdate]);
    await addFeats(actor, app.featSlots, app.featPicks);
    return actor;
}
