/**
 * Spellcasting rules for the Starfinder 2e casters (mystic, technomancer, witchwarper).
 * Pure functions: the tables below mirror each class's "Spells per Day" table and repertoire/database text,
 * and are cross-checked against the system compendium in tests/compendium-data.test.mjs.
 */

export const CANTRIPS_KNOWN = 5;

/** Per-class spellcasting setup. `tag` is the otherTag of the class feature that sets tradition and free spells. */
export const SPELLCASTERS = {
    mystic: { casting: "spontaneous", tag: "mystic-connection", fixedTradition: null, feature: "connection" },
    witchwarper: { casting: "spontaneous", tag: "witchwarper-paradox", fixedTradition: null, feature: "paradox" },
    technomancer: {
        casting: "prepared",
        tag: "technomancer-programming-language",
        fixedTradition: "arcane",
        feature: "programming language",
    },
};

export const TRADITIONS = ["arcane", "divine", "occult", "primal"];

export const MAX_SPELL_RANK = 9;

const ORDINALS = { cantrip: 0, "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5, "6th": 6, "7th": 7, "8th": 8, "9th": 9 };

/** Highest spell rank a character of this level has slots for (10th-rank slots are a special class feature). */
export function highestRank(level) {
    return Math.min(MAX_SPELL_RANK, Math.ceil(level / 2));
}

/**
 * Spell slots per rank (1-9) for a level. The newest rank only has its smaller allotment on the levels where
 * it is first gained (odd levels); spontaneous casters get 3 -> 4, prepared casters 2 -> 3.
 */
export function slotsAtLevel(casting, level) {
    const slots = {};
    if (level < 1) return slots;
    const top = highestRank(level);
    const small = casting === "prepared" ? 2 : 3;
    const big = small + 1;
    for (let rank = 1; rank <= top; rank++) {
        slots[rank] = level % 2 === 1 && rank === top ? small : big;
    }
    return slots;
}

/**
 * What a caster chooses when reaching `level`, and which spells the class feature grants for free.
 *
 * Spontaneous (repertoire): at level 1 learn four cantrips and fill the 1st-rank slots' worth of spells, one of
 * which (and one cantrip) comes from the connection/paradox. Afterwards each new slot adds a spell of its rank,
 * and the first spell of a newly accessible rank is the connection/paradox spell.
 *
 * Prepared (spell database): level 1 starts with ten cantrips and five 1st-rank spells plus a spell from the
 * programming language; each level adds two spells of any rank you have slots for, plus one language spell on
 * gaining a new rank.
 *
 * @returns {{ groups: Array<{ key: string, rank: number|"any", count: number, maxRank?: number }>, granted: number[] }}
 *   `granted` lists the ranks (0 = cantrip) for which the class feature grants a spell now.
 */
export function spellPlan(casting, level) {
    if (level < 1) return { groups: [], granted: [] };
    const top = highestRank(level);
    const newRank = level === 1 || highestRank(level - 1) < top;
    const groups = [];
    const granted = [];

    if (casting === "prepared") {
        if (level === 1) {
            groups.push({ key: "cantrip", rank: 0, count: 10 }, { key: "rank-1", rank: 1, count: 5 });
        } else {
            groups.push({ key: "any", rank: "any", count: 2, maxRank: top });
        }
        if (newRank) granted.push(top);
        return { groups, granted };
    }

    const now = slotsAtLevel("spontaneous", level);
    const before = slotsAtLevel("spontaneous", level - 1);
    if (level === 1) {
        groups.push({ key: "cantrip", rank: 0, count: 4 });
        granted.push(0);
    }
    for (let rank = 1; rank <= top; rank++) {
        const added = (now[rank] ?? 0) - (before[rank] ?? 0);
        const freeOne = rank === top && newRank ? 1 : 0;
        const count = added - freeOne;
        if (count > 0) groups.push({ key: `rank-${rank}`, rank, count });
    }
    if (newRank) granted.push(top);
    return { groups, granted };
}

/** Total number of spells the player must still choose at a level. */
export function spellChoiceCount(casting, level) {
    return spellPlan(casting, level).groups.reduce((n, g) => n + g.count, 0);
}

/**
 * Parse "cantrip: @UUID[...]; 1st: @UUID[...]" lists out of a connection/paradox/programming-language
 * description. Only the first run (the connection/paradox/cache spell list) is used.
 * @returns {Record<number, string>} rank -> compendium UUID
 */
export function parseGrantedSpells(html) {
    const text = String(html ?? "").replace(/<[^>]+>/g, " ");
    const found = {};
    const pattern = /(cantrip|\d+(?:st|nd|rd|th)):\s*@UUID\[([^\]]+)\]/gi;
    let lastIndex = -1;
    for (const match of text.matchAll(pattern)) {
        const rank = ORDINALS[match[1].toLowerCase()];
        if (rank === undefined) continue;
        // Stop at the second list (focus spells use initial/advanced/greater, but guard against repeats anyway)
        if (rank in found) break;
        // Entries of one list are adjacent; a long gap means a new section
        if (lastIndex >= 0 && match.index - lastIndex > 400) break;
        found[rank] = match[2];
        lastIndex = match.index + match[0].length;
    }
    return found;
}

/** Tradition granted by a class feature's rules (`flags.system.<class>.tradition`). */
export function traditionFromRules(rules) {
    for (const rule of rules ?? []) {
        if (rule?.key === "ActiveEffectLike" && /\.tradition$/.test(rule.path ?? "") && TRADITIONS.includes(rule.value)) {
            return rule.value;
        }
    }
    return null;
}

/** Sluggify a display name the way compendium entries without slugs are keyed here. */
export function spellKey(name) {
    return String(name ?? "")
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

/**
 * Can a compendium spell index entry be chosen for a slot of the given rank?
 * @param {object} entry   index entry with `system.level`, `system.traits`
 * @param {object} filter  `{ tradition, rank, allowRare, taken, exact }` where taken is a Set of `${key}@${rank}`;
 *   `exact` limits rank 1+ choices to spells of exactly that rank (spell databases are not heightened)
 */
export function isSpellEligible(entry, { tradition, rank, allowRare = false, taken = new Set(), exact = false }) {
    const system = entry.system ?? {};
    const traits = system.traits?.value ?? [];
    const traditions = system.traits?.traditions ?? [];
    if (!traditions.includes(tradition)) return false;
    if (traits.includes("focus")) return false;

    const isCantrip = traits.includes("cantrip");
    if (rank === 0) {
        if (!isCantrip) return false;
    } else {
        if (isCantrip) return false;
        const level = system.level?.value ?? 1;
        if (level > rank || (exact && level !== rank)) return false;
    }

    const rarity = system.traits?.rarity ?? "common";
    if (!allowRare && rarity !== "common") return false;

    if (taken.has(`${spellKey(entry.name)}@${rank}`)) return false;
    return true;
}
