const express = require("express");
const fs = require("fs");
const app = express.Router();
const log = require("../structs/log.js");
const path = require("path");
const {
  getAccountIdData,
  addEliminationHypePoints,
  addVictoryHypePoints,
  grantVbucksForReason,
  deductBusFareHypePoints,
  resolveEventIdForAccount,
  getConfiguredArenaEventId,
  buildEventPlayerOverrides,
} = require("../structs/functions.js");
const { verifyToken, verifyClient } = require("../tokenManager/tokenVerify.js");
const User = require("../model/user.js");
const Profile = require("../model/profiles.js");
const battlePass = require("../structs/battlePass.js");
const gameServerRegistry = require("../structs/gameServerRegistry.js");
const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());

function getBackendBaseUrl() {
  const configured = config.launcher?.backendUrl?.trim();
  if (configured) {
    return configured.endsWith("/") ? configured : `${configured}/`;
  }
  return `http://127.0.0.1:${config.port || 3551}/`;
}

function getBuildVersion() {
  return (
    config.launcher?.buildVersion ||
    "++Fortnite+Release-24.20-CL-25156858-Windows"
  );
}

function getManifestLabel() {
  return config.launcher?.manifestLabel || "IRISBackend";
}

function readCloudDirFile(name, fallbacks = []) {
  const cloudDir = path.join(__dirname, "..", "responses", "CloudDir");
  for (const fileName of [name, ...fallbacks]) {
    const filePath = path.join(cloudDir, fileName);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath);
    }
  }
  throw new Error(`Missing CloudDir file: ${name}`);
}

function verifyGameServerApiKey(req) {
  const key =
    req.headers["x-api-key"] ||
    req.headers["authorization"] ||
    req.query.apiKey;
  return key && config.Api?.bApiKey && key === config.Api.bApiKey;
}

app.post("/fortnite/api/game/v2/chat/*/*/*/pc", (req, res) => {
  log.debug("POST /fortnite/api/game/v2/chat/*/*/*/pc called");
  let resp = config.chat.EnableGlobalChat
    ? { GlobalChatRooms: [{ roomName: "IRISbackendglobal" }] }
    : {};

  res.json(resp);
});

// IAS (Installed Asset Service) chunk requests — the game checks for update chunks
// on startup. Return 204 so it silently skips without spamming missing endpoint logs.
app.head("/ias/*", (req, res) => {
  res.status(204).end();
});

app.get("/ias/*", (req, res) => {
  res.status(204).end();
});

app.post("/fortnite/api/game/v2/tryPlayOnPlatform/account/*", (req, res) => {
  log.debug("POST /fortnite/api/game/v2/tryPlayOnPlatform/account/* called");
  res.setHeader("Content-Type", "text/plain");
  res.send(true);
});

app.get("/launcher/api/public/distributionpoints/", (req, res) => {
  log.debug("GET /launcher/api/public/distributionpoints/ called");
  const backendBase = getBackendBaseUrl();
  res.json({
    distributions: config.launcher?.useEpicDistributionPoints
      ? [
          "https://download.epicgames.com/",
          "https://download2.epicgames.com/",
          "https://download3.epicgames.com/",
          "https://download4.epicgames.com/",
          "https://epicgames-download1.akamaized.net/",
        ]
      : [backendBase],
  });
});

app.get("/launcher/api/public/assets/*", async (req, res) => {
  const backendBase = getBackendBaseUrl();
  const labelName = getManifestLabel();
  res.json({
    appName: "FortniteContentBuilds",
    labelName,
    buildVersion: getBuildVersion(),
    catalogItemId: "5cb97847cee34581afdbc445400e2f77",
    expires: "9999-12-31T23:59:59.999Z",
    items: {
      MANIFEST: {
        signature: labelName,
        distribution: backendBase,
        path: `Builds/Fortnite/Content/CloudDir/${labelName}.manifest`,
        hash: "55bb954f5596cadbe03693e1c06ca73368d427f3",
        additionalDistributions: [],
      },
      CHUNKS: {
        signature: labelName,
        distribution: backendBase,
        path: `Builds/Fortnite/Content/CloudDir/${labelName}.manifest`,
        additionalDistributions: [],
      },
    },
    assetId: "FortniteContentBuilds",
  });
});

app.get("/Builds/Fortnite/Content/CloudDir/*.manifest", async (req, res) => {
  log.debug(`GET ${req.path} called`);
  res.set("Content-Type", "application/octet-stream");

  const requested = path.basename(req.path);
  const labelName = getManifestLabel();
  const manifest = readCloudDirFile(requested, [
    `${labelName}.manifest`,
    "IRISBackend.manifest",
    "LawinServer.manifest",
  ]);

  res.status(200).send(manifest).end();
});

