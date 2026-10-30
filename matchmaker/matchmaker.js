const functions = require("../structs/functions.js");
const net = require("net");
const fs = require("fs");
const User = require("../model/user.js");
const log = require("../structs/log.js");

function getConfig() {
    try {
        return JSON.parse(fs.readFileSync("./Config/config.json").toString());
    } catch {
        return {};
    }
}

function getGamesessionsStore() {
    if (!global.gameSessions) global.gameSessions = new Map();
    if (!global.gameSessionsByAccountId) global.gameSessionsByAccountId = new Map();
    return {
        bySessionId: global.gameSessions,
        byAccountId: global.gameSessionsByAccountId,
    };
}

async function tcpPing(host, port, timeoutMs = 750) {
    return await new Promise((resolve) => {
        const socket = new net.Socket();
        let done = false;

        const finish = (ok) => {
            if (done) return;
            done = true;
            try {
                socket.destroy();
            } catch {}
            resolve(ok);
        };

        socket.setTimeout(timeoutMs);
        socket.once("connect", () => finish(true));
        socket.once("timeout", () => finish(false));
        socket.once("error", () => finish(false));
        socket.connect(port, host);
    });
}

function parseGameServerEntry(entry) {
    if (typeof entry !== "string") return null;
    const parts = entry.split(":");
    if (parts.length < 2) return null;
    const ip = parts[0];
    const port = Number(parts[1]);
    const playlist = parts[2] || null;
    const region = (parts[3] || "EU").toUpperCase();
    if (!ip || !Number.isFinite(port)) return null;
    return { ip, port, playlist, region };
}

async function resolveAccountIdFromMatchmakingId(matchmakingId) {
    if (!matchmakingId || typeof matchmakingId !== "string") return null;
    try {
        const user = await User.findOne({ matchmakingId }).lean();
        return user?.accountId || null;
    } catch {
        return null;
    }
}

async function getTargetServerForAccount(accountId) {
    const config = getConfig();
    const gameServers = Array.isArray(config.gameServerIP) ? config.gameServerIP : [];

    let playlist = null;
    let region = null;
    try {
        if (global.kv && accountId) {
            playlist = await global.kv.get(`playerPlaylist:${accountId}`);
            region   = await global.kv.get(`playerRegion:${accountId}`);
        }
    } catch {}

    const regionUpper = (region || "EU").toUpperCase();

    let selected = null;
    if (playlist) {
        // Try exact playlist + region match first
        selected = gameServers.find((s) => {
            const parts = s.split(":");
            const pl = (parts[2] || "").toLowerCase();
            const rg = (parts[3] || "EU").toUpperCase();
            return pl === String(playlist).toLowerCase() && rg === regionUpper;
        });
        // Fall back to playlist-only match
        if (!selected) {
            selected = gameServers.find(
                (s) => (s.split(":")[2] || "").toLowerCase() === String(playlist).toLowerCase(),
            );
        }
    }
    // Fall back to region-only match
    if (!selected) {
        selected = gameServers.find(
            (s) => (s.split(":")[3] || "EU").toUpperCase() === regionUpper,
        );
    }
    if (!selected) selected = gameServers[0];

    const parsed = parseGameServerEntry(selected);
    if (!parsed) return null;

    return { ...parsed, playlist: playlist || parsed.playlist };
}

function safeSend(ws, payload) {
    try {
        if (ws.readyState === 1) ws.send(JSON.stringify(payload));
    } catch {}
}

