const express = require("express");
const app = express.Router();
const path = require("path");
const fs = require("fs");

const Profile = require("../model/profiles.js");
const error = require("../structs/error.js");
const log = require("../structs/log.js");
const functions = require("../structs/functions.js");
const { verifyToken } = require("../tokenManager/tokenVerify.js");

// Directory where island saves are stored on disk (one JSON file per accountId)
const ISLAND_SAVE_DIR = path.join(__dirname, "../CreativeIslands");
if (!fs.existsSync(ISLAND_SAVE_DIR)) fs.mkdirSync(ISLAND_SAVE_DIR, { recursive: true });

function getIslandPath(accountId) {
    // Sanitize accountId to avoid path traversal
    const safe = accountId.replace(/[^a-zA-Z0-9_\-]/g, "");
    return path.join(ISLAND_SAVE_DIR, `${safe}.json`);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET  /fortnite/api/game/v2/creative/plots/:accountId
// The game fetches the player's island save data on load.
// Returns the raw island JSON wrapped in the expected envelope.
// ─────────────────────────────────────────────────────────────────────────────
app.get("/fortnite/api/game/v2/creative/plots/:accountId", verifyToken, async (req, res) => {
    const accountId = req.params.accountId;

    log.debug(`[Creative] GET plots for ${accountId}`);

    const filePath = getIslandPath(accountId);

    if (!fs.existsSync(filePath)) {
        // No save yet — return empty island data so the client loads the default blank plot
        return res.json({
            accountId,
            version: 0,
            islandData: null,
            lastUpdated: new Date().toISOString()
        });
    }

    try {
        const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return res.json(saved);
    } catch (err) {
        log.error(`[Creative] Failed to read island save for ${accountId}: ${err.message}`);
        return res.status(500).json({ error: "Failed to read island save." });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /fortnite/api/game/v2/creative/plots/:accountId
// The game posts the island save blob when the player saves.
// ─────────────────────────────────────────────────────────────────────────────
app.post("/fortnite/api/game/v2/creative/plots/:accountId", verifyToken, async (req, res) => {
    const accountId = req.params.accountId;

    log.debug(`[Creative] POST save for ${accountId}`);

    if (!req.body || typeof req.body !== "object") {
        return error.createError(
            "errors.com.epicgames.creative.invalid_body",
            "Request body is missing or not JSON.",
            [], 400, undefined, 400, res
        );
    }

    const filePath = getIslandPath(accountId);
    const saveData = {
        accountId,
        version: (req.body.version ?? 0) + 1,
        islandData: req.body.islandData ?? req.body,
        lastUpdated: new Date().toISOString()
    };

    try {
        fs.writeFileSync(filePath, JSON.stringify(saveData, null, 2), "utf8");
        log.debug(`[Creative] Saved island for ${accountId} (v${saveData.version})`);
        return res.json({ status: "saved", version: saveData.version });
    } catch (err) {
        log.error(`[Creative] Failed to write island save for ${accountId}: ${err.message}`);
        return res.status(500).json({ error: "Failed to write island save." });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// MCP command: QueryProfile (creative profile)
// The game sends this when opening the MY ISLAND tab.
// We return the creative profile with the island_item_data stat pointing to
// the player's saved version so the client knows what to load.
// ─────────────────────────────────────────────────────────────────────────────
app.post("/fortnite/api/game/v2/profile/*/client/QueryProfile", verifyToken, async (req, res, next) => {
    // Only intercept creative profile queries — pass everything else to mcp.js
    if (req.query.profileId !== "creative") return next();

    const accountId = req.user.accountId;
    const profiles = await Profile.findOne({ accountId });

    if (!profiles) {
        return error.createError(
            "errors.com.epicgames.modules.profiles.operation_forbidden",
            `No profiles found for account ${accountId}`,
            [accountId], 12813, undefined, 403, res
        );
    }

    let profile = profiles.profiles["creative"];
    if (!profile) {
        // Build a minimal creative profile on the fly
        profile = {
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            rvn: 1,
            wipeNumber: 1,
            accountId,
            profileId: "creative",
            version: "no_version",
            items: {},
            stats: { attributes: { inventory_limit_bonus: 0 } },
            commandRevision: 0
        };
    }

    // Attach island_item_data so the MY ISLAND tab can show the correct version
    const filePath = getIslandPath(accountId);
    if (fs.existsSync(filePath)) {
        try {
            const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
            profile.stats.attributes.island_item_data = {
                lastUpdated: saved.lastUpdated,
                version: saved.version,
                hasData: true
            };
        } catch { /* ignore read errors — tab will just show empty */ }
    } else {
        profile.stats.attributes.island_item_data = {
            lastUpdated: null,
            version: 0,
            hasData: false
        };
    }

    const BaseRevision = profile.rvn || 0;
    profile.rvn += 1;
    profile.commandRevision = (profile.commandRevision || 0) + 1;
    profile.updated = new Date().toISOString();

    await profiles.updateOne({ $set: { "profiles.creative": profile } });

    return res.json({
        profileRevision: profile.rvn,
        profileId: "creative",
        profileChangesBaseRevision: BaseRevision,
        profileChanges: [{
            changeType: "fullProfileUpdate",
            profile
        }],
        profileCommandRevision: profile.commandRevision,
        serverTime: new Date().toISOString(),
        responseVersion: 1
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// MCP command: RefreshExpeditions / placeholder for any unhandled creative cmds
// Returns a no-op success so the client doesn't hang.
// ─────────────────────────────────────────────────────────────────────────────
app.post("/fortnite/api/game/v2/profile/*/client/PublishCreativeIsland", verifyToken, async (req, res) => {
    const accountId = req.user.accountId;
    const profiles = await Profile.findOne({ accountId });

    if (!profiles) return res.json({ profileRevision: 1, profileId: "creative", profileChangesBaseRevision: 0, profileChanges: [], profileCommandRevision: 0, serverTime: new Date().toISOString(), responseVersion: 1 });

    let profile = profiles.profiles["creative"] || { rvn: 1, commandRevision: 0 };

    const BaseRevision = profile.rvn || 0;
    profile.rvn = (profile.rvn || 0) + 1;
    profile.commandRevision = (profile.commandRevision || 0) + 1;
    profile.updated = new Date().toISOString();

    await profiles.updateOne({ $set: { "profiles.creative": profile } });

    log.debug(`[Creative] PublishCreativeIsland for ${accountId}`);

    return res.json({
        profileRevision: profile.rvn,
        profileId: "creative",
        profileChangesBaseRevision: BaseRevision,
        profileChanges: [],
        profileCommandRevision: profile.commandRevision,
        serverTime: new Date().toISOString(),
        responseVersion: 1
    });
});

module.exports = app;
