/**
 * launcherAnticheat.js
 *
 * REST endpoints consumed by the Pulse launcher's built-in process monitor.
 * The launcher polls /phoenix/api/anticheat/config to get the blocklist,
 * then reports detections to /phoenix/api/anticheat/report.
 *
 * On detection the backend:
 *   1. Sends a warning / ban response the launcher displays as a popup
 *   2. Fires a Discord webhook
 *   3. After MAX_WARNINGS, permanently bans the account + all hardware/IPs
 */

const express  = require("express");
const app      = express.Router();
const fs       = require("fs");
const https    = require("https");
const http     = require("http");
const User     = require("../model/user.js");
const log      = require("../structs/log.js");
const { verifyToken } = require("../tokenManager/tokenVerify.js");
const { banAllUserHwids }    = require("../structs/hwidManager.js");
const { banAllUserIps }      = require("../structs/ipBanManager.js");
const { banAllUserHardware } = require("../structs/hardwareManager.js");

const MAX_WARNINGS = 1; // Warn once, then perma-ban

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig() {
    try { return JSON.parse(fs.readFileSync("./Config/config.json", "utf8")); }
    catch { return {}; }
}

// ─── Webhook helper ───────────────────────────────────────────────────────────

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

async function notifyDetection({ username, accountId, processName, action, ip }) {
    const cfg = getConfig();
    // Use dedicated anticheat webhook, fall back to suspicious
    const url = cfg.launcherWebhooks?.anticheat || cfg.launcherWebhooks?.suspicious;
    if (!url || url.includes("PASTE_YOUR")) return;

    const emoji = action === "banned" ? "🔨" : "⚠️";
    await postWebhook(url, {
        embeds: [{
            title: `${emoji} Launcher AntiCheat — ${action === "banned" ? "BANNED" : "Warning Issued"}`,
            description: action === "banned"
                ? `**${username}** was **permanently banned** for running a blocked process.`
                : `**${username}** was warned for running a blocked process. They must close it to continue.`,
            color: action === "banned" ? 0xef4444 : 0xf97316,
            fields: [
                { name: "Username",     value: `\`${username}\``,    inline: true  },
                { name: "Account ID",   value: `\`${accountId}\``,   inline: true  },
                { name: "Process",      value: `\`${processName}\``, inline: true  },
                { name: "IP",           value: `\`${ip || "?"}\``,   inline: true  },
                { name: "Action",       value: action === "banned" ? "Permanently banned + all IPs/HWIDs/hardware" : "Warning sent — must close process", inline: false },
            ],
            timestamp: new Date().toISOString(),
            footer: { text: cfg.launcher?.brandName || "Crystal Backend" },
        }],
    });
}

// ─── Blocked process list ─────────────────────────────────────────────────────
// The launcher receives this list and monitors for these processes.
// Organised by category for the popup message.

const BLOCKED_PROCESSES = [
    { name: "crystal.spoofer.exe", category: "spoofer", warn: false }, // instant ban
];

const CATEGORY_MESSAGES = {
    cheat_engine: "Cheat Engine",
    injector:     "a DLL injector",
    debugger:     "a debugger / reverse-engineering tool",
    cmd:          "CMD / PowerShell (suspicious while in-game)",
    memory_tool:  "a memory editing tool",
    cheat:        "a known cheat program",
};

// ─── GET /phoenix/api/anticheat/config ────────────────────────────────────────
// Launcher fetches this on startup and after each game launch.
// Returns the blocklist + heartbeat interval.

app.get("/phoenix/api/anticheat/config", verifyToken, (req, res) => {
    const cfg = getConfig();
    res.json({
        enabled:            true,
        heartbeatIntervalMs: 10000,   // how often the launcher checks processes
        warnMessage: `⚠️ Crystal Servers Anti-Cheat\n\nYou have opened **{process}** while the game is running.\n\nPlease **close it immediately** or you will be **permanently banned** from Crystal Servers.\n\nThis is your only warning.`,
        banMessage:  `🔨 Crystal Servers Anti-Cheat\n\nYou have been **permanently banned** for running **{process}**.\n\nIf you believe this is a mistake, open a support ticket in our Discord.`,
        blockedProcesses:   BLOCKED_PROCESSES,
        brandName:          cfg.launcher?.brandName || "Crystal Servers",
    });
});

