import { CharacterCreatorApp } from "./app/creator-app.mjs";
import { getPendingSetup } from "./app/apply.mjs";
import { MODULE_ID } from "./lib/compendium.mjs";
import { STARTING_CREDITS, STARTING_ITEM_LEVEL } from "./lib/rules.mjs";

const isSf2e = () => game.system.id === "sf2e";

Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "allowRare", {
        name: "SF2ECC.Settings.AllowRare.Name",
        hint: "SF2ECC.Settings.AllowRare.Hint",
        scope: "client",
        config: true,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID, "startingCredits", {
        name: "SF2ECC.Settings.StartingCredits.Name",
        hint: "SF2ECC.Settings.StartingCredits.Hint",
        scope: "world",
        config: true,
        type: new foundry.data.fields.NumberField({ required: true, integer: true, min: 0, initial: STARTING_CREDITS }),
        default: STARTING_CREDITS,
    });
    game.settings.register(MODULE_ID, "startingItemLevel", {
        name: "SF2ECC.Settings.StartingItemLevel.Name",
        hint: "SF2ECC.Settings.StartingItemLevel.Hint",
        scope: "world",
        config: true,
        type: new foundry.data.fields.NumberField({ required: true, integer: true, min: 0, max: 20, initial: STARTING_ITEM_LEVEL }),
        default: STARTING_ITEM_LEVEL,
    });
});

Hooks.once("ready", () => {
    if (!isSf2e()) {
        ui.notifications.warn(game.i18n.localize("SF2ECC.WrongSystem"));
        return;
    }
    const module = game.modules.get(MODULE_ID);
    module.api = {
        /** Open the wizard: no argument starts a new character, a character actor creates/levels it. */
        open: (actor = null) => CharacterCreatorApp.open(actor),
    };
});

/** "Create Character" button in the Actors directory header. */
Hooks.on("renderActorDirectory", (_app, html) => {
    if (!isSf2e() || !game.user.can("ACTOR_CREATE")) return;
    const root = html instanceof HTMLElement ? html : html[0];
    const header = root?.querySelector(".header-actions");
    if (!header || header.querySelector(".sf2e-cc-open")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sf2e-cc-open";
    button.innerHTML = `<i class="fa-solid fa-user-astronaut"></i> ${game.i18n.localize("SF2ECC.OpenCreator")}`;
    button.addEventListener("click", () => CharacterCreatorApp.open());
    header.append(button);
});

/** Wizard button in the window header of a character sheet: creates a blank sheet, or levels up a built one. */
Hooks.on("renderApplicationV2", (app, element) => {
    const actor = app.document;
    if (!isSf2e() || actor?.documentName !== "Actor" || actor.type !== "character" || !actor.isOwner) return;
    const header = element.querySelector(".window-header");
    if (!header || header.querySelector(".sf2e-cc-header-button")) return;

    const pending = getPendingSetup(actor).length > 0;
    const levelUp = !!actor.class && !pending;
    if (levelUp && actor.level >= 20) return;
    const label = game.i18n.localize(pending ? "SF2ECC.FinishSetup" : levelUp ? "SF2ECC.LevelUp" : "SF2ECC.OpenCreator");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "header-control icon fa-solid fa-user-astronaut sf2e-cc-header-button";
    button.dataset.tooltip = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        CharacterCreatorApp.open(actor);
    });
    // Sit just before the window control (close/minimize) buttons
    const anchor = header.querySelector("[data-action='toggleControls']") ?? header.querySelector("[data-action='close']");
    anchor ? anchor.before(button) : header.append(button);
});
