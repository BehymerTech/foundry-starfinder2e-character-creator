/**
 * Read-only access to the sf2e system compendiums.
 * Nothing is copied: we index the system's own packs at runtime and reference entries by UUID.
 */

export const MODULE_ID = "sf2e-character-creator";

/** Pack names inside the `sf2e` system (see `packs/sf2e/*` in the system repository). */
const PACKS = {
    ancestry: "sf2e.ancestries",
    heritage: "sf2e.heritages",
    background: "sf2e.backgrounds",
    class: "sf2e.classes",
    feat: "sf2e.feats",
    spell: "sf2e.spells",
    equipment: "sf2e.equipment",
    classfeature: "sf2e.class-features",
    ancestryfeature: "sf2e.ancestry-features",
};

const INDEX_FIELDS = {
    ancestry: ["system.hp", "system.boosts", "system.flaws", "system.speed", "system.size", "system.slug", "system.traits", "system.publication"],
    heritage: ["system.ancestry", "system.slug", "system.traits", "system.publication"],
    background: ["system.boosts", "system.trainedSkills", "system.slug", "system.traits", "system.publication"],
    class: [
        "system.hp",
        "system.keyAbility",
        "system.slug",
        "system.trainedSkills",
        "system.traits",
        "system.publication",
        "system.ancestryFeatLevels",
        "system.classFeatLevels",
        "system.skillFeatLevels",
        "system.generalFeatLevels",
        "system.skillIncreaseLevels",
    ],
    feat: [
        "system.category",
        "system.level",
        "system.slug",
        "system.traits",
        "system.prerequisites",
        "system.actionType",
        "system.actions",
        "system.publication",
        "system.maxTakable",
    ],
    spell: ["system.level", "system.slug", "system.traits", "system.time", "system.range", "system.publication"],
    equipment: [
        "system.level",
        "system.price",
        "system.bulk",
        "system.traits",
        "system.category",
        "system.group",
        "system.publication",
    ],
    classfeature: [],
    ancestryfeature: [],
};

const cache = new Map();

/** Load (and cache) the index of one compendium kind. Resolves to an array of index entries. */
export async function loadIndex(kind) {
    if (cache.has(kind)) return cache.get(kind);
    const pack = game.packs.get(PACKS[kind]);
    if (!pack) {
        console.warn(`${MODULE_ID} | Compendium ${PACKS[kind]} not found. Is the sf2e system active?`);
        cache.set(kind, []);
        return [];
    }
    const index = await pack.getIndex({ fields: INDEX_FIELDS[kind] });
    const entries = Array.from(index.values()).sort((a, b) => a.name.localeCompare(b.name));
    cache.set(kind, entries);
    return entries;
}

/** Sluggify the way the system does for display-name -> slug fallbacks. */
export function slugOf(entry) {
    return (
        entry.system?.slug ??
        entry.name
            .toLowerCase()
            .replace(/['’]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
    );
}

/** Heritages for an ancestry: the ancestry's own heritages plus versatile heritages (no ancestry set). */
export async function heritagesFor(ancestryEntry) {
    const slug = slugOf(ancestryEntry);
    const all = await loadIndex("heritage");
    const own = all.filter((h) => h.system?.ancestry?.slug === slug);
    const versatile = all.filter((h) => !h.system?.ancestry);
    return { own, versatile };
}

export function featIndex() {
    return loadIndex("feat");
}

/** Normalized names of every feat, feature, and heritage in the system, for prerequisite checks. */
let knownNames = null;
export async function loadKnownNames(normalize) {
    if (knownNames) return knownNames;
    const kinds = ["feat", "classfeature", "ancestryfeature", "heritage"];
    const lists = await Promise.all(kinds.map((kind) => loadIndex(kind)));
    knownNames = new Set(lists.flat().map((entry) => normalize(entry.name)));
    return knownNames;
}

/** Fetch full documents, caching by UUID so steps don't re-fetch. */
const docCache = new Map();
export async function getDoc(uuid) {
    if (!uuid) return null;
    if (!docCache.has(uuid)) docCache.set(uuid, fromUuid(uuid));
    return docCache.get(uuid);
}

/** Clone a compendium document into plain source data that can be created on an actor. */
export async function sourceOf(uuid) {
    const doc = await getDoc(uuid);
    if (!doc) throw new Error(`${MODULE_ID} | Could not resolve ${uuid}`);
    const source = doc.toObject();
    source._stats ??= {};
    source._stats.compendiumSource = uuid;
    delete source._id;
    return source;
}

export function clearCaches() {
    knownNames = null;
    cache.clear();
    docCache.clear();
}
