import {
    MODULE_ID,
    featIndex,
    getDoc,
    heritagesFor,
    loadIndex,
    loadKnownNames,
    slugOf,
} from "../lib/compendium.mjs";
import { evaluatePrerequisites, normalizeName } from "../lib/prereqs.mjs";
import {
    ATTRIBUTES,
    FREE_BOOSTS_PER_BATCH,
    MAX_LEVEL,
    additionalSkillCount,
    applyBoost,
    cartTotal,
    featSlotsAtLevel,
    hasAttributeBoosts,
    hasSkillIncrease,
    isFeatEligible,
    isStarterItem,
    lineCost,
    normalizeSlots,
    prerequisiteText,
    purchaseUnit,
    resolveSlots,
    shopCategory,
    validateCreationBuild,
} from "../lib/rules.mjs";
import {
    SPELLCASTERS,
    isSpellEligible,
    parseGrantedSpells,
    spellKey,
    spellPlan,
    traditionFromRules,
} from "../lib/spells.mjs";
import {
    applyCreation,
    applyLevelUp,
    applyPurchases,
    applySpells,
    completeSetupStep,
    getPendingSetup,
    setPendingSetup,
} from "./apply.mjs";
import { STEP_VIEWS, esc, t } from "./views.mjs";

const { ApplicationV2 } = foundry.applications.api;

const CREATE_STEPS = ["ancestry", "heritage", "background", "class", "attributes", "skills", "feats", "review"];

/** Steps whose view is a gallery with an info pane. */
const DETAIL_STEPS = new Set(["ancestry", "heritage", "background", "class", "feats", "overview", "spells", "equipment"]);

const instances = new Map();

