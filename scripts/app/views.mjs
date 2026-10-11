/**
 * HTML renderers for each wizard step. They are pure string builders over a read-only look at the app,
 * so the app can swap them into the window with a single innerHTML assignment.
 */
import { ATTRIBUTES, prerequisiteText, hasAttributeBoosts, hitPointsPerLevel, canIncreaseSkill } from "../lib/rules.mjs";

export const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const t = (key, data) =>
    data ? game.i18n.format(`SF2ECC.${key}`, data) : game.i18n.localize(`SF2ECC.${key}`);

const attrLabel = (attr) => {
    const entry = CONFIG.PF2E?.abilities?.[attr];
    const label = typeof entry === "string" ? entry : entry?.label;
    return label ? game.i18n.localize(label) : attr.toUpperCase();
};

const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
const fmtMod = (n) => signed(Number.isInteger(n) ? n : Math.trunc(n)) + (Number.isInteger(n) ? "" : "½");

const skillLabel = (slug) => {
    const entry = CONFIG.PF2E?.skills?.[slug];
    return entry?.label ? game.i18n.localize(entry.label) : slug;
};

const RANKS = ["untrained", "trained", "expert", "master", "legendary"];
const rankLabel = (rank) => t(`Rank.${RANKS[rank] ?? "untrained"}`);

function rarityBadge(entry) {
    const rarity = entry.system?.traits?.rarity;
    return rarity && rarity !== "common" ? `<span class="sf2e-cc-badge rarity-${esc(rarity)}">${esc(rarity)}</span>` : "";
}

function sourceBadge(entry) {
    const title = entry.system?.publication?.title;
    return title ? `<span class="sf2e-cc-source">${esc(title)}</span>` : "";
}

function boostSummary(raw) {
    return Object.values(raw ?? {})
        .map((slot) => {
            const v = slot?.value ?? [];
            return v.length === 1 ? v[0].toUpperCase() : t("Free");
        })
        .join(" · ");
}

/* -------------------------------------------- */
/*  Pickers                                     */
/* -------------------------------------------- */

function pickerCards(app, kind, entries, extra = () => "") {
    const selected = app.picks[kind];
    const cards = entries
        .map((entry) => {
            const uuid = entry.uuid;
            return `
            <div class="sf2e-cc-card ${uuid === selected ? "selected" : ""}" data-action="pick" data-kind="${kind}"
                 data-uuid="${esc(uuid)}" data-search="${esc(entry.name.toLowerCase())}" tabindex="0">
                <img src="${esc(entry.img)}" alt="" loading="lazy">
                <div class="sf2e-cc-card-body">
                    <h4>${esc(entry.name)} ${rarityBadge(entry)}</h4>
                    ${extra(entry)}
                    ${sourceBadge(entry)}
                </div>
                <button type="button" class="sf2e-cc-icon" data-action="detail" data-uuid="${esc(uuid)}"
                        data-tooltip="${esc(t("Details"))}"><i class="fa-solid fa-circle-info"></i></button>
            </div>`;
        })
        .join("");
    return `
        <div class="sf2e-cc-search"><i class="fa-solid fa-magnifying-glass"></i>
            <input type="search" data-search-target=".sf2e-cc-card" placeholder="${esc(t("Search"))}"></div>
        <div class="sf2e-cc-grid">${cards || `<p class="sf2e-cc-empty">${esc(t("NoResults"))}</p>`}</div>`;
}

export function viewAncestry(app) {
    return pickerCards(
        app,
        "ancestry",
        app.lists.ancestry,
        (e) => `<p class="sf2e-cc-meta">${esc(t("HP"))} ${esc(e.system?.hp ?? "?")} · ${esc(boostSummary(e.system?.boosts))}</p>`,
    );
}

export function viewHeritage(app) {
    const { own, versatile } = app.lists.heritage;
    if (!own.length && !versatile.length) return `<p class="sf2e-cc-empty">${esc(t("NoHeritages"))}</p>`;
    const none = "";
    return `
        <h3 class="sf2e-cc-subhead">${esc(app.entries.ancestry?.name ?? "")}</h3>
        ${pickerCards(app, "heritage", own, () => none)}
        ${versatile.length ? `<h3 class="sf2e-cc-subhead">${esc(t("VersatileHeritages"))}</h3>${pickerCards(app, "heritage", versatile, () => none)}` : ""}`;
}

