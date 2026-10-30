const express = require("express");
const fs = require("fs");
const path = require("path");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const app = express.Router();
const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());
const User = require("../model/user.js");
const UserStats = require("../model/userstats.js");
const Profiles = require("../model/profiles.js");
const Friends = require("../model/friends.js");
const TournamentStanding = require("../model/tournamentStanding.js");
const { verifyToken } = require("../tokenManager/tokenVerify.js");
const { getPlayerSkinInfo } = require("../structs/launcherSkin.js");
const { getVbucksBalance } = require("../structs/launcherShopPurchase.js");
const functions = require("../structs/functions.js");
const redisCache = require("../structs/redisCache.js");
const analytics = require("../structs/analytics.js");
const log = require("../structs/log.js");
const { isUserBanned } = require("../structs/anticheatServer.js");
const { resolveDiscordAvatarUrl } = require("./irisLauncherHelpers.js");

function readJson(relativePath, fallback) {
    try {
        const full = path.join(__dirname, "..", relativePath);
        return JSON.parse(fs.readFileSync(full, "utf8"));
    } catch {
        return fallback;
    }
}

function isOnline(accountId) {
    return !!(global.Clients || []).find((c) => c.accountId === accountId);
}

app.get("/phoenix/api/launcher/news", async (req, res) => {
    try {
        const data = await redisCache.getOrSet("launcher:news", 300, async () => {
            const file = readJson("Config/launcher_news.json", { articles: [] });
            return (file.articles || []).sort((a, b) => {
                if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
                return new Date(b.publishedAt) - new Date(a.publishedAt);
            });
        });
        return res.json({ success: true, articles: data });
    } catch (err) {
        log.error(`Launcher news error: ${err}`);
        return res.status(500).json({ success: false, articles: [] });
    }
});

app.get("/phoenix/api/launcher/season-events", async (req, res) => {
    try {
        const events = await redisCache.getOrSet("launcher:season_events", 300, async () => {
            const file = readJson("Config/season_events.json", { events: [] });
            return file.events || [];
        });
        return res.json({ success: true, events });
    } catch (err) {
        log.error(`Season events error: ${err}`);
        return res.status(500).json({ success: false, events: [] });
    }
});

app.get("/phoenix/api/launcher/friends", verifyToken, async (req, res) => {
    try {
        const accountId = req.user.accountId;
        const friendsDoc = await Friends.findOne({ accountId }).lean();
        const accepted = friendsDoc?.list?.accepted || [];

        const accountIds = accepted.map((f) => f.accountId).filter(Boolean);
        const users = accountIds.length
            ? await User.find({ accountId: { $in: accountIds } }).lean()
            : [];
        const userMap = new Map(users.map((u) => [u.accountId, u]));

        const friends = await Promise.all(
            accepted.map(async (f) => {
                const user = userMap.get(f.accountId);
                if (!user) return null;
                const skin = await getPlayerSkinInfo(user.accountId);
                return {
                    accountId: user.accountId,
                    username: user.username,
                    online: isOnline(user.accountId),
                    skinName: skin.skinName,
                    skinIconUrl: skin.skinIconUrl,
                    discordAvatarUrl: await resolveDiscordAvatarUrl(user),
                };
            }),
        );

        return res.json({
            success: true,
            friends: friends.filter(Boolean),
            onlineCount: friends.filter((f) => f?.online).length,
        });
    } catch (err) {
        log.error(`Launcher friends error: ${err}`);
        return res.status(500).json({ success: false, friends: [] });
    }
});

app.get("/phoenix/api/launcher/profile", verifyToken, async (req, res) => {
    try {
        const accountId = req.user.accountId;
        const cacheKey = `launcher:profile:${accountId}`;

        const profile = await redisCache.getOrSet(cacheKey, 60, async () => {
            const user = await User.findOne({ accountId }).lean();
            if (!user) return null;

            const arenaEventId = functions.getConfiguredArenaEventId?.() || "";
            const [skin, stats, profileDoc, standing, balance] = await Promise.all([
                getPlayerSkinInfo(accountId),
                UserStats.findOne({ accountId }).lean(),
                Profiles.findOne({ accountId }).lean(),
                TournamentStanding.findOne({ accountId, eventId: arenaEventId }).lean(),
                getVbucksBalance(accountId),
            ]);

            const solo = stats?.solo || {};
            const athena = profileDoc?.profiles?.athena || {};
            const bookLevel = athena?.stats?.attributes?.book_level ?? 1;
            const bookXp = athena?.stats?.attributes?.book_xp ?? 0;
            const seasonNum = config.bBattlePassSeason || 24;
            const maxLevel = config.bMaxBattlePassLevel || 100;

            return {
                username: user.username,
                accountId: user.accountId,
                email: user.email,
                discordId: user.discordId || "",
                discordAvatarUrl: await resolveDiscordAvatarUrl(user),
                skinName: skin.skinName,
                skinIconUrl: skin.skinIconUrl,
                skinTemplateId: skin.skinTemplateId,
                vbucks: balance,
                stats: {
                    wins: solo.placetop1 ?? 0,
                    kills: solo.kills ?? 0,
                    matches: solo.matchesplayed ?? 0,
                    kd: solo.kills && solo.placetop1
                        ? Number((solo.kills / Math.max(solo.placetop1, 1)).toFixed(2))
                        : solo.kills ?? 0,
                },
                arena: {
                    points: standing?.points ?? 0,
                    division: standing?.division ?? 0,
                },
                battlePass: {
                    season: seasonNum,
                    level: bookLevel,
                    xp: bookXp,
                    maxLevel,
                    progress: Math.min(100, Math.round((bookLevel / maxLevel) * 100)),
                },
            };
        });

        if (!profile) {
            return res.status(404).json({ success: false, message: "Profile not found." });
        }

        return res.json({ success: true, profile });
    } catch (err) {
        log.error(`Launcher profile error: ${err}`);
        return res.status(500).json({ success: false, message: "Could not load profile." });
    }
});

app.post("/phoenix/api/launcher/analytics/track", verifyToken, async (req, res) => {
    try {
        const type = String(req.body?.type || "").trim();
        if (!type) return res.status(400).json({ success: false });

        await analytics.track(type, {
            accountId: req.user.accountId,
            username: req.user.username,
            metadata: req.body?.metadata || {},
        });

        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false });
    }
});

module.exports = app;
