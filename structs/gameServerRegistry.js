const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const HEARTBEAT_TTL_MS = 90 * 1000;

/** @type {Map<string, object>} */
const sessions = new Map();

const PLAYLIST_LABELS = {
  playlist_playgroundv2: "Creative",
  playlist_showdownalt_solo: "Lategame Arena",
  playlist_defaultsolo: "Solo",
  playlist_defaultduo: "Duos",
  playlist_respawn_squads: "Respawn Squads",
};

function getConfig() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, "../Config/config.json"), "utf8"),
    );
  } catch {
    return {};
  }
}

function playlistKeyFromPath(playlistPath) {
  if (!playlistPath || typeof playlistPath !== "string") return "unknown";
  const lower = playlistPath.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const segment = dot >= 0 ? lower.slice(0, dot) : lower;
  const slash = segment.lastIndexOf("/");
  const name = slash >= 0 ? segment.slice(slash + 1) : segment;
  if (name.startsWith("playlist_")) return name;
  return `playlist_${name}`;
}

function getPlaylistLabel(playlistKey) {
  const key = String(playlistKey || "").toLowerCase();
  return PLAYLIST_LABELS[key] || key.replace(/^playlist_/, "").replace(/_/g, " ");
}

function getRegionForPlaylist(playlistKey) {
  const cfg = getConfig();
  const regions = cfg.gameServerRegions || {};
  const key = String(playlistKey || "").toLowerCase();
  return (
    regions[key] ||
    regions.default ||
    cfg.defaultGameServerRegion ||
    "EU"
  );
}

function getMaxPlayersForPlaylist(playlistKey) {
  const cfg = getConfig();
  const caps = cfg.gameServerMaxPlayers || {};
  const key = String(playlistKey || "").toLowerCase();
  const n = Number(caps[key] ?? caps.default ?? 100);
  return Number.isFinite(n) && n > 0 ? n : 100;
}

function pruneStale() {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastSeenAt > HEARTBEAT_TTL_MS) sessions.delete(id);
  }
}

function upsertHeartbeat(payload) {
  pruneStale();

  const playlistKey = String(payload.playlist || "unknown").toLowerCase();
  let sessionId = String(payload.sessionId || "").trim();
  if (!sessionId) sessionId = randomUUID();

  const now = Date.now();
  const existing = sessions.get(sessionId);
  const playerCount = Math.max(0, Number(payload.playerCount) || 0);
  const maxPlayers =
    Number(payload.maxPlayers) > 0
      ? Number(payload.maxPlayers)
      : getMaxPlayersForPlaylist(playlistKey);

  const statusRaw = String(payload.status || "IN PROGRESS").toUpperCase();
  const status =
    statusRaw.includes("WAIT") ? "WAITING FOR GAME" : statusRaw;

  const entry = {
    sessionId,
    playlist: playlistKey,
    playlistLabel: getPlaylistLabel(playlistKey),
    region: String(payload.region || getRegionForPlaylist(playlistKey)).toUpperCase(),
    playerCount,
    maxPlayers,
    playersLeft: Math.max(0, Number(payload.playersLeft) ?? playerCount),
    status,
    lastSeenAt: now,
    online: true,
  };

  sessions.set(sessionId, existing ? { ...existing, ...entry } : entry);

  return entry;
}

function listPublicSessions() {
  pruneStale();
  const list = Array.from(sessions.values())
    .filter((s) => s.online)
    .sort((a, b) => b.playerCount - a.playerCount || a.playlistLabel.localeCompare(b.playlistLabel));

  const totalPlayers = list.reduce((sum, s) => sum + s.playerCount, 0);

  return {
    serversOnline: list.length,
    totalPlayers,
    sessions: list.map((s) => ({
      sessionId: s.sessionId,
      playlist: s.playlist,
      playlistLabel: s.playlistLabel,
      region: s.region,
      playerCount: s.playerCount,
      maxPlayers: s.maxPlayers,
      playersLeft: s.playersLeft,
      status: s.status,
      title: `${s.playlistLabel} • ${s.status}`,
      meta: `${s.region} • ${s.sessionId}`,
      playerCountText: `${s.playerCount} / ${s.maxPlayers}`,
      playersLeftText: `${s.playersLeft} players left`,
    })),
  };
}

module.exports = {
  upsertHeartbeat,
  listPublicSessions,
  playlistKeyFromPath,
  getPlaylistLabel,
};
