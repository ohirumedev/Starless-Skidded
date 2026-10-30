/**
 * GET /phoenix/api/launcher/servers
 * Returns live game sessions from the registry + static infrastructure info.
 * No auth required — public endpoint.
 */
const express = require("express");
const app = express.Router();
const { listPublicSessions } = require("../structs/gameServerRegistry.js");
const fs = require("fs");
const log = require("../structs/log.js");

function getConfig() {
  try { return JSON.parse(fs.readFileSync("./Config/config.json").toString()); }
  catch { return {}; }
}

app.get("/phoenix/api/launcher/servers", (req, res) => {
  try {
    const config = getConfig();
    const { serversOnline, totalPlayers, sessions } = listPublicSessions();

    // Parse game server IPs from config
    const gameServerEntries = (config.gameServerIP || []).map(entry => {
      const parts = String(entry).split(":");
      const ip       = parts[0] || "45.92.217.130";
      const port     = parts[1] || "7777";
      const playlist = parts[2] || "playlist_defaultsolo";
      return { ip, port, playlist };
    });

    // Unique IPs
    const uniqueIps = [...new Set(gameServerEntries.map(e => `${e.ip}:${e.port}`))];

    return res.json({
      success: true,
      infrastructure: {
        gameServer: {
          ip:   uniqueIps[0]?.split(":")[0] || "45.92.217.130",
          port: uniqueIps[0]?.split(":")[1] || "7777",
          display: uniqueIps[0] || "45.92.217.130:7777",
          region: config.defaultGameServerRegion || "EU",
        },
        matchmaker: {
          ip:      config.matchmakerIP?.split(":")[0] || "45.92.217.130",
          port:    config.matchmakerIP?.split(":")[1] || "1111",
          display: config.matchmakerIP || "45.92.217.130:1111",
        },
      },
      summary: {
        serversOnline,
        totalPlayers,
      },
      sessions,
      // Playlist definitions from config so the UI can show friendly names
      playlists: Object.entries(config.gameServerRegions || {})
        .filter(([key]) => key !== "default")
        .map(([key, region]) => ({
          key,
          label: key.replace(/^playlist_/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
          region,
          maxPlayers: (config.gameServerMaxPlayers || {})[key] || 100,
        })),
    });
  } catch (err) {
    log.error(`Servers endpoint error: ${err?.message || err}`);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = app;
