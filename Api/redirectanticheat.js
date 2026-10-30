/**
 * Starless Redirect Anticheat — HTTP endpoint
 *
 * The Pulse.dll (Starless Redirect) calls this endpoint when it detects
 * a cheat. The backend validates the token, bans the account + HWID + IP,
 * and notifies Discord webhooks.
 *
 * Endpoints:
 *
 *   POST /phoenix/api/anticheat/report
 *     Called by the DLL when a cheat is detected.
 *     Body: { token, hwid, reason, severity, metadata? }
 *
 *   POST /phoenix/api/anticheat/heartbeat
 *     Called every 30s by the DLL to confirm the game client is still clean.
 *     Body: { token, hwid }
 *
 *   GET  /phoenix/api/anticheat/status/:accountId
 *     Staff endpoint — check current anticheat status for an account.
 *     Requires X-Staff-Key header matching config.Api.bApiKey
 */

const express = require("express");
const jwt     = require("jsonwebtoken");
const app     = express.Router();

const User        = require("../model/user.js");
const log         = require("../structs/log.js");
const { banAllUserHwids }  = require("../structs/hwidManager.js");
const { banAllUserIps }    = require("../structs/ipBanManager.js");
const { findBannedHwid }   = require("../structs/hwidManager.js");
const { findBannedIp, resolveClientIp } = require("../structs/ipBanManager.js");
const webhooks    = require("../structs/webhooks.js");
const fs          = require("fs");

function getConfig() {
  try { return JSON.parse(fs.readFileSync("./Config/config.json").toString()); }
  catch { return {}; }
}

/* ────────────────────────────────────────────
   Helpers
──────────────────────────────────────────── */

/**
 * Resolve accountId from a raw token string (strips eg1~ prefix,
 * looks up in global.accessTokens memory store).
 */
function resolveAccount(rawToken) {
  if (!rawToken) return null;
  const token = String(rawToken).replace(/^eg1~/i, "").trim();

  const entry = global.accessTokens?.find(
    (t) => t.token === token || t.token === `eg1~${token}`,
  );
  if (!entry?.accountId) return null;

  try {
    const decoded = jwt.decode(token);
    if (!decoded?.sub) return null;
    // Check expiry
    if (decoded.creation_date) {
      const exp = new Date(decoded.creation_date);
      exp.setHours(exp.getHours() + (decoded.hours_expire || 0));
      if (exp.getTime() <= Date.now()) return null;
    }
    return entry.accountId;
  } catch {
    return null;
  }
}

/**
 * Full ban: account record + all HWIDs + all IPs + Discord alert.
 */
async function executeFullBan(user, reason, source = "redirect_anticheat") {
  await User.updateOne(
    { accountId: user.accountId },
    {
      $set: {
        banned: true,
        banReason: reason,
        bannedUntil: null, // permanent
      },
    },
  );

  await banAllUserHwids(user, reason, source);
  await banAllUserIps(user, reason, source);

  log.backend(`[ANTICHEAT] Auto-banned ${user.username} (${user.accountId}): ${reason}`);

  // Notify Discord
  try {
    await webhooks.notifyBan?.({
      username: user.username,
      accountId: user.accountId,
      reason,
      bannedBy: `Starless Redirect (${source})`,
    });
  } catch { /* webhook errors are non-fatal */ }
}