export function viewBackground(app) {
    return pickerCards(app, "background", app.lists.background, (e) => {
        const skills = (e.system?.trainedSkills?.value ?? []).map(skillLabel);
        const lore = e.system?.trainedSkills?.lore ?? [];
        return `<p class="sf2e-cc-meta">${esc(boostSummary(e.system?.boosts))}${
            skills.length || lore.length ? " · " + esc([...skills, ...lore].join(", ")) : ""
        }</p>`;
    });
}

export function viewClass(app) {
    return pickerCards(app, "class", app.lists.class, (e) => {
        const key = (e.system?.keyAbility?.value ?? []).map((a) => a.toUpperCase()).join(" / ");
        return `<p class="sf2e-cc-meta">${esc(t("HP"))} ${esc(e.system?.hp ?? "?")} · ${esc(t("KeyAttribute"))}: ${esc(key)}</p>`;
    });
}

/* -------------------------------------------- */
/*  Attributes                                  */
/* -------------------------------------------- */

function attrButtons({ source, slot = "", options, selected, taken = [], disabledAll = false, multi = false }) {
    return ATTRIBUTES.map((attr) => {
        const allowed = options.includes(attr);
        const isOn = multi ? selected.includes(attr) : selected === attr;
        const blocked = !allowed || disabledAll || (!isOn && taken.includes(attr));
        return `<button type="button" class="sf2e-cc-attr ${isOn ? "on" : ""}" ${blocked ? "disabled" : ""}
            data-action="boost" data-source="${source}" data-slot="${esc(slot)}" data-attr="${attr}"
            data-tooltip="${esc(attrLabel(attr))}">${attr.toUpperCase()}</button>`;
    }).join("");
}

function slotRow(label, source, slot, takenByOthers) {
    return `<div class="sf2e-cc-row"><span class="sf2e-cc-row-label">${esc(label)}</span>
        <div class="sf2e-cc-attrs">${
            slot.fixed
                ? ATTRIBUTES.map(
                      (a) => `<span class="sf2e-cc-attr fixed ${a === slot.selected ? "on" : "off"}">${a.toUpperCase()}</span>`,
                  ).join("")
                : attrButtons({ source, slot: slot.key, options: slot.options, selected: slot.selected, taken: takenByOthers })
        }</div></div>`;
}

export function viewAttributes(app) {
    return app.mode === "levelup" ? viewLevelUpAttributes(app) : viewCreateAttributes(app);
}

function viewCreateAttributes(app) {
    const b = app.build;
    const v = app.validation;
    const rows = [];

    b.ancestry.forEach((slot, i) => {
        const others = b.ancestry.filter((_, j) => j !== i).map((s) => s.selected);
        rows.push(slotRow(`${t("Ancestry")} ${t("Boost")}`, "ancestry", slot, others));
    });
    b.flaws.forEach((slot) => {
        rows.push(`<div class="sf2e-cc-row flaw"><span class="sf2e-cc-row-label">${esc(t("Ancestry"))} ${esc(t("Flaw"))}</span>
            <div class="sf2e-cc-attrs">${
                slot.fixed
                    ? ATTRIBUTES.map((a) => `<span class="sf2e-cc-attr fixed ${a === slot.selected ? "on flaw" : "off"}">${a.toUpperCase()}</span>`).join("")
                    : attrButtons({ source: "flaw", slot: slot.key, options: slot.options, selected: slot.selected })
            }</div></div>`);
    });
    b.background.forEach((slot, i) => {
        const others = b.background.filter((_, j) => j !== i).map((s) => s.selected);
        rows.push(slotRow(`${t("Background")} ${t("Boost")}`, "background", slot, others));
    });
    if (b.keyOptions.length) {
        rows.push(`<div class="sf2e-cc-row"><span class="sf2e-cc-row-label">${esc(t("KeyAttribute"))}</span>
            <div class="sf2e-cc-attrs">${attrButtons({ source: "key", options: b.keyOptions, selected: b.keySelected })}</div></div>`);
    }
    rows.push(`<div class="sf2e-cc-row"><span class="sf2e-cc-row-label">${esc(t("FreeBoosts", { n: b.free.length, max: 4 }))}</span>
        <div class="sf2e-cc-attrs">${attrButtons({ source: "free", options: ATTRIBUTES, selected: b.free, multi: true, disabledAll: false })}</div></div>`);

    const errors = v.errors.map((e) => `<li>${esc(t(`Error.${e}`))}</li>`).join("");
    return `
        <p class="sf2e-cc-help">${esc(t("AttributesHelp"))}</p>
        <div class="sf2e-cc-rows">${rows.join("")}</div>
        ${errors ? `<ul class="sf2e-cc-errors">${errors}</ul>` : ""}
        ${modifierStrip(v.mods)}`;
}

