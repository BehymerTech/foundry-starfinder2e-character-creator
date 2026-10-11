import { loadIndex, getDoc, heritagesFor, featIndex, slugOf, MODULE_ID } from "../lib/compendium.mjs";
import {
    ATTRIBUTES,
    FREE_BOOSTS_PER_BATCH,
    MAX_LEVEL,
    additionalSkillCount,
    featSlotsAtLevel,
    hasAttributeBoosts,
    hasSkillIncrease,
    isFeatEligible,
    normalizeSlots,
    resolveSlots,
    validateCreationBuild,
} from "../lib/rules.mjs";
import { applyCreation, applyLevelUp } from "./apply.mjs";
import { STEP_VIEWS, esc, t } from "./views.mjs";

const { ApplicationV2 } = foundry.applications.api;

const CREATE_STEPS = ["ancestry", "heritage", "background", "class", "attributes", "skills", "feats", "review"];

/** Steps whose view is a gallery with an info pane. */
const DETAIL_STEPS = new Set(["ancestry", "heritage", "background", "class", "feats", "overview"]);

const instances = new Map();

export class CharacterCreatorApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
        classes: ["sf2e-cc"],
        tag: "div",
        window: { icon: "fa-solid fa-user-astronaut", resizable: true },
        position: { width: 1040, height: 720 },
    };

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
        if (actor?.class && actor.level >= MAX_LEVEL) {
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
        this.mode = actor?.class ? "levelup" : "create";
        this.target = this.mode === "levelup" ? actor.level + 1 : 1;
        this.stepIndex = 0;
        this.busy = false;
        this.name = actor?.name ?? "";
        this.allowRare = game.settings.get(MODULE_ID, "allowRare");
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
        this.lu = { boosts: [], skill: null };
        this.noHeritage = false;
    }

    get title() {
        return this.mode === "levelup" ? t("TitleLevelUp", { name: this.actor.name, level: this.target }) : t("TitleCreate");
    }

    /* -------------------------------------------- */
    /*  Derived state                               */
    /* -------------------------------------------- */

    get steps() {
        if (this.mode === "create") return CREATE_STEPS;
        const steps = ["overview"];
        if (hasAttributeBoosts(this.target)) steps.push("attributes");
        if (this.hasSkillIncrease) steps.push("skills");
        if (this.featSlots.length) steps.push("feats");
        steps.push("review");
        return steps;
    }

    get stepId() {
        return this.steps[this.stepIndex];
    }

    get classSystem() {
        return this.mode === "levelup" ? this.actor.class?._source.system : this.docs.class?._source.system;
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
        if (!system) return [];
        const slots = featSlotsAtLevel(system, this.target);
        if (this.mode === "create") return slots;
        const filled = new Set(this.actor.itemTypes.feat.map((f) => f.system.location));
        return slots.filter((slot) => !filled.has(slot.id));
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
            case "review":
                return this.mode === "levelup" || this.name.trim().length > 0;
            default:
                return true;
        }
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
        if (this.mode === "create") {
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
        return {};
    }

    async #computeCandidates() {
        const feats = await featIndex();
        const actor = this.actor;
        const ancestrySlug =
            this.mode === "levelup" ? actor.ancestry?.slug : this.entries.ancestry ? slugOf(this.entries.ancestry) : null;
        const classSlug = this.mode === "levelup" ? actor.class?.slug : this.entries.class ? slugOf(this.entries.class) : null;
        const ownedBase = (actor?.itemTypes.feat ?? []).map((f) => f.slug);
        for (const slot of this.featSlots) {
            const others = Object.entries(this.featPicks)
                .filter(([id]) => id !== slot.id)
                .map(([, entry]) => slugOf(entry));
            const context = { ancestrySlug, classSlug, allowRare: this.allowRare, ownedSlugs: new Set([...ownedBase, ...others]) };
            this.candidates[slot.id] = feats.filter((entry) => isFeatEligible(entry, slot, context));
        }
    }

    async _renderHTML() {
        const ids = this.steps;
        const current = this.stepId;
        const nav = ids
            .map((id, i) => {
                const done = i < this.stepIndex && this.#stepComplete(id);
                return `<li class="${i === this.stepIndex ? "current" : ""} ${done ? "done" : ""}"
                    ${i < this.stepIndex ? `data-action="goto" data-index="${i}"` : ""}>
                    <span class="num">${done ? '<i class="fa-solid fa-check"></i>' : i + 1}</span>
                    <span>${esc(t(`Step.${id}`))}</span></li>`;
            })
            .join("");

        const view = STEP_VIEWS[current](this);
        const isLast = this.stepIndex === ids.length - 1;
        const canNext = this.#stepComplete(current) && !this.busy;
        const nextLabel = isLast ? (this.mode === "create" ? t("CreateCharacter") : t("ApplyLevelUp")) : t("Next");

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
                <button type="button" data-action="back" ${this.stepIndex === 0 || this.busy ? "disabled" : ""}>
                    <i class="fa-solid fa-chevron-left"></i> ${esc(t("Back"))}</button>
                <button type="button" class="primary" data-action="${isLast ? "finish" : "next"}" ${canNext ? "" : "disabled"}>
                    ${esc(nextLabel)} <i class="fa-solid ${isLast ? "fa-rocket" : "fa-chevron-right"}"></i></button>
            </footer>
        </div>`;
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
            if (!event.target.matches('[data-action="toggle-rare"]')) return;
            this.allowRare = event.target.checked;
            await game.settings.set(MODULE_ID, "allowRare", this.allowRare);
            this.render();
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

    async #onClick(event) {
        const target = event.target.closest("[data-action]");
        if (!target || target.disabled || target.matches("input")) return;
        const data = target.dataset;

        switch (data.action) {
            case "next":
                this.stepIndex = Math.min(this.stepIndex + 1, this.steps.length - 1);
                this.searchText = "";
                this.detailUuid = null;
                return this.render();
            case "back":
                this.stepIndex = Math.max(0, this.stepIndex - 1);
                this.searchText = "";
                this.detailUuid = null;
                return this.render();
            case "goto":
                this.stepIndex = Number(data.index);
                this.searchText = "";
                return this.render();
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
                if (this.featPicks[data.slot]?.uuid === data.uuid) delete this.featPicks[data.slot];
                else this.featPicks[data.slot] = entry;
                this.detailUuid = data.uuid;
                await this.#computeCandidates();
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

    async #finish() {
        if (this.busy) return;
        this.busy = true;
        this.render();
        try {
            const actor = this.mode === "create" ? await applyCreation(this) : await applyLevelUp(this);
            ui.notifications.info(
                this.mode === "create"
                    ? t("Created", { name: actor.name })
                    : t("LeveledUp", { name: actor.name, level: this.target }),
            );
            await this.close();
            actor.sheet.render(true);
        } catch (error) {
            console.error(`${MODULE_ID} |`, error);
            ui.notifications.error(t("ApplyFailed", { message: error.message }));
            this.busy = false;
            this.render();
        }
    }
}
