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
const SETTINGS = { allowRare: false, startingCredits: 150, startingItemLevel: 1 };
const SPELLS = [];
globalThis.game = {
    i18n: { localize: (k) => k, format: (k) => k },
    settings: { get: (_module, key) => SETTINGS[key] },
    packs: {
        get: (id) => ({ getIndex: async () => new Map((id === "sf2e.spells" ? SPELLS : []).map((e) => [e.uuid, e])) }),
    },
};
const DOCS = {};
globalThis.fromUuid = async (uuid) => DOCS[uuid] ?? null;
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
        getFlag: () => undefined,
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

/* -------------------------------------------- */
/*  Spells, equipment, prerequisites             */
/* -------------------------------------------- */

test("setup steps follow the class: casters get spells, everyone gets equipment", () => {
    const app = createApp();
    assert.deepEqual(app.steps.slice(-1), ["equipment"]);

    app.entries.class = entry("Mystic", { slug: "mystic" });
    app.docs.class = doc({ ...app.docs.class._source.system, spellcasting: 1 });
    assert.deepEqual(app.steps.slice(-2), ["spells", "equipment"]);
    assert.equal(app.steps.indexOf("review"), 7);
});

test("the equipment shop tracks a 150 credit budget", () => {
    const app = createApp();
    const blaster = entry("Pistol", { level: { value: 0 }, price: { value: { sp: 60 } }, bulk: { value: 1 }, traits: { rarity: "common" } });
    blaster.type = "weapon";
    const vest = entry("Vest", { level: { value: 1 }, price: { value: { sp: 100 } }, bulk: { value: 1 }, traits: { rarity: "common" } });
    vest.type = "armor";
    app.shopItems = [blaster, vest];
    app.shopCategory = "weapons";

    assert.equal(app.credits, 150);
    assert.equal(app.remaining, 150);
    app.cart.set(blaster.uuid, { entry: blaster, units: 2 });
    assert.equal(app.spent, 120);
    assert.equal(app.remaining, 30);
    const html = STEP_VIEWS.equipment(app);
    assert.ok(html.includes("Pistol"));
    assert.ok(!html.includes("Vest")); // different category tab
    assert.ok(html.includes('data-action="shop-add"'));
    assert.ok(!html.includes("undefined"));
    app.shopCategory = "armor";
    // 100 credits no longer fits in the 30 remaining
    assert.ok(/shop-add[^>]*disabled/.test(STEP_VIEWS.equipment(app)));
});

function mysticActor() {
    const connection = {
        name: "Akashic",
        system: { traits: { otherTags: ["mystic-connection"] } },
        _source: {
            system: {
                rules: [{ key: "ActiveEffectLike", path: "flags.system.mystic.tradition", value: "occult" }],
                description: {
                    value: "<p>Connection Spells cantrip: @UUID[Compendium.sf2e.spells.Item.Scan Environment]; 1st: @UUID[Compendium.sf2e.spells.Item.Akashic Download]</p>",
                },
            },
        },
    };
    DOCS["Compendium.sf2e.spells.Item.Scan Environment"] = { name: "Scan Environment", img: "s.webp" };
    const spell = (name, level, traits) => ({
        name,
        uuid: `Compendium.sf2e.spells.Item.${name}`,
        img: "s.webp",
        system: { level: { value: level }, traits: { value: traits, traditions: ["occult"], rarity: "common" } },
    });
    SPELLS.length = 0;
    SPELLS.push(
        ...["Daze", "Message", "Shield", "Light", "Ghost Sound"].map((n) => spell(n, 1, ["cantrip"])),
        ...["Fear", "Sleep", "Bless"].map((n) => spell(n, 1, [])),
    );
    return {
        name: "Nova",
        level: 1,
        type: "character",
        uuid: "Actor.n",
        abilities: {},
        getFlag: () => ["spells", "equipment"],
        class: {
            slug: "mystic",
            system: { hp: 8 },
            _source: { system: { spellcasting: 1, keyAbility: { value: ["wis"] } } },
        },
        itemTypes: { feat: [connection], spell: [], lore: [] },
        items: [],
    };
}

test("setup mode lists the planned spell choices for the chosen connection", async () => {
    const app = new CharacterCreatorApp({ id: "t" }, mysticActor());
    assert.equal(app.mode, "setup");
    assert.deepEqual(app.steps, ["spells", "equipment"]);

    await app._prepareContext();
    assert.equal(app.spell.tradition, "occult");
    assert.deepEqual(
        app.spell.plan.groups.map((g) => [g.key, g.count]),
        [
            ["cantrip", 4],
            ["rank-1", 2],
        ],
    );
    assert.equal(app.spell.granted.length, 2);
    assert.ok(app.spell.granted.find((g) => g.rank === 1).missing); // Akashic Download is not in the stub compendium
    assert.equal(app.spell.candidates.cantrip.length, 5);
    assert.equal(app.spell.candidates["rank-1"].length, 3);

    const html = STEP_VIEWS.spells(app);
    assert.ok(html.includes("Scan Environment") && html.includes("Akashic"));
    assert.ok(!html.includes("undefined"));

    // Not complete until every group is filled
    const shell = await app._renderHTML();
    assert.ok(/setup-next"\s+disabled/.test(shell));
    app.spellPicks.cantrip = app.spell.candidates.cantrip.slice(0, 4).map((e) => ({ entry: e, rank: 0 }));
    app.spellPicks["rank-1"] = app.spell.candidates["rank-1"].slice(0, 2).map((e) => ({ entry: e, rank: 1 }));
    assert.ok(!/setup-next"\s+disabled/.test(await app._renderHTML()));
});

test("a caster whose connection cannot be found is asked for a tradition", async () => {
    const actor = mysticActor();
    actor.itemTypes.feat = [];
    const app = new CharacterCreatorApp({ id: "t" }, actor);
    await app._prepareContext();
    assert.equal(app.spell.tradition, null);
    assert.ok(STEP_VIEWS.spells(app).includes('data-action="tradition"'));
    app.traditionOverride = "divine";
    await app._prepareContext();
    assert.equal(app.spell.tradition, "divine");
});

test("feats you don't qualify for are hidden or locked", () => {
    const app = createApp();
    const slot = app.featSlots[0];
    const good = entry("Armor Ace", { level: { value: 1 }, prerequisites: { value: [] } });
    const bad = entry("Master Thing", { level: { value: 1 }, prerequisites: { value: [{ value: "master in Athletics" }] } });
    app.candidates = { [slot.id]: [good, bad] };
    app.prereqStatus = {
        [good.uuid]: { status: "met", unmet: [], unknown: [] },
        [bad.uuid]: { status: "unmet", unmet: ["master in Athletics"], unknown: [] },
    };

    let html = STEP_VIEWS.feats(app);
    assert.ok(html.includes("Armor Ace"));
    assert.ok(!html.includes("Master Thing"));
    assert.ok(html.includes("HiddenUnqualified"));

    app.showUnqualified = true;
    html = STEP_VIEWS.feats(app);
    assert.ok(html.includes("Master Thing") && html.includes("master in Athletics"));
    assert.ok(!new RegExp(`data-action="feat"[^>]*${bad.uuid}`).test(html.replace(/\s+/g, " ")));
});