app.get("/Builds/Fortnite/Content/CloudDir/*.chunk", async (req, res) => {
  log.debug(`GET ${req.path} called`);
  res.set("Content-Type", "application/octet-stream");

  const requested = path.basename(req.path);
  const labelName = getManifestLabel();
  const chunk = readCloudDirFile(requested, [
    `${labelName}.chunk`,
    "IRISBackend.chunk",
    "LawinServer.chunk",
  ]);

  res.status(200).send(chunk).end();
});

app.post("/fortnite/api/game/v2/grant_access/*", async (req, res) => {
  log.debug("POST /fortnite/api/game/v2/grant_access/* called");
  res.json({});
  res.status(204);
});

app.post("/api/v1/user/setting", async (req, res) => {
  log.debug("POST /api/v1/user/setting called");
  res.json([]);
});

app.get("/Builds/Fortnite/Content/CloudDir/*.ini", async (req, res) => {
  const ini = fs.readFileSync(
    path.join(__dirname, "..", "responses", "CloudDir", "Full.ini"),
  );

  res.status(200).send(ini).end();
});

app.get("/waitingroom/api/waitingroom", (req, res) => {
  log.debug("GET /waitingroom/api/waitingroom called");
  res.status(204);
  res.end();
});

app.get("/socialban/api/public/v1/*", (req, res) => {
  log.debug("GET /socialban/api/public/v1/* called");
  res.json({
    bans: [],
    warnings: [],
  });
});

app.get(
  "/fortnite/api/game/v2/events/tournamentandhistory/*/EU/WindowsClient",
  (req, res) => {
    log.debug(
      "GET /fortnite/api/game/v2/events/tournamentandhistory/*/EU/WindowsClient called",
    );
    res.json({});
  },
);

app.get("/fortnite/api/statsv2/account/:accountId", (req, res) => {
  log.debug(`GET /fortnite/api/statsv2/account/${req.params.accountId} called`);
  res.json({
    startTime: 0,
    endTime: 0,
    stats: {},
    accountId: req.params.accountId,
  });
});

app.get("/statsproxy/api/statsv2/account/:accountId", (req, res) => {
  log.debug(
    `GET /statsproxy/api/statsv2/account/${req.params.accountId} called`,
  );
  res.json({
    startTime: 0,
    endTime: 0,
    stats: {},
    accountId: req.params.accountId,
  });
});

app.get(
  "/fortnite/api/stats/accountId/:accountId/bulk/window/alltime",
  (req, res) => {
    log.debug(
      `GET /fortnite/api/stats/accountId/${req.params.accountId}/bulk/window/alltime called`,
    );
    res.json({
      startTime: 0,
      endTime: 0,
      stats: {},
      accountId: req.params.accountId,
    });
  },
);

