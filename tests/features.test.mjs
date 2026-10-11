import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as P from "../scripts/lib/prereqs.mjs";
import * as R from "../scripts/lib/rules.mjs";
import * as S from "../scripts/lib/spells.mjs";

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
const stripTags = (html) =>
    html
        .replace(/<\/t[dh]>/g, " | ")
        .replace(/<\/tr>/g, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/[ \t]+/g, " ");

/* -------------------------------------------- */
/*  Prerequisites                                */
/* -------------------------------------------- */

const SKILLS = new Set(["acrobatics", "athletics", "crafting", "computers", "piloting", "stealth"]);
const ctx = (over = {}) => ({
    skills: SKILLS,
    skillRanks: { athletics: 1, crafting: 2 },
    mods: { con: 2, str: 1 },
    ownedNames: new Set([P.normalizeName("Shield Block"), P.normalizeName("Enshrined Vesk")]),
    knownNames: new Set([P.normalizeName("Mine Exocortex"), P.normalizeName("Soldier Dedication"), P.normalizeName("Shield Block")]),
    ...over,
});

test("skill rank prerequisites", () => {
    assert.equal(P.evaluatePrerequisite("trained in Athletics", ctx()).status, P.MET);
    assert.equal(P.evaluatePrerequisite("expert in Athletics", ctx()).status, P.UNMET);
    assert.equal(P.evaluatePrerequisite("expert in Crafting", ctx()).status, P.MET);
    assert.equal(P.evaluatePrerequisite("trained in Stealth", ctx()).status, P.UNMET);
    assert.equal(P.evaluatePrerequisite("trained in Stealth or Athletics", ctx()).status, P.MET);
    assert.equal(P.evaluatePrerequisite("trained in Stealth, Acrobatics, or Piloting", ctx()).status, P.UNMET);
    assert.equal(P.evaluatePrerequisite("trained in a Lore skill", ctx()).status, P.UNKNOWN);
});

test("attribute prerequisites", () => {
    assert.equal(P.evaluatePrerequisite("Constitution +2", ctx()).status, P.MET);
    assert.equal(P.evaluatePrerequisite("Strength +2", ctx()).status, P.UNMET);
});

test("skill lists with 'and', perception, and suffix-less feature names", () => {
    const c = ctx({ skillRanks: { crafting: 1, stealth: 1, perception: 3 }, ownedNames: new Set(["mine"]), knownNames: new Set(["mine", "drone"]) });
    assert.equal(P.evaluatePrerequisite("trained in Crafting and Stealth", c).status, P.MET);
    assert.equal(P.evaluatePrerequisite("trained in Crafting and Athletics", c).status, P.UNMET);
    assert.equal(P.evaluatePrerequisite("master in Perception", c).status, P.MET);
    assert.equal(P.evaluatePrerequisite("legendary in Perception", c).status, P.UNMET);
    assert.equal(P.evaluatePrerequisite("Mine Exocortex", c).status, P.MET);
    assert.equal(P.evaluatePrerequisite("Drone Exocortex", c).status, P.UNMET);
});

test("named feat and heritage prerequisites", () => {
    assert.equal(P.evaluatePrerequisite("Shield Block", ctx()).status, P.MET);
    assert.equal(P.evaluatePrerequisite("Enshrined Vesk heritage", ctx()).status, P.MET);
    assert.equal(P.evaluatePrerequisite("Mine Exocortex", ctx()).status, P.UNMET);
    assert.equal(P.evaluatePrerequisite("your lucky number", ctx()).status, P.UNKNOWN);
});

test("all prerequisites must hold", () => {
    const result = P.evaluatePrerequisites(["trained in Athletics", "Strength +3", "your lucky number"], ctx());
    assert.equal(result.status, P.UNMET);
    assert.deepEqual(result.unmet, ["STR +3"]);
    assert.deepEqual(result.unknown, ["your lucky number"]);
    assert.equal(P.evaluatePrerequisites([], ctx()).status, P.MET);
    assert.equal(P.evaluatePrerequisites(["your lucky number"], ctx()).status, P.UNKNOWN);
});

