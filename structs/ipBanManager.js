const User = require("../model/user.js");
const IpBan = require("../model/ipBan.js");
const log = require("./log.js");

const PHOENIX_IP_BAN_MESSAGE =
    "You Are Ip Banned From Phoenix! If this was by accident feel free to open a ticket on support server!!";

function normalizeIp(ip) {
    if (!ip) return "";
    let value = String(ip).trim();
    if (value.startsWith("::ffff:")) value = value.slice(7);
    if (value === "::1") value = "127.0.0.1";
    return value;
}

function normalizeIpList(...lists) {
    const out = new Set();
    for (const list of lists) {
        if (!list) continue;
        const arr = Array.isArray(list) ? list : [list];
        for (const item of arr) {
            const value = normalizeIp(item);
            if (value.length > 0) out.add(value);
        }
    }
    return [...out];
}

function resolveClientIp(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) {
        const first = String(forwarded).split(",")[0].trim();
        const normalized = normalizeIp(first);
        if (normalized) return normalized;
    }

    return normalizeIp(req.ip || req.socket?.remoteAddress || "");
}

async function isIpBanned(ip) {
    const id = normalizeIp(ip);
    if (!id) return false;

    const ban = await IpBan.findOne({ ip: id }).lean();
    if (!ban) return false;

    if (ban.bannedUntil && new Date(ban.bannedUntil) < new Date()) {
        await IpBan.deleteOne({ ip: ban.ip });
        return false;
    }

    return true;
}

async function findBannedIp(ips) {
    const clean = normalizeIpList(ips);
    for (const ip of clean) {
        if (await isIpBanned(ip)) return ip;
    }
    return null;
}

async function banIp(ip, meta = {}) {
    const id = normalizeIp(ip);
    if (!id) return false;

    await IpBan.updateOne(
        { ip: id },
        {
            $set: {
                ip: id,
                accountId: meta.accountId || null,
                username: meta.username || null,
                reason: meta.reason || "IP ban",
                bannedAt: meta.bannedAt || new Date(),
                bannedUntil: meta.bannedUntil ?? null,
                source: meta.source || "admin",
            },
        },
        { upsert: true },
    );

    log.debug(`IP banned: ${id} (${meta.reason || "IP ban"})`);
    return true;
}

async function unbanIp(ip) {
    const id = normalizeIp(ip);
    if (!id) return false;
    const result = await IpBan.deleteOne({ ip: id });
    return result.deletedCount > 0;
}

async function unbanAllUserIps(user) {
    const ips = normalizeIpList(user?.lastLauncherIp, user?.launcherIps);
    if (ips.length === 0) return 0;

    const result = await IpBan.deleteMany({ ip: { $in: ips } });
    return result.deletedCount || 0;
}

async function banAllUserIps(user, reason, source = "admin") {
    if (!user) return [];

    const ips = normalizeIpList(user.lastLauncherIp, user.launcherIps);
    for (const ip of ips) {
        await banIp(ip, {
            accountId: user.accountId,
            username: user.username,
            reason,
            source,
        });
    }
    return ips;
}

async function recordLauncherIp(accountId, ip) {
    const id = normalizeIp(ip);
    if (!accountId || !id) return;

    await User.updateOne(
        { accountId },
        {
            $set: { lastLauncherIp: id, ipLastSeen: new Date() },
            $addToSet: { launcherIps: id },
        },
    );
}

async function getUserIps(accountId) {
    const user = await User.findOne({ accountId }).lean();
    if (!user) return [];
    return normalizeIpList(user.lastLauncherIp, user.launcherIps);
}

async function findUserByAnyIp(ip) {
    const id = normalizeIp(ip);
    if (!id) return null;

    return User.findOne({
        $or: [{ lastLauncherIp: id }, { launcherIps: id }],
    }).lean();
}

module.exports = {
    PHOENIX_IP_BAN_MESSAGE,
    normalizeIp,
    normalizeIpList,
    resolveClientIp,
    isIpBanned,
    findBannedIp,
    banIp,
    unbanIp,
    unbanAllUserIps,
    banAllUserIps,
    recordLauncherIp,
    getUserIps,
    findUserByAnyIp,
};
