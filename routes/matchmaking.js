const express = require("express");
const app = express.Router();
const config = require("../Config/config.json");
const functions = require("../structs/functions.js");
const log = require("../structs/log.js");
const MMCode = require("../model/mmcodes.js");
const User = require("../model/user.js");
const { verifyToken } = require("../tokenManager/tokenVerify.js");
const qs = require("qs");
const error = require("../structs/error.js");
const jwt = require("jsonwebtoken");

let buildUniqueId = {};

// ─── Helper: parse "ip:port:playlist[:region]" entry ─────────────────────────
function parseGameServer(entry) {
    const p = entry.split(":");
    return {
        ip:       p[0],
        port:     p[1],
        playlist: (p[2] || "").toLowerCase(),
        region:   (p[3] || "").toUpperCase(),
    };
}

// Select best server: prefer playlist+region, fall back to playlist-only
function selectGameServer(servers, targetPlaylist, targetRegion) {
    const parsed = servers.map(parseGameServer);
    if (targetRegion) {
        const exact = parsed.find(s => s.playlist === targetPlaylist && s.region === targetRegion);
        if (exact) return exact;
    }
    const any = parsed.find(s => s.playlist === targetPlaylist && s.region === "")
             || parsed.find(s => s.playlist === targetPlaylist);
    return any || null;
}

// ─── Matchmaker ban enforcement ───────────────────────────────────────────────
async function enforceMatchmakerBan(req, res) {
    if (!req.user || !req.user.matchmakerBannedUntil) return false;

    const expiresAt = new Date(req.user.matchmakerBannedUntil);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
        await User.updateOne(
            { accountId: req.user.accountId },
            { $set: { matchmakerBannedUntil: null, matchmakerBanReason: null } }
        );
        return false;
    }

    const ms = expiresAt.getTime() - Date.now();
    const mins = Math.ceil(ms / 60000);
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const m = mins % 60;
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    parts.push(`${m}m`);

    const reason = req.user.matchmakerBanReason ? ` Reason: ${req.user.matchmakerBanReason}` : "";
    return error.createError(
        "errors.com.epicgames.matchmaking.account_banned",
        `You are matchmaker banned. Time remaining: ${parts.join(" ")}.${reason}`,
        [], 20017, "matchmaker_banned", 403, res
    );
}

// ─── findPlayer stub ──────────────────────────────────────────────────────────
app.get("/fortnite/api/matchmaking/session/findPlayer/*", (req, res) => {
    log.debug("GET /fortnite/api/matchmaking/session/findPlayer/* called");
    res.status(200).end();
});

