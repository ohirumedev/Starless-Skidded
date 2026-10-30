/**
 * Discord OAuth2 — Launcher Login
 *
 * GET  /phoenix/api/launcher/discord/authorize?hwid=<hwid>
 *      Opens Discord OAuth in the player's browser
 *
 * GET  /phoenix/api/launcher/discord/callback?code=<code>&state=<hwid>
 *      Discord redirects here after login — exchanges code, finds/creates account
 *
 * GET  /phoenix/api/launcher/discord/poll?hwid=<hwid>
 *      Launcher polls this every second — returns { pending:true } or the full session
 */
const express = require("express");
const app     = express.Router();
const axios   = require("axios");
const fs      = require("fs");
const User    = require("../model/user.js");
const Profile = require("../model/profiles.js");
const log     = require("../structs/log.js");
const functions       = require("../structs/functions.js");
const tokenCreation   = require("../tokenManager/tokenCreation.js");
const profileManager  = require("../structs/profile.js");
const { getPlayerSkinInfo }   = require("../structs/launcherSkin.js");
const { recordLauncherHwid }  = require("../structs/hwidManager.js");
const { recordLauncherIp, resolveClientIp } = require("../structs/ipBanManager.js");
const { findBannedHwid }  = require("../structs/hwidManager.js");
const { findBannedIp }    = require("../structs/ipBanManager.js");
const { isUserBanned, PHOENIX_BAN_MESSAGE } = require("../structs/anticheatServer.js");

const EPIC_CLIENT_ID  = "ec684b8c687f479fadea3e7aad8cfcfd";
const DISCORD_API     = "https://discord.com/api/v10";

function getConfig() {
  try { return JSON.parse(fs.readFileSync("./Config/config.json").toString()); }
  catch { return {}; }
}

/* In-memory result store: hwid → result (auto-cleared after 5 min) */
const pending = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending) {
    if (now - v.ts > 5 * 60 * 1000) pending.delete(k);
  }
}, 60_000);

function redirectUri(config) {
  const base = config.anticheat?.backendHost || `http://127.0.0.1:${config.port}`;
  return `${base}/phoenix/api/launcher/discord/callback`;
}

/* ── 1. Redirect to Discord ── */
app.get("/phoenix/api/launcher/discord/authorize", (req, res) => {
  const config     = getConfig();
  const clientId   = config.discord?.oauthClientId;
  const hwid       = String(req.query.hwid || "unknown").trim();

  if (!clientId || clientId.startsWith("PASTE_")) {
    return res.status(500).send("<h2>Discord OAuth not configured. Add oauthClientId and oauthClientSecret to Config/config.json</h2>");
  }

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri(config),
    response_type: "code",
    scope:         "identify email",
    state:         hwid,
    prompt:        "none",
  });

  return res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