export class CharacterCreatorApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
        classes: ["sf2e-cc"],
        tag: "div",
        window: { icon: "fa-solid fa-user-astronaut", resizable: true },
        position: { width: 1100, height: 760 },
    };

    /** Which flow an actor needs: finish a half-set-up character, level one up, or build from scratch. */
    static modeFor(actor) {
        if (getPendingSetup(actor).length) return "setup";
        return actor?.class ? "levelup" : "create";
    }

    /**
     * Open the wizard. With no actor it starts a brand new character; with an actor lacking a class it
     * finishes creating that character; with a classed actor it levels them up by one.
     */
    static open(actor = null) {
        const key = actor?.uuid ?? "new";
        const existing = instances.get(key);
        if (existing?.rendered) return existing.bringToFront();
        if (actor && actor.type !== "character") {
            ui.notifications.warn(t("NotACharacter"));
            return null;
        }
        if (CharacterCreatorApp.modeFor(actor) === "levelup" && actor.level >= MAX_LEVEL) {
            ui.notifications.info(t("MaxLevel"));
            return null;
        }
        const app = new CharacterCreatorApp({ id: `${MODULE_ID}-${actor?.id ?? "new"}-${foundry.utils.randomID(4)}` }, actor);
        instances.set(key, app);
        app.render({ force: true });
        return app;
    }

    constructor(options, actor) {
        super(options);
        this.actor = actor;
        this.instanceKey = actor?.uuid ?? "new";
        this.mode = CharacterCreatorApp.modeFor(actor);
        this.target = this.mode === "levelup" ? actor.level + 1 : this.mode === "setup" ? actor.level : 1;
        this.setupSteps = this.mode === "setup" ? getPendingSetup(actor) : [];
        this.built = this.mode === "setup";
        this.stepIndex = 0;
        this.busy = false;
        this.name = actor?.name ?? "";
        this.allowRare = game.settings.get(MODULE_ID, "allowRare");
        this.showUnqualified = false;
        this.searchText = "";
        this.detailUuid = null;

        this.lists = { ancestry: [], heritage: { own: [], versatile: [] }, background: [], class: [] };
        this.picks = { ancestry: null, heritage: null, background: null, class: null };
        this.entries = {};
        this.docs = {};
        this.boostPicks = { ancestry: {}, flaws: {}, background: {}, key: null, free: [] };
        this.skillPicks = new Set();
        this.featPicks = {};
        this.candidates = {};
        this.prereqStatus = {};
        this.lu = { boosts: [], skill: null };
        this.noHeritage = false;

        // Spells
        this.spell = null;
        this.spellPicks = {};
        this.anyRank = 1;
        this.traditionOverride = null;

        // Equipment
        this.shopItems = [];
        this.shopCategory = "weapons";
        this.cart = new Map();
    }

    get title() {
        if (this.mode === "levelup") return t("TitleLevelUp", { name: this.actor.name, level: this.target });
        if (this.mode === "setup") return t("TitleSetup", { name: this.actor.name });
        return t("TitleCreate");
    }

    /* -------------------------------------------- */
    /*  Derived state                               */
    /* -------------------------------------------- */

    get steps() {
        if (this.mode === "setup") return this.setupSteps;
        if (this.mode === "create") return [...CREATE_STEPS, ...this.plannedSetup];
        const steps = ["overview"];
        if (hasAttributeBoosts(this.target)) steps.push("attributes");
        if (this.hasSkillIncrease) steps.push("skills");
        if (this.featSlots.length) steps.push("feats");
        if (this.levelUpHasSpells) steps.push("spells");
        steps.push("review");
        return steps;
    }

    /** Steps that follow building the character: spells for casters, then shopping. */
    get plannedSetup() {
        return this.casterConfig ? ["spells", "equipment"] : ["equipment"];
    }

    get stepId() {
        return this.steps[this.stepIndex];
    }

    /** Index of the first step the player can still go back to. */
    get minStepIndex() {
        return this.mode === "create" && this.built ? CREATE_STEPS.length : 0;
    }

    /** Are we past the point where the character exists and each step writes to it immediately? */
    get inSetupPhase() {
        return this.mode === "setup" || (this.mode === "create" && this.built && this.stepIndex >= CREATE_STEPS.length);
    }

    get classSystem() {
        if (this.mode === "create") return this.docs.class?._source.system;
        return this.actor?.class?._source.system;
    }

    get classSlug() {
        if (this.mode === "create") return this.entries.class ? slugOf(this.entries.class) : null;
        return this.actor?.class?.slug ?? null;
    }

    get casterConfig() {
        if (!this.classSystem?.spellcasting) return null;
        return SPELLCASTERS[this.classSlug] ?? null;
    }

    get spellLevel() {
        return this.mode === "levelup" ? this.target : (this.actor?.level ?? 1);
    }

    get levelUpHasSpells() {
        const cfg = this.mode === "levelup" ? this.casterConfig : null;
        if (!cfg) return false;
        const plan = spellPlan(cfg.casting, this.target);
        return plan.groups.length > 0;
    }

    get hasSkillIncrease() {
        return this.mode === "levelup" && hasSkillIncrease(this.classSystem, this.target);
    }

    get build() {
        const ancestry = this.docs.ancestry?._source.system;
        const background = this.docs.background?._source.system;
        const keyOptions = this.classSystem?.keyAbility?.value ?? [];
        return {
            ancestry: resolveSlots(normalizeSlots(ancestry?.boosts), this.boostPicks.ancestry),
            flaws: resolveSlots(normalizeSlots(ancestry?.flaws), this.boostPicks.flaws),
            background: resolveSlots(normalizeSlots(background?.boosts), this.boostPicks.background),
            keyOptions,
            keySelected:
                keyOptions.length === 1 ? keyOptions[0] : keyOptions.includes(this.boostPicks.key) ? this.boostPicks.key : null,
            free: this.boostPicks.free,
        };
    }

    get validation() {
        return validateCreationBuild(this.build);
    }

    get currentMods() {
        const abilities = this.actor?.abilities;
        return Object.fromEntries(ATTRIBUTES.map((a) => [a, abilities?.[a]?.mod ?? 0]));
    }

    get classHp() {
        return this.actor?.class?.system.hp ?? 0;
    }

    get newFeatures() {
        const items = Object.values(this.actor?.class?._source.system.items ?? {});
        return items.filter((i) => i.level === this.target).map((i) => ({ name: i.name, img: i.img, uuid: i.uuid }));
    }

    /** Skills chosen at creation: trained by class/background, plus how many more the player picks. */
    get skillInfo() {
        const fixed = new Map();
        for (const slug of this.docs.background?._source.system.trainedSkills?.value ?? []) fixed.set(slug, "background");
        for (const slug of this.docs.class?._source.system.trainedSkills?.value ?? []) fixed.set(slug, "class");
        const additional = this.docs.class?._source.system.trainedSkills?.additional ?? 0;
        return {
            fixed,
            total: additionalSkillCount(additional, this.validation.mods.int),
            lore: this.docs.background?._source.system.trainedSkills?.lore ?? [],
        };
    }

    /** Skills eligible for a level-up skill increase, including lore skills the character owns. */
    get skillOptions() {
        const actor = this.actor;
        if (!actor) return [];
        const core = Object.keys(CONFIG.PF2E.skills).map((key) => {
            const skill = actor.skills?.[key];
            return { key, label: skill?.label ?? key, rank: skill?.rank ?? 0, lore: null };
        });
        const lore = actor.itemTypes.lore.map((item) => ({
            key: item.slug ?? item.id,
            label: item.name,
            rank: item.system.proficient?.value ?? 0,
            lore: item.id,
        }));
        return [...core, ...lore];
    }

    get featSlots() {
        const system = this.classSystem;
        if (!system || this.mode === "setup") return [];
        const slots = featSlotsAtLevel(system, this.target);
        if (this.mode === "create") return slots;
        const filled = new Set(this.actor.itemTypes.feat.map((f) => f.system.location));
        return slots.filter((slot) => !filled.has(slot.id));
    }

    /* Equipment */

    get credits() {
        return game.settings.get(MODULE_ID, "startingCredits");
    }

    get cartLines() {
        return [...this.cart.values()].map(({ entry, units }) => ({
            entry,
            units,
            price: entry.system.price,
            cost: lineCost(entry.system.price, units),
        }));
    }

    get spent() {
        return cartTotal(this.cartLines);
    }

    get remaining() {
        return this.credits - this.spent;
    }

    get visibleShopItems() {
        return this.shopItems.filter((e) => shopCategory(e.type) === this.shopCategory);
    }

    #stepComplete(id) {
        switch (id) {
            case "ancestry":
            case "background":
            case "class":
                return !!this.picks[id];
            case "heritage":
                return !!this.picks.heritage || this.noHeritage;
            case "attributes":
                return this.mode === "levelup" ? this.lu.boosts.length === FREE_BOOSTS_PER_BATCH : this.validation.complete;
            case "skills":
                return this.mode === "levelup" ? !!this.lu.skill : this.skillPicks.size === this.skillInfo.total;
            case "feats":
                return this.featSlots.every((slot) => this.featPicks[slot.id]);
            case "spells":
                return this.#spellsComplete();
            case "review":
                return this.mode === "levelup" || this.name.trim().length > 0;
            default:
                return true;
        }
    }

    #spellsComplete() {
        const sp = this.spell;
        if (!sp) return false;
        if (!sp.tradition) return false;
        return sp.plan.groups.every((group) => {
            const picked = this.spellPicks[group.key]?.length ?? 0;
            const available = (sp.candidates[group.key]?.length ?? 0) + picked;
            return picked >= Math.min(group.count, available);
        });
    }

    /** Drop any picks that no longer make sense after an upstream change. */
    #reconcile() {
        const total = this.mode === "create" ? this.skillInfo.total : 0;
        const fixed = this.skillInfo.fixed;
        const kept = [...this.skillPicks].filter((s) => !fixed.has(s)).slice(0, total);
        this.skillPicks = new Set(kept);

        const slotIds = new Set(this.featSlots.map((s) => s.id));
        for (const id of Object.keys(this.featPicks)) if (!slotIds.has(id)) delete this.featPicks[id];
    }

    /* -------------------------------------------- */
    /*  Rendering                                   */
    /* -------------------------------------------- */

    async _prepareContext() {
        const id = this.stepId;
        if (this.mode === "create" && !this.built) {
            if (id === "ancestry") this.lists.ancestry = await loadIndex("ancestry");
            if (id === "heritage" && this.entries.ancestry) {
                this.lists.heritage = await heritagesFor(this.entries.ancestry);
                const { own, versatile } = this.lists.heritage;
                this.noHeritage = own.length === 0 && versatile.length === 0;
            }
            if (id === "background") this.lists.background = await loadIndex("background");
            if (id === "class") this.lists.class = await loadIndex("class");
        }
        if (id === "feats") await this.#computeCandidates();
        if (id === "spells") await this.#prepareSpells();
        if (id === "equipment") await this.#prepareShop();
        return {};
    }

    /** Gather everything about the character-in-progress that feat prerequisites can refer to. */
    async #prereqContext() {
        const knownNames = await loadKnownNames(normalizeName);
        const skills = new Set(Object.keys(CONFIG.PF2E.skills));
        const skillRanks = {};
        let mods;
        const owned = new Set();
        const addName = (name) => name && owned.add(normalizeName(name));

        if (this.mode === "create") {
            for (const slug of this.skillInfo.fixed.keys()) skillRanks[slug] = 1;
            for (const slug of this.skillPicks) skillRanks[slug] = 1;
            skillRanks.perception = this.classSystem?.perception ?? 1;
            mods = this.validation.mods;
            for (const kind of ["ancestry", "heritage", "background", "class"]) addName(this.entries[kind]?.name);
            for (const doc of [this.docs.ancestry, this.docs.background, this.docs.class]) {
                for (const item of Object.values(doc?._source.system.items ?? {})) {
                    if (!item.level || item.level <= this.target) addName(item.name);
                }
            }
        } else {
            for (const option of this.skillOptions) skillRanks[option.key] = option.rank;
            if (this.lu.skill) skillRanks[this.lu.skill] = (skillRanks[this.lu.skill] ?? 0) + 1;
            skillRanks.perception = this.actor.perception?.rank ?? 0;
            mods = { ...this.currentMods };
            for (const attr of this.lu.boosts) mods[attr] = applyBoost(mods[attr]);
            for (const item of this.actor.items) addName(item.name);
        }
        for (const pick of Object.values(this.featPicks)) addName(pick.name);

        return { skills, skillRanks, mods, ownedNames: owned, knownNames };
    }

    async #computeCandidates() {
        const feats = await featIndex();
        const actor = this.actor;
        const ancestrySlug =
            this.mode === "create" ? (this.entries.ancestry ? slugOf(this.entries.ancestry) : null) : actor.ancestry?.slug;
        const classSlug = this.classSlug;
        const ownedBase = (actor?.itemTypes.feat ?? []).map((f) => f.slug);
        const context = await this.#prereqContext();

        this.candidates = {};
        for (const slot of this.featSlots) {
            const others = Object.entries(this.featPicks)
                .filter(([id]) => id !== slot.id)
                .map(([, entry]) => slugOf(entry));
            const filter = { ancestrySlug, classSlug, allowRare: this.allowRare, ownedSlugs: new Set([...ownedBase, ...others]) };
            this.candidates[slot.id] = feats.filter((entry) => isFeatEligible(entry, slot, filter));
        }

        // Prerequisites: a pick that stopped qualifying (after going back and changing something) is dropped
        this.prereqStatus = {};
        for (const list of Object.values(this.candidates)) {
            for (const entry of list) {
                this.prereqStatus[entry.uuid] ??= evaluatePrerequisites(prerequisiteText(entry), context);
            }
        }
        for (const [slotId, pick] of Object.entries(this.featPicks)) {
            if (this.prereqStatus[pick.uuid]?.status === "unmet") delete this.featPicks[slotId];
        }
    }

    async #prepareSpells() {
        const cfg = this.casterConfig;
        const actor = this.actor;
        if (!cfg || !actor) {
            this.spell = null;
            return;
        }

        const feature = actor.itemTypes.feat.find((f) => f.system.traits?.otherTags?.includes(cfg.tag)) ?? null;
        const tradition = this.traditionOverride ?? cfg.fixedTradition ?? traditionFromRules(feature?._source.system.rules);
        const plan = spellPlan(cfg.casting, this.spellLevel);
        const grantedMap = feature ? parseGrantedSpells(feature._source.system.description.value) : {};

        const granted = [];
        for (const rank of plan.granted) {
            const uuid = grantedMap[rank];
            if (!uuid) continue;
            let doc = null;
            try {
                doc = await getDoc(uuid);
            } catch (error) {
                console.debug(`${MODULE_ID} | Granted spell ${uuid} is not available`, error);
            }
            granted.push({ rank, uuid, name: doc?.name ?? decodeURIComponent(uuid.split(".").pop()), img: doc?.img ?? null, missing: !doc });
        }

        const ownedKeys = new Set(
            actor.itemTypes.spell.map((s) => {
                const rank = s.system.traits.value.includes("cantrip") ? 0 : (s.system.location?.heightenedLevel ?? s.system.level.value);
                return `${spellKey(s.name)}@${rank}`;
            }),
        );
        for (const g of granted) if (!g.missing) ownedKeys.add(`${spellKey(g.name)}@${g.rank}`);

        const spells = await loadIndex("spell");
        const candidates = {};
        if (tradition) {
            for (const group of plan.groups) {
                const rank = group.rank === "any" ? Math.min(this.anyRank, group.maxRank) : group.rank;
                const taken = new Set(ownedKeys);
                for (const [key, picks] of Object.entries(this.spellPicks)) {
                    if (key === group.key) continue;
                    for (const p of picks) taken.add(`${spellKey(p.entry.name)}@${p.rank}`);
                }
                candidates[group.key] = spells.filter((e) => isSpellEligible(e, { tradition, rank, allowRare: this.allowRare, taken, exact: cfg.casting === "prepared" }));
            }
        }

        this.spell = { cfg, feature, tradition, plan, granted, candidates };
        // Keep only picks that still fit their group
        for (const key of Object.keys(this.spellPicks)) {
            if (!plan.groups.some((g) => g.key === key)) delete this.spellPicks[key];
        }
    }

    async #prepareShop() {
        if (!this.shopItems.length) {
            const items = await loadIndex("equipment");
            const options = { maxLevel: game.settings.get(MODULE_ID, "startingItemLevel"), allowRare: this.allowRare };
            this.shopItems = items.filter((entry) => isStarterItem(entry, options));
        }
    }

    async _renderHTML() {
        const ids = this.steps;
        const current = this.stepId;
        const nav = ids
            .map((id, i) => {
                const done = i < this.stepIndex && this.#stepComplete(id);
                const canJump = i < this.stepIndex && i >= this.minStepIndex;
                return `<li class="${i === this.stepIndex ? "current" : ""} ${done ? "done" : ""}"
                    ${canJump ? `data-action="goto" data-index="${i}"` : ""}>
                    <span class="num">${done ? '<i class="fa-solid fa-check"></i>' : i + 1}</span>
                    <span>${esc(t(`Step.${id}`))}</span></li>`;
            })
            .join("");

        const view = STEP_VIEWS[current](this);
        const primary = this.#primary();
        const canNext = this.#stepComplete(current) && !this.busy;

        return `
        <div class="sf2e-cc-shell ${DETAIL_STEPS.has(current) ? "with-detail" : ""}">
            <nav class="sf2e-cc-steps"><ol>${nav}</ol></nav>
            <main>
                <header><h2>${esc(t(`Step.${current}`))}</h2><p>${esc(t(`StepHelp.${current}`))}</p></header>
                <div class="sf2e-cc-scroll">${view}</div>
            </main>
            <aside class="sf2e-cc-detail"><div class="sf2e-cc-detail-body">
                <p class="sf2e-cc-empty">${esc(t("DetailPlaceholder"))}</p></div></aside>
            <footer>
                <button type="button" data-action="back" ${this.stepIndex <= this.minStepIndex || this.busy ? "disabled" : ""}>
                    <i class="fa-solid fa-chevron-left"></i> ${esc(t("Back"))}</button>
                <button type="button" class="primary" data-action="${primary.action}" ${canNext ? "" : "disabled"}>
                    ${esc(primary.label)} <i class="fa-solid ${primary.icon}"></i></button>
            </footer>
        </div>`;
    }

    /** What the main footer button does on the current step. */
    #primary() {
        const id = this.stepId;
        const last = this.stepIndex === this.steps.length - 1;
        if (this.mode === "create" && id === "review" && !this.built) {
            return { action: "build", label: t("CreateCharacter"), icon: "fa-hammer" };
        }
        if (this.inSetupPhase) {
            const label = last ? t("Finish") : id === "spells" ? t("AddSpells") : t("Next");
            return { action: "setup-next", label, icon: last ? "fa-rocket" : "fa-chevron-right" };
        }
        if (last) return { action: "finish", label: t("ApplyLevelUp"), icon: "fa-rocket" };
        return { action: "next", label: t("Next"), icon: "fa-chevron-right" };
    }

    _replaceHTML(result, content) {
        const previous = content.querySelector(".sf2e-cc-scroll");
        const sameStep = this._renderedStep === this.stepId;
        const scrollTop = sameStep && previous ? previous.scrollTop : 0;
        content.innerHTML = result;
        this._renderedStep = this.stepId;
        const scroll = content.querySelector(".sf2e-cc-scroll");
        if (scroll) scroll.scrollTop = scrollTop;
    }

    _onFirstRender() {
        const el = this.element;
        el.addEventListener("click", (event) => this.#onClick(event));
        el.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            const target = event.target.closest("[data-action][tabindex]");
            if (target) {
                event.preventDefault();
                this.#onClick(event);
            }
        });
        el.addEventListener("input", (event) => {
            const input = event.target;
            if (input.matches("[data-search-target]")) {
                this.searchText = input.value;
                this.#applySearch();
            } else if (input.matches('[data-action="name"]')) {
                this.name = input.value;
                this.#refreshFooter();
            }
        });
        el.addEventListener("change", async (event) => {
            const action = event.target.dataset?.action;
            if (action === "toggle-rare") {
                this.allowRare = event.target.checked;
                await game.settings.set(MODULE_ID, "allowRare", this.allowRare);
                this.shopItems = [];
                this.render();
            } else if (action === "toggle-unqualified") {
                this.showUnqualified = event.target.checked;
                this.render();
            }
        });
    }

    _onRender() {
        this.#applySearch();
        this.#loadDetail();
    }

    _onClose() {
        instances.delete(this.instanceKey);
    }

    #applySearch() {
        const query = this.searchText.trim().toLowerCase();
        for (const input of this.element.querySelectorAll("[data-search-target]")) {
            input.value = this.searchText;
            const scope = input.closest("main") ?? this.element;
            for (const node of scope.querySelectorAll(input.dataset.searchTarget)) {
                node.hidden = !!query && !(node.dataset.search ?? "").includes(query);
            }
        }
    }

    #refreshFooter() {
        const next = this.element.querySelector("footer .primary");
        if (next) next.disabled = !this.#stepComplete(this.stepId) || this.busy;
    }

    async #loadDetail() {
        const body = this.element.querySelector(".sf2e-cc-detail-body");
        if (!body || !this.detailUuid) return;
        const uuid = this.detailUuid;
        try {
            const doc = await getDoc(uuid);
            if (!doc || uuid !== this.detailUuid) return;
            const TextEditor = foundry.applications.ux.TextEditor.implementation;
            const html = await TextEditor.enrichHTML(doc.system.description?.value ?? "", { relativeTo: doc });
            body.innerHTML = `<h3><img src="${esc(doc.img)}" alt=""> ${esc(doc.name)}</h3>
                <button type="button" class="sf2e-cc-linkbtn" data-action="open-sheet" data-uuid="${esc(uuid)}">
                    <i class="fa-solid fa-up-right-from-square"></i> ${esc(t("OpenEntry"))}</button>
                <div class="sf2e-cc-prose">${html}</div>`;
        } catch (error) {
            console.warn(`${MODULE_ID} | Could not load details for ${uuid}`, error);
        }
    }

    /* -------------------------------------------- */
    /*  Events                                      */
    /* -------------------------------------------- */

    #go(index) {
        this.stepIndex = Math.max(this.minStepIndex, Math.min(index, this.steps.length - 1));
        this.searchText = "";
        this.detailUuid = null;
        return this.render();
    }

    async #onClick(event) {
        const target = event.target.closest("[data-action]");
        if (!target || target.disabled || target.matches("input")) return;
        const data = target.dataset;

        switch (data.action) {
            case "next":
                return this.#go(this.stepIndex + 1);
            case "back":
                return this.#go(this.stepIndex - 1);
            case "goto":
                return this.#go(Number(data.index));
            case "build":
                return this.#build();
            case "setup-next":
                return this.#setupNext();
            case "finish":
                return this.#finish();
            case "detail":
                this.detailUuid = data.uuid;
                return this.#loadDetail();
            case "open-sheet":
                return (await fromUuid(data.uuid))?.sheet.render(true);
            case "pick":
                return this.#pick(data.kind, data.uuid);
            case "boost":
                return this.#boost(data);
            case "skill":
                this.skillPicks.has(data.skill) ? this.skillPicks.delete(data.skill) : this.skillPicks.add(data.skill);
                return this.render();
            case "feat": {
                const entry = this.candidates[data.slot]?.find((e) => e.uuid === data.uuid);
                if (!entry) return;
                if (this.prereqStatus[entry.uuid]?.status === "unmet") return;
                if (this.featPicks[data.slot]?.uuid === data.uuid) delete this.featPicks[data.slot];
                else this.featPicks[data.slot] = entry;
                this.detailUuid = data.uuid;
                return this.render();
            }
            case "lu-boost": {
                const picks = this.lu.boosts;
                const i = picks.indexOf(data.attr);
                if (i >= 0) picks.splice(i, 1);
                else if (picks.length < FREE_BOOSTS_PER_BATCH) picks.push(data.attr);
                return this.render();
            }
            case "lu-skill":
                this.lu.skill = this.lu.skill === data.skill ? null : data.skill;
                return this.render();
            case "tradition":
                this.traditionOverride = data.tradition;
                this.spellPicks = {};
                return this.render();
            case "spell-rank":
                this.anyRank = Number(data.rank);
                return this.render();
            case "spell":
                return this.#toggleSpell(data);
            case "shop-category":
                this.shopCategory = data.category;
                this.searchText = "";
                return this.render();
            case "shop-add":
                return this.#cartAdd(data.uuid);
            case "shop-sub":
                return this.#cartSub(data.uuid);
            case "shop-remove":
                this.cart.delete(data.uuid);
                return this.render();
        }
    }

    async #pick(kind, uuid) {
        const list = kind === "heritage" ? [...this.lists.heritage.own, ...this.lists.heritage.versatile] : this.lists[kind];
        const entry = list.find((e) => e.uuid === uuid);
        if (!entry) return;
        this.picks[kind] = uuid;
        this.entries[kind] = entry;
        this.docs[kind] = await getDoc(uuid);
        this.detailUuid = uuid;

        // A different ancestry/background/class invalidates everything chosen downstream of it
        if (kind === "ancestry") {
            this.picks.heritage = null;
            delete this.entries.heritage;
            this.boostPicks.ancestry = {};
            this.boostPicks.flaws = {};
        }
        if (kind === "background") this.boostPicks.background = {};
        if (kind === "class") this.boostPicks.key = null;
        this.skillPicks.clear();
        this.featPicks = {};
        this.#reconcile();
        this.render();
    }

    #boost({ source, slot, attr }) {
        const picks = this.boostPicks;
        if (source === "free") {
            const i = picks.free.indexOf(attr);
            if (i >= 0) picks.free.splice(i, 1);
            else if (picks.free.length < FREE_BOOSTS_PER_BATCH) picks.free.push(attr);
        } else if (source === "key") {
            picks.key = picks.key === attr ? null : attr;
        } else {
            const bucket = source === "flaw" ? picks.flaws : picks[source];
            bucket[slot] = bucket[slot] === attr ? null : attr;
        }
        this.#reconcile();
        this.render();
    }

    #toggleSpell({ group, uuid, rank }) {
        const entry = this.spell?.candidates[group]?.find((e) => e.uuid === uuid);
        const plan = this.spell?.plan.groups.find((g) => g.key === group);
        if (!entry || !plan) return;
        const list = (this.spellPicks[group] ??= []);
        const r = Number(rank);
        const i = list.findIndex((p) => p.entry.uuid === uuid && p.rank === r);
        if (i >= 0) list.splice(i, 1);
        else if (list.length < plan.count) list.push({ entry, rank: r });
        this.detailUuid = uuid;
        return this.render();
    }

    #cartAdd(uuid) {
        const entry = this.shopItems.find((e) => e.uuid === uuid);
        if (!entry) return;
        const cost = lineCost(entry.system.price, 1);
        if (cost > this.remaining) {
            ui.notifications.warn(t("Shop.CannotAfford", { name: entry.name }));
            return;
        }
        const line = this.cart.get(uuid) ?? { entry, units: 0 };
        line.units += 1;
        this.cart.set(uuid, line);
        return this.render();
    }

    #cartSub(uuid) {
        const line = this.cart.get(uuid);
        if (!line) return;
        line.units -= 1;
        if (line.units <= 0) this.cart.delete(uuid);
        return this.render();
    }

    /* -------------------------------------------- */
    /*  Writing to the actor                        */
    /* -------------------------------------------- */

    async #run(work) {
        if (this.busy) return false;
        this.busy = true;
        this.render();
        try {
            await work();
            return true;
        } catch (error) {
            console.error(`${MODULE_ID} |`, error);
            ui.notifications.error(t("ApplyFailed", { message: error.message }));
            return false;
        } finally {
            this.busy = false;
        }
    }

    async #closeAndShow() {
        const actor = this.actor;
        await this.close();
        actor?.sheet.render(true);
    }

    /** Create the character, then move on to the setup steps (spells, equipment). */
    async #build() {
        const ok = await this.#run(async () => {
            this.actor = await applyCreation(this);
            this.built = true;
            await setPendingSetup(this.actor, this.plannedSetup);
            ui.notifications.info(t("Created", { name: this.actor.name }));
        });
        if (!ok) return this.render();
        this.#go(CREATE_STEPS.length);
    }

    async #setupNext() {
        const id = this.stepId;
        const last = this.stepIndex === this.steps.length - 1;
        const ok = await this.#run(async () => {
            if (id === "spells") await this.#commitSpells();
            if (id === "equipment") await this.#commitPurchases();
            await completeSetupStep(this.actor, id);
        });
        if (!ok) return this.render();
        if (last) return this.#closeAndShow();
        this.#go(this.stepIndex + 1);
    }

    async #commitSpells() {
        const sp = this.spell;
        if (!sp?.tradition) throw new Error(t("Spells.NoTradition"));
        const spells = [
            ...sp.granted.filter((g) => !g.missing).map((g) => ({ uuid: g.uuid, rank: g.rank })),
            ...Object.values(this.spellPicks)
                .flat()
                .map((p) => ({ uuid: p.entry.uuid, rank: p.rank })),
        ];
        await applySpells({
            actor: this.actor,
            casting: sp.cfg.casting,
            tradition: sp.tradition,
            level: this.spellLevel,
            spells,
        });
    }

    async #commitPurchases() {
        const cart = this.cartLines.map((l) => ({ uuid: l.entry.uuid, price: l.price, units: l.units }));
        await applyPurchases(this.actor, cart, this.credits);
    }

    async #finish() {
        const ok = await this.#run(async () => {
            await applyLevelUp(this);
            if (this.stepsInclude("spells")) {
                // The class feature just granted may have changed what spells are available; re-read it
                await this.#prepareSpells();
                await this.#commitSpells();
            }
            ui.notifications.info(t("LeveledUp", { name: this.actor.name, level: this.target }));
        });
        if (!ok) return this.render();
        return this.#closeAndShow();
    }

    stepsInclude(id) {
        return this.steps.includes(id);
    }
}
