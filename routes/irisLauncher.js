const express = require("express");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const axios = require("axios");
const app = express.Router();
const bcrypt = require("bcrypt");
const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());
const User = require("../model/user.js");
const UserStats = require("../model/userstats.js");
const TournamentStanding = require("../model/tournamentStanding.js");
const { getPlayerSkinInfo, templateIdToImageSlug, fetchCosmeticsBatch, looksLikeCosmeticId } = require("../structs/launcherSkin.js");
const functions = require("../structs/functions.js");
const log = require("../structs/log.js");
const tokenCreation = require("../tokenManager/tokenCreation.js");
const { PHOENIX_BAN_MESSAGE, isUserBanned } = require("../structs/anticheatServer.js");
const { HWID_LOCK_MESSAGE, sendLauncherRegistrationDm } = require("../structs/launcherDiscord.js");
const { findBannedHwid, recordLauncherHwid } = require("../structs/hwidManager.js");
const {
    PHOENIX_IP_BAN_MESSAGE,
    resolveClientIp,
    findBannedIp,
    recordLauncherIp,
} = require("../structs/ipBanManager.js");
const { verifyToken } = require("../tokenManager/tokenVerify.js");
const gameServerRegistry = require("../structs/gameServerRegistry.js");
const { getVbucksBalance, purchaseOffer } = require("../structs/launcherShopPurchase.js");
const launcherParty = require("../structs/launcherParty.js");
const launcherChat = require("../structs/launcherChat.js");
const crypto = require("crypto");
const {
    getGoogleOAuthConfig,
    buildGoogleAuthorizeUrl,
    exchangeGoogleCode,
} = require("../structs/oauthGoogle.js");
const rateLimit = require("express-rate-limit");
const redisCache = require("../structs/redisCache.js");
const analytics = require("../structs/analytics.js");
const webhooks = require("../structs/webhooks.js");
const suspiciousActivity = require("../structs/suspiciousActivity.js");

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many login attempts. Try again later." },
});
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many registration attempts. Try again later." },
});
const purchaseLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many purchase attempts. Slow down." },
});

const REFRESH_SECONDS = 3600;
const EPIC_CLIENT_ID = "ec684b8c687f479fadea3e7aad8cfcfd";

async function createLauncherSession(user, ip) {
    const deviceId = functions.MakeID().replace(/-/ig, "");
    const accessToken = tokenCreation.createAccess(user, EPIC_CLIENT_ID, "password", deviceId, 8);
    tokenCreation.createRefresh(user, EPIC_CLIENT_ID, "password", deviceId, 24);
    functions.UpdateTokens();
    return accessToken;
}

app.post("/phoenix/api/launcher/login", loginLimiter, async (req, res) => {
    try {
        const email = String(req.body?.email || "").trim().toLowerCase();
        const password = String(req.body?.password || "");
        const hwid = String(req.body?.hwid || "").trim();

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required.",
            });
        }

        const clientIp = resolveClientIp(req);

        const user = await User.findOne({ email }).lean();
        if (!user) {
            return res.status(404).json({
                success: false,
                notRegistered: true,
                message: "No account found with this email. Please register first.",
            });
        }

        if (isUserBanned(user)) {
            return res.status(403).json({
                success: false,
                banned: true,
                message: PHOENIX_BAN_MESSAGE,
            });
        }

        const bannedHwid = await findBannedHwid([hwid, user.launcherHwid, ...(user.hwids || [])]);
        if (bannedHwid) {
            return res.status(403).json({
                success: false,
                banned: true,
                message: PHOENIX_BAN_MESSAGE,
            });
        }

        const bannedIp = await findBannedIp([clientIp, user.lastLauncherIp, ...(user.launcherIps || [])]);
        if (bannedIp) {
            return res.status(403).json({
                success: false,
                banned: true,
                ipBanned: true,
                message: PHOENIX_IP_BAN_MESSAGE,
            });
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            await suspiciousActivity.recordFailedLogin({ ip: clientIp, email, hwid });
            return res.status(401).json({
                success: false,
                invalidCredentials: true,
                message: "Incorrect email or password.",
            });
        }

        if (hwid && user.launcherHwid && user.launcherHwid !== hwid) {
            await suspiciousActivity.recordHwidChange({
                accountId: user.accountId,
                username: user.username,
                oldHwid: user.launcherHwid,
                newHwid: hwid,
                ip: clientIp,
            });
        }

        if (hwid) await recordLauncherHwid(user.accountId, hwid);
        if (clientIp) await recordLauncherIp(user.accountId, clientIp);

        const accessToken = await createLauncherSession(user, clientIp || req.ip);
        const skin = await getPlayerSkinInfo(user.accountId);
        const discordAvatarUrl = await resolveDiscordAvatarUrl(user);

        await analytics.track("launcher_login", {
            accountId: user.accountId,
            username: user.username,
            metadata: { ip: clientIp },
        });

        return res.json({
            success: true,
            username: user.username,
            accountId: user.accountId,
            accessToken: `eg1~${accessToken}`,
            skinName: skin.skinName,
            skinIconUrl: skin.skinIconUrl,
            skinTemplateId: skin.skinTemplateId,
            discordAvatarUrl,
            anticheat: {
                reportUrl:     `${config.anticheat?.backendHost || `http://45.92.217.130:${config.port}`}/phoenix/api/anticheat/report`,
                heartbeatUrl:  `${config.anticheat?.backendHost || `http://45.92.217.130:${config.port}`}/phoenix/api/anticheat/heartbeat`,
                heartbeatInterval: 30,
            },
        });
    } catch (err) {
        log.error(`Launcher login error: ${err}`);
        return res.status(500).json({ success: false, message: "Login failed. Try again later." });
    }
});

