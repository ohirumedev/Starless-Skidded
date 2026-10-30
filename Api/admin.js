/**
 * Crystal Admin Panel API
 *
 * All routes require:
 *   Authorization: bearer eg1~<token>
 *   AND the account must have a Discord role from founderRoleIds OR be in moderators list.
 *
 * GET  /phoenix/api/admin/check                     — check if caller is admin
 * GET  /phoenix/api/admin/players?search=&page=     — list / search players
 * GET  /phoenix/api/admin/player/:username          — get player details
 * POST /phoenix/api/admin/ban                       — ban a player
 * POST /phoenix/api/admin/unban                     — unban a player
 * POST /phoenix/api/admin/give-vbucks               — give V-Bucks to a player
 * GET  /phoenix/api/admin/bans?page=                — list recent bans
 * POST /phoenix/api/admin/announce                  — send server-wide announcement
 * GET  /phoenix/api/admin/stats                     — server overview stats
 */

const express    = require("express");
const fs         = require("fs");
const app        = express.Router();
const User       = require("../model/user.js");
const Profile    = require("../model/profiles.js");
const IpBan      = require("../model/ipBan.js");
const HwidBan    = require("../model/hwidBan.js");
const UserStats  = require("../model/userstats.js");
const log        = require("../structs/log.js");
const { verifyToken }    = require("../tokenManager/tokenVerify.js");
const { unbanAllUserIps, banAllUserIps } = require("../structs/ipBanManager.js");

const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());

