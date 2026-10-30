const AnalyticEvent = require("../model/analyticEvent.js");
const redisCache = require("./redisCache.js");

const POPULAR_COSMETIC_KEY = "analytics:popular_cosmetics";

async function track(type, { accountId, username, metadata } = {}) {
    try {
        await AnalyticEvent.create({
            type,
            accountId: accountId || "",
            username: username || "",
            metadata: metadata || {},
            created: new Date(),
        });

        if (type === "shop_purchase" && metadata?.templateId) {
            const popular = (await redisCache.get(POPULAR_COSMETIC_KEY)) || {};
            popular[metadata.templateId] = (popular[metadata.templateId] || 0) + 1;
            await redisCache.set(POPULAR_COSMETIC_KEY, popular, 86400);
        }
    } catch {
        // analytics must not break requests
    }
}

function startOfDay(date = new Date()) {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

async function getSummary() {
    const cacheKey = "analytics:summary";
    return redisCache.getOrSet(cacheKey, 120, async () => {
        const now = new Date();
        const dayStart = startOfDay(now);
        const weekStart = new Date(dayStart);
        weekStart.setUTCDate(weekStart.getUTCDate() - 7);

        const [dau, weeklyLogins, peakConcurrent, popularCosmetics, purchasesToday] = await Promise.all([
            AnalyticEvent.distinct("accountId", {
                type: "launcher_login",
                created: { $gte: dayStart },
                accountId: { $ne: "" },
            }),
            AnalyticEvent.countDocuments({ type: "launcher_login", created: { $gte: weekStart } }),
            AnalyticEvent.findOne({ type: "peak_concurrent" }).sort({ "metadata.count": -1 }).lean(),
            redisCache.get(POPULAR_COSMETIC_KEY),
            AnalyticEvent.countDocuments({ type: "shop_purchase", created: { $gte: dayStart } }),
        ]);

        const retentionBase = await AnalyticEvent.distinct("accountId", {
            type: "launcher_login",
            created: { $gte: weekStart, $lt: dayStart },
            accountId: { $ne: "" },
        });
        const retained = retentionBase.length
            ? await AnalyticEvent.countDocuments({
                type: "launcher_login",
                created: { $gte: dayStart },
                accountId: { $in: retentionBase },
            })
            : 0;

        const popular = Object.entries(popularCosmetics || {})
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([templateId, count]) => ({ templateId, count }));

        return {
            dau: dau.length,
            weeklyLogins,
            retentionRate: retentionBase.length
                ? Number(((retained / retentionBase.length) * 100).toFixed(1))
                : 0,
            peakConcurrent: peakConcurrent?.metadata?.count ?? (global.Clients?.length || 0),
            purchasesToday,
            popularCosmetics: popular,
            playersOnline: global.Clients?.length || 0,
            generatedAt: now.toISOString(),
        };
    });
}

async function recordPeakConcurrent() {
    const count = global.Clients?.length || 0;
    if (count <= 0) return;
    try {
        const latest = await AnalyticEvent.findOne({ type: "peak_concurrent" })
            .sort({ created: -1 })
            .lean();
        if (!latest || (latest.metadata?.count || 0) < count) {
            await AnalyticEvent.create({
                type: "peak_concurrent",
                metadata: { count },
                created: new Date(),
            });
        }
    } catch {
        // ignore
    }
}

module.exports = { track, getSummary, recordPeakConcurrent };