app.post("/phoenix/api/launcher/register", registerLimiter, async (req, res) => {
    try {
        const email = String(req.body?.email || "").trim().toLowerCase();
        const password = String(req.body?.password || "");
        const username = String(req.body?.username || "").trim();
        const hwid = String(req.body?.hwid || "").trim();
        const discordId = String(req.body?.discordId || "").trim();

        if (!email || !password || !username) {
            return res.status(400).json({
                success: false,
                message: "Email, username, and password are required.",
            });
        }

        if (!hwid) {
            return res.status(400).json({
                success: false,
                message: "Could not verify this PC. Please restart the launcher and try again.",
            });
        }

        const googleId = String(req.body?.googleId || "").trim();
        if (!googleId && (!discordId || !/^\d{17,20}$/.test(discordId))) {
            return res.status(400).json({
                success: false,
                message: "Connect Discord or Google first, or use /create on Discord to get an account.",
            });
        }

        const clientIp = resolveClientIp(req);
        const bannedIpOnRegister = await findBannedIp(clientIp);
        if (bannedIpOnRegister) {
            return res.status(403).json({
                success: false,
                banned: true,
                ipBanned: true,
                message: PHOENIX_IP_BAN_MESSAGE,
            });
        }

        const bannedHwidOnRegister = await findBannedHwid(hwid);
        if (bannedHwidOnRegister) {
            return res.status(403).json({
                success: false,
                banned: true,
                message: PHOENIX_BAN_MESSAGE,
            });
        }

        const existingHwid = await User.findOne({ launcherHwid: hwid }).lean();
        if (existingHwid) {
            return res.status(403).json({
                success: false,
                hwidLocked: true,
                message: HWID_LOCK_MESSAGE,
            });
        }

        const existingEmail = await User.findOne({ email }).lean();
        if (existingEmail) {
            return res.status(409).json({
                success: false,
                alreadyRegistered: true,
                message: `The email "${email}" is already registered. Sign in with that email instead.`,
            });
        }

        const existingUsername = await User.findOne({ username_lower: username.toLowerCase() }).lean();
        if (existingUsername) {
            return res.status(409).json({
                success: false,
                alreadyRegistered: true,
                message: `The username "${username}" is already taken. Choose a different username or sign in.`,
            });
        }

        if (discordId && /^\d{17,20}$/.test(discordId)) {
            const existingDiscord = await User.findOne({
                $or: [{ discordId }, { discordId: String(discordId) }],
            }).lean();
            if (existingDiscord) {
                const loginEmail = existingDiscord.email || email;
                return res.status(409).json({
                    success: false,
                    alreadyRegistered: true,
                    message: `Your Discord already has a Pulse account (${existingDiscord.username}). Sign in with email: ${loginEmail}`,
                });
            }
        }

        if (googleId) {
            const existingGoogle = await User.findOne({ googleId }).lean();
            if (existingGoogle) {
                return res.status(409).json({
                    success: false,
                    alreadyRegistered: true,
                    message: `This Google account is already registered. Sign in with Google or email: ${existingGoogle.email}`,
                });
            }
        }

        const result = await functions.registerUser(
            discordId || null,
            username,
            email,
            password,
            hwid,
            googleId || null,
        );
        if (result.status !== 200) {
            return res.status(result.status || 400).json({
                success: false,
                hwidLocked: !!result.hwidLocked,
                message: result.message || "Registration failed.",
            });
        }

        const user = await User.findOne({ email }).lean();
        if (!user) {
            return res.status(500).json({ success: false, message: "Account was created but could not be loaded." });
        }

        if (discordId && /^\d{17,20}$/.test(discordId)) {
            const avatarHash = await fetchDiscordAvatarHash(discordId);
            if (avatarHash) {
                await User.updateOne({ accountId: user.accountId }, { discordAvatar: avatarHash });
            }
        }

        const dmSent = await sendLauncherRegistrationDm(discordId, username, email, password);

        if (clientIp) await recordLauncherIp(user.accountId, clientIp);

        const accessToken = await createLauncherSession(user, clientIp || req.ip);
        const skin = await getPlayerSkinInfo(user.accountId);
        const freshUser = await User.findOne({ accountId: user.accountId }).lean();
        const discordAvatarUrl = freshUser ? await resolveDiscordAvatarUrl(freshUser) : null;

        return res.json({
            success: true,
            username: user.username,
            accountId: user.accountId,
            accessToken: `eg1~${accessToken}`,
            skinName: skin.skinName,
            skinIconUrl: skin.skinIconUrl,
            skinTemplateId: skin.skinTemplateId,
            discordAvatarUrl,
            dmSent,
            message: dmSent
                ? "Account created! Check your Discord DMs for your login details."
                : "Account created! We could not DM you — enable DMs from server members and contact support if needed.",
            anticheat: {
                reportUrl:     `${config.anticheat?.backendHost || `http://45.92.217.130:${config.port}`}/phoenix/api/anticheat/report`,
                heartbeatUrl:  `${config.anticheat?.backendHost || `http://45.92.217.130:${config.port}`}/phoenix/api/anticheat/heartbeat`,
                heartbeatInterval: 30,
            },
        });
    } catch (err) {
        log.error(`Launcher register error: ${err}`);
        return res.status(500).json({ success: false, message: "Registration failed. Try again later." });
    }
});

