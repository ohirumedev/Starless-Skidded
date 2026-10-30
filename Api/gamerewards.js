const express = require("express");
const app = express.Router();
const log = require("../structs/log.js");
const { grantVbucksForReason } = require("../structs/functions.js");
const fs = require("fs");

function getConfig() {
    try {
        return JSON.parse(fs.readFileSync("./Config/config.json").toString());
    } catch {
        return {};
    }
}

/**
 * POST /api/game/kill — game server reports an elimination
 * Body: { killerAccountId, victimAccountId?, distance?, headshot? }
 */
app.post("/api/game/kill", async (req, res) => {
    try {
        const killerAccountId = req.body?.killerAccountId || req.body?.accountId;
        if (!killerAccountId) {
            return res.status(400).json({ error: "killerAccountId is required" });
        }

        const granted = await grantVbucksForReason(killerAccountId, "Kill", 1);
        const config = getConfig();
        const vbucks = granted ? (config.Api?.reasons?.Kill ?? 0) : 0;

        if (granted) {
            log.backend(`Kill reward: ${killerAccountId} +${vbucks} V-Bucks`);
        }

        return res.json({
            success: true,
            rewards: { vbucks },
        });
    } catch (err) {
        log.error(`Error processing kill: ${err?.message || err}`);
        return res.status(500).json({ error: "internal_error" });
    }
});

/**
 * POST /api/game/win — game server reports a victory
 * Body: { accountId, placement?, eliminations? }
 */
app.post("/api/game/win", async (req, res) => {
    try {
        const accountId = req.body?.accountId;
        if (!accountId) {
            return res.status(400).json({ error: "accountId is required" });
        }

        const granted = await grantVbucksForReason(accountId, "Win", 1);
        const config = getConfig();
        const vbucks = granted ? (config.Api?.reasons?.Win ?? 0) : 0;

        if (granted) {
            log.backend(`Win reward: ${accountId} +${vbucks} V-Bucks`);
        }

        return res.json({
            success: true,
            rewards: { vbucks },
        });
    } catch (err) {
        log.error(`Error processing win: ${err?.message || err}`);
        return res.status(500).json({ error: "internal_error" });
    }
});

module.exports = app;
