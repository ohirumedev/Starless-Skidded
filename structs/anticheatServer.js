const http = require("http");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const jwt = require("jsonwebtoken");
const config = require("../Config/config.json");
const User = require("../model/user.js");
const functions = require("./functions.js");
const log = require("./log.js");
const { encryptMessage, decryptMessage, handleChallenge } = require("./arcCrypto.js");
const {
  findBannedHwid,
  banAllUserHwids,
  recordArcHwids,
} = require("./hwidManager.js");
const {
  findBannedIp,
  banAllUserIps,
  resolveClientIp,
  recordLauncherIp,
} = require("./ipBanManager.js");
const {
  recordHardware,
  findBannedHardware,
  banAllUserHardware,
} = require("./hardwareManager.js");

const PHOENIX_BAN_MESSAGE =
  "You're banned from Crystal Servers. Open a ticket on the support server if you were banned by accident.";

function isUserBanned(user) {
  if (!user?.banned) return false;
  if (user.bannedUntil && new Date(user.bannedUntil) < new Date()) return false;
  return true;
}

function tokenExpired(decoded) {
  if (!decoded?.creation_date) return true;
  const expires = new Date(decoded.creation_date);
  expires.setHours(expires.getHours() + (decoded.hours_expire || 0));
  return expires.getTime() <= Date.now();
}

function resolveUserFromToken(tokenParam) {
  if (!tokenParam) return null;

  let token = decodeURIComponent(tokenParam).trim();
  if (token.startsWith("eg1~")) token = token.slice(4);

  const access = global.accessTokens?.find((entry) => entry.token === `eg1~${token}`);
  if (!access) return null;

  try {
    const decoded = jwt.decode(token);
    if (!decoded?.sub) return null;
    if (tokenExpired(decoded)) return null;
    return decoded.sub;
  } catch {
    return null;
  }
}

function buildConfigurationPayload() {
  const backendHost = config.anticheat?.backendHost || `http://127.0.0.1:${config.port}`;
  return {
    tellurium: {
      backend: backendHost,
      mapping: true,
      hosts: {},
      paths: {},
    },
    whitelisted_paks: [],
  };
}

