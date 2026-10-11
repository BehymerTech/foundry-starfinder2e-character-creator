/**
 * Pure rules helpers for Starfinder 2e character creation and advancement.
 * Nothing in this file touches Foundry globals so it can be unit tested with plain Node.
 *
 * Where possible the numbers come from the sf2e system's own data (class items, ancestry items)
 * rather than being hard-coded here. The few constants below mirror the Player Core rules.
 */

export const ATTRIBUTES = ["str", "dex", "con", "int", "wis", "cha"];

/** Level at which each batch of four attribute boosts is gained. Level 1 is character creation. */
export const BOOST_LEVELS = [1, 5, 10, 15, 20];

/** Attribute modifier at which a boost only counts as a half-step ("partial boost", i.e. 18+ score). */
export const PARTIAL_BOOST_THRESHOLD = 4;

/** Highest attribute modifier allowed when finishing character creation (score 18). */
export const CREATION_MODIFIER_CAP = 4;

/** Number of free attribute boosts gained at level 1 and again at each of levels 5, 10, 15, and 20. */
export const FREE_BOOSTS_PER_BATCH = 4;

export const MAX_LEVEL = 20;

export const FEAT_CATEGORIES = ["ancestry", "class", "skill", "general"];

const RARITY_ORDER = ["common", "uncommon", "rare", "unique"];

/** Lowercase, hyphenated slug of a display name (the compendium rarely stores slugs). */
export function slugify(name) {
    return String(name ?? "")
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

/** Apply one boost to a modifier: +1 normally, +0.5 once the modifier is already +4 or higher. */
export function applyBoost(mod) {
    return mod + (mod >= PARTIAL_BOOST_THRESHOLD ? 0.5 : 1);
}

/**
 * Compute attribute modifiers the same way the system does: sections are applied in order, and
 * ancestry flaws land immediately after the ancestry boosts.
 * @param {Array<{ boosts?: string[], flaws?: string[] }>} sections
 * @returns {Record<string, number>}
 */
export function computeModifiers(sections) {
    const mods = Object.fromEntries(ATTRIBUTES.map((a) => [a, 0]));
    for (const section of sections) {
        for (const attr of section.boosts ?? []) if (attr in mods) mods[attr] = applyBoost(mods[attr]);
        for (const attr of section.flaws ?? []) if (attr in mods) mods[attr] -= 1;
    }
    return mods;
}

/**
 * Normalize an ancestry/background `system.boosts` or `system.flaws` object into a list of slots.
 * The system stores them as `{ "0": { value: ["str"], selected?: "str" }, ... }`.
 * A slot with a single option is fixed; one with several options is a choice.
 * @returns {Array<{ key: string, options: string[], fixed: boolean }>}
 */
export function normalizeSlots(raw) {
    return Object.entries(raw ?? {})
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([key, slot]) => {
            const options = (slot?.value ?? []).filter((a) => ATTRIBUTES.includes(a));
            return { key, options, fixed: options.length === 1 };
        })
        .filter((slot) => slot.options.length > 0);
}

/** Resolve the attribute for each slot given the player's picks (fixed slots resolve automatically). */
export function resolveSlots(slots, picks = {}) {
    return slots.map((slot) => ({
        ...slot,
        selected: slot.fixed ? slot.options[0] : slot.options.includes(picks[slot.key]) ? picks[slot.key] : null,
    }));
}

/**
 * Validate the level-1 attribute build.
 * Rules enforced (Player Core, character creation): each source gives boosts to different attributes, every
 * choice must be made, four free boosts go to four different attributes, and nothing may start above +4.
 *
 * @param {object} build
 * @param {Array} build.ancestry  resolved ancestry boost slots
 * @param {Array} build.flaws     resolved ancestry flaw slots
 * @param {Array} build.background resolved background boost slots
 * @param {string[]} build.keyOptions class key attribute options
 * @param {string|null} build.keySelected
 * @param {string[]} build.free   the four free boosts
 * @returns {{ errors: string[], mods: Record<string, number>, complete: boolean }}
 */
export function validateCreationBuild(build) {
    const errors = [];
    const ancestry = build.ancestry.map((s) => s.selected).filter(Boolean);
    const background = build.background.map((s) => s.selected).filter(Boolean);
    const flaws = build.flaws.map((s) => s.selected).filter(Boolean);
    const free = build.free ?? [];
    const key = build.keySelected ?? null;

    let complete = true;
    if (build.ancestry.some((s) => !s.selected)) complete = false;
    if (build.flaws.some((s) => !s.selected)) complete = false;
    if (build.background.some((s) => !s.selected)) complete = false;
    if (build.keyOptions.length > 0 && !key) complete = false;
    if (free.length !== FREE_BOOSTS_PER_BATCH) complete = false;

    if (new Set(ancestry).size !== ancestry.length) errors.push("ancestryDuplicate");
    if (new Set(background).size !== background.length) errors.push("backgroundDuplicate");
    if (new Set(free).size !== free.length) errors.push("freeDuplicate");

    const mods = computeModifiers([
        { boosts: ancestry, flaws },
        { boosts: background },
        { boosts: key ? [key] : [] },
        { boosts: free },
    ]);
    if (Object.values(mods).some((m) => m > CREATION_MODIFIER_CAP)) errors.push("overCap");

    return { errors, mods, complete: complete && errors.length === 0 };
}

/** Highest proficiency rank (0-4) a skill may reach at the given level via skill increases. */
export function maxSkillRankForLevel(level) {
    if (level >= 15) return 4;
    if (level >= 7) return 3;
    if (level >= 3) return 2;
    return 1;
}

