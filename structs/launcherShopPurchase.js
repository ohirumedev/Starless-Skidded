const Profile = require("../model/profiles.js");
const functions = require("./functions.js");
const log = require("./log.js");

async function getVbucksBalance(accountId) {
    const profiles = await Profile.findOne({ accountId }).lean();
    if (!profiles?.profiles?.common_core?.items) return 0;

    for (const item of Object.values(profiles.profiles.common_core.items)) {
        if (item?.templateId?.toLowerCase().startsWith("currency:mtx")) {
            return item.quantity ?? 0;
        }
    }
    return 0;
}

async function purchaseOffer(accountId, offerId) {
    const findOffer = functions.getOfferID(String(offerId || "").trim());
    if (!findOffer) {
        return { success: false, message: "That offer is no longer in the shop." };
    }

    const entry = findOffer.offerId;
    const price = entry?.prices?.[0]?.finalPrice ?? 0;
    const grants = (entry?.itemGrants || [])
        .map((g) => (typeof g === "string" ? g : g?.templateId))
        .filter(Boolean);

    if (grants.length === 0) {
        return { success: false, message: "This offer has no items." };
    }

    const doc = await Profile.findOne({ accountId });
    if (!doc?.profiles) {
        return { success: false, message: "Profile not found." };
    }

    const common_core = doc.profiles.common_core;
    const profile0 = doc.profiles.profile0;
    const athena = doc.profiles.athena;
    if (!common_core || !profile0 || !athena) {
        return { success: false, message: "Profile data is incomplete." };
    }

    for (const grant of grants) {
        const owned = Object.values(athena.items || {}).some(
            (item) => item?.templateId?.toLowerCase() === grant.toLowerCase(),
        );
        if (owned) {
            return { success: false, message: "You already own this cosmetic." };
        }
    }

    let vbucksKey = null;
    let balance = 0;
    for (const key in common_core.items || {}) {
        if (common_core.items[key]?.templateId?.toLowerCase().startsWith("currency:mtx")) {
            vbucksKey = key;
            balance = common_core.items[key].quantity ?? 0;
            break;
        }
    }

    if (!vbucksKey || balance < price) {
        return {
            success: false,
            message: `Not enough V-Bucks. Need ${price}, you have ${balance}.`,
            balance,
            price,
        };
    }

    const updateSet = {};
    const newBalance = balance - price;
    updateSet[`profiles.common_core.items.${vbucksKey}.quantity`] = newBalance;
    updateSet[`profiles.profile0.items.${vbucksKey}.quantity`] = newBalance;

    const addedNames = [];
    for (const grant of grants) {
        const newItemId = functions.MakeID();
        updateSet[`profiles.athena.items.${newItemId}`] = {
            templateId: grant,
            attributes: {
                item_seen: false,
                variants: [],
                favorite: false,
                creation_time: new Date().toISOString(),
            },
            quantity: 1,
        };
        addedNames.push(grant);
    }

    updateSet["profiles.common_core.rvn"] = (common_core.rvn || 0) + 1;
    updateSet["profiles.common_core.commandRevision"] = (common_core.commandRevision || 0) + 1;
    updateSet["profiles.profile0.rvn"] = (profile0.rvn || 0) + 1;
    updateSet["profiles.profile0.commandRevision"] = (profile0.commandRevision || 0) + 1;
    updateSet["profiles.athena.rvn"] = (athena.rvn || 0) + 1;
    updateSet["profiles.athena.commandRevision"] = (athena.commandRevision || 0) + 1;

    await Profile.updateOne({ accountId }, { $set: updateSet });

    log.debug(`Launcher shop purchase: ${accountId} bought ${offerId} for ${price}`);

    return {
        success: true,
        message: `Purchased for ${price} V-Bucks.`,
        balance: newBalance,
        price,
        items: addedNames,
    };
}

module.exports = {
    getVbucksBalance,
    purchaseOffer,
};
