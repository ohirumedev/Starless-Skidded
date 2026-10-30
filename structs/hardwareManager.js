/**
 * hardwareManager.js
 *
 * Handles:
 *  - Recording per-component hardware fingerprints per account
 *  - Checking hardware component bans
 *  - Banning all components of an account at once
 *  - Spoof detection: when a banned component reappears under a new ID,
 *    fire a Discord webhook alert
 */

const fs   = require("fs");
const https = require("https");
const http  = require("http");
const User  = require("../model/user.js");
const HardwareBan = require("../model/hardwareBan.js");
const log   = require("./log.js");

// Components the client may send
const KNOWN_COMPONENTS = ["gpu", "cpu", "motherboard", "disk", "ram", "nic", "mouse", "keyboard", "monitor"];

// ─── Config helper ────────────────────────────────────────────────────────────

let _config = null;
function getConfig() {
    if (!_config) {
        try { _config = JSON.parse(fs.readFileSync("./Config/config.json", "utf8")); }
        catch { _config = {}; }
    }
    return _config;
}

// ─── Webhook ─────────────────────────────────────────────────────────────────

function postWebhook(url, payload) {
    if (!url || !url.startsWith("http")) return Promise.resolve();
    return new Promise((resolve) => {
        try {
            const parsed = new URL(url);
            const lib  = parsed.protocol === "https:" ? https : http;
            const body = JSON.stringify(payload);
            const req  = lib.request(url, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
                timeout: 8000,
            }, (res) => { res.on("data", () => {}); res.on("end", resolve); });
            req.on("error", () => resolve());
            req.on("timeout", () => { req.destroy(); resolve(); });
            req.write(body); req.end();
        } catch { resolve(); }
    });
}

async function sendSpoofAlert({ username, accountId, componentType, oldId, newId, ip }) {
    const cfg = getConfig();
    // Use dedicated anticheat webhook, fall back to suspicious
    const url = cfg.launcherWebhooks?.anticheat || cfg.launcherWebhooks?.suspicious;
    if (!url || url.includes("PASTE_YOUR")) return;

    await postWebhook(url, {
        embeds: [{
            title: "🚨 Hardware Spoof Detected",
            description: `**${username}** has changed a banned hardware component.`,
            color: 0xef4444,
            fields: [
                { name: "Username",        value: `\`${username}\``,        inline: true  },
                { name: "Account ID",      value: `\`${accountId}\``,       inline: true  },
                { name: "Component",       value: `\`${componentType}\``,   inline: true  },
                { name: "Banned ID",       value: `\`${(oldId  || "?").slice(0,40)}\``, inline: false },
                { name: "New (spoofed) ID", value: `\`${(newId || "?").slice(0,40)}\``, inline: false },
                { name: "IP",              value: `\`${ip || "unknown"}\``, inline: true  },
            ],
            timestamp: new Date().toISOString(),
            footer: { text: cfg.launcher?.brandName || "Pulse Backend" },
        }],
    });
}

// ─── Record hardware fingerprint ──────────────────────────────────────────────

/**
 * Record per-component hardware IDs for an account.
 * @param {string} accountId
 * @param {object} components  { gpu: ["id1"], cpu: ["id2"], mouse: ["id3"], ... }
 * @param {string} [clientIp]
 */
async function recordHardware(accountId, components, clientIp) {
    if (!accountId || !components || typeof components !== "object") return;

    const user = await User.findOne({ accountId }).lean();
    if (!user) return;

    const existing = user.hardware || {};
    const setOps   = { hardwareLastSeen: new Date() };
    const addToSet = {};

    for (const comp of KNOWN_COMPONENTS) {
        const incoming = Array.isArray(components[comp]) ? components[comp].filter(Boolean) : [];
        if (incoming.length === 0) continue;

        const existingIds = existing[comp] || [];

        // Detect spoof: if a NEW id arrives for a component that already has a banned id
        const bannedEntry = await HardwareBan.findOne({ componentType: comp }).lean();
        if (bannedEntry) {
            for (const newId of incoming) {
                if (!existingIds.includes(newId)) {
                    // This is a new ID for this component — check if the old one was banned
                    const wasBanned = await HardwareBan.findOne({ componentType: comp, componentId: { $in: existingIds } }).lean();
                    if (wasBanned) {
                        log.debug(`[hardwareManager] Spoof detected: ${accountId} changed ${comp} from banned ID to ${newId.slice(0,20)}`);
                        // Fire webhook alert
                        sendSpoofAlert({
                            username: user.username,
                            accountId,
                            componentType: comp,
                            oldId: wasBanned.componentId,
                            newId,
                            ip: clientIp,
                        }).catch(() => {});
                    }
                }
            }
        }

        addToSet[`hardware.${comp}`] = { $each: incoming };
    }

    const update = { $set: setOps };
    if (Object.keys(addToSet).length > 0) update.$addToSet = addToSet;

    await User.updateOne({ accountId }, update);
}