/** Can a skill currently at `rank` take a skill increase when advancing to `newLevel`? */
export function canIncreaseSkill(rank, newLevel) {
    return rank < maxSkillRankForLevel(newLevel);
}

/**
 * Skills a new character may still choose: class "additional" skills plus Intelligence modifier.
 * Fractional modifiers (partial boosts) never occur at level 1, but truncate anyway.
 */
export function additionalSkillCount(additional, intMod) {
    return Math.max(0, (additional ?? 0) + Math.trunc(intMod ?? 0));
}

/**
 * Which feat slots open at a given level, according to the class item's own level tables.
 * @param {object} classSystem the class item's `system` data
 * @param {number} level
 * @returns {Array<{ category: string, level: number, id: string }>}
 */
export function featSlotsAtLevel(classSystem, level) {
    const tables = {
        ancestry: classSystem?.ancestryFeatLevels?.value,
        class: classSystem?.classFeatLevels?.value,
        skill: classSystem?.skillFeatLevels?.value,
        general: classSystem?.generalFeatLevels?.value,
    };
    return FEAT_CATEGORIES.filter((category) => (tables[category] ?? []).includes(level)).map((category) => ({
        category,
        level,
        id: `${category}-${level}`,
    }));
}

/** Does the class gain a skill increase when reaching this level? */
export function hasSkillIncrease(classSystem, level) {
    return (classSystem?.skillIncreaseLevels?.value ?? []).includes(level);
}

/** Does the character gain a batch of four attribute boosts at this level? */
export function hasAttributeBoosts(level) {
    return level > 1 && BOOST_LEVELS.includes(level);
}

/**
 * Is a compendium feat index entry selectable for a given slot?
 * @param {object} entry   index entry with `system.category`, `system.level.value`, `system.traits`
 * @param {object} slot    `{ category, level }`
 * @param {object} context `{ ancestrySlug, classSlug, allowRare, ownedSlugs }`
 */
export function isFeatEligible(entry, slot, context = {}) {
    const system = entry.system ?? {};
    const category = system.category;
    const featLevel = system.level?.value ?? 0;
    const traits = system.traits?.value ?? [];

    if (featLevel > slot.level) return false;

    switch (slot.category) {
        case "ancestry":
            if (category !== "ancestry") return false;
            if (!context.ancestrySlug || !traits.includes(context.ancestrySlug)) return false;
            break;
        case "class":
            if (category !== "class") return false;
            if (!context.classSlug || !traits.includes(context.classSlug)) return false;
            break;
        case "skill":
            if (category !== "skill") return false;
            break;
        case "general":
            if (category !== "general" && category !== "skill") return false;
            break;
        default:
            return false;
    }

    const rarity = system.traits?.rarity ?? "common";
    if (!context.allowRare && RARITY_ORDER.indexOf(rarity) > 0) return false;

    const slug = system.slug ?? slugify(entry.name);
    if (slug && context.ownedSlugs?.has(slug) && !system.maxTakable) return false;

    return true;
}

/** Plain-text prerequisites for display. */
export function prerequisiteText(entry) {
    return (entry.system?.prerequisites?.value ?? []).map((p) => p.value).filter(Boolean);
}

/** Expected HP gained by levelling up: class HP + Constitution modifier (never less than 1). */
export function hitPointsPerLevel(classHp, conMod) {
    return Math.max(1, (classHp ?? 0) + Math.trunc(conMod ?? 0));
}

/* -------------------------------------------- */
/*  Equipment shopping                          */
/* -------------------------------------------- */

/** Credits a new character may spend on starting gear. */
export const STARTING_CREDITS = 150;

/** Highest item level a new character may buy (common items of level 1 or lower). */
export const STARTING_ITEM_LEVEL = 1;

/**
 * Convert a stored price object to credits. The system stores credits as silver pieces (1 credit = 1 sp),
 * with copper at a tenth, gold at 10 and platinum at 100 credits; `credits` and `upb` count 1:1.
 */
export function priceInCredits(price) {
    const v = price?.value ?? price ?? {};
    const credits = (v.cp ?? 0) / 10 + (v.sp ?? 0) + (v.gp ?? 0) * 10 + (v.pp ?? 0) * 100 + (v.credits ?? 0) + (v.upb ?? 0);
    return Math.ceil(credits);
}

/** Number of units bundled in one purchase (e.g. ammunition sold in stacks of 10). */
export function purchaseUnit(price) {
    return Math.max(1, Number(price?.per ?? 1) || 1);
}

/** Cost in credits of buying `units` purchase units of an item. */
export function lineCost(price, units) {
    return priceInCredits(price) * Math.max(0, units);
}

/** Total cost of a cart of `{ price, units }` lines. */
export function cartTotal(lines) {
    return lines.reduce((sum, line) => sum + lineCost(line.price, line.units), 0);
}

/** Can a purchasable index entry be bought by a new character? */
export function isStarterItem(entry, { maxLevel = STARTING_ITEM_LEVEL, allowRare = false } = {}) {
    const system = entry.system ?? {};
    if (priceInCredits(system.price) <= 0) return false;
    if ((system.level?.value ?? 0) > maxLevel) return false;
    const rarity = system.traits?.rarity ?? "common";
    if (!allowRare && rarity !== "common") return false;
    return true;
}

/** Broad shop category for an equipment index entry (by item type). */
export function shopCategory(type) {
    switch (type) {
        case "weapon":
            return "weapons";
        case "armor":
            return "armor";
        case "shield":
            return "shields";
        case "consumable":
        case "ammo":
            return "consumables";
        default:
            return "gear";
    }
}
