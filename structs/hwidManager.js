const User = require("../model/user.js");
const HwidBan = require("../model/hwidBan.js");
const log = require("./log.js");
const { checkAccountSharing } = require("./securityMonitor.js");

function normalizeHwidList(...lists) {
    const out = new Set();
    for (const list of lists) {
        if (!list) continue;
        const arr = Array.isArray(list) ? list : [list];
        for (const item of arr) {
            const value = String(item || "").trim();
            if (value.length > 0) out.add(value);
        }
    }
    return [...out];
}

async function isHwidBanned(hwid) {
    if (!hwid) return false;

    const ban = await HwidBan.findOne({ hwid: String(hwid).trim() }).lean();
    if (!ban) return false;

    if (ban.bannedUntil && new Date(ban.bannedUntil) < new Date()) {
        await HwidBan.deleteOne({ hwid: ban.hwid });
        return false;
    }

    return true;
}

async function findBannedHwid(hwids) {
    const clean = normalizeHwidList(hwids);
    for (const hwid of clean) {
        if (await isHwidBanned(hwid)) return hwid;
    }
    return null;
}

async function banHwid(hwid, meta = {}) {
    const id = String(hwid || "").trim();
    if (!id) return;

    await HwidBan.updateOne(
        { hwid: id },
        {
            $set: {
                hwid: id,
                accountId: meta.accountId || null,
                username: meta.username || null,
                reason: meta.reason || "HWID ban",
                bannedAt: meta.bannedAt || new Date(),
                bannedUntil: meta.bannedUntil ?? null,
                source: meta.source || "admin",
            },
        },
        { upsert: true },
    );

    log.debug(`HWID banned: ${id} (${meta.reason || "HWID ban"})`);
}

async function banAllUserHwids(user, reason, source = "admin") {
    if (!user) return [];

    const ids = normalizeHwidList(user.launcherHwid, user.hwids);
    for (const hwid of ids) {
        await banHwid(hwid, {
            accountId: user.accountId,
            username: user.username,
            reason,
            source,
        });
    }
    return ids;
}

async function recordLauncherHwid(accountId, launcherHwid) {
    const hwid = String(launcherHwid || "").trim();
    if (!accountId || !hwid) return;

    await User.updateOne(
        { accountId },
        {
            $set: { launcherHwid: hwid, hwidLastSeen: new Date() },
        },
    );

    // Fire-and-forget account sharing check
    checkAccountSharing(accountId, hwid).catch(() => {});
}

async function recordArcHwids(accountId, hwids) {
    const clean = normalizeHwidList(hwids);
    if (!accountId || clean.length === 0) return;

    await User.updateOne(
        { accountId },
        {
            $addToSet: { hwids: { $each: clean } },
            $set: { hwidLastSeen: new Date() },
        },
    );

    log.debug(`Stored ${clean.length} Arc HWID(s) for ${accountId}`);

    // Check each new HWID for account sharing
    for (const hwid of clean) {
        checkAccountSharing(accountId, hwid).catch(() => {});
    }
}

async function getUserHwids(accountId) {
    const user = await User.findOne({ accountId }).lean();
    if (!user) return [];
    return normalizeHwidList(user.launcherHwid, user.hwids);
}

async function findUserByAnyHwid(hwid) {
    const id = String(hwid || "").trim();
    if (!id) return null;

    return User.findOne({
        $or: [{ launcherHwid: id }, { hwids: id }],
    }).lean();
}

module.exports = {
    normalizeHwidList,
    isHwidBanned,
    findBannedHwid,
    banHwid,
    banAllUserHwids,
    recordLauncherHwid,
    recordArcHwids,
    getUserHwids,
    findUserByAnyHwid,
};
