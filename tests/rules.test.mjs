import assert from "node:assert/strict";
import { test } from "node:test";
import * as R from "../scripts/lib/rules.mjs";

const vesk = {
    0: { value: ["con"] },
    1: { value: ["str"] },
    2: { value: ["str", "dex", "con", "int", "wis", "cha"] },
};

test("normalizeSlots marks single-option slots fixed", () => {
    const slots = R.normalizeSlots(vesk);
    assert.deepEqual(
        slots.map((s) => [s.key, s.fixed]),
        [
            ["0", true],
            ["1", true],
            ["2", false],
        ],
    );
});

test("applyBoost is +1 below +4 and +0.5 at +4 or above", () => {
    assert.equal(R.applyBoost(0), 1);
    assert.equal(R.applyBoost(3), 4);
    assert.equal(R.applyBoost(4), 4.5);
});

test("computeModifiers applies ancestry flaws after ancestry boosts", () => {
    const mods = R.computeModifiers([{ boosts: ["con", "str", "dex"], flaws: ["wis"] }, { boosts: ["str"] }]);
    assert.deepEqual(mods, { str: 2, dex: 1, con: 1, int: 0, wis: -1, cha: 0 });
});

function build(overrides = {}) {
    return {
        ancestry: R.resolveSlots(R.normalizeSlots(vesk), { 2: "dex" }),
        flaws: R.resolveSlots(R.normalizeSlots({ 0: { value: ["wis"] } })),
        background: R.resolveSlots(R.normalizeSlots({ 0: { value: ["dex", "str"] }, 1: { value: R.ATTRIBUTES } }), {
            0: "dex",
            1: "cha",
        }),
        keyOptions: ["con"],
        keySelected: "con",
        free: ["str", "int", "wis", "cha"],
        ...overrides,
    };
}

test("a legal Vesk build validates", () => {
    const result = R.validateCreationBuild(build());
    assert.deepEqual(result.errors, []);
    assert.equal(result.complete, true);
    assert.equal(result.mods.str, 2);
    assert.equal(result.mods.con, 2);
    assert.equal(result.mods.wis, 0); // -1 flaw +1 free boost
});

test("duplicate sources and over-cap builds are rejected", () => {
    const dup = R.validateCreationBuild(build({ free: ["str", "str", "int", "wis"] }));
    assert.ok(dup.errors.includes("freeDuplicate"));

    // con: ancestry fixed + ancestry free + background + class key + free = 5 boosts, past +4
    const over = R.validateCreationBuild(
        build({
            ancestry: R.resolveSlots(R.normalizeSlots(vesk), { 2: "con" }),
            keySelected: "con",
            background: R.resolveSlots(R.normalizeSlots({ 0: { value: ["con"] }, 1: { value: R.ATTRIBUTES } }), {
                1: "str",
            }),
            free: ["con", "str", "dex", "int"],
        }),
    );
    assert.ok(over.errors.includes("overCap"));
    assert.equal(over.complete, false);
});

test("an ancestry giving the same attribute twice is rejected", () => {
    const result = R.validateCreationBuild(build({ ancestry: R.resolveSlots(R.normalizeSlots(vesk), { 2: "str" }) }));
    assert.ok(result.errors.includes("ancestryDuplicate"));
});

test("incomplete builds are not complete", () => {
    assert.equal(R.validateCreationBuild(build({ free: ["str"] })).complete, false);
    assert.equal(R.validateCreationBuild(build({ keySelected: null })).complete, false);
    assert.equal(R.validateCreationBuild(build({ ancestry: R.resolveSlots(R.normalizeSlots(vesk)) })).complete, false);
});

test("skill rank caps follow level thresholds", () => {
    assert.equal(R.maxSkillRankForLevel(3), 2);
    assert.equal(R.maxSkillRankForLevel(6), 2);
    assert.equal(R.maxSkillRankForLevel(7), 3);
    assert.equal(R.maxSkillRankForLevel(15), 4);
    assert.equal(R.canIncreaseSkill(2, 5), false);
    assert.equal(R.canIncreaseSkill(2, 7), true);
    assert.equal(R.canIncreaseSkill(0, 3), true);
});

test("additional skills never go negative", () => {
    assert.equal(R.additionalSkillCount(3, 2), 5);
    assert.equal(R.additionalSkillCount(3, -1), 2);
    assert.equal(R.additionalSkillCount(1, -3), 0);
});

test("feat slots come from the class tables", () => {
    const soldier = {
        ancestryFeatLevels: { value: [1, 5, 9] },
        classFeatLevels: { value: [1, 2, 4] },
        skillFeatLevels: { value: [2, 4] },
        generalFeatLevels: { value: [3, 7] },
        skillIncreaseLevels: { value: [3, 5] },
    };
    assert.deepEqual(
        R.featSlotsAtLevel(soldier, 1).map((s) => s.id),
        ["ancestry-1", "class-1"],
    );
    assert.deepEqual(
        R.featSlotsAtLevel(soldier, 2).map((s) => s.id),
        ["class-2", "skill-2"],
    );
    assert.deepEqual(
        R.featSlotsAtLevel(soldier, 3).map((s) => s.id),
        ["general-3"],
    );
    assert.equal(R.hasSkillIncrease(soldier, 3), true);
    assert.equal(R.hasSkillIncrease(soldier, 4), false);
});

test("attribute boosts only at 5, 10, 15, 20", () => {
    assert.deepEqual([1, 2, 5, 9, 10, 15, 19, 20].filter(R.hasAttributeBoosts), [5, 10, 15, 20]);
});

const feat = (category, level, traits, rarity = "common", slug = "x") => ({
    system: { category, level: { value: level }, traits: { value: traits, rarity }, slug },
});

test("feat eligibility filters by category, trait, level, rarity and ownership", () => {
    const ctx = { ancestrySlug: "vesk", classSlug: "soldier", allowRare: false, ownedSlugs: new Set(["owned"]) };
    const ancestrySlot = { category: "ancestry", level: 1 };
    const classSlot = { category: "class", level: 1 };
    assert.equal(R.isFeatEligible(feat("ancestry", 1, ["vesk"]), ancestrySlot, ctx), true);
    assert.equal(R.isFeatEligible(feat("ancestry", 1, ["human"]), ancestrySlot, ctx), false);
    assert.equal(R.isFeatEligible(feat("ancestry", 5, ["vesk"]), ancestrySlot, ctx), false);
    assert.equal(R.isFeatEligible(feat("class", 1, ["soldier"]), classSlot, ctx), true);
    assert.equal(R.isFeatEligible(feat("class", 1, ["soldier"], "rare"), classSlot, ctx), false);
    assert.equal(R.isFeatEligible(feat("class", 1, ["soldier"], "rare"), classSlot, { ...ctx, allowRare: true }), true);
    assert.equal(R.isFeatEligible(feat("skill", 1, [], "common", "owned"), { category: "skill", level: 2 }, ctx), false);
    assert.equal(R.isFeatEligible(feat("skill", 1, []), { category: "general", level: 3 }, ctx), true);
    assert.equal(R.isFeatEligible(feat("general", 1, []), { category: "skill", level: 2 }, ctx), false);
});

test("hit points per level has a floor of 1", () => {
    assert.equal(R.hitPointsPerLevel(10, 2), 12);
    assert.equal(R.hitPointsPerLevel(6, -9), 1);
});