module.exports = async (ws, meta = {}) => {
    const { bySessionId, byAccountId } = getGamesessionsStore();

    const ticketId = functions.MakeID().replace(/-/ig, "");
    const matchId = functions.MakeID().replace(/-/ig, "");
    const sessionId = functions.MakeID().replace(/-/ig, "");

    let matchmakingId = meta.matchmakingId || null;
    let accountId = meta.accountId || null;

    ws.once("message", async (message) => {
        try {
            if (Buffer.isBuffer(message)) message = message.toString();
            const parsed = JSON.parse(message);
            const maybe =
                typeof parsed === "object" && parsed
                    ? parsed.payload || parsed.ticketId || parsed.accountId
                    : null;
            if (typeof maybe === "string" && !matchmakingId) matchmakingId = maybe;
        } catch {
            if (typeof message === "string" && message.trim() && !matchmakingId) {
                matchmakingId = message.trim();
            }
        }

        if (!accountId && matchmakingId) {
            accountId = await resolveAccountIdFromMatchmakingId(matchmakingId);
        }
    });

    ws.on("close", () => {
        try {
            bySessionId.delete(sessionId);
            if (accountId) byAccountId.delete(accountId);
        } catch {}
    });

    const baseSession = {
        id: sessionId,
        matchId,
        ticketId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        state: "Connecting",
        accountId: null,
        matchmakingId: null,
        playlist: null,
        serverAddress: null,
        serverPort: null,
    };
    bySessionId.set(sessionId, baseSession);

    function updateSession(patch) {
        const existing = bySessionId.get(sessionId) || {};
        const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
        bySessionId.set(sessionId, next);
        if (next.accountId) byAccountId.set(next.accountId, sessionId);
        return next;
    }

    Connecting();
    await functions.sleep(250);
    Waiting();
    await functions.sleep(250);

    const config = getConfig();
    const pollMs = Number(config.matchmakerQueuePollMs) || 1000;
    const maxRetries = Number(config.matchmakerMaxRetries) || 5;
    const skipPingCheck = config.matchmakerSkipPingCheck !== false;

    let retryCount = 0;
    let target = null;

    while (ws.readyState === 1) {
        if (!accountId && matchmakingId) {
            accountId = await resolveAccountIdFromMatchmakingId(matchmakingId);
        }

        if (!target) {
            target = await getTargetServerForAccount(accountId);
        }

        if (!target) {
            log.debug("[Matchmaker] No target server configured, proceeding anyway");
            break;
        }

        updateSession({
            state: "Queued",
            accountId: accountId || null,
            matchmakingId: matchmakingId || null,
            playlist: target?.playlist || null,
            serverAddress: target?.ip || null,
            serverPort: target?.port || null,
        });

        Queued(1);

        if (target?.ip && target?.port) {
            const ok = await tcpPing(target.ip, target.port, Math.min(750, pollMs));
            if (ok) {
                log.debug(`[Matchmaker] Game server ${target.ip}:${target.port} is reachable`);
                break;
            }

            retryCount++;
            log.debug(
                `[Matchmaker] Game server ${target.ip}:${target.port} not reachable (${retryCount}/${maxRetries})`,
            );

            if (retryCount >= maxRetries && skipPingCheck) {
                log.debug("[Matchmaker] Max retries reached, proceeding without ping");
                break;
            }
        } else {
            break;
        }

        await functions.sleep(pollMs);
    }

    if (ws.readyState !== 1) return;

    updateSession({
        state: "SessionAssignment",
        accountId: accountId || null,
        matchmakingId: matchmakingId || null,
    });
    SessionAssignment();
    await functions.sleep(500);

    updateSession({
        state: "Play",
        accountId: accountId || null,
        matchmakingId: matchmakingId || null,
    });
    Join();

    function Connecting() {
        updateSession({ state: "Connecting" });
        safeSend(ws, {
            payload: { state: "Connecting" },
            name: "StatusUpdate",
        });
    }

    function Waiting() {
        updateSession({ state: "Waiting" });
        safeSend(ws, {
            payload: { totalPlayers: 1, connectedPlayers: 1, state: "Waiting" },
            name: "StatusUpdate",
        });
    }

    function Queued(estimatedWaitSec = 1) {
        safeSend(ws, {
            payload: {
                ticketId,
                queuedPlayers: 1,
                estimatedWaitSec,
                status: {},
                state: "Queued",
            },
            name: "StatusUpdate",
        });
    }

    function SessionAssignment() {
        // Include matchId so the game knows which session to query
        safeSend(ws, {
            payload: {
                matchId,
                state: "SessionAssignment",
                // Build 27.x reads these directly from the assignment message
                sessionId,
            },
            name: "StatusUpdate",
        });
    }

    function Join() {
        // Build 27.x needs serverAddress and serverPort in the Play message
        // to actually route the connection — without them it falls back and
        // shows "network error".
        const session = bySessionId.get(sessionId) || {};
        const serverAddress = session.serverAddress || (target && target.ip) || null;
        const serverPort = session.serverPort || (target && target.port) || null;

        const payload = {
            matchId,
            sessionId,
            joinDelaySec: 1,
        };

        // Include server info if available — older builds ignore extra fields
        if (serverAddress) payload.serverAddress = serverAddress;
        if (serverPort)    payload.serverPort = String(serverPort);

        safeSend(ws, { payload, name: "Play" });
    }
};

module.exports.forceMatchNow = () => {};
