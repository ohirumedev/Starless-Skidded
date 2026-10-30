const fs = require("fs");
const https = require("https");
const http = require("http");
const log = require("./log.js");

const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());

function isEnabled() {
    return !!config.launcherWebhooks?.enabled;
}

function postWebhook(url, payload) {
    if (!url || !url.startsWith("http")) return Promise.resolve();

    return new Promise((resolve) => {
        try {
            const parsed = new URL(url);
            const lib = parsed.protocol === "https:" ? https : http;
            const body = JSON.stringify(payload);
            const req = lib.request(
                url,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Content-Length": Buffer.byteLength(body),
                    },
                    timeout: 8000,
                },
                (res) => {
                    res.on("data", () => {});
                    res.on("end", resolve);
                },
            );
            req.on("error", (err) => {
                log.debug(`Webhook failed: ${err.message}`);
                resolve();
            });
            req.on("timeout", () => {
                req.destroy();
                resolve();
            });
            req.write(body);
            req.end();
        } catch (err) {
            log.debug(`Webhook error: ${err.message}`);
            resolve();
        }
    });
}

async function sendEmbed(webhookKey, title, description, color = 0xa855f7, fields = []) {
    if (!isEnabled()) return;
    const url = config.launcherWebhooks?.[webhookKey];
    if (!url) return;

    await postWebhook(url, {
        embeds: [{
            title,
            description,
            color,
            fields,
            timestamp: new Date().toISOString(),
            footer: { text: config.launcher?.brandName || "Pulse Backend" },
        }],
    });
}

async function notifyPurchase({ username, itemName, price, offerId }) {
    await sendEmbed(
        "purchase",
        "Shop Purchase",
        `**${username}** purchased **${itemName}**`,
        0x22c55e,
        [
            { name: "Price", value: `${price} V-Bucks`, inline: true },
            { name: "Offer", value: offerId || "—", inline: true },
        ],
    );
}

async function notifyBan({ username, accountId, reason, bannedBy }) {
    await sendEmbed(
        "ban",
        "Account Banned",
        `**${username}** was banned`,
        0xef4444,
        [
            { name: "Account ID", value: accountId || "—", inline: true },
            { name: "Reason", value: reason || "No reason provided", inline: false },
            { name: "By", value: bannedBy || "Admin", inline: true },
        ],
    );
}

async function notifyServerCrash({ serverName, error, playersAffected }) {
    await sendEmbed(
        "serverCrash",
        "Game Server Alert",
        error || "A game server reported a crash or disconnect.",
        0xf97316,
        [
            { name: "Server", value: serverName || "Unknown", inline: true },
            { name: "Players", value: String(playersAffected ?? "—"), inline: true },
        ],
    );
}

async function notifySuspiciousActivity({ type, ip, hwid, email, details }) {
    await sendEmbed(
        "suspicious",
        "Suspicious Activity",
        details || `Suspicious ${type} detected`,
        0xeab308,
        [
            { name: "Type", value: type, inline: true },
            { name: "IP", value: ip || "—", inline: true },
            { name: "HWID", value: hwid ? `${hwid.slice(0, 12)}…` : "—", inline: true },
            { name: "Email", value: email || "—", inline: false },
        ],
    );
}

module.exports = {
    isEnabled,
    notifyPurchase,
    notifyBan,
    notifyServerCrash,
    notifySuspiciousActivity,
};