// ─── Ticket endpoint ──────────────────────────────────────────────────────────
app.get("/fortnite/api/game/v2/matchmakingservice/ticket/player/*", verifyToken, async (req, res) => {
    log.debug("GET /fortnite/api/game/v2/matchmakingservice/ticket/player/* called");
    if (req.user.isServer) return res.status(403).end();
    if (!req.user.matchmakingId) return res.status(400).end();
    if (await enforceMatchmakerBan(req, res)) return;

    const playerCustomKey = qs.parse(req.url.split("?")[1], { ignoreQueryPrefix: true })["player.option.customKey"];
    const bucketId = qs.parse(req.url.split("?")[1], { ignoreQueryPrefix: true })["bucketId"];

    if (typeof bucketId !== "string" || bucketId.split(":").length !== 4) return res.status(400).end();
    if (typeof req.query.bucketId !== "string" || req.query.bucketId.split(":").length !== 4) return res.status(400).end();

    const bParts = bucketId.split(":");
    const rawPlaylist = bParts[3];
    // bucketId format: "buildId:unknown:REGION:playlist"
    const bucketRegion = (bParts[2] || "EU").toUpperCase();

    let playlist = rawPlaylist.toLowerCase();
    if (playlist === "2")  playlist = "playlist_defaultsolo";
    else if (playlist === "10") playlist = "playlist_defaultduo";
    else if (playlist === "9")  playlist = "playlist_defaultsquad";
    else if (/^arena_s17_division\d+_duos$/.test(playlist)) playlist = "playlist_showdownalt_duos";
    else if (/^arena_s17_division\d+$/.test(playlist))      playlist = "playlist_showdownalt_solo";
    else playlist = functions.PlaylistNames(rawPlaylist).toLowerCase();

    // Select the right game server for this playlist + region
    const selected = selectGameServer(config.gameServerIP, playlist, bucketRegion);
    if (!selected) {
        log.debug(`No server found for playlist=${playlist} region=${bucketRegion}`);
        return error.createError(
            "errors.com.epicgames.common.matchmaking.playlist.not_found",
            `No server found for playlist ${playlist}`, [], 1013, "invalid_playlist", 404, res
        );
    }

    const resolvedRegion = selected.region || bucketRegion || config.defaultGameServerRegion || "EU";

    await global.kv.set(`playerPlaylist:${req.user.accountId}`, playlist);
    await global.kv.set(`playerRegion:${req.user.accountId}`, resolvedRegion);

    if (typeof playerCustomKey === "string") {
        const codeDoc = await MMCode.findOne({ code_lower: playerCustomKey.toLowerCase() });
        if (!codeDoc) {
            return error.createError(
                "errors.com.epicgames.common.matchmaking.code.not_found",
                `The matchmaking code "${playerCustomKey}" was not found`, [], 1013, "invalid_code", 404, res
            );
        }
        await global.kv.set(`playerCustomKey:${req.user.accountId}`, JSON.stringify({
            ip: codeDoc.ip, port: codeDoc.port, playlist,
        }));
    }

    buildUniqueId[req.user.accountId] = req.query.bucketId.split(":")[0];

    // ── Rubidium ─────────────────────────────────────────────────────────────
    if (config.rubidium?.enabled) {
        const rubidiumJwt = jwt.sign({
            accountId: req.user.accountId,
            bucketId:  req.query.bucketId,
            bucketIds: req.query.bucketId,
            region:    resolvedRegion,
            playlist,
            partyMembers:   req.user.accountId,
            buildUniqueId:  buildUniqueId[req.user.accountId] || "19100000",
            serverAddress:  selected.ip,
            serverPort:     selected.port,
        }, config.rubidium.secretKey, { expiresIn: "1h" });

        log.debug(`Issuing Rubidium ticket for ${req.user.accountId} → ${config.rubidium.matchmakerUrl}`);
        return res.json({
            serviceUrl:  config.rubidium.matchmakerUrl,
            ticketType:  "mms-player",
            payload:     JSON.stringify({ accountId: req.user.accountId }),
            signature:   rubidiumJwt,
        });
    }

    // ── Built-in matchmaker — pick WebSocket per region ──────────────────────
    const mmId = String(req.user.matchmakingId);
    let rawMmUrl;
    if (resolvedRegion === "NAE" && config.matchmakerIPNAE)     rawMmUrl = config.matchmakerIPNAE;
    else if (resolvedRegion === "EU" && config.matchmakerIPEU)  rawMmUrl = config.matchmakerIPEU;
    else rawMmUrl = config.matchmakerIP;

    let serviceUrl = rawMmUrl;
    if (!/^wss?:\/\//i.test(serviceUrl)) serviceUrl = `ws://${serviceUrl}`;

    const sep = serviceUrl.includes("?") ? "&" : "?";
    const serviceUrlWithPayload = `${serviceUrl}${sep}payload=${encodeURIComponent(mmId)}`;

    log.debug(`Issuing matchmaker ticket for ${req.user.accountId} [region=${resolvedRegion}] → ${serviceUrlWithPayload}`);
    return res.json({
        serviceUrl:  serviceUrlWithPayload,
        ticketType:  "mms-player",
        payload:     mmId,
        signature:   "account",
    });
});

// ─── Account/session lookup stub ─────────────────────────────────────────────
app.get("/fortnite/api/game/v2/matchmaking/account/:accountId/session/:sessionId", (req, res) => {
    log.debug(`GET /fortnite/api/game/v2/matchmaking/account/${req.params.accountId}/session/${req.params.sessionId} called`);
    res.json({ accountId: req.params.accountId, sessionId: req.params.sessionId, key: "none" });
});

// ─── Session endpoint ─────────────────────────────────────────────────────────
app.get("/fortnite/api/matchmaking/session/:sessionId", verifyToken, async (req, res) => {
    log.debug(`GET /fortnite/api/matchmaking/session/${req.params.sessionId} called`);
    if (await enforceMatchmakerBan(req, res)) return;

    // ── Rubidium ─────────────────────────────────────────────────────────────
    if (config.rubidium?.enabled) {
        try {
            const apiRes = await fetch(`${config.rubidium.apiUrl}/solstice/api/v1/servers/${req.params.sessionId}`);
            if (apiRes.ok) {
                const d = await apiRes.json();
                if (d?.serverAddress) {
                    const plName = functions.PlaylistNames(d.playlist || "");
                    log.debug(`Rubidium session ${req.params.sessionId}: ${d.serverAddress}:${d.serverPort}`);
                    return res.json({
                        id: req.params.sessionId,
                        ownerId: functions.MakeID().replace(/-/ig, "").toUpperCase(),
                        ownerName: "[DS]fortnite-liveeugcec1c2e30ubrcore0a-z8hj-1968",
                        serverName: "[DS]fortnite-liveeugcec1c2e30ubrcore0a-z8hj-1968",
                        serverAddress: d.serverAddress,
                        serverPort: parseInt(d.serverPort, 10) || d.serverPort,
                        maxPublicPlayers: 220, openPublicPlayers: 175,
                        maxPrivatePlayers: 0,  openPrivatePlayers: 0,
                        attributes: {
                            REGION_s: d.region || "EU", GAMEMODE_s: "FORTATHENA",
                            ALLOWBROADCASTING_b: true, SUBREGION_s: "GB",
                            DCID_s: "FORTNITE-LIVEEUGCEC1C2E30UBRCORE0A-14840880",
                            tenant_s: "Fortnite", MATCHMAKINGPOOL_s: "Any",
                            STORMSHIELDDEFENSETYPE_i: 0, HOTFIXVERSION_i: 0,
                            PLAYLISTNAME_s: plName,
                            SESSIONKEY_s: functions.MakeID().replace(/-/ig, "").toUpperCase(),
                            TENANT_s: "Fortnite", BEACONPORT_i: 15009,
                        },
                        publicPlayers: [], privatePlayers: [],
                        totalPlayers: d.clients || 1,
                        allowJoinInProgress: true, shouldAdvertise: false,
                        isDedicated: true, usesStats: false, allowInvites: false,
                        usesPresence: false, allowJoinViaPresence: true,
                        allowJoinViaPresenceFriendsOnly: false,
                        buildUniqueId: d.bucketId ? d.bucketId.split(":")[0] : (buildUniqueId[req.user.accountId] || "0"),
                        lastUpdated: new Date().toISOString(), started: true,
                    });
                }
            }
        } catch (err) {
            log.error(`Rubidium session fetch failed: ${err.message}`);
        }
    }

    // ── Built-in matchmaker ───────────────────────────────────────────────────
    const playlist     = await global.kv.get(`playerPlaylist:${req.user.accountId}`);
    const playerRegion = ((await global.kv.get(`playerRegion:${req.user.accountId}`)) || config.defaultGameServerRegion || "EU").toUpperCase();

    let kvDoc = await global.kv.get(`playerCustomKey:${req.user.accountId}`);
    if (!kvDoc) {
        // Select region-aware server
        const srv = selectGameServer(config.gameServerIP, String(playlist || "").toLowerCase(), playerRegion);
        if (!srv) {
            log.debug("No server found for playlist", playlist);
            return error.createError(
                "errors.com.epicgames.common.matchmaking.playlist.not_found",
                `No server found for playlist ${playlist}`, [], 1013, "invalid_playlist", 404, res
            );
        }
        kvDoc = JSON.stringify({ ip: srv.ip, port: srv.port, playlist: srv.playlist });
    } else {
        // Custom key: still override IP with region-correct server
        const codeKVTemp = JSON.parse(kvDoc);
        const srv = selectGameServer(config.gameServerIP, String(codeKVTemp.playlist || "").toLowerCase(), playerRegion);
        if (srv) codeKVTemp.ip = srv.ip;
        kvDoc = JSON.stringify(codeKVTemp);
    }

    const codeKV = JSON.parse(kvDoc);
    const playlistName = functions.PlaylistNames(codeKV.playlist);
    const region = playerRegion;

    // Allow in-session server override (matchmaker-assigned)
    const storedSession = global.gameSessions?.get(req.params.sessionId);
    if (storedSession?.serverAddress) {
        codeKV.ip   = storedSession.serverAddress;
        codeKV.port = storedSession.serverPort || codeKV.port;
    }

    await global.kv.setTTL(
        `matchSession:${req.params.sessionId}`,
        JSON.stringify({ accountId: req.user.accountId, playlist: codeKV.playlist }),
        15 * 60 * 1000,
    );

    res.json({
        id: req.params.sessionId,
        ownerId:    functions.MakeID().replace(/-/ig, "").toUpperCase(),
        ownerName:  `[DS]fortnite-live${region.toLowerCase()}gcec1c2e30ubrcore0a-z8hj-1968`,
        serverName: `[DS]fortnite-live${region.toLowerCase()}gcec1c2e30ubrcore0a-z8hj-1968`,
        serverAddress: codeKV.ip,
        serverPort:    parseInt(codeKV.port, 10) || codeKV.port,
        maxPublicPlayers: 220, openPublicPlayers: 175,
        maxPrivatePlayers: 0,  openPrivatePlayers: 0,
        attributes: {
            REGION_s:                 region,
            GAMEMODE_s:               "FORTATHENA",
            ALLOWBROADCASTING_b:      true,
            SUBREGION_s:              region === "NAE" ? "VA" : "GB",
            DCID_s:                   `FORTNITE-LIVE${region}GCEC1C2E30UBRCORE0A-14840880`,
            tenant_s:                 "Fortnite",
            MATCHMAKINGPOOL_s:        "Any",
            STORMSHIELDDEFENSETYPE_i: 0,
            HOTFIXVERSION_i:          0,
            PLAYLISTNAME_s:           playlistName,
            SESSIONKEY_s:             functions.MakeID().replace(/-/ig, "").toUpperCase(),
            TENANT_s:                 "Fortnite",
            BEACONPORT_i:             15009,
        },
        publicPlayers: [], privatePlayers: [],
        totalPlayers: 45,
        allowJoinInProgress: true, shouldAdvertise: false,
        isDedicated: true, usesStats: false, allowInvites: false,
        usesPresence: false, allowJoinViaPresence: true,
        allowJoinViaPresenceFriendsOnly: false,
        buildUniqueId: buildUniqueId[req.user.accountId] || "0",
        lastUpdated: new Date().toISOString(),
        started: true,
    });
});

app.post("/fortnite/api/matchmaking/session/*/join", (req, res) => {
    log.debug("POST /fortnite/api/matchmaking/session/*/join called");
    res.status(204).end();
});

app.post("/fortnite/api/matchmaking/session/matchMakingRequest", (req, res) => {
    log.debug("POST /fortnite/api/matchmaking/session/matchMakingRequest called");
    res.json([]);
});

module.exports = app;