/* ─────────────────────────────────────────────
   Admin auth middleware
   Checks: token valid + Discord role OR moderator list
───────────────────────────────────────────── */
async function requireAdmin(req, res, next) {
    // 1. Verify bearer token
    try {
        await new Promise((resolve, reject) =>
            verifyToken(req, res, (err) => (err ? reject(err) : resolve()))
        );
    } catch {
        return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    if (!req.user?.accountId) {
        return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    // 2. Load user's Discord ID
    const user = await User.findOne({ accountId: req.user.accountId }).lean();
    if (!user?.discordId) {
        return res.status(403).json({ success: false, message: "Admin access requires a linked Discord account." });
    }

    // 3. Check moderators list (Discord user IDs)
    const moderatorIds = (config.moderators || []).map(String).filter(Boolean);
    if (moderatorIds.includes(user.discordId)) {
        req.adminUser = user;
        return next();
    }

    // 4. Check founderRoleIds as direct user IDs too (owner bypass)
    const founderRoles = (config.founderRoleIds || []).map(String).filter(Boolean);
    if (founderRoles.includes(user.discordId)) {
        req.adminUser = user;
        return next();
    }

    // 5. Check Discord roles via bot token + guild ID
    const botToken = config?.discord?.bot_token;
    const guildId  = config?.discord?.guildId;

    if (botToken && guildId) {
        try {
            const axios = require("axios");
            const memberRes = await axios.get(
                `https://discord.com/api/v10/guilds/${guildId}/members/${user.discordId}`,
                {
                    headers: { Authorization: `Bot ${botToken}` },
                    timeout: 6000,
                }
            );
            const memberRoles = memberRes.data?.roles || [];
            const hasRole = founderRoles.some(r => memberRoles.includes(r));
            if (hasRole) {
                req.adminUser = user;
                return next();
            }
        } catch (err) {
            log.debug(`Admin role check failed: ${err?.message}`);
        }
    }

    return res.status(403).json({ success: false, message: "You do not have admin permissions." });
}

/* ─────────────────────────────────────────────
   GET /phoenix/api/admin/check
───────────────────────────────────────────── */
app.get("/phoenix/api/admin/check", requireAdmin, (req, res) => {
    return res.json({
        success: true,
        username: req.adminUser.username,
        discordId: req.adminUser.discordId,
    });
});

/* ─────────────────────────────────────────────
   GET /phoenix/api/admin/stats
───────────────────────────────────────────── */
app.get("/phoenix/api/admin/stats", requireAdmin, async (req, res) => {
    try {
        const [totalPlayers, bannedPlayers, totalIpBans, totalHwidBans, onlinePlayers] =
            await Promise.all([
                User.countDocuments({ isServer: { $ne: true } }),
                User.countDocuments({ banned: true }),
                IpBan.countDocuments(),
                HwidBan.countDocuments(),
                Promise.resolve(global.Clients?.length ?? 0),
            ]);

        return res.json({
            success: true,
            stats: {
                totalPlayers,
                bannedPlayers,
                totalIpBans,
                totalHwidBans,
                onlinePlayers,
            },
        });
    } catch (err) {
        log.error(`Admin stats error: ${err?.message}`);
        return res.status(500).json({ success: false, message: "Server error." });
    }
});

/* ─────────────────────────────────────────────
   GET /phoenix/api/admin/players
───────────────────────────────────────────── */
app.get("/phoenix/api/admin/players", requireAdmin, async (req, res) => {
    try {
        const search = String(req.query.search || "").trim().toLowerCase();
        const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit  = 25;
        const skip   = (page - 1) * limit;

        const query = { isServer: { $ne: true } };
        if (search) {
            query.$or = [
                { username_lower: { $regex: search, $options: "i" } },
                { email:          { $regex: search, $options: "i" } },
                { discordId:      search },
                { accountId:      search },
            ];
        }

        const [players, total] = await Promise.all([
            User.find(query)
                .sort({ created: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            User.countDocuments(query),
        ]);

        return res.json({
            success: true,
            players: players.map(p => ({
                accountId:   p.accountId,
                username:    p.username,
                email:       p.email,
                discordId:   p.discordId || null,
                banned:      p.banned || false,
                banReason:   p.banReason || null,
                created:     p.created,
                lastSeen:    p.ipLastSeen || p.hwidLastSeen || null,
                launcherHwid: p.launcherHwid || null,
            })),
            total,
            page,
            pages: Math.ceil(total / limit),
        });
    } catch (err) {
        log.error(`Admin players error: ${err?.message}`);
        return res.status(500).json({ success: false, message: "Server error." });
    }
});

/* ─────────────────────────────────────────────
   GET /phoenix/api/admin/player/:username
───────────────────────────────────────────── */
app.get("/phoenix/api/admin/player/:username", requireAdmin, async (req, res) => {
    try {
        const user = await User.findOne({
            username_lower: req.params.username.toLowerCase(),
        }).lean();

        if (!user) return res.status(404).json({ success: false, message: "Player not found." });

        const stats = await UserStats.findOne({ accountId: user.accountId }).lean();
        const ipBans = await IpBan.find({
            $or: [
                { accountId: user.accountId },
                { ip: { $in: [user.lastLauncherIp, ...(user.launcherIps || [])] } },
            ],
        }).lean();

        const hwidBans = await HwidBan.find({
            hwid: { $in: [user.launcherHwid, ...(user.hwids || [])] },
        }).lean();

        return res.json({
            success: true,
            player: {
                accountId:    user.accountId,
                username:     user.username,
                email:        user.email,
                discordId:    user.discordId || null,
                banned:       user.banned || false,
                banReason:    user.banReason || null,
                created:      user.created,
                lastLauncherIp: user.lastLauncherIp || null,
                launcherIps:  user.launcherIps || [],
                launcherHwid: user.launcherHwid || null,
                hwids:        user.hwids || [],
                anticheatFlags: user.anticheatFlags || [],
                ipBans:       ipBans.map(b => ({ ip: b.ip, reason: b.reason, bannedAt: b.bannedAt })),
                hwidBans:     hwidBans.map(b => ({ hwid: b.hwid, reason: b.reason, bannedAt: b.bannedAt })),
                stats: {
                    kills:  stats?.solo?.kills  ?? 0,
                    wins:   stats?.solo?.placetop1 ?? 0,
                },
            },
        });
    } catch (err) {
        log.error(`Admin player detail error: ${err?.message}`);
        return res.status(500).json({ success: false, message: "Server error." });
    }
});

/* ─────────────────────────────────────────────
   POST /phoenix/api/admin/ban
   Body: { username, reason, banIp?, banHwid? }
───────────────────────────────────────────── */
app.post("/phoenix/api/admin/ban", requireAdmin, async (req, res) => {
    try {
        const username = String(req.body?.username || "").trim();
        const reason   = String(req.body?.reason   || "Banned by admin").trim();
        const banIp    = req.body?.banIp    !== false;
        const banHwid  = req.body?.banHwid  !== false;

        if (!username) return res.status(400).json({ success: false, message: "username is required." });

        const user = await User.findOne({ username_lower: username.toLowerCase() });
        if (!user) return res.status(404).json({ success: false, message: "Player not found." });
        if (user.banned) return res.status(400).json({ success: false, message: "Player is already banned." });

        await User.updateOne(
            { accountId: user.accountId },
            { $set: { banned: true, banReason: reason } },
        );

        let ipsBanned  = 0;
        let hwidBanned = 0;

        if (banIp) {
            const ips = await banAllUserIps(user, reason, "admin_panel");
            ipsBanned = ips.length;
        }

        if (banHwid && user.launcherHwid) {
            await HwidBan.updateOne(
                { hwid: user.launcherHwid },
                { $set: { hwid: user.launcherHwid, accountId: user.accountId, username: user.username, reason, bannedAt: new Date(), source: "admin_panel" } },
                { upsert: true },
            );
            hwidBanned = 1;
        }

        log.backend(`Admin ban: ${req.adminUser.username} banned ${user.username} — ${reason}`);

        return res.json({
            success: true,
            message: `${user.username} banned. IPs: ${ipsBanned}, HWIDs: ${hwidBanned}.`,
        });
    } catch (err) {
        log.error(`Admin ban error: ${err?.message}`);
        return res.status(500).json({ success: false, message: "Server error." });
    }
});

/* ─────────────────────────────────────────────
   POST /phoenix/api/admin/unban
   Body: { username }
───────────────────────────────────────────── */
app.post("/phoenix/api/admin/unban", requireAdmin, async (req, res) => {
    try {
        const username = String(req.body?.username || "").trim();
        if (!username) return res.status(400).json({ success: false, message: "username is required." });

        const user = await User.findOne({ username_lower: username.toLowerCase() });
        if (!user) return res.status(404).json({ success: false, message: "Player not found." });
        if (!user.banned) return res.status(400).json({ success: false, message: "Player is not banned." });

        await User.updateOne(
            { accountId: user.accountId },
            { $set: { banned: false, banReason: null } },
        );

        const ipUnbanned   = await unbanAllUserIps(user);
        const hwids = [user.launcherHwid, ...(user.hwids || [])].filter(Boolean);
        let hwidUnbanned = 0;
        for (const hwid of hwids) {
            const r = await HwidBan.deleteOne({ hwid });
            if (r.deletedCount) hwidUnbanned++;
        }
        // Also clear by accountId to catch any orphaned HWID ban records
        const byAcct = await HwidBan.deleteMany({ accountId: user.accountId });
        hwidUnbanned += byAcct.deletedCount || 0;

        log.backend(`Admin unban: ${req.adminUser.username} unbanned ${user.username}`);

        return res.json({
            success: true,
            message: `${user.username} unbanned. IPs cleared: ${ipUnbanned}, HWIDs cleared: ${hwidUnbanned}.`,
        });
    } catch (err) {
        log.error(`Admin unban error: ${err?.message}`);
        return res.status(500).json({ success: false, message: "Server error." });
    }
});

/* ─────────────────────────────────────────────
   POST /phoenix/api/admin/give-vbucks
   Body: { username, amount }
───────────────────────────────────────────── */
app.post("/phoenix/api/admin/give-vbucks", requireAdmin, async (req, res) => {
    try {
        const username = String(req.body?.username || "").trim();
        const amount   = parseInt(req.body?.amount, 10);

        if (!username) return res.status(400).json({ success: false, message: "username is required." });
        if (!amount || amount < 1 || amount > 1_000_000) {
            return res.status(400).json({ success: false, message: "Amount must be 1–1,000,000." });
        }

        const user = await User.findOne({ username_lower: username.toLowerCase() }).lean();
        if (!user) return res.status(404).json({ success: false, message: "Player not found." });

        const profileDoc = await Profile.findOne({ accountId: user.accountId });
        if (!profileDoc) return res.status(404).json({ success: false, message: "Player profile not found." });

        const cc = profileDoc.profiles?.common_core;
        const p0 = profileDoc.profiles?.profile0;
        if (!cc?.items || !p0?.items) return res.status(500).json({ success: false, message: "Profile corrupted." });

        const key = "Currency:MtxPurchased";
        const ensure = (obj) => {
            if (!obj.items[key]) obj.items[key] = { templateId: key, quantity: 0, attributes: { platform: "Epic" } };
        };
        ensure(cc); ensure(p0);

        cc.items[key].quantity += amount;
        p0.items[key].quantity += amount;
        cc.rvn = (cc.rvn || 0) + 1;
        p0.rvn = (p0.rvn || 0) + 1;

        await Profile.updateOne(
            { accountId: user.accountId },
            { $set: { "profiles.common_core": cc, "profiles.profile0": p0 } },
        );

        const newBalance = cc.items[key].quantity;
        log.backend(`Admin give-vbucks: ${req.adminUser.username} gave ${amount} VBucks to ${user.username} (balance now ${newBalance})`);

        return res.json({
            success: true,
            message: `Gave ${amount.toLocaleString()} V-Bucks to ${user.username}. New balance: ${newBalance.toLocaleString()}.`,
            newBalance,
        });
    } catch (err) {
        log.error(`Admin give-vbucks error: ${err?.message}`);
        return res.status(500).json({ success: false, message: "Server error." });
    }
});

/* ─────────────────────────────────────────────
   GET /phoenix/api/admin/bans
───────────────────────────────────────────── */
app.get("/phoenix/api/admin/bans", requireAdmin, async (req, res) => {
    try {
        const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = 30;
        const skip  = (page - 1) * limit;

        const [players, total] = await Promise.all([
            User.find({ banned: true })
                .sort({ _id: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            User.countDocuments({ banned: true }),
        ]);

        return res.json({
            success: true,
            bans: players.map(p => ({
                accountId: p.accountId,
                username:  p.username,
                email:     p.email,
                discordId: p.discordId || null,
                banReason: p.banReason || "No reason provided",
                created:   p.created,
            })),
            total,
            page,
            pages: Math.ceil(total / limit),
        });
    } catch (err) {
        log.error(`Admin bans list error: ${err?.message}`);
        return res.status(500).json({ success: false, message: "Server error." });
    }
});

/* ─────────────────────────────────────────────
   POST /phoenix/api/admin/announce
   Body: { message, title? }
   Broadcasts + stores for launcher polling.
───────────────────────────────────────────── */

// In-memory store for latest announcement (survives until next restart)
let _latestAnnouncement = null;

app.post("/phoenix/api/admin/announce", requireAdmin, async (req, res) => {
    try {
        const message = String(req.body?.message || "").trim();
        const title   = String(req.body?.title   || "Crystal Announcement").trim();

        if (!message) return res.status(400).json({ success: false, message: "message is required." });

        // Store for launcher polling
        _latestAnnouncement = {
            id:     Date.now().toString(),
            title,
            body:   message,
            sentBy: req.adminUser.username,
            sentAt: Date.now(),
        };

        // Broadcast via XMPP if available
        let sent = 0;
        const clients = global.Clients || [];
        for (const client of clients) {
            try {
                if (client?.socket && client.socket.readyState === 1) {
                    client.socket.send(JSON.stringify({
                        type: "com.epicgames.social.announcement.v1",
                        payload: { title, body: message, sentBy: req.adminUser.username, timestamp: new Date().toISOString() },
                    }));
                    sent++;
                }
            } catch {}
        }

        log.backend(`Admin announce: ${req.adminUser.username} sent "${message}" (${sent} clients)`);

        return res.json({
            success: true,
            message: `Announcement sent to ${sent} online player(s).`,
            title,
            body: message,
        });
    } catch (err) {
        log.error(`Admin announce error: ${err?.message}`);
        return res.status(500).json({ success: false, message: "Server error." });
    }
});

/* ─────────────────────────────────────────────
   GET /phoenix/api/launcher/announcements
   Launcher polls this every 30s.
───────────────────────────────────────────── */
app.get("/phoenix/api/launcher/announcements", async (req, res) => {
    if (!_latestAnnouncement) return res.json({ announcements: [] });
    return res.json({ announcements: [_latestAnnouncement] });
});

module.exports = app;
