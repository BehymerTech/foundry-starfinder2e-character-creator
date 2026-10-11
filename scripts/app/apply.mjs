/**
 * Writes the wizard's choices to an actor. All item data comes from the sf2e compendiums at the time of
 * creation, with the player's choices stamped on top (selected boosts, key attribute, feat location).
 * Granted class/ancestry features and any rule-element choice prompts are handled by the system itself.
 */
import { MODULE_ID, sourceOf } from "../lib/compendium.mjs";

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