function readLauncherHomeConfig() {
    try {
        const filePath = path.join(__dirname, "..", "Config", "launcher_home.json");
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return { upcomingFeatures: [] };
    }
}

function fetchXmppPlayerCount() {
    const statusUrl = String(config?.launcher?.xmppStatusUrl || "http://127.0.0.1/").trim();
    if (!statusUrl) return Promise.resolve({ playersOnline: 0, playerNames: [] });

    return new Promise((resolve) => {
        try {
            const parsed = new URL(statusUrl);
            const lib = parsed.protocol === "https:" ? https : http;
            const req = lib.get(statusUrl, { timeout: 4000 }, (res) => {
                let body = "";
                res.on("data", (chunk) => { body += chunk; });
                res.on("end", () => {
                    try {
                        const data = JSON.parse(body);
                        const amount = data?.Clients?.amount ?? 0;
                        const names = Array.isArray(data?.Clients?.clients) ? data.Clients.clients : [];
                        resolve({
                            playersOnline: Number(amount) || 0,
                            playerNames: names.map((n) => String(n || "").trim()).filter(Boolean),
                        });
                    } catch {
                        resolve({ playersOnline: 0, playerNames: [] });
                    }
                });
            });
            req.on("error", () => resolve({ playersOnline: 0, playerNames: [] }));
            req.on("timeout", () => {
                req.destroy();
                resolve({ playersOnline: 0, playerNames: [] });
            });
        } catch {
            resolve({ playersOnline: 0, playerNames: [] });
        }
    });
}

app.get("/phoenix/api/launcher/servers", async (req, res) => {
    try {
        const data = gameServerRegistry.listPublicSessions();
        return res.json({
            success: true,
            serversOnline: data.serversOnline,
            totalPlayers: data.totalPlayers,
            sessions: data.sessions,
        });
    } catch (err) {
        log.error(`Launcher servers error: ${err}`);
        return res.status(500).json({
            success: false,
            serversOnline: 0,
            totalPlayers: 0,
            sessions: [],
        });
    }
});

app.get("/phoenix/api/launcher/status", async (req, res) => {
    try {
        const payload = await redisCache.getOrSet("launcher:status", 30, async () => {
            const home = readLauncherHomeConfig();
            const { playersOnline, playerNames } = await fetchXmppPlayerCount();
            const launcherCfg = config?.launcher || {};

            return {
                online: true,
                playersOnline,
                playerCount: playersOnline,
                playerNames,
                season: launcherCfg.seasonLabel || "Chapter 3 • Season 1",
                brandName: launcherCfg.brandName || "Phoenix",
                maintenance: false,
                message: playersOnline > 0
                    ? `${playersOnline} player(s) online right now.`
                    : "No players online — be the first to launch!",
                upcomingFeatures: home.upcomingFeatures || [],
                liveFeatures: home.liveFeatures || [],
                features: {
                    shopPurchase: true,
                    partyLobby: true,
                    globalChat: launcherChat.isEnabled(),
                    autoUpdate: !!(launcherCfg.githubOwner && launcherCfg.githubRepo),
                    news: true,
                },
                launcher: {
                    githubOwner: launcherCfg.githubOwner || "",
                    githubRepo: launcherCfg.githubRepo || "",
                    updateAssetName: launcherCfg.updateAssetName || "setup.exe",
                    launcherVersion: launcherCfg.launcherVersion || "1.0.0",
                },
            };
        });

        return res.json(payload);
    } catch (err) {
        log.error(`Launcher status error: ${err}`);
        return res.status(500).json({
            online: false,
            playersOnline: 0,
            playerNames: [],
            maintenance: false,
            message: "Could not reach backend.",
            upcomingFeatures: [],
        });
    }
});

app.get("/phoenix/api/launcher/check", async (req, res) => {
    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ exists: false });

    const clientIp = resolveClientIp(req);
    const user = await User.findOne({ email }).lean();

    if (!user) {
        return res.json({ exists: false, banned: false, ipBanned: false });
    }

    const accountBanned = isUserBanned(user);
    const bannedIp = await findBannedIp([clientIp, user.lastLauncherIp, ...(user.launcherIps || [])]);

    return res.json({
        exists: true,
        banned: accountBanned || !!bannedIp,
        ipBanned: !!bannedIp,
        message: bannedIp ? PHOENIX_IP_BAN_MESSAGE : accountBanned ? PHOENIX_BAN_MESSAGE : null,
    });
});

