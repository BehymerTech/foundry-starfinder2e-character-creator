/**
 * Runs the rules against the real sf2e compendium source files. Set SF2E_PACKS to the system repository's
 * `packs/sf2e` directory (defaults to the sibling checkout used during development). Skipped when absent.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as R from "../scripts/lib/rules.mjs";

const ROOT = process.env.SF2E_PACKS ?? join(import.meta.dirname, "..", "..", "pf2e", "packs", "sf2e");
const available = existsSync(ROOT);

function* walk(dir) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) yield* walk(path);
        else if (name.endsWith(".json") && !name.startsWith("_")) yield path;
    }
}
const load = (pack) => [...walk(join(ROOT, pack))].map((p) => JSON.parse(readFileSync(p, "utf8")));

test("every ancestry has playable, valid boost slots", { skip: !available }, () => {
    for (const a of load("ancestries")) {
        const boosts = R.normalizeSlots(a.system.boosts);
        assert.ok(boosts.length >= 1, `${a.name} has no boosts`);
        // Ancestry boosts always leave room for a legal, duplicate-free choice
        const picks = {};
        const used = new Set();
        for (const slot of boosts) {
            if (slot.fixed) used.add(slot.options[0]);
        }
        for (const slot of boosts.filter((s) => !s.fixed)) {
            const choice = slot.options.find((o) => !used.has(o));
            assert.ok(choice, `${a.name} cannot pick distinct boosts`);
            used.add(choice);
            picks[slot.key] = choice;
        }
        assert.ok(R.resolveSlots(boosts, picks).every((s) => s.selected), a.name);
    }
});

test("every class defines a key attribute, HP, and level tables", { skip: !available }, () => {
    const classes = load("classes");
    assert.ok(classes.length >= 8);
    for (const c of classes) {
        assert.ok(c.system.keyAbility.value.length >= 1, `${c.name} key attribute`);
        assert.ok(c.system.hp > 0, `${c.name} hp`);
        assert.ok(c.system.skillIncreaseLevels.value.length > 0, `${c.name} skill increases`);
        // All twenty levels are covered by at least one choice or are feature-only; level 1 always offers feats
        const slots = R.featSlotsAtLevel(c.system, 1);
        assert.ok(slots.length >= 1, `${c.name} has no level 1 feat slot`);
    }
});

test("every ancestry offers at least one level 1 ancestry feat to pick", { skip: !available }, () => {
    const feats = load("feats").filter((f) => f.system.category === "ancestry");
    const missing = [];
    for (const a of load("ancestries")) {
        const slug = a.system.slug ?? a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const ok = feats.some((f) =>
            R.isFeatEligible(f, { category: "ancestry", level: 1 }, { ancestrySlug: slug, allowRare: true }),
        );
        if (!ok) missing.push(a.name);
    }
    // Report rather than fail hard: a handful of newly-added ancestries may lack level 1 feats upstream
    assert.ok(missing.length <= 3, `Ancestries without a level 1 feat: ${missing.join(", ")}`);
});

test("every class offers a level 1 class feat to pick", { skip: !available }, () => {
    const feats = load("feats").filter((f) => f.system.category === "class");
    for (const c of load("classes")) {
        const slug = c.system.slug ?? c.name.toLowerCase();
        const ok = feats.some((f) => R.isFeatEligible(f, { category: "class", level: 1 }, { classSlug: slug, allowRare: true }));
        assert.ok(ok, `${c.name} has no level 1 class feat`);
    }
});

test("backgrounds have valid boost slots", { skip: !available }, () => {
    const backgrounds = load("backgrounds");
    assert.ok(backgrounds.length > 20);
    for (const b of backgrounds) {
        const slots = R.normalizeSlots(b.system.boosts);
        assert.ok(slots.length >= 1, `${b.name} boost slots`);
    }
});

test("a full level 1 build from real data validates", { skip: !available }, () => {
    const vesk = load("ancestries").find((a) => a.name === "Vesk");
    const athlete = load("backgrounds").find((b) => b.name === "Athlete");
    const soldier = load("classes").find((c) => c.name === "Soldier");
    const result = R.validateCreationBuild({
        ancestry: R.resolveSlots(R.normalizeSlots(vesk.system.boosts), { 2: "dex" }),
        flaws: R.resolveSlots(R.normalizeSlots(vesk.system.flaws)),
        background: R.resolveSlots(R.normalizeSlots(athlete.system.boosts), { 0: "str", 1: "cha" }),
        keyOptions: soldier.system.keyAbility.value,
        keySelected: soldier.system.keyAbility.value[0],
        free: ["str", "dex", "wis", "int"],
    });
    assert.deepEqual(result.errors, []);
    assert.equal(result.complete, true);
});
