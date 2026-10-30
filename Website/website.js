module.exports = function(websiteApp) {
    const express = require("express");
    const path = require("path");
    const config = require("../Config/config.json");
    const User = require("../model/user.js");
    const UserStats = require("../model/userstats.js");
    const log = require("../structs/log.js");
    const { getGoogleOAuthConfig } = require("../structs/oauthGoogle.js");

    const DISCORD_API_URL = "https://discord.com/api";
    const CLIENT_ID = config.Website.clientId;
    const CLIENT_SECRET = config.Website.clientSecret;
    const REDIRECT_URI = config.Website.redirectUri.replace(
        "${websiteport}",
        config.Website.websiteport,
    );
    const googleOAuth = getGoogleOAuthConfig(config);
    const apiBase =
        config.launcher?.backendUrl || `http://45.92.217.130:${config.port || 3551}`;

    websiteApp.use(express.json());
    websiteApp.use(express.urlencoded({ extended: true }));

    websiteApp.use("/Images", express.static(path.join(__dirname, "./Data/Images")));
    websiteApp.use("/css", express.static(path.join(__dirname, "./Data/css")));
    websiteApp.use("/html", express.static(path.join(__dirname, "./Data/html")));
    websiteApp.use("/js", express.static(path.join(__dirname, "./Data/js")));

    websiteApp.get("/api/website/config", (req, res) => {
        res.json({
            apiBase,
            discordClientId: CLIENT_ID,
            discordRedirectUri: REDIRECT_URI,
            googleClientId: googleOAuth.clientId,
            googleRedirectUri: googleOAuth.redirectUriWebsite,
            googleEnabled: googleOAuth.enabled,
        });
    });

    websiteApp.get("/", (req, res) => {
        res.redirect("/home");
    });

    websiteApp.get("/portal", (req, res) => {
        res.sendFile(path.join(__dirname, "./Data/html/portal.html"));
    });

    websiteApp.get("/login", (req, res) => {
        const authURL = `${DISCORD_API_URL}/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
        res.redirect(authURL);
    });

    const oauthCallback = require("./Data/js/oauthCallback")(
        DISCORD_API_URL,
        CLIENT_ID,
        CLIENT_SECRET,
        REDIRECT_URI,
    );
    websiteApp.get("/oauth2/callback", oauthCallback);

    websiteApp.get(
        "/oauth2/google/callback",
        require("./Data/js/googleCallback.js")(),
    );

    websiteApp.post("/register-user", require("./Data/js/registerUser.js"));

    websiteApp.get("/register", (req, res) => {
        res.sendFile(path.join(__dirname, "./Data/html/register.html"));
    });

    websiteApp.get("/account-exists", (req, res) => {
        res.sendFile(path.join(__dirname, "./Data/html/accountExists.html"));
    });

    websiteApp.get("/leaderboard", (req, res) => {
        res.sendFile(path.join(__dirname, "./Data/html/leaderboard.html"));
    });

    websiteApp.get("/api/website/leaderboard", async (req, res) => {
        try {
            const playlist = req.query.playlist || "solo";
            const typeStat = req.query.type || "placetop1";
            const region = req.query.region || "Global";
            const limit = parseInt(req.query.limit) || 50;
            const search = req.query.search ? req.query.search.toLowerCase() : null;

            const allUsers = await User.find({ isServer: false });
            const leaderboardEntries = [];

            for (const user of allUsers) {
                const stat = await UserStats.findOne({ accountId: user.accountId });

                const playlistStats = stat ? stat[playlist] : null;
                const value = playlistStats ? playlistStats[typeStat] || 0 : 0;

                if (region !== "Global" && region !== "NA" && region !== "EU" && region !== "ASIA") {
                }

                leaderboardEntries.push({
                    rank: 0,
                    accountId: user.accountId,
                    username: user.username,
                    value: value,
                    kills: playlistStats ? playlistStats.kills || 0 : 0,
                    wins: playlistStats ? playlistStats.placetop1 || 0 : 0,
                    matches: playlistStats ? playlistStats.matchesplayed || 0 : 0,
                });
            }

            leaderboardEntries.sort((a, b) => b.value - a.value);

            leaderboardEntries.forEach((entry, index) => {
                entry.rank = index + 1;
            });

            if (search) {
                const searchResult = leaderboardEntries.find((e) =>
                    e.username.toLowerCase().includes(search),
                );
                return res.json(searchResult ? [searchResult] : []);
            }

            res.json(leaderboardEntries.slice(0, limit));
        } catch (err) {
            log.error("Website Leaderboard API Error:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    /* ── Crystal Website Pages ── */
    websiteApp.get("/home", (req, res) => {
        res.sendFile(path.join(__dirname, "./Data/html/home.html"));
    });

    websiteApp.get("/itemshop", (req, res) => {
        res.sendFile(path.join(__dirname, "./Data/html/itemshop.html"));
    });

    /* ── Item Shop API proxy (fetches from game backend) ── */
    websiteApp.get("/api/website/itemshop", async (req, res) => {
        try {
            const axios = require("axios");
            const paths = [
                `${apiBase}/phoenix/api/launcher/shop/items`,
                `${apiBase}/iris/api/launcher/shop/items`,
                `${apiBase}/fortnite/api/storefront/v2/catalog`,
            ];

            for (const url of paths) {
                try {
                    const r = await axios.get(url, { timeout: 8000 });
                    const data = r.data;

                    // launcher shop format
                    if (data.items && data.items.length > 0) {
                        return res.json({ success: true, items: data.items });
                    }

                    // catalog format — parse storefronts
                    if (data.storefronts) {
                        const items = [];
                        for (const sf of data.storefronts || []) {
                            for (const entry of sf.catalogEntries || []) {
                                const grant = entry.itemGrants?.[0];
                                const templateId = typeof grant === "string" ? grant : grant?.templateId;
                                if (!templateId) continue;
                                if (templateId.toLowerCase().includes("cardpack")) continue;
                                const price = entry.prices?.[0]?.finalPrice ?? 0;
                                const slug = templateId.includes(":") ? templateId.split(":").pop() : templateId;
                                items.push({
                                    id: entry.offerId || templateId,
                                    name: slug.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
                                    price,
                                    rarity: price >= 2000 ? "legendary" : price >= 1500 ? "epic" : price >= 1200 ? "rare" : price >= 800 ? "uncommon" : "common",
                                    iconUrl: `https://fortnite-api.com/images/cosmetics/br/${slug.toLowerCase()}/icon.png`,
                                    templateId,
                                    isNew: false,
                                });
                            }
                        }
                        if (items.length > 0) return res.json({ success: true, items });
                    }
                } catch { /* try next */ }
            }

            return res.json({ success: false, items: [] });
        } catch (err) {
            log.error(`Website itemshop error: ${err?.message}`);
            return res.status(500).json({ success: false, items: [] });
        }
    });

    /* ── Server status ── */
    websiteApp.get("/api/website/status", async (req, res) => {
        try {
            const axios = require("axios");
            const r = await axios.get(`${apiBase}/phoenix/api/launcher/status`, { timeout: 5000 });
            return res.json(r.data);
        } catch {
            return res.json({ online: false, playersOnline: 0 });
        }
    });
};