async function buildEntry(user, row, stat, standing, search) {
    const solo = stat?.solo || {};
    const skin = await getPlayerSkinInfo(user.accountId);
    const wins = solo.placetop1 ?? 0;
    const kills = solo.kills ?? 0;

    const entry = {
        username: user.username,
        displayName: user.username,
        accountId: user.accountId,
        hypeArenaPoints: row?.points ?? standing?.points ?? 0,
        points: row?.points ?? standing?.points ?? 0,
        kills,
        wins,
        kd: wins > 0 ? Number((kills / wins).toFixed(2)) : kills,
        level: (row?.division ?? standing?.division ?? 0) + 1,
        skinTemplateId: skin.skinTemplateId,
        skinName: skin.skinName,
        skinIconUrl: skin.skinIconUrl,
        discordAvatarUrl: await resolveDiscordAvatarUrl(user),
    };

    if (search && !entry.displayName.toLowerCase().includes(search)) return null;
    return entry;
}

const DISCORD_API_URL = "https://discord.com/api";

async function fetchDiscordAvatarHash(discordId) {
    const token = String(config?.discord?.bot_token || "").trim();
    if (!token || !discordId) return null;

    try {
        const res = await axios.get(`${DISCORD_API_URL}/v10/users/${discordId}`, {
            headers: { Authorization: `Bot ${token}` },
            timeout: 8000,
        });
        return res.data?.avatar || null;
    } catch (err) {
        log.debug(`Discord avatar fetch failed for ${discordId}: ${err.message}`);
        return null;
    }
}

async function resolveDiscordAvatarUrl(user) {
    if (!user?.discordId) return null;

    let hash = user.discordAvatar;
    if (!hash) {
        hash = await fetchDiscordAvatarHash(user.discordId);
        if (hash && user.accountId) {
            await User.updateOne({ accountId: user.accountId }, { discordAvatar: hash });
        }
    }

    if (hash) {
        return `https://cdn.discordapp.com/avatars/${user.discordId}/${hash}.png?size=128`;
    }

    try {
        const index = Number((BigInt(user.discordId) >> 22n) % 6n);
        return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
    } catch {
        return null;
    }
}