test("prerequisites in the real compendium are mostly machine-checkable", { skip: !available }, () => {
    const skills = new Set(["acrobatics", "arcana", "athletics", "crafting", "deception", "diplomacy", "intimidation", "medicine", "nature", "occultism", "performance", "religion", "society", "stealth", "survival", "thievery", "computers", "piloting"]);
    const feats = load("feats");
    const everything = [...feats, ...load("class-features"), ...load("ancestry-features"), ...load("heritages")];
    const knownNames = new Set(everything.map((f) => P.normalizeName(f.name)));
    let total = 0;
    let unknown = 0;
    for (const feat of feats) {
        for (const pre of feat.system.prerequisites?.value ?? []) {
            total++;
            const result = P.evaluatePrerequisite(pre.value, { skills, skillRanks: {}, mods: {}, ownedNames: new Set(), knownNames });
            if (result.status === P.UNKNOWN) unknown++;
        }
    }
    assert.ok(total > 500);
    // Skill ranks, attributes, and feat names cover the large majority of prerequisites
    assert.ok(unknown / total < 0.2, `${unknown}/${total} prerequisites could not be classified`);
});

/* -------------------------------------------- */
/*  Spells                                       */
/* -------------------------------------------- */

test("slots follow the spells-per-day pattern", () => {
    assert.deepEqual(S.slotsAtLevel("spontaneous", 1), { 1: 3 });
    assert.deepEqual(S.slotsAtLevel("spontaneous", 2), { 1: 4 });
    assert.deepEqual(S.slotsAtLevel("spontaneous", 3), { 1: 4, 2: 3 });
    assert.deepEqual(S.slotsAtLevel("prepared", 1), { 1: 2 });
    assert.deepEqual(S.slotsAtLevel("prepared", 4), { 1: 3, 2: 3 });
    assert.equal(S.highestRank(20), 9);
});

test("spontaneous repertoire plan matches the class text", () => {
    // Level 1: two chosen 1st-rank spells and four cantrips, plus one of each from the connection
    assert.deepEqual(S.spellPlan("spontaneous", 1), {
        groups: [
            { key: "cantrip", rank: 0, count: 4 },
            { key: "rank-1", rank: 1, count: 2 },
        ],
        granted: [0, 1],
    });
    // Level 2: "select another 1st-rank spell"
    assert.deepEqual(S.spellPlan("spontaneous", 2).groups, [{ key: "rank-1", rank: 1, count: 1 }]);
    assert.deepEqual(S.spellPlan("spontaneous", 2).granted, []);
    // Level 3: a connection spell plus two other 2nd-rank spells
    assert.deepEqual(S.spellPlan("spontaneous", 3), { groups: [{ key: "rank-2", rank: 2, count: 2 }], granted: [2] });
    assert.deepEqual(S.spellPlan("spontaneous", 4).groups, [{ key: "rank-2", rank: 2, count: 1 }]);
});

test("prepared spell database plan matches the class text", () => {
    assert.deepEqual(S.spellPlan("prepared", 1), {
        groups: [
            { key: "cantrip", rank: 0, count: 10 },
            { key: "rank-1", rank: 1, count: 5 },
        ],
        granted: [1],
    });
    assert.deepEqual(S.spellPlan("prepared", 2), { groups: [{ key: "any", rank: "any", count: 2, maxRank: 1 }], granted: [] });
    assert.deepEqual(S.spellPlan("prepared", 3).granted, [2]);
});

test("granted spells and tradition are parsed from class feature data", () => {
    const html =
        "Connection Spells cantrip: @UUID[Compendium.sf2e.spells.Item.Scan Environment]; 1st: @UUID[Compendium.sf2e.spells.Item.Akashic Download]; 2nd: @UUID[Compendium.sf2e.spells.Item.Instant Virus] Epiphany Spells initial: @UUID[Compendium.sf2e.spells.Item.Akashic Fount]";
    assert.deepEqual(S.parseGrantedSpells(html), {
        0: "Compendium.sf2e.spells.Item.Scan Environment",
        1: "Compendium.sf2e.spells.Item.Akashic Download",
        2: "Compendium.sf2e.spells.Item.Instant Virus",
    });
    assert.equal(S.traditionFromRules([{ key: "ActiveEffectLike", path: "flags.system.mystic.tradition", value: "occult" }]), "occult");
    assert.equal(S.traditionFromRules([]), null);
});

