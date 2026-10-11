/**
 * Smoke test: renders every wizard step against stubbed Foundry globals and real-shaped data, to catch
 * runtime errors in the view/state code that unit tests of the pure rules cannot reach.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

class FakeApplicationV2 {
    constructor(options) {
        this.options = options;
    }
}
globalThis.foundry = {
    applications: { api: { ApplicationV2: FakeApplicationV2 }, ux: { TextEditor: { implementation: {} } } },
    utils: { randomID: () => "abcd", setProperty: () => {} },
};
globalThis.game = {
    i18n: { localize: (k) => k, format: (k) => k },
    settings: { get: () => false },
};
globalThis.CONFIG = {
    PF2E: {
        abilities: { str: "PF2E.AbilityStr" },
        skills: { athletics: { label: "Athletics" }, intimidation: { label: "Intimidation" }, piloting: { label: "Piloting" } },
    },
};

const { CharacterCreatorApp } = await import("../scripts/app/creator-app.mjs");
const { STEP_VIEWS } = await import("../scripts/app/views.mjs");

const doc = (system) => ({ _source: { system } });
const entry = (name, system = {}) => ({ name, uuid: `Compendium.sf2e.x.Item.${name}`, img: "icon.webp", system });

function createApp() {
    const app = new CharacterCreatorApp({ id: "t" }, null);
    app.stepIndex = 0;
    app.entries = {
        ancestry: entry("Vesk", { slug: "vesk", hp: 10 }),
        heritage: entry("Frilled Vesk"),
        background: entry("Athlete"),
        class: entry("Soldier", { slug: "soldier" }),
    };
    app.picks = { ancestry: "a", heritage: "h", background: "b", class: "c" };
    app.docs = {
        ancestry: doc({
            boosts: { 0: { value: ["con"] }, 1: { value: ["str"] }, 2: { value: ["str", "dex", "con", "int", "wis", "cha"] } },
            flaws: { 0: { value: ["wis"] } },
        }),
        background: doc({
            boosts: { 0: { value: ["dex", "str"] }, 1: { value: ["str", "dex", "con", "int", "wis", "cha"] } },
            trainedSkills: { value: ["athletics"], lore: ["Sports Lore"] },
        }),
        class: doc({
            keyAbility: { value: ["con"] },
            trainedSkills: { value: ["intimidation"], additional: 3 },
            ancestryFeatLevels: { value: [1] },
            classFeatLevels: { value: [1] },
            skillFeatLevels: { value: [2] },
            generalFeatLevels: { value: [3] },
        }),
    };
    app.lists = {
        ancestry: [app.entries.ancestry],
        heritage: { own: [app.entries.heritage], versatile: [] },
        background: [app.entries.background],
        class: [app.entries.class],
    };
    return app;
}

test("create mode renders every step", () => {
    const app = createApp();
    app.boostPicks = { ancestry: { 2: "dex" }, flaws: {}, background: { 0: "dex", 1: "cha" }, key: null, free: ["str", "int", "wis", "cha"] };
    app.skillPicks = new Set(["piloting"]);
    const slot = app.featSlots[0];
    assert.deepEqual(
        app.featSlots.map((s) => s.id),
        ["ancestry-1", "class-1"],
    );
    app.candidates = { [slot.id]: [entry("Armor Ace", { level: { value: 1 }, prerequisites: { value: [{ value: "trained" }] } })] };
    app.name = "Test";

    for (const id of app.steps) {
        const html = STEP_VIEWS[id](app);
        assert.equal(typeof html, "string");
        assert.ok(html.length > 0, `${id} rendered nothing`);
        assert.ok(!html.includes("undefined"), `${id} rendered "undefined"`);
    }
    assert.equal(app.validation.complete, true);
});

test("a complete build lets the player advance every step", () => {
    const app = createApp();
    app.boostPicks = { ancestry: { 2: "dex" }, flaws: {}, background: { 0: "dex", 1: "cha" }, key: null, free: ["str", "int", "wis", "dex"] };
    assert.deepEqual(app.validation.errors, []);
    assert.equal(app.skillInfo.total, 3 + app.validation.mods.int);
    assert.equal(app.skillInfo.fixed.get("athletics"), "background");
    assert.equal(app.skillInfo.fixed.get("intimidation"), "class");
});

test("level-up mode builds its steps from the class tables", () => {
    const actor = {
        name: "Nova",
        level: 2,
        type: "character",
        uuid: "Actor.x",
        abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map((a) => [a, { mod: 2 }])),
        class: {
            slug: "soldier",
            system: { hp: 10 },
            _source: {
                system: {
                    classFeatLevels: { value: [1, 2, 4] },
                    skillFeatLevels: { value: [2, 4] },
                    generalFeatLevels: { value: [3] },
                    ancestryFeatLevels: { value: [1, 5] },
                    skillIncreaseLevels: { value: [3, 5] },
                    items: { a: { name: "Third Level Feature", img: "i.webp", uuid: "u", level: 3 } },
                },
            },
        },
        itemTypes: { feat: [], lore: [{ id: "l1", slug: "sports-lore", name: "Sports Lore", system: { proficient: { value: 1 } } }] },
        skills: { athletics: { label: "Athletics", rank: 1 }, intimidation: { label: "Intimidation", rank: 2 } },
        ancestry: { slug: "vesk" },
    };
    const app = new CharacterCreatorApp({ id: "t" }, actor);
    assert.equal(app.mode, "levelup");
    assert.equal(app.target, 3);
    assert.deepEqual(app.steps, ["overview", "skills", "feats", "review"]);
    assert.equal(app.skillOptions.length, 4); // 3 core + 1 lore
    for (const id of app.steps) {
        const html = STEP_VIEWS[id](app);
        assert.ok(html.length > 0 && !html.includes("undefined"), `${id}: ${html}`);
    }
    app.target = 5;
    assert.deepEqual(app.steps, ["overview", "attributes", "skills", "feats", "review"]);
    assert.ok(STEP_VIEWS.attributes(app).includes("lu-boost"));
});