function formatCosmeticName(templateId) {
    const slug = templateIdToImageSlug(templateId);
    if (!slug) return "Cosmetic";
    return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function templateIdToShopType(templateId) {
    const t = String(templateId || "").toLowerCase();
    if (t.startsWith("athenacharacter:")) return "skin";
    if (t.startsWith("athenapickaxe:")) return "pickaxe";
    if (t.startsWith("athenaglider:")) return "glider";
    if (t.startsWith("athenadance:") || t.startsWith("athenaemoji:")) return "emote";
    if (t.startsWith("athenaitemwrap:")) return "wrap";
    return "other";
}

function iconUrlFromTemplate(templateId) {
    const slug = templateIdToImageSlug(templateId);
    return slug ? `https://fortnite-api.com/images/cosmetics/br/${slug}/icon.png` : null;
}

function rarityFromPrice(price) {
    if (price >= 2000) return "legendary";
    if (price >= 1500) return "epic";
    if (price >= 1200) return "rare";
    if (price >= 800) return "uncommon";
    return "common";
}

async function buildShopItems() {
    const catalog = functions.getItemShop();
    const rawItems = [];

    for (const storefront of catalog.storefronts || []) {
        for (const entry of storefront.catalogEntries || []) {
            const grant = entry.itemGrants?.[0];
            const templateId =
                typeof grant === "string" ? grant : grant?.templateId;
            if (!templateId) continue;

            const cosmeticRef = String(templateId).toLowerCase();
            if (cosmeticRef.includes("cardpack")) continue;

            const price = entry.prices?.[0]?.finalPrice ?? 0;
            const section =
                entry.meta?.SectionId ||
                entry.metaInfo?.find((m) => m.key === "SectionId")?.value ||
                "Daily";

            rawItems.push({
                offerId: entry.offerId || entry.devName,
                templateId,
                price,
                section,
            });
        }
    }

    const meta = await fetchCosmeticsBatch(rawItems.map((item) => item.templateId));

    return rawItems
        .map((item) => {
            const slug = templateIdToImageSlug(item.templateId);
            const info = slug ? meta.get(slug) : null;
            const name = info?.name || formatCosmeticName(item.templateId);
            const iconUrl = info?.iconUrl || iconUrlFromTemplate(item.templateId);

            return {
                offerId: item.offerId,
                name,
                type: templateIdToShopType(item.templateId),
                price: item.price,
                rarity: info?.rarity || rarityFromPrice(item.price),
                iconUrl,
                templateId: item.templateId,
                section: item.section,
                isNew: item.section === "Bundles",
            };
        })
        .filter((item) => item.iconUrl && item.name && !looksLikeCosmeticId(item.name));
}

async function launcherShopItemsHandler(_req, res) {
    try {
        const items = await redisCache.getOrSet("launcher:shop:items", 300, buildShopItems);
        return res.json({ success: true, items });
    } catch (err) {
        log.error(`Launcher shop items error: ${err}`);
        return res.status(500).json({ success: false, items: [] });
    }
}

app.get("/phoenix/api/launcher/shop/items", launcherShopItemsHandler);
app.get("/iris/api/launcher/shop/items", launcherShopItemsHandler);

async function launcherLeaderboardHandler(req, res) {
    try {
        const sort = String(req.query.sort || "points").toLowerCase();
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 150);
        const search = req.query.search ? String(req.query.search).toLowerCase().trim() : "";
        const cacheKey = `launcher:leaderboard:${sort}:${limit}:${search}`;

        const payload = await redisCache.getOrSet(cacheKey, 120, async () => {
        const arenaEventId = functions.getConfiguredArenaEventId();

        const standings = await TournamentStanding.find({ eventId: arenaEventId })
            .sort({ points: -1 })
            .limit(limit * 3)
            .lean();

        const entries = [];
        const seen = new Set();

        for (const row of standings) {
            const user = await User.findOne({ accountId: row.accountId }).lean();
            if (!user || user.isServer) continue;

            const stat = await UserStats.findOne({ accountId: row.accountId }).lean();
            const entry = await buildEntry(user, row, stat, null, search);
            if (!entry) continue;

            entries.push(entry);
            seen.add(row.accountId);
        }

        if (sort === "kills" || sort === "wins") {
            const stats = await UserStats.find({}).lean();
            for (const stat of stats) {
                if (seen.has(stat.accountId)) continue;

                const user = await User.findOne({ accountId: stat.accountId }).lean();
                if (!user || user.isServer) continue;

                const solo = stat.solo || {};
                const kills = solo.kills ?? 0;
                const wins = solo.placetop1 ?? 0;

                if (sort === "kills" && kills <= 0) continue;
                if (sort === "wins" && wins <= 0) continue;

                const standing = await TournamentStanding.findOne({
                    accountId: stat.accountId,
                    eventId: arenaEventId,
                }).lean();

                const entry = await buildEntry(user, null, stat, standing, search);
                if (!entry) continue;

                entries.push(entry);
                seen.add(stat.accountId);
            }
        }

        entries.sort((a, b) => {
            if (sort === "kills") return b.kills - a.kills || b.hypeArenaPoints - a.hypeArenaPoints;
            if (sort === "wins") return b.wins - a.wins || b.hypeArenaPoints - a.hypeArenaPoints;
            return b.hypeArenaPoints - a.hypeArenaPoints || b.kills - a.kills;
        });

        return {
            entries: entries.slice(0, limit).map((entry, index) => ({
                ...entry,
                rank: index + 1,
            })),
            nextUpdateSeconds: REFRESH_SECONDS,
        };
        });

        res.json(payload);
    } catch (err) {
        log.error(`Launcher leaderboard error: ${err}`);
        res.status(500).json({ error: "Failed to load leaderboard" });
    }
}

app.get("/phoenix/api/launcher/leaderboard", launcherLeaderboardHandler);
app.get("/iris/api/launcher/leaderboard", launcherLeaderboardHandler);

app.get("/phoenix/api/launcher/profile/skin", verifyToken, async (req, res) => {
    try {
        const skin = await getPlayerSkinInfo(req.user.accountId);
        const userDoc = await User.findOne({ accountId: req.user.accountId }).lean();
        const discordAvatarUrl = userDoc ? await resolveDiscordAvatarUrl(userDoc) : null;
        return res.json({
            success: true,
            displayName: req.user.username,
            accountId: req.user.accountId,
            discordAvatarUrl,
            ...skin,
        });
    } catch (err) {
        log.error(`Launcher skin error: ${err}`);
        return res.status(500).json({ success: false, message: "Could not load equipped skin." });
    }
});

app.get("/phoenix/api/launcher/shop/balance", verifyToken, async (req, res) => {
    try {
        const balance = await getVbucksBalance(req.user.accountId);
        return res.json({ success: true, balance });
    } catch (err) {
        log.error(`Launcher balance error: ${err}`);
        return res.status(500).json({ success: false, message: "Could not load balance." });
    }
});

app.post("/phoenix/api/launcher/shop/purchase", verifyToken, purchaseLimiter, async (req, res) => {
    try {
        const offerId = String(req.body?.offerId || "").trim();
        if (!offerId) return res.status(400).json({ success: false, message: "offerId is required." });

        const result = await purchaseOffer(req.user.accountId, offerId);
        if (result.success) {
            await analytics.track("shop_purchase", {
                accountId: req.user.accountId,
                username: req.user.username,
                metadata: {
                    offerId,
                    templateId: result.templateId,
                    itemName: result.itemName,
                    price: result.price,
                },
            });
            await webhooks.notifyPurchase({
                username: req.user.username,
                itemName: result.items?.[0] || result.itemName || offerId,
                price: result.price ?? 0,
                offerId,
            });
            await redisCache.del(`launcher:profile:${req.user.accountId}`);
        }
        const status = result.success ? 200 : 400;
        return res.status(status).json(result);
    } catch (err) {
        log.error(`Launcher purchase error: ${err}`);
        return res.status(500).json({ success: false, message: "Purchase failed." });
    }
});