// ─── POST /phoenix/api/anticheat/report ───────────────────────────────────────
// Launcher posts this when it detects a blocked process.
// Body: { processName: string, pid?: number }

app.post("/phoenix/api/anticheat/report", verifyToken, async (req, res) => {
    const processName = String(req.body?.processName || "").trim().toLowerCase();
    const pid         = req.body?.pid || null;

    if (!processName) return res.status(400).json({ action: "none" });

    const user = await User.findOne({ accountId: req.user.accountId }).lean();
    if (!user) return res.status(404).json({ action: "none" });

    // Already banned — just tell the launcher
    if (user.banned) {
        return res.json({ action: "banned", message: "Your account is already banned." });
    }

    const entry = BLOCKED_PROCESSES.find(p => p.name.toLowerCase() === processName);
    const category = entry?.category || "unknown";
    const warn     = entry ? entry.warn : true;

    // Count how many anticheat flags this account already has
    const existingFlags = (user.anticheatFlags || []).filter(
        f => f.reason && f.reason.includes("launcher_process")
    );

    // Record the flag
    await User.updateOne(
        { accountId: user.accountId },
        {
            $push: {
                anticheatFlags: {
                    reason:     `launcher_process:${processName}`,
                    severity:   warn ? "warning" : "critical",
                    detectedAt: new Date(),
                    ip:         req.ip || null,
                    metadata:   { processName, pid, category },
                },
            },
        }
    );

    const cfg    = getConfig();
    const brand  = cfg.launcher?.brandName || "Crystal Servers";
    const ipAddr = req.ip || "unknown";
    const catMsg = CATEGORY_MESSAGES[category] || processName;

    // Instant ban for known cheats OR exceeded warning limit
    if (!warn || existingFlags.length >= MAX_WARNINGS) {
        const reason = `Banned by launcher anti-cheat: running ${processName}`;

        await User.updateOne(
            { accountId: user.accountId },
            { $set: { banned: true, banReason: reason, bannedUntil: null } }
        );

        // Nuke all IPs, HWIDs, hardware
        const freshUser = await User.findOne({ accountId: user.accountId }).lean();
        if (freshUser) {
            await Promise.all([
                banAllUserHwids(freshUser,    reason, "launcher_ac"),
                banAllUserIps(freshUser,      reason, "launcher_ac"),
                banAllUserHardware(freshUser, reason, "launcher_ac"),
            ]);
        }

        // Kill their active session
        const xmppClient = global.Clients?.find(c => c.accountId === user.accountId);
        if (xmppClient) xmppClient.client.close();

        notifyDetection({
            username:    user.username,
            accountId:   user.accountId,
            processName,
            action:      "banned",
            ip:          ipAddr,
        }).catch(() => {});

        log.debug(`[LauncherAC] Banned ${user.username} for running: ${processName}`);

        return res.json({
            action:  "banned",
            message: `🔨 You have been permanently banned from ${brand} for running **${catMsg}**. If you believe this is a mistake, open a support ticket.`,
        });
    }

    // Issue warning
    notifyDetection({
        username:    user.username,
        accountId:   user.accountId,
        processName,
        action:      "warned",
        ip:          ipAddr,
    }).catch(() => {});

    log.debug(`[LauncherAC] Warned ${user.username} for running: ${processName}`);

    return res.json({
        action:   "warn",
        message:  `⚠️ Crystal Servers Anti-Cheat detected **${catMsg}** running on your PC.\n\nClose it immediately or you will be **permanently banned** from ${brand}. This is your final warning.`,
        mustClose: true,
    });
});

// ─── POST /phoenix/api/anticheat/heartbeat ────────────────────────────────────
// Launcher sends a heartbeat every N seconds while the game is running.
// We respond with whether the account is still valid.

app.post("/phoenix/api/anticheat/heartbeat", verifyToken, async (req, res) => {
    const user = await User.findOne({ accountId: req.user.accountId }).lean();
    if (!user || user.banned) {
        return res.json({ valid: false, reason: user?.banReason || "Account banned." });
    }
    return res.json({ valid: true });
});

module.exports = app;
