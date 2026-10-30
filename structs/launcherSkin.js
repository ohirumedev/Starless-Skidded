const https = require("https");
const Profile = require("../model/profiles.js");

function templateIdToCosmeticId(templateId) {
    if (!templateId || typeof templateId !== "string") return null;
    return templateId.includes(":") ? templateId.split(":").pop() : templateId;
}

function templateIdToImageSlug(templateId) {
    const id = templateIdToCosmeticId(templateId);
    if (!id) return null;
    return id.toLowerCase();
}

function formatSkinName(slug) {
    return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fetchJson(url) {
    return new Promise((resolve) => {
        try {
            const req = https.get(url, { timeout: 6000, headers: { "User-Agent": "Phoenix-Backend" } }, (res) => {
                let body = "";
                res.on("data", (chunk) => { body += chunk; });
                res.on("end", () => {
                    try {
                        resolve(JSON.parse(body));
                    } catch {
                        resolve(null);
                    }
                });
            });
            req.on("error", () => resolve(null));
            req.on("timeout", () => {
                req.destroy();
                resolve(null);
            });
        } catch {
            resolve(null);
        }
    });
}

async function fetchCosmeticsBatch(templateIds) {
    const ids = [...new Set(templateIds.map(templateIdToCosmeticId).filter(Boolean))];
    const map = new Map();
    if (ids.length === 0) return map;

    for (let i = 0; i < ids.length; i += 25) {
        const chunk = ids.slice(i, i + 25);
        const params = chunk.map((id) => `id=${encodeURIComponent(id)}`).join("&");
        const url = `https://fortnite-api.com/v2/cosmetics/br/search/ids?language=en&${params}`;
        const parsed = await fetchJson(url);
        const list = Array.isArray(parsed?.data) ? parsed.data : parsed?.data ? [parsed.data] : [];
        for (const item of list) {
            if (!item?.id) continue;
            map.set(String(item.id).toLowerCase(), {
                name: item.name,
                iconUrl:
                    item.images?.icon ||
                    item.images?.smallIcon ||
                    item.images?.featured ||
                    null,
                rarity: (item.rarity?.value || item.rarity?.displayValue || "").toLowerCase(),
            });
        }
    }

    return map;
}

function looksLikeCosmeticId(value) {
    const v = String(value || "").trim();
    return /^cid[_\s]/i.test(v) || /^cardpack/i.test(v) || /athena_commando|athena_pickaxe|athena_glider/i.test(v);
}

async function fetchCosmeticFromFortniteApi(templateId) {
    const cosmeticId = templateIdToCosmeticId(templateId);
    if (!cosmeticId) return null;

    const url = `https://fortnite-api.com/v2/cosmetics/br/search/ids?language=en&id=${encodeURIComponent(cosmeticId)}`;
    const parsed = await fetchJson(url);
    const item = Array.isArray(parsed?.data) ? parsed.data[0] : parsed?.data;
    if (!item) return null;

    const iconUrl =
        item.images?.icon ||
        item.images?.smallIcon ||
        item.images?.featured ||
        null;

    return {
        skinName: item.name || formatSkinName(templateIdToImageSlug(cosmeticId)),
        skinIconUrl: iconUrl,
    };
}

function buildFallbackIconUrls(templateId) {
    const slug = templateIdToImageSlug(templateId);
    if (!slug) return [];
    return [
        `https://fortnite-api.com/images/cosmetics/br/${slug}/icon.png`,
        `https://fortnite-api.com/images/cosmetics/br/${slug}/smallicon.png`,
    ];
}

function resolveEquippedCharacterTemplate(athena) {
    if (!athena?.items) return null;

    const attrs = athena.stats?.attributes || {};
    let loadoutId = attrs.last_applied_loadout;

    if (!loadoutId && Array.isArray(attrs.loadouts) && attrs.loadouts.length > 0) {
        const idx = typeof attrs.active_loadout_index === "number" ? attrs.active_loadout_index : 0;
        loadoutId = attrs.loadouts[idx] || attrs.loadouts[0];
    }

    if (!loadoutId) loadoutId = "sandbox_loadout";

    const readCharacter = (id) => {
        const locker = athena.items[id];
        const value = locker?.attributes?.locker_slots_data?.slots?.Character?.items?.[0];
        return value && String(value).trim() !== "" ? value : null;
    };

    let skin = readCharacter(loadoutId);
    if (skin) return skin;

    for (const key of Object.keys(athena.items)) {
        const item = athena.items[key];
        if (!item?.templateId?.toLowerCase().includes("cosmeticlocker")) continue;
        skin = readCharacter(key);
        if (skin) return skin;
    }

    return null;
}

async function getPlayerSkinInfo(accountId) {
    const doc = await Profile.findOne({ accountId }).lean();
    const athena = doc?.profiles?.athena;
    const skinTemplateId = resolveEquippedCharacterTemplate(athena);

    if (!skinTemplateId) {
        return {
            skinTemplateId: null,
            skinName: null,
            skinIconUrl: null,
        };
    }

    const fromApi = await fetchCosmeticFromFortniteApi(skinTemplateId);
    if (fromApi?.skinIconUrl) {
        return {
            skinTemplateId,
            skinName: fromApi.skinName,
            skinIconUrl: fromApi.skinIconUrl,
        };
    }

    const slug = templateIdToImageSlug(skinTemplateId);
    const fallbacks = buildFallbackIconUrls(skinTemplateId);

    return {
        skinTemplateId,
        skinName: fromApi?.skinName || (slug ? formatSkinName(slug) : null),
        skinIconUrl: fallbacks[0] || null,
    };
}

module.exports = {
    getPlayerSkinInfo,
    templateIdToImageSlug,
    resolveEquippedCharacterTemplate,
    fetchCosmeticsBatch,
    looksLikeCosmeticId,
};