function modifierStrip(mods, before = null) {
    return `<div class="sf2e-cc-mods">${ATTRIBUTES.map(
        (a) => `<div class="sf2e-cc-mod"><span>${a.toUpperCase()}</span><strong>${fmtMod(mods[a])}</strong>${
            before && before[a] !== mods[a] ? `<em>${fmtMod(before[a])} →</em>` : ""
        }</div>`,
    ).join("")}</div>`;
}

function viewLevelUpAttributes(app) {
    const base = app.currentMods;
    const chosen = app.lu.boosts;
    const preview = { ...base };
    for (const a of chosen) preview[a] += preview[a] >= 4 ? 0.5 : 1;
    const buttons = ATTRIBUTES.map((attr) => {
        const on = chosen.includes(attr);
        const partial = base[attr] >= 4;
        return `<button type="button" class="sf2e-cc-attr big ${on ? "on" : ""}" data-action="lu-boost" data-attr="${attr}"
            data-tooltip="${esc(partial ? t("PartialBoost") : attrLabel(attr))}" ${!on && chosen.length >= 4 ? "disabled" : ""}>
            ${attr.toUpperCase()}<small>${fmtMod(base[attr])}${partial ? " ½" : ""}</small></button>`;
    }).join("");
    return `
        <p class="sf2e-cc-help">${esc(t("LevelBoostsHelp", { level: app.target }))}</p>
        <div class="sf2e-cc-attrs wide">${buttons}</div>
        <p class="sf2e-cc-help">${esc(t("FreeBoosts", { n: chosen.length, max: 4 }))}</p>
        ${modifierStrip(preview, base)}`;
}

/* -------------------------------------------- */
/*  Skills                                      */
/* -------------------------------------------- */

export function viewSkills(app) {
    return app.mode === "levelup" ? viewLevelUpSkills(app) : viewCreateSkills(app);
}

function viewCreateSkills(app) {
    const info = app.skillInfo;
    const remaining = info.total - app.skillPicks.size;
    const chips = Object.keys(CONFIG.PF2E?.skills ?? {})
        .map((slug) => {
            const fixed = info.fixed.get(slug);
            const on = app.skillPicks.has(slug);
            const disabled = !!fixed || (!on && remaining <= 0);
            return `<button type="button" class="sf2e-cc-skill ${on || fixed ? "on" : ""}" ${disabled ? "disabled" : ""}
                data-action="skill" data-skill="${esc(slug)}">${esc(skillLabel(slug))}${
                    fixed ? `<small>${esc(t(`From.${fixed}`))}</small>` : ""
                }</button>`;
        })
        .join("");
    const lore = info.lore.length ? `<p class="sf2e-cc-meta">${esc(t("LoreSkills"))}: ${esc(info.lore.join(", "))}</p>` : "";
    return `
        <p class="sf2e-cc-help">${esc(t("SkillsHelp", { n: info.total, remaining: Math.max(0, remaining) }))}</p>
        <div class="sf2e-cc-chips">${chips}</div>${lore}`;
}