/* ────────────────────────────────────────────
   POST /phoenix/api/anticheat/report
   DLL → backend cheat detection report
──────────────────────────────────────────── */
app.post("/phoenix/api/anticheat/report", async (req, res) => {
  try {
    const { token, hwid, reason, severity, metadata } = req.body ?? {};

    if (!token) {
      return res.status(401).json({ success: false, message: "Missing token." });
    }

    const accountId = resolveAccount(token);
    if (!accountId) {
      return res.status(401).json({ success: false, message: "Invalid or expired token." });
    }

    const user = await User.findOne({ accountId });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    // Already banned — acknowledge but don't double-process
    if (user.banned) {
      return res.status(200).json({ success: true, action: "already_banned" });
    }

    const clientIp  = resolveClientIp(req);
    const banReason = reason
      ? `Starless Redirect: ${reason}`
      : "Starless Redirect: Cheat detected";

    // Log the detection event regardless of severity
    log.backend(
      `[ANTICHEAT REPORT] ${user.username} | severity=${severity ?? "unknown"} | reason=${banReason} | ip=${clientIp} | hwid=${hwid ?? "n/a"}`,
    );

    // Only apply ban for high/critical severity or explicit ban flag
    const shouldBan =
      !severity ||
      severity === "high" ||
      severity === "critical" ||
      severity === "ban";

    if (shouldBan) {
      await executeFullBan(user, banReason, "redirect_anticheat");

      // Force disconnect any active token
      if (global.accessTokens) {
        const idx = global.accessTokens.findIndex((t) => t.accountId === accountId);
        if (idx !== -1) global.accessTokens.splice(idx, 1);
      }

      return res.status(200).json({
        success: true,
        action: "banned",
        message: "Account has been banned.",
      });
    }

    // Low/medium severity — flag for review, don't ban yet
    await User.updateOne(
      { accountId },
      {
        $push: {
          anticheatFlags: {
            reason: banReason,
            severity: severity ?? "low",
            detectedAt: new Date(),
            ip: clientIp,
            hwid: hwid ?? null,
            metadata: metadata ?? null,
          },
        },
      },
    );

    return res.status(200).json({
      success: true,
      action: "flagged",
      message: "Detection logged for review.",
    });

  } catch (err) {
    log.error(`[ANTICHEAT REPORT ERROR] ${err?.message || err}`);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/* ────────────────────────────────────────────
   POST /phoenix/api/anticheat/heartbeat
   DLL → backend keep-alive / integrity check
──────────────────────────────────────────── */
app.post("/phoenix/api/anticheat/heartbeat", async (req, res) => {
  try {
    const { token, hwid } = req.body ?? {};

    if (!token) return res.status(401).json({ ok: false });

    const accountId = resolveAccount(token);
    if (!accountId) return res.status(401).json({ ok: false, kick: true });

    const user = await User.findOne({ accountId }).lean();
    if (!user) return res.status(401).json({ ok: false, kick: true });

    // Tell DLL to kick if account is banned
    if (user.banned) {
      return res.status(200).json({ ok: false, kick: true, reason: "banned" });
    }

    // Check HWID ban
    if (hwid) {
      const bannedHwid = await findBannedHwid([hwid]);
      if (bannedHwid) {
        // HWID is banned — ban account too and kick
        await User.updateOne(
          { accountId },
          { $set: { banned: true, banReason: "HWID ban detected at heartbeat", bannedUntil: null } },
        );
        return res.status(200).json({ ok: false, kick: true, reason: "hwid_banned" });
      }
    }

    // Check IP ban
    const clientIp = resolveClientIp(req);
    if (clientIp) {
      const bannedIp = await findBannedIp([clientIp]);
      if (bannedIp) {
        await User.updateOne(
          { accountId },
          { $set: { banned: true, banReason: "IP ban detected at heartbeat", bannedUntil: null } },
        );
        return res.status(200).json({ ok: false, kick: true, reason: "ip_banned" });
      }
    }

    // All good — tell DLL to continue
    return res.status(200).json({ ok: true, kick: false });

  } catch (err) {
    log.error(`[ANTICHEAT HEARTBEAT ERROR] ${err?.message || err}`);
    return res.status(500).json({ ok: false });
  }
});

/* ────────────────────────────────────────────
   GET /phoenix/api/anticheat/status/:accountId
   Staff — check anticheat flags for an account
──────────────────────────────────────────── */
app.get("/phoenix/api/anticheat/status/:accountId", async (req, res) => {
  try {
    const config = getConfig();
    const staffKey = req.headers["x-staff-key"];

    if (!staffKey || staffKey !== config.Api?.bApiKey) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const { accountId } = req.params;
    const user = await User.findOne({ accountId }).lean();
    if (!user) return res.status(404).json({ error: "User not found." });

    return res.status(200).json({
      accountId:      user.accountId,
      username:       user.username,
      banned:         user.banned,
      banReason:      user.banReason ?? null,
      bannedUntil:    user.bannedUntil ?? null,
      anticheatFlags: user.anticheatFlags ?? [],
      hwids:          user.hwids ?? [],
      launcherHwid:   user.launcherHwid ?? null,
    });

  } catch (err) {
    log.error(`[ANTICHEAT STATUS ERROR] ${err?.message || err}`);
    return res.status(500).json({ error: "Server error." });
  }
});

module.exports = app;