function startAnticheatServer() {
  const port = config.anticheat?.port || 2151;
  const server = http.createServer();
  const wss = new WebSocketServer({ server, path: "/socket/v1/anticheat/" });

  wss.on("connection", async (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const accountId = resolveUserFromToken(url.searchParams.get("t"));

    if (!accountId) {
      ws.close();
      return;
    }

    const user = await User.findOne({ accountId }).lean();
    if (!user || isUserBanned(user)) {
      ws.close();
      return;
    }

    const clientIp = resolveClientIp(req);
    const bannedIp = await findBannedIp([clientIp, user.lastLauncherIp, ...(user.launcherIps || [])]);
    if (bannedIp) {
      log.debug(`Blocked ${accountId}: banned IP ${bannedIp}`);
      ws.close();
      return;
    }

    if (clientIp) await recordLauncherIp(accountId, clientIp);

    let signingKey = null;
    let challengeHex = null;
    let stage = "await_hmac";

    ws.on("message", async (data) => {
      try {
        if (stage === "await_hmac") {
          signingKey = Buffer.from(data);
          challengeHex = crypto.randomBytes(16).toString("hex");
          ws.send(encryptMessage(JSON.stringify({ challenge: challengeHex }), signingKey));
          stage = "await_challenge";
          return;
        }

        const decrypted = decryptMessage(Buffer.from(data), signingKey);
        if (!decrypted) {
          ws.close();
          return;
        }

        const message = JSON.parse(decrypted);

        if (message.type === "challenge" && message.res) {
          const expected = handleChallenge(challengeHex);
          if (message.res.toLowerCase() !== expected.toLowerCase()) {
            ws.send(encryptMessage(JSON.stringify({ type: "challengeFailed" }), signingKey));
            ws.close();
            return;
          }

          ws.send(encryptMessage(JSON.stringify({ type: "challengeSuccess" }), signingKey));
          ws.send(
            encryptMessage(
              JSON.stringify({ type: "client_info", info: { version: config.anticheat?.clientVersion || 0.8 } }),
              signingKey,
            ),
          );
          stage = "await_configuration_request";
          return;
        }

        if (message.type === "configuration" && stage === "await_configuration_request") {
          ws.send(
            encryptMessage(
              JSON.stringify({ type: "configuration", payload: buildConfigurationPayload() }),
              signingKey,
            ),
          );
          stage = "await_hwid";
          return;
        }

        if (message.type === "hwid") {
          const arcHwids = Array.isArray(message.hwids) ? message.hwids : [];
          if (arcHwids.length > 0) {
            await recordArcHwids(accountId, arcHwids);

            const bannedHwid = await findBannedHwid(arcHwids);
            if (bannedHwid) {
              await User.updateOne(
                { accountId },
                {
                  $set: {
                    banned: true,
                    banReason: "HWID banned from Crystal Servers",
                    bannedUntil: null,
                  },
                },
              );
              log.debug(`Blocked ${accountId}: banned HWID ${bannedHwid}`);
              ws.close();
              return;
            }
          }

          // After hwid, also accept hardware fingerprint if provided
          if (message.hardware && typeof message.hardware === "object") {
            await recordHardware(accountId, message.hardware, clientIp);
            const bannedComponent = await findBannedHardware(message.hardware);
            if (bannedComponent) {
              await User.updateOne(
                { accountId },
                {
                  $set: {
                    banned: true,
                    banReason: `Hardware banned (${bannedComponent.componentType}) from Crystal Servers`,
                    bannedUntil: null,
                  },
                },
              );
              log.debug(`Blocked ${accountId}: banned hardware component ${bannedComponent.componentType}`);
              ws.close();
              return;
            }
          }

          ws.send(encryptMessage(JSON.stringify({ type: "ready" }), signingKey));
          return;
        }

        // Standalone hardware fingerprint message (sent separately by some clients)
        if (message.type === "hardware") {
          const components = message.components || message.hardware || {};
          if (Object.keys(components).length > 0) {
            await recordHardware(accountId, components, clientIp);
            const bannedComponent = await findBannedHardware(components);
            if (bannedComponent) {
              await User.updateOne(
                { accountId },
                {
                  $set: {
                    banned: true,
                    banReason: `Hardware banned (${bannedComponent.componentType}) from Crystal Servers`,
                    bannedUntil: null,
                  },
                },
              );
              log.debug(`Blocked ${accountId}: banned hardware ${bannedComponent.componentType}`);
              ws.send(encryptMessage(JSON.stringify({ type: "banned", reason: "hardware_ban" }), signingKey));
              ws.close();
              return;
            }
          }
          ws.send(encryptMessage(JSON.stringify({ type: "hardware_ack" }), signingKey));
          return;
        }

        if (message.type === "detection") {
          if (message.ban) {
            const banReason = message.info || "Arc AntiCheat detection";
            const currentUser = await User.findOne({ accountId }).lean();
            await User.updateOne(
              { accountId },
              {
                $set: {
                  banned: true,
                  banReason,
                  bannedUntil: null,
                },
              },
            );
            if (currentUser) {
              await banAllUserHwids(currentUser, banReason, "arc_detection");
              await banAllUserIps(currentUser, banReason, "arc_detection");
              await banAllUserHardware(currentUser, banReason, "arc_detection");
            }
            log.debug(`Arc banned account ${accountId}: ${banReason}`);
          }
          return;
        }

        if (message.ping !== undefined) {
          ws.send(encryptMessage(JSON.stringify({ type: "pong" }), signingKey));
        }
      } catch (err) {
        log.error(`Anticheat socket error: ${err}`);
        ws.close();
      }
    });
  });

  server.listen(port, () => {
    log.backend(`Arc AntiCheat WebSocket listening on port ${port}`);
  });

  server.on("error", (err) => {
    log.error(`Arc AntiCheat server failed: ${err.message}`);
  });
}

module.exports = {
  startAnticheatServer,
  PHOENIX_BAN_MESSAGE,
  isUserBanned,
};