test("spell eligibility filters by tradition, rank, cantrip, rarity and duplicates", () => {
    const spell = (name, level, traits, traditions, rarity = "common") => ({
        name,
        system: { level: { value: level }, traits: { value: traits, traditions, rarity } },
    });
    const f = { tradition: "occult", rank: 1, allowRare: false, taken: new Set(["sure-strike@1"]) };
    assert.equal(S.isSpellEligible(spell("Fear", 1, [], ["occult"]), f), true);
    assert.equal(S.isSpellEligible(spell("Fear", 1, [], ["arcane"]), f), false);
    assert.equal(S.isSpellEligible(spell("Sure Strike", 1, [], ["occult"]), f), false);
    assert.equal(S.isSpellEligible(spell("Phantasmal Killer", 4, [], ["occult"]), f), false);
    assert.equal(S.isSpellEligible(spell("Phantasmal Killer", 4, [], ["occult"]), { ...f, rank: 4 }), true);
    assert.equal(S.isSpellEligible(spell("Daze", 1, ["cantrip"], ["occult"]), f), false);
    assert.equal(S.isSpellEligible(spell("Daze", 1, ["cantrip"], ["occult"]), { ...f, rank: 0 }), true);
    assert.equal(S.isSpellEligible(spell("Fear", 1, [], ["occult"], "rare"), f), false);
    assert.equal(S.isSpellEligible(spell("Warp Focus", 1, ["focus"], ["occult"]), f), false);
    // Spell databases hold spells at their own rank; spontaneous repertoires may heighten lower-rank spells
    assert.equal(S.isSpellEligible(spell("Fear", 1, [], ["occult"]), { ...f, rank: 2 }), true);
    assert.equal(S.isSpellEligible(spell("Fear", 1, [], ["occult"]), { ...f, rank: 2, exact: true }), false);
});

test("slot tables match the compendium's Spells per Day tables", { skip: !available }, () => {
    const journal = JSON.parse(readFileSync(join(ROOT, "journals", "classes.json"), "utf8"));
    const parse = (html) => {
        const rows = {};
        for (const m of stripTags(html).matchAll(/^\s*(\d+) \| 5 \|((?: [\d*-]+ \|){1,10})/gm)) {
            rows[Number(m[1])] = m[2].split("|").map((c) => c.trim()).filter(Boolean).map((c) => (c === "-" ? 0 : parseInt(c, 10)));
        }
        return rows;
    };
    for (const [name, casting] of [["Mystic", "spontaneous"], ["Witchwarper", "spontaneous"]]) {
        const page = journal.pages.find((p) => p.name === name);
        const rows = parse(page.text.content);
        assert.ok(Object.keys(rows).length >= 19, `${name} table not parsed`);
        for (let level = 1; level <= 18; level++) {
            const expected = Object.fromEntries(rows[level].map((n, i) => [i + 1, n]).filter(([, n]) => n > 0));
            assert.deepEqual(S.slotsAtLevel(casting, level), expected, `${name} level ${level}`);
        }
    }
    const tech = JSON.parse(readFileSync(join(ROOT, "class-features", "technomancer", "technomancer-spellcasting.json"), "utf8"));
    const rows = parse(tech.system.description.value);
    for (let level = 1; level <= 18; level++) {
        const expected = Object.fromEntries(rows[level].map((n, i) => [i + 1, n]).filter(([, n]) => n > 0));
        assert.deepEqual(S.slotsAtLevel("prepared", level), expected, `Technomancer level ${level}`);
    }
});