/* ── 2. OAuth callback from Discord ── */
app.get("/phoenix/api/launcher/discord/callback", async (req, res) => {
  const config       = getConfig();
  const code         = String(req.query.code  || "").trim();
  const hwid         = String(req.query.state || "unknown").trim();
  const clientId     = config.discord?.oauthClientId;
  const clientSecret = config.discord?.oauthClientSecret;

  if (!code) {
    pending.set(hwid, { ts: Date.now(), error: "Discord authorization was cancelled." });
    return res.send("<script>window.close();</script><p>Cancelled — you can close this tab.</p>");
  }

  try {
    /* Exchange code for Discord access token */
    const tokenRes = await axios.post(`${DISCORD_API}/oauth2/token`, new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      grant_type:    "authorization_code",
      code,
      redirect_uri:  redirectUri(config),
    }), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });

    const discordToken = tokenRes.data?.access_token;
    if (!discordToken) throw new Error("No access_token returned by Discord");

    /* Fetch Discord user */
    const meRes      = await axios.get(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${discordToken}` },
    });
    const dUser      = meRes.data;
    const discordId  = String(dUser.id);
    const avatarHash = dUser.avatar || null;
    const avatarUrl  = avatarHash
      ? `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png?size=128`
      : null;
    const email      = dUser.email || `${discordId}@discord.crystal`;

    /* Find existing account */
    let user = await User.findOne({ discordId }).lean()
            || await User.findOne({ email }).lean();

    if (!user) {
      /* Auto-register */
      const rawName = (dUser.username || "player").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 20) || "player";
      let username  = rawName;
      let suffix    = 0;
      while (await User.findOne({ username_lower: username.toLowerCase() }).lean()) {
        username = `${rawName}${++suffix}`;
      }

      const accountId     = functions.MakeID().replace(/-/g, "");
      const matchmakingId = functions.MakeID().replace(/-/g, "");
      const hashedPw      = await require("bcrypt").hash(functions.MakeID(), 10);

      await User.create({
        created: new Date(),
        discordId,
        accountId,
        username,
        username_lower: username.toLowerCase(),
        email,
        password:        hashedPw,
        matchmakingId,
        discordAvatar:   avatarHash,
      });

      await Profile.create({
        created:   new Date(),
        accountId,
        profiles:  profileManager.createProfiles(accountId),
      });
      // createUserStatsProfiles may not exist on all backend versions
      if (typeof profileManager.createUserStatsProfiles === "function") {
        await profileManager.createUserStatsProfiles(accountId);
      }

      user = await User.findOne({ discordId }).lean();
      if (!user) throw new Error("Could not load newly created account.");
    }

    /* Ban checks */
    if (isUserBanned(user)) {
      pending.set(hwid, { ts: Date.now(), error: PHOENIX_BAN_MESSAGE });
      return res.send("<script>window.close();</script><p>Banned.</p>");
    }

    const clientIp = resolveClientIp(req);
    if (clientIp) {
      const ipBan = await findBannedIp([clientIp]);
      if (ipBan) {
        pending.set(hwid, { ts: Date.now(), error: "Your IP is banned." });
        return res.send("<script>window.close();</script>");
      }
    }
    if (hwid && hwid !== "unknown") {
      const hwidBan = await findBannedHwid([hwid]);
      if (hwidBan) {
        pending.set(hwid, { ts: Date.now(), error: PHOENIX_BAN_MESSAGE });
        return res.send("<script>window.close();</script>");
      }
      await recordLauncherHwid(user.accountId, hwid);
    }
    if (clientIp) await recordLauncherIp(user.accountId, clientIp);

    /* Update avatar */
    if (avatarHash) {
      await User.updateOne({ accountId: user.accountId }, { discordAvatar: avatarHash, discordId });
    }

    /* Create session */
    const deviceId    = functions.MakeID().replace(/-/g, "");
    const accessToken = tokenCreation.createAccess(user, EPIC_CLIENT_ID, "password", deviceId, 8);
    tokenCreation.createRefresh(user, EPIC_CLIENT_ID, "password", deviceId, 24);
    functions.UpdateTokens();

    const skin = await getPlayerSkinInfo(user.accountId);

    pending.set(hwid, {
      ts: Date.now(),
      success:         true,
      username:        user.username,
      accountId:       user.accountId,
      accessToken:     `eg1~${accessToken}`,
      skinName:        skin.skinName        || "",
      skinIconUrl:     skin.skinIconUrl     || "",
      skinTemplateId:  skin.skinTemplateId  || "",
      discordAvatarUrl: avatarUrl           || "",
      anticheat: {
        reportUrl:         `${config.anticheat?.backendHost || `http://127.0.0.1:${config.port}`}/phoenix/api/anticheat/report`,
        heartbeatUrl:      `${config.anticheat?.backendHost || `http://127.0.0.1:${config.port}`}/phoenix/api/anticheat/heartbeat`,
        heartbeatInterval: 30,
      },
    });

    return res.send(`
      <!DOCTYPE html><html>
      <head><title>Crystal — Logged In</title>
      <style>body{background:#07071a;color:#f1f5f9;font-family:sans-serif;
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        height:100vh;margin:0;gap:14px;}</style></head>
      <body>
        <h2 style="color:#22d3ee">✅ Logged in as ${user.username}</h2>
        <p style="color:#94a3b8">You can close this window and return to the launcher.</p>
        <script>setTimeout(()=>window.close(),2000);</script>
      </body></html>
    `);
  } catch (err) {
    log.error(`Discord OAuth error: ${err?.message || err}`);
    log.error(err?.stack || "");
    pending.set(hwid, { ts: Date.now(), error: `Discord login failed: ${err?.message || "Unknown error"}` });
    return res.send(`<script>window.close();</script><p>Error: ${err?.message}. You can close this tab.</p>`);
  }
});

/* ── 3. Launcher polls for result ── */
app.get("/phoenix/api/launcher/discord/poll", (req, res) => {
  const hwid   = String(req.query.hwid || "unknown").trim();
  const result = pending.get(hwid);

  if (!result) return res.json({ pending: true });

  pending.delete(hwid); // consume — one-time

  if (result.error) return res.json({ success: false, message: result.error });

  return res.json(result);
});

module.exports = app;
