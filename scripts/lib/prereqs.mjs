/**
 * Feat prerequisite evaluation.
 *
 * Feat prerequisites in the sf2e compendium are free text ("trained in Crafting", "Constitution +2",
 * "Mine Exocortex", ...). This module parses the patterns that can be checked mechanically and reports each
 * prerequisite as `met`, `unmet`, or `unknown` (text we cannot verify, left to the player and GM).
 *
 * Pure functions only; the app gathers the character state into a context object.
 */

export const MET = "met";
export const UNMET = "unmet";
export const UNKNOWN = "unknown";

const RANKS = { trained: 1, expert: 2, master: 3, legendary: 4 };
const RANK_NAMES = ["untrained", "trained", "expert", "master", "legendary"];

const ATTRIBUTE_NAMES = {
    strength: "str",
    dexterity: "dex",
    constitution: "con",
    intelligence: "int",
    wisdom: "wis",
    charisma: "cha",
    str: "str",
    dex: "dex",
    con: "con",
    int: "int",
    wis: "wis",
    cha: "cha",
};

/** Normalize a name for comparison: lowercase, no punctuation, no leading articles. */
export function normalizeName(text) {
    return String(text ?? "")
        .toLowerCase()
        .replace(/[’']/g, "")
        .replace(/\(.*?\)/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/^(the|a|an) /, "")
        .trim();
}

/** Split "X, Y, or Z" / "X or Y" into its alternatives. */
function splitAlternatives(text) {
    return text
        .split(/,\s*(?:or\s+)?|\s+or\s+/i)
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * Evaluate one clause (no top-level "or") against the character.
 * @returns {{ status: string, reason?: string }}
 */
function evaluateClause(clause, ctx) {
    const text = clause.trim().replace(/\.$/, "");

    // "trained in Crafting", "expert in Athletics", "master in Perception", "trained in Crafting and Thievery"
    const skill = text.match(/^(trained|expert|master|legendary) in (.+)$/i);
    if (skill) {
        const rank = RANKS[skill[1].toLowerCase()];
        const check = (name) => {
            const slug = normalizeName(name).replace(/ /g, "-");
            if (slug !== "perception" && !ctx.skills?.has(slug)) return { status: UNKNOWN };
            const have = ctx.skillRanks?.[slug] ?? 0;
            return have >= rank
                ? { status: MET }
                : { status: UNMET, reason: `${skill[1].toLowerCase()} in ${name.trim()}` };
        };
        if (/\sand\s/i.test(skill[2]) && !/\sor\s/i.test(skill[2])) {
            return combineAll(skill[2].split(/\s+and\s+/i).map(check));
        }
        return combineAny(splitAlternatives(skill[2]).map(check));
    }

    // "Constitution +2", "Dex 14" is not used by the data; only modifiers are
    const attribute = text.match(/^([a-z]+)\s*\+?(\d+)$/i);
    if (attribute && ATTRIBUTE_NAMES[attribute[1].toLowerCase()]) {
        const key = ATTRIBUTE_NAMES[attribute[1].toLowerCase()];
        const needed = Number(attribute[2]);
        const have = Math.trunc(ctx.mods?.[key] ?? 0);
        return have >= needed ? { status: MET } : { status: UNMET, reason: `${key.toUpperCase()} +${needed}` };
    }

    // Named feat / feature / heritage: "Mine Exocortex", "Soldier Dedication", "Enshrined Vesk Heritage".
    // Class features are often stored without the descriptive suffix ("Mine" for "Mine Exocortex").
    const names = nameVariants(text);
    if (names.some((n) => ctx.ownedNames?.has(n))) return { status: MET };
    if (names.some((n) => ctx.knownNames?.has(n))) return { status: UNMET, reason: text };
    // A heritage or class feature we cannot see in our indexes: can't tell
    return { status: UNKNOWN };
}

const NAME_SUFFIXES = / (heritage|lineage|exocortex|programming language|connection|paradox)$/;

/** The normalized name plus the same name without a descriptive suffix. */
function nameVariants(text) {
    const full = normalizeName(text);
    const stripped = full.replace(NAME_SUFFIXES, "");
    return [...new Set([full, stripped])].filter(Boolean);
}

/** Combine requirements that must all hold. */
function combineAll(results) {
    const unmet = results.filter((r) => r.status === UNMET);
    if (unmet.length) return { status: UNMET, reason: unmet.map((r) => r.reason).filter(Boolean).join(" and ") };
    if (results.some((r) => r.status === UNKNOWN)) return { status: UNKNOWN };
    return { status: MET };
}

/** Combine alternatives: any met -> met; all definitively unmet -> unmet; otherwise unknown. */
function combineAny(results) {
    if (results.some((r) => r.status === MET)) return { status: MET };
    if (results.length && results.every((r) => r.status === UNMET)) {
        return { status: UNMET, reason: results.map((r) => r.reason).filter(Boolean).join(" or ") };
    }
    return { status: UNKNOWN };
}

/** Evaluate a single prerequisite string (may contain "or" alternatives between clauses). */
export function evaluatePrerequisite(text, ctx = {}) {
    const trimmed = String(text ?? "").trim();
    if (!trimmed) return { status: MET };

    // Skill rank prerequisites carry their own "X, Y, or Z" list; evaluate those whole
    if (/^(trained|expert|master|legendary) in /i.test(trimmed)) return evaluateClause(trimmed, ctx);

    // Otherwise, "A or B" are alternative clauses
    const clauses = trimmed.split(/\s+or\s+/i);
    return combineAny(clauses.map((c) => evaluateClause(c, ctx)));
}

/**
 * Evaluate every prerequisite of a feat (they must all be satisfied).
 * @param {string[]} prerequisites plain text prerequisites
 * @returns {{ status: string, unmet: string[], unknown: string[] }}
 */
export function evaluatePrerequisites(prerequisites, ctx = {}) {
    const unmet = [];
    const unknown = [];
    for (const text of prerequisites ?? []) {
        const result = evaluatePrerequisite(text, ctx);
        if (result.status === UNMET) unmet.push(result.reason || text);
        else if (result.status === UNKNOWN) unknown.push(text);
    }
    const status = unmet.length ? UNMET : unknown.length ? UNKNOWN : MET;
    return { status, unmet, unknown };
}

export { RANK_NAMES };
