/**
 * securityMonitor.js
 * 
 * Two features:
 *  1. Suspicious login detection  — fires when a known account logs in from
 *     a brand-new IP or HWID it has never used before.
 *  2. Account sharing detection   — fires when a single HWID is seen across
 *     multiple distinct accounts (threshold configurable below).
 *
 * All alerts are sent as Discord embeds through the existing "suspicious"
 * webhook defined in Config/config.json → launcherWebhooks.suspicious
 */

const fs   = require("fs");
const https = require("https");
const http  = require("http");
const log   = require("./log.js");
const User  = require("../model/user.js");

// ─── Config ──────────────────────────────────────────────────────────────────

let _config = null;
function getConfig() {
    if (!_config) {
        try {
            _config = JSON.parse(fs.readFileSync("./Config/config.json", "utf8"));
        } catch {
            _config = {};
        }
    }
    return _config;
}

// How many distinct accounts on the same HWID before we flag sharing.
const SHARING_ACCOUNT_THRESHOLD = 3;

// Cooldown: don't re-alert the same (accountId, type) within this many ms.
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

// In-process cooldown store: Map<"accountId:type", lastAlertTimestamp>
const _cooldowns = new Map();

function isOnCooldown(accountId, type) {
    const key = `${accountId}:${type}`;
    const last = _cooldowns.get(key);
    if (!last) return false;
    return (Date.now() - last) < ALERT_COOLDOWN_MS;
}

function setCooldown(accountId, type) {
    _cooldowns.set(`${accountId}:${type}`, Date.now());
}

// ─── Webhook sender ──────────────────────────────────────────────────────────

function postWebhook(url, payload) {
    if (!url || !url.startsWith("http")) return Promise.resolve();

    return new Promise((resolve) => {
        try {
            const parsed = new URL(url);
            const lib    = parsed.protocol === "https:" ? https : http;
            const body   = JSON.stringify(payload);

            const req = lib.request(
                url,
                {
                    method: "POST",
                    headers: {
                        "Content-Type":   "application/json",
                        "Content-Length": Buffer.byteLength(body),
                    },
                    timeout: 8000,
                },
                (res) => {
                    res.on("data", () => {});
                    res.on("end", resolve);
                },
            );
            req.on("error",   () => resolve());
            req.on("timeout", () => { req.destroy(); resolve(); });
            req.write(body);
            req.end();
        } catch {
            resolve();
        }
    });
}

async function sendAlert(title, description, color, fields) {
    const cfg = getConfig();
    const url = cfg.launcherWebhooks?.suspicious;
    if (!url) return;

    const brandName = cfg.launcher?.brandName || "Pulse Backend";

    await postWebhook(url, {
        embeds: [{
            title,
            description,
            color,
            fields,
            timestamp: new Date().toISOString(),
            footer: { text: `${brandName} • Security Monitor` },
        }],
    });
}

// ─── 1. Suspicious login detection ───────────────────────────────────────────

/**
 * Call this right after a successful login in auth.js.
 *
 * @param {object} user       - Mongoose user document (lean or full)
 * @param {string} clientIp   - Resolved client IP (from ipBanManager.resolveClientIp)
 * @param {string} [hwid]     - Launcher HWID if available (optional)
 */
async function checkSuspiciousLogin(user, clientIp, hwid) {
    if (!user) return;

    const knownIps  = new Set([user.lastLauncherIp, ...(user.launcherIps || [])].filter(Boolean));
    const knownHwids = new Set([user.launcherHwid,  ...(user.hwids || [])].filter(Boolean));

    const isNewIp   = clientIp && !knownIps.has(clientIp);
    const isNewHwid = hwid     && !knownHwids.has(hwid);

    if (!isNewIp && !isNewHwid) return; // nothing suspicious

    if (isOnCooldown(user.accountId, "suspicious_login")) return;
    setCooldown(user.accountId, "suspicious_login");

    const reasons = [];
    if (isNewIp)   reasons.push(`New IP: \`${clientIp}\``);
    if (isNewHwid) reasons.push(`New HWID: \`${hwid.slice(0, 16)}…\``);

    log.debug(`[securityMonitor] Suspicious login for ${user.username}: ${reasons.join(", ")}`);

    const fields = [
        { name: "Username",   value: `\`${user.username}\``,    inline: true  },
        { name: "Account ID", value: `\`${user.accountId}\``,   inline: true  },
        { name: "Reason",     value: reasons.join("\n"),         inline: false },
    ];

    if (clientIp)          fields.push({ name: "IP",         value: `\`${clientIp}\``,                 inline: true });
    if (isNewIp && knownIps.size > 0)
        fields.push({ name: "Known IPs",  value: `${knownIps.size} on file`,            inline: true });
    if (hwid)              fields.push({ name: "HWID",        value: `\`${hwid.slice(0, 20)}…\``,       inline: true });

    await sendAlert(
        "⚠️ Suspicious Login Detected",
        `**${user.username}** logged in from an unrecognized device or location.`,
        0xf59e0b, // amber
        fields,
    );
}

// ─── 2. Account sharing detection ────────────────────────────────────────────

/**
 * Call this whenever a HWID is recorded for an account (after recordLauncherHwid).
 * Checks if that HWID is already associated with other accounts.
 *
 * @param {string} accountId  - Account that just logged in
 * @param {string} hwid       - The HWID that was just recorded
 */
async function checkAccountSharing(accountId, hwid) {
    if (!accountId || !hwid) return;

    const hwidTrimmed = String(hwid).trim();

    // Find all accounts that share this HWID (excluding the current one)
    const sharingAccounts = await User.find({
        accountId: { $ne: accountId },
        $or: [
            { launcherHwid: hwidTrimmed },
            { hwids: hwidTrimmed },
        ],
    }).select("accountId username banned").lean();

    if (sharingAccounts.length < SHARING_ACCOUNT_THRESHOLD - 1) return;

    // Use the HWID itself as the cooldown key (one alert per HWID, not per account)
    const cooldownKey = `hwid_share:${hwidTrimmed.slice(0, 32)}`;
    if (isOnCooldown(cooldownKey, "sharing")) return;
    setCooldown(cooldownKey, "sharing");

    // Fetch the current account for display
    const currentUser = await User.findOne({ accountId }).select("username accountId").lean();
    const currentName = currentUser?.username || accountId;

    const totalAccounts = sharingAccounts.length + 1; // +1 for the current account
    const accountList   = [
        `\`${currentName}\` *(current login)*`,
        ...sharingAccounts.slice(0, 8).map(u =>
            `\`${u.username}\`${u.banned ? " 🔴 banned" : ""}`
        ),
        ...(sharingAccounts.length > 8 ? [`…and ${sharingAccounts.length - 8} more`] : []),
    ].join("\n");

    log.debug(
        `[securityMonitor] Account sharing: HWID ${hwidTrimmed.slice(0, 16)}… ` +
        `shared across ${totalAccounts} accounts`
    );

    await sendAlert(
        "🚨 Account Sharing Detected",
        `A single HWID is linked to **${totalAccounts} accounts** (threshold: ${SHARING_ACCOUNT_THRESHOLD}).`,
        0xef4444, // red
        [
            {
                name:   "HWID (truncated)",
                value:  `\`${hwidTrimmed.slice(0, 32)}…\``,
                inline: false,
            },
            {
                name:   `Accounts (${totalAccounts})`,
                value:  accountList,
                inline: false,
            },
        ],
    );
}

module.exports = {
    checkSuspiciousLogin,
    checkAccountSharing,
};