app.get("/phoenix/api/launcher/party", verifyToken, async (req, res) => {
    return res.json(launcherParty.getParty(req.user.accountId));
});

app.post("/phoenix/api/launcher/party/create", verifyToken, async (req, res) => {
    const result = await launcherParty.createParty(req.user.accountId, req.user.username);
    return res.json(result);
});

app.post("/phoenix/api/launcher/party/invite", verifyToken, async (req, res) => {
    const username = String(req.body?.username || "").trim();
    if (!username) return res.status(400).json({ success: false, message: "username is required." });
    const result = await launcherParty.inviteToParty(req.user.accountId, username);
    const status = result.success ? 200 : 400;
    return res.status(status).json(result);
});

app.post("/phoenix/api/launcher/party/ready", verifyToken, async (req, res) => {
    const ready = !!req.body?.ready;
    return res.json(launcherParty.setReady(req.user.accountId, ready));
});

app.post("/phoenix/api/launcher/party/leave", verifyToken, async (req, res) => {
    return res.json(launcherParty.leaveParty(req.user.accountId));
});

app.get("/phoenix/api/launcher/chat/messages", verifyToken, async (req, res) => {
    const since = parseInt(req.query.since, 10) || 0;
    return res.json({
        enabled: launcherChat.isEnabled(),
        messages: launcherChat.listMessages(since),
    });
});

app.post("/phoenix/api/launcher/chat/send", verifyToken, async (req, res) => {
    const text = String(req.body?.message || req.body?.text || "").trim();
    const result = launcherChat.sendMessage(req.user.accountId, req.user.username, text);
    const status = result.success ? 200 : 400;
    return res.status(status).json(result);
});

app.get("/phoenix/api/launcher/discord/avatar", async (req, res) => {
    try {
        const discordId = String(req.query.discordId || "").trim();
        if (!discordId || !/^\d{17,20}$/.test(discordId)) {
            return res.status(400).json({ avatarUrl: null });
        }

        const user = await User.findOne({
            $or: [{ discordId }, { discordId: String(discordId) }],
        }).lean();

        const avatarUrl = user
            ? await resolveDiscordAvatarUrl(user)
            : await resolveDiscordAvatarUrl({ discordId });

        return res.json({ avatarUrl });
    } catch (err) {
        log.error(`Launcher discord avatar error: ${err}`);
        return res.status(500).json({ avatarUrl: null });
    }
});

function getDiscordOAuthConfig() {
    const website = config?.Website || {};
    const redirectUri = String(website.redirectUri || "")
        .replace("${websiteport}", String(website.websiteport || 8080));
    return {
        clientId: String(website.clientId || "").trim(),
        redirectUri,
        enabled: !!(website.clientId && website.clientId !== "your-client-id-here" && website.clientSecret),
    };
}

app.get("/phoenix/api/launcher/discord/config", (req, res) => {
    const oauth = getDiscordOAuthConfig();
    return res.json({
        enabled: oauth.enabled,
        clientId: oauth.clientId,
        authorizeUrl: oauth.enabled
            ? `${DISCORD_API_URL}/oauth2/authorize?client_id=${oauth.clientId}&redirect_uri=${encodeURIComponent(oauth.redirectUri)}&response_type=code&scope=identify`
            : null,
        redirectUri: oauth.redirectUri,
    });
});

app.get("/phoenix/api/launcher/discord/check", async (req, res) => {
    try {
        const discordId = String(req.query.discordId || "").trim();
        if (!discordId || !/^\d{17,20}$/.test(discordId)) {
            return res.status(400).json({ exists: false, message: "Invalid Discord ID." });
        }

        const user = await User.findOne({
            $or: [{ discordId }, { discordId: String(discordId) }],
        }).lean();

        if (!user) {
            return res.json({ exists: false, banned: false });
        }

        const accountBanned = isUserBanned(user);
        return res.json({
            exists: true,
            banned: accountBanned,
            username: user.username,
            email: user.email,
            accountId: user.accountId,
            message: accountBanned ? PHOENIX_BAN_MESSAGE : null,
        });
    } catch (err) {
        log.error(`Launcher discord check error: ${err}`);
        return res.status(500).json({ exists: false, message: "Check failed." });
    }
});