app.get("/d98eeaac-2bfa-4bf4-8a59-bdc95469c693", async (req, res) => {
  res.json({
    playlist:
      "PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4KPE1QRCB4bWxucz0idXJuOm1wZWc6ZGFzaDpzY2hlbWE6bXBkOjIwMTEiIHhtbG5zOnhzaT0iaHR0cDovL3d3dy53My5vcmcvMjAwMS9YTUxTY2hlbWEtaW5zdGFuY2UiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB4c2k6c2NoZW1hTG9jYXRpb249InVybjptcGVnOkRBU0g6c2NoZW1hOk1QRDoyMDExIGh0dHA6Ly9zdGFuZGFyZHMuaXNvLm9yZy9pdHRmL1B1YmxpY2x5QXZhaWxhYmxlU3RhbmRhcmRzL01QRUctREFTSF9zY2hlbWFfZmlsZXMvREFTSC1NUEQueHNkIiBwcm9maWxlcz0idXJuOm1wZWc6ZGFzaDpwcm9maWxlOmlzb2ZmLWxpdmU6MjAxMSIgdHlwZT0ic3RhdGljIiBtZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uPSJQVDMwLjIxM1MiIG1heFNlZ21lbnREdXJhdGlvbj0iUFQyLjAwMFMiIG1pbkJ1ZmZlclRpbWU9IlBUNC4xMDZTIj4KICA8QmFzZVVSTD5odHRwczovL2ZvcnRuaXRlLXB1YmxpYy1zZXJ2aWNlLXByb2QxMS5vbC5lcGljZ2FtZXMuY29tL2F1ZGlvL0phbVRyYWNrcy9PR1JlbWl4LzwvQmFzZVVSTD4KICA8UHJvZ3JhbUluZm9ybWF0aW9uPjwvUHJvZ3JhbUluZm9ybWF0aW9uPgogIDxQZXJpb2QgaWQ9IjAiIHN0YXJ0PSJQVDBTIj4KICAgIDxBZGFwdGF0aW9uU2V0IGlkPSIwIiBjb250ZW50VHlwZT0iYXVkaW8iIHN0YXJ0V2l0aFNBUD0iMSIgc2VnbWVudEFsaWdubWVudD0idHJ1ZSIgYml0c3RyZWFtU3dpdGNoaW5nPSJ0cnVlIj4KICAgICAgPFJlcHJlc2VudGF0aW9uIGlkPSIwIiBhdWRpb1NhbXBsaW5nUmF0ZT0iNDgwMDAiIGJhbmR3aWR0aD0iMTI4MDAwIiBtaW1lVHlwZT0iYXVkaW8vbXA0IiBjb2RlY3M9Im1wNGEuNDAuMiI+CiAgICAgICAgPFNlZ21lbnRUZW1wbGF0ZSBkdXJhdGlvbj0iMjAwMDAwMCIgdGltZXNjYWxlPSIxMDAwMDAwIiBpbml0aWFsaXphdGlvbj0iaW5pdF8kUmVwcmVzZW50YXRpb25JRCQubXA0IiBtZWRpYT0ic2VnbWVudF8kUmVwcmVzZW50YXRpb25JRCRfJE51bWJlciQubTRzIiBzdGFydE51bWJlcj0iMSI+PC9TZWdtZW50VGVtcGxhdGU+CiAgICAgICAgPEF1ZGlvQ2hhbm5lbENvbmZpZ3VyYXRpb24gc2NoZW1lSWRVcmk9InVybjptcGVnOmRhc2g6MjMwMDM6MzphdWRpb19jaGFubmVsX2NvbmZpZ3VyYXRpb246MjAxMSIgdmFsdWU9IjIiPjwvQXVkaW9DaGFubmVsQ29uZmlndXJhdGlvbj4KICAgICAgPC9SZXByZXNlbnRhdGlvbj4KICAgIDwvQWRhcHRhdGlvblNldD4KICA8L1BlcmlvZD4KPC9NUEQ+",
    playlistType: "application/dash+xml",
    metadata: {
      assetId: "",
      baseUrls: [
        "https://fortnite-public-service-prod11.ol.epicgames.com/audio/JamTracks/OGRemix/",
      ],
      supportsCaching: true,
      ucp: "a",
      version: "f2528fa1-5f30-42ff-8ae5-a03e3b023a0a",
    },
  });
});

app.post("/fortnite/api/feedback/*", (req, res) => {
  log.debug("POST /fortnite/api/feedback/* called");
  res.status(200);
  res.end();
});

app.post("/fortnite/api/statsv2/query", (req, res) => {
  log.debug("POST /fortnite/api/statsv2/query called");
  res.json([]);
});

app.post("/statsproxy/api/statsv2/query", (req, res) => {
  log.debug("POST /statsproxy/api/statsv2/query called");
  res.json([]);
});

app.post("/fortnite/api/game/v2/events/v2/setSubgroup/*", (req, res) => {
  log.debug("POST /fortnite/api/game/v2/events/v2/setSubgroup/* called");
  res.status(204);
  res.end();
});

app.get("/fortnite/api/game/v2/enabled_features", (req, res) => {
  log.debug("GET /fortnite/api/game/v2/enabled_features called");
  res.json(["LiveEvents", "BattleRoyale", "Creative", "SaveTheWorld"]);
});