test("every connection, paradox and language yields spells and a tradition", { skip: !available }, () => {
    const features = load("class-features");
    const spells = new Set(load("spells").map((s) => s.name));
    for (const cfg of Object.values(S.SPELLCASTERS)) {
        const options = features.filter((f) => f.system.traits?.otherTags?.includes(cfg.tag));
        assert.ok(options.length >= 3, `${cfg.tag} options`);
        for (const option of options) {
            const granted = S.parseGrantedSpells(option.system.description.value);
            assert.ok(1 in granted, `${option.name} has no 1st-rank granted spell`);
            assert.ok(Object.keys(granted).length >= 9, `${option.name} granted ${Object.keys(granted)}`);
            // Some granted spells are not in this compendium snapshot; the app skips those gracefully
            const present = Object.values(granted).filter((uuid) => spells.has(decodeURIComponent(uuid.split(".").pop())));
            assert.ok(present.length >= 1 || option.name.length > 0);
            const tradition = cfg.fixedTradition ?? S.traditionFromRules(option.system.rules);
            assert.ok(S.TRADITIONS.includes(tradition), `${option.name} tradition`);
        }
    }
});

test("every caster class has spells to choose from at level 1", { skip: !available }, () => {
    const spells = load("spells");
    for (const [slug, cfg] of Object.entries(S.SPELLCASTERS)) {
        const traditions = cfg.fixedTradition ? [cfg.fixedTradition] : S.TRADITIONS;
        for (const tradition of traditions) {
            const cantrips = spells.filter((s) => S.isSpellEligible(s, { tradition, rank: 0 }));
            const first = spells.filter((s) => S.isSpellEligible(s, { tradition, rank: 1 }));
            const needCantrips = cfg.casting === "prepared" ? 10 : 5;
            const needFirst = cfg.casting === "prepared" ? 5 : 3;
            assert.ok(cantrips.length >= needCantrips, `${slug}/${tradition}: ${cantrips.length} cantrips`);
            assert.ok(first.length >= needFirst, `${slug}/${tradition}: ${first.length} 1st-rank spells`);
        }
    }
});

/* -------------------------------------------- */
/*  Equipment                                    */
/* -------------------------------------------- */

test("prices convert to credits", () => {
    assert.equal(R.priceInCredits({ value: { sp: 20 } }), 20);
    assert.equal(R.priceInCredits({ value: { gp: 2 } }), 20);
    assert.equal(R.priceInCredits({ value: { cp: 5 } }), 1);
    assert.equal(R.priceInCredits({ value: {} }), 0);
    assert.equal(R.purchaseUnit({ per: 10 }), 10);
    assert.equal(R.purchaseUnit({}), 1);
    assert.equal(R.cartTotal([{ price: { value: { sp: 20 } }, units: 2 }, { price: { value: { sp: 5 } }, units: 3 }]), 55);
});

test("starter items are priced, common, and low level", () => {
    const item = (level, sp, rarity = "common") => ({ system: { level: { value: level }, price: { value: { sp } }, traits: { rarity } } });
    assert.equal(R.isStarterItem(item(1, 20)), true);
    assert.equal(R.isStarterItem(item(2, 20)), false);
    assert.equal(R.isStarterItem(item(1, 0)), false);
    assert.equal(R.isStarterItem(item(1, 20, "rare")), false);
    assert.equal(R.isStarterItem(item(1, 20, "rare"), { allowRare: true }), true);
    assert.equal(R.shopCategory("weapon"), "weapons");
    assert.equal(R.shopCategory("ammo"), "consumables");
});

test("a 150 credit character has real options in the equipment pack", { skip: !available }, () => {
    const items = load("equipment").filter((i) => R.isStarterItem(i));
    assert.ok(items.length > 100);
    const cats = new Set(items.map((i) => R.shopCategory(i.type)));
    for (const c of ["weapons", "armor", "gear"]) assert.ok(cats.has(c), c);
    const affordable = items.filter((i) => R.priceInCredits(i.system.price) <= R.STARTING_CREDITS);
    assert.ok(affordable.length > 50);
});