app.post("/phoenix/api/launcher/discord/exchange", async (req, res) => {
    try {
        const code = String(req.body?.code || "").trim();
        const redirectUri = String(req.body?.redirectUri || "").trim();
        const oauth = getDiscordOAuthConfig();

        if (!oauth.enabled) {
            return res.status(503).json({
                success: false,
                message: "Discord OAuth is not configured. Set Website.clientId and clientSecret in config.json.",
            });
        }

        if (!code) {
            return res.status(400).json({ success: false, message: "OAuth code is required." });
        }

        const tokenResponse = await axios.post(
            `${DISCORD_API_URL}/oauth2/token`,
            new URLSearchParams({
                client_id: oauth.clientId,
                client_secret: String(config.Website.clientSecret || "").trim(),
                grant_type: "authorization_code",
                code,
                redirect_uri: redirectUri || oauth.redirectUri,
            }),
        );

        const accessToken = tokenResponse.data.access_token;
        const userResponse = await axios.get(`${DISCORD_API_URL}/users/@me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        const discordUser = userResponse.data;
        const discordId = String(discordUser.id);
        const existing = await User.findOne({
            $or: [{ discordId }, { discordId: String(discordId) }],
        }).lean();

        const avatarUrl = discordUser.avatar
            ? `https://cdn.discordapp.com/avatars/${discordId}/${discordUser.avatar}.png?size=128`
            : `https://cdn.discordapp.com/embed/avatars/${Number(discordUser.discriminator || 0) % 5}.png`;

        return res.json({
            success: true,
            discord: {
                id: discordId,
                username: discordUser.username,
                globalName: discordUser.global_name || discordUser.username,
                avatarUrl,
            },
            accountExists: !!existing,
            account: existing
                ? {
                      username: existing.username,
                      email: existing.email,
                      banned: isUserBanned(existing),
                  }
                : null,
        });
    } catch (err) {
        log.error(`Launcher discord exchange error: ${err?.response?.data || err}`);
        return res.status(400).json({
            success: false,
            message: "Discord authentication failed. Try again.",
        });
    }
});

app.get("/phoenix/api/launcher/google/config", (req, res) => {
    const oauth = getGoogleOAuthConfig(config);
    const redirectUri =
        String(req.query.redirectUri || "").trim() || oauth.redirectUriLauncher;
    return res.json({
        enabled: oauth.enabled,
        clientId: oauth.clientId,
        redirectUriLauncher: oauth.redirectUriLauncher,
        redirectUriWebsite: oauth.redirectUriWebsite,
        authorizeUrl: oauth.enabled
            ? buildGoogleAuthorizeUrl(oauth.clientId, redirectUri)
            : null,
    });
});

app.post("/phoenix/api/launcher/google/exchange", async (req, res) => {
    try {
        const code = String(req.body?.code || "").trim();
        const redirectUri = String(req.body?.redirectUri || "").trim();
        const hwid = String(req.body?.hwid || "").trim();
        const oauth = getGoogleOAuthConfig(config);

        if (!oauth.enabled) {
            return res.status(503).json({
                success: false,
                message: "Google OAuth is not configured. Set google.clientId and clientSecret in config.json.",
            });
        }

        if (!code) {
            return res.status(400).json({ success: false, message: "OAuth code is required." });
        }

        const googleProfile = await exchangeGoogleCode(
            code,
            redirectUri || oauth.redirectUriLauncher,
            config,
        );

        const existing = await User.findOne({
            $or: [{ googleId: googleProfile.id }, { email: googleProfile.email }],
        }).lean();

        if (existing) {
            if (isUserBanned(existing)) {
                return res.status(403).json({
                    success: false,
                    banned: true,
                    message: PHOENIX_BAN_MESSAGE,
                });
            }

            const clientIp = resolveClientIp(req);
            const bannedHwid = await findBannedHwid([hwid, existing.launcherHwid, ...(existing.hwids || [])]);
            if (bannedHwid) {
                return res.status(403).json({ success: false, banned: true, message: PHOENIX_BAN_MESSAGE });
            }

            const bannedIp = await findBannedIp([clientIp, existing.lastLauncherIp, ...(existing.launcherIps || [])]);
            if (bannedIp) {
                return res.status(403).json({
                    success: false,
                    banned: true,
                    ipBanned: true,
                    message: PHOENIX_IP_BAN_MESSAGE,
                });
            }

            if (!existing.googleId) {
                await User.updateOne({ accountId: existing.accountId }, { $set: { googleId: googleProfile.id } });
            }

            if (hwid) await recordLauncherHwid(existing.accountId, hwid);
            if (clientIp) await recordLauncherIp(existing.accountId, clientIp);

            const accessToken = await createLauncherSession(existing, clientIp || req.ip);
            const skin = await getPlayerSkinInfo(existing.accountId);

            return res.json({
                success: true,
                accountExists: true,
                google: {
                    id: googleProfile.id,
                    email: googleProfile.email,
                    name: googleProfile.name,
                    picture: googleProfile.picture,
                },
                account: {
                    username: existing.username,
                    email: existing.email,
                    banned: false,
                },
                username: existing.username,
                accountId: existing.accountId,
                accessToken: `eg1~${accessToken}`,
                skinName: skin.skinName,
                skinIconUrl: skin.skinIconUrl,
                skinTemplateId: skin.skinTemplateId,
            });
        }

        return res.json({
            success: true,
            accountExists: false,
            google: {
                id: googleProfile.id,
                email: googleProfile.email,
                name: googleProfile.name,
                picture: googleProfile.picture,
            },
        });
    } catch (err) {
        log.error(`Launcher google exchange error: ${err?.response?.data || err}`);
        return res.status(400).json({
            success: false,
            message: "Google authentication failed. Try again.",
        });
    }
});

app.post("/phoenix/api/launcher/google/register", async (req, res) => {
    try {
        const googleId = String(req.body?.googleId || "").trim();
        const email = String(req.body?.email || "").trim().toLowerCase();
        const username = String(req.body?.username || "").trim();
        const hwid = String(req.body?.hwid || "").trim();
        const discordId = String(req.body?.discordId || "").trim();

        if (!googleId || !email || !username) {
            return res.status(400).json({
                success: false,
                message: "Google ID, email, and username are required.",
            });
        }

        if (!hwid) {
            return res.status(400).json({
                success: false,
                message: "Could not verify this PC. Please restart the launcher and try again.",
            });
        }

        const clientIp = resolveClientIp(req);
        const bannedIpOnRegister = await findBannedIp(clientIp);
        if (bannedIpOnRegister) {
            return res.status(403).json({
                success: false,
                banned: true,
                ipBanned: true,
                message: PHOENIX_IP_BAN_MESSAGE,
            });
        }

        const bannedHwidOnRegister = await findBannedHwid(hwid);
        if (bannedHwidOnRegister) {
            return res.status(403).json({
                success: false,
                banned: true,
                message: PHOENIX_BAN_MESSAGE,
            });
        }

        const existingHwid = await User.findOne({ launcherHwid: hwid }).lean();
        if (existingHwid) {
            return res.status(403).json({
                success: false,
                hwidLocked: true,
                message: HWID_LOCK_MESSAGE,
            });
        }

        const existingGoogle = await User.findOne({ googleId }).lean();
        if (existingGoogle) {
            return res.status(409).json({
                success: false,
                alreadyRegistered: true,
                message: "This Google account is already registered. Sign in instead.",
            });
        }

        const existingEmail = await User.findOne({ email }).lean();
        if (existingEmail) {
            return res.status(409).json({
                success: false,
                alreadyRegistered: true,
                message: `The email "${email}" is already registered. Sign in with email and password.`,
            });
        }

        const randomPassword = crypto.randomBytes(16).toString("hex");
        const result = await functions.registerUser(
            discordId && /^\d{17,20}$/.test(discordId) ? discordId : null,
            username,
            email,
            randomPassword,
            hwid,
            googleId,
        );

        if (result.status !== 200) {
            return res.status(result.status || 400).json({
                success: false,
                message: result.message || "Registration failed.",
            });
        }

        const user = await User.findOne({ email }).lean();
        if (!user) {
            return res.status(500).json({ success: false, message: "Account was created but could not be loaded." });
        }

        if (clientIp) await recordLauncherIp(user.accountId, clientIp);

        const accessToken = await createLauncherSession(user, clientIp || req.ip);
        const skin = await getPlayerSkinInfo(user.accountId);

        return res.json({
            success: true,
            username: user.username,
            accountId: user.accountId,
            email: user.email,
            accessToken: `eg1~${accessToken}`,
            skinName: skin.skinName,
            skinIconUrl: skin.skinIconUrl,
            skinTemplateId: skin.skinTemplateId,
            message: "Account created with Google. Use Google sign-in or your email with the password from Discord /create.",
        });
    } catch (err) {
        log.error(`Launcher google register error: ${err}`);
        return res.status(500).json({ success: false, message: "Google registration failed." });
    }
});

app.get("/phoenix/api/launcher/update", async (req, res) => {
    const owner = String(config?.launcher?.githubOwner || "").trim();
    const repo = String(config?.launcher?.githubRepo || "").trim();
    const assetName = String(config?.launcher?.updateAssetName || "setup.exe").trim();
    const currentVersion = String(config?.launcher?.launcherVersion || "1.0.0").trim();

    if (!owner || !repo) {
        return res.json({
            updateAvailable: false,
            currentVersion,
            message: "Set launcher.githubOwner and launcher.githubRepo in config.json",
        });
    }

    try {
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
        const release = await new Promise((resolve, reject) => {
            const req = https.get(
                apiUrl,
                { timeout: 8000, headers: { "User-Agent": "Phoenix-Launcher" } },
                (res) => {
                    let body = "";
                    res.on("data", (c) => { body += c; });
                    res.on("end", () => {
                        if (res.statusCode < 200 || res.statusCode >= 300) {
                            return reject(new Error(`GitHub HTTP ${res.statusCode}`));
                        }
                        try {
                            resolve(JSON.parse(body));
                        } catch (e) {
                            reject(e);
                        }
                    });
                },
            );
            req.on("error", reject);
            req.on("timeout", () => {
                req.destroy();
                reject(new Error("timeout"));
            });
        });

        const tag = String(release.tag_name || "").replace(/^v/i, "");
        const asset = (release.assets || []).find((a) =>
            String(a.name || "").toLowerCase() === assetName.toLowerCase(),
        );

        const updateAvailable = tag && tag !== currentVersion && !!asset;

        return res.json({
            updateAvailable,
            currentVersion,
            latestVersion: tag || currentVersion,
            downloadUrl: asset?.browser_download_url || null,
            releaseNotes: String(release.body || "").slice(0, 500),
            publishedAt: release.published_at || null,
        });
    } catch (err) {
        log.error(`Launcher update check error: ${err}`);
        return res.json({ updateAvailable: false, currentVersion, message: "Update check failed." });
    }
});

module.exports = app;