app.get("/api/v1/events/Fortnite/download/:accountId", async (req, res) => {
  const accountId = req.params.accountId;

  try {
    const eventsDataPath = path.join(
      __dirname,
      "./../responses/eventlistactive.json",
    );
    const events = JSON.parse(fs.readFileSync(eventsDataPath, "utf-8"));
    const playerOverrides = await buildEventPlayerOverrides(accountId);

    events.player = {
      accountId: accountId,
      gameId: "Fortnite",
      persistentScores: playerOverrides.persistentScores,
      tokens: playerOverrides.tokens,
    };

    res.json(events);
  } catch (error) {
    console.error("Error fetching Arena data:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.get("/api/v1/events/Fortnite/:eventId/history/:accountId", (req, res) => {
  log.debug(
    `GET /api/v1/events/Fortnite/${req.params.eventId}/history/${req.params.accountId} called`,
  );
  res.json({
    events: [],
    paging: {
      count: 0,
      total: 0,
    },
  });
});

app.get("/fortnite/api/game/v2/twitch/*", (req, res) => {
  log.debug("GET /fortnite/api/game/v2/twitch/* called");
  res.status(200);
  res.end();
});

app.get("/fortnite/api/game/v2/world/info", (req, res) => {
  log.debug("GET /fortnite/api/game/v2/world/info called");
  res.json({});
});

app.post(
  "/fortnite/api/game/v2/chat/*/recommendGeneralChatRooms/pc",
  (req, res) => {
    log.debug(
      "POST /fortnite/api/game/v2/chat/*/recommendGeneralChatRooms/pc called",
    );
    res.json({});
  },
);

app.get("/presence/api/v1/_/*/last-online", async (req, res) => {
  log.debug("GET /presence/api/v1/_/*/last-online called");
  res.json({});
});

app.get("/fortnite/api/receipts/v1/account/*/receipts", (req, res) => {
  log.debug("GET /fortnite/api/receipts/v1/account/*/receipts called");
  res.json([]);
});

app.get("/fortnite/api/game/v2/leaderboards/cohort/*", (req, res) => {
  log.debug("GET /fortnite/api/game/v2/leaderboards/cohort/* called");
  res.json([]);
});

app.post("/api/v1/assets/Fortnite/*/*", async (req, res) => {
  log.debug("POST /api/v1/assets/Fortnite/*/* called");
  if (req.body.hasOwnProperty("FortCreativeDiscoverySurface")) {
    const discovery_api_assets = require("./../responses/Discovery/discovery_api_assets.json");
    return res.json(discovery_api_assets);
  }
  res.json({
    FortCreativeDiscoverySurface: {
      meta: {
        promotion: req.body.FortCreativeDiscoverySurface || 0,
      },
      assets: {},
    },
  });
});

app.get("/region", async (req, res) => {
  log.debug("GET /region called");
  res.json({
    continent: {
      code: "EU",
      geoname_id: 6255148,
      names: {
        de: "Europa",
        en: "Europe",
        es: "Europa",
        it: "Europa",
        fr: "Europe",
        ja: "ヨーロッパ",
        "pt-BR": "Europa",
        ru: "Европа",
        "zh-CN": "欧洲",
      },
    },
    country: {
      geoname_id: 2635167,
      is_in_european_union: false,
      iso_code: "GB",
      names: {
        de: "UK",
        en: "United Kingdom",
        es: "RU",
        it: "Stati Uniti",
        fr: "Royaume Uni",
        ja: "英国",
        "pt-BR": "Reino Unido",
        ru: "Британия",
        "zh-CN": "英国",
      },
    },
    subdivisions: [
      {
        geoname_id: 6269131,
        iso_code: "ENG",
        names: {
          de: "England",
          en: "England",
          es: "Inglaterra",
          it: "Inghilterra",
          fr: "Angleterre",
          ja: "イングランド",
          "pt-BR": "Inglaterra",
          ru: "Англия",
          "zh-CN": "英格兰",
        },
      },
      {
        geoname_id: 3333157,
        iso_code: "KEC",
        names: {
          en: "Royal Kensington and Chelsea",
        },
      },
    ],
  });
});

app.all("/v1/epic-settings/public/users/*/values", async (req, res) => {
  const epicsettings = require("./../responses/epic-settings.json");
  res.json(epicsettings);
});

app.get("/fortnite/api/game/v2/br-inventory/account/*", async (req, res) => {
  log.debug(
    `GET /fortnite/api/game/v2/br-inventory/account/${req.params.accountId} called`,
  );
  res.json({
    stash: {
      globalcash: 0,
    },
  });
});

app.post("/fortnite/api/game/v2/dedicated/server-heartbeat", async (req, res) => {
  try {
    if (!verifyGameServerApiKey(req)) {
      return res.status(401).json({ error: "invalid_api_key" });
    }

    const session = gameServerRegistry.upsertHeartbeat({
      sessionId: req.body?.sessionId,
      playlist: req.body?.playlist,
      region: req.body?.region,
      playerCount: req.body?.playerCount,
      maxPlayers: req.body?.maxPlayers,
      playersLeft: req.body?.playersLeft,
      status: req.body?.status,
    });

    return res.json({
      success: true,
      sessionId: session.sessionId,
    });
  } catch (err) {
    log.error("[GameServer] heartbeat failed:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

app.post("/fortnite/api/game/v2/dedicated/battle-pass-sync", async (req, res) => {
  try {
    if (!verifyGameServerApiKey(req)) {
      return res.status(401).json({ error: "invalid_api_key" });
    }

    const username = String(req.body?.username || "").trim();
    const accountId = String(req.body?.accountId || "").trim();
    let user = null;

    if (accountId) {
      user = await User.findOne({ accountId }).lean();
    } else if (username) {
      user = await User.findOne({
        username_lower: username.toLowerCase(),
      }).lean();
    }

    if (!user) {
      return res.status(404).json({ error: "user_not_found" });
    }

    const profiles = await Profile.findOne({ accountId: user.accountId });
    if (!profiles) {
      return res.status(404).json({ error: "profile_not_found" });
    }

    const result = await battlePass.applyGameserverMatchProgress(
      profiles,
      user.accountId,
      {
        onlyFetch: Boolean(req.body?.onlyFetch),
        level: Number(req.body?.level) || 0,
        matchXpGain: Number(req.body?.matchXpGain) || 0,
        season: Number(req.body?.season) || undefined,
      },
    );

    if (!result.ok) {
      return res.status(500).json(result);
    }

    if (!req.body?.onlyFetch && !result.skipped) {
      log.debug(
        `[BattlePass] ${user.username} level=${result.book_level} xp=${result.book_xp} leveledUp=${result.leveledUp}`,
      );
    }

    return res.json({
      success: true,
      accountId: user.accountId,
      username: user.username,
      book_level: result.book_level,
      book_xp: result.book_xp,
      leveledUp: result.leveledUp || false,
      oldLevel: result.oldLevel,
      newLevel: result.newLevel,
    });
  } catch (err) {
    log.error("[BattlePass] dedicated sync failed:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

app.post("/fortnite/api/game/v2/dedicated/victory-crown-win", async (req, res) => {
  try {
    if (!verifyGameServerApiKey(req)) {
      return res.status(401).json({ error: "invalid_api_key" });
    }

    const username = String(req.body?.username || "").trim();
    const accountId = String(req.body?.accountId || "").trim();
    let user = null;

    if (accountId) {
      user = await User.findOne({ accountId }).lean();
    } else if (username) {
      user = await User.findOne({
        username_lower: username.toLowerCase(),
      }).lean();
    }

    if (!user) {
      return res.status(404).json({ error: "user_not_found" });
    }

    const profiles = await Profile.findOne({ accountId: user.accountId });
    if (!profiles) {
      return res.status(404).json({ error: "profile_not_found" });
    }

    const result = await battlePass.recordVictoryCrownWin(
      profiles,
      user.accountId,
      Number(req.body?.incrementAmount) || 1,
    );

    if (!result.ok) {
      return res.status(500).json(result);
    }

    log.debug(
      `[VictoryCrown] ${user.username} wins=${result.crownWins} quest=${result.questProgress}`,
    );

    return res.json({
      success: true,
      accountId: user.accountId,
      username: user.username,
      crownWins: result.crownWins,
      questProgress: result.questProgress,
    });
  } catch (err) {
    log.error("[VictoryCrown] dedicated win failed:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

app.post("/datarouter/api/v1/public/data", async (req, res) => {
  try {
    const accountId = getAccountIdData(req.query.UserID);
    const data = req.body.Events;

    if (Array.isArray(data) && data.length > 0) {
      const findUser = await User.findOne({ accountId });

      if (findUser) {
        let sessionEventId =
          (await resolveEventIdForAccount(findUser.accountId)) ||
          getConfiguredArenaEventId();

        for (const event of data) {
          const { EventName, ProviderType, PlayerKilledPlayerEventCount } =
            event;

          if (EventName && ProviderType === "Client") {
            const playerKills = Number(PlayerKilledPlayerEventCount) || 0;

            switch (EventName) {
              case "Athena.ClientWonMatch":
                await addVictoryHypePoints(findUser, sessionEventId);
                await grantVbucksForReason(findUser.accountId, "Win");
                break;
              case "Combat.AthenaClientEngagement":
                for (let i = 0; i < playerKills; i++) {
                  await addEliminationHypePoints(findUser, sessionEventId);
                }
                if (playerKills > 0) {
                  await grantVbucksForReason(
                    findUser.accountId,
                    "Kill",
                    playerKills,
                  );
                }

                break;

              case "Combat.ClientPlayerDeath":
                await deductBusFareHypePoints(findUser, sessionEventId);

                break;
              default:
                log.debug(`Event List: ${EventName}`);
                break;
            }
          }
        }
      } else {
      }
    }

    res.status(204).end();
  } catch (error) {
    log.error("Error processing data:", error);
    res.status(500).send("Internal Server Error");
  }
});

module.exports = app;