// ─── Ban checking ─────────────────────────────────────────────────────────────

/**
 * Check if any component in the provided hardware map matches a ban.
 * Returns the first matching ban document, or null.
 */
async function findBannedHardware(components) {
    if (!components || typeof components !== "object") return null;

    for (const comp of KNOWN_COMPONENTS) {
        const ids = Array.isArray(components[comp]) ? components[comp].filter(Boolean) : [];
        if (ids.length === 0) continue;

        const ban = await HardwareBan.findOne({
            componentType: comp,
            componentId: { $in: ids },
        }).lean();

        if (ban) return ban;
    }

    return null;
}

// ─── Ban all hardware of an account ──────────────────────────────────────────

/**
 * Bans every stored hardware component ID for a user.
 * Returns a summary { total, components } of what was banned.
 */
async function banAllUserHardware(user, reason, source = "admin") {
    if (!user) return { total: 0, components: {} };

    const hw = user.hardware || {};
    const summary = {};
    let total = 0;

    for (const comp of KNOWN_COMPONENTS) {
        const ids = hw[comp] || [];
        if (ids.length === 0) continue;

        summary[comp] = [];

        for (const id of ids) {
            try {
                await HardwareBan.updateOne(
                    { componentType: comp, componentId: id },
                    {
                        $set: {
                            componentType: comp,
                            componentId:   id,
                            accountId:     user.accountId,
                            username:      user.username,
                            reason,
                            bannedAt:      new Date(),
                            bannedUntil:   null,
                            source,
                        },
                    },
                    { upsert: true },
                );
                summary[comp].push(id);
                total++;
            } catch (err) {
                log.debug(`[hardwareManager] Failed to ban ${comp}/${id}: ${err.message}`);
            }
        }
    }

    log.debug(`[hardwareManager] Banned ${total} hardware component(s) for ${user.username}`);
    return { total, components: summary };
}

// ─── Unban all hardware of an account ────────────────────────────────────────

async function unbanAllUserHardware(user) {
    if (!user) return 0;

    const hw = user.hardware || {};
    const allIds = [];

    for (const comp of KNOWN_COMPONENTS) {
        for (const id of (hw[comp] || [])) {
            if (id) allIds.push({ componentType: comp, componentId: id });
        }
    }

    if (allIds.length === 0) return 0;

    let removed = 0;
    for (const entry of allIds) {
        const r = await HardwareBan.deleteOne(entry);
        removed += r.deletedCount || 0;
    }

    return removed;
}

// ─── Get hardware summary for display ────────────────────────────────────────

function summarizeHardware(hw) {
    if (!hw) return "No hardware data on file.";

    const lines = [];
    for (const comp of KNOWN_COMPONENTS) {
        const ids = hw[comp] || [];
        if (ids.length > 0) {
            lines.push(`**${comp.toUpperCase()}:** ${ids.slice(0,2).map(id => `\`${id.slice(0,20)}…\``).join(", ")}${ids.length > 2 ? ` +${ids.length - 2}` : ""}`);
        }
    }

    return lines.length > 0 ? lines.join("\n") : "No hardware data on file.";
}

module.exports = {
    KNOWN_COMPONENTS,
    recordHardware,
    findBannedHardware,
    banAllUserHardware,
    unbanAllUserHardware,
    summarizeHardware,
};
