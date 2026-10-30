const redisCache = require("./redisCache.js");
const webhooks = require("./webhooks.js");
const log = require("./log.js");

const THRESHOLDS = {
    failedLoginPerIp: 10,
    failedLoginWindowSec: 900,
    hwidChangesPerAccount: 3,
    hwidChangeWindowSec: 86400,
};

async function incrementCounter(key, windowSec) {
    const count = ((await redisCache.get(key)) || 0) + 1;
    await redisCache.set(key, count, windowSec);
    return count;
}

async function recordFailedLogin({ ip, email, hwid }) {
    const ipKey = `suspicious:failed_login:ip:${ip || "unknown"}`;
    const count = await incrementCounter(ipKey, THRESHOLDS.failedLoginWindowSec);

    if (count >= THRESHOLDS.failedLoginPerIp) {
        log.backend(`Suspicious login activity from IP ${ip} (${count} failures)`);
        await webhooks.notifySuspiciousActivity({
            type: "Failed Login Flood",
            ip,
            hwid,
            email,
            details: `${count} failed login attempts from this IP in ${THRESHOLDS.failedLoginWindowSec / 60} minutes`,
        });
    }
}

async function recordHwidChange({ accountId, username, oldHwid, newHwid, ip }) {
    if (!accountId || !newHwid || oldHwid === newHwid) return;

    const key = `suspicious:hwid_change:${accountId}`;
    const count = await incrementCounter(key, THRESHOLDS.hwidChangeWindowSec);

    if (count >= THRESHOLDS.hwidChangesPerAccount) {
        log.backend(`Suspicious HWID changes for ${username} (${count} changes)`);
        await webhooks.notifySuspiciousActivity({
            type: "HWID Change Spike",
            ip,
            hwid: newHwid,
            email: username,
            details: `Account **${username}** changed HWID ${count} times in 24h`,
        });
    }
}

module.exports = { recordFailedLogin, recordHwidChange };