function viewLevelUpSkills(app) {
    const chips = app.skillOptions
        .map((s) => {
            const on = app.lu.skill === s.key;
            const ok = canIncreaseSkill(s.rank, app.target);
            return `<button type="button" class="sf2e-cc-skill ${on ? "on" : ""}" ${ok ? "" : "disabled"}
                data-action="lu-skill" data-skill="${esc(s.key)}">${esc(s.label)}
                <small>${esc(rankLabel(s.rank))}${ok ? ` → ${esc(rankLabel(s.rank + 1))}` : ""}</small></button>`;
        })
        .join("");
    return `<p class="sf2e-cc-help">${esc(t("SkillIncreaseHelp", { level: app.target }))}</p><div class="sf2e-cc-chips">${chips}</div>`;
}

/* -------------------------------------------- */
/*  Feats                                       */
/* -------------------------------------------- */

export function viewFeats(app) {
    if (!app.featSlots.length) return `<p class="sf2e-cc-empty">${esc(t("NoFeats"))}</p>`;
    const rareToggle = `<label class="sf2e-cc-toggle"><input type="checkbox" data-action="toggle-rare" ${app.allowRare ? "checked" : ""}>
        ${esc(t("ShowRare"))}</label>`;
    const sections = app.featSlots
        .map((slot) => {
            const picked = app.featPicks[slot.id];
            const candidates = app.candidates[slot.id] ?? [];
            const rows = candidates
                .map((entry) => {
                    const prereq = prerequisiteText(entry);
                    const actions = entry.system?.actionType?.value;
                    return `<div class="sf2e-cc-feat ${picked?.uuid === entry.uuid ? "selected" : ""}" data-action="feat" data-slot="${esc(slot.id)}"
                        data-uuid="${esc(entry.uuid)}" data-search="${esc(entry.name.toLowerCase())}" tabindex="0">
                        <img src="${esc(entry.img)}" alt="" loading="lazy">
                        <div><strong>${esc(entry.name)}</strong> ${rarityBadge(entry)}
                            <span class="sf2e-cc-meta">${esc(t("LevelShort"))} ${esc(entry.system?.level?.value ?? 0)}${
                                actions && actions !== "passive" ? " · " + esc(actions) : ""
                            }</span>
                            ${prereq.length ? `<span class="sf2e-cc-prereq">${esc(t("Prerequisites"))}: ${esc(prereq.join("; "))}</span>` : ""}
                        </div>
                        <button type="button" class="sf2e-cc-icon" data-action="detail" data-uuid="${esc(entry.uuid)}"
                            data-tooltip="${esc(t("Details"))}"><i class="fa-solid fa-circle-info"></i></button>
                    </div>`;
                })
                .join("");
            return `<section class="sf2e-cc-slot" data-slot="${esc(slot.id)}">
                <h3>${esc(t(`Slot.${slot.category}`))} <small>${esc(t("LevelShort"))} ${slot.level}</small>
                    ${picked ? `<span class="sf2e-cc-picked">${esc(picked.name)}</span>` : `<span class="sf2e-cc-needed">${esc(t("ChooseOne"))}</span>`}</h3>
                <div class="sf2e-cc-search"><i class="fa-solid fa-magnifying-glass"></i>
                    <input type="search" data-search-target='.sf2e-cc-feat[data-slot="${esc(slot.id)}"]' placeholder="${esc(t("Search"))}"></div>
                <div class="sf2e-cc-list">${rows || `<p class="sf2e-cc-empty">${esc(t("NoResults"))}</p>`}</div>
            </section>`;
        })
        .join("");
    return `${rareToggle}${sections}`;
}

/* -------------------------------------------- */
/*  Level-up overview                           */
/* -------------------------------------------- */

export function viewOverview(app) {
    const features = app.newFeatures.length
        ? `<ul class="sf2e-cc-list-plain">${app.newFeatures
              .map((f) => `<li><img src="${esc(f.img)}" alt=""><a data-action="detail" data-uuid="${esc(f.uuid)}">${esc(f.name)}</a></li>`)
              .join("")}</ul>`
        : `<p class="sf2e-cc-empty">${esc(t("NoNewFeatures"))}</p>`;
    const todo = [];
    if (hasAttributeBoosts(app.target)) todo.push(t("Todo.attributes"));
    if (app.hasSkillIncrease) todo.push(t("Todo.skillIncrease"));
    for (const slot of app.featSlots) todo.push(t(`Todo.feat.${slot.category}`));
    const hp = hitPointsPerLevel(app.classHp, app.currentMods.con);
    return `
        <div class="sf2e-cc-levelbanner"><span>${app.actor.level}</span><i class="fa-solid fa-arrow-right"></i><span class="next">${app.target}</span></div>
        <h3 class="sf2e-cc-subhead">${esc(t("YouGain"))}</h3>
        <ul class="sf2e-cc-list-plain"><li><i class="fa-solid fa-heart"></i> ${esc(t("HpGain", { hp, classHp: app.classHp, con: signed(Math.trunc(app.currentMods.con)) }))}</li></ul>
        <h3 class="sf2e-cc-subhead">${esc(t("ClassFeatures"))}</h3>
        ${features}
        <p class="sf2e-cc-help">${esc(t("AutoGranted"))}</p>
        <h3 class="sf2e-cc-subhead">${esc(t("YourChoices"))}</h3>
        ${todo.length ? `<ul class="sf2e-cc-list-plain">${todo.map((x) => `<li><i class="fa-solid fa-circle-check"></i> ${esc(x)}</li>`).join("")}</ul>` : `<p class="sf2e-cc-empty">${esc(t("NoChoices"))}</p>`}`;
}

/* -------------------------------------------- */
/*  Review                                      */
/* -------------------------------------------- */

export function viewReview(app) {
    const lines = [];
    const add = (label, value) => value && lines.push(`<tr><th>${esc(label)}</th><td>${value}</td></tr>`);

    if (app.mode === "create") {
        add(t("Ancestry"), esc(app.entries.ancestry?.name));
        add(t("Heritage"), esc(app.entries.heritage?.name));
        add(t("Background"), esc(app.entries.background?.name));
        add(t("Class"), esc(app.entries.class?.name));
        add(t("Attributes"), ATTRIBUTES.map((a) => `${a.toUpperCase()} ${fmtMod(app.validation.mods[a])}`).join(" · "));
        const trained = [...app.skillInfo.fixed.keys(), ...app.skillPicks].map(skillLabel);
        add(t("Skills"), esc([...trained, ...app.skillInfo.lore].join(", ")));
    } else {
        add(t("Level"), `${app.actor.level} → ${app.target}`);
        if (hasAttributeBoosts(app.target)) add(t("Attributes"), esc(app.lu.boosts.map((a) => a.toUpperCase()).join(", ")));
        if (app.hasSkillIncrease && app.lu.skill) {
            const s = app.skillOptions.find((x) => x.key === app.lu.skill);
            add(t("Skills"), esc(`${s?.label}: ${rankLabel(s?.rank)} → ${rankLabel((s?.rank ?? 0) + 1)}`));
        }
    }
    for (const slot of app.featSlots) {
        add(`${t(`Slot.${slot.category}`)} (${t("LevelShort")} ${slot.level})`, esc(app.featPicks[slot.id]?.name));
    }

    const nameField =
        app.mode === "create"
            ? `<label class="sf2e-cc-name">${esc(t("CharacterName"))}
                <input type="text" data-action="name" value="${esc(app.name)}" placeholder="${esc(t("CharacterNamePlaceholder"))}"></label>`
            : "";
    return `${nameField}<table class="sf2e-cc-review">${lines.join("")}</table>
        <p class="sf2e-cc-help">${esc(app.mode === "create" ? t("ReviewCreateNote") : t("ReviewLevelNote"))}</p>`;
}

export const STEP_VIEWS = {
    ancestry: viewAncestry,
    heritage: viewHeritage,
    background: viewBackground,
    class: viewClass,
    attributes: viewAttributes,
    skills: viewSkills,
    feats: viewFeats,
    overview: viewOverview,
    review: viewReview,
};
